-- ─────────────────────────────────────────────────────────────────────────────
-- M-141  Redry: keep champion ONLY when re-entered the same dryer as one batch;
--        otherwise re-sample with method_2. Re-sampled redry samples still get R.
--
-- M-137 made redry carts keep their original champion. Refinement: that only
-- holds when the original group's redry carts went back into the SAME dryer as
-- ONE batch (same dryer_number + same in_time). If they were spread across
-- dryers or checked in separately, the intact-group assumption breaks, so they
-- are RE-SAMPLED with method_2 (champion = highest / tail middle), tagged redry.
--
-- Detection: snapshot each cart's dryer BEFORE Step 1 clears dryer_number; in_time
-- is preserved by Step 1 so it's read live. Per original-group bucket:
--   n_dryers = 1 AND n_intimes = 1  → keep champion (M-137)
--   else                            → method_2 re-sample
--
-- Sample IDs: a re-sampled redry group may crown a NEW champion that never held
-- a sample of its own, so qc_take_sample's auto R-suffix is made redry-aware —
-- any cart whose group_assigned event is flagged redry counts as a retest and
-- gets the R marker even with zero prior samples of its own.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION qc_check_out_sub_lots_bulk(
    p_sub_lot_ids uuid[],
    p_out_time timestamptz DEFAULT NULL,
    p_sampling_method text DEFAULT 'method_2'
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    out_t timestamptz := COALESCE(p_out_time, now());
    requested int := COALESCE(array_length(p_sub_lot_ids, 1), 0);
    succeeded jsonb := '[]'::jsonb;
    failed jsonb := '[]'::jsonb;
    groups jsonb := '[]'::jsonb;
    sub_id uuid;
    s qc_drying_sub_lot%ROWTYPE;
    grp_rec record;
    sample_n int;
    cart_ids uuid[];
    T_count int;
    grp_seq int;
    member_ids uuid[];
    chunk_idx int;
    remaining int;
    champ_low_abs int;
    champion_id uuid;
    fresh_ids uuid[];
    redry_ids uuid[];
    prev_champ_ids uuid[];
    pre_dryer jsonb;
    n_dryers int;
BEGIN
    IF requested = 0 THEN
      RETURN jsonb_build_object('requested', 0, 'succeeded', succeeded, 'failed', failed, 'groups', groups);
    END IF;

    IF p_sampling_method NOT IN ('method_1', 'method_2') THEN
        RAISE EXCEPTION 'Invalid p_sampling_method: % (expected method_1 or method_2)', p_sampling_method;
    END IF;

    -- Snapshot previous champions + each cart's dryer BEFORE Step 1 clears them.
    SELECT array_agg(id) INTO prev_champ_ids
      FROM qc_drying_sub_lot
      WHERE id = ANY(p_sub_lot_ids) AND is_test_champion = true;

    SELECT jsonb_object_agg(id::text,
             COALESCE(dryer_number, (SELECT dl.dryer_number FROM qc_drying_location dl WHERE dl.id = location_id)))
      INTO pre_dryer
      FROM qc_drying_sub_lot WHERE id = ANY(p_sub_lot_ids);

    -- ── Step 1: check out each cart ──────────────────────────────────────────
    FOREACH sub_id IN ARRAY p_sub_lot_ids LOOP
        SELECT * INTO s FROM qc_drying_sub_lot WHERE id = sub_id FOR UPDATE;
        IF NOT FOUND THEN
            failed := failed || jsonb_build_array(jsonb_build_object(
                'sub_lot_id', sub_id, 'reason', 'not_found'));
            CONTINUE;
        END IF;
        IF s.status <> 'drying' THEN
            failed := failed || jsonb_build_array(jsonb_build_object(
                'sub_lot_id', sub_id, 'sub_lot_code', s.sub_lot_code,
                'reason', 'wrong_status', 'status', s.status));
            CONTINUE;
        END IF;

        UPDATE qc_drying_sub_lot
        SET out_time = out_t, status = 'pending', is_test_champion = false,
            location_id = NULL, dryer_number = NULL, updated_at = now()
        WHERE id = sub_id;

        UPDATE qc_sub_lot_spot_history
        SET ended_at = out_t, end_reason = 'check_out',
            duration_minutes = EXTRACT(EPOCH FROM (out_t - started_at)) / 60.0
        WHERE drying_sub_lot_id = sub_id AND ended_at IS NULL;

        INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
        VALUES (sub_id, 'check_out',
                jsonb_build_object('out_time', out_t, 'status', 'pending', 'mode', 'bulk'),
                auth.uid());

        succeeded := succeeded || jsonb_build_array(jsonb_build_object(
            'sub_lot_id', sub_id, 'sub_lot_code', s.sub_lot_code));
    END LOOP;

    -- ── Snapshot fresh vs redry BEFORE grouping writes anything (M-075 fix) ──
    SELECT array_agg(sl.id ORDER BY sl.sub_lot_code) INTO fresh_ids
      FROM qc_drying_sub_lot sl
      WHERE sl.id = ANY(p_sub_lot_ids) AND sl.status = 'pending'
        AND sl.out_time = out_t AND sl.test_group_id IS NULL;

    SELECT array_agg(sl.id ORDER BY sl.sub_lot_code) INTO redry_ids
      FROM qc_drying_sub_lot sl
      WHERE sl.id = ANY(p_sub_lot_ids) AND sl.status = 'pending'
        AND sl.out_time = out_t AND sl.test_group_id IS NOT NULL;

    -- ── Step 2a: FRESH carts → sampling method (one bucket per lot) ──────────
    IF fresh_ids IS NOT NULL THEN
        FOR grp_rec IN
            SELECT sl.production_lot_id,
                   COALESCE(sku.sample_every_n_carts, 1) AS sample_n,
                   array_agg(sl.id ORDER BY sl.sub_lot_code DESC) AS cart_ids
            FROM qc_drying_sub_lot sl
            JOIN qc_production_lot lot ON lot.id = sl.production_lot_id
            LEFT JOIN qc_product_sku sku ON sku.id = lot.sku_id
            WHERE sl.id = ANY(fresh_ids)
            GROUP BY sl.production_lot_id, sku.sample_every_n_carts
        LOOP
            sample_n := GREATEST(1, grp_rec.sample_n);
            cart_ids := grp_rec.cart_ids;
            T_count  := array_length(cart_ids, 1);

            SELECT COALESCE(MAX(group_sequence), 0) INTO grp_seq
              FROM qc_test_group WHERE production_lot_id = grp_rec.production_lot_id;

            chunk_idx := 0;
            WHILE chunk_idx < T_count LOOP
                remaining := T_count - chunk_idx;
                IF p_sampling_method = 'method_2'
                   AND remaining > sample_n AND remaining < 2 * sample_n THEN
                    champ_low_abs := chunk_idx + 2 + ((remaining - 1) / 2);
                    member_ids := cart_ids[chunk_idx + 1 : champ_low_abs - 1];
                    grp_seq := grp_seq + 1;
                    groups := groups || jsonb_build_array(qc__assign_test_group(
                        grp_rec.production_lot_id, grp_seq, member_ids,
                        member_ids[1], false, NULL, p_sampling_method));
                    member_ids := cart_ids[champ_low_abs : T_count];
                    grp_seq := grp_seq + 1;
                    groups := groups || jsonb_build_array(qc__assign_test_group(
                        grp_rec.production_lot_id, grp_seq, member_ids,
                        member_ids[1], false, NULL, p_sampling_method));
                    EXIT;
                ELSE
                    member_ids := cart_ids[chunk_idx + 1 : LEAST(chunk_idx + sample_n, T_count)];
                    grp_seq := grp_seq + 1;
                    groups := groups || jsonb_build_array(qc__assign_test_group(
                        grp_rec.production_lot_id, grp_seq, member_ids,
                        member_ids[1], false, NULL, p_sampling_method));
                    chunk_idx := chunk_idx + sample_n;
                END IF;
            END LOOP;
        END LOOP;
    END IF;

    -- ── Step 2b: REDRY carts ────────────────────────────────────────────────
    -- Per original group: kept intact (same champion) ONLY if all its redry carts
    -- went back into the same dryer as one batch; otherwise re-sampled by method_2.
    IF redry_ids IS NOT NULL THEN
        FOR grp_rec IN
            SELECT sl.production_lot_id,
                   sl.test_group_id AS original_group_id,
                   COALESCE(sku.sample_every_n_carts, 1) AS sample_n,
                   array_agg(sl.id ORDER BY sl.sub_lot_code DESC) AS cart_ids,
                   count(DISTINCT sl.in_time) AS n_intimes
            FROM qc_drying_sub_lot sl
            JOIN qc_production_lot lot ON lot.id = sl.production_lot_id
            LEFT JOIN qc_product_sku sku ON sku.id = lot.sku_id
            WHERE sl.id = ANY(redry_ids)
            GROUP BY sl.production_lot_id, sl.test_group_id, sku.sample_every_n_carts
        LOOP
            sample_n := GREATEST(1, grp_rec.sample_n);
            cart_ids := grp_rec.cart_ids;
            T_count  := array_length(cart_ids, 1);

            SELECT count(DISTINCT pre_dryer ->> u::text) INTO n_dryers
              FROM unnest(cart_ids) AS u;

            SELECT COALESCE(MAX(group_sequence), 0) INTO grp_seq
              FROM qc_test_group WHERE production_lot_id = grp_rec.production_lot_id;

            IF n_dryers = 1 AND grp_rec.n_intimes = 1 THEN
                -- One batch, same dryer → keep the original champion, single group.
                champion_id := NULL;
                SELECT m INTO champion_id
                  FROM unnest(cart_ids) AS m
                  WHERE m = ANY(COALESCE(prev_champ_ids, ARRAY[]::uuid[]))
                  LIMIT 1;
                IF champion_id IS NULL THEN champion_id := cart_ids[1]; END IF;

                grp_seq := grp_seq + 1;
                groups := groups || jsonb_build_array(qc__assign_test_group(
                    grp_rec.production_lot_id, grp_seq, cart_ids,
                    champion_id, true, grp_rec.original_group_id, p_sampling_method));
            ELSE
                -- Split across dryers / batches → re-sample with method_2.
                chunk_idx := 0;
                WHILE chunk_idx < T_count LOOP
                    remaining := T_count - chunk_idx;
                    IF remaining > sample_n AND remaining < 2 * sample_n THEN
                        champ_low_abs := chunk_idx + 2 + ((remaining - 1) / 2);
                        member_ids := cart_ids[chunk_idx + 1 : champ_low_abs - 1];
                        grp_seq := grp_seq + 1;
                        groups := groups || jsonb_build_array(qc__assign_test_group(
                            grp_rec.production_lot_id, grp_seq, member_ids,
                            member_ids[1], true, grp_rec.original_group_id, 'method_2'));
                        member_ids := cart_ids[champ_low_abs : T_count];
                        grp_seq := grp_seq + 1;
                        groups := groups || jsonb_build_array(qc__assign_test_group(
                            grp_rec.production_lot_id, grp_seq, member_ids,
                            member_ids[1], true, grp_rec.original_group_id, 'method_2'));
                        EXIT;
                    ELSE
                        member_ids := cart_ids[chunk_idx + 1 : LEAST(chunk_idx + sample_n, T_count)];
                        grp_seq := grp_seq + 1;
                        groups := groups || jsonb_build_array(qc__assign_test_group(
                            grp_rec.production_lot_id, grp_seq, member_ids,
                            member_ids[1], true, grp_rec.original_group_id, 'method_2'));
                        chunk_idx := chunk_idx + sample_n;
                    END IF;
                END LOOP;
            END IF;
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'requested', requested,
        'succeeded', succeeded,
        'failed',    failed,
        'groups',    groups
    );
END;
$$;

-- ── qc_take_sample: redry-aware R suffix ─────────────────────────────────────
CREATE OR REPLACE FUNCTION qc_take_sample(
    p_sub_lot_id uuid,
    p_sample_id text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    s            qc_drying_sub_lot%ROWTYPE;
    new_id       uuid;
    row          qc_sample%ROWTYPE;
    auto_id      text;
    sample_count int;
BEGIN
    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sub-lot not found'; END IF;
    IF s.status NOT IN ('pending', 'inspecting') THEN
        RAISE EXCEPTION 'Cannot take a sample for sub-lot in status %', s.status;
    END IF;

    IF p_sample_id IS NULL OR length(trim(p_sample_id)) = 0 THEN
        SELECT COUNT(*) INTO sample_count
          FROM qc_sample
         WHERE drying_sub_lot_id = p_sub_lot_id;

        -- M-141: a re-sampled redry cart can be a NEW champion with no sample of
        -- its own — but it's still a retest, so it must carry the R marker.
        IF sample_count = 0 AND EXISTS (
            SELECT 1 FROM qc_quality_event e
            WHERE e.drying_sub_lot_id = p_sub_lot_id
              AND e.event_type = 'group_assigned'
              AND e.payload->>'redry' = 'true'
        ) THEN
            sample_count := 1;
        END IF;

        IF sample_count = 0 THEN
            auto_id := s.sub_lot_code;
        ELSIF sample_count = 1 THEN
            auto_id := s.sub_lot_code || 'R';
        ELSE
            auto_id := s.sub_lot_code || 'R' || sample_count::text;
        END IF;
    ELSE
        auto_id := trim(p_sample_id);
    END IF;

    INSERT INTO qc_sample (drying_sub_lot_id, test_group_id, sample_id, taken_by_auth_id)
    VALUES (p_sub_lot_id, s.test_group_id, auto_id, auth.uid())
    RETURNING id INTO new_id;

    SELECT * INTO row FROM qc_sample WHERE id = new_id;

    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    VALUES (p_sub_lot_id, 'sample_taken',
            jsonb_build_object(
                'sample_id',     row.sample_id,
                'sample_pk',     row.id,
                'test_group_id', s.test_group_id,
                'auto_generated', (p_sample_id IS NULL OR length(trim(coalesce(p_sample_id, ''))) = 0)
            ),
            auth.uid());

    RETURN jsonb_build_object(
        'id',                row.id,
        'drying_sub_lot_id', row.drying_sub_lot_id,
        'test_group_id',     row.test_group_id,
        'sample_id',         row.sample_id,
        'taken_at',          row.taken_at,
        'status',            row.status
    );
END;
$$;

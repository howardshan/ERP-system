-- ─────────────────────────────────────────────────────────────────────────────
-- M-137  Redefine sampling method_2 (+ make default) + redry keeps champion
--
-- method_2 (operator-confirmed). Work top-down (highest cart first), N = sample_n:
--   • Take groups of N, champion = highest in the group.
--   • When the tail's remaining count R satisfies N < R < 2N, split the tail
--     EVENLY into two groups: the upper carts (champion = highest) and the lower
--     carts (champion = highest of the lower half = the "middle, smaller-if-two"
--     cart of the tail). The split point is the middle of the carts BELOW the
--     top one.
--   e.g. T=10, N=3 → 第1组 {10,9,8}→10, 第2组 {7,6,5}→7,
--                    第3组 {4,3}→4,      第4组 {2,1}→2.
--
-- method_1 (chunk-by-N, remainder solo, champion = highest) is UNCHANGED.
-- Default switched method_1 → method_2.
--
-- REDRY rule: carts being re-grouped after a re-dry keep the SAME champion that
-- represented their original group (whichever cart was sampled before is sampled
-- again). No re-chunking, no method applied — one group per original group,
-- champion = the previous champion (captured before Step 1 clears the flag);
-- falls back to the highest cart only if the old champion isn't among them.
--
-- Group creation is factored into qc__assign_test_group so fresh/redry share one
-- implementation. Frontend mirror: src/lib/qcSampling.ts + BulkCheckOutDialog.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Helper: create one test group, set champion, log events, return jsonb ─────
CREATE OR REPLACE FUNCTION qc__assign_test_group(
    p_production_lot_id uuid,
    p_group_seq int,
    p_member_ids uuid[],          -- descending sub_lot_code order
    p_champion_id uuid,
    p_redry boolean,
    p_original_group_id uuid,
    p_sampling_method text
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    grp_id uuid;
    chunk_size int := array_length(p_member_ids, 1);
BEGIN
    INSERT INTO qc_test_group (production_lot_id, group_sequence, member_count)
    VALUES (p_production_lot_id, p_group_seq, chunk_size)
    RETURNING id INTO grp_id;

    UPDATE qc_drying_sub_lot
    SET test_group_id    = grp_id,
        is_test_champion = (id = p_champion_id),
        status = CASE WHEN id = p_champion_id THEN 'pending' ELSE 'awaiting_group_result' END,
        updated_at = now()
    WHERE id = ANY(p_member_ids);

    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    SELECT m_id, 'group_assigned',
           jsonb_build_object(
               'test_group_id',     grp_id,
               'group_sequence',    p_group_seq,
               'is_champion',       m_id = p_champion_id,
               'member_count',      chunk_size,
               'redry',             p_redry,
               'original_group_id', p_original_group_id,
               'sampling_method',   p_sampling_method
           ),
           auth.uid()
    FROM unnest(p_member_ids) AS m_id;

    RETURN jsonb_build_object(
        'test_group_id',     grp_id,
        'group_sequence',    p_group_seq,
        'production_lot_id', p_production_lot_id,
        'member_count',      chunk_size,
        'champion_id',       p_champion_id,
        'member_ids',        to_jsonb(p_member_ids),
        'redry',             p_redry,
        'original_group_id', p_original_group_id,
        'sampling_method',   p_sampling_method
    );
END;
$$;

-- ── Main: bulk check-out + sampling ──────────────────────────────────────────
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
BEGIN
    IF requested = 0 THEN
      RETURN jsonb_build_object('requested', 0, 'succeeded', succeeded, 'failed', failed, 'groups', groups);
    END IF;

    IF p_sampling_method NOT IN ('method_1', 'method_2') THEN
        RAISE EXCEPTION 'Invalid p_sampling_method: % (expected method_1 or method_2)', p_sampling_method;
    END IF;

    -- Snapshot previous champions BEFORE Step 1 clears is_test_champion, so the
    -- redry path can keep sampling the same cart it sampled last time.
    SELECT array_agg(id) INTO prev_champ_ids
      FROM qc_drying_sub_lot
      WHERE id = ANY(p_sub_lot_ids) AND is_test_champion = true;

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
    -- cart_ids aggregated DESCENDING (highest sub_lot_code first).
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
                    -- Split tail evenly. champ_low_abs = first cart of the lower
                    -- group = middle (smaller-if-two) of the carts below the top.
                    champ_low_abs := chunk_idx + 2 + ((remaining - 1) / 2);

                    -- Upper group: top cart down to just above the split.
                    member_ids := cart_ids[chunk_idx + 1 : champ_low_abs - 1];
                    grp_seq := grp_seq + 1;
                    groups := groups || jsonb_build_array(qc__assign_test_group(
                        grp_rec.production_lot_id, grp_seq, member_ids,
                        member_ids[1], false, NULL, p_sampling_method));

                    -- Lower group: split cart down to the end.
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

    -- ── Step 2b: REDRY carts → keep original champion (one group per orig) ───
    IF redry_ids IS NOT NULL THEN
        FOR grp_rec IN
            SELECT sl.production_lot_id,
                   sl.test_group_id AS original_group_id,
                   array_agg(sl.id ORDER BY sl.sub_lot_code DESC) AS cart_ids
            FROM qc_drying_sub_lot sl
            WHERE sl.id = ANY(redry_ids)
            GROUP BY sl.production_lot_id, sl.test_group_id
        LOOP
            cart_ids := grp_rec.cart_ids;

            -- Champion = the cart that was champion before (sampled last time);
            -- fall back to the highest cart if it isn't among the redried carts.
            champion_id := NULL;
            SELECT m INTO champion_id
              FROM unnest(cart_ids) AS m
              WHERE m = ANY(COALESCE(prev_champ_ids, ARRAY[]::uuid[]))
              LIMIT 1;
            IF champion_id IS NULL THEN
                champion_id := cart_ids[1];
            END IF;

            SELECT COALESCE(MAX(group_sequence), 0) + 1 INTO grp_seq
              FROM qc_test_group WHERE production_lot_id = grp_rec.production_lot_id;

            groups := groups || jsonb_build_array(qc__assign_test_group(
                grp_rec.production_lot_id, grp_seq, cart_ids,
                champion_id, true, grp_rec.original_group_id, p_sampling_method));
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

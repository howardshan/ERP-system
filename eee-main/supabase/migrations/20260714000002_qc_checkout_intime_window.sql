-- ─────────────────────────────────────────────────────────────────────────────
-- M-165  Check-out sampling batches split by a 1-hour check-in (in_time) window
--
-- Until now a bulk check-out grouped ALL of a work order's carts selected in one
-- operation into a single sampling pool (then chunked by sample_every_n_carts),
-- regardless of when each cart entered the dryer. Operations wants time to matter:
-- carts of the same WO that entered the dryer within a 1-hour window count as ONE
-- batch (sampled together); carts more than an hour apart are a DIFFERENT batch.
--
-- Rule (BR-Q84): within one check-out, per WO, sort carts by in_time ascending and
-- greedily start a new batch whenever a cart's in_time is > 60 min after the
-- batch's EARLIEST cart (so each batch's earliest→latest span ≤ 60 min). Sampling
-- (method_1/method_2 chunking by sample_every_n_carts) then runs WITHIN each batch.
--   e.g. carts in at 10:00, 10:50, 11:10, 11:20 → {10:00, 10:50} and {11:10, 11:20}.
--
-- Applies to BOTH first inspection (Step 2a) and redry (Step 2b). For redry the
-- "keep the original champion" fast path (M-137/M-141) now fires only when the
-- redry carts form a SINGLE 1-hour window AND re-entered a single dryer; otherwise
-- they are re-sampled with method_2 per window.
-- ─────────────────────────────────────────────────────────────────────────────

-- Greedy in_time windowing: assign each cart a 1-based window index. A new window
-- opens whenever a cart's in_time is more than p_minutes after the current
-- window's earliest (anchor) cart. Deterministic: ordered by in_time then code.
CREATE OR REPLACE FUNCTION qc__intime_windows(p_ids uuid[], p_minutes numeric DEFAULT 60)
RETURNS TABLE(window_idx int, cart_id uuid)
LANGUAGE plpgsql STABLE AS $$
DECLARE
    r      record;
    anchor timestamptz;
    widx   int := 0;
BEGIN
    FOR r IN
        SELECT id, in_time
        FROM qc_drying_sub_lot
        WHERE id = ANY(p_ids)
        ORDER BY in_time ASC NULLS LAST, sub_lot_code ASC
    LOOP
        IF widx = 0
           OR anchor IS NULL OR r.in_time IS NULL
           OR (r.in_time - anchor) > (p_minutes * interval '1 minute') THEN
            widx := widx + 1;
            anchor := r.in_time;
        END IF;
        window_idx := widx;
        cart_id := r.id;
        RETURN NEXT;
    END LOOP;
END;
$$;

-- Drop the stale pre-sampling_method 2-arg overload left over from earlier
-- migrations so only the current 3-arg version below remains (avoids PostgREST
-- ambiguity + dead old grouping logic).
DROP FUNCTION IF EXISTS qc_check_out_sub_lots_bulk(uuid[], timestamptz);

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
    lot_rec record;
    grp_rec record;
    win_rec record;
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
    n_windows int;
    WINDOW_MIN constant numeric := 60;   -- same-batch check-in window (minutes)
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

    -- ── Step 2a: FRESH carts → per (lot, 1-hour in_time window) → sampling ───
    IF fresh_ids IS NOT NULL THEN
        FOR lot_rec IN
            SELECT sl.production_lot_id AS lot_id,
                   COALESCE(sku.sample_every_n_carts, 1) AS sample_n
            FROM qc_drying_sub_lot sl
            JOIN qc_production_lot lot ON lot.id = sl.production_lot_id
            LEFT JOIN qc_product_sku sku ON sku.id = lot.sku_id
            WHERE sl.id = ANY(fresh_ids)
            GROUP BY sl.production_lot_id, sku.sample_every_n_carts
        LOOP
            sample_n := GREATEST(1, lot_rec.sample_n);

            SELECT COALESCE(MAX(group_sequence), 0) INTO grp_seq
              FROM qc_test_group WHERE production_lot_id = lot_rec.lot_id;

            FOR grp_rec IN
                SELECT w.window_idx,
                       array_agg(sl.id ORDER BY sl.sub_lot_code DESC) AS cart_ids
                FROM qc__intime_windows(
                       (SELECT array_agg(x.id) FROM qc_drying_sub_lot x
                          WHERE x.id = ANY(fresh_ids) AND x.production_lot_id = lot_rec.lot_id),
                       WINDOW_MIN) w
                JOIN qc_drying_sub_lot sl ON sl.id = w.cart_id
                GROUP BY w.window_idx
                ORDER BY w.window_idx
            LOOP
                cart_ids := grp_rec.cart_ids;
                T_count  := array_length(cart_ids, 1);

                chunk_idx := 0;
                WHILE chunk_idx < T_count LOOP
                    remaining := T_count - chunk_idx;
                    IF p_sampling_method = 'method_2'
                       AND remaining > sample_n AND remaining < 2 * sample_n THEN
                        champ_low_abs := chunk_idx + 2 + ((remaining - 1) / 2);
                        member_ids := cart_ids[chunk_idx + 1 : champ_low_abs - 1];
                        grp_seq := grp_seq + 1;
                        groups := groups || jsonb_build_array(qc__assign_test_group(
                            lot_rec.lot_id, grp_seq, member_ids,
                            member_ids[1], false, NULL, p_sampling_method));
                        member_ids := cart_ids[champ_low_abs : T_count];
                        grp_seq := grp_seq + 1;
                        groups := groups || jsonb_build_array(qc__assign_test_group(
                            lot_rec.lot_id, grp_seq, member_ids,
                            member_ids[1], false, NULL, p_sampling_method));
                        EXIT;
                    ELSE
                        member_ids := cart_ids[chunk_idx + 1 : LEAST(chunk_idx + sample_n, T_count)];
                        grp_seq := grp_seq + 1;
                        groups := groups || jsonb_build_array(qc__assign_test_group(
                            lot_rec.lot_id, grp_seq, member_ids,
                            member_ids[1], false, NULL, p_sampling_method));
                        chunk_idx := chunk_idx + sample_n;
                    END IF;
                END LOOP;
            END LOOP;
        END LOOP;
    END IF;

    -- ── Step 2b: REDRY carts ────────────────────────────────────────────────
    -- Per original group: keep the original champion (single group) ONLY when the
    -- redry carts form ONE 1-hour in_time window AND re-entered ONE dryer; else
    -- re-sample with method_2 PER window.
    IF redry_ids IS NOT NULL THEN
        FOR grp_rec IN
            SELECT sl.production_lot_id,
                   sl.test_group_id AS original_group_id,
                   COALESCE(sku.sample_every_n_carts, 1) AS sample_n,
                   array_agg(sl.id) AS all_ids
            FROM qc_drying_sub_lot sl
            JOIN qc_production_lot lot ON lot.id = sl.production_lot_id
            LEFT JOIN qc_product_sku sku ON sku.id = lot.sku_id
            WHERE sl.id = ANY(redry_ids)
            GROUP BY sl.production_lot_id, sl.test_group_id, sku.sample_every_n_carts
        LOOP
            sample_n := GREATEST(1, grp_rec.sample_n);

            SELECT count(DISTINCT window_idx) INTO n_windows
              FROM qc__intime_windows(grp_rec.all_ids, WINDOW_MIN);
            SELECT count(DISTINCT pre_dryer ->> u::text) INTO n_dryers
              FROM unnest(grp_rec.all_ids) AS u;

            SELECT COALESCE(MAX(group_sequence), 0) INTO grp_seq
              FROM qc_test_group WHERE production_lot_id = grp_rec.production_lot_id;

            IF n_windows = 1 AND n_dryers = 1 THEN
                -- One batch, same dryer → keep the original champion, single group.
                cart_ids := (SELECT array_agg(id ORDER BY sub_lot_code DESC)
                               FROM qc_drying_sub_lot WHERE id = ANY(grp_rec.all_ids));
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
                -- Split by time window (and/or dryer) → re-sample method_2 per window.
                FOR win_rec IN
                    SELECT w.window_idx,
                           array_agg(sl.id ORDER BY sl.sub_lot_code DESC) AS cart_ids
                    FROM qc__intime_windows(grp_rec.all_ids, WINDOW_MIN) w
                    JOIN qc_drying_sub_lot sl ON sl.id = w.cart_id
                    GROUP BY w.window_idx
                    ORDER BY w.window_idx
                LOOP
                    cart_ids := win_rec.cart_ids;
                    T_count  := array_length(cart_ids, 1);
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

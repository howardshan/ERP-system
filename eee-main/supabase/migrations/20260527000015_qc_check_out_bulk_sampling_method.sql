-- Migration M-118: operator-chosen sampling method on bulk check-out.
--
-- Replaces the M-075 (20260523000019) behaviour where carts were chunked in
-- ASCENDING sub_lot_code order and the champion within each chunk was picked
-- randomly. The new behaviour is deterministic and operator-driven:
--
--   • cart_ids are sorted DESCENDING by sub_lot_code (highest cart first),
--     so chunking proceeds from the most recently produced carts down.
--   • A new parameter `p_sampling_method` ∈ {'method_1','method_2'} selects:
--       method_1 — chunk by N; remainder forms its own group; champion =
--                  highest sub_lot_code in each chunk.
--       method_2 — when R := T mod N > 0 AND T > N, do (floor(T/N) - 1)
--                  regular chunks of N (champion = highest), then a single
--                  trailing chunk of (N + R) carts whose champion is the
--                  "middle-large" element: ascending position floor(K/2)+1
--                  (1-indexed) = descending position (K - floor(K/2)) in
--                  our descending member_ids array.
--       Both methods reduce to the same algorithm when R = 0 or T ≤ N.
--
--   • Step 2a (fresh) and Step 2b (redry) use the same logic.
--   • `group_assigned` event payload and the returned `groups` jsonb element
--     gain a `sampling_method` field for audit / analysis.
--   • Default 'method_1' preserves backward compatibility for any caller that
--     omits the new parameter (e.g. the legacy LotDetail.tsx path).
--
-- Mirrored in TypeScript by src/lib/qcSampling.ts (used by the dialog's group
-- preview). Keep both in sync if the algorithm changes.
--
-- Depends on: M-048 (sampling groups), M-075 (bulk fresh/redry classification).
-- Affects: src/services/qcApi.ts, src/pages/qc/components/BulkCheckOutDialog.tsx,
--   src/lib/qcSampling.ts, docs/database/03..., docs/modules/09_qc.md.

CREATE OR REPLACE FUNCTION qc_check_out_sub_lots_bulk(
    p_sub_lot_ids uuid[],
    p_out_time timestamptz DEFAULT NULL,
    p_sampling_method text DEFAULT 'method_1'
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
    R_count int;
    full_chunks int;
    chunk_idx int;
    chunk_size int;
    grp_id uuid;
    grp_seq int;
    champion_id uuid;
    champ_pos int;
    member_ids uuid[];
    fresh_ids uuid[];
    redry_ids uuid[];
    i int;
BEGIN
    IF requested = 0 THEN
      RETURN jsonb_build_object('requested', 0, 'succeeded', succeeded, 'failed', failed, 'groups', groups);
    END IF;

    IF p_sampling_method NOT IN ('method_1', 'method_2') THEN
        RAISE EXCEPTION 'Invalid p_sampling_method: % (expected method_1 or method_2)', p_sampling_method;
    END IF;

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
        SET out_time = out_t,
            status   = 'pending',
            is_test_champion = false,
            location_id  = NULL,
            dryer_number = NULL,
            updated_at   = now()
        WHERE id = sub_id;

        UPDATE qc_sub_lot_spot_history
        SET ended_at = out_t,
            end_reason = 'check_out',
            duration_minutes = EXTRACT(EPOCH FROM (out_t - started_at)) / 60.0
        WHERE drying_sub_lot_id = sub_id AND ended_at IS NULL;

        INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
        VALUES (sub_id, 'check_out',
                jsonb_build_object('out_time', out_t, 'status', 'pending', 'mode', 'bulk'),
                auth.uid());

        succeeded := succeeded || jsonb_build_array(jsonb_build_object(
            'sub_lot_id', sub_id, 'sub_lot_code', s.sub_lot_code));
    END LOOP;

    -- ── Snapshot fresh vs redry BEFORE Step 2a writes anything (M-075 fix) ──
    SELECT array_agg(sl.id ORDER BY sl.sub_lot_code) INTO fresh_ids
      FROM qc_drying_sub_lot sl
      WHERE sl.id = ANY(p_sub_lot_ids)
        AND sl.status   = 'pending'
        AND sl.out_time = out_t
        AND sl.test_group_id IS NULL;

    SELECT array_agg(sl.id ORDER BY sl.sub_lot_code) INTO redry_ids
      FROM qc_drying_sub_lot sl
      WHERE sl.id = ANY(p_sub_lot_ids)
        AND sl.status   = 'pending'
        AND sl.out_time = out_t
        AND sl.test_group_id IS NOT NULL;

    -- ── Step 2a: form sampling groups for FRESH carts ───────────────────────
    -- cart_ids are aggregated DESCENDING (highest sub_lot_code first) so
    -- chunking starts from the most recently produced cart.
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
            T_count := array_length(cart_ids, 1);
            R_count := T_count % sample_n;

            SELECT COALESCE(MAX(group_sequence), 0) INTO grp_seq
              FROM qc_test_group WHERE production_lot_id = grp_rec.production_lot_id;

            IF p_sampling_method = 'method_2' AND T_count > sample_n AND R_count > 0 THEN
                -- Method 2: (full_chunks) regular chunks of N + 1 tail chunk of N+R
                full_chunks := (T_count / sample_n) - 1;

                FOR i IN 0..full_chunks-1 LOOP
                    member_ids := cart_ids[i*sample_n+1 : (i+1)*sample_n];
                    chunk_size := array_length(member_ids, 1);
                    grp_seq := grp_seq + 1;

                    INSERT INTO qc_test_group (production_lot_id, group_sequence, member_count)
                    VALUES (grp_rec.production_lot_id, grp_seq, chunk_size)
                    RETURNING id INTO grp_id;

                    champion_id := member_ids[1];  -- descending first = highest

                    UPDATE qc_drying_sub_lot
                    SET test_group_id    = grp_id,
                        is_test_champion = (id = champion_id),
                        status = CASE WHEN id = champion_id THEN 'pending' ELSE 'awaiting_group_result' END,
                        updated_at = now()
                    WHERE id = ANY(member_ids);

                    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
                    SELECT m_id, 'group_assigned',
                           jsonb_build_object(
                               'test_group_id',    grp_id,
                               'group_sequence',   grp_seq,
                               'is_champion',      m_id = champion_id,
                               'member_count',     chunk_size,
                               'redry',            false,
                               'sampling_method',  p_sampling_method
                           ),
                           auth.uid()
                    FROM unnest(member_ids) AS m_id;

                    groups := groups || jsonb_build_array(jsonb_build_object(
                        'test_group_id',    grp_id,
                        'group_sequence',   grp_seq,
                        'production_lot_id', grp_rec.production_lot_id,
                        'member_count',     chunk_size,
                        'champion_id',      champion_id,
                        'member_ids',       to_jsonb(member_ids),
                        'redry',            false,
                        'sampling_method',  p_sampling_method
                    ));
                END LOOP;

                -- Tail chunk: N + R carts, champion = "middle-large".
                member_ids := cart_ids[full_chunks*sample_n+1 : T_count];
                chunk_size := array_length(member_ids, 1);
                grp_seq := grp_seq + 1;

                INSERT INTO qc_test_group (production_lot_id, group_sequence, member_count)
                VALUES (grp_rec.production_lot_id, grp_seq, chunk_size)
                RETURNING id INTO grp_id;

                -- ascending pos floor(K/2)+1 = descending pos (K - floor(K/2))
                champ_pos := chunk_size - (chunk_size / 2);
                champion_id := member_ids[champ_pos];

                UPDATE qc_drying_sub_lot
                SET test_group_id    = grp_id,
                    is_test_champion = (id = champion_id),
                    status = CASE WHEN id = champion_id THEN 'pending' ELSE 'awaiting_group_result' END,
                    updated_at = now()
                WHERE id = ANY(member_ids);

                INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
                SELECT m_id, 'group_assigned',
                       jsonb_build_object(
                           'test_group_id',    grp_id,
                           'group_sequence',   grp_seq,
                           'is_champion',      m_id = champion_id,
                           'member_count',     chunk_size,
                           'redry',            false,
                           'sampling_method',  p_sampling_method
                       ),
                       auth.uid()
                FROM unnest(member_ids) AS m_id;

                groups := groups || jsonb_build_array(jsonb_build_object(
                    'test_group_id',    grp_id,
                    'group_sequence',   grp_seq,
                    'production_lot_id', grp_rec.production_lot_id,
                    'member_count',     chunk_size,
                    'champion_id',      champion_id,
                    'member_ids',       to_jsonb(member_ids),
                    'redry',            false,
                    'sampling_method',  p_sampling_method
                ));
            ELSE
                -- Method 1, or Method 2 with R=0 / T<=N: chunk by N, remainder solo.
                chunk_idx := 0;
                WHILE chunk_idx < T_count LOOP
                    member_ids := cart_ids[chunk_idx + 1 : LEAST(chunk_idx + sample_n, T_count)];
                    chunk_size := array_length(member_ids, 1);
                    grp_seq := grp_seq + 1;

                    INSERT INTO qc_test_group (production_lot_id, group_sequence, member_count)
                    VALUES (grp_rec.production_lot_id, grp_seq, chunk_size)
                    RETURNING id INTO grp_id;

                    champion_id := member_ids[1];

                    UPDATE qc_drying_sub_lot
                    SET test_group_id    = grp_id,
                        is_test_champion = (id = champion_id),
                        status = CASE WHEN id = champion_id THEN 'pending' ELSE 'awaiting_group_result' END,
                        updated_at = now()
                    WHERE id = ANY(member_ids);

                    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
                    SELECT m_id, 'group_assigned',
                           jsonb_build_object(
                               'test_group_id',    grp_id,
                               'group_sequence',   grp_seq,
                               'is_champion',      m_id = champion_id,
                               'member_count',     chunk_size,
                               'redry',            false,
                               'sampling_method',  p_sampling_method
                           ),
                           auth.uid()
                    FROM unnest(member_ids) AS m_id;

                    groups := groups || jsonb_build_array(jsonb_build_object(
                        'test_group_id',    grp_id,
                        'group_sequence',   grp_seq,
                        'production_lot_id', grp_rec.production_lot_id,
                        'member_count',     chunk_size,
                        'champion_id',      champion_id,
                        'member_ids',       to_jsonb(member_ids),
                        'redry',            false,
                        'sampling_method',  p_sampling_method
                    ));

                    chunk_idx := chunk_idx + sample_n;
                END LOOP;
            END IF;
        END LOOP;
    END IF;

    -- ── Step 2b: re-group REDRY carts (same algorithm) ──────────────────────
    IF redry_ids IS NOT NULL THEN
        FOR grp_rec IN
            SELECT sl.production_lot_id,
                   sl.test_group_id AS original_group_id,
                   COALESCE(sku.sample_every_n_carts, 1) AS sample_n,
                   array_agg(sl.id ORDER BY sl.sub_lot_code DESC) AS cart_ids
            FROM qc_drying_sub_lot sl
            JOIN qc_production_lot lot ON lot.id = sl.production_lot_id
            LEFT JOIN qc_product_sku sku ON sku.id = lot.sku_id
            WHERE sl.id = ANY(redry_ids)
            GROUP BY sl.production_lot_id, sl.test_group_id, sku.sample_every_n_carts
        LOOP
            sample_n := GREATEST(1, grp_rec.sample_n);
            cart_ids := grp_rec.cart_ids;
            T_count := array_length(cart_ids, 1);
            R_count := T_count % sample_n;

            SELECT COALESCE(MAX(group_sequence), 0) INTO grp_seq
              FROM qc_test_group WHERE production_lot_id = grp_rec.production_lot_id;

            IF p_sampling_method = 'method_2' AND T_count > sample_n AND R_count > 0 THEN
                full_chunks := (T_count / sample_n) - 1;

                FOR i IN 0..full_chunks-1 LOOP
                    member_ids := cart_ids[i*sample_n+1 : (i+1)*sample_n];
                    chunk_size := array_length(member_ids, 1);
                    grp_seq := grp_seq + 1;

                    INSERT INTO qc_test_group (production_lot_id, group_sequence, member_count)
                    VALUES (grp_rec.production_lot_id, grp_seq, chunk_size)
                    RETURNING id INTO grp_id;

                    champion_id := member_ids[1];

                    UPDATE qc_drying_sub_lot
                    SET test_group_id    = grp_id,
                        is_test_champion = (id = champion_id),
                        status = CASE WHEN id = champion_id THEN 'pending' ELSE 'awaiting_group_result' END,
                        updated_at = now()
                    WHERE id = ANY(member_ids);

                    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
                    SELECT m_id, 'group_assigned',
                           jsonb_build_object(
                               'test_group_id',       grp_id,
                               'group_sequence',      grp_seq,
                               'is_champion',         m_id = champion_id,
                               'member_count',        chunk_size,
                               'redry',               true,
                               'original_group_id',   grp_rec.original_group_id,
                               'sampling_method',     p_sampling_method
                           ),
                           auth.uid()
                    FROM unnest(member_ids) AS m_id;

                    groups := groups || jsonb_build_array(jsonb_build_object(
                        'test_group_id',     grp_id,
                        'group_sequence',    grp_seq,
                        'production_lot_id', grp_rec.production_lot_id,
                        'member_count',      chunk_size,
                        'champion_id',       champion_id,
                        'member_ids',        to_jsonb(member_ids),
                        'redry',             true,
                        'original_group_id', grp_rec.original_group_id,
                        'sampling_method',   p_sampling_method
                    ));
                END LOOP;

                member_ids := cart_ids[full_chunks*sample_n+1 : T_count];
                chunk_size := array_length(member_ids, 1);
                grp_seq := grp_seq + 1;

                INSERT INTO qc_test_group (production_lot_id, group_sequence, member_count)
                VALUES (grp_rec.production_lot_id, grp_seq, chunk_size)
                RETURNING id INTO grp_id;

                champ_pos := chunk_size - (chunk_size / 2);
                champion_id := member_ids[champ_pos];

                UPDATE qc_drying_sub_lot
                SET test_group_id    = grp_id,
                    is_test_champion = (id = champion_id),
                    status = CASE WHEN id = champion_id THEN 'pending' ELSE 'awaiting_group_result' END,
                    updated_at = now()
                WHERE id = ANY(member_ids);

                INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
                SELECT m_id, 'group_assigned',
                       jsonb_build_object(
                           'test_group_id',       grp_id,
                           'group_sequence',      grp_seq,
                           'is_champion',         m_id = champion_id,
                           'member_count',        chunk_size,
                           'redry',               true,
                           'original_group_id',   grp_rec.original_group_id,
                           'sampling_method',     p_sampling_method
                       ),
                       auth.uid()
                FROM unnest(member_ids) AS m_id;

                groups := groups || jsonb_build_array(jsonb_build_object(
                    'test_group_id',     grp_id,
                    'group_sequence',    grp_seq,
                    'production_lot_id', grp_rec.production_lot_id,
                    'member_count',      chunk_size,
                    'champion_id',       champion_id,
                    'member_ids',        to_jsonb(member_ids),
                    'redry',             true,
                    'original_group_id', grp_rec.original_group_id,
                    'sampling_method',   p_sampling_method
                ));
            ELSE
                chunk_idx := 0;
                WHILE chunk_idx < T_count LOOP
                    member_ids := cart_ids[chunk_idx + 1 : LEAST(chunk_idx + sample_n, T_count)];
                    chunk_size := array_length(member_ids, 1);
                    grp_seq := grp_seq + 1;

                    INSERT INTO qc_test_group (production_lot_id, group_sequence, member_count)
                    VALUES (grp_rec.production_lot_id, grp_seq, chunk_size)
                    RETURNING id INTO grp_id;

                    champion_id := member_ids[1];

                    UPDATE qc_drying_sub_lot
                    SET test_group_id    = grp_id,
                        is_test_champion = (id = champion_id),
                        status = CASE WHEN id = champion_id THEN 'pending' ELSE 'awaiting_group_result' END,
                        updated_at = now()
                    WHERE id = ANY(member_ids);

                    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
                    SELECT m_id, 'group_assigned',
                           jsonb_build_object(
                               'test_group_id',       grp_id,
                               'group_sequence',      grp_seq,
                               'is_champion',         m_id = champion_id,
                               'member_count',        chunk_size,
                               'redry',               true,
                               'original_group_id',   grp_rec.original_group_id,
                               'sampling_method',     p_sampling_method
                           ),
                           auth.uid()
                    FROM unnest(member_ids) AS m_id;

                    groups := groups || jsonb_build_array(jsonb_build_object(
                        'test_group_id',     grp_id,
                        'group_sequence',    grp_seq,
                        'production_lot_id', grp_rec.production_lot_id,
                        'member_count',      chunk_size,
                        'champion_id',       champion_id,
                        'member_ids',        to_jsonb(member_ids),
                        'redry',             true,
                        'original_group_id', grp_rec.original_group_id,
                        'sampling_method',   p_sampling_method
                    ));

                    chunk_idx := chunk_idx + sample_n;
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

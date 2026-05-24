-- M-075: Fix qc_check_out_sub_lots_bulk Step 2a → Step 2b cascade bug.
--
-- Root cause:
--   Step 2a forms sampling groups for FRESH carts (test_group_id IS NULL),
--   then sets siblings to status='awaiting_group_result' while champions stay
--   at status='pending'.  Step 2b's WHERE clause then re-fires on
--   `status='pending' AND test_group_id IS NOT NULL`, which matches the
--   freshly-assigned champions because Step 2a just gave them a test_group_id.
--   Step 2b treats them as redry carts, creates a NEW singleton group per
--   champion, and orphans the original siblings in the now-defunct group.
--
-- Observed effect (W12345-001/003/004/005, sample_every_n_carts=3):
--   Step 2a:  [001,003,004] → group d207adf6 (champion=004); [005] → solo
--   Step 2b:  pulls champion 004 into new group 7724ef98 (member=1); pulls
--             005 into new group 84c81573 (member=1).
--             001 + 003 left orphaned in d207adf6 in 'awaiting_group_result'.
--   Inspection on 004 PASS → propagation sees no siblings in 7724ef98 →
--   group_members_propagated=0, 001/003 stuck forever.
--
-- Fix:
--   Snapshot the fresh/redry classification BEFORE Step 2a runs, then
--   restrict Step 2a to the captured `fresh_ids` and Step 2b to `redry_ids`.
--   No reliance on the post-Step-2a `status='pending'` filter for separation.
--
-- Note: This only fixes future check-outs.  Existing orphaned siblings must
-- be repaired with a one-off UPDATE (see ops note below the function).

CREATE OR REPLACE FUNCTION qc_check_out_sub_lots_bulk(
    p_sub_lot_ids uuid[],
    p_out_time timestamptz DEFAULT NULL
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
    chunk_idx int;
    chunk_size int;
    grp_id uuid;
    grp_seq int;
    champion_id uuid;
    member_ids uuid[];
    fresh_ids uuid[];
    redry_ids uuid[];
BEGIN
    IF requested = 0 THEN
      RETURN jsonb_build_object('requested', 0, 'succeeded', succeeded, 'failed', failed, 'groups', groups);
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
            -- Clear champion flag; will be re-assigned in Step 2a/2b
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

    -- ── Snapshot fresh vs redry BEFORE Step 2a writes anything ──────────────
    -- This is the bug fix: classification must be frozen here, otherwise
    -- Step 2a's UPDATE makes fresh carts look like redry carts to Step 2b.
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
    IF fresh_ids IS NOT NULL THEN
        FOR grp_rec IN
            SELECT sl.production_lot_id,
                   COALESCE(sku.sample_every_n_carts, 1) AS sample_n,
                   array_agg(sl.id ORDER BY sl.sub_lot_code) AS cart_ids
            FROM qc_drying_sub_lot sl
            JOIN qc_production_lot lot ON lot.id = sl.production_lot_id
            LEFT JOIN qc_product_sku sku ON sku.id = lot.sku_id
            WHERE sl.id = ANY(fresh_ids)
            GROUP BY sl.production_lot_id, sku.sample_every_n_carts
        LOOP
            sample_n := GREATEST(1, grp_rec.sample_n);

            SELECT COALESCE(MAX(group_sequence), 0) INTO grp_seq
              FROM qc_test_group WHERE production_lot_id = grp_rec.production_lot_id;

            chunk_idx := 0;
            WHILE chunk_idx < array_length(grp_rec.cart_ids, 1) LOOP
                member_ids := grp_rec.cart_ids[
                    chunk_idx + 1
                    : LEAST(chunk_idx + sample_n, array_length(grp_rec.cart_ids, 1))
                ];
                chunk_size := array_length(member_ids, 1);
                grp_seq := grp_seq + 1;

                INSERT INTO qc_test_group (production_lot_id, group_sequence, member_count)
                VALUES (grp_rec.production_lot_id, grp_seq, chunk_size)
                RETURNING id INTO grp_id;

                champion_id := member_ids[1 + floor(random() * chunk_size)::int];

                UPDATE qc_drying_sub_lot
                SET test_group_id    = grp_id,
                    is_test_champion = (id = champion_id),
                    status = CASE WHEN id = champion_id THEN 'pending' ELSE 'awaiting_group_result' END,
                    updated_at = now()
                WHERE id = ANY(member_ids);

                INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
                SELECT m_id, 'group_assigned',
                       jsonb_build_object(
                           'test_group_id', grp_id,
                           'group_sequence', grp_seq,
                           'is_champion', m_id = champion_id,
                           'member_count', chunk_size,
                           'redry', false
                       ),
                       auth.uid()
                FROM unnest(member_ids) AS m_id;

                groups := groups || jsonb_build_array(jsonb_build_object(
                    'test_group_id', grp_id,
                    'group_sequence', grp_seq,
                    'production_lot_id', grp_rec.production_lot_id,
                    'member_count', chunk_size,
                    'champion_id', champion_id,
                    'member_ids', to_jsonb(member_ids),
                    'redry', false
                ));

                chunk_idx := chunk_idx + sample_n;
            END LOOP;
        END LOOP;
    END IF;

    -- ── Step 2b: re-group REDRY carts ───────────────────────────────────────
    -- Same logic as before, but restricted to the snapshot taken before Step
    -- 2a so the freshly-assigned champions are NOT incorrectly pulled in.
    IF redry_ids IS NOT NULL THEN
        FOR grp_rec IN
            SELECT sl.production_lot_id,
                   sl.test_group_id AS original_group_id,
                   COALESCE(sku.sample_every_n_carts, 1) AS sample_n,
                   array_agg(sl.id ORDER BY sl.sub_lot_code) AS cart_ids
            FROM qc_drying_sub_lot sl
            JOIN qc_production_lot lot ON lot.id = sl.production_lot_id
            LEFT JOIN qc_product_sku sku ON sku.id = lot.sku_id
            WHERE sl.id = ANY(redry_ids)
            GROUP BY sl.production_lot_id, sl.test_group_id, sku.sample_every_n_carts
        LOOP
            sample_n := GREATEST(1, grp_rec.sample_n);

            SELECT COALESCE(MAX(group_sequence), 0) INTO grp_seq
              FROM qc_test_group WHERE production_lot_id = grp_rec.production_lot_id;

            chunk_idx := 0;
            WHILE chunk_idx < array_length(grp_rec.cart_ids, 1) LOOP
                member_ids := grp_rec.cart_ids[
                    chunk_idx + 1
                    : LEAST(chunk_idx + sample_n, array_length(grp_rec.cart_ids, 1))
                ];
                chunk_size := array_length(member_ids, 1);
                grp_seq := grp_seq + 1;

                INSERT INTO qc_test_group (production_lot_id, group_sequence, member_count)
                VALUES (grp_rec.production_lot_id, grp_seq, chunk_size)
                RETURNING id INTO grp_id;

                champion_id := member_ids[1 + floor(random() * chunk_size)::int];

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
                           'original_group_id',   grp_rec.original_group_id
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
                    'original_group_id', grp_rec.original_group_id
                ));

                chunk_idx := chunk_idx + sample_n;
            END LOOP;
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

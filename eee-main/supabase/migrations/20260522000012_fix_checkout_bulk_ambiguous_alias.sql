-- Migration M-054: Fix "column reference s.production_lot_id is ambiguous" in
-- qc_check_out_sub_lots_bulk.
--
-- Root cause: DECLARE block has `s qc_drying_sub_lot%ROWTYPE` as a PL/pgSQL
-- variable. Step 2 embeds a SELECT that also uses `s` as the SQL table alias
-- for qc_drying_sub_lot. PostgreSQL cannot disambiguate them.
-- Fix: rename the SQL alias in that query from `s` to `sl`.

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
BEGIN
    IF requested = 0 THEN
      RETURN jsonb_build_object('requested', 0, 'succeeded', succeeded, 'failed', failed, 'groups', groups);
    END IF;

    -- Step 1: check out each cart (skip ineligible)
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
            status = 'pending',
            location_id = NULL,
            dryer_number = NULL,
            updated_at = now()
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

    -- Step 2: form sampling groups per (production_lot_id, sku.sample_every_n_carts)
    -- NOTE: alias renamed from 's' to 'sl' to avoid ambiguity with the PL/pgSQL
    -- variable `s qc_drying_sub_lot%ROWTYPE` declared above.
    FOR grp_rec IN
        SELECT sl.production_lot_id,
               COALESCE(sku.sample_every_n_carts, 1) AS sample_n,
               array_agg(sl.id ORDER BY sl.created_at) AS cart_ids
        FROM qc_drying_sub_lot sl
        JOIN qc_production_lot lot ON lot.id = sl.production_lot_id
        LEFT JOIN qc_product_sku sku ON sku.id = lot.sku_id
        WHERE sl.id = ANY(p_sub_lot_ids)
          AND sl.status = 'pending'
          AND sl.out_time = out_t
          AND sl.test_group_id IS NULL
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

            -- random champion
            champion_id := member_ids[1 + floor(random() * chunk_size)::int];

            UPDATE qc_drying_sub_lot
            SET test_group_id = grp_id,
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
                       'member_count', chunk_size
                   ),
                   auth.uid()
            FROM unnest(member_ids) AS m_id;

            groups := groups || jsonb_build_array(jsonb_build_object(
                'test_group_id', grp_id,
                'group_sequence', grp_seq,
                'production_lot_id', grp_rec.production_lot_id,
                'member_count', chunk_size,
                'champion_id', champion_id,
                'member_ids', to_jsonb(member_ids)
            ));

            chunk_idx := chunk_idx + sample_n;
        END LOOP;
    END LOOP;

    RETURN jsonb_build_object(
        'requested', requested,
        'succeeded', succeeded,
        'failed', failed,
        'groups', groups
    );
END;
$$;

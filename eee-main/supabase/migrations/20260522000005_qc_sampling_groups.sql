-- Migration M-048: Sampling groups, champion-based testing, bulk check-out
--
-- Each SKU has a sampling rate N (sample_every_n_carts). When carts check
-- out from a dryer in bulk, they're grouped by work order (production_lot)
-- and sub-divided into chunks of size N (last chunk may be smaller — "roundup").
-- For each chunk, one random cart is the "champion" whose sample is tested;
-- the others wait in `awaiting_group_result` until the result is known:
--   PASS → every member of the group → 'passed'
--   FAIL → only the champion goes to 'hold' (normal disposition flow);
--          if disposition='retest', a new champion is auto-promoted from the
--          remaining group members.
--
-- Backwards compatible: SKU.sample_every_n_carts defaults to 1, so existing
-- behavior (every cart tested) is preserved until the operator sets a higher N.

-- ── 1) Sampling rate on SKU ─────────────────────────────────────────────────

ALTER TABLE qc_product_sku
  ADD COLUMN IF NOT EXISTS sample_every_n_carts int NOT NULL DEFAULT 1
    CHECK (sample_every_n_carts >= 1);

COMMENT ON COLUMN qc_product_sku.sample_every_n_carts IS
  'Sampling rate: 1 sample per N carts (rounded up for the trailing partial chunk). Default 1 means every cart is sampled.';

-- ── 2) qc_test_group ────────────────────────────────────────────────────────

CREATE TABLE qc_test_group (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_lot_id   uuid NOT NULL REFERENCES qc_production_lot(id) ON DELETE CASCADE,
  group_sequence      int NOT NULL,
  member_count        int NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'sampling'
    CHECK (status IN ('sampling', 'passed', 'closed_failed')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  resolved_at         timestamptz,
  UNIQUE (production_lot_id, group_sequence)
);
CREATE INDEX idx_qc_test_group_lot ON qc_test_group(production_lot_id);
CREATE INDEX idx_qc_test_group_status ON qc_test_group(status);

ALTER TABLE qc_test_group ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dev_all" ON qc_test_group FOR ALL USING (true) WITH CHECK (true);

-- ── 3) qc_drying_sub_lot: group + champion + new status ─────────────────────

ALTER TABLE qc_drying_sub_lot
  ADD COLUMN IF NOT EXISTS test_group_id     uuid REFERENCES qc_test_group(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_test_champion  boolean NOT NULL DEFAULT false;

ALTER TABLE qc_drying_sub_lot DROP CONSTRAINT IF EXISTS qc_drying_sub_lot_status_check;
ALTER TABLE qc_drying_sub_lot ADD CONSTRAINT qc_drying_sub_lot_status_check
  CHECK (status IN (
    'created', 'drying', 'awaiting_recheck', 'room_temp_drying',
    'pending', 'inspecting', 'passed', 'hold', 'disposing', 'closed',
    'awaiting_group_result'
  ));

-- ── 4) qc_sub_lot_to_json: surface test_group + champion fields ─────────────

CREATE OR REPLACE FUNCTION qc_sub_lot_to_json(p_sub_lot_id uuid, p_include_hold_detail boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
    s qc_drying_sub_lot%ROWTYPE;
    loc qc_drying_location%ROWTYPE;
    lot qc_production_lot%ROWTYPE;
    sku qc_product_sku%ROWTYPE;
    tmpl qc_inspection_template%ROWTYPE;
    rec qc_inspection_record%ROWTYPE;
    pending_sample qc_sample%ROWTYPE;
    grp qc_test_group%ROWTYPE;
    wait_minutes numeric := NULL;
    eta timestamptz := NULL;
    total_dried numeric;
    remaining_min numeric := NULL;
    aw_val numeric;
    effective_dryer int;
    result jsonb;
BEGIN
    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id;
    IF NOT FOUND THEN RETURN NULL; END IF;

    SELECT * INTO loc FROM qc_drying_location WHERE id = s.location_id;
    SELECT * INTO lot FROM qc_production_lot WHERE id = s.production_lot_id;
    IF FOUND THEN SELECT * INTO sku FROM qc_product_sku WHERE id = lot.sku_id; END IF;
    SELECT * INTO grp FROM qc_test_group WHERE id = s.test_group_id;

    IF s.out_time IS NOT NULL AND s.status = 'pending' THEN
        wait_minutes := ROUND(EXTRACT(EPOCH FROM (now() - s.out_time)) / 60.0, 1);
    END IF;

    total_dried := qc_total_dried_minutes(s.id);
    IF s.expected_dry_minutes IS NOT NULL THEN
      remaining_min := s.expected_dry_minutes - total_dried;
      IF s.status = 'drying' THEN
        eta := now() + (remaining_min * interval '1 minute');
      END IF;
    END IF;

    SELECT * INTO pending_sample FROM qc_sample
    WHERE drying_sub_lot_id = s.id AND status = 'pending'
    ORDER BY taken_at DESC LIMIT 1;

    effective_dryer := COALESCE(s.dryer_number, loc.dryer_number);

    result := jsonb_build_object(
        'id', s.id,
        'production_lot_id', s.production_lot_id,
        'sub_lot_code', s.sub_lot_code,
        'location_id', s.location_id,
        'location_name', loc.display_name,
        'dryer_number', effective_dryer,
        'cell_number', loc.cell_number,
        'in_time', s.in_time,
        'out_time', s.out_time,
        'status', s.status,
        'expected_dry_minutes', s.expected_dry_minutes,
        'expected_finish_at', eta,
        'total_dried_minutes', total_dried,
        'remaining_minutes', remaining_min,
        'lot_barcode', lot.lot_barcode,
        'lot_number', lot.lot_number,
        'sku_id', lot.sku_id,
        'sku_code', sku.code,
        'sku_name', sku.name,
        'sample_every_n_carts', sku.sample_every_n_carts,
        'wait_minutes', wait_minutes,
        'has_pending_sample', pending_sample.id IS NOT NULL,
        'latest_pending_sample_id', pending_sample.sample_id,
        'latest_pending_sample_pk', pending_sample.id,
        'test_group_id', s.test_group_id,
        'test_group_sequence', grp.group_sequence,
        'test_group_status', grp.status,
        'test_group_member_count', grp.member_count,
        'is_test_champion', s.is_test_champion,
        'hold_reason', NULL,
        'hold_aw', NULL,
        'hold_item_name', NULL,
        'hold_lower_limit', NULL,
        'hold_upper_limit', NULL,
        'hold_inspected_at', NULL
    );

    IF p_include_hold_detail AND s.status = 'hold' THEN
        SELECT * INTO rec FROM qc_inspection_record
        WHERE drying_sub_lot_id = s.id AND result = 'fail'
        ORDER BY submitted_at DESC LIMIT 1;

        IF FOUND THEN
            aw_val := NULLIF(rec.values_json->>'aw', '')::numeric;
            SELECT * INTO tmpl FROM qc_inspection_template WHERE sku_id = lot.sku_id LIMIT 1;

            result := result || jsonb_build_object(
                'hold_inspected_at', rec.submitted_at,
                'hold_aw', aw_val,
                'hold_item_name', COALESCE(tmpl.item_name, 'Water Activity (Aw)'),
                'hold_lower_limit', tmpl.lower_limit,
                'hold_upper_limit', tmpl.upper_limit,
                'hold_reason', CASE
                    WHEN tmpl.lower_limit IS NOT NULL AND tmpl.upper_limit IS NOT NULL AND aw_val IS NOT NULL THEN
                        qc_format_fail_reason(aw_val, tmpl.lower_limit, tmpl.upper_limit, tmpl.item_name)
                    WHEN aw_val IS NOT NULL THEN
                        'Inspection failed (Water Activity (Aw) ' || aw_val || ')'
                    ELSE
                        'Inspection failed (reading missing)'
                END
            );
        ELSE
            result := result || jsonb_build_object('hold_reason', 'Inspection failed (no inspection record)');
        END IF;
    END IF;

    RETURN result;
END;
$$;

-- ── 5) Bulk check-out + sampling group assignment ───────────────────────────

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
    FOR grp_rec IN
        SELECT s.production_lot_id,
               COALESCE(sku.sample_every_n_carts, 1) AS sample_n,
               array_agg(s.id ORDER BY s.created_at) AS cart_ids
        FROM qc_drying_sub_lot s
        JOIN qc_production_lot lot ON lot.id = s.production_lot_id
        LEFT JOIN qc_product_sku sku ON sku.id = lot.sku_id
        WHERE s.id = ANY(p_sub_lot_ids)
          AND s.status = 'pending'
          AND s.out_time = out_t
          AND s.test_group_id IS NULL
        GROUP BY s.production_lot_id, sku.sample_every_n_carts
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

-- ── 6) qc_submit_inspection: propagate champion PASS to whole group ─────────

CREATE OR REPLACE FUNCTION qc_submit_inspection(
    p_sub_lot_id uuid,
    p_aw numeric,
    p_sample_pk uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    s qc_drying_sub_lot%ROWTYPE;
    lot qc_production_lot%ROWTYPE;
    tmpl qc_inspection_template%ROWTYPE;
    judged text;
    new_status text;
    event_type text;
    rec_id uuid;
    sample qc_sample%ROWTYPE;
    propagated_count int := 0;
BEGIN
    IF p_aw IS NULL OR p_aw < 0 OR p_aw > 2 THEN
        RAISE EXCEPTION 'Invalid Aw value: %', p_aw;
    END IF;

    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sub-lot not found'; END IF;

    IF p_sample_pk IS NOT NULL THEN
      SELECT * INTO sample FROM qc_sample WHERE id = p_sample_pk FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Sample not found'; END IF;
      IF sample.drying_sub_lot_id <> p_sub_lot_id THEN
        RAISE EXCEPTION 'Sample does not belong to this sub-lot';
      END IF;
      IF sample.status <> 'pending' THEN
        RAISE EXCEPTION 'Sample is already % — take a new sample to re-test', sample.status;
      END IF;
    END IF;

    IF s.status = 'pending' THEN
        UPDATE qc_drying_sub_lot SET status = 'inspecting', updated_at = now() WHERE id = p_sub_lot_id;
        s.status := 'inspecting';
    END IF;

    IF s.status <> 'inspecting' THEN
        RAISE EXCEPTION 'Sub-lot not inspectable (status=%)', s.status;
    END IF;

    SELECT * INTO lot FROM qc_production_lot WHERE id = s.production_lot_id;
    SELECT * INTO tmpl FROM qc_inspection_template WHERE sku_id = lot.sku_id LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'No inspection template for SKU'; END IF;

    judged := CASE WHEN p_aw >= tmpl.lower_limit AND p_aw <= tmpl.upper_limit THEN 'pass' ELSE 'fail' END;

    INSERT INTO qc_inspection_record (drying_sub_lot_id, inspector_auth_id, values_json, result, sample_id)
    VALUES (p_sub_lot_id, auth.uid(), jsonb_build_object('aw', p_aw), judged, p_sample_pk)
    RETURNING id INTO rec_id;

    IF p_sample_pk IS NOT NULL THEN
      UPDATE qc_sample SET status = 'inspected', inspection_record_id = rec_id
      WHERE id = p_sample_pk;
    END IF;

    IF judged = 'pass' THEN
        new_status := 'passed';
        event_type := 'inspection_passed';
    ELSE
        new_status := 'hold';
        event_type := 'inspection_failed_hold';
    END IF;

    UPDATE qc_drying_sub_lot SET status = new_status, updated_at = now() WHERE id = p_sub_lot_id;

    -- Champion propagation: if PASS and this cart is a champion of a sampling group,
    -- every awaiting_group_result sibling is released to 'passed'.
    IF judged = 'pass' AND s.is_test_champion AND s.test_group_id IS NOT NULL THEN
        UPDATE qc_drying_sub_lot
        SET status = 'passed', updated_at = now()
        WHERE test_group_id = s.test_group_id
          AND id <> p_sub_lot_id
          AND status = 'awaiting_group_result';
        GET DIAGNOSTICS propagated_count = ROW_COUNT;

        UPDATE qc_test_group
        SET status = 'passed', resolved_at = now()
        WHERE id = s.test_group_id;

        INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
        SELECT id, 'group_passed_by_champion',
               jsonb_build_object('test_group_id', s.test_group_id, 'champion_id', s.id),
               auth.uid()
        FROM qc_drying_sub_lot
        WHERE test_group_id = s.test_group_id AND id <> s.id AND status = 'passed';
    END IF;

    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    VALUES (p_sub_lot_id, event_type,
            jsonb_build_object(
              'aw', p_aw, 'result', judged,
              'limits', jsonb_build_array(tmpl.lower_limit, tmpl.upper_limit),
              'sample_pk', p_sample_pk,
              'sample_id', sample.sample_id,
              'is_test_champion', s.is_test_champion,
              'group_members_propagated', propagated_count
            ),
            auth.uid());

    RETURN jsonb_build_object(
        'id', rec_id,
        'drying_sub_lot_id', p_sub_lot_id,
        'result', judged,
        'values_json', jsonb_build_object('aw', p_aw),
        'submitted_at', now(),
        'new_status', new_status,
        'sample_pk', p_sample_pk,
        'group_members_propagated', propagated_count
    );
END;
$$;

-- ── 7) qc_create_disposition: 'retest' on a champion in a sampling group
--      auto-promotes the next champion from remaining group members ──────────

CREATE OR REPLACE FUNCTION qc_create_disposition(
    p_sub_lot_id uuid,
    p_type text,
    p_remark text DEFAULT NULL,
    p_redry_expected_dry_minutes int DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    s qc_drying_sub_lot%ROWTYPE;
    new_id uuid;
    next_status text;
    new_champion_id uuid;
    group_member_status text := 'awaiting_group_result';
BEGIN
    IF p_type NOT IN ('rework', 'grind', 'scrap', 'concession',
                      'redry_dryer', 'room_temp_dry', 'retest') THEN
        RAISE EXCEPTION 'Invalid disposition type: %', p_type;
    END IF;
    IF p_type = 'redry_dryer' AND (p_redry_expected_dry_minutes IS NULL OR p_redry_expected_dry_minutes <= 0) THEN
        RAISE EXCEPTION 'redry_dryer requires a positive redry_expected_dry_minutes';
    END IF;

    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sub-lot not found'; END IF;

    IF s.status = 'hold' THEN
        UPDATE qc_drying_sub_lot SET status = 'disposing', updated_at = now() WHERE id = p_sub_lot_id;
        s.status := 'disposing';
    END IF;
    IF s.status <> 'disposing' THEN
        RAISE EXCEPTION 'Sub-lot not in disposition flow (status=%)', s.status;
    END IF;

    INSERT INTO qc_disposition (drying_sub_lot_id, type, remark, operator_auth_id, redry_expected_dry_minutes)
    VALUES (p_sub_lot_id, p_type, p_remark, auth.uid(), p_redry_expected_dry_minutes)
    RETURNING id INTO new_id;

    IF p_type = 'redry_dryer' THEN
        next_status := 'awaiting_recheck';
        UPDATE qc_drying_sub_lot
        SET status = 'awaiting_recheck',
            expected_dry_minutes = p_redry_expected_dry_minutes,
            in_time = NULL,
            updated_at = now()
        WHERE id = p_sub_lot_id;
    ELSIF p_type = 'room_temp_dry' THEN
        next_status := 'room_temp_drying';
        UPDATE qc_drying_sub_lot
        SET status = 'room_temp_drying', updated_at = now()
        WHERE id = p_sub_lot_id;
        INSERT INTO qc_room_temp_dry_session (drying_sub_lot_id, disposition_id, started_by_auth_id)
        VALUES (p_sub_lot_id, new_id, auth.uid());
    ELSIF p_type = 'retest' THEN
        -- Two flavors:
        --   (a) Individual retest (no group, or group has only this one cart): cart goes back to 'pending'
        --   (b) Group retest (failed champion in a multi-cart group): close failed champion,
        --       auto-promote next random group member as new champion.
        IF s.is_test_champion AND s.test_group_id IS NOT NULL THEN
            -- Group retest path
            UPDATE qc_drying_sub_lot
            SET is_test_champion = false, status = 'closed', updated_at = now()
            WHERE id = p_sub_lot_id;

            SELECT id INTO new_champion_id
            FROM qc_drying_sub_lot
            WHERE test_group_id = s.test_group_id
              AND status = 'awaiting_group_result'
            ORDER BY random()
            LIMIT 1;

            IF new_champion_id IS NULL THEN
                -- No siblings left → group closes as failed
                UPDATE qc_test_group SET status = 'closed_failed', resolved_at = now()
                WHERE id = s.test_group_id;
                next_status := 'closed';
            ELSE
                UPDATE qc_drying_sub_lot
                SET is_test_champion = true,
                    status = 'pending',
                    updated_at = now()
                WHERE id = new_champion_id;

                INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
                VALUES (new_champion_id, 'champion_promoted',
                        jsonb_build_object(
                          'test_group_id', s.test_group_id,
                          'previous_champion_id', s.id
                        ),
                        auth.uid());

                next_status := 'closed';
            END IF;
        ELSE
            -- Individual retest
            next_status := 'pending';
            UPDATE qc_drying_sub_lot
            SET status = 'pending', updated_at = now()
            WHERE id = p_sub_lot_id;
        END IF;
    ELSE
        -- scrap / concession / rework / grind — terminal disposal
        next_status := 'closed';
        UPDATE qc_drying_sub_lot SET status = 'closed', updated_at = now() WHERE id = p_sub_lot_id;
    END IF;

    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    VALUES (p_sub_lot_id, 'disposition_completed',
            jsonb_build_object(
              'type', p_type,
              'remark', p_remark,
              'redry_expected_dry_minutes', p_redry_expected_dry_minutes,
              'next_status', next_status,
              'was_champion', s.is_test_champion,
              'new_champion_id', new_champion_id
            ),
            auth.uid());

    RETURN jsonb_build_object(
        'id', new_id,
        'drying_sub_lot_id', p_sub_lot_id,
        'type', p_type,
        'remark', p_remark,
        'redry_expected_dry_minutes', p_redry_expected_dry_minutes,
        'created_at', now(),
        'new_status', next_status,
        'new_champion_id', new_champion_id
    );
END;
$$;

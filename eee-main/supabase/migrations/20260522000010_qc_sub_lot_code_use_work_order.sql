-- Migration M-053: sub_lot_code prefix uses work_order_barcode instead of lot_barcode.
--
-- The user wants new sub-lots formatted as <work_order>-001 (not
-- <lot_barcode>-001). Existing sub-lots stay as-is for data integrity; only
-- newly created sub-lots (via qc_create_production_lot_with_sub_lots or
-- qc_add_sub_lots_to_lot) use the new prefix.

CREATE OR REPLACE FUNCTION qc_create_production_lot_with_sub_lots(
    p_lot_number text,
    p_lot_barcode text,
    p_work_order_barcode text,
    p_sku_id uuid,
    p_expected_dry_minutes int,
    p_sub_lot_start_seq int DEFAULT 1,
    p_sub_lot_end_seq int DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    new_lot_id uuid;
    i int;
    code text;
    ids uuid[] := ARRAY[]::uuid[];
    new_sl_id uuid;
    sub_count int;
BEGIN
    IF p_expected_dry_minutes IS NULL OR p_expected_dry_minutes <= 0 THEN
        RAISE EXCEPTION 'expected_dry_minutes must be > 0 (BR-Q29)';
    END IF;
    IF p_sub_lot_end_seq IS NULL OR p_sub_lot_end_seq < p_sub_lot_start_seq THEN
        RAISE EXCEPTION 'sub_lot_end_seq must be >= sub_lot_start_seq';
    END IF;
    IF p_sub_lot_start_seq < 1 THEN
        RAISE EXCEPTION 'sub_lot_start_seq must be >= 1';
    END IF;

    INSERT INTO qc_production_lot
        (lot_number, lot_barcode, work_order_barcode, sku_id, expected_dry_minutes)
    VALUES
        (p_lot_number, p_lot_barcode, p_work_order_barcode, p_sku_id, p_expected_dry_minutes)
    RETURNING id INTO new_lot_id;

    FOR i IN p_sub_lot_start_seq..p_sub_lot_end_seq LOOP
        code := p_work_order_barcode || '-' || LPAD(i::text, 3, '0');
        IF EXISTS (SELECT 1 FROM qc_drying_sub_lot WHERE sub_lot_code = code) THEN
            RAISE EXCEPTION 'Sub-lot code already exists: %', code;
        END IF;
        INSERT INTO qc_drying_sub_lot
            (production_lot_id, sub_lot_code, status, expected_dry_minutes)
        VALUES
            (new_lot_id, code, 'created', p_expected_dry_minutes)
        RETURNING id INTO new_sl_id;
        ids := ids || new_sl_id;

        INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
        VALUES (new_sl_id, 'sub_lot_created',
                jsonb_build_object('sub_lot_code', code,
                                   'seq', i,
                                   'expected_dry_minutes', p_expected_dry_minutes),
                auth.uid());
    END LOOP;

    sub_count := COALESCE(array_length(ids, 1), 0);

    RETURN jsonb_build_object(
        'lot_id', new_lot_id,
        'lot_number', p_lot_number,
        'lot_barcode', p_lot_barcode,
        'expected_dry_minutes', p_expected_dry_minutes,
        'sub_lot_count', sub_count,
        'sub_lot_ids', to_jsonb(ids)
    );
END;
$$;

CREATE OR REPLACE FUNCTION qc_add_sub_lots_to_lot(
    p_production_lot_id uuid,
    p_start_seq int DEFAULT NULL,
    p_end_seq int DEFAULT NULL,
    p_count int DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    lot qc_production_lot%ROWTYPE;
    existing_max int;
    start_n int;
    end_n int;
    i int;
    code text;
    new_id uuid;
    ids uuid[] := ARRAY[]::uuid[];
BEGIN
    SELECT * INTO lot FROM qc_production_lot WHERE id = p_production_lot_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Production lot not found'; END IF;

    -- Highest existing 3-digit suffix among <prefix>-NNN codes (in this lot)
    SELECT COALESCE(MAX(NULLIF(regexp_replace(sub_lot_code, '^.*-(\d{3})$', '\1'), '')::int), 0)
    INTO existing_max
    FROM qc_drying_sub_lot
    WHERE production_lot_id = p_production_lot_id
      AND sub_lot_code ~ '-\d{3}$';

    start_n := COALESCE(p_start_seq, existing_max + 1);
    IF p_end_seq IS NOT NULL THEN
        end_n := p_end_seq;
    ELSIF p_count IS NOT NULL THEN
        end_n := start_n + p_count - 1;
    ELSE
        RAISE EXCEPTION 'Either p_end_seq or p_count is required';
    END IF;

    IF end_n < start_n THEN RAISE EXCEPTION 'end_seq must be >= start_seq'; END IF;

    FOR i IN start_n..end_n LOOP
        code := lot.work_order_barcode || '-' || LPAD(i::text, 3, '0');
        IF EXISTS (SELECT 1 FROM qc_drying_sub_lot WHERE sub_lot_code = code) THEN
            RAISE EXCEPTION 'Sub-lot code already exists: %', code;
        END IF;
        INSERT INTO qc_drying_sub_lot
            (production_lot_id, sub_lot_code, status, expected_dry_minutes)
        VALUES
            (p_production_lot_id, code, 'created', lot.expected_dry_minutes)
        RETURNING id INTO new_id;
        ids := ids || new_id;

        INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
        VALUES (new_id, 'sub_lot_created',
                jsonb_build_object('sub_lot_code', code,
                                   'seq', i,
                                   'added_to_existing_lot', true,
                                   'expected_dry_minutes', lot.expected_dry_minutes),
                auth.uid());
    END LOOP;

    RETURN jsonb_build_object(
        'added_count', COALESCE(array_length(ids, 1), 0),
        'start_seq', start_n,
        'end_seq', end_n,
        'sub_lot_ids', to_jsonb(ids)
    );
END;
$$;

-- Expose work_order_barcode in qc_sub_lot_to_json so the UI can use it.
CREATE OR REPLACE FUNCTION qc_sub_lot_to_json(p_sub_lot_id uuid, p_include_hold_detail boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
    s qc_drying_sub_lot%ROWTYPE;
    lot qc_production_lot%ROWTYPE;
    sku qc_product_sku%ROWTYPE;
    loc qc_drying_location%ROWTYPE;
    base_in_time timestamptz;
    total_dried int;
    remaining_min int;
    expected_finish timestamptz;
    wait_min int;
    out_json jsonb;
    grp qc_test_group%ROWTYPE;
    has_grp boolean := false;
    hold_part jsonb := '{}'::jsonb;
    last_disp record;
BEGIN
    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT * INTO lot FROM qc_production_lot WHERE id = s.production_lot_id;
    SELECT * INTO sku FROM qc_product_sku WHERE id = lot.sku_id;
    IF s.location_id IS NOT NULL THEN
      SELECT * INTO loc FROM qc_drying_location WHERE id = s.location_id;
    END IF;
    IF s.test_group_id IS NOT NULL THEN
      SELECT * INTO grp FROM qc_test_group WHERE id = s.test_group_id;
      has_grp := FOUND;
    END IF;

    base_in_time := s.in_time;
    total_dried := CASE
      WHEN s.in_time IS NULL THEN NULL
      WHEN s.out_time IS NULL THEN EXTRACT(EPOCH FROM (now() - s.in_time))::int / 60
      ELSE EXTRACT(EPOCH FROM (s.out_time - s.in_time))::int / 60
    END;

    IF s.expected_dry_minutes IS NOT NULL THEN
      remaining_min := s.expected_dry_minutes - total_dried;
      expected_finish := s.in_time + (s.expected_dry_minutes * interval '1 minute');
    END IF;

    IF s.out_time IS NOT NULL AND s.status IN ('pending','inspecting','hold') THEN
      wait_min := EXTRACT(EPOCH FROM (now() - s.out_time))::int / 60;
    END IF;

    out_json := jsonb_build_object(
        'id', s.id,
        'production_lot_id', s.production_lot_id,
        'sub_lot_code', s.sub_lot_code,
        'location_id', s.location_id,
        'location_name', loc.display_name,
        'dryer_number', COALESCE(s.dryer_number, loc.dryer_number),
        'cell_number', loc.cell_number,
        'in_time', s.in_time,
        'out_time', s.out_time,
        'status', s.status,
        'expected_dry_minutes', s.expected_dry_minutes,
        'expected_finish_at', expected_finish,
        'total_dried_minutes', total_dried,
        'remaining_minutes', remaining_min,
        'lot_number', lot.lot_number,
        'lot_barcode', lot.lot_barcode,
        'work_order_barcode', lot.work_order_barcode,
        'sku_id', lot.sku_id,
        'sku_code', sku.code,
        'sku_name', sku.name,
        'sample_every_n_carts', sku.sample_every_n_carts,
        'test_group_id', s.test_group_id,
        'test_group_sequence', CASE WHEN has_grp THEN grp.group_sequence END,
        'test_group_status', CASE WHEN has_grp THEN grp.status END,
        'test_group_member_count', CASE WHEN has_grp THEN grp.member_count END,
        'is_test_champion', s.is_test_champion,
        'wait_minutes', wait_min,
        'has_pending_sample', EXISTS(SELECT 1 FROM qc_sample sa WHERE sa.drying_sub_lot_id = s.id AND sa.status = 'pending'),
        'latest_pending_sample_id', (SELECT sa.sample_id FROM qc_sample sa WHERE sa.drying_sub_lot_id = s.id AND sa.status = 'pending' ORDER BY sa.taken_at DESC LIMIT 1),
        'latest_pending_sample_pk', (SELECT sa.id FROM qc_sample sa WHERE sa.drying_sub_lot_id = s.id AND sa.status = 'pending' ORDER BY sa.taken_at DESC LIMIT 1)
    );

    IF p_include_hold_detail AND s.status IN ('hold','disposing','closed','room_temp_drying','awaiting_recheck') THEN
      SELECT d.* INTO last_disp FROM qc_disposition d
       WHERE d.drying_sub_lot_id = s.id
       ORDER BY d.created_at DESC LIMIT 1;

      SELECT jsonb_build_object(
        'hold_reason', NULL,
        'hold_aw', (ir.values_json->>'aw')::numeric,
        'hold_item_name', t.item_name,
        'hold_lower_limit', t.lower_limit,
        'hold_upper_limit', t.upper_limit,
        'hold_inspected_at', ir.submitted_at
      ) INTO hold_part
      FROM qc_inspection_record ir
      LEFT JOIN qc_inspection_template t ON t.sku_id = lot.sku_id
      WHERE ir.drying_sub_lot_id = s.id AND ir.result = 'fail'
      ORDER BY ir.submitted_at DESC LIMIT 1;

      out_json := out_json || COALESCE(hold_part, '{}'::jsonb);
    END IF;

    RETURN out_json;
END;
$$;

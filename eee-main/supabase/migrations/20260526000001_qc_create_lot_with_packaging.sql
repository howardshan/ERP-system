-- M-095: Let qc_create_production_lot_with_sub_lots persist the chosen
--        packaging item (final product) on the new work order.
--
-- M-092 added qc_production_lot.packaging_item_id and round-robin-assigned
-- existing rows, but new work orders created via the Production form were
-- still left NULL because the RPC didn't accept the param.  This migration
-- adds an optional `p_packaging_item_id` argument and writes it through.
--
-- Default NULL keeps backwards compat: any existing caller (or future
-- workflow that doesn't pick a packaging) creates a lot with no packaging
-- assigned, same as before.
--
-- Validation note: we do NOT enforce that p_packaging_item_id appears in
-- qc_sku_item for p_sku_id.  The frontend's dropdown is already scoped to
-- the linked items, and a backend constraint would block legitimate manual
-- overrides via Studio.  Trust-the-caller for now; add a guard later if
-- the constraint becomes operationally important.

CREATE OR REPLACE FUNCTION qc_create_production_lot_with_sub_lots(
    p_lot_number text,
    p_lot_barcode text,
    p_work_order_barcode text,
    p_sku_id uuid,
    p_expected_dry_minutes int,
    p_sub_lot_start_seq int DEFAULT 1,
    p_sub_lot_end_seq int DEFAULT NULL,
    p_packaging_item_id bigint DEFAULT NULL
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
        (lot_number, lot_barcode, work_order_barcode, sku_id, expected_dry_minutes, packaging_item_id)
    VALUES
        (p_lot_number, p_lot_barcode, p_work_order_barcode, p_sku_id, p_expected_dry_minutes, p_packaging_item_id)
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
        'packaging_item_id', p_packaging_item_id,
        'sub_lot_count', sub_count,
        'sub_lot_ids', to_jsonb(ids)
    );
END;
$$;

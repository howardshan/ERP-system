-- M-103: wh_create_lot + wh_post_receipt (Warehouse S1)
--
-- wh_post_receipt is a one-shot direct (no-PO) goods receipt: it creates the
-- GRN (status=posted, receipt_type=direct), and for each line creates a lot,
-- a goods_receipt_line, and a 'receipt' ledger transaction via the kernel.
-- Draft workflow + cancellation (wh_cancel_grn) are deferred to S2.
--
-- Idempotent (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION wh_create_lot(
    p_item_id             bigint,
    p_source_type         text,
    p_lot_number          text DEFAULT NULL,
    p_status              text DEFAULT 'available',
    p_expiry_date         date DEFAULT NULL,
    p_manufacture_date    date DEFAULT NULL,
    p_source_doc_type     text DEFAULT NULL,
    p_source_doc_id       bigint DEFAULT NULL,
    p_supplier_lot_number text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_lot_number text;
    v_mfg        date;
    v_expiry     date;
    v_shelf      int;
    v_lot_id     bigint;
BEGIN
    v_lot_number := COALESCE(NULLIF(trim(p_lot_number), ''), wh_generate_lot_number(p_item_id, p_source_type));
    v_mfg := COALESCE(p_manufacture_date, current_date);

    -- BR-6: derive expiry from shelf_life_days when not supplied
    v_expiry := p_expiry_date;
    IF v_expiry IS NULL THEN
        SELECT shelf_life_days INTO v_shelf FROM item WHERE id = p_item_id;
        IF v_shelf IS NOT NULL THEN v_expiry := v_mfg + v_shelf; END IF;
    END IF;

    INSERT INTO lot (lot_number, item_id, supplier_lot_number, manufacture_date, expiry_date,
                     source_type, source_doc_type, source_doc_id, status, created_by)
    VALUES (v_lot_number, p_item_id, p_supplier_lot_number, v_mfg, v_expiry,
            p_source_type, p_source_doc_type, p_source_doc_id, p_status, auth.uid()::text)
    RETURNING id INTO v_lot_id;

    RETURN v_lot_id;
END;
$$;

CREATE OR REPLACE FUNCTION wh_post_receipt(
    p_lines        jsonb,
    p_receipt_date date   DEFAULT current_date,
    p_supplier_id  bigint DEFAULT NULL,
    p_warehouse_id bigint DEFAULT NULL,
    p_notes        text   DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_wh_id      bigint;
    v_grn_id     bigint;
    v_grn_number text;
    v_line       jsonb;
    v_line_no    int := 0;
    v_item_id    bigint;
    v_qty        numeric;
    v_uom_id     bigint;
    v_loc_id     bigint;
    v_lot_status text;
    v_lot_id     bigint;
    v_lot_ids    bigint[] := ARRAY[]::bigint[];
BEGIN
    IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'at least one receipt line is required';
    END IF;

    v_wh_id := p_warehouse_id;
    IF v_wh_id IS NULL THEN
        SELECT id INTO v_wh_id FROM warehouse WHERE code = 'WH-MAIN';
        IF v_wh_id IS NULL THEN RAISE EXCEPTION 'default warehouse WH-MAIN not found'; END IF;
    END IF;

    v_grn_number := wh_next_grn_number();
    INSERT INTO goods_receipt
        (grn_number, po_id, supplier_id, receipt_date, warehouse_id, status, receipt_type, created_by)
    VALUES
        (v_grn_number, NULL, p_supplier_id, p_receipt_date, v_wh_id, 'posted', 'direct', auth.uid()::text)
    RETURNING id INTO v_grn_id;

    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        v_line_no    := v_line_no + 1;
        v_item_id    := (v_line->>'item_id')::bigint;
        v_qty        := (v_line->>'quantity')::numeric;
        v_uom_id     := (v_line->>'uom_id')::bigint;
        v_loc_id     := (v_line->>'location_id')::bigint;
        v_lot_status := COALESCE(NULLIF(v_line->>'lot_status', ''), 'available');

        IF v_item_id IS NULL OR v_qty IS NULL OR v_uom_id IS NULL OR v_loc_id IS NULL THEN
            RAISE EXCEPTION 'line %: item_id, quantity, uom_id, location_id are required', v_line_no;
        END IF;
        IF v_qty <= 0 THEN
            RAISE EXCEPTION 'line %: receipt quantity must be positive', v_line_no;
        END IF;

        v_lot_id := wh_create_lot(
            p_item_id         => v_item_id,
            p_source_type     => 'purchased',
            p_lot_number      => NULLIF(trim(v_line->>'lot_number'), ''),
            p_status          => v_lot_status,
            p_expiry_date     => NULLIF(v_line->>'expiry_date', '')::date,
            p_source_doc_type => 'goods_receipt',
            p_source_doc_id   => v_grn_id
        );
        v_lot_ids := v_lot_ids || v_lot_id;

        INSERT INTO goods_receipt_line
            (grn_id, line_no, item_id, lot_id, quantity, uom_id, location_id, unit_cost)
        VALUES
            (v_grn_id, v_line_no, v_item_id, v_lot_id, v_qty, v_uom_id, v_loc_id,
             NULLIF(v_line->>'unit_cost', '')::numeric);

        PERFORM _wh_apply_transaction(
            p_item_id          => v_item_id,
            p_lot_id           => v_lot_id,
            p_location_id      => v_loc_id,
            p_quantity         => v_qty,        -- positive: inbound
            p_uom_id           => v_uom_id,
            p_transaction_type => 'receipt',
            p_unit_cost        => NULLIF(v_line->>'unit_cost', '')::numeric,
            p_reference_type   => 'goods_receipt',
            p_reference_id     => v_grn_id,
            p_notes            => p_notes
        );
    END LOOP;

    RETURN jsonb_build_object(
        'grn_id',     v_grn_id,
        'grn_number', v_grn_number,
        'line_count', v_line_no,
        'lot_ids',    to_jsonb(v_lot_ids)
    );
END;
$$;

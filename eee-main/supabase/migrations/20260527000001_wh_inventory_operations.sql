-- M-105: In-warehouse operations — transfer, adjustment, GRN cancel, rebuild (Warehouse S2)
--
-- All write paths go through _wh_apply_transaction (M-102), so BR-2/3/5/W4 are
-- enforced centrally. The ledger stays append-only; corrections are new rows.
--
-- Idempotent (CREATE OR REPLACE).

-- ── Transfer: two atomic legs (transfer_out + transfer_in) ──────────────────
CREATE OR REPLACE FUNCTION wh_post_transfer(
    p_item_id          bigint,
    p_lot_id           bigint,
    p_from_location_id bigint,
    p_to_location_id   bigint,
    p_quantity         numeric,
    p_uom_id           bigint,
    p_notes            text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_out bigint;
    v_in  bigint;
BEGIN
    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        RAISE EXCEPTION 'transfer quantity must be positive';
    END IF;
    IF p_from_location_id = p_to_location_id THEN
        RAISE EXCEPTION 'source and destination locations must differ';
    END IF;

    -- out leg: BR-5 checks source on-hand. transfer_* is NOT blocked by BR-W4
    -- (transferring out of a quarantine zone is legitimate, e.g. QC release).
    v_out := _wh_apply_transaction(
        p_item_id, p_lot_id, p_from_location_id, -p_quantity, p_uom_id,
        'transfer_out', NULL, 'transfer', NULL, p_notes);
    v_in := _wh_apply_transaction(
        p_item_id, p_lot_id, p_to_location_id, p_quantity, p_uom_id,
        'transfer_in', NULL, 'transfer', NULL, p_notes);

    RETURN jsonb_build_object('transfer_out_id', v_out, 'transfer_in_id', v_in);
END;
$$;

-- ── Adjustment: signed delta with mandatory reason (BR-5 strict, no negative) ─
CREATE OR REPLACE FUNCTION wh_post_adjustment(
    p_item_id        bigint,
    p_lot_id         bigint,
    p_location_id    bigint,
    p_quantity_delta numeric,   -- signed, in p_uom_id
    p_uom_id         bigint,
    p_reason         text
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_id bigint;
BEGIN
    IF p_quantity_delta IS NULL OR p_quantity_delta = 0 THEN
        RAISE EXCEPTION 'adjustment delta must be non-zero';
    END IF;
    IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
        RAISE EXCEPTION 'adjustment reason is required';
    END IF;
    -- reason stored in notes; BR-5 still applies (v1.0 disallows below-zero).
    v_id := _wh_apply_transaction(
        p_item_id, p_lot_id, p_location_id, p_quantity_delta, p_uom_id,
        'adjustment', NULL, 'adjustment', NULL, trim(p_reason));
    RETURN v_id;
END;
$$;

-- ── Cancel a posted GRN: reverse each line via adjustment (no row deletion) ──
CREATE OR REPLACE FUNCTION wh_cancel_grn(p_grn_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_status     text;
    v_grn_number text;
    v_line       goods_receipt_line%ROWTYPE;
    v_reversed   int := 0;
BEGIN
    SELECT status, grn_number INTO v_status, v_grn_number
    FROM goods_receipt WHERE id = p_grn_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'GRN % not found', p_grn_id; END IF;
    IF v_status <> 'posted' THEN
        RAISE EXCEPTION 'only a posted GRN can be cancelled (current: %)', v_status;
    END IF;

    -- Reverse each receipt line. If the received stock has already moved away,
    -- the reversal drives the balance negative and BR-5 aborts the whole
    -- cancel — correct: you cannot un-receive stock that's been used.
    FOR v_line IN SELECT * FROM goods_receipt_line WHERE grn_id = p_grn_id LOOP
        PERFORM _wh_apply_transaction(
            v_line.item_id, v_line.lot_id, v_line.location_id,
            -v_line.quantity, v_line.uom_id, 'adjustment', NULL,
            'goods_receipt', p_grn_id, 'CANCEL ' || v_grn_number);
        v_reversed := v_reversed + 1;
    END LOOP;

    UPDATE goods_receipt SET status = 'cancelled' WHERE id = p_grn_id;

    RETURN jsonb_build_object('grn_id', p_grn_id, 'grn_number', v_grn_number, 'lines_reversed', v_reversed);
END;
$$;

-- ── Rebuild derived balance from the ledger (ops / reconciliation, BR-4) ─────
CREATE OR REPLACE FUNCTION wh_rebuild_balance()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_rows int;
BEGIN
    -- balance is purely derived — safe to rebuild. quantity_allocated resets to
    -- 0 (no allocation feature in v1.0).
    DELETE FROM inventory_balance;
    INSERT INTO inventory_balance (item_id, lot_id, location_id, quantity_on_hand, quantity_allocated, last_updated)
    SELECT item_id, lot_id, location_id, SUM(quantity), 0, now()
    FROM inventory_transaction
    WHERE lot_id IS NOT NULL
    GROUP BY item_id, lot_id, location_id
    HAVING SUM(quantity) <> 0;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN jsonb_build_object('rebuilt_rows', v_rows);
END;
$$;

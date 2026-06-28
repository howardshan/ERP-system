-- M-098: Make "Awaiting check-in" require an explicit physical scan before
--        carts show up in the dry-room queue.
--
-- Old behaviour: a sub-lot in `status = 'created'` (just-produced) was
-- immediately visible in DryRoomDetail's "Awaiting check-in" panel.  The
-- operator picked it from the list and clicked Check In to send it to a
-- dryer cell.
--
-- New behaviour the operator wants:
--   1. Work order is created → sub-lots land in `status='created'` but are
--      NOT in the Awaiting list yet (carts are still on the production
--      floor, not yet brought up to the dryer).
--   2. As each physical cart is scanned at the dryer door, it gets stamped
--      with `scanned_for_check_in_at = now()`.  Now it's in the Awaiting
--      list.
--   3. Operator selects the carts (often by work order grouping) and bulk-
--      checks-in to a dryer.
--
-- Implementation:
--   - New nullable column `qc_drying_sub_lot.scanned_for_check_in_at`.
--     NULL = not yet brought to the dryer.  Stamped = ready to assign.
--   - Backfill existing `created` carts to the current time so we don't
--     orphan in-flight work the moment this migration applies (preserve
--     prior visibility, with a note in the audit log).
--   - New RPC `qc_scan_cart_for_check_in(p_sub_lot_id uuid)` — idempotent,
--     only stamps if currently NULL and the cart is in `created`.  Writes a
--     `scanned_for_check_in` quality event.
--   - New RPC `qc_list_awaiting_check_in()` — replaces the frontend's
--     `qc_list_sub_lots → filter status=created` pattern.  Filters here
--     so we don't need to add the new column to qc_sub_lot_to_json.

-- ── 1) Column ──────────────────────────────────────────────────────────────
ALTER TABLE qc_drying_sub_lot
  ADD COLUMN IF NOT EXISTS scanned_for_check_in_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_qc_sub_lot_awaiting_check_in
  ON qc_drying_sub_lot(scanned_for_check_in_at)
  WHERE status = 'created' AND scanned_for_check_in_at IS NOT NULL;

-- ── 2) Backfill existing `created` carts so the awaiting list isn't
--      suddenly empty after the filter change.
UPDATE qc_drying_sub_lot
SET scanned_for_check_in_at = COALESCE(created_at, now())
WHERE status = 'created' AND scanned_for_check_in_at IS NULL;

-- ── 3) Scan RPC ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION qc_scan_cart_for_check_in(p_sub_lot_id uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  s qc_drying_sub_lot%ROWTYPE;
BEGIN
  SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sub-lot not found';
  END IF;

  -- Idempotent — only stamp when status is still `created` and not yet
  -- scanned.  Any other state (already scanned / already in dryer / closed
  -- / etc) is a no-op: returns the current state to the caller.
  IF s.status = 'created' AND s.scanned_for_check_in_at IS NULL THEN
    UPDATE qc_drying_sub_lot
    SET scanned_for_check_in_at = now(),
        updated_at = now()
    WHERE id = p_sub_lot_id
    RETURNING * INTO s;

    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    VALUES (p_sub_lot_id, 'scanned_for_check_in',
            jsonb_build_object('sub_lot_code', s.sub_lot_code,
                               'scanned_at',   s.scanned_for_check_in_at),
            auth.uid());
  END IF;

  RETURN jsonb_build_object(
    'sub_lot_id',              s.id,
    'sub_lot_code',            s.sub_lot_code,
    'status',                  s.status,
    'scanned_for_check_in_at', s.scanned_for_check_in_at
  );
END;
$$;

-- ── 4) Filtered listing RPC ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION qc_list_awaiting_check_in()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    jsonb_agg(qc_sub_lot_to_json(s.id) ORDER BY s.scanned_for_check_in_at ASC),
    '[]'::jsonb
  )
  FROM qc_drying_sub_lot s
  WHERE s.status = 'created'
    AND s.scanned_for_check_in_at IS NOT NULL;
$$;


-- ===== merged from 20260527000001_wh_inventory_operations.sql (duplicate-version dedup for fresh db build) =====

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

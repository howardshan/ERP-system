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

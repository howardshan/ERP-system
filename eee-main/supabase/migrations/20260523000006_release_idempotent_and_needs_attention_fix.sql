-- M-068: Two fixes for the "released but still shows awaiting release" bug.
--
-- Root cause:
--   1. qc_release_passed_sub_lot raised an exception for carts that were
--      already in 'closed' or 'dispatched' status.  When a group release
--      partially succeeded (champion released, siblings still 'passed'),
--      retrying would fail.
--
--   2. NeedsAttentionRow.isReleased was derived from item.current_status,
--      which is the CHAMPION's status.  If the champion was released first
--      the button disappeared even though siblings still needed releasing.
--
-- Fix (DB side):
--   Make qc_release_passed_sub_lot idempotent — return success silently for
--   carts already in 'closed' or 'dispatched'.

CREATE OR REPLACE FUNCTION qc_release_passed_sub_lot(p_sub_lot_id uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE s qc_drying_sub_lot%ROWTYPE;
BEGIN
  SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sub-lot not found'; END IF;

  -- Already released or dispatched: idempotent no-op
  IF s.status IN ('closed', 'dispatched') THEN
    RETURN qc_sub_lot_to_json(p_sub_lot_id);
  END IF;

  IF s.status <> 'passed' THEN
    RAISE EXCEPTION 'Cannot release: sub-lot status is %, expected passed', s.status;
  END IF;

  UPDATE qc_drying_sub_lot
  SET status = 'closed', released_at = now(), updated_at = now()
  WHERE id = p_sub_lot_id;

  INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
  VALUES (
    p_sub_lot_id,
    'released',
    jsonb_build_object('sub_lot_code', s.sub_lot_code, 'released_at', now()),
    auth.uid()
  );

  RETURN qc_sub_lot_to_json(p_sub_lot_id);
END;
$$;

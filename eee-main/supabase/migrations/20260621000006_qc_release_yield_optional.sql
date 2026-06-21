-- ─────────────────────────────────────────────────────────────────────────────
-- M-139  Release without a yield quantity (yield is now optional)
--
-- The release dialog no longer asks for "actual yield per cart". Operations will
-- capture produced quantity at a later step (e.g. packing), not at QC release.
--
-- Reverts the S4 hard requirement (M-116) that release must carry yield > 0:
--   • p_yield_quantity NULL / 0  → just close the cart; DO NOT post any ERP
--     quantity (skip wh_sync_release_from_qc entirely). Nothing lands in
--     inventory — that's intentional until the quantity step is decided.
--   • p_yield_quantity > 0        → behaviour unchanged (posts ERP balance via
--     wh_sync_release_from_qc, BR-W3).
--
-- Idempotent short-circuit (already closed/dispatched = no-op) preserved.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION qc_release_passed_sub_lot(
    p_sub_lot_id     uuid,
    p_yield_quantity numeric DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    s      qc_drying_sub_lot%ROWTYPE;
    v_sync jsonb := NULL;
BEGIN
    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sub-lot not found'; END IF;

    -- Idempotent short-circuit (M-068) — preserved; no sync on this path.
    IF s.status IN ('closed', 'dispatched') THEN
        RETURN qc_sub_lot_to_json(p_sub_lot_id);
    END IF;

    IF s.status <> 'passed' THEN
        RAISE EXCEPTION 'Cannot release: sub-lot status is %, expected passed', s.status;
    END IF;

    UPDATE qc_drying_sub_lot
       SET status = 'closed', released_at = now(), updated_at = now()
     WHERE id = p_sub_lot_id;

    -- M-139: yield optional. Only post ERP balance when a positive yield is
    -- supplied; otherwise release without touching inventory.
    IF p_yield_quantity IS NOT NULL AND p_yield_quantity > 0 THEN
        v_sync := wh_sync_release_from_qc(p_sub_lot_id, p_yield_quantity);
    END IF;

    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    VALUES (
        p_sub_lot_id,
        'released',
        jsonb_build_object(
            'sub_lot_code',   s.sub_lot_code,
            'released_at',    now(),
            'yield_quantity', p_yield_quantity,
            'wh_sync',        v_sync
        ),
        auth.uid()
    );

    RETURN qc_sub_lot_to_json(p_sub_lot_id);
END;
$$;

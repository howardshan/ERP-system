-- M-116: qc_release_passed_sub_lot — accept yield param + sync ERP balance (S4)
--
-- Wires the BR-W3 release path. Operator clicks release in the QC UI → front-
-- end collects yield → this RPC:
--   ① preserves the M-068 idempotent short-circuit (already-closed = no-op,
--      NO sync call — important so retrying never double-posts balance)
--   ② validates yield > 0 (front-end normally enforces; back-end is the
--      definitive guard)
--   ③ transitions status → 'closed'
--   ④ calls wh_sync_release_from_qc which posts the production_output
--      transaction at LOC-PACK-STAGE and recomputes lot.status
--   ⑤ writes the 'released' qc_quality_event with wh_sync result embedded
--
-- ANY error from wh_sync_release_from_qc — `PACKAGING_REQUIRED:<id>`,
-- `NO_PACKAGING_LINKED:<sku>`, kernel BR-3/5/W4, FK violations — rolls back
-- the whole function, so sub_lot.status remains 'passed' (decision D-W04,
-- BR-W3). Front-end catches the error code and either prompts the operator
-- or surfaces the failure.
--
-- Signature change: adds `p_yield_quantity numeric DEFAULT NULL`. Old callers
-- still pass type-check at the function-call layer, but the function will
-- raise YIELD_REQUIRED at runtime if they reach the non-idempotent path.
--
-- Idempotent (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION qc_release_passed_sub_lot(
    p_sub_lot_id     uuid,
    p_yield_quantity numeric DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    s      qc_drying_sub_lot%ROWTYPE;
    v_sync jsonb;
BEGIN
    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sub-lot not found'; END IF;

    -- M-068 idempotent short-circuit — preserved verbatim; do NOT call wh_sync
    -- on this path (re-posting balance would double-count).
    IF s.status IN ('closed', 'dispatched') THEN
        RETURN qc_sub_lot_to_json(p_sub_lot_id);
    END IF;

    IF s.status <> 'passed' THEN
        RAISE EXCEPTION 'Cannot release: sub-lot status is %, expected passed', s.status;
    END IF;

    -- S4 / BR-W3: yield is required for ERP sync
    IF p_yield_quantity IS NULL OR p_yield_quantity <= 0 THEN
        RAISE EXCEPTION 'YIELD_REQUIRED: yield quantity must be provided and positive (got %)', p_yield_quantity;
    END IF;

    UPDATE qc_drying_sub_lot
       SET status = 'closed', released_at = now(), updated_at = now()
     WHERE id = p_sub_lot_id;

    -- ★ S4 sync. Any failure aborts the whole transaction → sub_lot rolls back
    -- to 'passed' (BR-W3 guarantee: no "released in QC, missing in ERP" state).
    v_sync := wh_sync_release_from_qc(p_sub_lot_id, p_yield_quantity);

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

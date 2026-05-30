-- M-113: wh_recompute_lot_status — aggregate lot.status from sub_lot states (S4)
--
-- Implements decision §5.1 (status aggregation):
--   If any sub_lot is still non-terminal (created/drying/pending/inspecting/
--   passed/awaiting_*) → keep lot.status as-is (typically 'quarantine')
--   If all sub_lots are terminal:
--     - Any sub_lot ended in closed/dispatched (i.e. was released) → 'available'
--       (mixed case: passed contribute balance to PACK-STAGE; held ones never
--        posted balance per decision §3, so "mixed = available" is honest)
--     - All sub_lots ended in hold/disposing → 'on_hold' (no balance was ever
--       posted; status is informational)
--
-- Called by wh_sync_release_from_qc after each release. Also safe to call
-- standalone for reconciliation.
--
-- Idempotent (CREATE OR REPLACE, same signature).

CREATE OR REPLACE FUNCTION wh_recompute_lot_status(p_lot_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_old_status     text;
    v_total          int;
    v_terminal       int;
    v_pass_terminal  int;
    v_hold_terminal  int;
    v_new_status     text;
BEGIN
    SELECT status INTO v_old_status FROM lot WHERE id = p_lot_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'lot % not found', p_lot_id; END IF;

    -- Count sub_lots linked to this ERP lot
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE status IN ('closed', 'dispatched', 'hold', 'disposing')),
        COUNT(*) FILTER (WHERE status IN ('closed', 'dispatched')),
        COUNT(*) FILTER (WHERE status IN ('hold', 'disposing'))
    INTO v_total, v_terminal, v_pass_terminal, v_hold_terminal
    FROM qc_drying_sub_lot
    WHERE lot_id = p_lot_id;

    -- No sub_lots linked or any non-terminal → leave status alone
    IF v_total = 0 OR v_terminal < v_total THEN
        RETURN jsonb_build_object(
            'lot_id', p_lot_id,
            'old_status', v_old_status,
            'new_status', v_old_status,
            'action', 'noop_pending_sub_lots',
            'total', v_total,
            'terminal', v_terminal
        );
    END IF;

    -- All sub_lots terminal: aggregate
    IF v_pass_terminal > 0 THEN
        v_new_status := 'available';   -- mixed counts as available (held had no balance)
    ELSE
        v_new_status := 'on_hold';     -- all hold/disposing
    END IF;

    IF v_new_status <> v_old_status THEN
        UPDATE lot SET status = v_new_status WHERE id = p_lot_id;
    END IF;

    RETURN jsonb_build_object(
        'lot_id', p_lot_id,
        'old_status', v_old_status,
        'new_status', v_new_status,
        'action', CASE WHEN v_new_status <> v_old_status THEN 'updated' ELSE 'unchanged' END,
        'total', v_total,
        'pass_terminal', v_pass_terminal,
        'hold_terminal', v_hold_terminal
    );
END;
$$;

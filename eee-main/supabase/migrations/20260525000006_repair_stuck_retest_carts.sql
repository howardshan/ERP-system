-- M-084: Repair three carts that went through a "retest (no re-dry)"
--        disposition but ended up stuck in a non-visible state.
--
-- Affected carts: W12345-005, 11111-005, 11111-008
-- Symptoms: not in Testing queue (status ≠ pending/inspecting) and
--           not in Needs Attention (status ≠ passed/hold).
--
-- A successful retest disposition sets status = 'pending', but if the
-- cart was left in 'disposing' (partial run) or fell back to
-- 'awaiting_group_result' via a group cascade, it disappears from both
-- views and the operator has no way to retest it.
--
-- This migration moves each affected cart to 'pending' from any
-- non-terminal stuck state so it reappears in the Testing queue with
-- a "No sample" badge, ready for a fresh sample + Aw reading.
--
-- Idempotent: UPDATE guards on status prevent double-moves if the cart
-- has already reached a terminal/correct state.

DO $$
DECLARE
    target_codes text[] := ARRAY['W12345-005', '11111-005', '11111-008'];
    cart RECORD;
BEGIN
    FOR cart IN
        SELECT s.id, s.sub_lot_code, s.status
        FROM qc_drying_sub_lot s
        WHERE s.sub_lot_code = ANY(target_codes)
          -- Not already in a good state: pending/inspecting = testing queue OK
          --                               passed/closed/released = done
          AND s.status NOT IN ('pending', 'inspecting', 'passed', 'closed')
    LOOP
        RAISE NOTICE 'M-084: moving % from % -> pending', cart.sub_lot_code, cart.status;

        UPDATE qc_drying_sub_lot
        SET status     = 'pending',
            updated_at = now()
        WHERE id = cart.id;

        INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
        VALUES (
            cart.id,
            'manual_repair',
            jsonb_build_object(
                'reason',         'M-084: stuck retest cart returned to pending',
                'migration_ref',  'M-084',
                'previous_status', cart.status
            ),
            NULL
        );
    END LOOP;
END $$;

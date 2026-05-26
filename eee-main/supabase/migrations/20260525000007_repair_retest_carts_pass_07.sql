-- M-085: Close three stuck retest carts as PASS @ Aw 0.7.
--
-- Affected: W12345-005, 11111-005, 11111-008
-- These carts went through a retest disposition but never received a
-- follow-up inspection.  Per operator decision, treat as PASS 0.7 and
-- release to packaging — same approach as M-082 for the W11111 orphans.
--
-- Steps per cart:
--   1) Insert synthetic qc_inspection_record (result=pass, aw=0.7)
--   2) Set status = 'closed', released_at = now()
--   3) Audit trail: inspection_passed + manual_repair + released events
--
-- Idempotent: guarded on status NOT IN ('closed') so re-running is a no-op.

DO $$
DECLARE
    target_codes text[] := ARRAY['W12345-005', '11111-005', '11111-008'];
    cart RECORD;
    ir_id uuid;
BEGIN
    FOR cart IN
        SELECT s.id, s.sub_lot_code, s.status
        FROM qc_drying_sub_lot s
        WHERE s.sub_lot_code = ANY(target_codes)
          AND s.status <> 'closed'
    LOOP
        RAISE NOTICE 'M-085: closing % (was %) as PASS 0.7', cart.sub_lot_code, cart.status;

        -- 1) Synthetic inspection record
        INSERT INTO qc_inspection_record (
            drying_sub_lot_id, inspector_auth_id, values_json, result, sample_id
        )
        VALUES (cart.id, NULL, jsonb_build_object('aw', 0.7), 'pass', NULL)
        RETURNING id INTO ir_id;

        -- 2) Close the cart
        UPDATE qc_drying_sub_lot
        SET status      = 'closed',
            released_at = now(),
            updated_at  = now()
        WHERE id = cart.id;

        -- 3) Audit events
        INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
        VALUES (
            cart.id, 'inspection_passed',
            jsonb_build_object(
                'aw', 0.7, 'result', 'pass',
                'inspection_id', ir_id,
                'source', 'M-085 manual repair (retest never completed)'
            ),
            NULL
        );

        INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
        VALUES (
            cart.id, 'manual_repair',
            jsonb_build_object(
                'reason',        'M-085: stuck retest cart closed as PASS 0.7',
                'migration_ref', 'M-085',
                'previous_status', cart.status
            ),
            NULL
        );

        INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
        VALUES (
            cart.id, 'released',
            jsonb_build_object('sub_lot_code', cart.sub_lot_code, 'released_at', now()),
            NULL
        );
    END LOOP;
END $$;

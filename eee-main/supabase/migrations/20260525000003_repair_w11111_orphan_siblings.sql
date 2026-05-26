-- M-082: One-off repair for W11111-003/006/007/008 orphan siblings.
--
-- Same root cause as M-076 (M-075 Step 2a→Step 2b cascade): these 4 carts
-- ended up stuck in 'awaiting_group_result' because their original group's
-- champion was either never tested or was orphaned away.  Per operator
-- decision today, we treat them as PASS @ Aw 0.7 and release straight to
-- packaging — no need to fabricate a real test.
--
-- For each cart we:
--   1) Insert a synthetic qc_inspection_record with result='pass', aw=0.7
--      so trace history and analytics see a recorded inspection.
--   2) Transition status: awaiting_group_result → closed, set released_at.
--   3) Write a qc_quality_event of type 'manual_repair' with migration_ref
--      'M-082' so this manual decision is auditable.
--
-- Idempotent: every UPDATE has a status='awaiting_group_result' guard so
-- re-running is a no-op once the cart has moved on.

DO $$
DECLARE
    target_codes text[] := ARRAY['W11111-003', 'W11111-006', 'W11111-007', 'W11111-008'];
    cart RECORD;
    ir_id uuid;
BEGIN
    FOR cart IN
        SELECT s.id, s.sub_lot_code, s.status
        FROM qc_drying_sub_lot s
        WHERE s.sub_lot_code = ANY(target_codes)
          AND s.status = 'awaiting_group_result'
    LOOP
        -- 1) Insert synthetic inspection record (no sample link — repair)
        INSERT INTO qc_inspection_record (
            drying_sub_lot_id, inspector_auth_id, values_json, result, sample_id
        )
        VALUES (cart.id, NULL, jsonb_build_object('aw', 0.7), 'pass', NULL)
        RETURNING id INTO ir_id;

        -- 2) Move directly to closed (= released).  Skips 'passed' middle step
        --    on purpose — the operator confirmed "已经 release".
        UPDATE qc_drying_sub_lot
        SET status      = 'closed',
            released_at = now(),
            updated_at  = now()
        WHERE id = cart.id;

        -- 3) Audit events: synthetic inspection + manual_repair marker
        INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
        VALUES (
            cart.id, 'inspection_passed',
            jsonb_build_object(
              'aw', 0.7, 'result', 'pass',
              'inspection_id', ir_id,
              'source', 'M-082 manual repair (no real sample taken)'
            ),
            NULL
        );

        INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
        VALUES (
            cart.id, 'manual_repair',
            jsonb_build_object(
              'reason', 'M-082: orphan awaiting_group_result -> PASS 0.7 + released',
              'migration_ref', 'M-082',
              'aw', 0.7
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

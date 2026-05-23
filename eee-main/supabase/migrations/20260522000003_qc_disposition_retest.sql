-- Migration M-046: Add `retest` disposition type
--
-- A failed sub-lot now has 4 (not 3) routes to leave Hold:
--   1. redry_dryer        → 再次进入 dry room (existing)
--   2. room_temp_dry      → 进入 room temp dry (existing)
--   3. retest             → 重新取样测试,不重烘 (NEW)
--   4. scrap              → 报废 (existing; UI labels as "Dispose")
--
-- Retest behaviour: sub-lot status moves hold → pending (back to Testing
-- queue) without touching dryer time or existing sample/inspection records.
-- The operator just takes a fresh sample and submits a new WA reading.

ALTER TABLE qc_disposition DROP CONSTRAINT IF EXISTS qc_disposition_type_check;
ALTER TABLE qc_disposition ADD CONSTRAINT qc_disposition_type_check
  CHECK (type IN (
    'rework', 'grind', 'scrap', 'concession',
    'redry_dryer', 'room_temp_dry',
    'retest'
  ));

-- Replace qc_create_disposition to handle the new 'retest' branch.
CREATE OR REPLACE FUNCTION qc_create_disposition(
    p_sub_lot_id uuid,
    p_type text,
    p_remark text DEFAULT NULL,
    p_redry_expected_dry_minutes int DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    s qc_drying_sub_lot%ROWTYPE;
    new_id uuid;
    next_status text;
BEGIN
    IF p_type NOT IN ('rework', 'grind', 'scrap', 'concession',
                      'redry_dryer', 'room_temp_dry', 'retest') THEN
        RAISE EXCEPTION 'Invalid disposition type: %', p_type;
    END IF;
    IF p_type = 'redry_dryer' AND (p_redry_expected_dry_minutes IS NULL OR p_redry_expected_dry_minutes <= 0) THEN
        RAISE EXCEPTION 'redry_dryer requires a positive redry_expected_dry_minutes';
    END IF;

    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sub-lot not found'; END IF;

    IF s.status = 'hold' THEN
        UPDATE qc_drying_sub_lot SET status = 'disposing', updated_at = now() WHERE id = p_sub_lot_id;
        s.status := 'disposing';
    END IF;
    IF s.status <> 'disposing' THEN
        RAISE EXCEPTION 'Sub-lot not in disposition flow (status=%)', s.status;
    END IF;

    INSERT INTO qc_disposition (drying_sub_lot_id, type, remark, operator_auth_id, redry_expected_dry_minutes)
    VALUES (p_sub_lot_id, p_type, p_remark, auth.uid(), p_redry_expected_dry_minutes)
    RETURNING id INTO new_id;

    -- Decide downstream state based on disposition type
    IF p_type = 'redry_dryer' THEN
        next_status := 'awaiting_recheck';
        UPDATE qc_drying_sub_lot
        SET status = 'awaiting_recheck',
            expected_dry_minutes = p_redry_expected_dry_minutes,
            in_time = NULL,
            updated_at = now()
        WHERE id = p_sub_lot_id;
    ELSIF p_type = 'room_temp_dry' THEN
        next_status := 'room_temp_drying';
        UPDATE qc_drying_sub_lot
        SET status = 'room_temp_drying', updated_at = now()
        WHERE id = p_sub_lot_id;
        INSERT INTO qc_room_temp_dry_session (drying_sub_lot_id, disposition_id, started_by_auth_id)
        VALUES (p_sub_lot_id, new_id, auth.uid());
    ELSIF p_type = 'retest' THEN
        -- Send the cart back to the Testing queue without re-drying.
        -- It will appear there as "Awaiting sample" since the old sample
        -- is already 'inspected' (no pending sample for this sub-lot).
        next_status := 'pending';
        UPDATE qc_drying_sub_lot
        SET status = 'pending', updated_at = now()
        WHERE id = p_sub_lot_id;
    ELSE
        -- scrap / concession / rework / grind — terminal disposal
        next_status := 'closed';
        UPDATE qc_drying_sub_lot SET status = 'closed', updated_at = now() WHERE id = p_sub_lot_id;
    END IF;

    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    VALUES (p_sub_lot_id, 'disposition_completed',
            jsonb_build_object(
              'type', p_type,
              'remark', p_remark,
              'redry_expected_dry_minutes', p_redry_expected_dry_minutes,
              'next_status', next_status
            ),
            auth.uid());

    RETURN jsonb_build_object(
        'id', new_id,
        'drying_sub_lot_id', p_sub_lot_id,
        'type', p_type,
        'remark', p_remark,
        'redry_expected_dry_minutes', p_redry_expected_dry_minutes,
        'created_at', now(),
        'new_status', next_status
    );
END;
$$;

-- Grant the new fine-grained permission to the dev user
INSERT INTO user_permission_grant (user_id, module_id, resource, permission, approval_limit)
SELECT eu.id, 'qc', 'testing', 'dispose_retest', NULL
FROM erp_user eu
WHERE eu.email = 'ysha@smu.edu'
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;

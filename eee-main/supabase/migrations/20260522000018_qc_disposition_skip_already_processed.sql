-- M-060: Make qc_create_disposition a no-op (instead of raising) when the
-- cart is already in a terminal or post-disposition state.
--
-- Root cause: when a group disposition is retried (e.g. after a partial
-- earlier run), some sibling carts may already be closed / awaiting_recheck /
-- room_temp_drying / pending from the first attempt.  The function was raising
-- "Sub-lot not in disposition flow (status=closed)" for those carts.
--
-- Fix: after the status check, if the cart is already in a "done" state,
-- return a no-op response instead of raising an exception.

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
    new_champion_id uuid;
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

    -- If the cart is already in a post-disposition state (from a prior partial run
    -- or retry), silently skip it so group-batch calls don't fail.
    IF s.status IN ('closed', 'awaiting_recheck', 'room_temp_drying', 'pending') THEN
        RETURN jsonb_build_object(
            'id',               null,
            'drying_sub_lot_id', p_sub_lot_id,
            'type',             p_type,
            'noop',             true,
            'reason',           'already_processed',
            'new_status',       s.status
        );
    END IF;

    -- Accept both 'hold' and 'awaiting_group_result' as valid entry states.
    -- 'awaiting_group_result' occurs when siblings were not transitioned to 'hold'
    -- (e.g. the group failed before M-055 was deployed).
    IF s.status IN ('hold', 'awaiting_group_result') THEN
        UPDATE qc_drying_sub_lot SET status = 'disposing', updated_at = now() WHERE id = p_sub_lot_id;
        s.status := 'disposing';
    END IF;
    IF s.status <> 'disposing' THEN
        RAISE EXCEPTION 'Sub-lot not in disposition flow (status=%)', s.status;
    END IF;

    INSERT INTO qc_disposition (drying_sub_lot_id, type, remark, operator_auth_id, redry_expected_dry_minutes)
    VALUES (p_sub_lot_id, p_type, p_remark, auth.uid(), p_redry_expected_dry_minutes)
    RETURNING id INTO new_id;

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
        -- Two flavors:
        --   (a) Individual retest (no group, or group has only this one cart): cart goes back to 'pending'
        --   (b) Group retest (failed champion in a multi-cart group): close failed champion,
        --       auto-promote next random group member as new champion.
        IF s.is_test_champion AND s.test_group_id IS NOT NULL THEN
            -- Group retest path
            UPDATE qc_drying_sub_lot
            SET is_test_champion = false, status = 'closed', updated_at = now()
            WHERE id = p_sub_lot_id;

            SELECT id INTO new_champion_id
            FROM qc_drying_sub_lot
            WHERE test_group_id = s.test_group_id
              AND status IN ('awaiting_group_result', 'hold')
            ORDER BY random()
            LIMIT 1;

            IF new_champion_id IS NULL THEN
                -- No siblings left → group closes as failed
                UPDATE qc_test_group SET status = 'closed_failed', resolved_at = now()
                WHERE id = s.test_group_id;
                next_status := 'closed';
            ELSE
                UPDATE qc_drying_sub_lot
                SET is_test_champion = true,
                    status = 'pending',
                    updated_at = now()
                WHERE id = new_champion_id;

                INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
                VALUES (new_champion_id, 'champion_promoted',
                        jsonb_build_object(
                          'test_group_id', s.test_group_id,
                          'previous_champion_id', s.id
                        ),
                        auth.uid());

                next_status := 'closed';
            END IF;
        ELSE
            -- Individual retest (sibling cart or solo cart)
            next_status := 'pending';
            UPDATE qc_drying_sub_lot
            SET status = 'pending', updated_at = now()
            WHERE id = p_sub_lot_id;
        END IF;
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
              'next_status', next_status,
              'was_champion', s.is_test_champion,
              'new_champion_id', new_champion_id
            ),
            auth.uid());

    RETURN jsonb_build_object(
        'id', new_id,
        'drying_sub_lot_id', p_sub_lot_id,
        'type', p_type,
        'remark', p_remark,
        'redry_expected_dry_minutes', p_redry_expected_dry_minutes,
        'created_at', now(),
        'new_status', next_status,
        'new_champion_id', new_champion_id
    );
END;
$$;

-- M-071: Fix group retest when champion fails — M-055 moved siblings to 'hold'
-- but the retest path still searched for 'awaiting_group_result' siblings,
-- finding none and incorrectly closing the whole group as failed.
--
-- Root cause (regression from M-055):
--   M-055 changed champion FAIL propagation so ALL group siblings also move to
--   'hold' (instead of staying in 'awaiting_group_result').  But qc_create_disposition
--   retest path continued to look for siblings with status='awaiting_group_result' —
--   finding zero, it hit the "no siblings left" branch and closed the entire group.
--
-- Symptoms:
--   - Clicking "Retest" on a group champion showed champion as "Closed/Released"
--   - All group siblings remained stuck in 'hold' with no new champion assigned
--   - qc_test_group was incorrectly marked 'closed_failed'
--
-- Fix:
--   1. Sibling lookup extended to include status IN ('hold', 'awaiting_group_result')
--   2. When new champion promoted, remaining siblings reverted to 'awaiting_group_result'
--   3. qc_test_group status reset to 'sampling' so the group is active again

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
    reverted_count int := 0;
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
        --   (a) Individual retest (no group, or not champion): cart goes back to 'pending'
        --   (b) Group retest (failed champion in a multi-cart group): close failed champion,
        --       auto-promote next random group member as new champion.
        IF s.is_test_champion AND s.test_group_id IS NOT NULL THEN
            -- Group retest path
            -- Step 1: retire the failed champion
            UPDATE qc_drying_sub_lot
            SET is_test_champion = false, status = 'closed', updated_at = now()
            WHERE id = p_sub_lot_id;

            -- Step 2: find a new champion.
            -- After M-055, siblings were moved to 'hold' when champion failed,
            -- so we look for 'hold' siblings (falling back to 'awaiting_group_result'
            -- for backward compatibility).
            SELECT id INTO new_champion_id
            FROM qc_drying_sub_lot
            WHERE test_group_id = s.test_group_id
              AND id <> p_sub_lot_id
              AND status IN ('hold', 'awaiting_group_result')
            ORDER BY random()
            LIMIT 1;

            IF new_champion_id IS NULL THEN
                -- No eligible siblings → group closes as fully failed
                UPDATE qc_test_group SET status = 'closed_failed', resolved_at = now()
                WHERE id = s.test_group_id;
                next_status := 'closed';
            ELSE
                -- Step 3: promote new champion
                UPDATE qc_drying_sub_lot
                SET is_test_champion = true,
                    status = 'pending',
                    updated_at = now()
                WHERE id = new_champion_id;

                -- Step 4: revert remaining siblings (hold → awaiting_group_result)
                -- so they don't flood the disposition queue
                UPDATE qc_drying_sub_lot
                SET status = 'awaiting_group_result', updated_at = now()
                WHERE test_group_id = s.test_group_id
                  AND id <> p_sub_lot_id
                  AND id <> new_champion_id
                  AND status IN ('hold', 'awaiting_group_result');
                GET DIAGNOSTICS reverted_count = ROW_COUNT;

                -- Step 5: reopen the test group so it's active again
                UPDATE qc_test_group
                SET status = 'sampling', resolved_at = NULL
                WHERE id = s.test_group_id;

                INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
                VALUES (new_champion_id, 'champion_promoted',
                        jsonb_build_object(
                          'test_group_id', s.test_group_id,
                          'previous_champion_id', s.id,
                          'siblings_reverted_count', reverted_count
                        ),
                        auth.uid());

                next_status := 'closed';
            END IF;
        ELSE
            -- Individual retest (solo cart or non-champion group member)
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

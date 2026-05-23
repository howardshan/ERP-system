-- Migration: fix `retest` disposition for a champion when no sibling is
-- available to promote.
--
-- Bug (BR-Q28 corner case): if a cart is a champion in a sampling group AND
-- there is no awaiting_group_result sibling (because sample_every_n=1 made a
-- group-of-1, or all siblings were already actioned), the code closed the
-- champion and the group, which lost the cart — the operator's "retest"
-- intent was to put THIS cart back into testing.
--
-- Fix: when retest is requested on a champion and no sibling can be promoted,
-- send the same cart back to 'pending' (keep test_group_id + is_test_champion
-- so propagation rules still apply if siblings are later added). The
-- multi-cart group-retest path with a sibling to promote is unchanged.

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

    IF s.status = 'hold' THEN
        UPDATE qc_drying_sub_lot SET status = 'disposing', updated_at = now() WHERE id = p_sub_lot_id;
        s.status := 'disposing';
    END IF;
    IF s.status <> 'disposing' THEN
        RAISE EXCEPTION 'Sub-lot not in disposition flow (status=%)', s.status;
    END IF;

    IF p_type = 'redry_dryer' THEN
        next_status := 'awaiting_recheck';
        UPDATE qc_drying_sub_lot
        SET status = 'awaiting_recheck',
            expected_dry_minutes = p_redry_expected_dry_minutes,
            in_time = NULL,
            out_time = NULL,
            updated_at = now()
        WHERE id = p_sub_lot_id;
    ELSIF p_type = 'room_temp_dry' THEN
        next_status := 'room_temp_drying';
        UPDATE qc_drying_sub_lot
        SET status = 'room_temp_drying', updated_at = now()
        WHERE id = p_sub_lot_id;
        -- Open a room_temp_dry session row
        INSERT INTO qc_room_temp_dry_session (drying_sub_lot_id, started_at, started_by)
        VALUES (p_sub_lot_id, now(), auth.uid());
    ELSIF p_type = 'retest' THEN
        -- Three flavors:
        --   (a) Champion in a multi-cart group WITH siblings still available
        --       → close failed champion, auto-promote a sibling.
        --   (b) Champion with no sibling available (solo group, or all siblings
        --       actioned) → THIS cart goes back to 'pending' (operator wants a
        --       fresh test on the same cart, not to lose it).
        --   (c) Non-champion (no group, or already a regular pending cart)
        --       → cart goes back to 'pending'.
        IF s.is_test_champion AND s.test_group_id IS NOT NULL THEN
            SELECT id INTO new_champion_id
            FROM qc_drying_sub_lot
            WHERE test_group_id = s.test_group_id
              AND status = 'awaiting_group_result'
              AND id <> p_sub_lot_id
            ORDER BY random()
            LIMIT 1;

            IF new_champion_id IS NULL THEN
                -- Solo or no sibling left: keep THIS cart, send back to pending.
                next_status := 'pending';
                UPDATE qc_drying_sub_lot
                SET status = 'pending', updated_at = now()
                WHERE id = p_sub_lot_id;
            ELSE
                -- Multi-cart group with a sibling — close failed champion,
                -- promote sibling, group stays open.
                UPDATE qc_drying_sub_lot
                SET is_test_champion = false, status = 'closed', updated_at = now()
                WHERE id = p_sub_lot_id;

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
            -- Individual retest (no group)
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

    INSERT INTO qc_disposition (drying_sub_lot_id, type, remark, operator_auth_id, redry_expected_dry_minutes)
    VALUES (p_sub_lot_id, p_type, p_remark, auth.uid(), p_redry_expected_dry_minutes)
    RETURNING id INTO new_id;

    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    VALUES (p_sub_lot_id, 'disposition_completed',
            jsonb_build_object(
              'disposition_id', new_id,
              'type', p_type,
              'remark', p_remark,
              'new_status', next_status,
              'redry_expected_dry_minutes', p_redry_expected_dry_minutes,
              'new_champion_id', new_champion_id
            ),
            auth.uid());

    RETURN jsonb_build_object(
        'id', new_id,
        'new_status', next_status,
        'type', p_type,
        'redry_expected_dry_minutes', p_redry_expected_dry_minutes,
        'new_champion_id', new_champion_id
    );
END;
$$;

-- M-078: Fix `qc_create_disposition` room_temp_dry INSERT.
--
-- M-072 (20260523000013) rewrote qc_create_disposition for the "champion with
-- no sibling to promote" corner case, but introduced two regressions in the
-- room_temp_dry branch:
--
--   1. Column name typo:
--        INSERT INTO qc_room_temp_dry_session (..., started_by)
--      The actual column is `started_by_auth_id` — see M-039 table DDL.
--      Hitting "Room temp dry" in the dispose dialog crashes with
--      "column \"started_by\" of relation \"qc_room_temp_dry_session\" does
--       not exist".
--
--   2. Missing disposition_id link:
--      The qc_disposition INSERT was moved to AFTER the type branches, so the
--      RETURNING id INTO new_id wasn't available when the room_temp_dry
--      session was inserted, and the disposition_id linkage was silently
--      dropped from the row.  History/audit lookups by disposition lose the
--      session.
--
-- Fix: move the qc_disposition INSERT back to BEFORE the type branches (as in
-- M-048/M-060/M-061/M-065), so new_id is available for the room_temp_dry
-- session row.  Restore the correct column name and the disposition_id link.
-- All other M-072 semantics (champion-with-no-sibling retest path) preserved.

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

    -- Disposition row FIRST so new_id is available for downstream side-tables
    -- (e.g. qc_room_temp_dry_session.disposition_id).
    INSERT INTO qc_disposition (drying_sub_lot_id, type, remark, operator_auth_id, redry_expected_dry_minutes)
    VALUES (p_sub_lot_id, p_type, p_remark, auth.uid(), p_redry_expected_dry_minutes)
    RETURNING id INTO new_id;

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
        -- Correct column name + link the session back to its disposition.
        INSERT INTO qc_room_temp_dry_session (drying_sub_lot_id, disposition_id, started_by_auth_id)
        VALUES (p_sub_lot_id, new_id, auth.uid());
    ELSIF p_type = 'retest' THEN
        -- Three flavors (preserved from M-072):
        --   (a) Champion in a multi-cart group WITH siblings still available
        --       → close failed champion, auto-promote a sibling.
        --   (b) Champion with no sibling available (solo group, or all siblings
        --       actioned) → THIS cart goes back to 'pending'.
        --   (c) Non-champion → cart goes back to 'pending'.
        IF s.is_test_champion AND s.test_group_id IS NOT NULL THEN
            SELECT id INTO new_champion_id
            FROM qc_drying_sub_lot
            WHERE test_group_id = s.test_group_id
              AND status = 'awaiting_group_result'
              AND id <> p_sub_lot_id
            ORDER BY random()
            LIMIT 1;

            IF new_champion_id IS NULL THEN
                next_status := 'pending';
                UPDATE qc_drying_sub_lot
                SET status = 'pending', updated_at = now()
                WHERE id = p_sub_lot_id;
            ELSE
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

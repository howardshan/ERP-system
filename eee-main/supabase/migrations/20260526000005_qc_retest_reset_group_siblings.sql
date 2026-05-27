-- M-097: Retest on a group champion must reset hold-state siblings back to
--        `awaiting_group_result` so the eventual retest result propagates
--        across the whole group.
--
-- Bug flow (before this migration):
--   1. 2-cart group, champion FAILs.
--   2. M-055 group-fail propagation puts the sibling in `hold` too.
--   3. Operator clicks Retest on the champion.
--   4. qc_create_disposition's retest branch tries to find a NEW champion
--      among `awaiting_group_result` siblings -- but the sibling is in
--      `hold`, not `awaiting_group_result`, so the lookup returns NULL.
--   5. Function falls through to "keep this cart as champion, send back
--      to pending".  Sibling stays in `hold`, never updated.
--   6. Champion's new sample comes back PASS via qc_submit_inspection.
--      M-055 propagation only touches `awaiting_group_result` siblings
--      → sibling still in `hold`.
--
-- Resulting symptoms reported by operators:
--   - Analysis → Retest detail keeps showing "in progress" for the sibling
--     (sibling has no inspection after the retest disposition, so the
--      `dwell_minutes / next_result` columns are NULL forever).
--   - QC Home Needs Attention is mixed: champion shows PASS waiting
--     release, sibling shows FAIL waiting dispose.  Operator can't
--     release the group atomically.
--
-- Fix: when the retest branch keeps the original cart as champion
-- (no `awaiting_group_result` sibling to promote), reset every sibling
-- currently in `hold` back to `awaiting_group_result`.  Other statuses
-- (closed / dispatched / disposing / awaiting_recheck / room_temp_drying /
-- passed) are left alone — those are already past the testing stage and
-- shouldn't be dragged back.
--
-- Audit event `group_retest_reset` written per reset sibling so the
-- timeline shows the operator's retest fanned out to the group.

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
    siblings_reset_count int := 0;
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
            out_time = NULL,
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
        IF s.is_test_champion AND s.test_group_id IS NOT NULL THEN
            SELECT id INTO new_champion_id
            FROM qc_drying_sub_lot
            WHERE test_group_id = s.test_group_id
              AND status = 'awaiting_group_result'
              AND id <> p_sub_lot_id
            ORDER BY random()
            LIMIT 1;

            IF new_champion_id IS NULL THEN
                -- Keep THIS cart as champion, back to pending.
                next_status := 'pending';
                UPDATE qc_drying_sub_lot
                SET status = 'pending', updated_at = now()
                WHERE id = p_sub_lot_id;

                -- M-097 FIX: reset hold-state siblings back to
                -- `awaiting_group_result` so the eventual retest result
                -- propagates to them.  Only `hold` is reset — other
                -- statuses are past the testing stage.
                UPDATE qc_drying_sub_lot
                SET status = 'awaiting_group_result', updated_at = now()
                WHERE test_group_id = s.test_group_id
                  AND id <> p_sub_lot_id
                  AND status = 'hold';
                GET DIAGNOSTICS siblings_reset_count = ROW_COUNT;

                INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
                SELECT sl.id, 'group_retest_reset',
                       jsonb_build_object(
                         'reset_from', 'hold',
                         'reset_to',   'awaiting_group_result',
                         'champion_id', s.id,
                         'disposition_id', new_id
                       ),
                       auth.uid()
                FROM qc_drying_sub_lot sl
                WHERE sl.test_group_id = s.test_group_id
                  AND sl.id <> p_sub_lot_id
                  AND sl.status = 'awaiting_group_result';
            ELSE
                -- A sibling was waiting (legacy path) — close failed
                -- champion, promote sibling as new champion.
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
              'new_champion_id', new_champion_id,
              'siblings_reset_count', siblings_reset_count
            ),
            auth.uid());

    RETURN jsonb_build_object(
        'id', new_id,
        'new_status', next_status,
        'type', p_type,
        'redry_expected_dry_minutes', p_redry_expected_dry_minutes,
        'new_champion_id', new_champion_id,
        'siblings_reset_count', siblings_reset_count
    );
END;
$$;

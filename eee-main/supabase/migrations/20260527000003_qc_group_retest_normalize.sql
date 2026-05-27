-- Migration M-106: Fix champion test result not representing the sampling group.
--
-- ROOT CAUSE (confirmed from qc_quality_event timeline of group 8aa13d63):
--   A failed group's "Dispose all N → retest" calls qc_create_disposition once
--   per cart (frontend createDispositionGroup uses Promise.all). The retest
--   branch sent NON-champion siblings to status='pending' (an independently
--   testable state) instead of 'awaiting_group_result'. Worse, because the
--   siblings were flipped to 'pending' first, the champion's own retest branch
--   could no longer find any 'awaiting_group_result' sibling to keep grouped.
--   Net effect: the group was shattered into independent pending carts, and the
--   champion's later result propagated to nobody (group_members_propagated=0).
--
-- FIX (three parts):
--   1) qc_create_disposition: retest on a GROUPED cart now NORMALISES the whole
--      group around that cart as the sole champion (pending); every other member
--      still in the testing pipeline → 'awaiting_group_result'. The group row is
--      locked to serialise. The frontend is also changed to call this once per
--      group for retest (see createDispositionGroup), so there is no concurrency.
--   2) qc_submit_inspection: propagation backstop — also cover non-champion
--      siblings stuck in 'pending', not only 'awaiting_group_result'.
--   3) One-off repair of existing orphaned siblings: re-derive each orphaned
--      non-champion 'pending' sibling's status from its champion's current state.
--
-- Depends on: M-055 (20260522000013, propagation), M-097 (20260526000005,
--   qc_create_disposition). Affects: src/services/qcApi.ts (createDispositionGroup),
--   docs/modules/09_qc.md, docs/database/03_migrations-and-edge-functions.md.

-- ── 1) qc_create_disposition: group-normalising retest ──────────────────────

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

    -- Retest normalises the whole group (cross-row writes). Lock the group row
    -- FIRST — before any sub-lot row lock — so concurrent per-cart retest calls
    -- on the same group serialise here instead of dead-locking on each other's
    -- rows. No-op for solo carts (no group → join yields nothing).
    IF p_type = 'retest' THEN
        PERFORM 1
        FROM qc_test_group g
        JOIN qc_drying_sub_lot d ON d.test_group_id = g.id
        WHERE d.id = p_sub_lot_id
        FOR UPDATE OF g;
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
        IF s.test_group_id IS NOT NULL THEN
            -- ── Group retest = re-run the group's single-champion test ─────────
            -- Normalise the group around THIS cart as the sole champion so the
            -- eventual result propagates to everyone. (Group row already locked
            -- at the top of this function for retest.)
            next_status := 'pending';
            UPDATE qc_drying_sub_lot
            SET status = 'pending', is_test_champion = true, updated_at = now()
            WHERE id = p_sub_lot_id;

            -- Every other member still in the testing pipeline waits for the
            -- champion's fresh result. Carts already past testing (closed /
            -- passed / dispatched / room_temp_drying / awaiting_recheck) are
            -- left alone.
            UPDATE qc_drying_sub_lot
            SET status = 'awaiting_group_result', is_test_champion = false, updated_at = now()
            WHERE test_group_id = s.test_group_id
              AND id <> p_sub_lot_id
              AND status IN ('hold', 'disposing', 'pending', 'inspecting', 'awaiting_group_result');
            GET DIAGNOSTICS siblings_reset_count = ROW_COUNT;

            -- Re-open the group (it may have been closed_failed / passed).
            UPDATE qc_test_group
            SET status = 'sampling', resolved_at = NULL
            WHERE id = s.test_group_id;

            INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
            SELECT sl.id, 'group_retest_reset',
                   jsonb_build_object('reset_to', 'awaiting_group_result',
                                      'champion_id', s.id, 'disposition_id', new_id),
                   auth.uid()
            FROM qc_drying_sub_lot sl
            WHERE sl.test_group_id = s.test_group_id
              AND sl.id <> p_sub_lot_id
              AND sl.status = 'awaiting_group_result';
        ELSE
            -- Solo cart: straight back to pending for a fresh sample.
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

-- ── 2) qc_submit_inspection: propagation backstop ───────────────────────────
-- Same as M-055 but the sibling match also covers non-champion carts stuck in
-- 'pending' (not only 'awaiting_group_result'), so any stray sibling still
-- inherits the champion's result.

CREATE OR REPLACE FUNCTION qc_submit_inspection(
    p_sub_lot_id uuid,
    p_aw numeric,
    p_sample_pk uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    s qc_drying_sub_lot%ROWTYPE;
    lot qc_production_lot%ROWTYPE;
    tmpl qc_inspection_template%ROWTYPE;
    judged text;
    new_status text;
    event_type text;
    rec_id uuid;
    sample qc_sample%ROWTYPE;
    propagated_count int := 0;
BEGIN
    IF p_aw IS NULL OR p_aw < 0 OR p_aw > 2 THEN
        RAISE EXCEPTION 'Invalid Aw value: %', p_aw;
    END IF;

    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sub-lot not found'; END IF;

    IF p_sample_pk IS NOT NULL THEN
      SELECT * INTO sample FROM qc_sample WHERE id = p_sample_pk FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Sample not found'; END IF;
      IF sample.drying_sub_lot_id <> p_sub_lot_id THEN
        RAISE EXCEPTION 'Sample does not belong to this sub-lot';
      END IF;
      IF sample.status <> 'pending' THEN
        RAISE EXCEPTION 'Sample is already % — take a new sample to re-test', sample.status;
      END IF;
    END IF;

    IF s.status = 'pending' THEN
        UPDATE qc_drying_sub_lot SET status = 'inspecting', updated_at = now() WHERE id = p_sub_lot_id;
        s.status := 'inspecting';
    END IF;

    IF s.status <> 'inspecting' THEN
        RAISE EXCEPTION 'Sub-lot not inspectable (status=%)', s.status;
    END IF;

    SELECT * INTO lot FROM qc_production_lot WHERE id = s.production_lot_id;
    SELECT * INTO tmpl FROM qc_inspection_template WHERE sku_id = lot.sku_id LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'No inspection template for SKU'; END IF;

    judged := CASE WHEN p_aw >= tmpl.lower_limit AND p_aw <= tmpl.upper_limit THEN 'pass' ELSE 'fail' END;

    INSERT INTO qc_inspection_record (drying_sub_lot_id, inspector_auth_id, values_json, result, sample_id)
    VALUES (p_sub_lot_id, auth.uid(), jsonb_build_object('aw', p_aw), judged, p_sample_pk)
    RETURNING id INTO rec_id;

    IF p_sample_pk IS NOT NULL THEN
      UPDATE qc_sample SET status = 'inspected', inspection_record_id = rec_id
      WHERE id = p_sample_pk;
    END IF;

    IF judged = 'pass' THEN
        new_status := 'passed';
        event_type := 'inspection_passed';
    ELSE
        new_status := 'hold';
        event_type := 'inspection_failed_hold';
    END IF;

    UPDATE qc_drying_sub_lot SET status = new_status, updated_at = now() WHERE id = p_sub_lot_id;

    -- ── Champion group propagation (with M-106 backstop) ───────────────────────
    IF s.is_test_champion AND s.test_group_id IS NOT NULL THEN

        IF judged = 'pass' THEN
            UPDATE qc_drying_sub_lot
            SET status = 'passed', updated_at = now()
            WHERE test_group_id = s.test_group_id
              AND id <> p_sub_lot_id
              AND is_test_champion = false
              AND status IN ('awaiting_group_result', 'pending');
            GET DIAGNOSTICS propagated_count = ROW_COUNT;

            UPDATE qc_test_group
            SET status = 'passed', resolved_at = now()
            WHERE id = s.test_group_id;

            INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
            SELECT id, 'group_passed_by_champion',
                   jsonb_build_object('test_group_id', s.test_group_id, 'champion_id', s.id),
                   auth.uid()
            FROM qc_drying_sub_lot
            WHERE test_group_id = s.test_group_id AND id <> s.id AND status = 'passed'
              AND is_test_champion = false;

        ELSE
            UPDATE qc_drying_sub_lot
            SET status = 'hold', updated_at = now()
            WHERE test_group_id = s.test_group_id
              AND id <> p_sub_lot_id
              AND is_test_champion = false
              AND status IN ('awaiting_group_result', 'pending');
            GET DIAGNOSTICS propagated_count = ROW_COUNT;

            UPDATE qc_test_group
            SET status = 'closed_failed', resolved_at = now()
            WHERE id = s.test_group_id;

            INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
            SELECT id, 'group_failed_by_champion',
                   jsonb_build_object(
                       'test_group_id', s.test_group_id,
                       'champion_id', s.id,
                       'champion_aw', p_aw
                   ),
                   auth.uid()
            FROM qc_drying_sub_lot
            WHERE test_group_id = s.test_group_id AND id <> s.id AND status = 'hold'
              AND is_test_champion = false;
        END IF;

    END IF;
    -- ─────────────────────────────────────────────────────────────────────────

    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    VALUES (p_sub_lot_id, event_type,
            jsonb_build_object(
              'aw', p_aw, 'result', judged,
              'limits', jsonb_build_array(tmpl.lower_limit, tmpl.upper_limit),
              'sample_pk', p_sample_pk,
              'sample_id', sample.sample_id,
              'is_test_champion', s.is_test_champion,
              'group_members_propagated', propagated_count
            ),
            auth.uid());

    RETURN jsonb_build_object(
        'id', rec_id,
        'drying_sub_lot_id', p_sub_lot_id,
        'result', judged,
        'values_json', jsonb_build_object('aw', p_aw),
        'submitted_at', now(),
        'new_status', new_status,
        'sample_pk', p_sample_pk,
        'group_members_propagated', propagated_count
    );
END;
$$;

-- ── 3) One-off repair of existing orphaned siblings ─────────────────────────
-- Re-derive each orphaned non-champion 'pending' sibling's status from its
-- champion's current state. Only touches groups whose champion is in a state we
-- can map cleanly; other carts are left untouched.

WITH champ AS (
    SELECT test_group_id, status AS champ_status
    FROM qc_drying_sub_lot
    WHERE is_test_champion = true
      AND test_group_id IS NOT NULL
      AND status IN ('hold', 'passed', 'pending', 'inspecting')
), repaired AS (
    UPDATE qc_drying_sub_lot sl
    SET status = CASE c.champ_status
                   WHEN 'hold'   THEN 'hold'
                   WHEN 'passed' THEN 'passed'
                   ELSE 'awaiting_group_result'   -- champion still pending / inspecting
                 END,
        updated_at = now()
    FROM champ c
    WHERE sl.test_group_id = c.test_group_id
      AND sl.is_test_champion = false
      AND sl.status = 'pending'
    RETURNING sl.id, sl.status AS new_status, sl.test_group_id
)
INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
SELECT id, 'group_orphan_repaired',
       jsonb_build_object('migration', 'M-106', 'new_status', new_status,
                          'test_group_id', test_group_id),
       NULL
FROM repaired;

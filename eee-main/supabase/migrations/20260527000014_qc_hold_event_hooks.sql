-- M-117: qc_submit_inspection + qc_create_disposition — emit ERP-link audit
--        events on hold/disposition paths (Warehouse S4)
--
-- Per decision (2026-05-27): a held or disposed cart does NOT change ERP
-- balance — yield was never posted for it (release-time yield model). So
-- these paths stay strictly "informational": we add traceability events
-- carrying the linked wh_lot_id so anyone querying qc_quality_event can
-- see which ERP lot a hold/disposition refers to without joining tables.
--
-- Two CREATE OR REPLACE statements:
--   ① qc_submit_inspection — full rewrite of M-109 + a final block that
--      writes 'qc_hold_synced_to_wh' for every sub_lot now in 'hold' on
--      the failed path (the champion AND any propagated group siblings).
--   ② qc_create_disposition — full rewrite of M-106 + a final block that
--      writes 'qc_disposition_synced_to_wh' for the disposed sub_lot.
--
-- We deliberately do NOT call _wh_apply_transaction here. BR-W3 / D-W04
-- only require the release path to be transactional with ERP; hold and
-- disposition are quality-side state changes that never touched balance.
--
-- Idempotent (CREATE OR REPLACE, same signatures as M-109 / M-106).

-- ── ① qc_submit_inspection ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION qc_submit_inspection(
    p_sub_lot_id uuid,
    p_aw numeric,
    p_sample_pk uuid DEFAULT NULL,
    p_result text DEFAULT NULL,
    p_remark text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    s qc_drying_sub_lot%ROWTYPE;
    lot qc_production_lot%ROWTYPE;
    tmpl qc_inspection_template%ROWTYPE;
    has_tmpl boolean := false;
    suggested text;
    judged text;
    new_status text;
    event_type text;
    rec_id uuid;
    sample qc_sample%ROWTYPE;
    propagated_count int := 0;
    v_wh_lot_id bigint;
BEGIN
    IF p_aw IS NULL OR p_aw < 0 OR p_aw > 2 THEN
        RAISE EXCEPTION 'Invalid Aw value: %', p_aw;
    END IF;
    IF p_result IS NOT NULL AND p_result NOT IN ('pass', 'fail') THEN
        RAISE EXCEPTION 'Invalid result: %', p_result;
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
    has_tmpl := FOUND;

    IF has_tmpl THEN
        suggested := CASE WHEN p_aw >= tmpl.lower_limit AND p_aw <= tmpl.upper_limit THEN 'pass' ELSE 'fail' END;
    ELSE
        suggested := NULL;
    END IF;

    judged := COALESCE(p_result, suggested);
    IF judged IS NULL THEN
        RAISE EXCEPTION 'No inspection template for SKU and no manual result provided';
    END IF;

    INSERT INTO qc_inspection_record (drying_sub_lot_id, inspector_auth_id, values_json, result, sample_id, remark)
    VALUES (p_sub_lot_id, auth.uid(),
            jsonb_build_object('aw', p_aw, 'suggested', suggested),
            judged, p_sample_pk, p_remark)
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

    -- ── Champion group propagation (M-106 backstop) ───────────────────────────
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
              'suggested', suggested,
              'manual_override', (suggested IS NOT NULL AND p_result IS NOT NULL AND p_result <> suggested),
              'remark', p_remark,
              'limits', CASE WHEN has_tmpl THEN jsonb_build_array(tmpl.lower_limit, tmpl.upper_limit) END,
              'sample_pk', p_sample_pk,
              'sample_id', sample.sample_id,
              'is_test_champion', s.is_test_champion,
              'group_members_propagated', propagated_count
            ),
            auth.uid());

    -- ★ S4 hold-sync hook (no balance change — informational only).
    -- Covers the champion AND any group siblings just propagated to 'hold'.
    IF judged = 'fail' THEN
        v_wh_lot_id := lot.lot_id;

        INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
        SELECT sl.id, 'qc_hold_synced_to_wh',
               jsonb_build_object(
                 'wh_lot_id', v_wh_lot_id,
                 'source', CASE WHEN sl.id = p_sub_lot_id THEN 'inspection_fail' ELSE 'group_propagation' END,
                 'champion_id', s.id,
                 'test_group_id', s.test_group_id,
                 'inspection_record_id', rec_id
               ),
               auth.uid()
        FROM qc_drying_sub_lot sl
        WHERE sl.status = 'hold'
          AND (
                sl.id = p_sub_lot_id
                OR (s.test_group_id IS NOT NULL AND sl.test_group_id = s.test_group_id)
              );
    END IF;

    RETURN jsonb_build_object(
        'id', rec_id,
        'drying_sub_lot_id', p_sub_lot_id,
        'result', judged,
        'suggested', suggested,
        'remark', p_remark,
        'values_json', jsonb_build_object('aw', p_aw),
        'submitted_at', now(),
        'new_status', new_status,
        'sample_pk', p_sample_pk,
        'group_members_propagated', propagated_count,
        'wh_lot_id', CASE WHEN judged = 'fail' THEN lot.lot_id END
    );
END;
$$;

-- ── ② qc_create_disposition ─────────────────────────────────────────────────

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
    v_wh_lot_id bigint;
BEGIN
    IF p_type NOT IN ('rework', 'grind', 'scrap', 'concession',
                      'redry_dryer', 'room_temp_dry', 'retest') THEN
        RAISE EXCEPTION 'Invalid disposition type: %', p_type;
    END IF;
    IF p_type = 'redry_dryer' AND (p_redry_expected_dry_minutes IS NULL OR p_redry_expected_dry_minutes <= 0) THEN
        RAISE EXCEPTION 'redry_dryer requires a positive redry_expected_dry_minutes';
    END IF;

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
            next_status := 'pending';
            UPDATE qc_drying_sub_lot
            SET status = 'pending', is_test_champion = true, updated_at = now()
            WHERE id = p_sub_lot_id;

            UPDATE qc_drying_sub_lot
            SET status = 'awaiting_group_result', is_test_champion = false, updated_at = now()
            WHERE test_group_id = s.test_group_id
              AND id <> p_sub_lot_id
              AND status IN ('hold', 'disposing', 'pending', 'inspecting', 'awaiting_group_result');
            GET DIAGNOSTICS siblings_reset_count = ROW_COUNT;

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

    -- ★ S4 disposition-sync hook (no balance change — informational only).
    -- Hold never posted yield, and rework/grind/scrap/concession/retest do not
    -- post yield either — yield only flows on the release path (M-116). This
    -- event lets queries trace which ERP lot the disposition targeted.
    SELECT lot_id INTO v_wh_lot_id FROM qc_production_lot WHERE id = s.production_lot_id;
    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    VALUES (p_sub_lot_id, 'qc_disposition_synced_to_wh',
            jsonb_build_object(
              'wh_lot_id', v_wh_lot_id,
              'disposition_id', new_id,
              'disposition_type', p_type,
              'new_status', next_status
            ),
            auth.uid());

    RETURN jsonb_build_object(
        'id', new_id,
        'new_status', next_status,
        'type', p_type,
        'redry_expected_dry_minutes', p_redry_expected_dry_minutes,
        'new_champion_id', new_champion_id,
        'siblings_reset_count', siblings_reset_count,
        'wh_lot_id', v_wh_lot_id
    );
END;
$$;

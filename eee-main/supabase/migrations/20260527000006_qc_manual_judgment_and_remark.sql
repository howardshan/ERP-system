-- Migration M-109: Manual pass/fail judgment + remark on QC inspections.
--
-- WHY: QC reviewers judge a cart on more than Aw alone. The system should record
-- and DISPLAY a suggested result from the SKU template, but the human makes the
-- final call (and may override it) and can attach an optional remark for the
-- record (retrievable later from Full History).
--
-- CHANGES:
--   1) qc_inspection_record gains a `remark text` column.
--   2) qc_submit_inspection gains p_result (the human decision) and p_remark.
--      • The template still yields a *suggested* result (stored for audit).
--      • Final result = COALESCE(p_result, suggested). When p_result is NULL the
--        legacy auto-judge behaviour is preserved (bulk submit still works).
--      • Template is now optional: a cart can be judged manually even with no
--        template (suggestion is then NULL).
--   3) qc_sub_lot_full_history exposes `remark` on each inspection row.
--
-- Depends on: M-106 (20260527000003, latest qc_submit_inspection),
--   M-067 (20260523000017, latest qc_sub_lot_full_history).
-- Affects: src/services/qcApi.ts, src/pages/qc/TestingPage.tsx,
--   src/pages/qc/SubLotHistoryDrawer.tsx, docs/modules/09_qc.md.

ALTER TABLE qc_inspection_record ADD COLUMN IF NOT EXISTS remark text;

-- ── qc_submit_inspection: suggestion + manual result + remark ───────────────

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

    -- System suggestion (reference only; the human decision is authoritative).
    IF has_tmpl THEN
        suggested := CASE WHEN p_aw >= tmpl.lower_limit AND p_aw <= tmpl.upper_limit THEN 'pass' ELSE 'fail' END;
    ELSE
        suggested := NULL;
    END IF;

    -- Final result: manual decision wins; fall back to the suggestion (legacy
    -- auto-judge path / bulk submit).
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
        'group_members_propagated', propagated_count
    );
END;
$$;

-- ── qc_sub_lot_full_history: expose remark on inspections ───────────────────

CREATE OR REPLACE FUNCTION qc_sub_lot_full_history(p_sub_lot_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
    s      qc_drying_sub_lot%ROWTYPE;
    result jsonb;
    grp_id uuid;
BEGIN
    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sub-lot not found'; END IF;

    grp_id := s.test_group_id;  -- may be NULL for solo carts

    result := jsonb_build_object(
        'sub_lot', qc_sub_lot_to_json(p_sub_lot_id, true),

        'spot_history', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id',               h.id,
                'dryer_number',     h.dryer_number,
                'cell_number',      h.cell_number,
                'started_at',       h.started_at,
                'ended_at',         h.ended_at,
                'end_reason',       h.end_reason,
                'duration_minutes', h.duration_minutes
            ) ORDER BY h.started_at)
            FROM qc_sub_lot_spot_history h
            WHERE h.drying_sub_lot_id = p_sub_lot_id
        ), '[]'::jsonb),

        'samples', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id',                   sa.id,
                'sample_id',            sa.sample_id,
                'taken_at',             sa.taken_at,
                'status',               sa.status,
                'test_group_id',        sa.test_group_id,
                'is_group_sample',      sa.drying_sub_lot_id <> p_sub_lot_id,
                'aw',    (SELECT (ir.values_json->>'aw')::numeric FROM qc_inspection_record ir WHERE ir.id = sa.inspection_record_id),
                'result',(SELECT ir.result               FROM qc_inspection_record ir WHERE ir.id = sa.inspection_record_id),
                'inspection_record_id', sa.inspection_record_id
            ) ORDER BY sa.taken_at)
            FROM qc_sample sa
            WHERE sa.id IN (
                SELECT id FROM qc_sample WHERE drying_sub_lot_id = p_sub_lot_id
                UNION
                SELECT id FROM qc_sample
                WHERE test_group_id = grp_id AND grp_id IS NOT NULL
            )
        ), '[]'::jsonb),

        'inspections', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id',           ir.id,
                'result',       ir.result,
                'aw',           (ir.values_json->>'aw')::numeric,
                'remark',       ir.remark,
                'submitted_at', ir.submitted_at,
                'sample_id',    (SELECT sa2.sample_id FROM qc_sample sa2 WHERE sa2.id = ir.sample_id),
                'is_group_inspection', ir.drying_sub_lot_id <> p_sub_lot_id
            ) ORDER BY ir.submitted_at)
            FROM qc_inspection_record ir
            WHERE ir.id IN (
                SELECT id FROM qc_inspection_record WHERE drying_sub_lot_id = p_sub_lot_id
                UNION
                SELECT ir2.id
                FROM   qc_inspection_record ir2
                JOIN   qc_sample sa ON sa.id = ir2.sample_id
                                   AND sa.test_group_id = grp_id
                WHERE  grp_id IS NOT NULL
            )
        ), '[]'::jsonb),

        'dispositions', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id',                         d.id,
                'type',                       d.type,
                'remark',                     d.remark,
                'redry_expected_dry_minutes', d.redry_expected_dry_minutes,
                'created_at',                 d.created_at
            ) ORDER BY d.created_at)
            FROM qc_disposition d
            WHERE d.drying_sub_lot_id = p_sub_lot_id
        ), '[]'::jsonb),

        'room_temp_sessions', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id',               sess.id,
                'started_at',       sess.started_at,
                'ended_at',         sess.ended_at,
                'duration_minutes', sess.duration_minutes
            ) ORDER BY sess.started_at)
            FROM qc_room_temp_dry_session sess
            WHERE sess.drying_sub_lot_id = p_sub_lot_id
        ), '[]'::jsonb),

        'events', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id',         ev.id,
                'event_type', ev.event_type,
                'payload',    ev.payload,
                'created_at', ev.created_at,
                'summary',    qc_quality_event_summary(ev.event_type, ev.payload, s.sub_lot_code)
            ) ORDER BY ev.created_at)
            FROM qc_quality_event ev
            WHERE ev.drying_sub_lot_id = p_sub_lot_id
        ), '[]'::jsonb)
    );

    RETURN result;
END;
$$;

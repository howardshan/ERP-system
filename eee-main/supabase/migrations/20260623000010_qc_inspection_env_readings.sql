-- ─────────────────────────────────────────────────────────────────────────────
-- M-156  Capture environment readings with each inspection (Testing Temp /
--        Humidity / Room Temp) + same-day default
--
-- The WA/MC export template has three environment columns the system didn't
-- collect. Operators now enter them in the Testing measure step (required), and
-- they're stored on the inspection record exactly like the Aw/MC readings:
-- qc_inspection_record.values_json.env = { testing_temp, humidity, room_temp }.
--
--  * qc_submit_inspection gains p_env jsonb; when present it's merged into
--    values_json under 'env'. Legacy/bulk callers omit it (no behaviour change).
--  * qc_latest_test_env() returns the most recent env entered TODAY so the UI can
--    pre-fill the next cart's fields (env is stable across the day's run).
-- ─────────────────────────────────────────────────────────────────────────────

-- Adding p_env changes the arg count, so CREATE OR REPLACE would make a SECOND
-- overload (Postgres keys functions by name + arg types) and PostgREST would then
-- fail to choose a candidate. Drop the prior 6-arg signature first.
DROP FUNCTION IF EXISTS qc_submit_inspection(uuid, numeric, uuid, text, text, jsonb);

CREATE OR REPLACE FUNCTION qc_submit_inspection(
    p_sub_lot_id uuid,
    p_aw numeric DEFAULT NULL,
    p_sample_pk uuid DEFAULT NULL,
    p_result text DEFAULT NULL,
    p_remark text DEFAULT NULL,
    p_values jsonb DEFAULT NULL,
    p_env jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    s qc_drying_sub_lot%ROWTYPE;
    lot qc_production_lot%ROWTYPE;
    tmpl qc_inspection_template%ROWTYPE;
    tmpl_rec qc_inspection_template%ROWTYPE;
    tmpl_count int := 0;
    has_tmpl boolean := false;
    multi boolean := (p_values IS NOT NULL);
    suggested text;
    judged text;
    new_status text;
    event_type text;
    rec_id uuid;
    sample qc_sample%ROWTYPE;
    propagated_count int := 0;
    in_hard boolean := false;
    in_soft boolean := true;
    all_hard boolean := true;
    all_soft boolean := true;
    readings jsonb := '{}'::jsonb;
    vjson jsonb;
    aw_compat numeric;
    v_val numeric;
    ih boolean;
    isf boolean;
    is_supervisor boolean := false;
    is_override boolean := false;
BEGIN
    IF p_result IS NOT NULL AND p_result NOT IN ('pass', 'fail') THEN
        RAISE EXCEPTION 'Invalid result: %', p_result;
    END IF;
    IF NOT multi AND (p_aw IS NULL OR p_aw < 0 OR p_aw > 2) THEN
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

    IF multi THEN
        -- ── Multi-test: a reading per template; overall band = worst of all ──
        SELECT count(*) INTO tmpl_count FROM qc_inspection_template WHERE sku_id = lot.sku_id;
        has_tmpl := tmpl_count > 0;
        IF NOT has_tmpl THEN
            RAISE EXCEPTION 'No inspection templates configured for SKU';
        END IF;

        FOR tmpl_rec IN SELECT * FROM qc_inspection_template WHERE sku_id = lot.sku_id ORDER BY id LOOP
            v_val := (p_values ->> tmpl_rec.id::text)::numeric;
            IF v_val IS NULL THEN
                RAISE EXCEPTION 'Missing reading for test "%" — complete all tests first', tmpl_rec.item_name;
            END IF;
            ih  := (v_val >= tmpl_rec.lower_limit      AND v_val <= tmpl_rec.upper_limit);
            isf := (v_val >= tmpl_rec.soft_lower_limit AND v_val <= tmpl_rec.soft_upper_limit);
            all_hard := all_hard AND ih;
            all_soft := all_soft AND isf;
            readings := readings || jsonb_build_object(tmpl_rec.id::text, jsonb_build_object(
                'test_type_id', tmpl_rec.test_type_id,
                'item_name',    tmpl_rec.item_name,
                'unit',         tmpl_rec.unit,
                'value',        v_val,
                'in_hard',      ih,
                'in_soft',      isf,
                'limits',       jsonb_build_array(tmpl_rec.lower_limit, tmpl_rec.upper_limit),
                'soft_limits',  jsonb_build_array(tmpl_rec.soft_lower_limit, tmpl_rec.soft_upper_limit)
            ));
            IF tmpl_rec.unit = 'Aw' OR tmpl_rec.item_name ILIKE '%water activity%' THEN
                aw_compat := v_val;
            END IF;
        END LOOP;

        in_hard   := all_hard;
        in_soft   := all_soft;
        suggested := CASE WHEN all_hard THEN 'pass' ELSE 'fail' END;
        vjson := jsonb_build_object(
            'readings', readings, 'suggested', suggested,
            'in_hard', all_hard, 'in_soft', all_soft, 'aw', aw_compat);
    ELSE
        -- ── Legacy single-Aw path (bulk submit) — unchanged behaviour ───────
        SELECT * INTO tmpl FROM qc_inspection_template WHERE sku_id = lot.sku_id LIMIT 1;
        has_tmpl := FOUND;
        aw_compat := p_aw;
        IF has_tmpl THEN
            in_hard := (p_aw >= tmpl.lower_limit      AND p_aw <= tmpl.upper_limit);
            in_soft := (p_aw >= tmpl.soft_lower_limit AND p_aw <= tmpl.soft_upper_limit);
            suggested := CASE WHEN in_hard THEN 'pass' ELSE 'fail' END;
        ELSE
            suggested := NULL;
        END IF;
        vjson := jsonb_build_object(
            'aw', p_aw, 'suggested', suggested, 'in_hard', in_hard, 'in_soft', in_soft);
    END IF;

    -- ── M-156: merge environment readings (testing temp / humidity / room temp) ──
    IF p_env IS NOT NULL THEN
        vjson := vjson || jsonb_build_object('env', p_env);
    END IF;

    -- ── Manual override gate (uses overall in_hard / in_soft) ───────────────
    is_override := has_tmpl AND p_result IS NOT NULL AND p_result <> suggested;
    IF is_override THEN
        IF NOT in_soft THEN
            RAISE EXCEPTION 'Reading is outside soft tolerance — manual override not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM user_permission_grant g
              JOIN erp_user u ON u.id = g.user_id
             WHERE u.auth_user_id = auth.uid()
               AND g.module_id = 'qc' AND g.resource = 'testing'
               AND g.permission = 'supervisor_judge'
        ) INTO is_supervisor;
        IF NOT is_supervisor THEN
            RAISE EXCEPTION 'Supervisor permission (qc.testing.supervisor_judge) required to override the auto-judgment';
        END IF;
    END IF;

    judged := COALESCE(p_result, suggested);
    IF judged IS NULL THEN
        RAISE EXCEPTION 'No inspection template for SKU and no manual result provided';
    END IF;

    INSERT INTO qc_inspection_record (drying_sub_lot_id, inspector_auth_id, values_json, result, sample_id, remark)
    VALUES (p_sub_lot_id, auth.uid(), vjson, judged, p_sample_pk, p_remark)
    RETURNING id INTO rec_id;

    IF p_sample_pk IS NOT NULL THEN
      UPDATE qc_sample SET status = 'inspected', inspection_record_id = rec_id WHERE id = p_sample_pk;
    END IF;

    IF judged = 'pass' THEN
        new_status := 'passed'; event_type := 'inspection_passed';
    ELSE
        new_status := 'hold';   event_type := 'inspection_failed_hold';
    END IF;

    UPDATE qc_drying_sub_lot SET status = new_status, updated_at = now() WHERE id = p_sub_lot_id;

    -- ── Champion group propagation (unchanged) ──────────────────────────────
    IF s.is_test_champion AND s.test_group_id IS NOT NULL THEN
        IF judged = 'pass' THEN
            UPDATE qc_drying_sub_lot SET status = 'passed', updated_at = now()
            WHERE test_group_id = s.test_group_id AND id <> p_sub_lot_id
              AND is_test_champion = false AND status IN ('awaiting_group_result', 'pending');
            GET DIAGNOSTICS propagated_count = ROW_COUNT;

            UPDATE qc_test_group SET status = 'passed', resolved_at = now() WHERE id = s.test_group_id;

            INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
            SELECT id, 'group_passed_by_champion',
                   jsonb_build_object('test_group_id', s.test_group_id, 'champion_id', s.id), auth.uid()
            FROM qc_drying_sub_lot
            WHERE test_group_id = s.test_group_id AND id <> s.id AND status = 'passed' AND is_test_champion = false;
        ELSE
            UPDATE qc_drying_sub_lot SET status = 'hold', updated_at = now()
            WHERE test_group_id = s.test_group_id AND id <> p_sub_lot_id
              AND is_test_champion = false AND status IN ('awaiting_group_result', 'pending');
            GET DIAGNOSTICS propagated_count = ROW_COUNT;

            UPDATE qc_test_group SET status = 'closed_failed', resolved_at = now() WHERE id = s.test_group_id;

            INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
            SELECT id, 'group_failed_by_champion',
                   jsonb_build_object('test_group_id', s.test_group_id, 'champion_id', s.id, 'champion_aw', aw_compat), auth.uid()
            FROM qc_drying_sub_lot
            WHERE test_group_id = s.test_group_id AND id <> s.id AND status = 'hold' AND is_test_champion = false;
        END IF;
    END IF;

    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    VALUES (p_sub_lot_id, event_type,
            jsonb_build_object(
              'aw', aw_compat, 'result', judged, 'suggested', suggested,
              'in_hard', in_hard, 'in_soft', in_soft,
              'manual_override', is_override,
              'manual_override_by_supervisor', (is_override AND is_supervisor),
              'remark', p_remark,
              'readings', CASE WHEN multi THEN readings END,
              'env', p_env,
              'sample_pk', p_sample_pk, 'sample_id', sample.sample_id,
              'is_test_champion', s.is_test_champion,
              'group_members_propagated', propagated_count
            ), auth.uid());

    RETURN jsonb_build_object(
        'id', rec_id, 'drying_sub_lot_id', p_sub_lot_id,
        'result', judged, 'suggested', suggested, 'remark', p_remark,
        'values_json', vjson, 'submitted_at', now(),
        'new_status', new_status, 'sample_pk', p_sample_pk,
        'group_members_propagated', propagated_count
    );
END;
$$;

-- ── Same-day default: most recent env readings entered today ────────────────
CREATE OR REPLACE FUNCTION public.qc_latest_test_env()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT ir.values_json -> 'env'
  FROM qc_inspection_record ir
  WHERE ir.values_json ? 'env'
    AND ir.submitted_at >= date_trunc('day', now())
  ORDER BY ir.submitted_at DESC
  LIMIT 1;
$$;

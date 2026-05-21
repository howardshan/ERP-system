-- Migration M-034: Quality Control RPC functions
-- Ports qc-demo backend (FastAPI state machine + judging logic) into Postgres.
-- All functions live in `public` schema (default PostgREST exposure) with `qc_`
-- prefix. Frontend calls these via supabase.rpc('qc_*', ...).
--
-- State machine:
--   (null) -- register_in --> drying
--   drying -- register_out --> pending
--   pending -- start_inspection --> inspecting
--   inspecting -- submit_pass --> passed
--   inspecting -- submit_fail --> hold
--   hold -- start_disposition --> disposing
--   disposing -- complete_disposition --> closed

-- ─── Helper: format fail reason (mirrors inspection_judge.format_fail_reason) ─

CREATE OR REPLACE FUNCTION qc_format_fail_reason(
    p_value numeric, p_lower numeric, p_upper numeric, p_item_name text DEFAULT 'Water Activity (Aw)'
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_value > p_upper THEN
            p_item_name || ' ' || p_value || ' above upper limit ' || p_upper
            || ' (spec [' || p_lower || ', ' || p_upper || '])'
        WHEN p_value < p_lower THEN
            p_item_name || ' ' || p_value || ' below lower limit ' || p_lower
            || ' (spec [' || p_lower || ', ' || p_upper || '])'
        ELSE
            p_item_name || ' ' || p_value || ' outside spec [' || p_lower || ', ' || p_upper || ']'
    END
$$;

-- ─── Helper: event summary (mirrors event_display.quality_event_summary) ─────

CREATE OR REPLACE FUNCTION qc_quality_event_summary(
    p_event_type text, p_payload jsonb, p_sub_lot_code text
) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    prefix text := CASE WHEN p_sub_lot_code IS NOT NULL THEN p_sub_lot_code || ' · ' ELSE '' END;
    aw_val numeric;
    lo numeric;
    hi numeric;
    dtype text;
    label text;
    remark text;
BEGIN
    IF p_event_type = 'check_in' THEN
        RETURN prefix || 'Checked in to dryer (' || COALESCE(p_payload->>'sub_lot_code', p_sub_lot_code, 'sub-lot') || ')';
    ELSIF p_event_type = 'check_out' THEN
        RETURN prefix || 'Checked out of dryer — pending inspection';
    ELSIF p_event_type IN ('inspection_passed', 'inspection_failed_hold') THEN
        aw_val := NULLIF(p_payload->>'aw', '')::numeric;
        IF p_payload ? 'limits' AND jsonb_array_length(p_payload->'limits') >= 2 THEN
            lo := (p_payload->'limits'->>0)::numeric;
            hi := (p_payload->'limits'->>1)::numeric;
            IF p_event_type = 'inspection_passed' THEN
                RETURN prefix || 'Inspection passed: Water Activity (Aw) ' || COALESCE(aw_val::text, '—')
                       || ' (spec [' || lo || ', ' || hi || '])';
            ELSIF aw_val IS NOT NULL THEN
                RETURN prefix || 'Inspection failed — Hold: ' || qc_format_fail_reason(aw_val, lo, hi);
            ELSE
                RETURN prefix || 'Inspection failed — Hold (spec [' || lo || ', ' || hi || '])';
            END IF;
        END IF;
        IF p_event_type = 'inspection_passed' THEN
            RETURN prefix || 'Inspection passed: Water Activity (Aw) ' || COALESCE(aw_val::text, '—');
        END IF;
        RETURN prefix || 'Inspection failed — Hold: Water Activity (Aw) ' || COALESCE(aw_val::text, '—');
    ELSIF p_event_type = 'disposition_completed' THEN
        dtype := p_payload->>'type';
        label := CASE dtype
            WHEN 'rework' THEN 'Rework'
            WHEN 'grind' THEN 'Grind & re-line'
            WHEN 'scrap' THEN 'Scrap'
            WHEN 'concession' THEN 'Concession'
            ELSE COALESCE(dtype, 'Disposition')
        END;
        remark := trim(COALESCE(p_payload->>'remark', ''));
        IF remark <> '' THEN
            RETURN prefix || 'Disposition completed: ' || label || ' (' || remark || ')';
        END IF;
        RETURN prefix || 'Disposition completed: ' || label;
    END IF;
    RETURN prefix || p_event_type;
END;
$$;

-- ─── Helper: assemble sub-lot output as jsonb ─────────────────────────────────

CREATE OR REPLACE FUNCTION qc_sub_lot_to_json(p_sub_lot_id uuid, p_include_hold_detail boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
    s qc_drying_sub_lot%ROWTYPE;
    loc qc_drying_location%ROWTYPE;
    lot qc_production_lot%ROWTYPE;
    sku qc_product_sku%ROWTYPE;
    tmpl qc_inspection_template%ROWTYPE;
    rec qc_inspection_record%ROWTYPE;
    wait_minutes numeric := NULL;
    aw_val numeric;
    result jsonb;
BEGIN
    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id;
    IF NOT FOUND THEN RETURN NULL; END IF;

    SELECT * INTO loc FROM qc_drying_location WHERE id = s.location_id;
    SELECT * INTO lot FROM qc_production_lot WHERE id = s.production_lot_id;
    IF FOUND THEN SELECT * INTO sku FROM qc_product_sku WHERE id = lot.sku_id; END IF;

    IF s.out_time IS NOT NULL AND s.status = 'pending' THEN
        wait_minutes := ROUND(EXTRACT(EPOCH FROM (now() - s.out_time)) / 60.0, 1);
    END IF;

    result := jsonb_build_object(
        'id', s.id,
        'production_lot_id', s.production_lot_id,
        'sub_lot_code', s.sub_lot_code,
        'location_id', s.location_id,
        'location_name', loc.display_name,
        'in_time', s.in_time,
        'out_time', s.out_time,
        'status', s.status,
        'lot_barcode', lot.lot_barcode,
        'sku_name', sku.name,
        'wait_minutes', wait_minutes,
        'hold_reason', NULL,
        'hold_aw', NULL,
        'hold_item_name', NULL,
        'hold_lower_limit', NULL,
        'hold_upper_limit', NULL,
        'hold_inspected_at', NULL
    );

    IF p_include_hold_detail AND s.status = 'hold' THEN
        SELECT * INTO rec FROM qc_inspection_record
        WHERE drying_sub_lot_id = s.id AND result = 'fail'
        ORDER BY submitted_at DESC LIMIT 1;

        IF FOUND THEN
            aw_val := NULLIF(rec.values_json->>'aw', '')::numeric;
            SELECT * INTO tmpl FROM qc_inspection_template WHERE sku_id = lot.sku_id LIMIT 1;

            result := result || jsonb_build_object(
                'hold_inspected_at', rec.submitted_at,
                'hold_aw', aw_val,
                'hold_item_name', COALESCE(tmpl.item_name, 'Water Activity (Aw)'),
                'hold_lower_limit', tmpl.lower_limit,
                'hold_upper_limit', tmpl.upper_limit,
                'hold_reason', CASE
                    WHEN tmpl.lower_limit IS NOT NULL AND tmpl.upper_limit IS NOT NULL AND aw_val IS NOT NULL THEN
                        qc_format_fail_reason(aw_val, tmpl.lower_limit, tmpl.upper_limit, tmpl.item_name)
                    WHEN aw_val IS NOT NULL THEN
                        'Inspection failed (Water Activity (Aw) ' || aw_val || ')'
                    ELSE
                        'Inspection failed (reading missing)'
                END
            );
        ELSE
            result := result || jsonb_build_object('hold_reason', 'Inspection failed (no inspection record)');
        END IF;
    END IF;

    RETURN result;
END;
$$;

-- ─── Helper: per-record "today inspection item" used by dashboard ───────────

CREATE OR REPLACE FUNCTION qc_today_inspection_item(p_record_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
    rec qc_inspection_record%ROWTYPE;
    s qc_drying_sub_lot%ROWTYPE;
    lot qc_production_lot%ROWTYPE;
    sku qc_product_sku%ROWTYPE;
    tmpl qc_inspection_template%ROWTYPE;
    aw_val numeric;
    fail_reason text;
BEGIN
    SELECT * INTO rec FROM qc_inspection_record WHERE id = p_record_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = rec.drying_sub_lot_id;
    SELECT * INTO lot FROM qc_production_lot WHERE id = s.production_lot_id;
    IF FOUND THEN
        SELECT * INTO sku FROM qc_product_sku WHERE id = lot.sku_id;
        SELECT * INTO tmpl FROM qc_inspection_template WHERE sku_id = lot.sku_id LIMIT 1;
    END IF;

    aw_val := NULLIF(rec.values_json->>'aw', '')::numeric;

    IF rec.result = 'fail' AND aw_val IS NOT NULL
       AND tmpl.lower_limit IS NOT NULL AND tmpl.upper_limit IS NOT NULL THEN
        fail_reason := qc_format_fail_reason(aw_val, tmpl.lower_limit, tmpl.upper_limit,
                                             COALESCE(tmpl.item_name, 'Water Activity (Aw)'));
    END IF;

    RETURN jsonb_build_object(
        'sub_lot_id', rec.drying_sub_lot_id,
        'sub_lot_code', COALESCE(s.sub_lot_code, '—'),
        'sku_name', sku.name,
        'aw', aw_val,
        'result', rec.result,
        'submitted_at', rec.submitted_at,
        'status', COALESCE(s.status, 'unknown'),
        'fail_reason', fail_reason
    );
END;
$$;

-- ─── Sub-lot check-in (creates sub-lot in 'drying' status) ──────────────────

CREATE OR REPLACE FUNCTION qc_check_in_sub_lot(
    p_production_lot_id uuid,
    p_location_id uuid DEFAULT NULL,
    p_in_time timestamptz DEFAULT NULL,
    p_sub_lot_code text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    lot qc_production_lot%ROWTYPE;
    code text;
    seq integer;
    in_t timestamptz := COALESCE(p_in_time, now());
    new_id uuid;
BEGIN
    SELECT * INTO lot FROM qc_production_lot WHERE id = p_production_lot_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Production lot not found'; END IF;

    SELECT COUNT(*) + 1 INTO seq FROM qc_drying_sub_lot WHERE production_lot_id = p_production_lot_id;
    code := COALESCE(p_sub_lot_code, lot.lot_barcode || '-D' || LPAD(seq::text, 2, '0'));

    IF EXISTS (SELECT 1 FROM qc_drying_sub_lot WHERE sub_lot_code = code) THEN
        RAISE EXCEPTION 'Sub-lot code already exists: %', code;
    END IF;

    INSERT INTO qc_drying_sub_lot (production_lot_id, sub_lot_code, location_id, in_time, out_time, status)
    VALUES (p_production_lot_id, code, p_location_id, in_t, NULL, 'drying')
    RETURNING id INTO new_id;

    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    VALUES (new_id, 'check_in',
            jsonb_build_object('sub_lot_code', code, 'in_time', in_t),
            auth.uid());

    RETURN qc_sub_lot_to_json(new_id);
END;
$$;

-- ─── Sub-lot check-out (drying → pending) ────────────────────────────────────

CREATE OR REPLACE FUNCTION qc_check_out_sub_lot(
    p_sub_lot_id uuid,
    p_out_time timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    s qc_drying_sub_lot%ROWTYPE;
    out_t timestamptz := COALESCE(p_out_time, now());
BEGIN
    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sub-lot not found'; END IF;
    IF s.status <> 'drying' THEN
        RAISE EXCEPTION 'Cannot check out: sub-lot status is %', s.status;
    END IF;

    UPDATE qc_drying_sub_lot
    SET out_time = out_t, status = 'pending', updated_at = now()
    WHERE id = p_sub_lot_id;

    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    VALUES (p_sub_lot_id, 'check_out',
            jsonb_build_object('out_time', out_t, 'status', 'pending'),
            auth.uid());

    RETURN qc_sub_lot_to_json(p_sub_lot_id);
END;
$$;

-- ─── Submit inspection (pending → inspecting → passed/hold) ─────────────────

CREATE OR REPLACE FUNCTION qc_submit_inspection(
    p_sub_lot_id uuid,
    p_aw numeric
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    s qc_drying_sub_lot%ROWTYPE;
    lot qc_production_lot%ROWTYPE;
    tmpl qc_inspection_template%ROWTYPE;
    judged text;
    new_status text;
    event_type text;
    rec_id uuid;
BEGIN
    IF p_aw IS NULL OR p_aw < 0 OR p_aw > 2 THEN
        RAISE EXCEPTION 'Invalid Aw value: %', p_aw;
    END IF;

    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sub-lot not found'; END IF;

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

    INSERT INTO qc_inspection_record (drying_sub_lot_id, inspector_auth_id, values_json, result)
    VALUES (p_sub_lot_id, auth.uid(), jsonb_build_object('aw', p_aw), judged)
    RETURNING id INTO rec_id;

    IF judged = 'pass' THEN
        new_status := 'passed';
        event_type := 'inspection_passed';
    ELSE
        new_status := 'hold';
        event_type := 'inspection_failed_hold';
    END IF;

    UPDATE qc_drying_sub_lot SET status = new_status, updated_at = now() WHERE id = p_sub_lot_id;

    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    VALUES (p_sub_lot_id, event_type,
            jsonb_build_object('aw', p_aw, 'result', judged, 'limits', jsonb_build_array(tmpl.lower_limit, tmpl.upper_limit)),
            auth.uid());

    RETURN jsonb_build_object(
        'id', rec_id,
        'drying_sub_lot_id', p_sub_lot_id,
        'result', judged,
        'values_json', jsonb_build_object('aw', p_aw),
        'submitted_at', now(),
        'new_status', new_status
    );
END;
$$;

-- ─── Create disposition (hold → disposing → closed) ──────────────────────────

CREATE OR REPLACE FUNCTION qc_create_disposition(
    p_sub_lot_id uuid,
    p_type text,
    p_remark text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    s qc_drying_sub_lot%ROWTYPE;
    new_id uuid;
BEGIN
    IF p_type NOT IN ('rework', 'grind', 'scrap', 'concession') THEN
        RAISE EXCEPTION 'Invalid disposition type: %', p_type;
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

    INSERT INTO qc_disposition (drying_sub_lot_id, type, remark, operator_auth_id)
    VALUES (p_sub_lot_id, p_type, p_remark, auth.uid())
    RETURNING id INTO new_id;

    UPDATE qc_drying_sub_lot SET status = 'closed', updated_at = now() WHERE id = p_sub_lot_id;

    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    VALUES (p_sub_lot_id, 'disposition_completed',
            jsonb_build_object('type', p_type, 'remark', p_remark),
            auth.uid());

    RETURN jsonb_build_object(
        'id', new_id,
        'drying_sub_lot_id', p_sub_lot_id,
        'type', p_type,
        'remark', p_remark,
        'created_at', now(),
        'new_status', 'closed'
    );
END;
$$;

-- ─── Listing helpers (return jsonb arrays) ──────────────────────────────────

CREATE OR REPLACE FUNCTION qc_list_pending_inspections() RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT COALESCE(jsonb_agg(qc_sub_lot_to_json(s.id) ORDER BY s.out_time ASC NULLS LAST), '[]'::jsonb)
    FROM qc_drying_sub_lot s
    WHERE s.status IN ('pending', 'inspecting');
$$;

CREATE OR REPLACE FUNCTION qc_list_production_lots() RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', lot.id,
            'lot_number', lot.lot_number,
            'lot_barcode', lot.lot_barcode,
            'work_order_barcode', lot.work_order_barcode,
            'sku_id', lot.sku_id,
            'sku_code', sku.code,
            'sku_name', sku.name,
            'created_at', lot.created_at
        ) ORDER BY lot.created_at DESC
    ), '[]'::jsonb)
    FROM qc_production_lot lot
    LEFT JOIN qc_product_sku sku ON sku.id = lot.sku_id;
$$;

CREATE OR REPLACE FUNCTION qc_list_sub_lots(p_production_lot_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT COALESCE(jsonb_agg(qc_sub_lot_to_json(s.id) ORDER BY s.created_at DESC), '[]'::jsonb)
    FROM qc_drying_sub_lot s
    WHERE p_production_lot_id IS NULL OR s.production_lot_id = p_production_lot_id;
$$;

CREATE OR REPLACE FUNCTION qc_list_products() RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', sku.id,
            'code', sku.code,
            'name', sku.name,
            'standard_drying_minutes', sku.standard_drying_minutes,
            'templates', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'id', t.id,
                    'sku_id', t.sku_id,
                    'item_name', t.item_name,
                    'unit', t.unit,
                    'lower_limit', t.lower_limit,
                    'upper_limit', t.upper_limit
                ))
                FROM qc_inspection_template t WHERE t.sku_id = sku.id
            ), '[]'::jsonb)
        ) ORDER BY sku.code
    ), '[]'::jsonb)
    FROM qc_product_sku sku;
$$;

CREATE OR REPLACE FUNCTION qc_list_locations() RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object('id', l.id, 'code', l.code, 'display_name', l.display_name) ORDER BY l.code
    ), '[]'::jsonb)
    FROM qc_drying_location l;
$$;

-- ─── Production lot detail (with sub-lots + last 50 events) ─────────────────

CREATE OR REPLACE FUNCTION qc_production_lot_detail(p_lot_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
    lot qc_production_lot%ROWTYPE;
    sku qc_product_sku%ROWTYPE;
BEGIN
    SELECT * INTO lot FROM qc_production_lot WHERE id = p_lot_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Production lot not found'; END IF;
    SELECT * INTO sku FROM qc_product_sku WHERE id = lot.sku_id;

    RETURN jsonb_build_object(
        'lot', jsonb_build_object(
            'id', lot.id,
            'lot_number', lot.lot_number,
            'lot_barcode', lot.lot_barcode,
            'work_order_barcode', lot.work_order_barcode,
            'sku_id', lot.sku_id,
            'sku_code', sku.code,
            'sku_name', sku.name,
            'created_at', lot.created_at
        ),
        'sub_lots', COALESCE((
            SELECT jsonb_agg(qc_sub_lot_to_json(s.id) ORDER BY s.created_at)
            FROM qc_drying_sub_lot s WHERE s.production_lot_id = p_lot_id
        ), '[]'::jsonb),
        'events', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', ev.id,
                'event_type', ev.event_type,
                'payload', ev.payload,
                'created_at', ev.created_at,
                'sub_lot_code', s2.sub_lot_code,
                'summary', qc_quality_event_summary(ev.event_type, ev.payload, s2.sub_lot_code)
            ) ORDER BY ev.created_at DESC)
            FROM qc_quality_event ev
            LEFT JOIN qc_drying_sub_lot s2 ON s2.id = ev.drying_sub_lot_id
            WHERE ev.drying_sub_lot_id IN (SELECT id FROM qc_drying_sub_lot WHERE production_lot_id = p_lot_id)
            LIMIT 50
        ), '[]'::jsonb)
    );
END;
$$;

-- ─── Dashboard summary ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION qc_dashboard_summary() RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
    today_start timestamptz := date_trunc('day', now());
    pending_count integer;
    hold_count integer;
    today_passed integer;
    today_failed integer;
    pass_rate numeric;
    longest numeric;
BEGIN
    SELECT COUNT(*), MAX(EXTRACT(EPOCH FROM (now() - out_time)) / 60.0)
      INTO pending_count, longest
      FROM qc_drying_sub_lot WHERE status IN ('pending', 'inspecting');

    SELECT COUNT(*) INTO hold_count FROM qc_drying_sub_lot WHERE status = 'hold';

    SELECT COUNT(*) FILTER (WHERE result = 'pass'),
           COUNT(*) FILTER (WHERE result = 'fail')
      INTO today_passed, today_failed
      FROM qc_inspection_record
      WHERE submitted_at >= today_start;

    pass_rate := CASE WHEN (today_passed + today_failed) > 0
                      THEN ROUND(today_passed::numeric / (today_passed + today_failed) * 100, 1)
                      ELSE NULL END;

    RETURN jsonb_build_object(
        'pending_count', pending_count,
        'longest_wait_minutes', CASE WHEN longest IS NOT NULL THEN ROUND(longest, 1) END,
        'hold_count', hold_count,
        'today_passed', today_passed,
        'today_failed', today_failed,
        'pass_rate', pass_rate,
        'pending_items', COALESCE((
            SELECT jsonb_agg(qc_sub_lot_to_json(s.id) ORDER BY s.out_time ASC NULLS LAST)
            FROM qc_drying_sub_lot s WHERE s.status IN ('pending', 'inspecting')
        ), '[]'::jsonb),
        'holds', COALESCE((
            SELECT jsonb_agg(qc_sub_lot_to_json(s.id, true) ORDER BY s.updated_at DESC)
            FROM qc_drying_sub_lot s WHERE s.status = 'hold'
        ), '[]'::jsonb),
        'today_passed_items', COALESCE((
            SELECT jsonb_agg(qc_today_inspection_item(r.id) ORDER BY r.submitted_at DESC)
            FROM qc_inspection_record r WHERE r.submitted_at >= today_start AND r.result = 'pass'
        ), '[]'::jsonb),
        'today_failed_items', COALESCE((
            SELECT jsonb_agg(qc_today_inspection_item(r.id) ORDER BY r.submitted_at DESC)
            FROM qc_inspection_record r WHERE r.submitted_at >= today_start AND r.result = 'fail'
        ), '[]'::jsonb)
    );
END;
$$;

-- ─── Demo seed (idempotent reset; matches qc-demo §7 fixtures) ──────────────

CREATE OR REPLACE FUNCTION qc_seed_demo_data() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    loc_a_top uuid; loc_a_mid uuid; loc_a_bot uuid;
    loc_b_top uuid; loc_b_mid uuid; loc_b_bot uuid;
    sku_chicken uuid; sku_rawhide uuid;
    lot1_id uuid; lot2_id uuid;
    sl1 uuid; sl2 uuid; sl3 uuid;
BEGIN
    TRUNCATE
        qc_quality_event,
        qc_disposition,
        qc_inspection_record,
        qc_drying_sub_lot,
        qc_production_lot,
        qc_inspection_template,
        qc_drying_location,
        qc_product_sku
    RESTART IDENTITY CASCADE;

    INSERT INTO qc_drying_location (code, display_name) VALUES ('DRY-A-TOP', 'Dryer A - Top') RETURNING id INTO loc_a_top;
    INSERT INTO qc_drying_location (code, display_name) VALUES ('DRY-A-MID', 'Dryer A - Middle') RETURNING id INTO loc_a_mid;
    INSERT INTO qc_drying_location (code, display_name) VALUES ('DRY-A-BOT', 'Dryer A - Bottom') RETURNING id INTO loc_a_bot;
    INSERT INTO qc_drying_location (code, display_name) VALUES ('DRY-B-TOP', 'Dryer B - Top') RETURNING id INTO loc_b_top;
    INSERT INTO qc_drying_location (code, display_name) VALUES ('DRY-B-MID', 'Dryer B - Middle') RETURNING id INTO loc_b_mid;
    INSERT INTO qc_drying_location (code, display_name) VALUES ('DRY-B-BOT', 'Dryer B - Bottom') RETURNING id INTO loc_b_bot;

    INSERT INTO qc_product_sku (code, name, standard_drying_minutes)
    VALUES ('SKU-CHICKEN', 'Chicken Jerky (post-dry)', 240) RETURNING id INTO sku_chicken;
    INSERT INTO qc_inspection_template (sku_id, item_name, unit, lower_limit, upper_limit)
    VALUES (sku_chicken, 'Water Activity (Aw)', NULL, 0.65, 0.75);

    INSERT INTO qc_product_sku (code, name, standard_drying_minutes)
    VALUES ('SKU-COWHID', 'Rawhide Roll (post-dry)', 360) RETURNING id INTO sku_rawhide;
    INSERT INTO qc_inspection_template (sku_id, item_name, unit, lower_limit, upper_limit)
    VALUES (sku_rawhide, 'Water Activity (Aw)', NULL, 0.55, 0.68);

    INSERT INTO qc_production_lot (lot_number, lot_barcode, work_order_barcode, sku_id)
    VALUES ('DEMO-20260517-01', 'LOT-DEMO-001', 'WO-DEMO-001', sku_chicken) RETURNING id INTO lot1_id;
    INSERT INTO qc_production_lot (lot_number, lot_barcode, work_order_barcode, sku_id)
    VALUES ('DEMO-20260516-02', 'LOT-DEMO-002', 'WO-DEMO-002', sku_rawhide) RETURNING id INTO lot2_id;

    INSERT INTO qc_drying_sub_lot (production_lot_id, sub_lot_code, location_id, in_time, out_time, status)
    VALUES (lot1_id, 'LOT-DEMO-001-D01', loc_a_top, now() - interval '4 hours', now() - interval '1 hour', 'pending')
    RETURNING id INTO sl1;
    INSERT INTO qc_drying_sub_lot (production_lot_id, sub_lot_code, location_id, in_time, out_time, status)
    VALUES (lot1_id, 'LOT-DEMO-001-D02', loc_a_mid, now() - interval '3 hours', now() - interval '30 minutes', 'pending')
    RETURNING id INTO sl2;
    INSERT INTO qc_drying_sub_lot (production_lot_id, sub_lot_code, location_id, in_time, out_time, status)
    VALUES (lot2_id, 'LOT-DEMO-002-D01', loc_b_top, now() - interval '29 hours', now() - interval '26 hours', 'passed')
    RETURNING id INTO sl3;

    INSERT INTO qc_inspection_record (drying_sub_lot_id, inspector_auth_id, values_json, result, submitted_at)
    VALUES (sl3, NULL, jsonb_build_object('aw', 0.62), 'pass', now() - interval '1 day');

    RETURN jsonb_build_object('skus', 2, 'locations', 6, 'production_lots', 2, 'drying_sub_lots', 3);
END;
$$;

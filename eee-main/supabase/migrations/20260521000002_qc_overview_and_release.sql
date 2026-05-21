-- Migration M-041: Unified QC Overview RPC + release_pass action
--
-- Powers the merged "QC Home + Dashboard" page:
--   • daily stat cards (drying / awaiting sample / awaiting WA result /
--     passed today / failed today / room-temp drying)
--   • "Needs attention" recent list of pass/fail carts with assign-next-step
--     action (Pass → release/close; Fail → DispositionPicker)
--
-- Adds `qc.dashboard.release_pass` permission (BR-Q19 — one action, one switch).

-- ── 1) Helper: does a sub-lot currently have a pending (un-inspected) sample? ─

CREATE OR REPLACE FUNCTION qc_sub_lot_has_pending_sample(p_sub_lot_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM qc_sample
    WHERE drying_sub_lot_id = p_sub_lot_id AND status = 'pending'
  );
$$;

-- ── 2) Expose has_pending_sample + latest_pending_sample_id on every sub-lot json ─

CREATE OR REPLACE FUNCTION qc_sub_lot_to_json(p_sub_lot_id uuid, p_include_hold_detail boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
    s qc_drying_sub_lot%ROWTYPE;
    loc qc_drying_location%ROWTYPE;
    lot qc_production_lot%ROWTYPE;
    sku qc_product_sku%ROWTYPE;
    tmpl qc_inspection_template%ROWTYPE;
    rec qc_inspection_record%ROWTYPE;
    pending_sample qc_sample%ROWTYPE;
    wait_minutes numeric := NULL;
    eta timestamptz := NULL;
    total_dried numeric;
    remaining_min numeric := NULL;
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

    total_dried := qc_total_dried_minutes(s.id);
    IF s.expected_dry_minutes IS NOT NULL THEN
      remaining_min := s.expected_dry_minutes - total_dried;
      IF s.status = 'drying' THEN
        eta := now() + (remaining_min * interval '1 minute');
      END IF;
    END IF;

    SELECT * INTO pending_sample FROM qc_sample
    WHERE drying_sub_lot_id = s.id AND status = 'pending'
    ORDER BY taken_at DESC LIMIT 1;

    result := jsonb_build_object(
        'id', s.id,
        'production_lot_id', s.production_lot_id,
        'sub_lot_code', s.sub_lot_code,
        'location_id', s.location_id,
        'location_name', loc.display_name,
        'dryer_number', loc.dryer_number,
        'cell_number', loc.cell_number,
        'in_time', s.in_time,
        'out_time', s.out_time,
        'status', s.status,
        'expected_dry_minutes', s.expected_dry_minutes,
        'expected_finish_at', eta,
        'total_dried_minutes', total_dried,
        'remaining_minutes', remaining_min,
        'lot_barcode', lot.lot_barcode,
        'lot_number', lot.lot_number,
        'sku_name', sku.name,
        'wait_minutes', wait_minutes,
        'has_pending_sample', pending_sample.id IS NOT NULL,
        'latest_pending_sample_id', pending_sample.sample_id,
        'latest_pending_sample_pk', pending_sample.id,
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

-- ── 3) Release passed sub-lot (item 3 "assign next step" for Pass) ──────────

CREATE OR REPLACE FUNCTION qc_release_passed_sub_lot(p_sub_lot_id uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  s qc_drying_sub_lot%ROWTYPE;
BEGIN
  SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sub-lot not found'; END IF;
  IF s.status <> 'passed' THEN
    RAISE EXCEPTION 'Cannot release: sub-lot status is %, expected passed', s.status;
  END IF;

  UPDATE qc_drying_sub_lot
  SET status = 'closed', updated_at = now()
  WHERE id = p_sub_lot_id;

  INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
  VALUES (p_sub_lot_id, 'released',
          jsonb_build_object('sub_lot_code', s.sub_lot_code, 'released_at', now()),
          auth.uid());

  RETURN qc_sub_lot_to_json(p_sub_lot_id);
END;
$$;

-- ── 4) qc_overview() — unified Home + Dashboard payload ─────────────────────

CREATE OR REPLACE FUNCTION qc_overview() RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
    day_start timestamptz := date_trunc('day', now());
    day_end   timestamptz := date_trunc('day', now()) + interval '1 day';
    -- counts
    drying_count integer;
    expected_today integer;
    awaiting_sample integer;
    awaiting_wa integer;
    room_temp_count integer;
    passed_today integer;
    failed_today integer;
    longest_wait numeric;
    pass_rate numeric;
BEGIN
    SELECT COUNT(*) INTO drying_count
      FROM qc_drying_sub_lot WHERE status = 'drying';

    -- "Expected to finish drying today" = drying sub-lots whose ETA falls today.
    SELECT COUNT(*) INTO expected_today
      FROM qc_drying_sub_lot s
      WHERE s.status = 'drying'
        AND s.in_time IS NOT NULL
        AND s.expected_dry_minutes IS NOT NULL
        AND (s.in_time + (s.expected_dry_minutes * interval '1 minute')) < day_end
        AND (s.in_time + (s.expected_dry_minutes * interval '1 minute')) >= day_start;

    SELECT COUNT(*) INTO awaiting_sample
      FROM qc_drying_sub_lot s
      WHERE s.status = 'pending'
        AND NOT qc_sub_lot_has_pending_sample(s.id);

    SELECT COUNT(*) INTO awaiting_wa
      FROM qc_drying_sub_lot s
      WHERE (s.status = 'pending' AND qc_sub_lot_has_pending_sample(s.id))
         OR s.status = 'inspecting';

    SELECT COUNT(*) INTO room_temp_count
      FROM qc_drying_sub_lot WHERE status = 'room_temp_drying';

    SELECT COUNT(*) INTO passed_today
      FROM qc_inspection_record
      WHERE submitted_at >= day_start AND submitted_at < day_end AND result = 'pass';

    SELECT COUNT(*) INTO failed_today
      FROM qc_inspection_record
      WHERE submitted_at >= day_start AND submitted_at < day_end AND result = 'fail';

    SELECT MAX(EXTRACT(EPOCH FROM (now() - out_time)) / 60.0)
      INTO longest_wait
      FROM qc_drying_sub_lot
      WHERE status = 'pending' AND out_time IS NOT NULL;

    pass_rate := CASE WHEN (passed_today + failed_today) > 0
                      THEN ROUND(passed_today::numeric / (passed_today + failed_today) * 100, 1)
                      ELSE NULL END;

    RETURN jsonb_build_object(
        'today', to_char(day_start, 'YYYY-MM-DD'),
        'stats', jsonb_build_object(
            'expected_finish_today', expected_today,
            'currently_drying',      drying_count,
            'room_temp_drying',      room_temp_count,
            'awaiting_sample',       awaiting_sample,
            'awaiting_wa_result',    awaiting_wa,
            'passed_today',          passed_today,
            'failed_today',          failed_today,
            'longest_wait_minutes',  CASE WHEN longest_wait IS NOT NULL THEN ROUND(longest_wait, 1) END,
            'pass_rate_pct',         pass_rate
        ),
        -- Needs attention: latest inspection records in the last 24h,
        -- attached with their sub-lot summary so the UI can route to dispose/release.
        'needs_attention', COALESCE((
            SELECT jsonb_agg(item ORDER BY (item->>'submitted_at') DESC)
            FROM (
                SELECT jsonb_build_object(
                    'inspection_id',     ir.id,
                    'drying_sub_lot_id', ir.drying_sub_lot_id,
                    'sub_lot_code',      s.sub_lot_code,
                    'sku_name',          sku.name,
                    'lot_number',        lot.lot_number,
                    'aw',                (ir.values_json->>'aw')::numeric,
                    'result',            ir.result,
                    'submitted_at',      ir.submitted_at,
                    'current_status',    s.status,
                    'sample_id',         (SELECT sa.sample_id FROM qc_sample sa WHERE sa.id = ir.sample_id)
                ) AS item
                FROM qc_inspection_record ir
                JOIN qc_drying_sub_lot s   ON s.id = ir.drying_sub_lot_id
                LEFT JOIN qc_production_lot lot ON lot.id = s.production_lot_id
                LEFT JOIN qc_product_sku sku ON sku.id = lot.sku_id
                WHERE ir.submitted_at >= now() - interval '24 hours'
                ORDER BY ir.submitted_at DESC
                LIMIT 50
            ) sub
        ), '[]'::jsonb)
    );
END;
$$;

-- ── 5) Grant the new dashboard.release_pass permission to the dev user ─────

INSERT INTO user_permission_grant (user_id, module_id, resource, permission, approval_limit)
SELECT eu.id, 'qc', 'dashboard', 'release_pass', NULL
FROM erp_user eu
WHERE eu.email = 'ysha@smu.edu'
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;

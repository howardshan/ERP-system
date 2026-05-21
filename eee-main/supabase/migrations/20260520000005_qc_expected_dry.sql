-- Migration M-037: Expected drying duration + per-dryer summary
--
-- Adds `expected_dry_minutes` on the sub-lot so each cart has a target dwell
-- time set at creation (in the Production form). The Dry Room detail page
-- uses this to show a countdown for each occupied cell + sort the right-side
-- list by "fastest to finish first".
--
-- Also adds qc_dry_room_summary() — the new Dry Rooms list page consumes this
-- to show 5 cards (one per physical dryer) with occupancy + next-finish time.

ALTER TABLE qc_drying_sub_lot
  ADD COLUMN IF NOT EXISTS expected_dry_minutes int;

-- ─── qc_sub_lot_to_json: expose expected_dry_minutes + derived eta ──────────

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
    eta timestamptz := NULL;
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

    IF s.in_time IS NOT NULL AND s.expected_dry_minutes IS NOT NULL THEN
        eta := s.in_time + (s.expected_dry_minutes * interval '1 minute');
    END IF;

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

-- ─── qc_create_sub_lot: accept expected_dry_minutes ──────────────────────────

CREATE OR REPLACE FUNCTION qc_create_sub_lot(
    p_production_lot_id uuid,
    p_sub_lot_code text DEFAULT NULL,
    p_expected_dry_minutes int DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    lot qc_production_lot%ROWTYPE;
    code text;
    seq integer;
    new_id uuid;
BEGIN
    SELECT * INTO lot FROM qc_production_lot WHERE id = p_production_lot_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Production lot not found'; END IF;

    SELECT COUNT(*) + 1 INTO seq FROM qc_drying_sub_lot WHERE production_lot_id = p_production_lot_id;
    code := COALESCE(p_sub_lot_code, lot.lot_barcode || '-D' || LPAD(seq::text, 2, '0'));

    IF EXISTS (SELECT 1 FROM qc_drying_sub_lot WHERE sub_lot_code = code) THEN
        RAISE EXCEPTION 'Sub-lot code already exists: %', code;
    END IF;

    INSERT INTO qc_drying_sub_lot (production_lot_id, sub_lot_code, status, expected_dry_minutes)
    VALUES (p_production_lot_id, code, 'created', p_expected_dry_minutes)
    RETURNING id INTO new_id;

    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    VALUES (new_id, 'sub_lot_created',
            jsonb_build_object('sub_lot_code', code, 'expected_dry_minutes', p_expected_dry_minutes),
            auth.uid());

    RETURN qc_sub_lot_to_json(new_id);
END;
$$;

-- ─── qc_dry_room_summary: 5 dryer-level stats cards ─────────────────────────

CREATE OR REPLACE FUNCTION qc_dry_room_summary() RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH per_dryer AS (
    SELECT
      l.dryer_number,
      COUNT(s.id) FILTER (WHERE s.status IN ('drying','pending','inspecting','hold','disposing')) AS occupied,
      COUNT(s.id) FILTER (WHERE s.status = 'drying') AS drying_count,
      MIN(s.in_time + (s.expected_dry_minutes * interval '1 minute'))
        FILTER (WHERE s.status = 'drying' AND s.expected_dry_minutes IS NOT NULL) AS next_finish_at
    FROM qc_drying_location l
    LEFT JOIN qc_drying_sub_lot s ON s.location_id = l.id
    WHERE l.dryer_number IS NOT NULL
    GROUP BY l.dryer_number
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'dryer_number', d.n,
      'total_cells', 100,
      'occupied_count', COALESCE(p.occupied, 0),
      'available_count', 100 - COALESCE(p.occupied, 0),
      'drying_count', COALESCE(p.drying_count, 0),
      'next_finish_at', p.next_finish_at
    ) ORDER BY d.n
  ), '[]'::jsonb)
  FROM generate_series(1, 5) AS d(n)
  LEFT JOIN per_dryer p ON p.dryer_number = d.n;
$$;

-- ─── qc_list_sub_lots_by_dryer: sub-lots in a specific dryer ────────────────

CREATE OR REPLACE FUNCTION qc_list_sub_lots_by_dryer(p_dryer_number int) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(
    qc_sub_lot_to_json(s.id)
    ORDER BY
      CASE WHEN s.status = 'drying' AND s.expected_dry_minutes IS NOT NULL
           THEN s.in_time + (s.expected_dry_minutes * interval '1 minute')
           ELSE 'infinity'::timestamptz END ASC
  ), '[]'::jsonb)
  FROM qc_drying_sub_lot s
  INNER JOIN qc_drying_location l ON l.id = s.location_id
  WHERE l.dryer_number = p_dryer_number
    AND s.status IN ('drying','pending','inspecting','hold','disposing');
$$;

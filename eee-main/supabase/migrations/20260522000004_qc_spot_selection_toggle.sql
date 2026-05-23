-- Migration M-047: Spot-selection toggle + bulk dryer check-in
--
-- Adds a runtime feature flag (qc.spot_selection_enabled) that lets us
-- turn the per-cell placement UI on/off without removing the existing
-- grid code. When OFF (default), the flow is:
--   1. operator selects (or scans) N awaiting sub-lots
--   2. clicks "Check in to Dryer N"
--   3. confirmation modal shows total + warns about ineligible carts
--   4. on confirm, all carts enter `drying` status with dryer_number set
--      but location_id = NULL (no cell assignment)
-- The 5×100 capacity model stays the same — each cart still occupies 1
-- of the dryer's 100 slots, so the dashboard occupancy logic is unchanged.
--
-- Schema-wise we add `dryer_number` directly on qc_drying_sub_lot to
-- support the "in dryer N without a specific cell" state. When spot
-- selection is ON, dryer_number is derived from the location row.

-- ── 1) app_settings table (generic key/value config) ────────────────────────

CREATE TABLE IF NOT EXISTS app_settings (
  key          text PRIMARY KEY,
  value        jsonb NOT NULL,
  description  text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dev_all_app_settings" ON app_settings FOR ALL USING (true) WITH CHECK (true);

INSERT INTO app_settings (key, value, description)
VALUES (
  'qc.spot_selection_enabled',
  'false'::jsonb,
  'When true, dry-room check-in requires picking a specific cell (00..99) on the 10x10 grid. When false, sub-lots check into a dryer as a whole with no cell assignment; the existing grid UI is hidden but kept in code.'
)
ON CONFLICT (key) DO NOTHING;

-- ── 2) Generic setting accessor ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_app_setting(p_key text) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT value FROM app_settings WHERE key = p_key;
$$;

-- ── 3) qc_drying_sub_lot.dryer_number column ────────────────────────────────

ALTER TABLE qc_drying_sub_lot
  ADD COLUMN IF NOT EXISTS dryer_number int
    CHECK (dryer_number IS NULL OR (dryer_number BETWEEN 1 AND 5));

-- Backfill from existing locations
UPDATE qc_drying_sub_lot s
SET dryer_number = l.dryer_number
FROM qc_drying_location l
WHERE s.location_id = l.id
  AND s.dryer_number IS NULL
  AND l.dryer_number IS NOT NULL;

-- ── 4) Update qc_sub_lot_to_json to surface dryer_number directly ──────────

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
    effective_dryer int;
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

    -- Prefer column dryer_number; fall back to location.dryer_number
    effective_dryer := COALESCE(s.dryer_number, loc.dryer_number);

    result := jsonb_build_object(
        'id', s.id,
        'production_lot_id', s.production_lot_id,
        'sub_lot_code', s.sub_lot_code,
        'location_id', s.location_id,
        'location_name', loc.display_name,
        'dryer_number', effective_dryer,
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
        'sku_id', lot.sku_id,
        'sku_code', sku.code,
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

-- ── 5) Bulk check-in: no cell, just dryer number ────────────────────────────

CREATE OR REPLACE FUNCTION qc_register_sub_lots_in_dryer_bulk(
    p_sub_lot_ids uuid[],
    p_dryer_number int,
    p_in_time timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    in_t timestamptz := COALESCE(p_in_time, now());
    sub_id uuid;
    s qc_drying_sub_lot%ROWTYPE;
    occupied integer;
    requested integer := array_length(p_sub_lot_ids, 1);
    succeeded jsonb := '[]'::jsonb;
    failed jsonb := '[]'::jsonb;
BEGIN
    IF p_dryer_number IS NULL OR p_dryer_number NOT BETWEEN 1 AND 5 THEN
        RAISE EXCEPTION 'Invalid dryer_number: %', p_dryer_number;
    END IF;

    -- Capacity check: existing active sub-lots in this dryer + incoming
    SELECT COUNT(*) INTO occupied
      FROM qc_drying_sub_lot
      WHERE COALESCE(dryer_number,
        (SELECT l.dryer_number FROM qc_drying_location l WHERE l.id = qc_drying_sub_lot.location_id)
      ) = p_dryer_number
        AND status IN ('drying', 'pending', 'inspecting', 'hold', 'disposing');

    IF occupied + COALESCE(requested, 0) > 100 THEN
        RAISE EXCEPTION 'Dryer % is full (% / 100 occupied, requesting %)',
                        p_dryer_number, occupied, requested;
    END IF;

    -- Loop and validate each sub-lot; collect successes and failures
    FOREACH sub_id IN ARRAY p_sub_lot_ids LOOP
        SELECT * INTO s FROM qc_drying_sub_lot WHERE id = sub_id FOR UPDATE;
        IF NOT FOUND THEN
            failed := failed || jsonb_build_array(jsonb_build_object(
                'sub_lot_id', sub_id, 'reason', 'not_found'));
            CONTINUE;
        END IF;
        IF s.status NOT IN ('created', 'awaiting_recheck') THEN
            failed := failed || jsonb_build_array(jsonb_build_object(
                'sub_lot_id', sub_id,
                'sub_lot_code', s.sub_lot_code,
                'reason', 'wrong_status',
                'status', s.status));
            CONTINUE;
        END IF;

        UPDATE qc_drying_sub_lot
        SET location_id   = NULL,
            dryer_number  = p_dryer_number,
            in_time       = COALESCE(s.in_time, in_t),
            status        = 'drying',
            updated_at    = now()
        WHERE id = sub_id;

        -- Open a spot_history row (no cell info)
        INSERT INTO qc_sub_lot_spot_history (drying_sub_lot_id, location_id, dryer_number, cell_number, started_at)
        VALUES (sub_id, NULL, p_dryer_number, NULL, in_t);

        INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
        VALUES (sub_id,
                CASE WHEN s.status = 'awaiting_recheck' THEN 'resume_drying' ELSE 'check_in' END,
                jsonb_build_object(
                    'sub_lot_code', s.sub_lot_code,
                    'in_time', in_t,
                    'dryer_number', p_dryer_number,
                    'cell_number', NULL,
                    'mode', 'no_spot',
                    'previous_status', s.status
                ),
                auth.uid());

        succeeded := succeeded || jsonb_build_array(jsonb_build_object(
            'sub_lot_id', sub_id,
            'sub_lot_code', s.sub_lot_code));
    END LOOP;

    RETURN jsonb_build_object(
        'dryer_number', p_dryer_number,
        'requested', COALESCE(requested, 0),
        'succeeded', succeeded,
        'failed', failed
    );
END;
$$;

-- ── 6) Update qc_list_sub_lots_by_dryer to read from dryer_number column ────

CREATE OR REPLACE FUNCTION qc_list_sub_lots_by_dryer(p_dryer_number int) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(
    qc_sub_lot_to_json(s.id)
    ORDER BY
      CASE WHEN s.status = 'drying' AND s.expected_dry_minutes IS NOT NULL
           THEN s.in_time + (s.expected_dry_minutes * interval '1 minute')
           ELSE 'infinity'::timestamptz END ASC
  ), '[]'::jsonb)
  FROM qc_drying_sub_lot s
  LEFT JOIN qc_drying_location l ON l.id = s.location_id
  WHERE COALESCE(s.dryer_number, l.dryer_number) = p_dryer_number
    AND s.status IN ('drying','pending','inspecting','hold','disposing');
$$;

-- ── 7) Update qc_dry_room_summary so occupancy counts sub-lots by either
--      direct dryer_number OR via location join (mixed-mode support) ────────

CREATE OR REPLACE FUNCTION qc_dry_room_summary() RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH per_dryer AS (
    SELECT
      COALESCE(s.dryer_number, l.dryer_number) AS dryer_number,
      COUNT(s.id) FILTER (WHERE s.status IN ('drying','pending','inspecting','hold','disposing')) AS occupied,
      COUNT(s.id) FILTER (WHERE s.status = 'drying') AS drying_count,
      MIN(s.in_time + (s.expected_dry_minutes * interval '1 minute'))
        FILTER (WHERE s.status = 'drying' AND s.expected_dry_minutes IS NOT NULL) AS next_finish_at
    FROM qc_drying_sub_lot s
    LEFT JOIN qc_drying_location l ON l.id = s.location_id
    WHERE COALESCE(s.dryer_number, l.dryer_number) IS NOT NULL
    GROUP BY COALESCE(s.dryer_number, l.dryer_number)
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

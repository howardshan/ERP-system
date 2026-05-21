-- Migration M-036: Dryer grid (5 dryers × 100 cells) + 'created' status + check-in flow
--
-- Splits the existing one-step "create sub-lot in drying" into two steps:
--   1) Production form creates sub-lots in 'created' status (no location, no in_time).
--   2) Check-in to Dryer page picks a sub-lot + clicks a grid cell + confirms,
--      which moves 'created' → 'drying' and stamps location_id + in_time.
--
-- The dryer layout is fixed at 5 dryers, each a 10×10 grid (cells numbered 0..99,
-- displayed as "00".."99" in UI). Total: 500 cells.

-- ── 1) Loosen FK so we can reseed locations without violating ────────────────

ALTER TABLE qc_drying_sub_lot
  DROP CONSTRAINT IF EXISTS qc_drying_sub_lot_location_id_fkey;

ALTER TABLE qc_drying_sub_lot
  ADD CONSTRAINT qc_drying_sub_lot_location_id_fkey
    FOREIGN KEY (location_id) REFERENCES qc_drying_location(id) ON DELETE SET NULL;

-- ── 2) Add 'created' status (created in production, awaiting placement) ──────

ALTER TABLE qc_drying_sub_lot DROP CONSTRAINT IF EXISTS qc_drying_sub_lot_status_check;
ALTER TABLE qc_drying_sub_lot ADD CONSTRAINT qc_drying_sub_lot_status_check
  CHECK (status IN (
    'created', 'drying', 'pending', 'inspecting', 'passed', 'hold', 'disposing', 'closed'
  ));

-- ── 3) Restructure location: add dryer_number + cell_number columns ─────────

ALTER TABLE qc_drying_location
  ADD COLUMN IF NOT EXISTS dryer_number int,
  ADD COLUMN IF NOT EXISTS cell_number int;        -- 0..99, displayed as 00..99

DELETE FROM qc_drying_location;
-- (sub-lot location_id rows now NULL thanks to ON DELETE SET NULL above)

INSERT INTO qc_drying_location (code, display_name, dryer_number, cell_number)
SELECT
  'DR' || d.n || '-' || LPAD(c.n::text, 2, '0'),
  'Dryer ' || d.n || ' · Cell ' || LPAD(c.n::text, 2, '0'),
  d.n, c.n
FROM generate_series(1, 5) AS d(n)
CROSS JOIN generate_series(0, 99) AS c(n);

ALTER TABLE qc_drying_location
  ADD CONSTRAINT qc_drying_location_dryer_cell_unique UNIQUE (dryer_number, cell_number);

-- ── 4) Refresh qc_list_locations to expose new fields ───────────────────────

CREATE OR REPLACE FUNCTION qc_list_locations() RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', l.id,
            'code', l.code,
            'display_name', l.display_name,
            'dryer_number', l.dryer_number,
            'cell_number', l.cell_number
        ) ORDER BY l.dryer_number NULLS LAST, l.cell_number
    ), '[]'::jsonb)
    FROM qc_drying_location l;
$$;

-- ── 5) Update qc_sub_lot_to_json to expose dryer + cell on the row ──────────

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
        'dryer_number', loc.dryer_number,
        'cell_number', loc.cell_number,
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

-- ── 6) New: qc_create_sub_lot — Production creates sub-lot in 'created' ─────

CREATE OR REPLACE FUNCTION qc_create_sub_lot(
    p_production_lot_id uuid,
    p_sub_lot_code text DEFAULT NULL
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

    INSERT INTO qc_drying_sub_lot (production_lot_id, sub_lot_code, status)
    VALUES (p_production_lot_id, code, 'created')
    RETURNING id INTO new_id;

    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    VALUES (new_id, 'sub_lot_created', jsonb_build_object('sub_lot_code', code), auth.uid());

    RETURN qc_sub_lot_to_json(new_id);
END;
$$;

-- ── 7) New: qc_register_in_dryer — moves 'created' → 'drying' at a cell ──────

CREATE OR REPLACE FUNCTION qc_register_in_dryer(
    p_sub_lot_id uuid,
    p_location_id uuid,
    p_in_time timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    s qc_drying_sub_lot%ROWTYPE;
    in_t timestamptz := COALESCE(p_in_time, now());
    loc qc_drying_location%ROWTYPE;
BEGIN
    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sub-lot not found'; END IF;
    IF s.status <> 'created' THEN
        RAISE EXCEPTION 'Sub-lot is not awaiting check-in (status=%)', s.status;
    END IF;

    SELECT * INTO loc FROM qc_drying_location WHERE id = p_location_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Dryer cell not found'; END IF;

    -- Refuse if cell is currently occupied by another active sub-lot
    IF EXISTS (
        SELECT 1 FROM qc_drying_sub_lot
        WHERE location_id = p_location_id
          AND id <> p_sub_lot_id
          AND status IN ('drying', 'pending', 'inspecting', 'hold', 'disposing')
    ) THEN
        RAISE EXCEPTION 'Dryer cell % is already occupied', loc.code;
    END IF;

    UPDATE qc_drying_sub_lot
    SET location_id = p_location_id,
        in_time = in_t,
        status = 'drying',
        updated_at = now()
    WHERE id = p_sub_lot_id;

    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    VALUES (p_sub_lot_id, 'check_in',
            jsonb_build_object(
                'sub_lot_code', s.sub_lot_code,
                'in_time', in_t,
                'dryer_number', loc.dryer_number,
                'cell_number', loc.cell_number,
                'location_code', loc.code
            ),
            auth.uid());

    RETURN qc_sub_lot_to_json(p_sub_lot_id);
END;
$$;

-- ── 8) Patch qc_seed_demo_data to use new grid + 'created' status ────────────

CREATE OR REPLACE FUNCTION qc_seed_demo_data() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
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
        qc_product_sku
    RESTART IDENTITY CASCADE;

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
    VALUES (
      lot1_id, 'LOT-DEMO-001-D01',
      (SELECT id FROM qc_drying_location WHERE dryer_number = 1 AND cell_number = 0),
      now() - interval '4 hours', now() - interval '1 hour', 'pending'
    ) RETURNING id INTO sl1;
    INSERT INTO qc_drying_sub_lot (production_lot_id, sub_lot_code, location_id, in_time, out_time, status)
    VALUES (
      lot1_id, 'LOT-DEMO-001-D02',
      (SELECT id FROM qc_drying_location WHERE dryer_number = 1 AND cell_number = 1),
      now() - interval '3 hours', now() - interval '30 minutes', 'pending'
    ) RETURNING id INTO sl2;
    INSERT INTO qc_drying_sub_lot (production_lot_id, sub_lot_code, location_id, in_time, out_time, status)
    VALUES (
      lot2_id, 'LOT-DEMO-002-D01',
      (SELECT id FROM qc_drying_location WHERE dryer_number = 2 AND cell_number = 0),
      now() - interval '29 hours', now() - interval '26 hours', 'passed'
    ) RETURNING id INTO sl3;

    INSERT INTO qc_inspection_record (drying_sub_lot_id, inspector_auth_id, values_json, result, submitted_at)
    VALUES (sl3, NULL, jsonb_build_object('aw', 0.62), 'pass', now() - interval '1 day');

    RETURN jsonb_build_object('skus', 2, 'locations', 500, 'production_lots', 2, 'drying_sub_lots', 3);
END;
$$;

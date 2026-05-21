-- Migration M-038: Move-to-other-spot + paused awaiting_recheck + spot history
--
-- Adds a per-placement audit trail (`qc_sub_lot_spot_history`) so we can:
--   (a) Compute total dried minutes accurately even when a cart has been
--       moved or temporarily displaced.
--   (b) Support a new "awaiting_recheck" status: when an active cart is
--       displaced by a move, it's kicked out of the dryer with its previous
--       dry time preserved, and resumes accumulating when placed again.
--
-- Also rewrites qc_sub_lot_to_json to derive eta/remaining from history,
-- which is the only correct way after pauses.

-- ── 1) Status: awaiting_recheck (paused, no location) ──────────────────────

ALTER TABLE qc_drying_sub_lot DROP CONSTRAINT IF EXISTS qc_drying_sub_lot_status_check;
ALTER TABLE qc_drying_sub_lot ADD CONSTRAINT qc_drying_sub_lot_status_check
  CHECK (status IN (
    'created', 'drying', 'awaiting_recheck',
    'pending', 'inspecting', 'passed', 'hold', 'disposing', 'closed'
  ));

-- ── 2) Spot history table ──────────────────────────────────────────────────

CREATE TABLE qc_sub_lot_spot_history (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drying_sub_lot_id  uuid NOT NULL REFERENCES qc_drying_sub_lot(id) ON DELETE CASCADE,
  location_id        uuid REFERENCES qc_drying_location(id) ON DELETE SET NULL,
  dryer_number       int,
  cell_number        int,
  started_at         timestamptz NOT NULL DEFAULT now(),
  ended_at           timestamptz,
  end_reason         text CHECK (end_reason IN ('check_out', 'move', 'displaced')),
  duration_minutes   numeric(10, 2),  -- denormalised on close for cheap reads
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_qc_spot_history_sub_lot ON qc_sub_lot_spot_history(drying_sub_lot_id);
CREATE INDEX idx_qc_spot_history_open ON qc_sub_lot_spot_history(drying_sub_lot_id) WHERE ended_at IS NULL;

ALTER TABLE qc_sub_lot_spot_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dev_all" ON qc_sub_lot_spot_history FOR ALL USING (true) WITH CHECK (true);

-- ── 3) Helper: total dried minutes from history ─────────────────────────────

CREATE OR REPLACE FUNCTION qc_total_dried_minutes(p_sub_lot_id uuid) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(
    CASE
      WHEN h.ended_at IS NOT NULL THEN h.duration_minutes
      ELSE EXTRACT(EPOCH FROM (now() - h.started_at)) / 60.0
    END
  ), 0)::numeric(10, 2)
  FROM qc_sub_lot_spot_history h
  WHERE h.drying_sub_lot_id = p_sub_lot_id;
$$;

-- ── 4) Rewrite qc_sub_lot_to_json with accurate accumulated time ────────────

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

-- ── 5) qc_register_in_dryer: now also opens a spot_history row ──────────────

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
    IF s.status NOT IN ('created', 'awaiting_recheck') THEN
        RAISE EXCEPTION 'Sub-lot is not awaiting check-in (status=%)', s.status;
    END IF;

    SELECT * INTO loc FROM qc_drying_location WHERE id = p_location_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Dryer cell not found'; END IF;

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
        in_time = COALESCE(s.in_time, in_t),  -- preserve original in_time for resumes
        status = 'drying',
        updated_at = now()
    WHERE id = p_sub_lot_id;

    -- Open a new spot history row
    INSERT INTO qc_sub_lot_spot_history (drying_sub_lot_id, location_id, dryer_number, cell_number, started_at)
    VALUES (p_sub_lot_id, p_location_id, loc.dryer_number, loc.cell_number, in_t);

    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    VALUES (p_sub_lot_id,
            CASE WHEN s.status = 'awaiting_recheck' THEN 'resume_drying' ELSE 'check_in' END,
            jsonb_build_object(
                'sub_lot_code', s.sub_lot_code,
                'in_time', in_t,
                'dryer_number', loc.dryer_number,
                'cell_number', loc.cell_number,
                'location_code', loc.code,
                'previous_status', s.status
            ),
            auth.uid());

    RETURN qc_sub_lot_to_json(p_sub_lot_id);
END;
$$;

-- ── 6) qc_check_out_sub_lot: close spot_history row on exit ─────────────────

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
    SET out_time = out_t, status = 'pending', updated_at = now(), location_id = NULL
    WHERE id = p_sub_lot_id;

    -- Close the open spot_history row
    UPDATE qc_sub_lot_spot_history
    SET ended_at = out_t,
        end_reason = 'check_out',
        duration_minutes = EXTRACT(EPOCH FROM (out_t - started_at)) / 60.0
    WHERE drying_sub_lot_id = p_sub_lot_id AND ended_at IS NULL;

    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    VALUES (p_sub_lot_id, 'check_out',
            jsonb_build_object('out_time', out_t, 'status', 'pending'),
            auth.uid());

    RETURN qc_sub_lot_to_json(p_sub_lot_id);
END;
$$;

-- ── 7) NEW: qc_move_sub_lot — move active cart to another cell ──────────────

CREATE OR REPLACE FUNCTION qc_move_sub_lot(
    p_sub_lot_id uuid,
    p_new_location_id uuid
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    s qc_drying_sub_lot%ROWTYPE;
    new_loc qc_drying_location%ROWTYPE;
    displaced_id uuid;
    now_t timestamptz := now();
BEGIN
    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sub-lot not found'; END IF;
    IF s.status <> 'drying' THEN
        RAISE EXCEPTION 'Only drying sub-lots can be moved (status=%)', s.status;
    END IF;

    SELECT * INTO new_loc FROM qc_drying_location WHERE id = p_new_location_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'New cell not found'; END IF;
    IF p_new_location_id = s.location_id THEN
        RAISE EXCEPTION 'Already in this cell';
    END IF;

    -- Is the target cell occupied by another active sub-lot?
    SELECT id INTO displaced_id
    FROM qc_drying_sub_lot
    WHERE location_id = p_new_location_id
      AND id <> p_sub_lot_id
      AND status IN ('drying', 'pending', 'inspecting', 'hold', 'disposing')
    FOR UPDATE;

    IF displaced_id IS NOT NULL THEN
        -- Close the displaced cart's open spot_history row
        UPDATE qc_sub_lot_spot_history
        SET ended_at = now_t,
            end_reason = 'displaced',
            duration_minutes = EXTRACT(EPOCH FROM (now_t - started_at)) / 60.0
        WHERE drying_sub_lot_id = displaced_id AND ended_at IS NULL;

        -- Move displaced cart to awaiting_recheck (no location, paused)
        UPDATE qc_drying_sub_lot
        SET status = 'awaiting_recheck',
            location_id = NULL,
            updated_at = now_t
        WHERE id = displaced_id;

        INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
        VALUES (displaced_id, 'displaced',
                jsonb_build_object(
                    'displaced_by_sub_lot_id', s.id,
                    'displaced_by_sub_lot_code', s.sub_lot_code,
                    'new_cell', new_loc.code
                ),
                auth.uid());
    END IF;

    -- Close our cart's current spot_history row
    UPDATE qc_sub_lot_spot_history
    SET ended_at = now_t,
        end_reason = 'move',
        duration_minutes = EXTRACT(EPOCH FROM (now_t - started_at)) / 60.0
    WHERE drying_sub_lot_id = p_sub_lot_id AND ended_at IS NULL;

    -- Move our cart to the new cell
    UPDATE qc_drying_sub_lot
    SET location_id = p_new_location_id, updated_at = now_t
    WHERE id = p_sub_lot_id;

    -- Open new spot_history row
    INSERT INTO qc_sub_lot_spot_history (drying_sub_lot_id, location_id, dryer_number, cell_number, started_at)
    VALUES (p_sub_lot_id, p_new_location_id, new_loc.dryer_number, new_loc.cell_number, now_t);

    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    VALUES (p_sub_lot_id, 'moved',
            jsonb_build_object(
                'sub_lot_code', s.sub_lot_code,
                'from_location_id', s.location_id,
                'to_location_id', p_new_location_id,
                'to_cell', new_loc.code,
                'displaced_sub_lot_id', displaced_id
            ),
            auth.uid());

    RETURN qc_sub_lot_to_json(p_sub_lot_id);
END;
$$;

-- ── 8) Backfill: every existing drying sub-lot needs an open spot_history row

INSERT INTO qc_sub_lot_spot_history (drying_sub_lot_id, location_id, dryer_number, cell_number, started_at)
SELECT s.id, s.location_id, l.dryer_number, l.cell_number, s.in_time
FROM qc_drying_sub_lot s
LEFT JOIN qc_drying_location l ON l.id = s.location_id
WHERE s.status = 'drying'
  AND s.location_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM qc_sub_lot_spot_history h WHERE h.drying_sub_lot_id = s.id
  );

-- ── 9) Convenience: list sub-lots in awaiting_recheck ───────────────────────

CREATE OR REPLACE FUNCTION qc_list_awaiting_recheck() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(qc_sub_lot_to_json(s.id) ORDER BY s.updated_at), '[]'::jsonb)
  FROM qc_drying_sub_lot s
  WHERE s.status = 'awaiting_recheck';
$$;

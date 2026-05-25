-- M-080: Dryer Location CRUD + dynamic dry-room summary.
--
-- Background: qc.locations.{view,manage} permissions were defined in
-- permissionStructure.ts since M-040 but completely orphaned — no admin
-- UI ever existed.  All 500 cells (5 dryers × 100 cells) were seeded once
-- in M-036 and never editable.  Both qc_dry_room_summary (M-037 / M-047)
-- and the DryRoomsList UI HARDCODED the 5×100 layout, which would mask
-- any new dryer/cell added through the DB.
--
-- This migration:
--   1) Adds three write RPCs: qc_create_location, qc_update_location,
--      qc_delete_location.  Delete is blocked when the location is
--      currently referenced by a non-terminal sub-lot (occupancy guard).
--   2) Replaces qc_dry_room_summary with a version that derives the
--      dryer set + cell counts from qc_drying_location instead of
--      generate_series(1,5) and the hardcoded `100`.  Existing data is
--      unaffected (still 5×100 from M-036 seed) but adding a Dryer 6 or
--      adding/removing cells now flows through automatically.

-- ── qc_create_location ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION qc_create_location(
    p_dryer_number int,
    p_cell_number  int,
    p_display_name text,
    p_code         text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    new_id   uuid;
    new_code text;
BEGIN
    IF p_dryer_number IS NULL OR p_dryer_number < 1 THEN
        RAISE EXCEPTION 'dryer_number must be >= 1';
    END IF;
    IF p_cell_number IS NULL OR p_cell_number < 0 THEN
        RAISE EXCEPTION 'cell_number must be >= 0';
    END IF;
    IF p_display_name IS NULL OR length(trim(p_display_name)) = 0 THEN
        RAISE EXCEPTION 'display_name is required';
    END IF;

    -- Default code follows the seed convention "DR<N>-<NN>"
    new_code := COALESCE(
        NULLIF(trim(p_code), ''),
        'DR' || p_dryer_number || '-' || LPAD(p_cell_number::text, 2, '0')
    );

    INSERT INTO qc_drying_location (code, display_name, dryer_number, cell_number)
    VALUES (new_code, trim(p_display_name), p_dryer_number, p_cell_number)
    RETURNING id INTO new_id;

    RETURN jsonb_build_object(
        'id', new_id,
        'code', new_code,
        'display_name', trim(p_display_name),
        'dryer_number', p_dryer_number,
        'cell_number', p_cell_number
    );
END;
$$;

-- ── qc_update_location ──────────────────────────────────────────────────────
-- Only display_name and code are mutable.  dryer_number / cell_number are
-- part of the natural unique key and the live grid layout, so we don't
-- allow re-keying a row (delete + create instead).

CREATE OR REPLACE FUNCTION qc_update_location(
    p_id           uuid,
    p_display_name text,
    p_code         text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    row qc_drying_location%ROWTYPE;
BEGIN
    SELECT * INTO row FROM qc_drying_location WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Location not found'; END IF;

    IF p_display_name IS NULL OR length(trim(p_display_name)) = 0 THEN
        RAISE EXCEPTION 'display_name is required';
    END IF;

    UPDATE qc_drying_location
    SET display_name = trim(p_display_name),
        code         = COALESCE(NULLIF(trim(p_code), ''), code)
    WHERE id = p_id
    RETURNING * INTO row;

    RETURN jsonb_build_object(
        'id', row.id,
        'code', row.code,
        'display_name', row.display_name,
        'dryer_number', row.dryer_number,
        'cell_number', row.cell_number
    );
END;
$$;

-- ── qc_delete_location ──────────────────────────────────────────────────────
-- Blocks deletion when an active sub-lot is currently placed at this
-- location.  Closed/dispatched sub-lots reference the location via
-- ON DELETE SET NULL, so historical traces survive a delete; only the live
-- grid placements need the guard.

CREATE OR REPLACE FUNCTION qc_delete_location(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    row          qc_drying_location%ROWTYPE;
    occupied_by  text;
BEGIN
    SELECT * INTO row FROM qc_drying_location WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Location not found'; END IF;

    SELECT s.sub_lot_code INTO occupied_by
    FROM qc_drying_sub_lot s
    WHERE s.location_id = p_id
      AND s.status IN ('drying','pending','inspecting','hold','disposing','awaiting_recheck','room_temp_drying')
    LIMIT 1;

    IF occupied_by IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot delete %: cell is currently occupied by %', row.code, occupied_by;
    END IF;

    DELETE FROM qc_drying_location WHERE id = p_id;

    RETURN jsonb_build_object(
        'id', row.id,
        'code', row.code,
        'deleted', true
    );
END;
$$;

-- ── qc_dry_room_summary — derive dryer set + cell totals from the table ────

CREATE OR REPLACE FUNCTION qc_dry_room_summary() RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH dryer_layout AS (
    SELECT l.dryer_number, COUNT(*)::int AS total_cells
    FROM qc_drying_location l
    WHERE l.dryer_number IS NOT NULL
    GROUP BY l.dryer_number
  ),
  per_dryer AS (
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
      'dryer_number',    d.dryer_number,
      'total_cells',     d.total_cells,
      'occupied_count',  COALESCE(p.occupied, 0),
      'available_count', d.total_cells - COALESCE(p.occupied, 0),
      'drying_count',    COALESCE(p.drying_count, 0),
      'next_finish_at',  p.next_finish_at
    ) ORDER BY d.dryer_number
  ), '[]'::jsonb)
  FROM dryer_layout d
  LEFT JOIN per_dryer p ON p.dryer_number = d.dryer_number;
$$;

-- Migration M-050: Work-order expected dry time + bulk sub-lot range + move dryer + analysis & forecast RPCs
--
-- 1. qc_production_lot.expected_dry_minutes — required at lot creation (BR-Q29).
-- 2. qc_create_production_lot_with_sub_lots — atomic lot + sub-lot range creation
--    (sub_lot_code format: <lot_barcode>-NNN, zero-padded 3 digits).
-- 3. qc_add_sub_lots_to_lot — add more carts to existing work order, continuing sequence.
-- 4. qc_move_sub_lots_dryer — relocate drying carts to a different dryer (single or bulk).
-- 5. qc_dashboard_pass_rate_forecast — per-SKU pass-rate-weighted forecast.
-- 6. qc_analysis_metrics — filtered KPIs for the Analysis page.
-- 7. qc_next_sku_code — helper, auto-generates next SKU-NNNN.

-- ───────────────────────────────────────────────────────────────────────────
-- 1) Lot-level expected dry minutes (NOT NULL after backfill)
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE qc_production_lot ADD COLUMN IF NOT EXISTS expected_dry_minutes int;

UPDATE qc_production_lot pl
SET expected_dry_minutes = COALESCE(
  (SELECT MAX(expected_dry_minutes) FROM qc_drying_sub_lot
   WHERE production_lot_id = pl.id AND expected_dry_minutes IS NOT NULL),
  (SELECT standard_drying_minutes FROM qc_product_sku WHERE id = pl.sku_id),
  1440  -- 1 day fallback
)
WHERE expected_dry_minutes IS NULL;

ALTER TABLE qc_production_lot ALTER COLUMN expected_dry_minutes SET NOT NULL;

ALTER TABLE qc_production_lot DROP CONSTRAINT IF EXISTS chk_pl_expected_dry_positive;
ALTER TABLE qc_production_lot
  ADD CONSTRAINT chk_pl_expected_dry_positive CHECK (expected_dry_minutes > 0);

COMMENT ON COLUMN qc_production_lot.expected_dry_minutes IS
  'Required at work-order creation (BR-Q29). Inherited by all sub-lots in this lot unless explicitly overridden.';

-- ───────────────────────────────────────────────────────────────────────────
-- 2) Atomic lot + sub-lot range creation
--    sub_lot_code = <lot_barcode>-NNN (3-digit padded, BR-Q30)
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION qc_create_production_lot_with_sub_lots(
    p_lot_number text,
    p_lot_barcode text,
    p_work_order_barcode text,
    p_sku_id uuid,
    p_expected_dry_minutes int,
    p_sub_lot_start_seq int DEFAULT 1,
    p_sub_lot_end_seq int DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    new_lot_id uuid;
    i int;
    code text;
    ids uuid[] := ARRAY[]::uuid[];
    new_sl_id uuid;
    sub_count int;
BEGIN
    IF p_expected_dry_minutes IS NULL OR p_expected_dry_minutes <= 0 THEN
        RAISE EXCEPTION 'expected_dry_minutes must be > 0 (BR-Q29)';
    END IF;
    IF p_sub_lot_end_seq IS NULL OR p_sub_lot_end_seq < p_sub_lot_start_seq THEN
        RAISE EXCEPTION 'sub_lot_end_seq must be >= sub_lot_start_seq';
    END IF;
    IF p_sub_lot_start_seq < 1 THEN
        RAISE EXCEPTION 'sub_lot_start_seq must be >= 1';
    END IF;

    INSERT INTO qc_production_lot
        (lot_number, lot_barcode, work_order_barcode, sku_id, expected_dry_minutes)
    VALUES
        (p_lot_number, p_lot_barcode, p_work_order_barcode, p_sku_id, p_expected_dry_minutes)
    RETURNING id INTO new_lot_id;

    FOR i IN p_sub_lot_start_seq..p_sub_lot_end_seq LOOP
        code := p_lot_barcode || '-' || LPAD(i::text, 3, '0');
        IF EXISTS (SELECT 1 FROM qc_drying_sub_lot WHERE sub_lot_code = code) THEN
            RAISE EXCEPTION 'Sub-lot code already exists: %', code;
        END IF;
        INSERT INTO qc_drying_sub_lot
            (production_lot_id, sub_lot_code, status, expected_dry_minutes)
        VALUES
            (new_lot_id, code, 'created', p_expected_dry_minutes)
        RETURNING id INTO new_sl_id;
        ids := ids || new_sl_id;

        INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
        VALUES (new_sl_id, 'sub_lot_created',
                jsonb_build_object('sub_lot_code', code,
                                   'seq', i,
                                   'expected_dry_minutes', p_expected_dry_minutes),
                auth.uid());
    END LOOP;

    sub_count := COALESCE(array_length(ids, 1), 0);

    RETURN jsonb_build_object(
        'lot_id', new_lot_id,
        'lot_number', p_lot_number,
        'lot_barcode', p_lot_barcode,
        'expected_dry_minutes', p_expected_dry_minutes,
        'sub_lot_count', sub_count,
        'sub_lot_ids', to_jsonb(ids)
    );
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3) Add sub-lots to existing lot
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION qc_add_sub_lots_to_lot(
    p_production_lot_id uuid,
    p_start_seq int DEFAULT NULL,    -- if NULL, continue from existing max + 1
    p_end_seq int DEFAULT NULL,
    p_count int DEFAULT NULL          -- alternative to end_seq
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    lot qc_production_lot%ROWTYPE;
    existing_max int;
    start_n int;
    end_n int;
    i int;
    code text;
    new_id uuid;
    ids uuid[] := ARRAY[]::uuid[];
BEGIN
    SELECT * INTO lot FROM qc_production_lot WHERE id = p_production_lot_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Production lot not found'; END IF;

    -- Highest existing 3-digit suffix among <lot_barcode>-NNN codes
    SELECT COALESCE(MAX(NULLIF(regexp_replace(sub_lot_code, '^.*-(\d{3})$', '\1'), '')::int), 0)
    INTO existing_max
    FROM qc_drying_sub_lot
    WHERE production_lot_id = p_production_lot_id
      AND sub_lot_code ~ '-\d{3}$';

    start_n := COALESCE(p_start_seq, existing_max + 1);
    IF p_end_seq IS NOT NULL THEN
        end_n := p_end_seq;
    ELSIF p_count IS NOT NULL THEN
        end_n := start_n + p_count - 1;
    ELSE
        RAISE EXCEPTION 'Either p_end_seq or p_count is required';
    END IF;

    IF end_n < start_n THEN RAISE EXCEPTION 'end_seq must be >= start_seq'; END IF;

    FOR i IN start_n..end_n LOOP
        code := lot.lot_barcode || '-' || LPAD(i::text, 3, '0');
        IF EXISTS (SELECT 1 FROM qc_drying_sub_lot WHERE sub_lot_code = code) THEN
            RAISE EXCEPTION 'Sub-lot code already exists: %', code;
        END IF;
        INSERT INTO qc_drying_sub_lot
            (production_lot_id, sub_lot_code, status, expected_dry_minutes)
        VALUES
            (p_production_lot_id, code, 'created', lot.expected_dry_minutes)
        RETURNING id INTO new_id;
        ids := ids || new_id;

        INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
        VALUES (new_id, 'sub_lot_created',
                jsonb_build_object('sub_lot_code', code,
                                   'seq', i,
                                   'added_to_existing_lot', true,
                                   'expected_dry_minutes', lot.expected_dry_minutes),
                auth.uid());
    END LOOP;

    RETURN jsonb_build_object(
        'added_count', COALESCE(array_length(ids, 1), 0),
        'start_seq', start_n,
        'end_seq', end_n,
        'sub_lot_ids', to_jsonb(ids)
    );
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 4) Move drying carts to a different dryer (BR-Q31)
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION qc_move_sub_lots_dryer(
    p_sub_lot_ids uuid[],
    p_new_dryer_number int
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    succeeded jsonb[] := ARRAY[]::jsonb[];
    failed jsonb[] := ARRAY[]::jsonb[];
    sid uuid;
    s qc_drying_sub_lot%ROWTYPE;
    old_dryer int;
BEGIN
    IF p_new_dryer_number < 1 OR p_new_dryer_number > 5 THEN
        RAISE EXCEPTION 'Invalid dryer_number: % (must be 1..5)', p_new_dryer_number;
    END IF;

    FOREACH sid IN ARRAY p_sub_lot_ids LOOP
        SELECT * INTO s FROM qc_drying_sub_lot WHERE id = sid FOR UPDATE;
        IF NOT FOUND THEN
            failed := failed || jsonb_build_object('sub_lot_id', sid, 'reason', 'not_found');
            CONTINUE;
        END IF;
        IF s.status <> 'drying' THEN
            failed := failed || jsonb_build_object(
                'sub_lot_id', sid,
                'sub_lot_code', s.sub_lot_code,
                'reason', 'wrong_status',
                'status', s.status
            );
            CONTINUE;
        END IF;

        old_dryer := COALESCE(s.dryer_number,
                              (SELECT dryer_number FROM qc_drying_location WHERE id = s.location_id));

        IF old_dryer = p_new_dryer_number THEN
            failed := failed || jsonb_build_object(
                'sub_lot_id', sid,
                'sub_lot_code', s.sub_lot_code,
                'reason', 'same_dryer'
            );
            CONTINUE;
        END IF;

        UPDATE qc_drying_sub_lot
        SET dryer_number = p_new_dryer_number,
            location_id  = NULL,  -- list-mode: no cell after move
            updated_at   = now()
        WHERE id = sid;

        INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
        VALUES (sid, 'move_dryer',
                jsonb_build_object('old_dryer', old_dryer, 'new_dryer', p_new_dryer_number),
                auth.uid());

        succeeded := succeeded || jsonb_build_object(
            'sub_lot_id', sid,
            'sub_lot_code', s.sub_lot_code,
            'old_dryer', old_dryer,
            'new_dryer', p_new_dryer_number
        );
    END LOOP;

    RETURN jsonb_build_object(
        'requested', COALESCE(array_length(p_sub_lot_ids, 1), 0),
        'succeeded', to_jsonb(succeeded),
        'failed', to_jsonb(failed)
    );
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 5) Pass-rate forecast per SKU (dashboard tile)
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION qc_dashboard_pass_rate_forecast()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH today_inspections AS (
    SELECT pl.sku_id, ir.result
    FROM qc_inspection_record ir
    JOIN qc_drying_sub_lot s ON s.id = ir.drying_sub_lot_id
    JOIN qc_production_lot pl ON pl.id = s.production_lot_id
    WHERE ir.submitted_at >= date_trunc('day', now())
  ),
  pass_rate AS (
    SELECT sku_id,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE result = 'pass')::numeric / NULLIF(COUNT(*), 0) AS rate
    FROM today_inspections
    GROUP BY sku_id
  ),
  inflight AS (
    SELECT pl.sku_id, COUNT(*)::int AS in_progress
    FROM qc_drying_sub_lot s
    JOIN qc_production_lot pl ON pl.id = s.production_lot_id
    WHERE s.status IN ('drying','pending','awaiting_group_result',
                       'awaiting_recheck','room_temp_drying','hold','inspecting')
    GROUP BY pl.sku_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'sku_id', sku.id,
    'sku_code', sku.code,
    'sku_name', sku.name,
    'in_progress', COALESCE(i.in_progress, 0),
    'today_pass_rate', pr.rate,
    'today_inspections', COALESCE(pr.total, 0),
    'forecast_passes', ROUND(COALESCE(i.in_progress, 0) * COALESCE(pr.rate, 1.0))::int
  ) ORDER BY sku.code), '[]'::jsonb)
  FROM qc_product_sku sku
  LEFT JOIN inflight i ON i.sku_id = sku.id
  LEFT JOIN pass_rate pr ON pr.sku_id = sku.id
  WHERE COALESCE(i.in_progress, 0) > 0;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 6) Analysis metrics with filters (BR-Q32)
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION qc_analysis_metrics(
    p_sku_id uuid DEFAULT NULL,
    p_from_date date DEFAULT NULL,
    p_to_date   date DEFAULT NULL,
    p_dryer_number int DEFAULT NULL,
    p_production_lot_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
    result jsonb;
BEGIN
    WITH scope AS (
        SELECT s.id AS sub_lot_id,
               s.in_time,
               s.out_time,
               s.expected_dry_minutes,
               pl.sku_id,
               s.production_lot_id
        FROM qc_drying_sub_lot s
        JOIN qc_production_lot pl ON pl.id = s.production_lot_id
        LEFT JOIN qc_drying_location l ON l.id = s.location_id
        WHERE (p_sku_id IS NULL OR pl.sku_id = p_sku_id)
          AND (p_production_lot_id IS NULL OR s.production_lot_id = p_production_lot_id)
          AND (p_dryer_number IS NULL OR COALESCE(s.dryer_number, l.dryer_number) = p_dryer_number)
          AND (p_from_date IS NULL OR s.in_time >= p_from_date)
          AND (p_to_date   IS NULL OR s.in_time <  (p_to_date + interval '1 day'))
    ),
    first_insp AS (
        SELECT DISTINCT ON (ir.drying_sub_lot_id)
            ir.drying_sub_lot_id, ir.result, ir.submitted_at
        FROM qc_inspection_record ir
        JOIN scope sc ON sc.sub_lot_id = ir.drying_sub_lot_id
        ORDER BY ir.drying_sub_lot_id, ir.submitted_at ASC
    ),
    disp AS (
        SELECT d.drying_sub_lot_id, d.type, d.created_at
        FROM qc_disposition d
        JOIN scope sc ON sc.sub_lot_id = d.drying_sub_lot_id
    ),
    disp_with_next AS (
        SELECT d.drying_sub_lot_id,
               d.type,
               d.created_at,
               (SELECT ir2.result FROM qc_inspection_record ir2
                WHERE ir2.drying_sub_lot_id = d.drying_sub_lot_id
                  AND ir2.submitted_at > d.created_at
                ORDER BY ir2.submitted_at ASC LIMIT 1) AS next_result,
               (SELECT ir2.submitted_at - d.created_at FROM qc_inspection_record ir2
                WHERE ir2.drying_sub_lot_id = d.drying_sub_lot_id
                  AND ir2.submitted_at > d.created_at
                ORDER BY ir2.submitted_at ASC LIMIT 1) AS dwell_interval
        FROM disp d
    )
    SELECT jsonb_build_object(
        'total_sub_lots',         (SELECT COUNT(*)::int FROM scope),
        'avg_dry_minutes',        (SELECT ROUND(EXTRACT(EPOCH FROM AVG(out_time - in_time)) / 60.0)::int
                                   FROM scope WHERE out_time IS NOT NULL AND in_time IS NOT NULL),
        'first_inspection_count', (SELECT COUNT(*)::int FROM first_insp),
        'first_pass_count',       (SELECT COUNT(*)::int FROM first_insp WHERE result = 'pass'),
        'first_fail_count',       (SELECT COUNT(*)::int FROM first_insp WHERE result = 'fail'),
        'pass_rate',              (SELECT ROUND(COUNT(*) FILTER (WHERE result = 'pass')::numeric
                                                / NULLIF(COUNT(*), 0) * 100, 2)
                                   FROM first_insp),
        'retest_count',           (SELECT COUNT(*)::int FROM disp_with_next WHERE type = 'retest'),
        'retest_pass_rate',       (SELECT ROUND(COUNT(*) FILTER (WHERE next_result = 'pass')::numeric
                                                / NULLIF(COUNT(*) FILTER (WHERE next_result IS NOT NULL), 0) * 100, 2)
                                   FROM disp_with_next WHERE type = 'retest'),
        'redry_count',            (SELECT COUNT(*)::int FROM disp_with_next WHERE type = 'redry_dryer'),
        'redry_avg_minutes',      (SELECT ROUND(EXTRACT(EPOCH FROM AVG(dwell_interval)) / 60.0)::int
                                   FROM disp_with_next WHERE type = 'redry_dryer' AND dwell_interval IS NOT NULL),
        'redry_pass_rate',        (SELECT ROUND(COUNT(*) FILTER (WHERE next_result = 'pass')::numeric
                                                / NULLIF(COUNT(*) FILTER (WHERE next_result IS NOT NULL), 0) * 100, 2)
                                   FROM disp_with_next WHERE type = 'redry_dryer'),
        'room_temp_count',        (SELECT COUNT(*)::int FROM disp_with_next WHERE type = 'room_temp_dry'),
        'room_temp_avg_minutes',  (SELECT ROUND(EXTRACT(EPOCH FROM AVG(dwell_interval)) / 60.0)::int
                                   FROM disp_with_next WHERE type = 'room_temp_dry' AND dwell_interval IS NOT NULL),
        'room_temp_pass_rate',    (SELECT ROUND(COUNT(*) FILTER (WHERE next_result = 'pass')::numeric
                                                / NULLIF(COUNT(*) FILTER (WHERE next_result IS NOT NULL), 0) * 100, 2)
                                   FROM disp_with_next WHERE type = 'room_temp_dry'),
        'scrap_count',            (SELECT COUNT(*)::int FROM disp WHERE type IN ('scrap','grind','rework','concession'))
    ) INTO result;

    RETURN result;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 7) Auto-generated SKU code helper (BR-Q33)
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION qc_next_sku_code() RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE
    n int;
BEGIN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(code, '^SKU-(\d+)$', '\1'), '')::int), 0) + 1
    INTO n
    FROM qc_product_sku
    WHERE code ~ '^SKU-\d+$';

    RETURN 'SKU-' || LPAD(n::text, 4, '0');
END;
$$;

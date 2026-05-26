-- Unify all QC analysis functions to scope by out_time (checkout date).
--
-- Previously the scope included a sub-lot if ANY of the following fell in the
-- date range: in_time, inspection submitted_at, or disposition created_at.
-- This caused sub-lots that were RETESTED on a later day to appear in that
-- later day's analysis even though the cart had already left the dryer earlier.
--
-- New rule (all 4 analysis functions): a sub-lot is in scope for a date range
-- if its out_time (checkout from drying room) falls within that range.
-- Carts still in the dryer (out_time IS NULL) are only included when no date
-- filter is active.
--
-- Functions updated:
--   qc_analysis_metrics
--   qc_analysis_recovery_detail
--   qc_analysis_outcomes_daily
--   qc_analysis_outcomes_by_work_order

CREATE OR REPLACE FUNCTION qc_analysis_metrics(
    p_sku_id uuid DEFAULT NULL,
    p_from_date date DEFAULT NULL,
    p_to_date   date DEFAULT NULL,
    p_dryer_number int DEFAULT NULL,
    p_production_lot_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
    out_json jsonb;
    range_start timestamptz := COALESCE(p_from_date::timestamptz, '1900-01-01'::timestamptz);
    range_end   timestamptz := COALESCE((p_to_date + interval '1 day')::timestamptz, '2100-01-01'::timestamptz);
    range_active boolean := p_from_date IS NOT NULL OR p_to_date IS NOT NULL;
BEGIN
    WITH scope AS (
        SELECT s.id AS sub_lot_id,
               s.in_time,
               s.out_time,
               s.expected_dry_minutes,
               s.test_group_id,
               s.is_test_champion,
               pl.sku_id,
               s.production_lot_id
        FROM qc_drying_sub_lot s
        JOIN qc_production_lot pl ON pl.id = s.production_lot_id
        LEFT JOIN qc_drying_location l ON l.id = s.location_id
        WHERE (p_sku_id IS NULL OR pl.sku_id = p_sku_id)
          AND (p_production_lot_id IS NULL OR s.production_lot_id = p_production_lot_id)
          AND (
            p_dryer_number IS NULL
            OR COALESCE(s.dryer_number, l.dryer_number) = p_dryer_number
            OR EXISTS (
                SELECT 1 FROM qc_sub_lot_spot_history h
                WHERE h.drying_sub_lot_id = s.id
                  AND h.dryer_number = p_dryer_number
            )
          )
          AND (
            NOT range_active
            OR (s.out_time IS NOT NULL AND s.out_time >= range_start AND s.out_time < range_end)
          )
    ),
    direct_insp AS (
        SELECT DISTINCT ON (ir.drying_sub_lot_id)
            ir.drying_sub_lot_id AS sub_lot_id, ir.result, ir.submitted_at
        FROM qc_inspection_record ir
        JOIN scope sc ON sc.sub_lot_id = ir.drying_sub_lot_id
        ORDER BY ir.drying_sub_lot_id, ir.submitted_at ASC
    ),
    sibling_insp AS (
        SELECT sc.sub_lot_id, di.result, di.submitted_at
        FROM scope sc
        JOIN qc_drying_sub_lot champ
          ON champ.test_group_id = sc.test_group_id
         AND champ.is_test_champion = true
        JOIN direct_insp di ON di.sub_lot_id = champ.id
        WHERE sc.test_group_id IS NOT NULL
          AND sc.is_test_champion = false
          AND NOT EXISTS (
              SELECT 1 FROM qc_inspection_record ir2
              WHERE ir2.drying_sub_lot_id = sc.sub_lot_id
          )
    ),
    first_insp AS (
        SELECT sub_lot_id, result, submitted_at FROM direct_insp
        UNION ALL
        SELECT sub_lot_id, result, submitted_at FROM sibling_insp
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
        'first_pass_count',       (SELECT COUNT(*)::int FROM first_insp fi WHERE fi.result = 'pass'),
        'first_fail_count',       (SELECT COUNT(*)::int FROM first_insp fi WHERE fi.result = 'fail'),
        'pass_rate',              (SELECT ROUND(COUNT(*) FILTER (WHERE fi.result = 'pass')::numeric
                                                / NULLIF(COUNT(*), 0) * 100, 2)
                                   FROM first_insp fi),
        'retest_count',           (SELECT COUNT(*)::int FROM disp_with_next dw WHERE dw.type = 'retest'),
        'retest_pass_rate',       (SELECT ROUND(COUNT(*) FILTER (WHERE dw.next_result = 'pass')::numeric
                                                / NULLIF(COUNT(*) FILTER (WHERE dw.next_result IS NOT NULL), 0) * 100, 2)
                                   FROM disp_with_next dw WHERE dw.type = 'retest'),
        'redry_count',            (SELECT COUNT(*)::int FROM disp_with_next dw WHERE dw.type = 'redry_dryer'),
        'redry_avg_minutes',      (SELECT ROUND(EXTRACT(EPOCH FROM AVG(dw.dwell_interval)) / 60.0)::int
                                   FROM disp_with_next dw WHERE dw.type = 'redry_dryer' AND dw.dwell_interval IS NOT NULL),
        'redry_pass_rate',        (SELECT ROUND(COUNT(*) FILTER (WHERE dw.next_result = 'pass')::numeric
                                                / NULLIF(COUNT(*) FILTER (WHERE dw.next_result IS NOT NULL), 0) * 100, 2)
                                   FROM disp_with_next dw WHERE dw.type = 'redry_dryer'),
        'room_temp_count',        (SELECT COUNT(*)::int FROM disp_with_next dw WHERE dw.type = 'room_temp_dry'),
        'room_temp_avg_minutes',  (SELECT ROUND(EXTRACT(EPOCH FROM AVG(dw.dwell_interval)) / 60.0)::int
                                   FROM disp_with_next dw WHERE dw.type = 'room_temp_dry' AND dw.dwell_interval IS NOT NULL),
        'room_temp_pass_rate',    (SELECT ROUND(COUNT(*) FILTER (WHERE dw.next_result = 'pass')::numeric
                                                / NULLIF(COUNT(*) FILTER (WHERE dw.next_result IS NOT NULL), 0) * 100, 2)
                                   FROM disp_with_next dw WHERE dw.type = 'room_temp_dry'),
        'scrap_count',            (SELECT COUNT(*)::int FROM disp d2 WHERE d2.type IN ('scrap','grind','rework','concession'))
    ) INTO out_json;

    RETURN out_json;
END;
$$;

-- ── qc_analysis_recovery_detail ──────────────────────────────────────────────
-- Scope changed: out_time only (was in_time OR inspection OR disposition).

CREATE OR REPLACE FUNCTION qc_analysis_recovery_detail(
    p_type text,
    p_sku_id uuid DEFAULT NULL,
    p_from_date date DEFAULT NULL,
    p_to_date   date DEFAULT NULL,
    p_dryer_number int DEFAULT NULL,
    p_production_lot_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
    range_start timestamptz := COALESCE(p_from_date::timestamptz, '1900-01-01'::timestamptz);
    range_end   timestamptz := COALESCE((p_to_date + interval '1 day')::timestamptz, '2100-01-01'::timestamptz);
    range_active boolean    := p_from_date IS NOT NULL OR p_to_date IS NOT NULL;
BEGIN
    IF p_type NOT IN ('retest', 'redry_dryer', 'room_temp_dry') THEN
        RAISE EXCEPTION 'Invalid recovery type: %', p_type;
    END IF;

    RETURN COALESCE((
        WITH scope AS (
            SELECT s.id AS sub_lot_id,
                   s.sub_lot_code,
                   s.in_time,
                   s.out_time,
                   s.production_lot_id,
                   pl.sku_id,
                   pl.lot_number,
                   pl.work_order_barcode,
                   sku.name  AS sku_name
            FROM qc_drying_sub_lot s
            JOIN qc_production_lot pl ON pl.id = s.production_lot_id
            JOIN qc_product_sku sku   ON sku.id = pl.sku_id
            LEFT JOIN qc_drying_location l ON l.id = s.location_id
            WHERE (p_sku_id IS NULL OR pl.sku_id = p_sku_id)
              AND (p_production_lot_id IS NULL OR s.production_lot_id = p_production_lot_id)
              AND (p_dryer_number IS NULL OR COALESCE(s.dryer_number, l.dryer_number) = p_dryer_number)
              AND (
                NOT range_active
                OR (s.out_time IS NOT NULL AND s.out_time >= range_start AND s.out_time < range_end)
              )
        )
        SELECT jsonb_agg(row_obj ORDER BY (row_obj->>'disposition_at') DESC)
        FROM (
            SELECT jsonb_build_object(
                'disposition_id',      d.id,
                'sub_lot_id',          sc.sub_lot_id,
                'sub_lot_code',        sc.sub_lot_code,
                'sku_name',            sc.sku_name,
                'lot_number',          sc.lot_number,
                'work_order_barcode',  sc.work_order_barcode,
                'disposition_type',    d.type,
                'disposition_at',      d.created_at,
                'dwell_minutes',       (
                    SELECT ROUND(EXTRACT(EPOCH FROM (ir2.submitted_at - d.created_at)) / 60.0)::int
                    FROM qc_inspection_record ir2
                    WHERE ir2.drying_sub_lot_id = d.drying_sub_lot_id
                      AND ir2.submitted_at > d.created_at
                    ORDER BY ir2.submitted_at ASC
                    LIMIT 1
                ),
                'next_result',         (
                    SELECT ir2.result
                    FROM qc_inspection_record ir2
                    WHERE ir2.drying_sub_lot_id = d.drying_sub_lot_id
                      AND ir2.submitted_at > d.created_at
                    ORDER BY ir2.submitted_at ASC
                    LIMIT 1
                ),
                'next_aw',             (
                    SELECT (ir2.values_json->>'aw')::numeric
                    FROM qc_inspection_record ir2
                    WHERE ir2.drying_sub_lot_id = d.drying_sub_lot_id
                      AND ir2.submitted_at > d.created_at
                    ORDER BY ir2.submitted_at ASC
                    LIMIT 1
                ),
                'remark',              d.remark
            ) AS row_obj
            FROM qc_disposition d
            JOIN scope sc ON sc.sub_lot_id = d.drying_sub_lot_id
            WHERE d.type = p_type
        ) sub
    ), '[]'::jsonb);
END;
$$;

-- ── qc_analysis_outcomes_daily ───────────────────────────────────────────────
-- Scope and date axis changed: out_time only (was submitted_at).

CREATE OR REPLACE FUNCTION qc_analysis_outcomes_daily(
    p_sku_id uuid DEFAULT NULL,
    p_from_date date DEFAULT NULL,
    p_to_date   date DEFAULT NULL,
    p_dryer_number int DEFAULT NULL,
    p_production_lot_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
    out_json jsonb;
    range_start timestamptz := COALESCE(p_from_date::timestamptz, '1900-01-01'::timestamptz);
    range_end   timestamptz := COALESCE((p_to_date + interval '1 day')::timestamptz, '2100-01-01'::timestamptz);
    range_active boolean := p_from_date IS NOT NULL OR p_to_date IS NOT NULL;
BEGIN
    WITH scope AS (
        SELECT s.id AS sub_lot_id,
               s.out_time,
               s.test_group_id,
               s.is_test_champion
        FROM qc_drying_sub_lot s
        JOIN qc_production_lot pl ON pl.id = s.production_lot_id
        LEFT JOIN qc_drying_location l ON l.id = s.location_id
        WHERE (p_sku_id IS NULL OR pl.sku_id = p_sku_id)
          AND (p_production_lot_id IS NULL OR s.production_lot_id = p_production_lot_id)
          AND (
            p_dryer_number IS NULL
            OR COALESCE(s.dryer_number, l.dryer_number) = p_dryer_number
            OR EXISTS (
                SELECT 1 FROM qc_sub_lot_spot_history h
                WHERE h.drying_sub_lot_id = s.id AND h.dryer_number = p_dryer_number
            )
          )
          AND (
            NOT range_active
            OR (s.out_time IS NOT NULL AND s.out_time >= range_start AND s.out_time < range_end)
          )
    ),
    direct_insp AS (
        SELECT DISTINCT ON (ir.drying_sub_lot_id)
            ir.drying_sub_lot_id AS sub_lot_id, ir.result
        FROM qc_inspection_record ir
        JOIN scope sc ON sc.sub_lot_id = ir.drying_sub_lot_id
        ORDER BY ir.drying_sub_lot_id, ir.submitted_at ASC
    ),
    sibling_insp AS (
        SELECT sc.sub_lot_id, di.result
        FROM scope sc
        JOIN qc_drying_sub_lot champ
          ON champ.test_group_id = sc.test_group_id
         AND champ.is_test_champion = true
        JOIN direct_insp di ON di.sub_lot_id = champ.id
        WHERE sc.test_group_id IS NOT NULL
          AND sc.is_test_champion = false
          AND NOT EXISTS (
              SELECT 1 FROM qc_inspection_record ir2
              WHERE ir2.drying_sub_lot_id = sc.sub_lot_id
          )
    ),
    first_insp AS (
        SELECT sub_lot_id, result FROM direct_insp
        UNION ALL
        SELECT sub_lot_id, result FROM sibling_insp
    ),
    -- Join back to scope to get out_time for the date axis
    scoped AS (
        SELECT fi.sub_lot_id, fi.result, sc.out_time
        FROM first_insp fi
        JOIN scope sc ON sc.sub_lot_id = fi.sub_lot_id
    )
    SELECT jsonb_agg(row ORDER BY (row->>'date')::date)
    INTO out_json
    FROM (
        SELECT jsonb_build_object(
            'date',          date_trunc('day', out_time)::date,
            'sub_lot_count', COUNT(*)::int,
            'pass_count',    COUNT(*) FILTER (WHERE result = 'pass')::int,
            'fail_count',    COUNT(*) FILTER (WHERE result = 'fail')::int,
            'pass_rate',     ROUND(COUNT(*) FILTER (WHERE result = 'pass')::numeric
                                   / NULLIF(COUNT(*), 0) * 100, 2)
        ) AS row
        FROM scoped
        GROUP BY date_trunc('day', out_time)
    ) daily;

    RETURN COALESCE(out_json, '[]'::jsonb);
END;
$$;

-- ── qc_analysis_outcomes_by_work_order ───────────────────────────────────────
-- Filter changed: out_time within the day (was submitted_at).

CREATE OR REPLACE FUNCTION qc_analysis_outcomes_by_work_order(
    p_day              date,
    p_sku_id           uuid DEFAULT NULL,
    p_dryer_number     int  DEFAULT NULL,
    p_production_lot_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
    day_start timestamptz := p_day::timestamptz;
    day_end   timestamptz := (p_day + interval '1 day')::timestamptz;
BEGIN
    IF p_day IS NULL THEN
        RAISE EXCEPTION 'p_day is required';
    END IF;

    RETURN COALESCE((
        WITH scope AS (
            SELECT s.id AS sub_lot_id,
                   s.out_time,
                   s.production_lot_id,
                   s.test_group_id,
                   s.is_test_champion
            FROM qc_drying_sub_lot s
            JOIN qc_production_lot pl ON pl.id = s.production_lot_id
            LEFT JOIN qc_drying_location l ON l.id = s.location_id
            WHERE (p_sku_id IS NULL OR pl.sku_id = p_sku_id)
              AND (p_production_lot_id IS NULL OR s.production_lot_id = p_production_lot_id)
              AND (
                p_dryer_number IS NULL
                OR COALESCE(s.dryer_number, l.dryer_number) = p_dryer_number
                OR EXISTS (
                    SELECT 1 FROM qc_sub_lot_spot_history h
                    WHERE h.drying_sub_lot_id = s.id AND h.dryer_number = p_dryer_number
                )
              )
              AND s.out_time IS NOT NULL
              AND s.out_time >= day_start
              AND s.out_time <  day_end
        ),
        direct_insp AS (
            SELECT DISTINCT ON (ir.drying_sub_lot_id)
                ir.drying_sub_lot_id AS sub_lot_id, ir.result
            FROM qc_inspection_record ir
            JOIN scope sc ON sc.sub_lot_id = ir.drying_sub_lot_id
            ORDER BY ir.drying_sub_lot_id, ir.submitted_at ASC
        ),
        sibling_insp AS (
            SELECT sc.sub_lot_id, di.result
            FROM scope sc
            JOIN qc_drying_sub_lot champ
              ON champ.test_group_id = sc.test_group_id
             AND champ.is_test_champion = true
            JOIN direct_insp di ON di.sub_lot_id = champ.id
            WHERE sc.test_group_id IS NOT NULL
              AND sc.is_test_champion = false
              AND NOT EXISTS (
                  SELECT 1 FROM qc_inspection_record ir2
                  WHERE ir2.drying_sub_lot_id = sc.sub_lot_id
              )
        ),
        first_insp AS (
            SELECT sub_lot_id, result FROM direct_insp
            UNION ALL
            SELECT sub_lot_id, result FROM sibling_insp
        ),
        scoped AS (
            SELECT fi.sub_lot_id, fi.result, sc.production_lot_id
            FROM first_insp fi
            JOIN scope sc ON sc.sub_lot_id = fi.sub_lot_id
        )
        SELECT jsonb_agg(row ORDER BY row->>'lot_number')
        FROM (
            SELECT jsonb_build_object(
                'production_lot_id',  pl.id,
                'lot_number',         pl.lot_number,
                'work_order_barcode', pl.work_order_barcode,
                'sku_code',           sku.code,
                'sku_name',           sku.name,
                'sub_lot_count',      COUNT(scd.sub_lot_id)::int,
                'pass_count',         COUNT(*) FILTER (WHERE scd.result = 'pass')::int,
                'fail_count',         COUNT(*) FILTER (WHERE scd.result = 'fail')::int,
                'pass_rate',          ROUND(COUNT(*) FILTER (WHERE scd.result = 'pass')::numeric
                                            / NULLIF(COUNT(*), 0) * 100, 2)
            ) AS row
            FROM scoped scd
            JOIN qc_production_lot pl ON pl.id = scd.production_lot_id
            JOIN qc_product_sku    sku ON sku.id = pl.sku_id
            GROUP BY pl.id, pl.lot_number, pl.work_order_barcode, sku.code, sku.name
        ) lots
    ), '[]'::jsonb);
END;
$$;

-- Migration M-054: Analysis scope widened to "any activity in range".
--
-- Bug: scope filter used s.in_time exclusively, so a cart checked in yesterday
-- but inspected (or disposed) today was excluded from the "Today" filter even
-- though the test result happened today. The operator's mental model is that
-- the date filter scopes test activity, not the upstream check-in date.
--
-- Fix: a sub-lot is in scope if any of the following falls inside the range:
--   - in_time (check-in)
--   - any qc_inspection_record.submitted_at
--   - any qc_disposition.created_at
-- When p_from_date/p_to_date are both NULL the filter is bypassed (All time).

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
          AND (p_dryer_number IS NULL OR COALESCE(s.dryer_number, l.dryer_number) = p_dryer_number)
          AND (
            NOT range_active
            OR (s.in_time IS NOT NULL AND s.in_time >= range_start AND s.in_time < range_end)
            OR EXISTS (
                SELECT 1 FROM qc_inspection_record ir
                WHERE ir.drying_sub_lot_id = s.id
                  AND ir.submitted_at >= range_start
                  AND ir.submitted_at <  range_end
            )
            OR EXISTS (
                SELECT 1 FROM qc_disposition d
                WHERE d.drying_sub_lot_id = s.id
                  AND d.created_at >= range_start
                  AND d.created_at <  range_end
            )
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

-- Migration: pass / fail / pass-rate drill-down for the Analysis page.
--
-- Mirrors qc_analysis_avg_dry_time_daily / _by_work_order but counts test
-- outcomes (first inspection per cart). Honours BR-Q35: siblings in a
-- sampling group inherit the champion's result so the count matches the
-- operator's "I just tested N carts" mental model.

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
        SELECT s.id AS sub_lot_id, s.test_group_id, s.is_test_champion
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
    ),
    direct_insp AS (
        SELECT DISTINCT ON (ir.drying_sub_lot_id)
            ir.drying_sub_lot_id AS sub_lot_id, ir.result, ir.submitted_at
        FROM qc_inspection_record ir
        JOIN scope sc ON sc.sub_lot_id = ir.drying_sub_lot_id
        ORDER BY ir.drying_sub_lot_id, ir.submitted_at ASC
    ),
    -- Sibling carts in a group inherit the champion's first inspection (BR-Q35)
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
    scoped AS (
        SELECT * FROM first_insp
        WHERE NOT range_active OR (submitted_at >= range_start AND submitted_at < range_end)
    )
    SELECT jsonb_agg(row ORDER BY (row->>'date')::date)
    INTO out_json
    FROM (
        SELECT jsonb_build_object(
            'date',          date_trunc('day', submitted_at)::date,
            'sub_lot_count', COUNT(*)::int,
            'pass_count',    COUNT(*) FILTER (WHERE result = 'pass')::int,
            'fail_count',    COUNT(*) FILTER (WHERE result = 'fail')::int,
            'pass_rate',     ROUND(COUNT(*) FILTER (WHERE result = 'pass')::numeric
                                   / NULLIF(COUNT(*), 0) * 100, 2)
        ) AS row
        FROM scoped
        GROUP BY date_trunc('day', submitted_at)
    ) daily;

    RETURN COALESCE(out_json, '[]'::jsonb);
END;
$$;

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
            SELECT s.id AS sub_lot_id, s.production_lot_id, s.test_group_id, s.is_test_champion
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
        scoped AS (
            SELECT fi.sub_lot_id, fi.result, sc.production_lot_id
            FROM first_insp fi
            JOIN scope sc ON sc.sub_lot_id = fi.sub_lot_id
            WHERE fi.submitted_at >= day_start AND fi.submitted_at < day_end
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

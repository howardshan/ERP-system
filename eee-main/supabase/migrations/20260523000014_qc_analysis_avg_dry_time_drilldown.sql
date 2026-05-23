-- Migration: avg-dry-time drill-down for the Analysis page.
--
-- Two RPCs:
--   qc_analysis_avg_dry_time_daily(filters)
--     → daily series of (date, sub_lot_count, avg_dry_minutes)
--   qc_analysis_avg_dry_time_by_work_order(filters + day)
--     → per-work-order breakdown for the clicked day
--
-- Both honour the same filter set as qc_analysis_metrics (SKU, dryer with
-- spot-history fallback, work-order, date range). Days are bucketed by the
-- cart's out_time (when drying completed) — that matches the operator's
-- mental model of "the day this batch came out of the dryer."

CREATE OR REPLACE FUNCTION qc_analysis_avg_dry_time_daily(
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
        SELECT s.id AS sub_lot_id, s.in_time, s.out_time
        FROM qc_drying_sub_lot s
        JOIN qc_production_lot pl ON pl.id = s.production_lot_id
        LEFT JOIN qc_drying_location l ON l.id = s.location_id
        WHERE s.in_time IS NOT NULL AND s.out_time IS NOT NULL
          AND (p_sku_id IS NULL OR pl.sku_id = p_sku_id)
          AND (p_production_lot_id IS NULL OR s.production_lot_id = p_production_lot_id)
          AND (
            p_dryer_number IS NULL
            OR COALESCE(s.dryer_number, l.dryer_number) = p_dryer_number
            OR EXISTS (
                SELECT 1 FROM qc_sub_lot_spot_history h
                WHERE h.drying_sub_lot_id = s.id AND h.dryer_number = p_dryer_number
            )
          )
          AND (NOT range_active OR (s.out_time >= range_start AND s.out_time < range_end))
    )
    SELECT jsonb_agg(row ORDER BY (row->>'date')::date)
    INTO out_json
    FROM (
        SELECT jsonb_build_object(
            'date',            date_trunc('day', out_time)::date,
            'sub_lot_count',   COUNT(*)::int,
            'avg_dry_minutes', ROUND(EXTRACT(EPOCH FROM AVG(out_time - in_time)) / 60.0)::int
        ) AS row
        FROM scope
        GROUP BY date_trunc('day', out_time)
    ) daily;

    RETURN COALESCE(out_json, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION qc_analysis_avg_dry_time_by_work_order(
    p_day              date,
    p_sku_id           uuid DEFAULT NULL,
    p_dryer_number     int  DEFAULT NULL,
    p_production_lot_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF p_day IS NULL THEN
        RAISE EXCEPTION 'p_day is required';
    END IF;

    RETURN COALESCE((
        SELECT jsonb_agg(row ORDER BY row->>'lot_number')
        FROM (
            SELECT jsonb_build_object(
                'production_lot_id',  pl.id,
                'lot_number',         pl.lot_number,
                'work_order_barcode', pl.work_order_barcode,
                'sku_code',           sku.code,
                'sku_name',           sku.name,
                'sub_lot_count',      COUNT(s.id)::int,
                'avg_dry_minutes',    ROUND(EXTRACT(EPOCH FROM AVG(s.out_time - s.in_time)) / 60.0)::int
            ) AS row
            FROM qc_drying_sub_lot s
            JOIN qc_production_lot pl ON pl.id = s.production_lot_id
            JOIN qc_product_sku    sku ON sku.id = pl.sku_id
            LEFT JOIN qc_drying_location l ON l.id = s.location_id
            WHERE s.in_time IS NOT NULL AND s.out_time IS NOT NULL
              AND s.out_time >= p_day::timestamptz
              AND s.out_time <  (p_day + interval '1 day')::timestamptz
              AND (p_sku_id IS NULL OR pl.sku_id = p_sku_id)
              AND (p_production_lot_id IS NULL OR s.production_lot_id = p_production_lot_id)
              AND (
                p_dryer_number IS NULL
                OR COALESCE(s.dryer_number, l.dryer_number) = p_dryer_number
                OR EXISTS (
                    SELECT 1 FROM qc_sub_lot_spot_history h
                    WHERE h.drying_sub_lot_id = s.id AND h.dryer_number = p_dryer_number
                )
              )
            GROUP BY pl.id, pl.lot_number, pl.work_order_barcode, sku.code, sku.name
        ) lots
    ), '[]'::jsonb);
END;
$$;

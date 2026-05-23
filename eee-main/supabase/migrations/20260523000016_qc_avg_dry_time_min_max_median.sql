-- Migration: extend per-work-order avg-dry-time detail with min / max / median.
-- The daily chart still tracks the average, but the click-through detail now
-- gives the operator the full distribution per work order on that day.

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
                'production_lot_id',     pl.id,
                'lot_number',            pl.lot_number,
                'work_order_barcode',    pl.work_order_barcode,
                'sku_code',              sku.code,
                'sku_name',              sku.name,
                'sub_lot_count',         COUNT(s.id)::int,
                'min_dry_minutes',       ROUND(EXTRACT(EPOCH FROM MIN(s.out_time - s.in_time)) / 60.0)::int,
                'max_dry_minutes',       ROUND(EXTRACT(EPOCH FROM MAX(s.out_time - s.in_time)) / 60.0)::int,
                'avg_dry_minutes',       ROUND(EXTRACT(EPOCH FROM AVG(s.out_time - s.in_time)) / 60.0)::int,
                'median_dry_minutes',    ROUND(EXTRACT(EPOCH FROM
                                            percentile_cont(0.5) WITHIN GROUP (ORDER BY s.out_time - s.in_time)
                                         ) / 60.0)::int
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

-- M-072: qc_analysis_recovery_detail — drill-down for a single recovery path.
--
-- Same filters as qc_analysis_metrics; returns one row per disposition of the
-- requested type, enriched with:
--   sub_lot_code, sku_name, lot_number, work_order_barcode,
--   disposition_type, disposition_at,
--   dwell_minutes   (time between disposition and the next inspection, NULL if still in progress),
--   next_result     ('pass' | 'fail' | NULL),
--   next_aw         (the Aw value of the follow-up inspection, NULL if none yet)
--
-- Used by the Analysis page "Recovery Paths" tiles drill-down panel.

CREATE OR REPLACE FUNCTION qc_analysis_recovery_detail(
    p_type text,                         -- 'retest' | 'redry_dryer' | 'room_temp_dry'
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
                OR (s.in_time IS NOT NULL AND s.in_time >= range_start AND s.in_time < range_end)
                OR EXISTS (
                    SELECT 1 FROM qc_inspection_record ir
                    WHERE ir.drying_sub_lot_id = s.id
                      AND ir.submitted_at >= range_start AND ir.submitted_at < range_end
                )
                OR EXISTS (
                    SELECT 1 FROM qc_disposition d
                    WHERE d.drying_sub_lot_id = s.id
                      AND d.created_at >= range_start AND d.created_at < range_end
                )
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

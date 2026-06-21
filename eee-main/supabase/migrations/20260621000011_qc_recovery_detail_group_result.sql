-- ─────────────────────────────────────────────────────────────────────────────
-- M-144  Recovery detail: non-champion carts inherit the group's retest result
--
-- The 重新烘干 / 复检 / 常温 detail panel (qc_analysis_recovery_detail) computed
-- "复检结果" (next_result) / next_aw / dwell ONLY from an inspection on the cart
-- ITSELF. A re-dried non-champion (e.g. test001-003, sibling of champion
-- test001-004) has no inspection of its own, so it showed 待定 (pending) while
-- its champion showed 不合格 — even though the group result applies to all members.
--
-- FIX:
--   • next_result/next_aw/dwell now resolve to the cart's own next inspection
--     after the disposition, OR — if none — the next inspection on the CHAMPION
--     of the cart's test group (group result propagates to siblings).
--   • Scope range filter widened from out_time-only to ANY activity in range
--     (out_time / in_time / inspection / disposition), so re-dried carts with
--     out_time = NULL still appear under 月/周/日 (same fix family as M-142).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.qc_analysis_recovery_detail(
    p_type text,
    p_sku_id uuid DEFAULT NULL::uuid,
    p_from_date date DEFAULT NULL::date,
    p_to_date date DEFAULT NULL::date,
    p_dryer_number integer DEFAULT NULL::integer,
    p_production_lot_id uuid DEFAULT NULL::uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $function$
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
                   s.test_group_id,
                   s.production_lot_id,
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
                OR (s.in_time  IS NOT NULL AND s.in_time  >= range_start AND s.in_time  < range_end)
                OR EXISTS (SELECT 1 FROM qc_inspection_record ir
                           WHERE ir.drying_sub_lot_id = s.id
                             AND ir.submitted_at >= range_start AND ir.submitted_at < range_end)
                OR EXISTS (SELECT 1 FROM qc_disposition d2
                           WHERE d2.drying_sub_lot_id = s.id
                             AND d2.created_at >= range_start AND d2.created_at < range_end)
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
                'dwell_minutes',       CASE WHEN nxt.submitted_at IS NOT NULL
                                            THEN ROUND(EXTRACT(EPOCH FROM (nxt.submitted_at - d.created_at)) / 60.0)::int
                                       END,
                'next_result',         nxt.result,
                'next_aw',             nxt.aw,
                'remark',              d.remark
            ) AS row_obj
            FROM qc_disposition d
            JOIN scope sc ON sc.sub_lot_id = d.drying_sub_lot_id
            -- Effective retest result for this cart: its own next inspection after
            -- the disposition, or — for a non-champion — the group champion's.
            LEFT JOIN LATERAL (
                SELECT ir2.result,
                       (ir2.values_json->>'aw')::numeric AS aw,
                       ir2.submitted_at
                FROM qc_inspection_record ir2
                JOIN qc_drying_sub_lot xs ON xs.id = ir2.drying_sub_lot_id
                WHERE ir2.submitted_at > d.created_at
                  AND (
                        ir2.drying_sub_lot_id = d.drying_sub_lot_id
                    OR (sc.test_group_id IS NOT NULL
                        AND xs.is_test_champion = true
                        AND xs.test_group_id = sc.test_group_id)
                  )
                ORDER BY ir2.submitted_at ASC
                LIMIT 1
            ) nxt ON true
            WHERE d.type = p_type
        ) sub
    ), '[]'::jsonb);
END;
$function$;

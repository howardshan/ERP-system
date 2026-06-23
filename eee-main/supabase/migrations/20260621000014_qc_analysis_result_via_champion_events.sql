-- ─────────────────────────────────────────────────────────────────────────────
-- M-145  Analysis attributes each cart's result via champion-propagation events
--
-- PROBLEM: the analysis derived a non-champion cart's pass/fail by looking at the
-- champion of its CURRENT test group (sibling_insp). Across re-dry cycles a group
-- fragments — a former sibling (e.g. test001-003) can become its own single-cart
-- champion in a later cycle. Once that happens the link to the cart that was
-- actually sampled (test001-004) is lost, so 003's inherited FAIL stopped being
-- counted: 首次检测 showed 1 fail instead of 2, and the re-dry detail showed 003
-- as 待定.
--
-- FIX: a cart's result is taken from the EARLIEST of —
--   • its own inspection (qc_inspection_record), or
--   • a champion-propagation event on it (qc_quality_event
--     group_passed_by_champion / group_failed_by_champion).
-- These events are written for every group member whenever a champion's verdict
-- propagates, so they survive group fragmentation and always tie a sibling to the
-- verdict it actually received. Applied to all four analysis RPCs.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1) qc_analysis_metrics ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.qc_analysis_metrics(
    p_sku_id uuid DEFAULT NULL::uuid, p_from_date date DEFAULT NULL::date,
    p_to_date date DEFAULT NULL::date, p_dryer_number integer DEFAULT NULL::integer,
    p_production_lot_id uuid DEFAULT NULL::uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $function$
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
        WHERE (p_sku_id IS NULL OR pl.sku_id = p_sku_id)
          AND (p_production_lot_id IS NULL OR s.production_lot_id = p_production_lot_id)
          AND (p_dryer_number IS NULL
               OR COALESCE(s.dryer_number, l.dryer_number) = p_dryer_number
               OR EXISTS (SELECT 1 FROM qc_sub_lot_spot_history h WHERE h.drying_sub_lot_id = s.id AND h.dryer_number = p_dryer_number))
          AND (
            NOT range_active
            OR (s.out_time IS NOT NULL AND s.out_time >= range_start AND s.out_time < range_end)
            OR (s.in_time  IS NOT NULL AND s.in_time  >= range_start AND s.in_time  < range_end)
            OR EXISTS (SELECT 1 FROM qc_inspection_record ir WHERE ir.drying_sub_lot_id = s.id AND ir.submitted_at >= range_start AND ir.submitted_at < range_end)
            OR EXISTS (SELECT 1 FROM qc_disposition d WHERE d.drying_sub_lot_id = s.id AND d.created_at >= range_start AND d.created_at < range_end)
          )
    ),
    cart_result AS (
        SELECT DISTINCT ON (sub_lot_id) sub_lot_id, result
        FROM (
            SELECT ir.drying_sub_lot_id AS sub_lot_id, ir.result, ir.submitted_at AS ts
            FROM qc_inspection_record ir JOIN scope sc ON sc.sub_lot_id = ir.drying_sub_lot_id
            UNION ALL
            SELECT qe.drying_sub_lot_id,
                   CASE WHEN qe.event_type = 'group_passed_by_champion' THEN 'pass' ELSE 'fail' END,
                   qe.created_at
            FROM qc_quality_event qe JOIN scope sc ON sc.sub_lot_id = qe.drying_sub_lot_id
            WHERE qe.event_type IN ('group_passed_by_champion', 'group_failed_by_champion')
        ) u
        ORDER BY sub_lot_id, ts ASC
    ),
    disp AS (
        SELECT d.drying_sub_lot_id, d.type, d.created_at
        FROM qc_disposition d JOIN scope sc ON sc.sub_lot_id = d.drying_sub_lot_id
    ),
    disp_with_next AS (
        SELECT d.drying_sub_lot_id, d.type, d.created_at,
               (SELECT ir2.result FROM qc_inspection_record ir2
                WHERE ir2.drying_sub_lot_id = d.drying_sub_lot_id AND ir2.submitted_at > d.created_at
                ORDER BY ir2.submitted_at ASC LIMIT 1) AS next_result,
               (SELECT ir2.submitted_at - d.created_at FROM qc_inspection_record ir2
                WHERE ir2.drying_sub_lot_id = d.drying_sub_lot_id AND ir2.submitted_at > d.created_at
                ORDER BY ir2.submitted_at ASC LIMIT 1) AS dwell_interval
        FROM disp d
    )
    SELECT jsonb_build_object(
        'total_sub_lots',         (SELECT COUNT(*)::int FROM scope),
        'avg_dry_minutes',        (SELECT ROUND(EXTRACT(EPOCH FROM AVG(out_time - in_time)) / 60.0)::int FROM scope WHERE out_time IS NOT NULL AND in_time IS NOT NULL),
        'first_inspection_count', (SELECT COUNT(*)::int FROM cart_result),
        'first_pass_count',       (SELECT COUNT(*)::int FROM cart_result WHERE result = 'pass'),
        'first_fail_count',       (SELECT COUNT(*)::int FROM cart_result WHERE result = 'fail'),
        'pass_rate',              (SELECT ROUND(COUNT(*) FILTER (WHERE result = 'pass')::numeric / NULLIF(COUNT(*), 0) * 100, 2) FROM cart_result),
        'retest_count',           (SELECT COUNT(*)::int FROM disp_with_next dw WHERE dw.type = 'retest'),
        'retest_pass_rate',       (SELECT ROUND(COUNT(*) FILTER (WHERE dw.next_result = 'pass')::numeric / NULLIF(COUNT(*) FILTER (WHERE dw.next_result IS NOT NULL), 0) * 100, 2) FROM disp_with_next dw WHERE dw.type = 'retest'),
        'redry_count',            (SELECT COUNT(*)::int FROM disp_with_next dw WHERE dw.type = 'redry_dryer'),
        'redry_avg_minutes',      (SELECT ROUND(EXTRACT(EPOCH FROM AVG(dw.dwell_interval)) / 60.0)::int FROM disp_with_next dw WHERE dw.type = 'redry_dryer' AND dw.dwell_interval IS NOT NULL),
        'redry_pass_rate',        (SELECT ROUND(COUNT(*) FILTER (WHERE dw.next_result = 'pass')::numeric / NULLIF(COUNT(*) FILTER (WHERE dw.next_result IS NOT NULL), 0) * 100, 2) FROM disp_with_next dw WHERE dw.type = 'redry_dryer'),
        'room_temp_count',        (SELECT COUNT(*)::int FROM disp_with_next dw WHERE dw.type = 'room_temp_dry'),
        'room_temp_avg_minutes',  (SELECT ROUND(EXTRACT(EPOCH FROM AVG(dw.dwell_interval)) / 60.0)::int FROM disp_with_next dw WHERE dw.type = 'room_temp_dry' AND dw.dwell_interval IS NOT NULL),
        'room_temp_pass_rate',    (SELECT ROUND(COUNT(*) FILTER (WHERE dw.next_result = 'pass')::numeric / NULLIF(COUNT(*) FILTER (WHERE dw.next_result IS NOT NULL), 0) * 100, 2) FROM disp_with_next dw WHERE dw.type = 'room_temp_dry'),
        'scrap_count',            (SELECT COUNT(*)::int FROM disp d2 WHERE d2.type IN ('scrap','grind','rework','concession'))
    ) INTO out_json;
    RETURN out_json;
END;
$function$;

-- ── 2) qc_analysis_outcomes_daily ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.qc_analysis_outcomes_daily(
    p_sku_id uuid DEFAULT NULL::uuid, p_from_date date DEFAULT NULL::date,
    p_to_date date DEFAULT NULL::date, p_dryer_number integer DEFAULT NULL::integer,
    p_production_lot_id uuid DEFAULT NULL::uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $function$
DECLARE
    out_json jsonb;
    range_start timestamptz := COALESCE(p_from_date::timestamptz, '1900-01-01'::timestamptz);
    range_end   timestamptz := COALESCE((p_to_date + interval '1 day')::timestamptz, '2100-01-01'::timestamptz);
    range_active boolean := p_from_date IS NOT NULL OR p_to_date IS NOT NULL;
BEGIN
    WITH scope AS (
        SELECT s.id AS sub_lot_id
        FROM qc_drying_sub_lot s
        JOIN qc_production_lot pl ON pl.id = s.production_lot_id
        LEFT JOIN qc_drying_location l ON l.id = s.location_id
        WHERE (p_sku_id IS NULL OR pl.sku_id = p_sku_id)
          AND (p_production_lot_id IS NULL OR s.production_lot_id = p_production_lot_id)
          AND (p_dryer_number IS NULL
               OR COALESCE(s.dryer_number, l.dryer_number) = p_dryer_number
               OR EXISTS (SELECT 1 FROM qc_sub_lot_spot_history h WHERE h.drying_sub_lot_id = s.id AND h.dryer_number = p_dryer_number))
    ),
    cart_result AS (
        SELECT DISTINCT ON (sub_lot_id) sub_lot_id, result, ts
        FROM (
            SELECT ir.drying_sub_lot_id AS sub_lot_id, ir.result, ir.submitted_at AS ts
            FROM qc_inspection_record ir JOIN scope sc ON sc.sub_lot_id = ir.drying_sub_lot_id
            UNION ALL
            SELECT qe.drying_sub_lot_id,
                   CASE WHEN qe.event_type = 'group_passed_by_champion' THEN 'pass' ELSE 'fail' END, qe.created_at
            FROM qc_quality_event qe JOIN scope sc ON sc.sub_lot_id = qe.drying_sub_lot_id
            WHERE qe.event_type IN ('group_passed_by_champion', 'group_failed_by_champion')
        ) u
        ORDER BY sub_lot_id, ts ASC
    )
    SELECT jsonb_agg(row ORDER BY (row->>'date')::date)
    INTO out_json
    FROM (
        SELECT jsonb_build_object(
            'date',          date_trunc('day', ts)::date,
            'sub_lot_count', COUNT(*)::int,
            'pass_count',    COUNT(*) FILTER (WHERE result = 'pass')::int,
            'fail_count',    COUNT(*) FILTER (WHERE result = 'fail')::int,
            'pass_rate',     ROUND(COUNT(*) FILTER (WHERE result = 'pass')::numeric / NULLIF(COUNT(*), 0) * 100, 2)
        ) AS row
        FROM cart_result
        WHERE NOT range_active OR (ts >= range_start AND ts < range_end)
        GROUP BY date_trunc('day', ts)
    ) daily;
    RETURN COALESCE(out_json, '[]'::jsonb);
END;
$function$;

-- ── 3) qc_analysis_outcomes_by_work_order ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.qc_analysis_outcomes_by_work_order(
    p_day date, p_sku_id uuid DEFAULT NULL::uuid,
    p_dryer_number integer DEFAULT NULL::integer, p_production_lot_id uuid DEFAULT NULL::uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $function$
DECLARE
    day_start timestamptz := p_day::timestamptz;
    day_end   timestamptz := (p_day + interval '1 day')::timestamptz;
BEGIN
    IF p_day IS NULL THEN RAISE EXCEPTION 'p_day is required'; END IF;
    RETURN COALESCE((
        WITH scope AS (
            SELECT s.id AS sub_lot_id, s.production_lot_id
            FROM qc_drying_sub_lot s
            JOIN qc_production_lot pl ON pl.id = s.production_lot_id
            LEFT JOIN qc_drying_location l ON l.id = s.location_id
            WHERE (p_sku_id IS NULL OR pl.sku_id = p_sku_id)
              AND (p_production_lot_id IS NULL OR s.production_lot_id = p_production_lot_id)
              AND (p_dryer_number IS NULL
                   OR COALESCE(s.dryer_number, l.dryer_number) = p_dryer_number
                   OR EXISTS (SELECT 1 FROM qc_sub_lot_spot_history h WHERE h.drying_sub_lot_id = s.id AND h.dryer_number = p_dryer_number))
        ),
        cart_result AS (
            SELECT DISTINCT ON (sub_lot_id) sub_lot_id, result, ts
            FROM (
                SELECT ir.drying_sub_lot_id AS sub_lot_id, ir.result, ir.submitted_at AS ts
                FROM qc_inspection_record ir JOIN scope sc ON sc.sub_lot_id = ir.drying_sub_lot_id
                UNION ALL
                SELECT qe.drying_sub_lot_id,
                       CASE WHEN qe.event_type = 'group_passed_by_champion' THEN 'pass' ELSE 'fail' END, qe.created_at
                FROM qc_quality_event qe JOIN scope sc ON sc.sub_lot_id = qe.drying_sub_lot_id
                WHERE qe.event_type IN ('group_passed_by_champion', 'group_failed_by_champion')
            ) u
            ORDER BY sub_lot_id, ts ASC
        ),
        scoped AS (
            SELECT cr.sub_lot_id, cr.result, sc.production_lot_id
            FROM cart_result cr JOIN scope sc ON sc.sub_lot_id = cr.sub_lot_id
            WHERE cr.ts >= day_start AND cr.ts < day_end
        )
        SELECT jsonb_agg(row ORDER BY row->>'lot_number')
        FROM (
            SELECT jsonb_build_object(
                'production_lot_id',  pl.id, 'lot_number', pl.lot_number,
                'work_order_barcode', pl.work_order_barcode, 'sku_code', sku.code, 'sku_name', sku.name,
                'sub_lot_count',      COUNT(scd.sub_lot_id)::int,
                'pass_count',         COUNT(*) FILTER (WHERE scd.result = 'pass')::int,
                'fail_count',         COUNT(*) FILTER (WHERE scd.result = 'fail')::int,
                'pass_rate',          ROUND(COUNT(*) FILTER (WHERE scd.result = 'pass')::numeric / NULLIF(COUNT(*), 0) * 100, 2)
            ) AS row
            FROM scoped scd
            JOIN qc_production_lot pl ON pl.id = scd.production_lot_id
            JOIN qc_product_sku    sku ON sku.id = pl.sku_id
            GROUP BY pl.id, pl.lot_number, pl.work_order_barcode, sku.code, sku.name
        ) lots
    ), '[]'::jsonb);
END;
$function$;

-- ── 4) qc_analysis_recovery_detail ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.qc_analysis_recovery_detail(
    p_type text, p_sku_id uuid DEFAULT NULL::uuid, p_from_date date DEFAULT NULL::date,
    p_to_date date DEFAULT NULL::date, p_dryer_number integer DEFAULT NULL::integer,
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
            SELECT s.id AS sub_lot_id, s.sub_lot_code, s.production_lot_id,
                   pl.lot_number, pl.work_order_barcode, sku.name AS sku_name
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
                OR EXISTS (SELECT 1 FROM qc_inspection_record ir WHERE ir.drying_sub_lot_id = s.id AND ir.submitted_at >= range_start AND ir.submitted_at < range_end)
                OR EXISTS (SELECT 1 FROM qc_disposition d2 WHERE d2.drying_sub_lot_id = s.id AND d2.created_at >= range_start AND d2.created_at < range_end)
              )
        )
        SELECT jsonb_agg(row_obj ORDER BY (row_obj->>'disposition_at') DESC)
        FROM (
            SELECT jsonb_build_object(
                'disposition_id', d.id, 'sub_lot_id', sc.sub_lot_id, 'sub_lot_code', sc.sub_lot_code,
                'sku_name', sc.sku_name, 'lot_number', sc.lot_number, 'work_order_barcode', sc.work_order_barcode,
                'disposition_type', d.type, 'disposition_at', d.created_at,
                'dwell_minutes', CASE WHEN nxt.ts IS NOT NULL THEN ROUND(EXTRACT(EPOCH FROM (nxt.ts - d.created_at)) / 60.0)::int END,
                'next_result', nxt.result, 'next_aw', nxt.aw, 'remark', d.remark
            ) AS row_obj
            FROM qc_disposition d
            JOIN scope sc ON sc.sub_lot_id = d.drying_sub_lot_id
            -- Earliest result for this cart after the disposition: its own next
            -- inspection, OR the champion verdict propagated to it (group event).
            LEFT JOIN LATERAL (
                SELECT result, aw, ts FROM (
                    SELECT ir2.result, (ir2.values_json->>'aw')::numeric AS aw, ir2.submitted_at AS ts
                    FROM qc_inspection_record ir2
                    WHERE ir2.drying_sub_lot_id = d.drying_sub_lot_id AND ir2.submitted_at > d.created_at
                    UNION ALL
                    SELECT CASE WHEN qe.event_type = 'group_passed_by_champion' THEN 'pass' ELSE 'fail' END,
                           (qe.payload->>'champion_aw')::numeric, qe.created_at
                    FROM qc_quality_event qe
                    WHERE qe.drying_sub_lot_id = d.drying_sub_lot_id
                      AND qe.event_type IN ('group_passed_by_champion', 'group_failed_by_champion')
                      AND qe.created_at > d.created_at
                ) x ORDER BY ts ASC LIMIT 1
            ) nxt ON true
            WHERE d.type = p_type
        ) sub
    ), '[]'::jsonb);
END;
$function$;

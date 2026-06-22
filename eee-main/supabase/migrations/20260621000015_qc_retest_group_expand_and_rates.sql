-- ─────────────────────────────────────────────────────────────────────────────
-- M-148  Retest (复检) is group-wide in analysis; recovery next-result via events
--
-- Retest is recorded as ONE qc_disposition on the champion (firing it per-cart
-- would shatter the re-sampled group — see createDispositionGroup). So the 复检
-- panel/count showed only the champion (004), not its co-sampled siblings (003),
-- even though the retest reset the WHOLE group.
--
-- Link: when a retest resets the group, each sibling gets a `group_retest_reset`
-- quality event carrying the retest's `disposition_id`. We use that to expand a
-- champion's retest disposition to its siblings in the analysis.
--
-- Also: the recovery "next result / dwell / pass-rate" now resolves to the cart's
-- own next inspection OR the champion verdict propagated to it
-- (group_passed_by_champion / group_failed_by_champion), so re-dry siblings get
-- their inherited pass/fail too — matching M-147's first-test attribution.
--
-- dispo_targets = every (disposition, affected cart): the cart it's recorded on,
-- plus — for retest — each sibling linked by group_retest_reset.disposition_id.
-- ─────────────────────────────────────────────────────────────────────────────

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
                   CASE WHEN qe.event_type = 'group_passed_by_champion' THEN 'pass' ELSE 'fail' END, qe.created_at
            FROM qc_quality_event qe JOIN scope sc ON sc.sub_lot_id = qe.drying_sub_lot_id
            WHERE qe.event_type IN ('group_passed_by_champion', 'group_failed_by_champion')
        ) u
        ORDER BY sub_lot_id, ts ASC
    ),
    dispo_targets AS (
        SELECT d.type, d.created_at, d.drying_sub_lot_id AS target_id
        FROM qc_disposition d JOIN scope sc ON sc.sub_lot_id = d.drying_sub_lot_id
        UNION
        SELECT d.type, d.created_at, qe.drying_sub_lot_id
        FROM qc_disposition d
        JOIN qc_quality_event qe ON qe.event_type = 'group_retest_reset'
                                AND (qe.payload->>'disposition_id')::uuid = d.id
        JOIN scope sc ON sc.sub_lot_id = qe.drying_sub_lot_id
    ),
    disp_with_next AS (
        SELECT dt.target_id, dt.type, dt.created_at, nxt.result AS next_result, nxt.dwell_interval
        FROM dispo_targets dt
        LEFT JOIN LATERAL (
            SELECT result, (ts - dt.created_at) AS dwell_interval FROM (
                SELECT ir2.result, ir2.submitted_at AS ts
                FROM qc_inspection_record ir2
                WHERE ir2.drying_sub_lot_id = dt.target_id AND ir2.submitted_at > dt.created_at
                UNION ALL
                SELECT CASE WHEN qe.event_type = 'group_passed_by_champion' THEN 'pass' ELSE 'fail' END, qe.created_at
                FROM qc_quality_event qe
                WHERE qe.drying_sub_lot_id = dt.target_id
                  AND qe.event_type IN ('group_passed_by_champion', 'group_failed_by_champion')
                  AND qe.created_at > dt.created_at
            ) x ORDER BY ts ASC LIMIT 1
        ) nxt ON true
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
        'scrap_count',            (SELECT COUNT(*)::int FROM qc_disposition d2 JOIN scope sc ON sc.sub_lot_id = d2.drying_sub_lot_id WHERE d2.type IN ('scrap','grind','rework','concession'))
    ) INTO out_json;
    RETURN out_json;
END;
$function$;

-- ── recovery detail: expand retest to siblings; next-result via events ────────
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
        ),
        dispo_targets AS (
            SELECT d.id AS disposition_id, d.type, d.created_at, d.remark, d.drying_sub_lot_id AS target_id
            FROM qc_disposition d
            WHERE d.type = p_type
            UNION
            SELECT d.id, d.type, d.created_at, d.remark, qe.drying_sub_lot_id
            FROM qc_disposition d
            JOIN qc_quality_event qe ON qe.event_type = 'group_retest_reset'
                                    AND (qe.payload->>'disposition_id')::uuid = d.id
            WHERE d.type = p_type
        )
        SELECT jsonb_agg(row_obj ORDER BY (row_obj->>'disposition_at') DESC)
        FROM (
            SELECT jsonb_build_object(
                'disposition_id', dt.disposition_id, 'sub_lot_id', sc.sub_lot_id, 'sub_lot_code', sc.sub_lot_code,
                'sku_name', sc.sku_name, 'lot_number', sc.lot_number, 'work_order_barcode', sc.work_order_barcode,
                'disposition_type', dt.type, 'disposition_at', dt.created_at,
                'dwell_minutes', CASE WHEN nxt.ts IS NOT NULL THEN ROUND(EXTRACT(EPOCH FROM (nxt.ts - dt.created_at)) / 60.0)::int END,
                'next_result', nxt.result, 'next_aw', nxt.aw, 'remark', dt.remark
            ) AS row_obj
            FROM dispo_targets dt
            JOIN scope sc ON sc.sub_lot_id = dt.target_id
            LEFT JOIN LATERAL (
                SELECT result, aw, ts FROM (
                    SELECT ir2.result, (ir2.values_json->>'aw')::numeric AS aw, ir2.submitted_at AS ts
                    FROM qc_inspection_record ir2
                    WHERE ir2.drying_sub_lot_id = dt.target_id AND ir2.submitted_at > dt.created_at
                    UNION ALL
                    SELECT CASE WHEN qe.event_type = 'group_passed_by_champion' THEN 'pass' ELSE 'fail' END,
                           (qe.payload->>'champion_aw')::numeric, qe.created_at
                    FROM qc_quality_event qe
                    WHERE qe.drying_sub_lot_id = dt.target_id
                      AND qe.event_type IN ('group_passed_by_champion', 'group_failed_by_champion')
                      AND qe.created_at > dt.created_at
                ) x ORDER BY ts ASC LIMIT 1
            ) nxt ON true
        ) sub
    ), '[]'::jsonb);
END;
$function$;

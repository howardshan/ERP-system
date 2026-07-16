-- ─────────────────────────────────────────────────────────────────────────────
-- M-170  Show ALL test readings (not just Aw) on dashboards / lists
--
-- Since M-138 a SKU can have several tests (e.g. Aw + MC%), but many read RPCs
-- still only surfaced the single `aw` number. This adds a `readings` array
-- (via _qc_flatten_readings(values_json) → [{item_name, unit, value, ...}]) next
-- to the existing `aw` field so QC Home, the Admin dashboard and Analysis can
-- render every reading. `aw` is kept for back-compat.
-- Functions touched: qc_today_inspection_item, qc_overview (needs_attention),
-- qc_recent_failed_inspections, qc_recent_passed_inspections. (Recovery detail's
-- next_readings is added separately in this migration.)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.qc_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
    day_start         timestamptz := date_trunc('day', now());
    day_end           timestamptz := date_trunc('day', now()) + interval '1 day';
    drying_count      integer;
    expected_today    integer;
    awaiting_sample   integer;
    awaiting_wa       integer;
    room_temp_count   integer;
    passed_today      integer;
    failed_today      integer;
    failed_today_open integer;
    longest_wait      numeric;
    pass_rate         numeric;
BEGIN
    SELECT COUNT(*) INTO drying_count
      FROM qc_drying_sub_lot WHERE status = 'drying';

    SELECT COUNT(*) INTO expected_today
      FROM qc_drying_sub_lot s
      WHERE s.status = 'drying'
        AND s.in_time IS NOT NULL
        AND s.expected_dry_minutes IS NOT NULL
        AND (s.in_time + (s.expected_dry_minutes * interval '1 minute')) < day_end
        AND (s.in_time + (s.expected_dry_minutes * interval '1 minute')) >= day_start;

    SELECT COUNT(*) INTO awaiting_sample
      FROM qc_drying_sub_lot s
      WHERE s.status = 'pending'
        AND NOT qc_sub_lot_has_pending_sample(s.id);

    SELECT COUNT(*) INTO awaiting_wa
      FROM qc_drying_sub_lot s
      WHERE (s.status = 'pending' AND qc_sub_lot_has_pending_sample(s.id))
         OR s.status = 'inspecting';

    SELECT COUNT(*) INTO room_temp_count
      FROM qc_drying_sub_lot WHERE status = 'room_temp_drying';

    SELECT COUNT(*) INTO passed_today
      FROM qc_inspection_record
      WHERE submitted_at >= day_start AND submitted_at < day_end AND result = 'pass';

    SELECT COUNT(*) INTO failed_today
      FROM qc_inspection_record
      WHERE submitted_at >= day_start AND submitted_at < day_end AND result = 'fail';

    -- M-140: today's fails not yet resolved — no later pass and no later
    -- disposition of ANY type (same cart or anywhere in the sampling group).
    SELECT COUNT(*) INTO failed_today_open
      FROM qc_inspection_record ir
      JOIN qc_drying_sub_lot s ON s.id = ir.drying_sub_lot_id
      WHERE ir.submitted_at >= day_start AND ir.submitted_at < day_end
        AND ir.result = 'fail'
        AND NOT EXISTS (
          SELECT 1
          FROM qc_inspection_record ir2
          JOIN qc_drying_sub_lot s2 ON s2.id = ir2.drying_sub_lot_id
          WHERE ir2.result = 'pass'
            AND ir2.submitted_at > ir.submitted_at
            AND (
                  ir2.drying_sub_lot_id = ir.drying_sub_lot_id
              OR  (s.test_group_id IS NOT NULL AND s2.test_group_id = s.test_group_id)
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM qc_disposition d
          JOIN qc_drying_sub_lot s3 ON s3.id = d.drying_sub_lot_id
          WHERE d.created_at > ir.submitted_at
            AND (
                  d.drying_sub_lot_id = ir.drying_sub_lot_id
              OR  (s.test_group_id IS NOT NULL AND s3.test_group_id = s.test_group_id)
            )
        );

    SELECT MAX(EXTRACT(EPOCH FROM (now() - out_time)) / 60.0)
      INTO longest_wait
      FROM qc_drying_sub_lot
      WHERE status = 'pending' AND out_time IS NOT NULL;

    pass_rate := CASE WHEN (passed_today + failed_today) > 0
                      THEN ROUND(passed_today::numeric / (passed_today + failed_today) * 100, 1)
                      ELSE NULL END;

    RETURN jsonb_build_object(
        'today', to_char(day_start, 'YYYY-MM-DD'),
        'stats', jsonb_build_object(
            'expected_finish_today', expected_today,
            'currently_drying',      drying_count,
            'room_temp_drying',      room_temp_count,
            'awaiting_sample',       awaiting_sample,
            'awaiting_wa_result',    awaiting_wa,
            'passed_today',          passed_today,
            'failed_today',          failed_today,
            'failed_today_open',     failed_today_open,
            'longest_wait_minutes',  CASE WHEN longest_wait IS NOT NULL THEN ROUND(longest_wait, 1) END,
            'pass_rate_pct',         pass_rate
        ),

        -- ── Needs Attention (ONE CARD PER GROUP — M-107, verbatim) ─────────
        'needs_attention', COALESCE((
            SELECT jsonb_agg(item ORDER BY submitted_at DESC)
            FROM (
                SELECT item, submitted_at
                FROM (
                    SELECT DISTINCT ON (group_key) item, submitted_at
                    FROM (
                        SELECT
                            COALESCE(s.test_group_id::text, 'solo:' || s.id::text) AS group_key,
                            ir.submitted_at AS submitted_at,
                            jsonb_build_object(
                                'inspection_id',      ir.id,
                                'drying_sub_lot_id',  ir.drying_sub_lot_id,
                                'sub_lot_code',       s.sub_lot_code,
                                'sku_name',           sku.name,
                                'lot_number',         lot.lot_number,
                                'work_order_barcode', lot.work_order_barcode,
                                'readings', _qc_flatten_readings(ir.values_json), 'aw',                 (ir.values_json->>'aw')::numeric,
                                'result',             ir.result,
                                'submitted_at',       ir.submitted_at,
                                'current_status',     s.status,
                                'sample_id',          (SELECT sa.sample_id FROM qc_sample sa WHERE sa.id = ir.sample_id),
                                'test_group_id',      s.test_group_id,
                                'group_size',         CASE
                                    WHEN s.test_group_id IS NOT NULL THEN (
                                        SELECT COUNT(*)::int FROM qc_drying_sub_lot sl
                                        WHERE sl.test_group_id = s.test_group_id
                                          AND sl.status IN ('passed', 'hold')
                                          AND NOT EXISTS (
                                              SELECT 1 FROM qc_disposition d
                                              WHERE d.drying_sub_lot_id = sl.id
                                                AND d.created_at > ir.submitted_at
                                          )
                                    )
                                    ELSE 1
                                END,
                                'group_sub_lot_ids',  CASE
                                    WHEN s.test_group_id IS NOT NULL THEN (
                                        SELECT jsonb_agg(sl.id ORDER BY sl.sub_lot_code)
                                        FROM qc_drying_sub_lot sl
                                        WHERE sl.test_group_id = s.test_group_id
                                          AND sl.status IN ('passed', 'hold')
                                          AND NOT EXISTS (
                                              SELECT 1 FROM qc_disposition d
                                              WHERE d.drying_sub_lot_id = sl.id
                                                AND d.created_at > ir.submitted_at
                                          )
                                    )
                                    ELSE jsonb_build_array(s.id)
                                END,
                                'group_sub_lot_codes', CASE
                                    WHEN s.test_group_id IS NOT NULL THEN (
                                        SELECT jsonb_agg(sl.sub_lot_code ORDER BY sl.sub_lot_code)
                                        FROM qc_drying_sub_lot sl
                                        WHERE sl.test_group_id = s.test_group_id
                                          AND sl.status IN ('passed', 'hold')
                                          AND NOT EXISTS (
                                              SELECT 1 FROM qc_disposition d
                                              WHERE d.drying_sub_lot_id = sl.id
                                                AND d.created_at > ir.submitted_at
                                          )
                                    )
                                    ELSE jsonb_build_array(s.sub_lot_code)
                                END
                            ) AS item
                        FROM qc_inspection_record ir
                        JOIN qc_drying_sub_lot s ON s.id = ir.drying_sub_lot_id
                        LEFT JOIN qc_production_lot lot ON lot.id = s.production_lot_id
                        LEFT JOIN qc_product_sku sku ON sku.id = lot.sku_id
                        WHERE ir.submitted_at >= day_start
                          AND (
                              (s.test_group_id IS NOT NULL AND EXISTS (
                                  SELECT 1 FROM qc_drying_sub_lot sl
                                  WHERE sl.test_group_id = s.test_group_id
                                    AND sl.status IN ('passed', 'hold')
                                    AND NOT EXISTS (
                                        SELECT 1 FROM qc_disposition d
                                        WHERE d.drying_sub_lot_id = sl.id
                                          AND d.created_at > ir.submitted_at
                                    )
                              ))
                              OR
                              (s.test_group_id IS NULL
                               AND s.status IN ('passed', 'hold')
                               AND NOT EXISTS (
                                   SELECT 1 FROM qc_disposition d
                                   WHERE d.drying_sub_lot_id = s.id
                                     AND d.created_at > ir.submitted_at
                               )
                              )
                          )
                    ) all_rows
                    ORDER BY group_key, submitted_at DESC
                ) deduped
                ORDER BY submitted_at DESC
                LIMIT 50
            ) sub
        ), '[]'::jsonb)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.qc_recent_failed_inspections(p_days integer DEFAULT 2)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(row_obj ORDER BY (row_obj->>'submitted_at') DESC)
    FROM (
      SELECT jsonb_build_object(
        'inspection_id',      ir.id,
        'sample_id',          (SELECT sa.sample_id FROM qc_sample sa WHERE sa.id = ir.sample_id),
        'readings', _qc_flatten_readings(ir.values_json), 'aw',                 (ir.values_json->>'aw')::numeric,
        'submitted_at',       ir.submitted_at,
        'sku_name',           sku.name,
        'lot_number',         lot.lot_number,
        'work_order_barcode', lot.work_order_barcode,
        'champion_code',      s.sub_lot_code,
        'test_group_id',      s.test_group_id,
        'outcome',            CASE
          WHEN EXISTS (
            SELECT 1
            FROM qc_inspection_record ir2
            JOIN qc_drying_sub_lot s2 ON s2.id = ir2.drying_sub_lot_id
            WHERE ir2.result = 'pass'
              AND ir2.submitted_at > ir.submitted_at
              AND (
                    ir2.drying_sub_lot_id = ir.drying_sub_lot_id
                OR  (s.test_group_id IS NOT NULL AND s2.test_group_id = s.test_group_id)
              )
          ) THEN 'retest_passed'
          WHEN EXISTS (
            SELECT 1
            FROM qc_disposition d
            JOIN qc_drying_sub_lot s3 ON s3.id = d.drying_sub_lot_id
            WHERE d.created_at > ir.submitted_at
              AND (
                    d.drying_sub_lot_id = ir.drying_sub_lot_id
                OR  (s.test_group_id IS NOT NULL AND s3.test_group_id = s.test_group_id)
              )
          ) THEN 'disposed'
          ELSE 'open'
        END,
        'group_members',      CASE
          WHEN s.test_group_id IS NOT NULL THEN (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id',            m.id,
                'sub_lot_code',  m.sub_lot_code,
                'status',        m.status,
                'is_champion',   m.is_test_champion
              ) ORDER BY m.sub_lot_code
            )
            FROM qc_drying_sub_lot m
            WHERE m.test_group_id = s.test_group_id
          )
          ELSE jsonb_build_array(
            jsonb_build_object(
              'id',           s.id,
              'sub_lot_code', s.sub_lot_code,
              'status',       s.status,
              'is_champion',  true
            )
          )
        END
      ) AS row_obj
      FROM qc_inspection_record ir
      JOIN qc_drying_sub_lot s ON s.id = ir.drying_sub_lot_id
      LEFT JOIN qc_production_lot lot ON lot.id = s.production_lot_id
      LEFT JOIN qc_product_sku sku ON sku.id = lot.sku_id
      WHERE ir.result = 'fail'
        AND ir.submitted_at >= now() - (p_days * interval '1 day')
      ORDER BY ir.submitted_at DESC
    ) sub
  ), '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.qc_recent_passed_inspections(p_days integer DEFAULT 2)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(row_obj ORDER BY (row_obj->>'submitted_at') DESC)
    FROM (
      SELECT jsonb_build_object(
        'inspection_id',      ir.id,
        'sample_id',          (SELECT sa.sample_id FROM qc_sample sa WHERE sa.id = ir.sample_id),
        'readings', _qc_flatten_readings(ir.values_json), 'aw',                 (ir.values_json->>'aw')::numeric,
        'submitted_at',       ir.submitted_at,
        'sku_name',           sku.name,
        'lot_number',         lot.lot_number,
        'work_order_barcode', lot.work_order_barcode,
        'champion_code',      s.sub_lot_code,
        'test_group_id',      s.test_group_id,
        'outcome',            CASE
          WHEN s.test_group_id IS NOT NULL THEN (
            CASE
              WHEN EXISTS (
                SELECT 1 FROM qc_drying_sub_lot sl
                WHERE sl.test_group_id = s.test_group_id
                  AND sl.status = 'passed'
              ) THEN 'awaiting_release'
              ELSE 'released'
            END
          )
          ELSE
            CASE WHEN s.status = 'passed' THEN 'awaiting_release' ELSE 'released' END
        END,
        'group_members',      CASE
          WHEN s.test_group_id IS NOT NULL THEN (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id',            m.id,
                'sub_lot_code',  m.sub_lot_code,
                'status',        m.status,
                'is_champion',   m.is_test_champion
              ) ORDER BY m.sub_lot_code
            )
            FROM qc_drying_sub_lot m
            WHERE m.test_group_id = s.test_group_id
          )
          ELSE jsonb_build_array(
            jsonb_build_object(
              'id',           s.id,
              'sub_lot_code', s.sub_lot_code,
              'status',       s.status,
              'is_champion',  true
            )
          )
        END
      ) AS row_obj
      FROM qc_inspection_record ir
      JOIN qc_drying_sub_lot s ON s.id = ir.drying_sub_lot_id
      LEFT JOIN qc_production_lot lot ON lot.id = s.production_lot_id
      LEFT JOIN qc_product_sku sku ON sku.id = lot.sku_id
      WHERE ir.result = 'pass'
        AND ir.submitted_at >= now() - (p_days * interval '1 day')
      ORDER BY ir.submitted_at DESC
    ) sub
  ), '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.qc_today_inspection_item(p_record_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
    rec qc_inspection_record%ROWTYPE;
    s qc_drying_sub_lot%ROWTYPE;
    lot qc_production_lot%ROWTYPE;
    sku qc_product_sku%ROWTYPE;
    tmpl qc_inspection_template%ROWTYPE;
    aw_val numeric;
    fail_reason text;
BEGIN
    SELECT * INTO rec FROM qc_inspection_record WHERE id = p_record_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = rec.drying_sub_lot_id;
    SELECT * INTO lot FROM qc_production_lot WHERE id = s.production_lot_id;
    IF FOUND THEN
        SELECT * INTO sku FROM qc_product_sku WHERE id = lot.sku_id;
        SELECT * INTO tmpl FROM qc_inspection_template WHERE sku_id = lot.sku_id LIMIT 1;
    END IF;

    aw_val := NULLIF(rec.values_json->>'aw', '')::numeric;

    IF rec.result = 'fail' AND aw_val IS NOT NULL
       AND tmpl.lower_limit IS NOT NULL AND tmpl.upper_limit IS NOT NULL THEN
        fail_reason := qc_format_fail_reason(aw_val, tmpl.lower_limit, tmpl.upper_limit,
                                             COALESCE(tmpl.item_name, 'Water Activity (Aw)'));
    END IF;

    RETURN jsonb_build_object(
        'sub_lot_id', rec.drying_sub_lot_id,
        'sub_lot_code', COALESCE(s.sub_lot_code, '—'),
        'sku_name', sku.name,
        'readings', _qc_flatten_readings(rec.values_json), 'aw', aw_val,
        'result', rec.result,
        'submitted_at', rec.submitted_at,
        'status', COALESCE(s.status, 'unknown'),
        'fail_reason', fail_reason
    );
END;
$function$;

-- ── Analysis recovery detail: add next_readings (all readings of the next test) ──
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
                'next_result', nxt.result, 'next_aw', nxt.aw, 'next_readings', COALESCE(nxt.readings, '[]'::jsonb), 'remark', dt.remark
            ) AS row_obj
            FROM dispo_targets dt
            JOIN scope sc ON sc.sub_lot_id = dt.target_id
            LEFT JOIN LATERAL (
                SELECT result, aw, readings, ts FROM (
                    SELECT ir2.result, (ir2.values_json->>'aw')::numeric AS aw,
                           _qc_flatten_readings(ir2.values_json) AS readings, ir2.submitted_at AS ts
                    FROM qc_inspection_record ir2
                    WHERE ir2.drying_sub_lot_id = dt.target_id AND ir2.submitted_at > dt.created_at
                    UNION ALL
                    SELECT CASE WHEN qe.event_type = 'group_passed_by_champion' THEN 'pass' ELSE 'fail' END,
                           (qe.payload->>'champion_aw')::numeric,
                           CASE WHEN (qe.payload->>'champion_aw') IS NOT NULL
                                THEN jsonb_build_array(jsonb_build_object('item_name','Water Activity','unit','Aw','value',(qe.payload->>'champion_aw')::numeric))
                                ELSE '[]'::jsonb END,
                           qe.created_at
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

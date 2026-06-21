-- ─────────────────────────────────────────────────────────────────────────────
-- M-140  "Still pending" fails count ANY disposition as handled
--
-- M-120 only treated TERMINAL dispositions (scrap/grind/concession/rework) as
-- resolving a fail, so a cart sent to retest / redry / room-temp still showed
-- under "今天不合格 · N 仍待处理" even though the operator had acted on it — and
-- it had already dropped off the Needs-Attention list (which excludes ANY later
-- disposition). That inconsistency confused operators.
--
-- Fix: failed_today_open (qc_overview) and the per-row `outcome` tag
-- (qc_recent_failed_inspections) now treat ANY later disposition as handled,
-- exactly like the Needs-Attention list. A retest that later fails again creates
-- a fresh fail row, which is "open" again until acted on — so the metric still
-- self-corrects.
--
-- Both functions reproduced verbatim from M-120 with only the disposition-type
-- restriction removed.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION qc_overview() RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
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
                                'aw',                 (ir.values_json->>'aw')::numeric,
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
$$;

-- ── qc_recent_failed_inspections: 'disposed' tag now = ANY later disposition ──
CREATE OR REPLACE FUNCTION qc_recent_failed_inspections(p_days int DEFAULT 2)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(row_obj ORDER BY (row_obj->>'submitted_at') DESC)
    FROM (
      SELECT jsonb_build_object(
        'inspection_id',      ir.id,
        'sample_id',          (SELECT sa.sample_id FROM qc_sample sa WHERE sa.id = ir.sample_id),
        'aw',                 (ir.values_json->>'aw')::numeric,
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
$$;

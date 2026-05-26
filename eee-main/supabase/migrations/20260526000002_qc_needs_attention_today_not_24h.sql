-- Change needs_attention window from rolling 24 hours to today's calendar day.
--
-- The previous query used `ir.submitted_at >= now() - interval '24 hours'`,
-- which caused yesterday's inspections to still appear after midnight.
-- Changed to `ir.submitted_at >= day_start` (today 00:00 UTC) so the list
-- resets at the start of each calendar day.

CREATE OR REPLACE FUNCTION qc_overview() RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
    day_start       timestamptz := date_trunc('day', now());
    day_end         timestamptz := date_trunc('day', now()) + interval '1 day';
    drying_count    integer;
    expected_today  integer;
    awaiting_sample integer;
    awaiting_wa     integer;
    room_temp_count integer;
    passed_today    integer;
    failed_today    integer;
    longest_wait    numeric;
    pass_rate       numeric;
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
            'longest_wait_minutes',  CASE WHEN longest_wait IS NOT NULL THEN ROUND(longest_wait, 1) END,
            'pass_rate_pct',         pass_rate
        ),

        -- ── Needs Attention ────────────────────────────────────────────────
        -- ONE ROW PER GROUP (or per solo cart):
        --   • Source rows are qc_inspection_record from today (day_start).
        --   • A row is kept if at least one of the group's members (or the
        --     solo cart) is still in 'passed'/'hold' AND not yet actioned
        --     (no qc_disposition created after the inspection).
        --   • group_sub_lot_codes/ids list ONLY the members still needing
        --     action — those already released/disposed are filtered out so
        --     the badge list reflects what's left to do.
        -- ───────────────────────────────────────────────────────────────────
        'needs_attention', COALESCE((
            SELECT jsonb_agg(item ORDER BY (item->>'submitted_at') DESC)
            FROM (
                SELECT jsonb_build_object(
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
                  -- Group-aware action filter: keep row only if at least one
                  -- member (or the solo cart) is still in passed/hold AND
                  -- not yet actioned (no disposition after the inspection).
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
                ORDER BY ir.submitted_at DESC
                LIMIT 50
            ) sub
        ), '[]'::jsonb)
    );
END;
$$;

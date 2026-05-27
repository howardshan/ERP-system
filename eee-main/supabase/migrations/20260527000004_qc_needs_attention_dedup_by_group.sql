-- Migration M-107: Needs Attention — one card per sampling group (dedup).
--
-- BUG (reported by operators): when a failed group is retested and fails again,
-- QC Home "Needs attention" shows a SEPARATE card per retest cycle — the same
-- batch/carts appear two, three… times. Screenshot showed three overlapping
-- cards (carts 006/007/008, then 007/008, then 007/008) for one group.
--
-- ROOT CAUSE: the needs_attention subquery emits ONE ROW PER qc_inspection_record
-- from today. Each retest of a champion writes a new (fail) inspection record, so
-- a single group accumulates multiple rows across the day. There was no dedup,
-- despite the "ONE ROW PER GROUP" comment.
--
-- FIX: collapse to one row per group via DISTINCT ON, keeping the LATEST
-- inspection for each test_group_id (solo carts keyed per sub-lot). The latest
-- inspection already drives the correct, current cart list (the disposition
-- filter is relative to ir.submitted_at), so the surviving card reflects the
-- group's present state. Only the needs_attention block changes; stats are
-- identical to M-096 (20260526000002).
--
-- Pairs with M-106 (retest now reuses the same group instead of spawning new
-- ones), so going forward a group's retests converge to a single card.
--
-- Depends on: M-096 (20260526000002). Affects: docs/modules/09_qc.md,
--   docs/database/03_migrations-and-edge-functions.md.

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

        -- ── Needs Attention (ONE CARD PER GROUP — M-107) ───────────────────
        -- Source rows are today's qc_inspection_record. We keep, per group
        -- (solo carts keyed per sub-lot), only the LATEST inspection, then keep
        -- the card only if a member is still passed/hold and not yet actioned.
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
                    ORDER BY group_key, submitted_at DESC   -- DISTINCT ON keeps latest per group
                ) deduped
                ORDER BY submitted_at DESC
                LIMIT 50
            ) sub
        ), '[]'::jsonb)
    );
END;
$$;

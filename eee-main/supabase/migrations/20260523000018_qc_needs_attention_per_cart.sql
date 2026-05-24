-- M-074: Needs-attention → one row per CART, not per inspection record.
--
-- Root cause of the bug:
--   qc_overview() needs_attention was indexed on qc_inspection_record rows.
--   Only the GROUP CHAMPION has an inspection record; sibling carts (whose
--   status was set by M-055 group-propagation) never appeared, even though
--   they are sitting in 'passed' or 'hold' and need operator action.
--
-- Fix:
--   Pivot to a CART-CENTRIC query:
--     • Source table is qc_drying_sub_lot (all carts in passed / hold).
--     • For each cart, find its "relevant inspection" via a LATERAL subquery:
--         (a) the cart's own latest inspection (champions + solo carts), OR
--         (b) any group member's (= champion's) latest inspection
--             (for sibling carts that have no own inspection record).
--     • Keeps the existing "not yet actioned" filter (no disposition created
--       after the relevant inspection → operator hasn't dealt with it yet).
--     • Each row is uniquely keyed by drying_sub_lot_id and uses that as the
--       `inspection_id` field so the frontend can remove individual rows
--       independently.
--
-- Frontend change needed: removeAttentionItem(item.drying_sub_lot_id)
-- (see QcHome.tsx update that ships alongside this migration).

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
        -- ONE ROW PER CART (not per inspection).  Every cart that is in
        -- 'passed' or 'hold' and whose relevant inspection happened in the
        -- last 24 h — and has not yet been acted on — appears here.
        --
        -- Siblings (no own inspection) find their relevant inspection via the
        -- LATERAL sub-query that also searches group members.
        -- ───────────────────────────────────────────────────────────────────
        'needs_attention', COALESCE((
            SELECT jsonb_agg(item ORDER BY (item->>'submitted_at') DESC)
            FROM (
                SELECT jsonb_build_object(
                    -- Use drying_sub_lot_id as the row key so the frontend
                    -- can remove individual carts independently.
                    'inspection_id',       s.id,          -- cart id used as unique key
                    'drying_sub_lot_id',   s.id,
                    'sub_lot_code',        s.sub_lot_code,
                    'sku_name',            sku.name,
                    'lot_number',          lot.lot_number,
                    'work_order_barcode',  lot.work_order_barcode,
                    'aw',                  (ir.values_json->>'aw')::numeric,
                    'result',              ir.result,
                    'submitted_at',        ir.submitted_at,
                    'current_status',      s.status,
                    'sample_id',           (SELECT sa.sample_id FROM qc_sample sa WHERE sa.id = ir.sample_id),
                    'test_group_id',       s.test_group_id,
                    -- Each cart is shown individually; group_size = 1 so
                    -- the Release button says "Release" not "Release all N".
                    'group_size',          1,
                    'group_sub_lot_ids',   jsonb_build_array(s.id),
                    'group_sub_lot_codes', jsonb_build_array(s.sub_lot_code)
                ) AS item
                FROM qc_drying_sub_lot s
                LEFT JOIN qc_production_lot lot ON lot.id = s.production_lot_id
                LEFT JOIN qc_product_sku sku ON sku.id = lot.sku_id
                -- Find the most recent inspection that applies to this cart:
                --   • own inspection (champions, solo carts), OR
                --   • a sibling's / champion's inspection within the same
                --     test_group (for siblings propagated by M-055 / M-048)
                JOIN LATERAL (
                    SELECT ir2.*
                    FROM qc_inspection_record ir2
                    WHERE (
                        ir2.drying_sub_lot_id = s.id
                        OR (
                            s.test_group_id IS NOT NULL
                            AND ir2.drying_sub_lot_id IN (
                                SELECT sl2.id
                                FROM   qc_drying_sub_lot sl2
                                WHERE  sl2.test_group_id = s.test_group_id
                                  AND  sl2.id <> s.id
                            )
                        )
                    )
                    ORDER BY ir2.submitted_at DESC
                    LIMIT 1
                ) ir ON true
                WHERE s.status IN ('passed', 'hold')
                  -- Inspection must be recent (last 24 h)
                  AND ir.submitted_at >= now() - interval '24 hours'
                  -- Skip carts that have already been actioned:
                  -- a disposition created after the relevant inspection
                  -- means the operator already dealt with this cart.
                  AND NOT EXISTS (
                      SELECT 1 FROM qc_disposition d
                      WHERE d.drying_sub_lot_id = s.id
                        AND d.created_at > ir.submitted_at
                  )
                ORDER BY ir.submitted_at DESC
                LIMIT 50
            ) sub
        ), '[]'::jsonb)
    );
END;
$$;

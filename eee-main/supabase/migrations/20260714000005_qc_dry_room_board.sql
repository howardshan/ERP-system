-- ─────────────────────────────────────────────────────────────────────────────
-- M-168  Dry Room Board — per-product slideshow data (today-anchored)
--
-- Powers a QC full-screen board (one page per product, auto-advancing). Per
-- product → work order → date row with 4 stage columns:
--   Dry room / waiting for result / pass / fail
--
-- Rules (confirmed with ops):
--  * Anchored on the plant's local "today" (America/Chicago).
--  * TODAY row (per WO) shows all four columns:
--      - dry_room = carts of the WO in a dryer (drying / room_temp_drying /
--        awaiting_recheck) whose expected out-date buckets to today (overdue or
--        undated carts bucket to today).
--      - waiting  = carts currently pending/inspecting/awaiting_group_result
--        (carries over day to day until a result is entered).
--      - pass     = carts whose LATEST result event TODAY is a pass
--        (inspection_passed | group_passed_by_champion) — a fail→redry→pass on
--        the same day lands here (net "moved from fail to pass").
--      - fail     = carts whose LATEST result event TODAY is a fail
--        (inspection_failed_hold | group_failed_by_champion) AND still in
--        hold/disposing (a redried cart has left fail → it's back in dry_room).
--        pass/fail are TODAY-only; they do NOT carry to the next day.
--  * FUTURE rows (date > today) show ONLY dry_room (the batch scheduled to
--    finish drying that day); waiting/pass/fail = 0.
--  * Past dates are not shown.
--  * Scrap / grind / other terminal dispositions are neither pass nor fail
--    (they naturally fall out: not drying, not waiting, no today result event).
--
-- Plain STABLE, default execute for authenticated (matches M-157 dashboard RPCs).
-- Expected out-date = in_time + expected_dry_minutes (scheduled finish), local date.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION qc_dry_room_board()
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  today  date := (now() AT TIME ZONE 'America/Chicago')::date;
  result jsonb;
BEGIN
  WITH cart AS (
    SELECT s.id, s.status, s.in_time, s.expected_dry_minutes,
           pl.sku_id, pl.work_order_barcode,
           sku.code AS sku_code, sku.name AS sku_name
    FROM qc_drying_sub_lot s
    JOIN qc_production_lot pl ON pl.id = s.production_lot_id
    JOIN qc_product_sku    sku ON sku.id = pl.sku_id
    WHERE pl.work_order_barcode IS NOT NULL
  ),
  -- Carts physically in / awaiting a dryer, bucketed to their expected out-date
  -- (overdue or undated → today).
  dry AS (
    SELECT c.sku_id, c.sku_code, c.sku_name, c.work_order_barcode,
           GREATEST(today,
             CASE WHEN c.status = 'drying' AND c.in_time IS NOT NULL AND c.expected_dry_minutes IS NOT NULL
                  THEN ((c.in_time + (c.expected_dry_minutes * interval '1 minute')) AT TIME ZONE 'America/Chicago')::date
                  ELSE today END
           ) AS d
    FROM cart c
    WHERE c.status IN ('drying','room_temp_drying','awaiting_recheck')
  ),
  dry_counts AS (
    SELECT sku_id, sku_code, sku_name, work_order_barcode, d, count(*)::int AS dry_room
    FROM dry GROUP BY sku_id, sku_code, sku_name, work_order_barcode, d
  ),
  -- Latest result event TODAY per cart.
  res AS (
    SELECT DISTINCT ON (e.drying_sub_lot_id)
           e.drying_sub_lot_id AS cart_id, e.event_type
    FROM qc_quality_event e
    WHERE e.event_type IN ('inspection_passed','inspection_failed_hold',
                           'group_passed_by_champion','group_failed_by_champion')
      AND (e.created_at AT TIME ZONE 'America/Chicago')::date = today
    ORDER BY e.drying_sub_lot_id, e.created_at DESC
  ),
  today_metrics AS (
    SELECT c.sku_id, c.work_order_barcode,
      count(*) FILTER (WHERE c.status IN ('pending','inspecting','awaiting_group_result'))::int AS waiting,
      count(*) FILTER (WHERE r.event_type IN ('inspection_passed','group_passed_by_champion'))::int AS pass,
      count(*) FILTER (WHERE r.event_type IN ('inspection_failed_hold','group_failed_by_champion')
                         AND c.status IN ('hold','disposing'))::int AS fail
    FROM cart c
    LEFT JOIN res r ON r.cart_id = c.id
    GROUP BY c.sku_id, c.work_order_barcode
  ),
  row_keys AS (
    SELECT sku_id, sku_code, sku_name, work_order_barcode, d FROM dry_counts
    UNION
    SELECT c.sku_id, c.sku_code, c.sku_name, c.work_order_barcode, today
    FROM cart c JOIN today_metrics tm ON tm.sku_id = c.sku_id AND tm.work_order_barcode = c.work_order_barcode
    WHERE tm.waiting > 0 OR tm.pass > 0 OR tm.fail > 0
  ),
  rows AS (
    SELECT k.sku_id, k.sku_code, k.sku_name, k.work_order_barcode, k.d,
      COALESCE(dc.dry_room, 0) AS dry_room,
      CASE WHEN k.d = today THEN COALESCE(tm.waiting, 0) ELSE 0 END AS waiting,
      CASE WHEN k.d = today THEN COALESCE(tm.pass,    0) ELSE 0 END AS pass,
      CASE WHEN k.d = today THEN COALESCE(tm.fail,    0) ELSE 0 END AS fail
    FROM row_keys k
    LEFT JOIN dry_counts    dc ON dc.sku_id = k.sku_id AND dc.work_order_barcode = k.work_order_barcode AND dc.d = k.d
    LEFT JOIN today_metrics tm ON tm.sku_id = k.sku_id AND tm.work_order_barcode = k.work_order_barcode
    WHERE k.d >= today
      AND (COALESCE(dc.dry_room, 0) > 0 OR k.d = today)   -- future rows only if dry_room>0; today row always
  )
  SELECT COALESCE(jsonb_agg(prod ORDER BY prod->>'sku_code'), '[]'::jsonb)
  INTO result
  FROM (
    SELECT jsonb_build_object(
      'sku_id', sku_id, 'sku_code', sku_code, 'sku_name', sku_name,
      'rows', jsonb_agg(jsonb_build_object(
          'work_order_barcode', work_order_barcode,
          'date',       d,
          'is_today',   (d = today),
          'is_tomorrow',(d = today + 1),
          'dry_room',   dry_room,
          'waiting',    waiting,
          'pass',       pass,
          'fail',       fail
        ) ORDER BY d, work_order_barcode)
    ) AS prod
    FROM rows
    GROUP BY sku_id, sku_code, sku_name
  ) p;

  RETURN result;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- M-171  Dry Room Board rework: one page per DAY + actual out-date + dryer column
--
-- Changes vs M-168:
--  * Page unit is now a DAY (not a product). page_date = GREATEST(out_date, today).
--    Today's page carries all still-waiting carts; future pages are the drying
--    forecast by expected finish day. Past days are never a page (clamped).
--  * FIX: the "out date" is the cart's ACTUAL check-out day for carts already out
--    (waiting/pass/fail) — it no longer shifts to today when a waiting cart carries
--    forward. Drying carts use their expected finish day.
--  * Rows are grouped by (page, product, work order, out_date, dryer_number) so a
--    batch split across dryers shows as separate rows, each with its dryer #.
--  * Columns per row: product_name, sku_code, work_order, out_date, dry_room,
--    dryer_number, waiting, pass, fail.
--
-- Bucket rules unchanged (M-168): dry_room = drying/room_temp/awaiting_recheck;
-- waiting = pending/inspecting/awaiting_group_result (carried to today);
-- pass/fail = the cart's LATEST result event TODAY (fail also requires still
-- hold/disposing). pass/fail are today-only.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION qc_dry_room_board()
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  today  date := (now() AT TIME ZONE 'America/Chicago')::date;
  result jsonb;
BEGIN
  WITH cart AS (
    SELECT s.id, s.status, s.in_time, s.expected_dry_minutes, s.out_time, s.dryer_number,
           s.location_id,
           pl.sku_id, sku.code AS sku_code, sku.name AS sku_name, pl.work_order_barcode AS wo
    FROM qc_drying_sub_lot s
    JOIN qc_production_lot pl ON pl.id = s.production_lot_id
    JOIN qc_product_sku    sku ON sku.id = pl.sku_id
    WHERE pl.work_order_barcode IS NOT NULL
  ),
  res AS (   -- latest result event TODAY per cart
    SELECT DISTINCT ON (e.drying_sub_lot_id) e.drying_sub_lot_id AS cid, e.event_type
    FROM qc_quality_event e
    WHERE e.event_type IN ('inspection_passed','inspection_failed_hold',
                           'group_passed_by_champion','group_failed_by_champion')
      AND (e.created_at AT TIME ZONE 'America/Chicago')::date = today
    ORDER BY e.drying_sub_lot_id, e.created_at DESC
  ),
  norm AS (
    SELECT
      c.sku_id, c.sku_code, c.sku_name, c.wo,
      (c.status IN ('drying','room_temp_drying','awaiting_recheck'))                         AS is_dry,
      (c.status IN ('pending','inspecting','awaiting_group_result'))                         AS is_wait,
      (r.event_type IN ('inspection_passed','group_passed_by_champion'))                     AS is_pass,
      (r.event_type IN ('inspection_failed_hold','group_failed_by_champion')
         AND c.status IN ('hold','disposing'))                                               AS is_fail,
      CASE
        WHEN c.status IN ('drying','room_temp_drying','awaiting_recheck')
          THEN GREATEST(today,
                 CASE WHEN c.status = 'drying' AND c.in_time IS NOT NULL AND c.expected_dry_minutes IS NOT NULL
                      THEN ((c.in_time + (c.expected_dry_minutes * interval '1 minute')) AT TIME ZONE 'America/Chicago')::date
                      ELSE today END)
        ELSE (c.out_time AT TIME ZONE 'America/Chicago')::date        -- ACTUAL out day
      END AS out_date,
      -- dryer only for carts physically in a dryer (direct number or via location)
      CASE WHEN c.status = 'drying'
           THEN COALESCE(c.dryer_number, (SELECT dl.dryer_number FROM qc_drying_location dl WHERE dl.id = c.location_id))
           END AS dryer
    FROM cart c
    LEFT JOIN res r ON r.cid = c.id
  ),
  keep AS (
    SELECT * FROM norm WHERE is_dry OR is_wait OR is_pass OR is_fail
  ),
  rows AS (
    SELECT
      GREATEST(out_date, today) AS page_date,
      out_date, sku_id, sku_code, sku_name, wo, dryer,
      count(*) FILTER (WHERE is_dry)::int  AS dry_room,
      count(*) FILTER (WHERE is_wait)::int AS waiting,
      count(*) FILTER (WHERE is_pass)::int AS pass,
      count(*) FILTER (WHERE is_fail)::int AS fail
    FROM keep
    GROUP BY GREATEST(out_date, today), out_date, sku_id, sku_code, sku_name, wo, dryer
    HAVING count(*) FILTER (WHERE is_dry) + count(*) FILTER (WHERE is_wait)
         + count(*) FILTER (WHERE is_pass) + count(*) FILTER (WHERE is_fail) > 0
  )
  SELECT COALESCE(jsonb_agg(pg ORDER BY (pg->>'page_date')), '[]'::jsonb)
  INTO result
  FROM (
    SELECT jsonb_build_object(
      'page_date',   page_date,
      'is_today',    (page_date = today),
      'is_tomorrow', (page_date = today + 1),
      'rows', jsonb_agg(jsonb_build_object(
          'product_name',  sku_name,
          'sku_code',      sku_code,
          'work_order',    wo,
          'out_date',      out_date,
          'dry_room',      dry_room,
          'dryer_number',  dryer,
          'waiting',       waiting,
          'pass',          pass,
          'fail',          fail
        ) ORDER BY sku_code, wo, out_date, dryer NULLS LAST)
    ) AS pg
    FROM rows
    GROUP BY page_date
  ) p;

  RETURN result;
END;
$$;

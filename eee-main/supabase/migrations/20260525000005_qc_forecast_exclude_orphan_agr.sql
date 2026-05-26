-- M-083: Fix qc_dashboard_pass_rate_forecast to exclude orphaned
--        awaiting_group_result carts from the in-flight count.
--
-- Root cause:
--   The inflight CTE counted every cart in ('pending','inspecting',
--   'awaiting_group_result').  When group siblings are orphaned — their
--   champion has already been resolved (passed/failed/released/closed) or
--   the champion never existed — those siblings are stuck in
--   'awaiting_group_result' with no path forward.  They inflate the
--   "in-flight" count indefinitely.
--
-- Fix:
--   'awaiting_group_result' carts are only counted when their group champion
--   is still actively being tested (status IN ('pending','inspecting')).
--   Orphaned siblings whose champion has moved past testing are excluded.
--
--   'pending' and 'inspecting' carts are always counted (including carts
--   coming back from a retest disposition).

CREATE OR REPLACE FUNCTION qc_dashboard_pass_rate_forecast()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH today_inspections AS (
    SELECT pl.sku_id, ir.result
    FROM qc_inspection_record ir
    JOIN qc_drying_sub_lot s ON s.id = ir.drying_sub_lot_id
    JOIN qc_production_lot pl ON pl.id = s.production_lot_id
    WHERE ir.submitted_at >= date_trunc('day', now())
  ),
  pass_rate AS (
    SELECT sku_id,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE result = 'pass')::numeric / NULLIF(COUNT(*), 0) AS rate
    FROM today_inspections
    GROUP BY sku_id
  ),
  inflight AS (
    SELECT pl.sku_id, COUNT(*)::int AS in_progress
    FROM qc_drying_sub_lot s
    JOIN qc_production_lot pl ON pl.id = s.production_lot_id
    WHERE
      -- Always count carts actively being tested
      s.status IN ('pending', 'inspecting')
      OR (
        -- Count awaiting_group_result siblings only when their group champion
        -- is still in the testing queue (i.e. result not yet submitted).
        -- Orphaned siblings — champion already resolved — are excluded.
        s.status = 'awaiting_group_result'
        AND s.test_group_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM qc_drying_sub_lot champ
          WHERE champ.test_group_id = s.test_group_id
            AND champ.is_test_champion = true
            AND champ.status IN ('pending', 'inspecting')
        )
      )
    GROUP BY pl.sku_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'sku_id',            sku.id,
    'sku_code',          sku.code,
    'sku_name',          sku.name,
    'in_progress',       COALESCE(i.in_progress, 0),
    'today_pass_rate',   pr.rate,
    'today_inspections', COALESCE(pr.total, 0),
    'forecast_passes',   ROUND(COALESCE(i.in_progress, 0) * COALESCE(pr.rate, 1.0))::int
  ) ORDER BY sku.code), '[]'::jsonb)
  FROM qc_product_sku sku
  LEFT JOIN inflight i ON i.sku_id = sku.id
  LEFT JOIN pass_rate pr ON pr.sku_id = sku.id
  WHERE COALESCE(i.in_progress, 0) > 0;
$$;

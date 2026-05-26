-- M-081: Narrow the "in flight" pool used by qc_dashboard_pass_rate_forecast.
--
-- Previous (M-050) definition included every cart still in any non-terminal
-- status (drying / pending / awaiting_group_result / awaiting_recheck /
-- room_temp_drying / hold / inspecting).  That over-counted carts the
-- operator hasn't even thought about testing yet:
--   - 'drying' / 'room_temp_drying' / 'awaiting_recheck' are still in the
--     dryer (or re-drying after a FAIL).  No imminent test.
--   - 'hold' is already FAILED, waiting for disposition.  No more tests
--     until a redry/retest disposition completes.
--
-- New definition: only carts that are *being tested* or *about to be tested*:
--   - 'inspecting'              — sample taken, Aw being entered
--   - 'pending'                 — checked out, in Testing queue
--   - 'awaiting_group_result'   — sibling whose champion will produce the
--                                 result they inherit via M-055 propagation
--
-- The formula stays the same — ROUND(in_progress × COALESCE(pass_rate, 1.0))
-- — so a SKU with no inspections today still shows the optimistic 100% case.

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
    -- Only carts that will (very soon) yield an inspection result.
    -- See migration header for the rationale on which statuses are kept.
    WHERE s.status IN ('pending', 'inspecting', 'awaiting_group_result')
    GROUP BY pl.sku_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'sku_id', sku.id,
    'sku_code', sku.code,
    'sku_name', sku.name,
    'in_progress', COALESCE(i.in_progress, 0),
    'today_pass_rate', pr.rate,
    'today_inspections', COALESCE(pr.total, 0),
    'forecast_passes', ROUND(COALESCE(i.in_progress, 0) * COALESCE(pr.rate, 1.0))::int
  ) ORDER BY sku.code), '[]'::jsonb)
  FROM qc_product_sku sku
  LEFT JOIN inflight i ON i.sku_id = sku.id
  LEFT JOIN pass_rate pr ON pr.sku_id = sku.id
  WHERE COALESCE(i.in_progress, 0) > 0;
$$;

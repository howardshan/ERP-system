-- M-157: Dashboard module — per work-order cart pipeline + drying-exit forecast.
--
-- Powers the new top-level "Dashboard" module.  Where the Production module's
-- qc_production_pipeline_summary (M-093) gives a coarse per-SKU board, this
-- breaks the same carts (qc_drying_sub_lot, one row = one drying cart) down by
-- product (SKU) → work order, and splits the single "testing" bucket into the
-- four sub-stages an operator actually tracks.
--
-- Stage → status mapping (single qc_drying_sub_lot.status column drives all):
--   created       — status='created'                            (not yet in dryer)
--   dry_room      — drying | room_temp_drying | awaiting_recheck (in / re-drying)
--   waiting_test  — pending AND no pending qc_sample             (checked out, not sampled)
--   sampled       — (pending AND pending sample) | inspecting | awaiting_group_result
--   passed        — passed                                      (= waiting release; same carts)
--   retest        — hold | disposing                            (failed, awaiting disposition)
--   released      — closed                                      (released, waiting packing)
--   dispatched    — dispatched                                  (handed to packing)
--
-- Note: "passed" and "waiting release" are the SAME carts in this system — a
-- cart stays at status='passed' until QC clicks Release (→ 'closed'). So they
-- are one column, not two.
--
-- Work-order link: qc_drying_sub_lot → qc_production_lot.work_order_barcode
-- (the live cart's work order) and .sku_id → qc_product_sku.
--
-- Both functions follow M-093: plain LANGUAGE sql STABLE, no SECURITY DEFINER,
-- default execute for authenticated.  A seed at the bottom grants the new
-- dashboard module + dashboard.pipeline.view to everyone who can already see
-- the production pipeline, so the board is reachable out of the box.

-- ── 1) Per work-order pipeline ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION qc_dashboard_work_order_pipeline()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH cart AS (
    SELECT
      sku.id   AS sku_id,
      sku.code AS sku_code,
      sku.name AS sku_name,
      lot.work_order_barcode AS work_order_no,
      s.status AS status,
      EXISTS (
        SELECT 1 FROM qc_sample sm
        WHERE sm.drying_sub_lot_id = s.id AND sm.status = 'pending'
      ) AS has_pending_sample
    FROM qc_drying_sub_lot s
    JOIN qc_production_lot lot ON lot.id = s.production_lot_id
    JOIN qc_product_sku   sku ON sku.id = lot.sku_id
  ),
  wo AS (
    SELECT
      sku_id, sku_code, sku_name, work_order_no,
      COUNT(*) FILTER (WHERE status = 'created')::int                                              AS created,
      COUNT(*) FILTER (WHERE status IN ('drying','room_temp_drying','awaiting_recheck'))::int      AS dry_room,
      COUNT(*) FILTER (WHERE status = 'pending' AND NOT has_pending_sample)::int                   AS waiting_test,
      COUNT(*) FILTER (WHERE (status = 'pending' AND has_pending_sample)
                          OR status IN ('inspecting','awaiting_group_result'))::int                AS sampled,
      COUNT(*) FILTER (WHERE status = 'passed')::int                                               AS passed,
      COUNT(*) FILTER (WHERE status IN ('hold','disposing'))::int                                  AS retest,
      COUNT(*) FILTER (WHERE status = 'closed')::int                                               AS released,
      COUNT(*) FILTER (WHERE status = 'dispatched')::int                                           AS dispatched,
      COUNT(*)::int                                                                                AS total
    FROM cart
    GROUP BY sku_id, sku_code, sku_name, work_order_no
  ),
  by_sku AS (
    SELECT
      sku_id, sku_code, sku_name,
      jsonb_agg(
        jsonb_build_object(
          'work_order_no', work_order_no,
          'created', created, 'dry_room', dry_room,
          'waiting_test', waiting_test, 'sampled', sampled,
          'passed', passed, 'retest', retest,
          'released', released, 'dispatched', dispatched,
          'total', total
        ) ORDER BY work_order_no
      ) FILTER (WHERE total > 0) AS work_orders,
      SUM(created)::int AS created, SUM(dry_room)::int AS dry_room,
      SUM(waiting_test)::int AS waiting_test, SUM(sampled)::int AS sampled,
      SUM(passed)::int AS passed, SUM(retest)::int AS retest,
      SUM(released)::int AS released, SUM(dispatched)::int AS dispatched,
      SUM(total)::int AS total
    FROM wo
    GROUP BY sku_id, sku_code, sku_name
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'sku_id', sku_id, 'sku_code', sku_code, 'sku_name', sku_name,
      'totals', jsonb_build_object(
        'created', created, 'dry_room', dry_room,
        'waiting_test', waiting_test, 'sampled', sampled,
        'passed', passed, 'retest', retest,
        'released', released, 'dispatched', dispatched, 'total', total
      ),
      'work_orders', COALESCE(work_orders, '[]'::jsonb)
    ) ORDER BY sku_code
  ), '[]'::jsonb)
  FROM by_sku
  WHERE total > 0;
$$;

-- ── 2) Drying-room exit forecast ─────────────────────────────────────────────
-- For carts still drying, ETA = now() + (expected_dry_minutes − dried so far).
-- Buckets are computed in the plant's local day (America/Chicago, matching the
-- frontend's Dallas helpers).  Returns one row per group; the frontend renders
-- translatable labels from grp + days_from_today:
--   grp='overdue'  past-due carts (ETA before today)
--   grp='day'      individual day buckets, days_from_today 0..p_days
--   grp='later'    ETA beyond the p_days window
--   grp='unknown'  no expected_dry_minutes set
CREATE OR REPLACE FUNCTION qc_dashboard_drying_exit_forecast(p_days int DEFAULT 7)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH params AS (
    SELECT (now() AT TIME ZONE 'America/Chicago')::date AS today
  ),
  drying AS (
    SELECT
      CASE
        WHEN s.expected_dry_minutes IS NULL THEN NULL
        ELSE ((now() + ((s.expected_dry_minutes - qc_total_dried_minutes(s.id)) * interval '1 minute'))
              AT TIME ZONE 'America/Chicago')::date
      END AS exit_date
    FROM qc_drying_sub_lot s
    WHERE s.status = 'drying'
  ),
  classified AS (
    SELECT
      p.today,
      CASE
        WHEN d.exit_date IS NULL                THEN 'unknown'
        WHEN d.exit_date < p.today              THEN 'overdue'
        WHEN d.exit_date > p.today + p_days     THEN 'later'
        ELSE 'day'
      END AS grp,
      CASE
        WHEN d.exit_date IS NULL
          OR d.exit_date < p.today
          OR d.exit_date > p.today + p_days     THEN NULL
        ELSE d.exit_date
      END AS bucket_date
    FROM drying d CROSS JOIN params p
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'bucket_date',     bucket_date,
      'grp',             grp,
      'days_from_today', CASE WHEN bucket_date IS NOT NULL THEN (bucket_date - today) END,
      'cart_count',      cart_count
    ) ORDER BY sort_key
  ), '[]'::jsonb)
  FROM (
    SELECT
      grp, bucket_date, today,
      COUNT(*)::int AS cart_count,
      CASE grp
        WHEN 'overdue' THEN -1
        WHEN 'day'     THEN (bucket_date - today)
        WHEN 'later'   THEN 9000
        WHEN 'unknown' THEN 9001
      END AS sort_key
    FROM classified
    GROUP BY grp, bucket_date, today
  ) q;
$$;

-- ── 3) Seed module access + view permission ──────────────────────────────────
-- Anyone who can already reach the production pipeline (production module
-- access) gets the new dashboard module card + dashboard.pipeline.view.
INSERT INTO user_module_access (user_id, module_id)
SELECT DISTINCT user_id, 'dashboard'
FROM user_module_access
WHERE module_id IN ('production', 'qc')
ON CONFLICT DO NOTHING;

INSERT INTO user_permission_grant (user_id, module_id, resource, permission, approval_limit)
SELECT DISTINCT user_id, 'dashboard', 'pipeline', 'view', NULL::numeric
FROM user_module_access
WHERE module_id IN ('production', 'qc')
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;

-- Migration M-129: Production Phase 2 M2.1 — 逐车成型录入(挂到 QC 车)
--
-- 把成型录入从"扫工单 + 车号范围 + 汇总"改为"逐车":操作员扫一辆车的车贴
-- (sub_lot_code,QC 建批次时已生成),录这辆车的成型产出 → 提交一条 prod_run。
-- 一辆车从成型→烘干→QC→放行全程同一身份(qc_drying_sub_lot),生产↔QC 自动打通。
--
-- 架构:不另起第三套"车"。复用单一事实源 prod_run:
--   * prod_run 加 sub_lot_id(→ qc_drying_sub_lot)。成型一辆车 = 一条 prod_run
--     (cart_from=cart_to=车序号、source='tablet'、operator_id 空)。
--   * 产品/标准速率经"工单桥":车 → production_lot.work_order_barcode →
--     prod_work_order.work_order_no → product_id → prod_product_master(bone_avg 等)。
--     绕开两套产品主数据的差异(qc_product_sku.code=SKU-NNNN 与 item_number 不同)。
--   * 平板(anon)不直读 qc 表;经 SECURITY DEFINER RPC prod_find_cart_for_forming 解析。
--
-- 业务规则:
--   BR-P8 — 成型逐车:一辆车一条 prod_run,sub_lot_id 直链 QC 车;产品与标准速率经工单桥
--     (prod_work_order → prod_product_master)取得;一辆车只一条成型 run(部分唯一索引防重)。
--
-- Depends on: M-122/M-125(prod_run、prod_run_view、prod_work_order、prod_product_master)、
--   M-020(qc_drying_sub_lot / qc_production_lot)。
-- Affects: src/services/productionTabletApi.ts、src/pages/tablet/TabletApp.tsx、
--   src/services/productionRunApi.ts、src/pages/production/DailyReportPage.tsx、docs/...。

-- ── 1. prod_run.sub_lot_id(链到 QC 车)──────────────────────────────────────
ALTER TABLE prod_run
  ADD COLUMN IF NOT EXISTS sub_lot_id uuid REFERENCES qc_drying_sub_lot(id);

-- 一辆车只允许一条成型 run(防重复录);range 行 sub_lot_id 为空不受约束。
CREATE UNIQUE INDEX IF NOT EXISTS uq_prod_run_sub_lot
  ON prod_run (sub_lot_id) WHERE sub_lot_id IS NOT NULL;

-- ── 2. 重建 prod_run_view(补 sub_lot;BR-P1 计算列逐字不变)─────────────────
DROP VIEW IF EXISTS prod_run_view;
CREATE VIEW prod_run_view AS
SELECT
  dr.id,
  dr.report_date,
  dr.shift,
  dr.machine_id,
  m.code                                   AS machine_code,
  dr.work_order_id,
  wo.work_order_no,
  wo.status                                AS work_order_status,
  wo.planned_qty,
  dr.product_id,
  p.item_number,
  p.description                            AS item_description,
  p.process,
  p.is_activity,
  dr.operator_id,
  op.badge_no,
  op.name                                  AS operator_name,
  dr.sub_lot_id,
  sl.sub_lot_code,
  dr.work_order,
  dr.cart_from,
  dr.cart_to,
  dr.output_qty,
  dr.work_hours,
  dr.defect_waste_lbs,
  dr.down_hours,
  dr.downtime_reason_id,
  rsn.label                                AS downtime_reason,
  dr.note,
  dr.source,
  dr.status                                AS run_status,
  dr.final_cart_complete,
  dr.continues_prev,
  dr.device_id,
  -- computed (BR-P1). standard_lbs_hr / runner_weight_pct mirror Excel's
  -- VLOOKUP-of-a-blank-cell → 0 (only when the product row exists; an absent
  -- product stays NULL, like Excel's IFERROR("")).
  CASE WHEN dr.product_id IS NOT NULL
       THEN COALESCE(p.pcs_lbs_per_hour, 0) END             AS standard_lbs_hr,
  (COALESCE(p.bone_avg, 0)   * dr.output_qty)               AS lbs_good_produced,
  CASE WHEN dr.product_id IS NOT NULL
       THEN COALESCE(p.runner_avg, 0) END                   AS runner_weight_pct,
  (COALESCE(p.runner_avg, 0) * dr.output_qty)               AS runner_regrind_lbs,
  CASE WHEN dr.work_hours > 0
       THEN dr.output_qty / dr.work_hours END               AS pcs_lbs_per_hr,
  CASE WHEN dr.work_hours > 0 AND COALESCE(p.pcs_lbs_per_hour,0) <> 0
       THEN (dr.output_qty / dr.work_hours) / p.pcs_lbs_per_hour END AS credit,
  (COALESCE(dr.cart_to, 0) - COALESCE(dr.cart_from, 0) + 1) AS total_carts,
  EXTRACT(week FROM dr.report_date)::int                    AS week_num,
  dr.created_at,
  dr.created_by,
  dr.updated_at,
  dr.updated_by
FROM prod_run dr
JOIN prod_machine          m   ON m.id   = dr.machine_id
LEFT JOIN prod_operator         op  ON op.id  = dr.operator_id
LEFT JOIN prod_work_order        wo  ON wo.id  = dr.work_order_id
LEFT JOIN prod_product_master   p   ON p.id   = dr.product_id
LEFT JOIN prod_downtime_reason  rsn ON rsn.id = dr.downtime_reason_id
LEFT JOIN qc_drying_sub_lot      sl  ON sl.id  = dr.sub_lot_id;

-- ── 3. 扫车解析 RPC(SECURITY DEFINER,工单桥,授予 anon)────────────────────
-- 平板扫车贴(sub_lot_code)→ 解析车 + 经工单桥带出产品与标准速率,一次调用。
CREATE OR REPLACE FUNCTION prod_find_cart_for_forming(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  SELECT
    sl.id                                   AS sub_lot_id,
    sl.sub_lot_code,
    sl.status,
    pl.work_order_barcode,
    wo.id                                   AS work_order_id,
    wo.product_id,
    p.item_number,
    p.description,
    p.bone_avg,
    p.pcs_lbs_per_hour,
    p.runner_avg,
    EXISTS (SELECT 1 FROM prod_run r2 WHERE r2.sub_lot_id = sl.id) AS already_formed
  INTO r
  FROM qc_drying_sub_lot sl
  JOIN qc_production_lot  pl ON pl.id = sl.production_lot_id
  LEFT JOIN prod_work_order      wo ON wo.work_order_no = pl.work_order_barcode
  LEFT JOIN prod_product_master  p  ON p.id = wo.product_id
  WHERE sl.sub_lot_code = btrim(p_code);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cart not found';
  END IF;

  RETURN jsonb_build_object(
    'sub_lot_id',         r.sub_lot_id,
    'sub_lot_code',       r.sub_lot_code,
    'status',             r.status,
    'seq',                NULLIF(regexp_replace(r.sub_lot_code, '^.*-(\d+)$', '\1'),
                                 r.sub_lot_code)::int,
    'work_order_barcode', r.work_order_barcode,
    'work_order_id',      r.work_order_id,
    'product_id',         r.product_id,
    'item_number',        r.item_number,
    'description',        r.description,
    'bone_avg',           r.bone_avg,
    'pcs_lbs_per_hour',   r.pcs_lbs_per_hour,
    'runner_avg',         r.runner_avg,
    'already_formed',     r.already_formed
  );
END;
$$;

GRANT EXECUTE ON FUNCTION prod_find_cart_for_forming(text) TO anon, authenticated;

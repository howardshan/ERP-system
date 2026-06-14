-- Migration M-124: Production Phase 2 M1.1 — work order master + prod_run 单一事实源
--
-- Phase 2 把生产录入前移到一线、实时化(见 docs/Production模块-Phase2-SPEC.md)。M1.1 是地基:
--   1) 新建轻量工单主数据 prod_work_order(D1:工单源自外部系统,本期系统内手动维护)。
--   2) 方案 A 收敛(D3):把 Phase 1 的 prod_daily_report 收敛为单一事实源 prod_run,
--      prod_daily_report 降为兼容视图;计算列改由 prod_run_view 输出。
--   3) 为工单驱动录入(F3)与后续平板端(M1.2)预留字段。
--
-- 关键决策:
--   * 原地 RENAME(不重建),保留 PK / dev_all RLS / 索引 / FK / 现有 M-122/M-123 测试行。
--   * M1.1 保留 operator_id(改 nullable)与 work_hours —— 管理页仍是 Phase-1 的"每操作员一行"
--     形态,Credit/Pcs·Hr 仍以 work_hours 为分母,BR-P1 口径零变化。D5「工时=Σ打卡」在 M1.2
--     引入 prod_line_attendance 后再切换。不在 M1.1 合并历史行(避免产量重复计)。
--   * 工序不进工单(D10):自动带出工序 = 经 product_id 读 prod_product_master.process。
--
-- 业务规则:
--   BR-P3 — prod_run 单一事实源:平板与管理端的生产记录统一落 prod_run;source 区分来源
--     (tablet/manager),status 区分流转(draft/submitted/reviewed)。prod_daily_report 仅为兼容视图。
--   BR-P4 — 工单累计/车数去重(D8):工单实际产出 = 名下各 run 的 output_qty 之和;
--     总车数 = MAX(cart_to) − MIN(cart_from) + 1(续做的交接车按一辆计)。
--
-- Depends on: M-122(prod_* schema)、M-009(权限表)。
-- Affects: src/lib/permissionStructure.ts、src/services/productionRunApi.ts(原 productionDailyApi.ts)、
--   src/services/productionWorkOrderApi.ts、src/pages/production/{WorkOrderPage,DailyReportPage,ProductionModule}.tsx、
--   docs/database/03...、docs/modules/12_production-daily-report.md、docs/Production模块-Phase2-SPEC.md。

-- ── 1a. 工单主数据 prod_work_order ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prod_work_order (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_no text NOT NULL UNIQUE,
  product_id    uuid REFERENCES prod_product_master(id),
  machine_id    uuid REFERENCES prod_machine(id),          -- 计划产线,可空
  planned_qty   numeric,                                   -- 计划产量,可空
  status        text NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','in_progress','closed','cancelled')),
  planned_date  date,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text,
  updated_at    timestamptz,
  updated_by    text
);
CREATE INDEX IF NOT EXISTS idx_prod_work_order_status ON prod_work_order (status);

ALTER TABLE prod_work_order ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "dev_all" ON prod_work_order FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 1b. prod_daily_report → prod_run(原地改造)──────────────────────────────
DROP VIEW IF EXISTS prod_daily_report_view;   -- 依赖该表,需先删

ALTER TABLE prod_daily_report RENAME TO prod_run;
ALTER INDEX IF EXISTS idx_prod_daily_report_date_shift RENAME TO idx_prod_run_date_shift;

ALTER TABLE prod_run ALTER COLUMN operator_id DROP NOT NULL;   -- M1.2 团队 run 无单一操作员

ALTER TABLE prod_run
  ADD COLUMN IF NOT EXISTS work_order_id       uuid REFERENCES prod_work_order(id),
  ADD COLUMN IF NOT EXISTS source              text    NOT NULL DEFAULT 'manager',
  ADD COLUMN IF NOT EXISTS status              text    NOT NULL DEFAULT 'submitted',
  ADD COLUMN IF NOT EXISTS final_cart_complete boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS continues_prev      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS device_id           uuid;          -- M1.2 再加 FK→prod_line_device

DO $$ BEGIN
  ALTER TABLE prod_run ADD CONSTRAINT prod_run_source_chk CHECK (source IN ('tablet','manager'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE prod_run ADD CONSTRAINT prod_run_status_chk CHECK (status IN ('draft','submitted','reviewed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_prod_run_work_order ON prod_run (work_order_id);

-- ── 1c. 计算视图 prod_run_view ───────────────────────────────────────────────
-- BR-P1 的 10 个计算表达式与 M-122 prod_daily_report_view 逐字一致(回归关键)。
-- 变化:FROM prod_run;operator 改 LEFT JOIN(可空);新增 work_order LEFT JOIN 与新 run 列。
CREATE OR REPLACE VIEW prod_run_view AS
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
LEFT JOIN prod_downtime_reason  rsn ON rsn.id = dr.downtime_reason_id;

-- ── 1d. 兼容视图(保险:任何遗留 SQL 仍可解析)────────────────────────────────
CREATE VIEW prod_daily_report AS SELECT * FROM prod_run;

-- ── 1e. 工单累计视图(BR-P4 / D8)────────────────────────────────────────────
CREATE OR REPLACE VIEW prod_work_order_rollup_view AS
SELECT
  wo.id              AS work_order_id,
  wo.work_order_no,
  wo.planned_qty,
  COUNT(r.id)                        AS run_count,
  COALESCE(SUM(r.output_qty), 0)     AS total_output,
  CASE WHEN COUNT(r.id) = 0 THEN 0
       ELSE COALESCE(MAX(r.cart_to), 0) - COALESCE(MIN(r.cart_from), 0) + 1
  END                                AS distinct_carts
FROM prod_work_order wo
LEFT JOIN prod_run r ON r.work_order_id = wo.id
GROUP BY wo.id, wo.work_order_no, wo.planned_qty;

-- ── 1f. 权限种子(同 M-122 cross-join,幂等)──────────────────────────────────
INSERT INTO user_permission_grant (user_id, module_id, resource, permission)
SELECT g.user_id, 'production', 'work_order', perm.permission
FROM (
  SELECT DISTINCT user_id
  FROM user_permission_grant
  WHERE module_id = 'production'
    AND resource = 'module_permissions' AND permission = 'manage'
) g
CROSS JOIN (VALUES ('view'), ('create'), ('edit'), ('close')) AS perm(permission)
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;

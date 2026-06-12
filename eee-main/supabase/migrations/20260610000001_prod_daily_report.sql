-- Migration M-122: Production Daily Report — schema, view, RLS, permissions
--
-- Digitises the production manager's daily Excel ("2026 Daily Report Forming
-- Production.xlsx", sheet "Daily Report"). That sheet is a production flow log:
-- one row per (date × shift × machine × work order × operator). ~13 columns are
-- hand-entered; the other 10 are Excel formulas (VLOOKUP into the RAW DATA /
-- name item dictionaries, plus arithmetic). We move the data-entry into the ERP.
--
-- Design (per plan, BR-P1/BR-P2):
--   * 5 tables, all prod_-prefixed, uuid PKs, created_at/created_by, dev_all RLS
--     (matches existing convention — app-layer permission checks still apply).
--   * prod_product_master is a NEW independent master (we deliberately do NOT
--     reuse qc_product_sku / item) holding the standard rates the formulas need.
--   * Operators live in a lightweight roster prod_operator (badge_no -> name),
--     optionally linked to erp_user — we do NOT push ~159 floor workers into the
--     login/permission table erp_user.
--   * prod_daily_report stores ONLY the hand-entered fields. The 10 computed
--     columns are derived in the view prod_daily_report_view, so the calculation
--     口径 stays in one place and matches the Excel exactly.
--
-- The master data itself is seeded by M-123 (20260610000002, generated from the
-- workbook by scripts/gen_prod_seed.py). Historical Daily Report rows are NOT
-- imported.
--
-- BR-P1 — Computed-column 口径 (1:1 with the Excel formulas, verified against
--   10k+ historical rows):
--     item_description   = product.description
--     standard_lbs_hr    = product.pcs_lbs_per_hour            (RAW DATA col 7)
--     lbs_good_produced  = product.bone_avg   * output_qty     (RAW DATA col 9)
--     runner_weight_pct  = product.runner_avg                  (RAW DATA col 8)
--     runner_regrind_lbs = product.runner_avg * output_qty
--     pcs_lbs_per_hr     = output_qty / work_hours
--     credit             = (output_qty / work_hours) / product.pcs_lbs_per_hour
--     total_carts        = COALESCE(cart_to,0) - COALESCE(cart_from,0) + 1
--                          (Excel =J-I+1 yields 1 for blank cart rows, e.g. MH)
--     operator_name      = operator.name
--     week_num           = ISO-ish week number of report_date
-- BR-P2 — Non-producing activity rows (Material Handler / Meeting / R&D Test /
--   Machine Down / etc.) are real prod_product_master entries flagged
--   is_activity=true with null rates, so they can be logged while their
--   computed output/credit columns naturally come out 0/NULL.
--
-- Depends on: M-009 (erp_user, user_module_access, user_permission_grant).
-- Affects: src/lib/permissionStructure.ts, src/services/productionDailyApi.ts,
--   src/pages/production/{ProductionModule,DailyReportPage}.tsx,
--   docs/database/03..., docs/modules/12_production-daily-report.md.

-- ── Master data ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS prod_product_master (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_number       text NOT NULL UNIQUE,
  description       text,
  size              text,
  process           text,
  oz_per_piece      numeric,
  lbs_per_hr        numeric,
  pcs_lbs_per_hour  numeric,           -- "Standard Lbs/Hr" source
  runner_avg        numeric,           -- "Runner weight %" source
  bone_avg          numeric,           -- "Lbs Good Produced" per-piece source
  is_activity       boolean NOT NULL DEFAULT false,
  note              text,
  status            text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','inactive')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text
);

CREATE TABLE IF NOT EXISTS prod_machine (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  kind        text NOT NULL DEFAULT 'other'
              CHECK (kind IN ('inj','ext','other')),
  sort_order  integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text
);

CREATE TABLE IF NOT EXISTS prod_downtime_reason (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  label       text NOT NULL,           -- bilingual original, e.g. 'Other其他问题'
  sort_order  integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text
);

CREATE TABLE IF NOT EXISTS prod_operator (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  badge_no     integer NOT NULL UNIQUE,   -- the Excel "Name Item" code
  name         text NOT NULL,
  erp_user_id  uuid REFERENCES erp_user(id) ON DELETE SET NULL,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text
);

-- ── Transaction log (hand-entered fields only) ──────────────────────────────

CREATE TABLE IF NOT EXISTS prod_daily_report (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date        date NOT NULL,
  shift              text NOT NULL CHECK (shift IN ('1st','2nd','3rd')),
  machine_id         uuid NOT NULL REFERENCES prod_machine(id),
  product_id         uuid REFERENCES prod_product_master(id),
  operator_id        uuid NOT NULL REFERENCES prod_operator(id),
  work_order         text,
  cart_from          integer,
  cart_to            integer,
  output_qty         numeric NOT NULL DEFAULT 0,   -- Production Outputs (pcs/lbs)
  work_hours         numeric NOT NULL DEFAULT 0,
  defect_waste_lbs   numeric,
  down_hours         numeric,
  downtime_reason_id uuid REFERENCES prod_downtime_reason(id),
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         text,
  updated_at         timestamptz,
  updated_by         text
);

CREATE INDEX IF NOT EXISTS idx_prod_daily_report_date_shift
  ON prod_daily_report (report_date, shift);

-- ── Computed view (the 10 Excel formula columns) ────────────────────────────

CREATE OR REPLACE VIEW prod_daily_report_view AS
SELECT
  dr.id,
  dr.report_date,
  dr.shift,
  dr.machine_id,
  m.code                                   AS machine_code,
  dr.product_id,
  p.item_number,
  p.description                            AS item_description,
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
FROM prod_daily_report dr
JOIN prod_machine          m   ON m.id   = dr.machine_id
JOIN prod_operator         op  ON op.id  = dr.operator_id
LEFT JOIN prod_product_master   p   ON p.id   = dr.product_id
LEFT JOIN prod_downtime_reason  rsn ON rsn.id = dr.downtime_reason_id;

-- ── RLS (dev_all — app enforces permissions) ────────────────────────────────

ALTER TABLE prod_product_master   ENABLE ROW LEVEL SECURITY;
ALTER TABLE prod_machine          ENABLE ROW LEVEL SECURITY;
ALTER TABLE prod_downtime_reason  ENABLE ROW LEVEL SECURITY;
ALTER TABLE prod_operator         ENABLE ROW LEVEL SECURITY;
ALTER TABLE prod_daily_report     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dev_all" ON prod_product_master  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON prod_machine         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON prod_downtime_reason FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON prod_operator        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON prod_daily_report    FOR ALL USING (true) WITH CHECK (true);

-- ── Permission seed ─────────────────────────────────────────────────────────
-- Grant production / daily_report / {view,create,edit,delete} to every user who
-- already manages the production module (resource 'module_permissions'). Mirrors
-- the cross-join seeding style of M-012. Idempotent.

INSERT INTO user_module_access (user_id, module_id)
SELECT DISTINCT user_id, 'production'
FROM user_permission_grant
WHERE module_id = 'production'
  AND resource = 'module_permissions' AND permission = 'manage'
ON CONFLICT DO NOTHING;

INSERT INTO user_permission_grant (user_id, module_id, resource, permission)
SELECT g.user_id, 'production', 'daily_report', perm.permission
FROM (
  SELECT DISTINCT user_id
  FROM user_permission_grant
  WHERE module_id = 'production'
    AND resource = 'module_permissions' AND permission = 'manage'
) g
CROSS JOIN (VALUES ('view'), ('create'), ('edit'), ('delete')) AS perm(permission)
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;

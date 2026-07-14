-- ─────────────────────────────────────────────────────────────────────────────
-- M-155  Testing data export rows (WA / MC% template)
--
-- Feeds the "Testing Export" page (button next to Daily Report). Returns one row
-- per inspection, filtered by date range + product (SKU) + work order, shaped to
-- the customer's "WA_MC Template.xlsx" columns:
--   Product Description · Date · Item# · WO#/Lot# · Carts#(=sample id) · Mc% · Aw ·
--   Inspector · Test Result · Mc% Standard(Min/Max) · Aw Standard(Min/Max) ·
--   Retest/Accept · Note
--
-- Columns we don't capture (Size, Testing Temp, Humidity, Room Temp, Verification
-- Time, Verify) are left blank by the frontend for manual fill.
--
-- Retest/Accept is derived: a `retest` disposition on the cart → 'Retest';
-- otherwise a released cart (released_at set, or status closed/dispatched) →
-- 'Accept'; otherwise blank.
--
-- Dated by ir.submitted_at (the day the test was performed). MC% / Aw values are
-- pulled from the flattened readings (_qc_flatten_readings) by item-name match;
-- standards come from qc_inspection_template for the cart's SKU.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.qc_testing_export_rows(
  p_sku_id            uuid DEFAULT NULL,
  p_from_date         date DEFAULT NULL,
  p_to_date           date DEFAULT NULL,
  p_production_lot_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'test_date')), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'inspection_id', ir.id,
      'product_name',  sku.name,
      'item_no',       sku.code,
      'test_date',     ir.submitted_at,
      'wo_lot',        COALESCE(NULLIF(btrim(pl.work_order_barcode), ''), pl.lot_barcode),
      'sample_id',     sa.sample_id,
      'sub_lot_code',  sl.sub_lot_code,
      'mc_value', (
        SELECT (r->>'value')::numeric
        FROM jsonb_array_elements(_qc_flatten_readings(ir.values_json)) r
        WHERE lower(r->>'item_name') LIKE '%moist%' OR lower(r->>'item_name') LIKE '%mc%'
        LIMIT 1),
      'aw_value', (
        SELECT (r->>'value')::numeric
        FROM jsonb_array_elements(_qc_flatten_readings(ir.values_json)) r
        WHERE lower(r->>'item_name') LIKE '%water activity%' OR lower(r->>'unit') = 'aw'
        LIMIT 1),
      'testing_temp',  (ir.values_json #>> '{env,testing_temp}')::numeric,
      'humidity',      (ir.values_json #>> '{env,humidity}')::numeric,
      'room_temp',     (ir.values_json #>> '{env,room_temp}')::numeric,
      'inspector',     qc_actor_label(ir.inspector_auth_id),
      'result',        ir.result,
      'mc_min', (SELECT t.lower_limit FROM qc_inspection_template t
                 WHERE t.sku_id = pl.sku_id
                   AND (lower(t.item_name) LIKE '%moist%' OR lower(t.item_name) LIKE '%mc%') LIMIT 1),
      'mc_max', (SELECT t.upper_limit FROM qc_inspection_template t
                 WHERE t.sku_id = pl.sku_id
                   AND (lower(t.item_name) LIKE '%moist%' OR lower(t.item_name) LIKE '%mc%') LIMIT 1),
      'aw_min', (SELECT t.lower_limit FROM qc_inspection_template t
                 WHERE t.sku_id = pl.sku_id
                   AND (lower(t.item_name) LIKE '%water activity%' OR lower(t.unit) = 'aw') LIMIT 1),
      'aw_max', (SELECT t.upper_limit FROM qc_inspection_template t
                 WHERE t.sku_id = pl.sku_id
                   AND (lower(t.item_name) LIKE '%water activity%' OR lower(t.unit) = 'aw') LIMIT 1),
      'retest_accept', CASE
          WHEN EXISTS (SELECT 1 FROM qc_disposition d
                       WHERE d.drying_sub_lot_id = sl.id AND d.type = 'retest') THEN 'Retest'
          WHEN sl.released_at IS NOT NULL OR sl.status IN ('closed', 'dispatched') THEN 'Accept'
          ELSE ''
        END,
      'note',          ir.remark
    ) AS row_data
    FROM qc_inspection_record ir
    JOIN qc_drying_sub_lot sl  ON sl.id = ir.drying_sub_lot_id
    JOIN qc_production_lot  pl  ON pl.id = sl.production_lot_id
    LEFT JOIN qc_product_sku sku ON sku.id = pl.sku_id
    LEFT JOIN qc_sample      sa  ON sa.id  = ir.sample_id
    WHERE (p_sku_id IS NULL OR pl.sku_id = p_sku_id)
      AND (p_production_lot_id IS NULL OR sl.production_lot_id = p_production_lot_id)
      AND (p_from_date IS NULL OR ir.submitted_at >= p_from_date::timestamptz)
      AND (p_to_date   IS NULL OR ir.submitted_at <  (p_to_date + 1)::timestamptz)
  ) t;
$$;


-- ===== merged from 20260623000009_system_audit_log_view.sql (duplicate-version dedup for fresh db build) =====

-- Migration M-155: Central system audit log — unified read view.
-- Aggregates the 4 user-action audit tables + 3 operational-event tables into
-- ONE normalized, filterable shape for the new top-level "Logs & Audit" module.
-- This is a READ-ONLY view: no new central table, no re-instrumentation — each
-- module keeps writing to its own table; this view just unions+maps them.
--
-- Normalized columns: id / source / module / ts / actor_auth_id / actor_name /
--                     action / entity_type / entity_id / summary / detail(jsonb)
-- `detail` carries the source-specific diff/before/after/payload so the UI can
-- expand a row without a second round-trip.
--
-- App-layer gated by logs.entries.view (like every other audit log). The view
-- runs with owner privileges (default, non-invoker) so it can read across the
-- underlying tables regardless of their RLS, matching the existing
-- "table readable, page permission-gated" pattern.
--
-- Coverage = whatever modules currently write audit logs (finance / hr / qc /
-- auth + qc_quality_event / prod_downtime_event / notification_log). Other
-- modules (warehouse/sales/workflow/packaging/production work-orders) have no
-- audit instrumentation yet — adding them is incremental future work.

CREATE OR REPLACE VIEW v_system_audit_log AS

  -- ── finance_audit_log ──────────────────────────────────────────────────────
  SELECT
    'finance_audit_log:' || f.id::text AS id,
    'finance_audit_log'                AS source,
    'finance'                          AS module,
    f.changed_at                       AS ts,
    f.actor_auth_id,
    f.actor_name,
    f.action,
    f.entity_type,
    f.entity_id,
    f.description                      AS summary,
    jsonb_build_object('diff', f.diff, 'before', f.before_snapshot, 'after', f.after_snapshot, 'entry_number', f.entry_number) AS detail
  FROM finance_audit_log f

  UNION ALL
  -- ── hr_audit_log ───────────────────────────────────────────────────────────
  SELECT
    'hr_audit_log:' || h.id::text, 'hr_audit_log', 'hr',
    h.changed_at, h.actor_auth_id, h.actor_name, h.action, h.entity_type, h.entity_id,
    h.description,
    jsonb_build_object('diff', h.diff, 'before', h.before_snapshot, 'after', h.after_snapshot, 'entry_number', h.entry_number)
  FROM hr_audit_log h

  UNION ALL
  -- ── qc_product_audit_log ───────────────────────────────────────────────────
  SELECT
    'qc_product_audit_log:' || p.id::text, 'qc_product_audit_log', 'qc',
    p.changed_at, p.actor_auth_id, p.actor_name, p.action, p.entity_type, p.entity_id,
    p.description,
    jsonb_build_object('diff', p.diff, 'before', p.before_snapshot, 'after', p.after_snapshot, 'entry_number', p.entry_number)
  FROM qc_product_audit_log p

  UNION ALL
  -- ── auth_audit_log (dual-subject: action recorded against target user) ──────
  SELECT
    'auth_audit_log:' || a.id::text, 'auth_audit_log', 'auth',
    a.changed_at, a.actor_auth_id, a.actor_name, a.action, 'user', a.target_user_id::text,
    a.description,
    jsonb_build_object('diff', a.diff, 'before', a.before_snapshot, 'after', a.after_snapshot,
                       'target_name', a.target_name, 'target_email', a.target_email)
  FROM auth_audit_log a

  UNION ALL
  -- ── qc_quality_event (operational; actor name resolved from erp_user) ───────
  SELECT
    'qc_quality_event:' || q.id::text, 'qc_quality_event', 'qc',
    q.created_at, q.actor_auth_id, eu.full_name, q.event_type, 'quality_event', q.drying_sub_lot_id::text,
    qc_quality_event_summary(q.event_type, q.payload, NULL),
    q.payload
  FROM qc_quality_event q
  LEFT JOIN erp_user eu ON eu.auth_user_id = q.actor_auth_id

  UNION ALL
  -- ── prod_downtime_event (operational; actor is free-text created_by) ────────
  SELECT
    'prod_downtime_event:' || d.id::text, 'prod_downtime_event', 'production',
    d.created_at, NULL::uuid, d.created_by, 'downtime', 'machine', d.machine_id::text,
    COALESCE(r.label, 'Downtime') || COALESCE(' · ' || d.note, ''),
    jsonb_build_object('reason', r.label, 'note', d.note, 'down_minutes', d.down_minutes,
                       'shift', d.shift, 'report_date', d.report_date)
  FROM prod_downtime_event d
  LEFT JOIN prod_downtime_reason r ON r.id = d.reason_id

  UNION ALL
  -- ── notification_log (delivery trail; no actor) ────────────────────────────
  SELECT
    'notification_log:' || n.id::text, 'notification_log', 'notifications',
    n.created_at, NULL::uuid, NULL::text, n.status, 'notification', n.recipient_email,
    n.subject,
    jsonb_build_object('status', n.status, 'recipient', n.recipient_email,
                       'type_key', n.type_key, 'context', n.context)
  FROM notification_log n;


-- Seed the new module's view permission + module access for the dev admin.
INSERT INTO user_permission_grant (user_id, module_id, resource, permission, approval_limit)
SELECT eu.id, 'logs', 'entries', 'view', NULL
FROM erp_user eu
WHERE eu.email = 'ysha@smu.edu'
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;

INSERT INTO user_module_access (user_id, module_id)
SELECT eu.id, 'logs'
FROM erp_user eu
WHERE eu.email = 'ysha@smu.edu'
ON CONFLICT DO NOTHING;

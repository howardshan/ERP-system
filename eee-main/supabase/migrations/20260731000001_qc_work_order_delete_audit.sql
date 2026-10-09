-- ─────────────────────────────────────────────────────────────────────────────
-- M-175  Work-order deletion audit trail + hardening (BR-Q91)
--
-- INCIDENT: a real work order (16 tagged carts) vanished in production with no
-- trace. Root cause: TWO delete paths, both un-audited, one wide open:
--   1. LotsList "delete selected" → deleteProductionLots() did a RAW client
--      DELETE on qc_production_lot. qc_production_lot's only RLS policy is
--      dev_all (FOR ALL USING true), so ANY authenticated user could delete ANY
--      work order directly — the frontend qc.batches.delete gate is cosmetic.
--      Confirmation was a 3-second double-click. No audit.
--   2. qc_delete_production_lot (M-174) — guarded (not-started only) + typed
--      DELETE, but wrote NO audit row either.
-- Deleting a lot cascades its carts; the sub_lot_created quality events are NOT
-- erased (qc_quality_event.drying_sub_lot_id is ON DELETE SET NULL) but they lose
-- their cart link, and crucially there was NEVER a record of WHO deleted the WO,
-- WHEN, or WHY.
--
-- FIX:
--   * qc_work_order_audit — an append-only trail that OUTLIVES the work order
--     (no FK to qc_production_lot). One row per delete: actor, time, WO snapshot,
--     cart codes, reason.
--   * Both delete RPCs are now SECURITY DEFINER, require a non-empty reason, and
--     write the audit row BEFORE deleting. The bulk one audits+deletes per id and
--     reports which were skipped (already started).
--   * qc_production_lot RLS: drop the blanket dev_all, keep SELECT/INSERT/UPDATE
--     open, and REMOVE direct DELETE for normal roles. Deletion now only happens
--     through the SECURITY DEFINER RPCs (which run as owner and bypass RLS), so it
--     is impossible to delete a work order without leaving an audit row.
--   * v_system_audit_log surfaces every deletion in the central Logs module.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1) Audit table (survives the work order it records) ──────────────────────
CREATE TABLE IF NOT EXISTS qc_work_order_audit (
    id                 bigserial   PRIMARY KEY,
    action             text        NOT NULL DEFAULT 'delete',   -- 'delete'
    production_lot_id  uuid,                                    -- NO FK: must survive the delete
    work_order_barcode text,
    lot_number         text,
    sku_id             uuid,
    sku_code           text,
    sku_name           text,
    carts_deleted      int         NOT NULL DEFAULT 0,
    cart_codes         jsonb,                                   -- snapshot of deleted cart codes
    reason             text,
    actor_auth_id      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
    actor_name         text        NOT NULL DEFAULT 'Unknown',
    created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qc_wo_audit_created ON qc_work_order_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qc_wo_audit_wo      ON qc_work_order_audit (work_order_barcode);

ALTER TABLE qc_work_order_audit ENABLE ROW LEVEL SECURITY;
-- Insert only via the SECURITY DEFINER RPCs (owner bypasses RLS); SELECT is
-- app-gated (logs.entries.view), consistent with the other audit tables.
CREATE POLICY "qc_wo_audit_select" ON qc_work_order_audit FOR SELECT TO authenticated USING (true);

-- ── 2) Shared internal: audit + delete ONE lot, enforcing the not-started rule ─
-- Returns jsonb per lot. SECURITY DEFINER so it can delete under the hardened RLS
-- and still read auth.uid() (the caller's id travels in the JWT, not the role).
CREATE OR REPLACE FUNCTION qc__audit_and_delete_lot(p_production_lot_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    lot          qc_production_lot%ROWTYPE;
    v_total      int;
    v_started    int;
    v_groups     int;
    v_samples    int;
    v_insp       int;
    v_codes      jsonb;
    v_sku_code   text;
    v_sku_name   text;
    v_actor      uuid := auth.uid();
    v_actor_name text;
    v_wh_lot_id  bigint;
    v_wh_deleted boolean := false;
BEGIN
    SELECT * INTO lot FROM qc_production_lot WHERE id = p_production_lot_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('production_lot_id', p_production_lot_id, 'deleted', false, 'reason', 'not_found');
    END IF;

    -- Not-started invariant (same as M-174): every cart still 'created', never
    -- scanned / dried, and no groups / samples / inspections.
    SELECT count(*),
           count(*) FILTER (
             WHERE s.status <> 'created'
                OR s.scanned_for_check_in_at IS NOT NULL
                OR s.in_time IS NOT NULL)
      INTO v_total, v_started
      FROM qc_drying_sub_lot s WHERE s.production_lot_id = p_production_lot_id;

    SELECT count(*) INTO v_groups  FROM qc_test_group WHERE production_lot_id = p_production_lot_id;
    SELECT count(*) INTO v_samples FROM qc_sample sa
       JOIN qc_drying_sub_lot s ON s.id = sa.drying_sub_lot_id
      WHERE s.production_lot_id = p_production_lot_id;
    SELECT count(*) INTO v_insp    FROM qc_inspection_record ir
       JOIN qc_drying_sub_lot s ON s.id = ir.drying_sub_lot_id
      WHERE s.production_lot_id = p_production_lot_id;

    IF v_started > 0 OR v_groups > 0 OR v_samples > 0 OR v_insp > 0 THEN
        RETURN jsonb_build_object(
            'production_lot_id', p_production_lot_id,
            'work_order_barcode', lot.work_order_barcode,
            'deleted', false, 'reason', 'production_started',
            'started_carts', v_started, 'groups', v_groups,
            'samples', v_samples, 'inspections', v_insp);
    END IF;

    -- Snapshot for the audit row BEFORE anything is removed.
    SELECT code, name INTO v_sku_code, v_sku_name FROM qc_product_sku WHERE id = lot.sku_id;
    SELECT jsonb_agg(s.sub_lot_code ORDER BY s.sub_lot_code) INTO v_codes
      FROM qc_drying_sub_lot s WHERE s.production_lot_id = p_production_lot_id;
    SELECT COALESCE(full_name, email) INTO v_actor_name FROM erp_user WHERE auth_user_id = v_actor;

    INSERT INTO qc_work_order_audit (
        action, production_lot_id, work_order_barcode, lot_number,
        sku_id, sku_code, sku_name, carts_deleted, cart_codes, reason,
        actor_auth_id, actor_name)
    VALUES (
        'delete', p_production_lot_id, lot.work_order_barcode, lot.lot_number,
        lot.sku_id, v_sku_code, v_sku_name, v_total, COALESCE(v_codes, '[]'::jsonb), NULLIF(trim(p_reason), ''),
        v_actor, COALESCE(v_actor_name, 'Unknown'));

    v_wh_lot_id := lot.lot_id;

    -- Cascades: carts → events (SET NULL) / samples / spot history; + test groups.
    DELETE FROM qc_production_lot WHERE id = p_production_lot_id;

    -- Remove the empty pre-created quarantine warehouse lot, if any (guarded).
    IF v_wh_lot_id IS NOT NULL THEN
        BEGIN
            DELETE FROM lot WHERE id = v_wh_lot_id;
            v_wh_deleted := true;
        EXCEPTION WHEN foreign_key_violation THEN
            v_wh_deleted := false;
        END;
    END IF;

    RETURN jsonb_build_object(
        'production_lot_id', p_production_lot_id,
        'work_order_barcode', lot.work_order_barcode,
        'lot_number', lot.lot_number,
        'deleted', true,
        'carts_deleted', v_total,
        'warehouse_lot_deleted', v_wh_deleted);
END;
$$;

-- ── 3) Single delete (trace detail page). Reason now required. ───────────────
DROP FUNCTION IF EXISTS qc_delete_production_lot(uuid);
CREATE OR REPLACE FUNCTION qc_delete_production_lot(p_production_lot_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    res jsonb;
BEGIN
    IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
        RAISE EXCEPTION 'A deletion reason is required' USING ERRCODE = 'check_violation';
    END IF;
    res := qc__audit_and_delete_lot(p_production_lot_id, p_reason);
    IF (res->>'deleted')::boolean IS NOT TRUE THEN
        IF res->>'reason' = 'production_started' THEN
            RAISE EXCEPTION 'Cannot delete work order % — production has started', res->>'work_order_barcode'
              USING ERRCODE = 'check_violation';
        ELSIF res->>'reason' = 'not_found' THEN
            RAISE EXCEPTION 'Work order not found' USING ERRCODE = 'no_data_found';
        END IF;
    END IF;
    RETURN res;
END;
$$;

-- ── 4) Bulk delete (QC batches list). Audits + deletes each; reports skips. ──
CREATE OR REPLACE FUNCTION qc_delete_production_lots(p_ids uuid[], p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    id uuid;
    results jsonb := '[]'::jsonb;
    deleted_n int := 0;
    skipped_n int := 0;
    r jsonb;
BEGIN
    IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
        RAISE EXCEPTION 'A deletion reason is required' USING ERRCODE = 'check_violation';
    END IF;
    IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
        RETURN jsonb_build_object('deleted', 0, 'skipped', 0, 'results', results);
    END IF;
    FOREACH id IN ARRAY p_ids LOOP
        r := qc__audit_and_delete_lot(id, p_reason);
        results := results || jsonb_build_array(r);
        IF (r->>'deleted')::boolean THEN deleted_n := deleted_n + 1; ELSE skipped_n := skipped_n + 1; END IF;
    END LOOP;
    RETURN jsonb_build_object('deleted', deleted_n, 'skipped', skipped_n, 'results', results);
END;
$$;

-- ── 5) Harden qc_production_lot RLS: no more direct client DELETE ────────────
-- Replace the blanket dev_all (FOR ALL) with explicit SELECT/INSERT/UPDATE so
-- reads, creation and edits keep working, but DELETE has NO policy → blocked for
-- the authenticated role. The SECURITY DEFINER RPCs above run as the table owner
-- and bypass RLS, so the ONLY way to delete a work order is through them (which
-- always write an audit row first).
DROP POLICY IF EXISTS "dev_all" ON qc_production_lot;
CREATE POLICY "qc_prod_lot_select" ON qc_production_lot FOR SELECT TO authenticated USING (true);
CREATE POLICY "qc_prod_lot_insert" ON qc_production_lot FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "qc_prod_lot_update" ON qc_production_lot FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ── 6) Surface deletions in the central system log ──────────────────────────
CREATE OR REPLACE VIEW v_system_audit_log AS
  SELECT
    'finance_audit_log:' || f.id::text AS id, 'finance_audit_log' AS source, 'finance' AS module,
    f.changed_at AS ts, f.actor_auth_id, f.actor_name, f.action, f.entity_type, f.entity_id,
    f.description AS summary,
    jsonb_build_object('diff', f.diff, 'before', f.before_snapshot, 'after', f.after_snapshot, 'entry_number', f.entry_number) AS detail
  FROM finance_audit_log f
  UNION ALL
  SELECT 'hr_audit_log:' || h.id::text, 'hr_audit_log', 'hr',
    h.changed_at, h.actor_auth_id, h.actor_name, h.action, h.entity_type, h.entity_id, h.description,
    jsonb_build_object('diff', h.diff, 'before', h.before_snapshot, 'after', h.after_snapshot, 'entry_number', h.entry_number)
  FROM hr_audit_log h
  UNION ALL
  SELECT 'qc_product_audit_log:' || p.id::text, 'qc_product_audit_log', 'qc',
    p.changed_at, p.actor_auth_id, p.actor_name, p.action, p.entity_type, p.entity_id, p.description,
    jsonb_build_object('diff', p.diff, 'before', p.before_snapshot, 'after', p.after_snapshot, 'entry_number', p.entry_number)
  FROM qc_product_audit_log p
  UNION ALL
  SELECT 'auth_audit_log:' || a.id::text, 'auth_audit_log', 'auth',
    a.changed_at, a.actor_auth_id, a.actor_name, a.action, 'user', a.target_user_id::text, a.description,
    jsonb_build_object('diff', a.diff, 'before', a.before_snapshot, 'after', a.after_snapshot,
                       'target_name', a.target_name, 'target_email', a.target_email)
  FROM auth_audit_log a
  UNION ALL
  SELECT 'qc_quality_event:' || q.id::text, 'qc_quality_event',
    CASE WHEN q.event_type = 'sub_lot_created' THEN 'production' ELSE 'qc' END,
    q.created_at, q.actor_auth_id, eu.full_name, q.event_type, 'quality_event', q.drying_sub_lot_id::text,
    qc_quality_event_summary(q.event_type, q.payload, NULL), q.payload
  FROM qc_quality_event q
  LEFT JOIN erp_user eu ON eu.auth_user_id = q.actor_auth_id
  UNION ALL
  -- M-175: work-order deletions (production module).
  SELECT 'qc_work_order_audit:' || w.id::text, 'qc_work_order_audit', 'production',
    w.created_at, w.actor_auth_id, w.actor_name, 'work_order_' || w.action, 'work_order', w.work_order_barcode,
    'Deleted work order ' || COALESCE(w.work_order_barcode, '?') || ' (' || w.carts_deleted || ' carts)'
      || COALESCE(' — ' || w.reason, ''),
    jsonb_build_object('lot_number', w.lot_number, 'sku_code', w.sku_code, 'sku_name', w.sku_name,
                       'carts_deleted', w.carts_deleted, 'cart_codes', w.cart_codes, 'reason', w.reason)
  FROM qc_work_order_audit w
  UNION ALL
  SELECT 'prod_downtime_event:' || d.id::text, 'prod_downtime_event', 'production',
    d.created_at, NULL::uuid, d.created_by, 'downtime', 'machine', d.machine_id::text,
    COALESCE(r.label, 'Downtime') || COALESCE(' · ' || d.note, ''),
    jsonb_build_object('reason', r.label, 'note', d.note, 'down_minutes', d.down_minutes,
                       'shift', d.shift, 'report_date', d.report_date)
  FROM prod_downtime_event d
  LEFT JOIN prod_downtime_reason r ON r.id = d.reason_id
  UNION ALL
  SELECT 'notification_log:' || n.id::text, 'notification_log', 'notifications',
    n.created_at, NULL::uuid, NULL::text, n.status, 'notification', n.recipient_email, n.subject,
    jsonb_build_object('status', n.status, 'recipient', n.recipient_email,
                       'type_key', n.type_key, 'context', n.context)
  FROM notification_log n;

COMMENT ON TABLE qc_work_order_audit IS
  'M-175 (BR-Q91): append-only work-order deletion trail. Outlives the deleted lot (no FK). Written only by the SECURITY DEFINER delete RPCs; surfaced in v_system_audit_log.';

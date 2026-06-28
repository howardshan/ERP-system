-- Migration M-158: fix module classification of production-floor events in the
-- central system-log view (v_system_audit_log, M-155).
--
-- qc_quality_event is a QC-origin TABLE, but its event_types span two modules:
-- `sub_lot_created` (a cart is created on the production floor) belongs to the
-- Production module — see the production/QC split (M-094 / BR-Q51) — while the
-- drying / testing / disposition lifecycle events stay under QC.
-- M-155 blanket-mapped every qc_quality_event row to module='qc'; this re-maps
-- `sub_lot_created` to 'production'. Only the qc_quality_event branch changes.

CREATE OR REPLACE VIEW v_system_audit_log AS

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
  SELECT
    'hr_audit_log:' || h.id::text, 'hr_audit_log', 'hr',
    h.changed_at, h.actor_auth_id, h.actor_name, h.action, h.entity_type, h.entity_id,
    h.description,
    jsonb_build_object('diff', h.diff, 'before', h.before_snapshot, 'after', h.after_snapshot, 'entry_number', h.entry_number)
  FROM hr_audit_log h

  UNION ALL
  SELECT
    'qc_product_audit_log:' || p.id::text, 'qc_product_audit_log', 'qc',
    p.changed_at, p.actor_auth_id, p.actor_name, p.action, p.entity_type, p.entity_id,
    p.description,
    jsonb_build_object('diff', p.diff, 'before', p.before_snapshot, 'after', p.after_snapshot, 'entry_number', p.entry_number)
  FROM qc_product_audit_log p

  UNION ALL
  SELECT
    'auth_audit_log:' || a.id::text, 'auth_audit_log', 'auth',
    a.changed_at, a.actor_auth_id, a.actor_name, a.action, 'user', a.target_user_id::text,
    a.description,
    jsonb_build_object('diff', a.diff, 'before', a.before_snapshot, 'after', a.after_snapshot,
                       'target_name', a.target_name, 'target_email', a.target_email)
  FROM auth_audit_log a

  UNION ALL
  -- qc_quality_event: production-floor cart creation → 'production'; the rest
  -- (drying / testing / disposition lifecycle) stays 'qc'.
  SELECT
    'qc_quality_event:' || q.id::text, 'qc_quality_event',
    CASE WHEN q.event_type = 'sub_lot_created' THEN 'production' ELSE 'qc' END,
    q.created_at, q.actor_auth_id, eu.full_name, q.event_type, 'quality_event', q.drying_sub_lot_id::text,
    qc_quality_event_summary(q.event_type, q.payload, NULL),
    q.payload
  FROM qc_quality_event q
  LEFT JOIN erp_user eu ON eu.auth_user_id = q.actor_auth_id

  UNION ALL
  SELECT
    'prod_downtime_event:' || d.id::text, 'prod_downtime_event', 'production',
    d.created_at, NULL::uuid, d.created_by, 'downtime', 'machine', d.machine_id::text,
    COALESCE(r.label, 'Downtime') || COALESCE(' · ' || d.note, ''),
    jsonb_build_object('reason', r.label, 'note', d.note, 'down_minutes', d.down_minutes,
                       'shift', d.shift, 'report_date', d.report_date)
  FROM prod_downtime_event d
  LEFT JOIN prod_downtime_reason r ON r.id = d.reason_id

  UNION ALL
  SELECT
    'notification_log:' || n.id::text, 'notification_log', 'notifications',
    n.created_at, NULL::uuid, NULL::text, n.status, 'notification', n.recipient_email,
    n.subject,
    jsonb_build_object('status', n.status, 'recipient', n.recipient_email,
                       'type_key', n.type_key, 'context', n.context)
  FROM notification_log n;

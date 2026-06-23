-- M-151: Grant the new qc.daily_report resource (BR-Q82).
--
-- daily_report.view → everyone who can already see Testing status.
-- daily_report.sign → everyone who can already submit inspections.
-- Idempotent via ON CONFLICT DO NOTHING. Mirrors the M-149 backfill pattern.

INSERT INTO user_permission_grant (user_id, module_id, resource, permission, approval_limit)
SELECT g.user_id, 'qc', 'daily_report', 'view', NULL
FROM user_permission_grant g
WHERE g.module_id = 'qc'
  AND g.resource = 'testing'
  AND g.permission = 'view_status'
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;

INSERT INTO user_permission_grant (user_id, module_id, resource, permission, approval_limit)
SELECT g.user_id, 'qc', 'daily_report', 'sign', NULL
FROM user_permission_grant g
WHERE g.module_id = 'qc'
  AND g.resource = 'testing'
  AND g.permission = 'submit_inspection'
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;

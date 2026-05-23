-- M-057: Grant qc.analysis.view to every user who already has any QC permission.
-- Fixes sidebar not showing Analysis for users seeded before M-019.

INSERT INTO user_permission_grant (user_id, module_id, resource, permission)
SELECT DISTINCT user_id, 'qc', 'analysis', 'view'
FROM user_permission_grant
WHERE module_id = 'qc'
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;

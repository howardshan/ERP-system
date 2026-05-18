-- Migration M-012: Add manage_permissions grant for ysha@smu.edu across all modules
-- Depends on: M-011

INSERT INTO user_permission_grant (user_id, module_id, resource, permission, approval_limit)
SELECT
  eu.id,
  m.module_id,
  'module_permissions',
  'manage',
  NULL
FROM erp_user eu
CROSS JOIN (
  VALUES
    ('finance'),
    ('workflow'),
    ('warehouse'),
    ('sales'),
    ('production')
) AS m(module_id)
WHERE eu.email = 'ysha@smu.edu'
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;

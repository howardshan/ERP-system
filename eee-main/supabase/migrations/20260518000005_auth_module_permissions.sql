-- Migration M-013: Auth module permissions for ysha@smu.edu
-- Depends on: M-012

-- Add auth to module access
INSERT INTO user_module_access (user_id, module_id)
SELECT eu.id, 'auth'
FROM erp_user eu
WHERE eu.email = 'ysha@smu.edu'
ON CONFLICT DO NOTHING;

-- Grant all auth module permissions
INSERT INTO user_permission_grant (user_id, module_id, resource, permission, approval_limit)
SELECT eu.id, 'auth', p.resource, p.permission, NULL
FROM erp_user eu
CROSS JOIN (VALUES
  ('module_permissions', 'manage'),
  ('users',              'view'),
  ('users',              'create'),
  ('users',              'edit'),
  ('users',              'delete'),
  ('users',              'reset_password'),
  ('roles',              'view'),
  ('roles',              'manage'),
  ('departments',        'view'),
  ('departments',        'manage')
) AS p(resource, permission)
WHERE eu.email = 'ysha@smu.edu'
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;

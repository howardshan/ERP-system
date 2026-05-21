-- Migration M-016: HR module access and permissions for ysha@smu.edu
-- Depends on: M-015

-- Add hr to module access
INSERT INTO user_module_access (user_id, module_id)
SELECT eu.id, 'hr'
FROM erp_user eu
WHERE eu.email = 'ysha@smu.edu'
ON CONFLICT DO NOTHING;

-- Grant all HR permissions
INSERT INTO user_permission_grant (user_id, module_id, resource, permission, approval_limit)
SELECT eu.id, 'hr', p.resource, p.permission, NULL
FROM erp_user eu
CROSS JOIN (VALUES
  ('module_permissions', 'manage'),
  ('employees',          'view'),
  ('employees',          'edit')
) AS p(resource, permission)
WHERE eu.email = 'ysha@smu.edu'
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;

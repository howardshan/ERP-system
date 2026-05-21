-- Migration M-014: Workflow + remaining module access for ysha@smu.edu
-- Depends on: M-013

-- Add all modules to module access (workflow, docs, warehouse, sales, production)
INSERT INTO user_module_access (user_id, module_id)
SELECT eu.id, m.module_id
FROM erp_user eu
CROSS JOIN (VALUES
  ('workflow'),
  ('docs'),
  ('warehouse'),
  ('sales'),
  ('production')
) AS m(module_id)
WHERE eu.email = 'ysha@smu.edu'
ON CONFLICT DO NOTHING;

-- Grant all workflow permissions
INSERT INTO user_permission_grant (user_id, module_id, resource, permission, approval_limit)
SELECT eu.id, 'workflow', p.resource, p.permission, NULL
FROM erp_user eu
CROSS JOIN (VALUES
  ('module_permissions', 'manage'),
  ('workflow',           'view'),
  ('workflow',           'create'),
  ('workflow',           'edit'),
  ('workflow',           'delete'),
  ('workflow',           'execute')
) AS p(resource, permission)
WHERE eu.email = 'ysha@smu.edu'
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;

-- Migration M-030: Seed all new HR permissions for dev user (ysha@smu.edu)

INSERT INTO user_permission_grant (user_id, module_id, resource, permission, approval_limit)
SELECT eu.id, 'hr', p.resource, p.permission, NULL
FROM erp_user eu
CROSS JOIN (VALUES
  ('departments',   'view'),
  ('departments',   'create'),
  ('departments',   'edit'),
  ('recruitment',   'view'),
  ('recruitment',   'create'),
  ('recruitment',   'edit'),
  ('recruitment',   'delete'),
  ('onboarding',    'view'),
  ('onboarding',    'manage'),
  ('leave',         'view'),
  ('leave',         'view_own'),
  ('leave',         'approve'),
  ('leave',         'manage'),
  ('payroll',       'view'),
  ('payroll',       'create'),
  ('payroll',       'approve'),
  ('payroll',       'manage'),
  ('benefits',      'view'),
  ('benefits',      'manage'),
  ('performance',   'view'),
  ('performance',   'manage'),
  ('training',      'view'),
  ('training',      'manage'),
  ('audit_log',     'view')
) AS p(resource, permission)
WHERE eu.email = 'ysha@smu.edu'
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;

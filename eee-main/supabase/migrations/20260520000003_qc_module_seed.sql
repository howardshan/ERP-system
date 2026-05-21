-- Migration M-035: Quality Control module seed
-- Grants QC module access + all QC resource permissions to the dev user
-- (ysha@smu.edu), then loads demo fixtures so the module is usable out of the box.

-- 1) Grant module access
INSERT INTO user_module_access (user_id, module_id)
SELECT eu.id, 'qc'
FROM erp_user eu
WHERE eu.email = 'ysha@smu.edu'
ON CONFLICT (user_id, module_id) DO NOTHING;

-- 2) Grant all QC resource permissions
INSERT INTO user_permission_grant (user_id, module_id, resource, permission, approval_limit)
SELECT eu.id, 'qc', p.resource, p.permission, NULL
FROM erp_user eu
CROSS JOIN (VALUES
  ('module_permissions', 'manage'),
  ('products',         'view'),
  ('products',         'create'),
  ('products',         'edit'),
  ('products',         'delete'),
  ('locations',        'view'),
  ('locations',        'manage'),
  ('production_lots',  'view'),
  ('production_lots',  'create'),
  ('sub_lots',         'view'),
  ('sub_lots',         'check_in'),
  ('sub_lots',         'check_out'),
  ('inspections',      'view'),
  ('inspections',      'submit'),
  ('dispositions',     'view'),
  ('dispositions',     'create'),
  ('dashboard',        'view'),
  ('trace',            'view'),
  ('audit_log',        'view')
) AS p(resource, permission)
WHERE eu.email = 'ysha@smu.edu'
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;

-- 3) Load demo fixtures
SELECT qc_seed_demo_data();

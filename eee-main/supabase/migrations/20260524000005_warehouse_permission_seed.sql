-- Migration M-082: Grant Warehouse module access + all warehouse resource
-- permissions to the admin account (tianzuohuang@crave-cook.com).
-- Mirrors the M-035 QC seed pattern.
--
-- IMPORTANT: the (resource, permission) strings below must stay byte-for-byte
-- consistent with src/lib/permissionStructure.ts warehouse section, otherwise
-- the front-end can() checks silently return false.
-- Idempotent: ON CONFLICT DO NOTHING.

-- 1) Module access
INSERT INTO user_module_access (user_id, module_id)
SELECT eu.id, 'warehouse'
FROM erp_user eu
WHERE eu.email = 'tianzuohuang@crave-cook.com'
ON CONFLICT (user_id, module_id) DO NOTHING;

-- 2) All warehouse resource permissions
INSERT INTO user_permission_grant (user_id, module_id, resource, permission, approval_limit)
SELECT eu.id, 'warehouse', p.resource, p.permission, NULL
FROM erp_user eu
CROSS JOIN (VALUES
  ('module_permissions', 'manage'),
  ('items',          'view'),
  ('items',          'create'),
  ('items',          'edit'),
  ('items',          'delete'),
  ('locations',      'view'),
  ('locations',      'edit'),
  ('lots',           'view'),
  ('lots',           'release'),
  ('lots',           'reject'),
  ('goods_receipt',  'view'),
  ('goods_receipt',  'create'),
  ('goods_receipt',  'post'),
  ('goods_receipt',  'cancel'),
  ('inventory',      'view'),
  ('inventory',      'receive'),
  ('inventory',      'transfer'),
  ('inventory',      'adjust')
) AS p(resource, permission)
WHERE eu.email = 'tianzuohuang@crave-cook.com'
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;

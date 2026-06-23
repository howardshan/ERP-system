-- M-147: Move Products / Test-Types EDIT rights back from the `production.*`
--        namespace into a new `qc.products.*` namespace (BR-Q80).
--
-- Context: M-094 moved products/trace/work_orders out of QC into the new
-- Production module.  Product master data is now owned by QC again: QC edits,
-- Production only views.  So we split the `production.products.*` resource:
--
--   production.products.view    →  KEEP (Production keeps a read-only entry)
--                                   AND copy to qc.products.view
--   production.products.create  →  qc.products.create   (move)
--   production.products.edit    →  qc.products.edit      (move)
--   production.products.delete  →  qc.products.delete    (move)
--
-- New QC-only permissions (export / import / view_log) are NOT migrated from
-- anything — they're seeded for the dev admin at the bottom.
--
-- Idempotent: ON CONFLICT DO NOTHING on every INSERT; the DELETE is a no-op
-- once the old create/edit/delete rows are gone.  Re-running survives.

-- 1. Module access — make sure everyone who manages products can see the QC
--    module card on the Home hub (most already can, but be safe).
INSERT INTO user_module_access (user_id, module_id)
SELECT DISTINCT user_id, 'qc'
FROM user_permission_grant
WHERE module_id = 'production'
  AND resource = 'products'
ON CONFLICT DO NOTHING;

-- 2. Copy `view` to qc.products.view WITHOUT deleting the production one —
--    Production still needs production.products.view for its read-only page.
INSERT INTO user_permission_grant (user_id, module_id, resource, permission, approval_limit)
SELECT user_id, 'qc', 'products', 'view', approval_limit
FROM user_permission_grant
WHERE module_id = 'production'
  AND resource = 'products'
  AND permission = 'view'
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;

-- 3. Move create/edit/delete to qc.products.* (copy first, then delete).
INSERT INTO user_permission_grant (user_id, module_id, resource, permission, approval_limit)
SELECT user_id, 'qc', 'products', permission, approval_limit
FROM user_permission_grant
WHERE module_id = 'production'
  AND resource = 'products'
  AND permission IN ('create', 'edit', 'delete')
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;

DELETE FROM user_permission_grant
WHERE module_id = 'production'
  AND resource = 'products'
  AND permission IN ('create', 'edit', 'delete');

-- 4. Seed the three new QC-only permissions for the dev admin so the
--    export / import / audit-log features are reachable out of the box.
--    (Same CROSS JOIN + VALUES + ON CONFLICT pattern as M-012 / M-030.)
INSERT INTO user_permission_grant (user_id, module_id, resource, permission, approval_limit)
SELECT eu.id, 'qc', 'products', p.permission, NULL
FROM erp_user eu
CROSS JOIN (VALUES
  ('export'),
  ('import'),
  ('view_log')
) AS p(permission)
WHERE eu.email = 'ysha@smu.edu'
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;

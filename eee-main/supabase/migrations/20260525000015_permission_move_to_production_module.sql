-- M-094: Move Production / Trace / Products permission keys from the
--        `qc.*` namespace into the new `production.*` namespace.
--
-- M-093 introduced the standalone Production & Manufacturing module but
-- temporarily left the permission keys under `qc.*` (see BR-Q51) so
-- existing grants kept working.  Now the rename happens for real:
--
--   qc.production.create_batch     →  production.work_orders.create
--   qc.trace.view                  →  production.trace.view
--   qc.trace.add_carts             →  production.trace.add_carts
--   qc.trace.reprint_sticker       →  production.trace.reprint_sticker
--   qc.products.view               →  production.products.view
--   qc.products.create             →  production.products.create
--   qc.products.edit               →  production.products.edit
--   qc.products.delete             →  production.products.delete
--
-- Plan:
--   1. Anyone who has any of these qc.* grants gets module access to the
--      `production` module (otherwise they lose the sidebar card after the
--      frontend switches to checking the new keys).
--   2. Copy each old grant to the new key shape, keeping approval_limit.
--   3. Delete the old qc.* grants.
--
-- Idempotent: ON CONFLICT DO NOTHING on the two INSERTs, and DELETE is a
-- no-op once the rows are gone.  Re-running survives gracefully.

-- ── Stable filter for "the rows we're migrating" ───────────────────────────
-- A CTE keeps the WHERE in one place across the 3 statements.
WITH old_rows AS (
  SELECT user_id, resource, permission, approval_limit
  FROM user_permission_grant
  WHERE module_id = 'qc'
    AND (
         (resource = 'production' AND permission = 'create_batch')
      OR (resource = 'trace')
      OR (resource = 'products')
    )
)
-- 1. Module access — production module card visibility on the Home hub
INSERT INTO user_module_access (user_id, module_id)
SELECT DISTINCT user_id, 'production'
FROM old_rows
ON CONFLICT DO NOTHING;

-- 2. Copy grants to new keys with rename mapping
INSERT INTO user_permission_grant (user_id, module_id, resource, permission, approval_limit)
SELECT
  user_id,
  'production',
  CASE
    WHEN resource = 'production' AND permission = 'create_batch' THEN 'work_orders'
    ELSE resource           -- trace / products keep their resource name
  END,
  CASE
    WHEN resource = 'production' AND permission = 'create_batch' THEN 'create'
    ELSE permission         -- view / add_carts / reprint_sticker / create / edit / delete keep their name
  END,
  approval_limit
FROM user_permission_grant
WHERE module_id = 'qc'
  AND (
       (resource = 'production' AND permission = 'create_batch')
    OR (resource = 'trace')
    OR (resource = 'products')
  )
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;

-- 3. Delete the old qc.* grants (now safe — new ones are in place)
DELETE FROM user_permission_grant
WHERE module_id = 'qc'
  AND (
       (resource = 'production' AND permission = 'create_batch')
    OR (resource = 'trace')
    OR (resource = 'products')
  );

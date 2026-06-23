-- M-149: Backfill qc.products.{export, import, view_log} to ALL existing
-- product managers (BR-Q81).
--
-- M-147 only seeded these three new permissions for the dev admin
-- (ysha@smu.edu), so other users who already manage products (they have
-- qc.products.view after the M-147 grant-move) couldn't see the Export /
-- Import buttons or the Change Log page.  Grant the three to everyone who
-- currently holds qc.products.view.  Idempotent via ON CONFLICT DO NOTHING.

INSERT INTO user_permission_grant (user_id, module_id, resource, permission, approval_limit)
SELECT g.user_id, 'qc', 'products', p.permission, NULL
FROM user_permission_grant g
CROSS JOIN (VALUES
  ('export'),
  ('import'),
  ('view_log')
) AS p(permission)
WHERE g.module_id = 'qc'
  AND g.resource = 'products'
  AND g.permission = 'view'
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;

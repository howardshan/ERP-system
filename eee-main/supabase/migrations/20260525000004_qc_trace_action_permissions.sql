-- M-083: Seed qc.trace.add_carts + qc.trace.reprint_sticker for existing dev users.
--
-- Frontend M-082 adds two action buttons to the Batch Trace detail page
-- (Add carts / Reprint sticker), each gated by a dedicated permission so
-- ops can hand them out independently of qc.production.create_batch.
--
-- The two dev accounts that already have full QC access (ysha@smu.edu via
-- M-040, shayiqing16@gmail.com via M-063) should pick up both keys so demos
-- keep working without reconfiguration.

INSERT INTO user_permission_grant (user_id, module_id, resource, permission, approval_limit)
SELECT eu.id, 'qc', 'trace', perm.k, NULL
FROM erp_user eu
CROSS JOIN (VALUES ('add_carts'), ('reprint_sticker')) AS perm(k)
WHERE eu.email IN ('ysha@smu.edu', 'shayiqing16@gmail.com')
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;

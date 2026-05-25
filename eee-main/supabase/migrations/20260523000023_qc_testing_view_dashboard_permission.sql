-- M-079: Seed new qc.testing.view_dashboard permission for existing dev users.
--
-- Frontend added a dedicated permission gate for the embedded Testing Dashboard
-- tab inside TestingPage (today's progress summary + 3-day forecast).  Without
-- this grant, users that had `qc.testing.view_status` still saw the queue but
-- the Dashboard tab disappears — including for the two dev accounts that
-- previously had full QC access (ysha@smu.edu via M-040 and shayiqing16@gmail.com
-- via M-063).  This migration grants the new permission to both so the demo
-- keeps working out of the box.
--
-- No schema change.  Pure user_permission_grant seed, idempotent via
-- ON CONFLICT.

INSERT INTO user_permission_grant (user_id, module_id, resource, permission, approval_limit)
SELECT eu.id, 'qc', 'testing', 'view_dashboard', NULL
FROM erp_user eu
WHERE eu.email IN ('ysha@smu.edu', 'shayiqing16@gmail.com')
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;

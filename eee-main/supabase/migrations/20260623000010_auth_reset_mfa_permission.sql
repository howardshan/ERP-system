-- Migration M-156: seed the new auth.users.reset_mfa permission.
-- Lets admins reset (remove) a user's MFA factors for recovery — paired with
-- edge function EF-005 reset-user-mfa. MFA itself (TOTP) uses Supabase's native
-- auth.mfa_* tables; no app tables are added.

INSERT INTO user_permission_grant (user_id, module_id, resource, permission, approval_limit)
SELECT eu.id, 'auth', 'users', 'reset_mfa', NULL
FROM erp_user eu
WHERE eu.email = 'ysha@smu.edu'
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;

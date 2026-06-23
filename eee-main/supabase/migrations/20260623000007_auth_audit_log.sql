-- Migration M-153: Users & Authentication audit log.
-- Records account/auth events: logins/logouts, account create, profile edits,
-- activate/deactivate, password resets, and permission/module-access changes.
-- Mirrors finance_audit_log (M-018) but is DUAL-SUBJECT: it records both the
-- actor (who did it) and the target user (whose account was affected), e.g.
-- "Admin A changed permissions of User B".
--
-- Survives user deletion: both actor and target FK to auth.users ON DELETE SET
-- NULL, and actor/target name + email are denormalised so a deleted user's
-- history is still readable.  target_user_id (the erp_user id) is stored WITHOUT
-- a FK on purpose — user_permission_grant/user_module_access cascade-delete on
-- erp_user, so a FK here would let a future hard-delete orphan/clear the trail.

CREATE TABLE auth_audit_log (
  id             bigserial   PRIMARY KEY,
  action         text        NOT NULL,  -- login_success | logout | create | edit_profile | activate | deactivate | reset_password | edit_permissions
  actor_auth_id  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_name     text        NOT NULL DEFAULT 'Unknown',
  target_auth_id uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  target_user_id uuid,                  -- erp_user.id (no FK — see header note)
  target_name    text,
  target_email   text,
  before_snapshot jsonb,
  after_snapshot  jsonb,
  diff            jsonb,                -- { field: { before, after } } or { added/removed } for permissions
  description     text,
  changed_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON auth_audit_log (target_auth_id);
CREATE INDEX ON auth_audit_log (actor_auth_id);
CREATE INDEX ON auth_audit_log (changed_at DESC);
CREATE INDEX ON auth_audit_log (action);

ALTER TABLE auth_audit_log ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can insert (the app writes its own audit rows);
-- SELECT is gated by the auth.audit_log.view permission at the app layer.
-- NOTE: login_failed is intentionally NOT logged here — at that point the user
-- is unauthenticated and the INSERT policy would reject it.  (Could be added
-- later via a service-role edge function if needed.)
CREATE POLICY "auth_audit_insert" ON auth_audit_log
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "auth_audit_select" ON auth_audit_log
  FOR SELECT TO authenticated USING (true);

-- Seed the view permission for the dev admin.
INSERT INTO user_permission_grant (user_id, module_id, resource, permission, approval_limit)
SELECT eu.id, 'auth', 'audit_log', 'view', NULL
FROM erp_user eu
WHERE eu.email = 'ysha@smu.edu'
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;

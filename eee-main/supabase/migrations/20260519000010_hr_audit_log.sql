-- Migration M-029: HR Audit Log

CREATE TABLE hr_audit_log (
  id              bigserial PRIMARY KEY,
  entity_type     text NOT NULL,
  entity_id       text NOT NULL,
  action          text NOT NULL,
  actor_auth_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_name      text NOT NULL DEFAULT 'Unknown',
  changed_at      timestamptz NOT NULL DEFAULT now(),
  before_snapshot jsonb,
  after_snapshot  jsonb,
  diff            jsonb,
  entry_number    text,
  description     text
);

ALTER TABLE hr_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_insert" ON hr_audit_log
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "authenticated_select" ON hr_audit_log
  FOR SELECT TO authenticated USING (true);

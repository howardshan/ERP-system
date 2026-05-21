-- Migration M-018: Finance-wide audit log
-- Records every create / edit / delete / status-change across all Finance entities.
-- Viewing requires the finance.audit_log.view permission (enforced at app layer).

-- ---------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------

CREATE TABLE finance_audit_log (
  id            bigserial     PRIMARY KEY,
  entity_type   text          NOT NULL,  -- 'journal_entry' | 'chart_of_accounts' | 'accounting_period' | 'attachment'
  entity_id     text          NOT NULL,  -- stringified record id
  action        text          NOT NULL,  -- 'create' | 'edit' | 'delete' | 'post' | 'submit' | 'approve' | 'reject' | 'reverse' | 'open' | 'close'
  actor_auth_id uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_name    text          NOT NULL DEFAULT 'Unknown',
  changed_at    timestamptz   NOT NULL DEFAULT now(),
  before_snapshot jsonb,
  after_snapshot  jsonb,
  diff            jsonb,       -- { field: { before, after } } for changed header fields
  entry_number    text,        -- denormalised; null for non-JE entities
  description     text         -- human-readable one-line summary
);

CREATE INDEX ON finance_audit_log (entity_type, entity_id);
CREATE INDEX ON finance_audit_log (changed_at DESC);
CREATE INDEX ON finance_audit_log (actor_auth_id);

ALTER TABLE finance_audit_log ENABLE ROW LEVEL SECURITY;

-- Authenticated users can insert (logging); SELECT is gated by app permission check
CREATE POLICY "fin_audit_insert" ON finance_audit_log
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "fin_audit_select" ON finance_audit_log
  FOR SELECT TO authenticated USING (true);

-- ---------------------------------------------------------------
-- Seed: grant finance.audit_log.view to ysha@smu.edu
-- ---------------------------------------------------------------

INSERT INTO user_permission_grant (user_id, module_id, resource, permission, approval_limit)
SELECT eu.id, 'finance', 'audit_log', 'view', NULL
FROM erp_user eu
WHERE eu.email = 'ysha@smu.edu'
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;

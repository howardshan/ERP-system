-- Migration M-148: QC Products / Test-Types change log (BR-Q80).
-- Records every create / edit / delete on product master data and test types,
-- plus bulk Excel imports.  Mirrors finance_audit_log (M-018) structure so the
-- UI can reuse the same shape.
-- Viewing requires the qc.products.view_log permission (enforced at app layer).

CREATE TABLE qc_product_audit_log (
  id            bigserial     PRIMARY KEY,
  entity_type   text          NOT NULL,  -- 'product' | 'test_type' | 'product_import'
  entity_id     text          NOT NULL,  -- stringified record id (sku id / test_type id / 'import')
  action        text          NOT NULL,  -- 'create' | 'edit' | 'delete' | 'import'
  actor_auth_id uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_name    text          NOT NULL DEFAULT 'Unknown',
  changed_at    timestamptz   NOT NULL DEFAULT now(),
  before_snapshot jsonb,
  after_snapshot  jsonb,
  diff            jsonb,       -- { field: { before, after } } for changed fields
  entry_number    text,        -- denormalised code (S2 WIP code / test type name); null for imports
  description     text         -- human-readable one-line summary
);

CREATE INDEX ON qc_product_audit_log (entity_type, entity_id);
CREATE INDEX ON qc_product_audit_log (changed_at DESC);
CREATE INDEX ON qc_product_audit_log (actor_auth_id);

ALTER TABLE qc_product_audit_log ENABLE ROW LEVEL SECURITY;

-- Authenticated users can insert (logging); SELECT is gated by app permission check.
CREATE POLICY "qc_product_audit_insert" ON qc_product_audit_log
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "qc_product_audit_select" ON qc_product_audit_log
  FOR SELECT TO authenticated USING (true);

-- Note: qc.products.view_log is seeded for ysha@smu.edu in M-147.

-- Migration M-008: Workflow Studio
-- Depends on: M-001 (auth.users)
-- Affects: docs/modules/05_workflow-studio.md, docs/database/03_migrations-and-edge-functions.md

-- ─── 1. Workflow definitions ──────────────────────────────────────────────────
CREATE TABLE workflow_definition (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name         text        NOT NULL,
  description  text,
  nodes_json   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  edges_json   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  status       text        NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft','active','paused','archived')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid        REFERENCES auth.users(id),
  updated_at   timestamptz,
  updated_by   uuid        REFERENCES auth.users(id)
);

-- ─── 2. Workflow run history ──────────────────────────────────────────────────
CREATE TABLE workflow_run (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workflow_id   bigint      NOT NULL REFERENCES workflow_definition(id) ON DELETE CASCADE,
  triggered_by  text        NOT NULL CHECK (triggered_by IN ('manual','schedule','event')),
  status        text        NOT NULL DEFAULT 'running'
                CHECK (status IN ('running','completed','failed','cancelled')),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  result_json   jsonb,
  error_message text,
  created_by    uuid        REFERENCES auth.users(id)
);

CREATE INDEX idx_workflow_run_workflow ON workflow_run(workflow_id);

-- ─── 3. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE workflow_definition ENABLE ROW LEVEL SECURITY;
CREATE POLICY "all users can read workflows"   ON workflow_definition FOR SELECT USING (true);
CREATE POLICY "all users can insert workflows" ON workflow_definition FOR INSERT WITH CHECK (true);
CREATE POLICY "all users can update workflows" ON workflow_definition FOR UPDATE USING (true);
CREATE POLICY "all users can delete workflows" ON workflow_definition FOR DELETE USING (true);

ALTER TABLE workflow_run ENABLE ROW LEVEL SECURITY;
CREATE POLICY "all users can read runs"   ON workflow_run FOR SELECT USING (true);
CREATE POLICY "all users can insert runs" ON workflow_run FOR INSERT WITH CHECK (true);

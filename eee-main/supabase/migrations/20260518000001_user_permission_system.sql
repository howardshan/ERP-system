-- Migration M-009: User Management & Permission System
-- Depends on: M-001

CREATE TABLE erp_user (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name   text    NOT NULL,
  email       text    NOT NULL UNIQUE,
  department  text,
  manager_id  uuid    REFERENCES erp_user(id),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_module_access (
  user_id    uuid NOT NULL REFERENCES erp_user(id) ON DELETE CASCADE,
  module_id  text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, module_id)
);

-- Granular permission grants per user / module / resource / action
CREATE TABLE user_permission_grant (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES erp_user(id) ON DELETE CASCADE,
  module_id      text NOT NULL,
  resource       text NOT NULL,
  permission     text NOT NULL,
  approval_limit numeric,          -- only populated for 'approve' permissions
  granted_at     timestamptz NOT NULL DEFAULT now(),
  granted_by_id  uuid REFERENCES erp_user(id),
  UNIQUE (user_id, module_id, resource, permission)
);

-- Seed demo users
INSERT INTO erp_user (full_name, email, department) VALUES
  ('John Controller', 'john.controller@petfood.com', 'Finance'),
  ('Sarah Manager',   'sarah.manager@petfood.com',   'Finance'),
  ('Mike Ops',        'mike.ops@petfood.com',        'Operations');

UPDATE erp_user SET manager_id = (SELECT id FROM erp_user WHERE email = 'john.controller@petfood.com')
WHERE email IN ('sarah.manager@petfood.com', 'mike.ops@petfood.com');

-- RLS (dev: open)
ALTER TABLE erp_user              ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_module_access    ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_permission_grant ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dev_all" ON erp_user              FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON user_module_access    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON user_permission_grant FOR ALL USING (true) WITH CHECK (true);

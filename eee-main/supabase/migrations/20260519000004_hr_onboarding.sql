-- Migration M-023: HR Onboarding — templates and checklists

CREATE TABLE hr_onboarding_template (
  id            serial PRIMARY KEY,
  name          text NOT NULL,
  department_id int REFERENCES hr_department(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_onboarding_template_task (
  id               serial PRIMARY KEY,
  template_id      int NOT NULL REFERENCES hr_onboarding_template(id) ON DELETE CASCADE,
  task_name        text NOT NULL,
  description      text,
  due_offset_days  int NOT NULL DEFAULT 0,
  assigned_to_role text NOT NULL DEFAULT 'hr' CHECK (assigned_to_role IN ('hr','it','manager','employee')),
  sort_order       int NOT NULL DEFAULT 0
);

CREATE TABLE hr_onboarding_checklist (
  id          serial PRIMARY KEY,
  employee_id uuid NOT NULL REFERENCES erp_user(id) ON DELETE CASCADE,
  template_id int REFERENCES hr_onboarding_template(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_onboarding_task (
  id           serial PRIMARY KEY,
  checklist_id int NOT NULL REFERENCES hr_onboarding_checklist(id) ON DELETE CASCADE,
  task_name    text NOT NULL,
  description  text,
  due_date     date,
  assigned_to  uuid REFERENCES erp_user(id) ON DELETE SET NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','skipped')),
  completed_at timestamptz,
  notes        text
);

ALTER TABLE hr_onboarding_template      ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_onboarding_template_task ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_onboarding_checklist     ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_onboarding_task          ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dev_all" ON hr_onboarding_template      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON hr_onboarding_template_task FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON hr_onboarding_checklist     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON hr_onboarding_task          FOR ALL USING (true) WITH CHECK (true);

-- Seed a default onboarding template
INSERT INTO hr_onboarding_template (name) VALUES ('Standard Onboarding');

INSERT INTO hr_onboarding_template_task (template_id, task_name, description, due_offset_days, assigned_to_role, sort_order)
SELECT
  (SELECT id FROM hr_onboarding_template WHERE name = 'Standard Onboarding'),
  task_name, description, due_offset_days, assigned_to_role, sort_order
FROM (VALUES
  ('Prepare workstation',          'Set up computer, accounts, and access badges',          -1, 'it',       1),
  ('Send welcome email',           'Send onboarding schedule and first-day instructions',   -1, 'hr',       2),
  ('Complete HR paperwork',        'Employment contract, tax forms, benefits enrollment',    0, 'employee', 3),
  ('IT systems orientation',       'Email, VPN, internal tools walkthrough',                 1, 'it',       4),
  ('Team introduction',            'Introduce to immediate team members',                    1, 'manager',  5),
  ('Review company policies',      'Read employee handbook and code of conduct',             3, 'employee', 6),
  ('Set 30-day goals',             'Define initial goals with manager',                     7, 'manager',  7),
  ('Complete safety training',     'Mandatory health and safety induction',                 7, 'employee', 8),
  ('First performance check-in',  '30-day manager check-in to assess progress',           30, 'manager',  9)
) AS t(task_name, description, due_offset_days, assigned_to_role, sort_order);

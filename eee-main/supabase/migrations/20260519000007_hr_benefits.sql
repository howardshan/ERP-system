-- Migration M-026: HR Benefits — plans and employee enrollments

CREATE TABLE hr_benefit_plan (
  id                        serial PRIMARY KEY,
  name                      text NOT NULL,
  type                      text NOT NULL CHECK (type IN ('social_insurance','housing_fund','commercial_insurance','meal_allowance','transport_allowance','other')),
  provider                  text,
  employee_contribution_rate numeric,
  employer_contribution_rate numeric,
  employee_fixed            numeric,
  employer_fixed            numeric,
  applies_to                text NOT NULL DEFAULT 'all' CHECK (applies_to IN ('all','full_time','management')),
  is_active                 boolean NOT NULL DEFAULT true,
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_employee_benefit (
  id                    serial PRIMARY KEY,
  employee_id           uuid NOT NULL REFERENCES erp_user(id) ON DELETE CASCADE,
  benefit_plan_id       int NOT NULL REFERENCES hr_benefit_plan(id) ON DELETE CASCADE,
  enrolled_at           date NOT NULL,
  ended_at              date,
  employee_contribution numeric,
  employer_contribution numeric,
  UNIQUE (employee_id, benefit_plan_id)
);

ALTER TABLE hr_benefit_plan     ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_employee_benefit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dev_all" ON hr_benefit_plan     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON hr_employee_benefit FOR ALL USING (true) WITH CHECK (true);

-- Seed standard China benefit plans
INSERT INTO hr_benefit_plan (name, type, employee_contribution_rate, employer_contribution_rate, applies_to) VALUES
  ('基本养老保险 (Pension)',           'social_insurance', 0.08, 0.16, 'all'),
  ('基本医疗保险 (Medical)',           'social_insurance', 0.02, 0.10, 'all'),
  ('失业保险 (Unemployment)',          'social_insurance', 0.005, 0.005, 'all'),
  ('工伤保险 (Work Injury)',           'social_insurance', 0,    0.004, 'all'),
  ('生育保险 (Maternity)',             'social_insurance', 0,    0.008, 'all'),
  ('住房公积金 (Housing Fund)',        'housing_fund',     0.12, 0.12,  'all');

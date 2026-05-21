-- Migration M-025: HR Payroll — salary, overtime, bonus, pay runs, pay slips

CREATE TABLE hr_salary_record (
  id             serial PRIMARY KEY,
  employee_id    uuid NOT NULL REFERENCES erp_user(id) ON DELETE CASCADE,
  effective_date date NOT NULL,
  salary         numeric NOT NULL CHECK (salary > 0),
  pay_frequency  text NOT NULL DEFAULT 'monthly' CHECK (pay_frequency IN ('monthly','bi_weekly','weekly')),
  currency       text NOT NULL DEFAULT 'CNY',
  pay_grade      text,
  reason         text,
  created_by     uuid REFERENCES erp_user(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_overtime_request (
  id          serial PRIMARY KEY,
  employee_id uuid NOT NULL REFERENCES erp_user(id) ON DELETE CASCADE,
  date        date NOT NULL,
  hours       numeric NOT NULL CHECK (hours > 0),
  type        text NOT NULL CHECK (type IN ('weekday','weekend','holiday')),
  reason      text,
  project_code text,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','paid')),
  approver_id uuid REFERENCES erp_user(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_bonus_template (
  id                 serial PRIMARY KEY,
  name               text NOT NULL,
  department_id      int REFERENCES hr_department(id) ON DELETE SET NULL,
  formula_type       text NOT NULL CHECK (formula_type IN ('fixed','multiplier','tiered','performance_based')),
  base               text NOT NULL DEFAULT 'monthly_salary' CHECK (base IN ('monthly_salary','annual_salary','fixed_amount')),
  multiplier         numeric,
  fixed_amount       numeric,
  tiers              jsonb,
  min_tenure_months  int NOT NULL DEFAULT 0,
  requires_active    boolean NOT NULL DEFAULT true,
  performance_weight numeric NOT NULL DEFAULT 0 CHECK (performance_weight BETWEEN 0 AND 1),
  description        text,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_bonus_run (
  id           serial PRIMARY KEY,
  name         text NOT NULL,
  template_id  int NOT NULL REFERENCES hr_bonus_template(id),
  period_start date NOT NULL,
  period_end   date NOT NULL,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','calculating','review','approved','paid','cancelled')),
  total_amount numeric,
  created_by   uuid REFERENCES erp_user(id) ON DELETE SET NULL,
  approved_by  uuid REFERENCES erp_user(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  paid_at      timestamptz
);

CREATE TABLE hr_bonus_line (
  id                 serial PRIMARY KEY,
  bonus_run_id       int NOT NULL REFERENCES hr_bonus_run(id) ON DELETE CASCADE,
  employee_id        uuid NOT NULL REFERENCES erp_user(id) ON DELETE CASCADE,
  base_amount        numeric NOT NULL DEFAULT 0,
  calculated_amount  numeric NOT NULL DEFAULT 0,
  manual_override    numeric,
  final_amount       numeric GENERATED ALWAYS AS (COALESCE(manual_override, calculated_amount)) STORED,
  performance_score  numeric,
  calculation_detail jsonb
);

CREATE TABLE hr_pay_run (
  id               serial PRIMARY KEY,
  name             text NOT NULL,
  period_start     date NOT NULL,
  period_end       date NOT NULL,
  pay_date         date NOT NULL,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','processing','review','approved','paid','cancelled')),
  total_gross      numeric,
  total_deductions numeric,
  total_net        numeric,
  created_by       uuid REFERENCES erp_user(id) ON DELETE SET NULL,
  approved_by      uuid REFERENCES erp_user(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_pay_slip (
  id                serial PRIMARY KEY,
  pay_run_id        int NOT NULL REFERENCES hr_pay_run(id) ON DELETE CASCADE,
  employee_id       uuid NOT NULL REFERENCES erp_user(id) ON DELETE CASCADE,
  base_salary       numeric NOT NULL DEFAULT 0,
  overtime_amount   numeric NOT NULL DEFAULT 0,
  bonus_amount      numeric NOT NULL DEFAULT 0,
  allowances        jsonb,
  gross_pay         numeric NOT NULL DEFAULT 0,
  income_tax        numeric NOT NULL DEFAULT 0,
  social_insurance  numeric NOT NULL DEFAULT 0,
  housing_fund      numeric NOT NULL DEFAULT 0,
  other_deductions  jsonb,
  total_deductions  numeric NOT NULL DEFAULT 0,
  net_pay           numeric NOT NULL DEFAULT 0,
  je_id             int REFERENCES journal_entry(id) ON DELETE SET NULL,
  UNIQUE (pay_run_id, employee_id)
);

ALTER TABLE hr_salary_record   ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_overtime_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_bonus_template  ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_bonus_run       ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_bonus_line      ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_pay_run         ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_pay_slip        ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dev_all" ON hr_salary_record   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON hr_overtime_request FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON hr_bonus_template  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON hr_bonus_run       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON hr_bonus_line      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON hr_pay_run         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON hr_pay_slip        FOR ALL USING (true) WITH CHECK (true);

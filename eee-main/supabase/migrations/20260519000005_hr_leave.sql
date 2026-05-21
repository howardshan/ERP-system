-- Migration M-024: HR Leave Management — types, balances, requests, recall, holidays

CREATE TABLE hr_leave_type (
  id                   serial PRIMARY KEY,
  name                 text NOT NULL UNIQUE,
  code                 text NOT NULL UNIQUE,
  is_paid              boolean NOT NULL DEFAULT true,
  accrual_enabled      boolean NOT NULL DEFAULT false,
  accrual_rate_monthly numeric,
  max_balance          numeric,
  carry_over_days      int NOT NULL DEFAULT 0,
  requires_approval    boolean NOT NULL DEFAULT true,
  requires_document    boolean NOT NULL DEFAULT false,
  min_notice_days      int NOT NULL DEFAULT 0,
  is_active            boolean NOT NULL DEFAULT true
);

CREATE TABLE hr_leave_balance (
  id            bigserial PRIMARY KEY,
  employee_id   uuid NOT NULL REFERENCES erp_user(id) ON DELETE CASCADE,
  leave_type_id int NOT NULL REFERENCES hr_leave_type(id) ON DELETE CASCADE,
  year          int NOT NULL,
  accrued       numeric NOT NULL DEFAULT 0,
  used          numeric NOT NULL DEFAULT 0,
  pending       numeric NOT NULL DEFAULT 0,
  adjusted      numeric NOT NULL DEFAULT 0,
  carry_over    numeric NOT NULL DEFAULT 0,
  UNIQUE (employee_id, leave_type_id, year)
);

CREATE TABLE hr_holiday (
  id   serial PRIMARY KEY,
  date date NOT NULL UNIQUE,
  name text NOT NULL,
  year int GENERATED ALWAYS AS (EXTRACT(YEAR FROM date)::int) STORED
);

CREATE TABLE hr_leave_request (
  id               bigserial PRIMARY KEY,
  employee_id      uuid NOT NULL REFERENCES erp_user(id) ON DELETE CASCADE,
  leave_type_id    int NOT NULL REFERENCES hr_leave_type(id),
  start_date       date NOT NULL,
  end_date         date NOT NULL,
  days_requested   numeric NOT NULL,
  half_day         boolean NOT NULL DEFAULT false,
  half_day_period  text CHECK (half_day_period IN ('morning','afternoon')),
  reason           text,
  document_url     text,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled','recalled')),
  approver_id      uuid REFERENCES erp_user(id) ON DELETE SET NULL,
  approved_at      timestamptz,
  rejection_reason text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_leave_recall (
  id               serial PRIMARY KEY,
  leave_request_id bigint NOT NULL REFERENCES hr_leave_request(id) ON DELETE CASCADE,
  recall_date      date NOT NULL,
  days_recalled    numeric NOT NULL,
  reason           text,
  approved_by      uuid REFERENCES erp_user(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE hr_leave_type    ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_leave_balance ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_holiday       ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_leave_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_leave_recall  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dev_all" ON hr_leave_type    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON hr_leave_balance FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON hr_holiday       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON hr_leave_request FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON hr_leave_recall  FOR ALL USING (true) WITH CHECK (true);

-- Seed standard leave types
INSERT INTO hr_leave_type (name, code, is_paid, accrual_enabled, accrual_rate_monthly, max_balance, carry_over_days, requires_approval, requires_document, min_notice_days) VALUES
  ('Annual Leave',       'AL',  true,  true,  1.5,  30, 5, true,  false, 3),
  ('Sick Leave',         'SL',  true,  false, NULL, NULL, 0, false, true,  0),
  ('Maternity Leave',    'ML',  true,  false, NULL, NULL, 0, true,  true,  30),
  ('Paternity Leave',    'PL',  true,  false, NULL, NULL, 0, true,  false, 7),
  ('Unpaid Leave',       'UL',  false, false, NULL, NULL, 0, true,  false, 7),
  ('Compassionate Leave','CL',  true,  false, NULL, NULL, 0, true,  true,  0);

-- Seed 2026 China public holidays
INSERT INTO hr_holiday (date, name) VALUES
  ('2026-01-01', 'New Year''s Day'),
  ('2026-02-17', 'Chinese New Year (Day 1)'),
  ('2026-02-18', 'Chinese New Year (Day 2)'),
  ('2026-02-19', 'Chinese New Year (Day 3)'),
  ('2026-02-20', 'Chinese New Year (Day 4)'),
  ('2026-02-21', 'Chinese New Year (Day 5)'),
  ('2026-02-22', 'Chinese New Year (Day 6)'),
  ('2026-02-23', 'Chinese New Year (Day 7)'),
  ('2026-04-05', 'Qingming Festival'),
  ('2026-05-01', 'Labour Day'),
  ('2026-05-02', 'Labour Day Holiday'),
  ('2026-05-03', 'Labour Day Holiday'),
  ('2026-06-19', 'Dragon Boat Festival'),
  ('2026-09-26', 'Mid-Autumn Festival'),
  ('2026-10-01', 'National Day'),
  ('2026-10-02', 'National Day Holiday'),
  ('2026-10-03', 'National Day Holiday'),
  ('2026-10-04', 'National Day Holiday'),
  ('2026-10-05', 'National Day Holiday'),
  ('2026-10-06', 'National Day Holiday'),
  ('2026-10-07', 'National Day Holiday')
ON CONFLICT (date) DO NOTHING;

-- Initialize 2026 annual leave balances for all active employees
INSERT INTO hr_leave_balance (employee_id, leave_type_id, year, accrued, carry_over)
SELECT
  eu.id,
  lt.id,
  2026,
  0,
  0
FROM erp_user eu
CROSS JOIN hr_leave_type lt
WHERE eu.is_active = true AND lt.is_active = true
ON CONFLICT (employee_id, leave_type_id, year) DO NOTHING;

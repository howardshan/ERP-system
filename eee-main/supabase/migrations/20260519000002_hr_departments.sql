-- Migration M-021: HR Departments table

CREATE TABLE hr_department (
  id          serial PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  code        text NOT NULL UNIQUE,
  head_id     uuid REFERENCES erp_user(id) ON DELETE SET NULL,
  cost_center text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE hr_department ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dev_all" ON hr_department FOR ALL USING (true) WITH CHECK (true);

-- Seed departments from existing erp_user.department values
INSERT INTO hr_department (name, code, is_active)
SELECT DISTINCT department, UPPER(LEFT(department, 3)), true
FROM erp_user
WHERE department IS NOT NULL
ON CONFLICT (name) DO NOTHING;

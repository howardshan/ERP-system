-- Migration M-020: Extend erp_user with employment fields

ALTER TABLE erp_user
  ADD COLUMN IF NOT EXISTS employee_id       text UNIQUE,
  ADD COLUMN IF NOT EXISTS employment_type   text CHECK (employment_type IN ('full_time','part_time','contractor','intern')),
  ADD COLUMN IF NOT EXISTS start_date        date,
  ADD COLUMN IF NOT EXISTS end_date          date,
  ADD COLUMN IF NOT EXISTS end_reason        text,
  ADD COLUMN IF NOT EXISTS work_location     text,
  ADD COLUMN IF NOT EXISTS pay_grade         text,
  ADD COLUMN IF NOT EXISTS pay_frequency     text CHECK (pay_frequency IN ('monthly','bi_weekly','weekly')) DEFAULT 'monthly';

-- Auto-generate employee_id for existing rows that don't have one
DO $$
DECLARE
  r RECORD;
  seq int := 1;
BEGIN
  FOR r IN SELECT id FROM erp_user WHERE employee_id IS NULL ORDER BY created_at LOOP
    UPDATE erp_user SET employee_id = 'EMP-' || LPAD(seq::text, 4, '0') WHERE id = r.id;
    seq := seq + 1;
  END LOOP;
END $$;

-- Function to auto-assign employee_id on INSERT
CREATE OR REPLACE FUNCTION assign_employee_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.employee_id IS NULL THEN
    SELECT 'EMP-' || LPAD((COUNT(*) + 1)::text, 4, '0')
    INTO NEW.employee_id
    FROM erp_user;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_employee_id ON erp_user;
CREATE TRIGGER trg_assign_employee_id
  BEFORE INSERT ON erp_user
  FOR EACH ROW EXECUTE FUNCTION assign_employee_id();

-- Migration M-028: HR Training — courses and enrollments

CREATE TABLE hr_training_course (
  id             serial PRIMARY KEY,
  title          text NOT NULL,
  category       text CHECK (category IN ('technical','compliance','leadership','soft_skills','safety','other')),
  provider       text,
  duration_hours numeric,
  is_mandatory   boolean NOT NULL DEFAULT false,
  target_roles   text[],
  description    text,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_training_enrollment (
  id              serial PRIMARY KEY,
  course_id       int NOT NULL REFERENCES hr_training_course(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES erp_user(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'enrolled' CHECK (status IN ('enrolled','in_progress','completed','failed','cancelled')),
  enrolled_at     timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  score           int CHECK (score BETWEEN 0 AND 100),
  certificate_url text
);

ALTER TABLE hr_training_course      ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_training_enrollment  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dev_all" ON hr_training_course     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON hr_training_enrollment FOR ALL USING (true) WITH CHECK (true);

-- Seed mandatory compliance courses
INSERT INTO hr_training_course (title, category, is_mandatory, description) VALUES
  ('Health & Safety Induction',    'safety',     true,  'Mandatory safety awareness for all new employees'),
  ('Code of Conduct',              'compliance', true,  'Company values, ethics and behavioural expectations'),
  ('Data Privacy (GDPR/PIPL)',     'compliance', true,  'Personal information protection law requirements'),
  ('Fire Safety & Evacuation',     'safety',     true,  'Emergency procedures and evacuation routes');

-- Migration M-022: HR Recruitment — requisitions, candidates, interviews, offers

CREATE TABLE hr_job_requisition (
  id               serial PRIMARY KEY,
  title            text NOT NULL,
  department_id    int REFERENCES hr_department(id) ON DELETE SET NULL,
  hiring_manager   uuid REFERENCES erp_user(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','on_hold','filled','cancelled')),
  headcount        int NOT NULL DEFAULT 1,
  job_description  text,
  requirements     text,
  salary_min       numeric,
  salary_max       numeric,
  target_fill_date date,
  created_by       uuid REFERENCES erp_user(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  closed_at        timestamptz
);

CREATE TABLE hr_candidate (
  id              serial PRIMARY KEY,
  requisition_id  int REFERENCES hr_job_requisition(id) ON DELETE CASCADE,
  full_name       text NOT NULL,
  email           text,
  phone           text,
  source          text CHECK (source IN ('linkedin','referral','agency','job_board','direct','other')),
  resume_url      text,
  status          text NOT NULL DEFAULT 'new' CHECK (status IN ('new','screening','interview','offer','hired','rejected','withdrawn')),
  applied_at      timestamptz NOT NULL DEFAULT now(),
  notes           text
);

CREATE TABLE hr_interview (
  id              serial PRIMARY KEY,
  candidate_id    int NOT NULL REFERENCES hr_candidate(id) ON DELETE CASCADE,
  requisition_id  int REFERENCES hr_job_requisition(id) ON DELETE SET NULL,
  round           int NOT NULL DEFAULT 1,
  interview_type  text NOT NULL CHECK (interview_type IN ('phone_screen','technical','behavioral','culture_fit','panel','final')),
  scheduled_at    timestamptz,
  duration_mins   int NOT NULL DEFAULT 60,
  location        text,
  status          text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled','no_show')),
  created_by      uuid REFERENCES erp_user(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_interview_panelist (
  interview_id    int NOT NULL REFERENCES hr_interview(id) ON DELETE CASCADE,
  interviewer_id  uuid NOT NULL REFERENCES erp_user(id) ON DELETE CASCADE,
  role            text NOT NULL DEFAULT 'support' CHECK (role IN ('lead','support','observer')),
  PRIMARY KEY (interview_id, interviewer_id)
);

CREATE TABLE hr_interview_scorecard (
  id                    serial PRIMARY KEY,
  interview_id          int NOT NULL REFERENCES hr_interview(id) ON DELETE CASCADE,
  interviewer_id        uuid NOT NULL REFERENCES erp_user(id) ON DELETE CASCADE,
  submitted_at          timestamptz NOT NULL DEFAULT now(),
  overall_rating        int CHECK (overall_rating BETWEEN 1 AND 5),
  recommendation        text CHECK (recommendation IN ('strong_hire','hire','neutral','no_hire','strong_no_hire')),
  technical_score       int CHECK (technical_score BETWEEN 1 AND 5),
  communication_score   int CHECK (communication_score BETWEEN 1 AND 5),
  problem_solving_score int CHECK (problem_solving_score BETWEEN 1 AND 5),
  culture_fit_score     int CHECK (culture_fit_score BETWEEN 1 AND 5),
  leadership_score      int CHECK (leadership_score BETWEEN 1 AND 5),
  strengths             text,
  weaknesses            text,
  notes                 text,
  UNIQUE (interview_id, interviewer_id)
);

CREATE TABLE hr_offer (
  id              serial PRIMARY KEY,
  candidate_id    int NOT NULL REFERENCES hr_candidate(id) ON DELETE CASCADE,
  requisition_id  int REFERENCES hr_job_requisition(id) ON DELETE SET NULL,
  offered_salary  numeric NOT NULL,
  start_date      date,
  offer_expiry    date,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','declined','expired')),
  approved_by     uuid REFERENCES erp_user(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  notes           text
);

ALTER TABLE hr_job_requisition ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_candidate        ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_interview        ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_interview_panelist ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_interview_scorecard ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_offer            ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dev_all" ON hr_job_requisition   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON hr_candidate         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON hr_interview         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON hr_interview_panelist FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON hr_interview_scorecard FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON hr_offer             FOR ALL USING (true) WITH CHECK (true);

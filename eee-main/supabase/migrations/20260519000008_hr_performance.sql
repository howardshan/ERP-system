-- Migration M-027: HR Performance — review cycles, reviews, goals

CREATE TABLE hr_review_cycle (
  id           serial PRIMARY KEY,
  name         text NOT NULL,
  period_start date NOT NULL,
  period_end   date NOT NULL,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','self_review','manager_review','calibration','completed')),
  created_by   uuid REFERENCES erp_user(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_review (
  id               serial PRIMARY KEY,
  cycle_id         int NOT NULL REFERENCES hr_review_cycle(id) ON DELETE CASCADE,
  employee_id      uuid NOT NULL REFERENCES erp_user(id) ON DELETE CASCADE,
  reviewer_id      uuid REFERENCES erp_user(id) ON DELETE SET NULL,
  self_rating      int CHECK (self_rating BETWEEN 1 AND 5),
  self_summary     text,
  self_goals_met   text,
  manager_rating   int CHECK (manager_rating BETWEEN 1 AND 5),
  manager_summary  text,
  final_rating     int CHECK (final_rating BETWEEN 1 AND 5),
  strengths        text,
  improvements     text,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','self_complete','manager_complete','calibrated')),
  completed_at     timestamptz,
  UNIQUE (cycle_id, employee_id)
);

CREATE TABLE hr_goal (
  id              serial PRIMARY KEY,
  employee_id     uuid NOT NULL REFERENCES erp_user(id) ON DELETE CASCADE,
  review_cycle_id int REFERENCES hr_review_cycle(id) ON DELETE SET NULL,
  title           text NOT NULL,
  description     text,
  target          text,
  progress        int NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  status          text NOT NULL DEFAULT 'on_track' CHECK (status IN ('on_track','at_risk','completed','cancelled')),
  due_date        date,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE hr_review_cycle ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_review       ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_goal         ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dev_all" ON hr_review_cycle FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON hr_review       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON hr_goal         FOR ALL USING (true) WITH CHECK (true);

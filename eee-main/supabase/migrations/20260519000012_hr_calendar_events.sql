-- Interview calendar events: per-panelist time blocks with accept/decline
CREATE TABLE hr_calendar_event (
  id           serial PRIMARY KEY,
  owner_id     uuid NOT NULL REFERENCES erp_user(id),
  interview_id int  REFERENCES hr_interview(id) ON DELETE CASCADE,
  title        text NOT NULL,
  start_time   timestamptz NOT NULL,
  end_time     timestamptz NOT NULL,
  status       text NOT NULL DEFAULT 'tentative'
    CHECK (status IN ('tentative','confirmed','declined','cancelled')),
  requested_by uuid REFERENCES erp_user(id),
  responded_at timestamptz,
  notes        text,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX ON hr_calendar_event (owner_id, start_time, end_time);
CREATE INDEX ON hr_calendar_event (interview_id);

ALTER TABLE hr_calendar_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY dev_all ON hr_calendar_event FOR ALL USING (true) WITH CHECK (true);

-- Seed 2026 fiscal year accounting periods (Jan–Dec)
-- Each period starts as 'open' so journal entries can be posted immediately.

INSERT INTO accounting_period (name, start_date, end_date, fiscal_year, status)
VALUES
  ('Jan 2026', '2026-01-01', '2026-01-31', 2026, 'open'),
  ('Feb 2026', '2026-02-01', '2026-02-28', 2026, 'open'),
  ('Mar 2026', '2026-03-01', '2026-03-31', 2026, 'open'),
  ('Apr 2026', '2026-04-01', '2026-04-30', 2026, 'open'),
  ('May 2026', '2026-05-01', '2026-05-31', 2026, 'open'),
  ('Jun 2026', '2026-06-01', '2026-06-30', 2026, 'open'),
  ('Jul 2026', '2026-07-01', '2026-07-31', 2026, 'open'),
  ('Aug 2026', '2026-08-01', '2026-08-31', 2026, 'open'),
  ('Sep 2026', '2026-09-01', '2026-09-30', 2026, 'open'),
  ('Oct 2026', '2026-10-01', '2026-10-31', 2026, 'open'),
  ('Nov 2026', '2026-11-01', '2026-11-30', 2026, 'open'),
  ('Dec 2026', '2026-12-01', '2026-12-31', 2026, 'open')
ON CONFLICT DO NOTHING;

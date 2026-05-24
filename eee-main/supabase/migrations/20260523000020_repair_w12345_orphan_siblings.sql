-- M-076: One-off repair for the W12345 batch orphaned by the M-075 bug.
--
-- Background:
--   The M-075 fix corrects qc_check_out_sub_lots_bulk going forward, but the
--   carts already affected by the Step 2a→Step 2b cascade have wrong groups
--   and statuses.  Specifically (per qc_quality_event audit):
--
--     W12345-001, W12345-003  — orphan siblings in d207adf6, champion 004
--                               passed in 7724ef98.  Should be 'passed'.
--     W12345-010              — orphan sibling in d088289a, champion 009
--                               passed in 1639a6a0 and released.  Should be
--                               'passed' so it can be released too.
--
--   This migration moves the orphaned siblings into the champion's actual
--   group, sets their status to 'passed' (the M-055 outcome that the bug
--   prevented), reconciles qc_test_group.member_count, and marks the empty
--   orphan groups as 'closed_failed' so they don't linger as 'sampling'.
--
--   Idempotent: every UPDATE has explicit WHERE clauses on the original
--   broken state, so re-running is a no-op once the repair has taken effect.

-- ── W12345-001 + 003: join their champion 004 in 7724ef98 ───────────────────
UPDATE qc_drying_sub_lot
SET test_group_id    = '7724ef98-38f8-4f9f-a42b-211263fceeca',
    is_test_champion = false,
    status           = 'passed',
    updated_at       = now()
WHERE sub_lot_code IN ('W12345-001', 'W12345-003')
  AND test_group_id = 'd207adf6-cc1a-413f-9155-238d7bef5751'
  AND status        = 'awaiting_group_result';

UPDATE qc_test_group
SET member_count = 3,
    status       = 'passed',
    resolved_at  = COALESCE(resolved_at, now())
WHERE id = '7724ef98-38f8-4f9f-a42b-211263fceeca'
  AND member_count = 1;

UPDATE qc_test_group
SET status      = 'closed_failed',
    resolved_at = COALESCE(resolved_at, now())
WHERE id     = 'd207adf6-cc1a-413f-9155-238d7bef5751'
  AND status = 'sampling';

-- ── W12345-010: join its champion 009 in 1639a6a0 ──────────────────────────
UPDATE qc_drying_sub_lot
SET test_group_id    = '1639a6a0-0fa7-426c-ae17-0a9c350176bb',
    is_test_champion = false,
    status           = 'passed',
    updated_at       = now()
WHERE sub_lot_code = 'W12345-010'
  AND test_group_id = 'd088289a-6b13-4165-8ae8-7a7ba369968b'
  AND status        = 'awaiting_group_result';

UPDATE qc_test_group
SET member_count = 2,
    status       = 'passed',
    resolved_at  = COALESCE(resolved_at, now())
WHERE id = '1639a6a0-0fa7-426c-ae17-0a9c350176bb'
  AND member_count = 1;

UPDATE qc_test_group
SET status      = 'closed_failed',
    resolved_at = COALESCE(resolved_at, now())
WHERE id     = 'd088289a-6b13-4165-8ae8-7a7ba369968b'
  AND status = 'sampling';

-- ── Audit trail ────────────────────────────────────────────────────────────
INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
SELECT id,
       'manual_repair',
       jsonb_build_object(
         'reason',         'M-076 repair: orphan sibling promoted to passed',
         'migration_ref',  'M-076',
         'new_group_id',   test_group_id
       ),
       NULL
FROM qc_drying_sub_lot
WHERE sub_lot_code IN ('W12345-001', 'W12345-003', 'W12345-010')
  AND status = 'passed'
  AND test_group_id IN (
    '7724ef98-38f8-4f9f-a42b-211263fceeca',
    '1639a6a0-0fa7-426c-ae17-0a9c350176bb'
  )
  -- Don't re-emit on re-run
  AND NOT EXISTS (
    SELECT 1 FROM qc_quality_event ev
    WHERE ev.drying_sub_lot_id = qc_drying_sub_lot.id
      AND ev.event_type = 'manual_repair'
      AND ev.payload->>'migration_ref' = 'M-076'
  );

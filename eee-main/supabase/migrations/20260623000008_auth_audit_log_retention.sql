-- Migration M-154: 2-year retention for auth_audit_log.
-- Records are kept for 2 years, then pruned.  We create a prune function and,
-- if pg_cron is available, schedule it daily.  If pg_cron is NOT installed in
-- this environment, the function still exists and can be run manually or from
-- an external scheduled task (e.g. a cron-driven edge function):
--     SELECT auth_audit_log_prune();

CREATE OR REPLACE FUNCTION auth_audit_log_prune() RETURNS void
LANGUAGE sql AS $$
  DELETE FROM auth_audit_log WHERE changed_at < now() - interval '2 years';
$$;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Unschedule a prior copy if re-running, then schedule daily at 03:00 UTC.
    PERFORM cron.unschedule('auth_audit_log_prune_daily')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auth_audit_log_prune_daily');
    PERFORM cron.schedule('auth_audit_log_prune_daily', '0 3 * * *', 'SELECT auth_audit_log_prune();');
  END IF;
END
$do$;


-- ===== merged from 20260623000008_qc_drying_sub_lot_dryer_number_dynamic.sql (duplicate-version dedup for fresh db build) =====

-- ─────────────────────────────────────────────────────────────────────────────
-- M-154  Relax qc_drying_sub_lot.dryer_number CHECK (1..5 → ≥ 1)
--
-- M-126 (20260620000003) made dryers data-driven: rooms are seeded up to 16 in
-- qc_dry_room and check-in / move validate the target against qc_dry_room
-- existence instead of a hardcoded 1..5 range. But the original column CHECK on
-- qc_drying_sub_lot.dryer_number (added in 20260522000004 as
-- `dryer_number IS NULL OR dryer_number BETWEEN 1 AND 5`) was never dropped, so
-- checking a cart into Dryer 6..16 fails with:
--   new row for relation "qc_drying_sub_lot" violates check constraint
--   "qc_drying_sub_lot_dryer_number_check"
--
-- FIX: drop the stale 1..5 constraint and replace it with `≥ 1`, consistent with
-- qc_dry_room's own validation (qc_location_crud.sql: dryer_number must be ≥ 1).
-- The set of valid dryers is enforced by the RPC layer against qc_dry_room; the
-- CHECK just guards against zero/negative numbers. NULL still allowed (list-mode
-- carts carry dryer_number on the row; grid-mode carts via location_id).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE qc_drying_sub_lot
  DROP CONSTRAINT IF EXISTS qc_drying_sub_lot_dryer_number_check;

ALTER TABLE qc_drying_sub_lot
  ADD CONSTRAINT qc_drying_sub_lot_dryer_number_check
  CHECK (dryer_number IS NULL OR dryer_number >= 1);

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

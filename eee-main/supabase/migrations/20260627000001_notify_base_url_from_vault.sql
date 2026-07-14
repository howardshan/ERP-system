-- Migration M-159: Read the notification functions base URL from Supabase Vault.
--
-- WHY: M-083/M-084 hardcoded the Edge Functions base URL
--   ('https://<project-ref>.supabase.co/functions/v1') inside qc_notify_on_inspection().
-- That ties the trigger to ONE project, so a second environment (phase 2) would call
-- the WRONG project's send-notification. Read base_url from Vault instead, mirroring the
-- per-environment pattern already used for notify_webhook_secret (M-084). The same
-- migration is now correct for every environment.
--
-- Manual config per environment (run ONCE, NOT committed — value differs per project):
--   SQL Editor:
--     select vault.create_secret(
--       'https://<this-project-ref>.supabase.co/functions/v1', 'notify_base_url');
--   To rotate later:
--     select vault.update_secret(
--       (select id from vault.secrets where name = 'notify_base_url'),
--       'https://<new-ref>.supabase.co/functions/v1');
--
-- If notify_base_url is unset, the trigger skips the webhook silently (never blocks insert).
--
-- Depends on: M-083 (tables/trigger), M-084 (vault webhook secret).
-- Affects: docs/database/03_migrations-and-edge-functions.md, docs/modules/09_qc.md.

CREATE OR REPLACE FUNCTION qc_notify_on_inspection()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    base_url text;
    secret   text;
BEGIN
    -- Per-environment Edge Functions base URL, pulled from Vault. Wrapped so a missing
    -- entry (or Vault not enabled) never breaks the inspection insert.
    BEGIN
        SELECT decrypted_secret INTO base_url
          FROM vault.decrypted_secrets
         WHERE name = 'notify_base_url'
         LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
        base_url := NULL;
    END;

    -- Shared webhook secret from Vault (M-084).
    BEGIN
        SELECT decrypted_secret INTO secret
          FROM vault.decrypted_secrets
         WHERE name = 'notify_webhook_secret'
         LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
        secret := NULL;
    END;

    -- No base URL configured for this environment -> skip notification entirely.
    IF base_url IS NULL OR base_url = '' THEN
        RETURN NEW;
    END IF;

    -- Fire-and-forget; never block or fail the inspection insert on notification issues.
    PERFORM net.http_post(
        url     := base_url || '/send-notification',
        headers := jsonb_build_object(
            'Content-Type',    'application/json',
            'x-notify-secret', COALESCE(secret, '')
        ),
        body    := jsonb_build_object(
            'type_key',      'qc_test_result',
            'inspection_id', NEW.id
        )
    );
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RETURN NEW;  -- notification failures must not roll back the test result
END;
$$;

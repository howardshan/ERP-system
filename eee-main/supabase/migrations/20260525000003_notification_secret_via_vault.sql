-- Migration M-084: Read the notification webhook secret from Supabase Vault.
--
-- WHY: M-083's trigger read the shared secret from a database GUC configured via
--   ALTER DATABASE postgres SET app.notify_webhook_secret = '...'
-- but on hosted Supabase the `postgres` role lacks the privilege to set database
-- parameters (ERROR 42501: permission denied to set parameter). Switch to Vault,
-- which the postgres role CAN write/read on hosted projects.
--
-- Manual config (run ONCE, NOT committed — it carries the secret):
--   SQL Editor:
--     select vault.create_secret('<same value as the NOTIFY_WEBHOOK_SECRET edge
--       function secret>', 'notify_webhook_secret');
--   To rotate later:
--     select vault.update_secret(
--       (select id from vault.secrets where name = 'notify_webhook_secret'),
--       '<new value>');
--
-- Depends on: M-083 (tables, trigger, send-notification call).
-- Affects: docs/database/03_migrations-and-edge-functions.md, docs/modules/09_qc.md.

CREATE OR REPLACE FUNCTION qc_notify_on_inspection()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    base_url text := 'https://ooqygligyxjdwyfnsuqp.supabase.co/functions/v1';
    secret   text;
BEGIN
    -- Pull the shared webhook secret from Vault. Wrapped so a missing Vault entry
    -- (or Vault not enabled) never breaks the inspection insert.
    BEGIN
        SELECT decrypted_secret INTO secret
          FROM vault.decrypted_secrets
         WHERE name = 'notify_webhook_secret'
         LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
        secret := NULL;  -- send empty; the Edge Function will reject with 401
    END;

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

-- Trigger trg_qc_notify_on_inspection (M-083) already points at this function;
-- CREATE OR REPLACE updates it in place — no need to recreate the trigger.

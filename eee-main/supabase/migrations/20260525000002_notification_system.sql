-- Migration M-083: Notification system foundation (email via SMTP2Go).
-- Phase 1 of the email-notification feature. Introduces:
--   1) notification_type           — catalogue of notification kinds, grouped by module
--   2) user_notification_setting   — per-user three-state preference
--                                    (admin_enabled / user_overridable / user_enabled)
--   3) notification_log            — delivery audit trail
--   4) qc_test_result_email(uuid)  — assembles the QC "test result" email payload
--   5) notification_recipients(text) — resolves effective recipients for a type
--   6) AFTER INSERT trigger on qc_inspection_record → calls the send-notification
--      Edge Function (EF-004) via pg_net, so the email fires automatically on every
--      recorded QC test (per the chosen "每次测试都发" + DB-webhook design).
--
-- Effective-enabled rule (single source of truth, see notification_recipients):
--   user_overridable AND user_enabled IS NOT NULL  → use user_enabled
--   otherwise                                       → use admin_enabled
--
-- Manual config required AFTER applying this migration (NOT committed — secrets):
--   • supabase secrets set SMTP2GO_API_KEY=... NOTIFY_WEBHOOK_SECRET=... \
--       NOTIFY_SENDER_EMAIL=noreply@crave-cook.com
--   • In SQL editor, set the shared webhook secret the trigger sends:
--       ALTER DATABASE postgres SET app.notify_webhook_secret = '<same as NOTIFY_WEBHOOK_SECRET>';
--     (Optional override of the functions base URL — defaults to this project:
--       ALTER DATABASE postgres SET app.functions_base_url = 'https://<ref>.supabase.co/functions/v1';)
-- Idempotent where practical.

-- ─── 1) Catalogue of notification types ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_type (
    key         text PRIMARY KEY,
    module_id   text NOT NULL,            -- groups the UI into per-module cards (qc, warehouse, ...)
    label       text NOT NULL,
    description text,
    sort_order  integer NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE notification_type IS 'Catalogue of notification kinds; module_id drives the per-module grouping in the admin/account UI.';

-- ─── 2) Per-user preference (three-state) ───────────────────────────────────

CREATE TABLE IF NOT EXISTS user_notification_setting (
    user_id          uuid NOT NULL REFERENCES erp_user(id) ON DELETE CASCADE,
    type_key         text NOT NULL REFERENCES notification_type(key) ON DELETE CASCADE,
    admin_enabled    boolean NOT NULL DEFAULT false,   -- admin's setting for this user
    user_overridable boolean NOT NULL DEFAULT false,   -- may the user change it themselves?
    user_enabled     boolean,                          -- user's own choice; NULL = not set, fall back to admin
    updated_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, type_key)
);

COMMENT ON COLUMN user_notification_setting.user_enabled IS 'NULL means the user has not made a choice; effective value then falls back to admin_enabled.';

-- ─── 3) Delivery audit trail ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_log (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    type_key          text,
    recipient_email   text NOT NULL,
    subject           text,
    status            text NOT NULL CHECK (status IN ('sent', 'failed')),
    provider_response text,
    context           jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_log_created_at ON notification_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_notification_setting_type ON user_notification_setting(type_key);

-- ─── RLS (dev-mode permissive, mirrors existing qc_* / hr_* convention) ─────
-- The Edge Function uses the service-role key and bypasses RLS; these policies
-- let the authenticated front-end read/write its own settings later (phase 2).

ALTER TABLE notification_type         ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_notification_setting ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_log          ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dev_all" ON notification_type;
DROP POLICY IF EXISTS "dev_all" ON user_notification_setting;
DROP POLICY IF EXISTS "dev_all" ON notification_log;
CREATE POLICY "dev_all" ON notification_type         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON user_notification_setting FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON notification_log          FOR ALL USING (true) WITH CHECK (true);

-- ─── 4) Seed the first notification type + default recipient ────────────────

INSERT INTO notification_type (key, module_id, label, description, sort_order)
VALUES (
    'qc_test_result',
    'qc',
    'QC Test Result',
    'Sent whenever a QC water-activity test is recorded. Includes the just-tested batch result plus today''s pending / passed / failed totals.',
    10
)
ON CONFLICT (key) DO NOTHING;

-- Default recipient for phase 1: admin account. admin_enabled = on,
-- user_overridable = on (so the account can later opt out from Account Settings).
INSERT INTO user_notification_setting (user_id, type_key, admin_enabled, user_overridable, user_enabled)
SELECT eu.id, 'qc_test_result', true, true, NULL
FROM erp_user eu
WHERE eu.email = 'tianzuohuang@crave-cook.com'
ON CONFLICT (user_id, type_key) DO NOTHING;

-- ─── 5) Recipient resolution (effective-enabled rule) ───────────────────────

CREATE OR REPLACE FUNCTION notification_recipients(p_type_key text)
RETURNS TABLE (email text, full_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT eu.email, eu.full_name
    FROM user_notification_setting uns
    JOIN erp_user eu ON eu.id = uns.user_id
    WHERE uns.type_key = p_type_key
      AND eu.is_active
      AND eu.email IS NOT NULL
      AND (CASE
             WHEN uns.user_overridable AND uns.user_enabled IS NOT NULL THEN uns.user_enabled
             ELSE uns.admin_enabled
           END) = true;
$$;

-- ─── 6) QC test-result email payload (batch detail + today's stats) ─────────

CREATE OR REPLACE FUNCTION qc_test_result_email(p_inspection_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'batch', jsonb_build_object(
            'inspection_id', ir.id,
            'sub_lot_code',  s.sub_lot_code,
            'sku_code',      sku.code,
            'sku_name',      sku.name,
            'lot_number',    lot.lot_number,
            'aw',            (ir.values_json->>'aw')::numeric,
            'result',        ir.result,
            'current_status', s.status,
            'submitted_at',  ir.submitted_at,
            'inspector',     COALESCE(eu.full_name, au.email),
            'sample_id',     (SELECT sa.sample_id FROM qc_sample sa WHERE sa.id = ir.sample_id)
        ),
        'stats', (qc_overview() -> 'stats')
    )
    FROM qc_inspection_record ir
    JOIN qc_drying_sub_lot s        ON s.id = ir.drying_sub_lot_id
    LEFT JOIN qc_production_lot lot ON lot.id = s.production_lot_id
    LEFT JOIN qc_product_sku sku    ON sku.id = lot.sku_id
    LEFT JOIN auth.users au         ON au.id = ir.inspector_auth_id
    LEFT JOIN erp_user eu           ON eu.auth_user_id = au.id
    WHERE ir.id = p_inspection_id;
$$;

-- ─── 7) Trigger → fire the send-notification Edge Function on every test ────

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION qc_notify_on_inspection()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    base_url text := COALESCE(
        current_setting('app.functions_base_url', true),
        'https://ooqygligyxjdwyfnsuqp.supabase.co/functions/v1'
    );
    secret text := current_setting('app.notify_webhook_secret', true);
BEGIN
    -- Fire-and-forget; never block or fail the inspection insert on notification issues.
    PERFORM net.http_post(
        url     := base_url || '/send-notification',
        headers := jsonb_build_object(
            'Content-Type',   'application/json',
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

DROP TRIGGER IF EXISTS trg_qc_notify_on_inspection ON qc_inspection_record;
CREATE TRIGGER trg_qc_notify_on_inspection
    AFTER INSERT ON qc_inspection_record
    FOR EACH ROW EXECUTE FUNCTION qc_notify_on_inspection();


-- ===== merged from 20260525000002_qc_forecast_narrow_inflight.sql (duplicate-version dedup for fresh db build) =====

-- M-081: Narrow the "in flight" pool used by qc_dashboard_pass_rate_forecast.
--
-- Previous (M-050) definition included every cart still in any non-terminal
-- status (drying / pending / awaiting_group_result / awaiting_recheck /
-- room_temp_drying / hold / inspecting).  That over-counted carts the
-- operator hasn't even thought about testing yet:
--   - 'drying' / 'room_temp_drying' / 'awaiting_recheck' are still in the
--     dryer (or re-drying after a FAIL).  No imminent test.
--   - 'hold' is already FAILED, waiting for disposition.  No more tests
--     until a redry/retest disposition completes.
--
-- New definition: only carts that are *being tested* or *about to be tested*:
--   - 'inspecting'              — sample taken, Aw being entered
--   - 'pending'                 — checked out, in Testing queue
--   - 'awaiting_group_result'   — sibling whose champion will produce the
--                                 result they inherit via M-055 propagation
--
-- The formula stays the same — ROUND(in_progress × COALESCE(pass_rate, 1.0))
-- — so a SKU with no inspections today still shows the optimistic 100% case.

CREATE OR REPLACE FUNCTION qc_dashboard_pass_rate_forecast()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH today_inspections AS (
    SELECT pl.sku_id, ir.result
    FROM qc_inspection_record ir
    JOIN qc_drying_sub_lot s ON s.id = ir.drying_sub_lot_id
    JOIN qc_production_lot pl ON pl.id = s.production_lot_id
    WHERE ir.submitted_at >= date_trunc('day', now())
  ),
  pass_rate AS (
    SELECT sku_id,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE result = 'pass')::numeric / NULLIF(COUNT(*), 0) AS rate
    FROM today_inspections
    GROUP BY sku_id
  ),
  inflight AS (
    SELECT pl.sku_id, COUNT(*)::int AS in_progress
    FROM qc_drying_sub_lot s
    JOIN qc_production_lot pl ON pl.id = s.production_lot_id
    -- Only carts that will (very soon) yield an inspection result.
    -- See migration header for the rationale on which statuses are kept.
    WHERE s.status IN ('pending', 'inspecting', 'awaiting_group_result')
    GROUP BY pl.sku_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'sku_id', sku.id,
    'sku_code', sku.code,
    'sku_name', sku.name,
    'in_progress', COALESCE(i.in_progress, 0),
    'today_pass_rate', pr.rate,
    'today_inspections', COALESCE(pr.total, 0),
    'forecast_passes', ROUND(COALESCE(i.in_progress, 0) * COALESCE(pr.rate, 1.0))::int
  ) ORDER BY sku.code), '[]'::jsonb)
  FROM qc_product_sku sku
  LEFT JOIN inflight i ON i.sku_id = sku.id
  LEFT JOIN pass_rate pr ON pr.sku_id = sku.id
  WHERE COALESCE(i.in_progress, 0) > 0;
$$;

-- Migration M-153: Users & Authentication audit log.
-- Records account/auth events: logins/logouts, account create, profile edits,
-- activate/deactivate, password resets, and permission/module-access changes.
-- Mirrors finance_audit_log (M-018) but is DUAL-SUBJECT: it records both the
-- actor (who did it) and the target user (whose account was affected), e.g.
-- "Admin A changed permissions of User B".
--
-- Survives user deletion: both actor and target FK to auth.users ON DELETE SET
-- NULL, and actor/target name + email are denormalised so a deleted user's
-- history is still readable.  target_user_id (the erp_user id) is stored WITHOUT
-- a FK on purpose — user_permission_grant/user_module_access cascade-delete on
-- erp_user, so a FK here would let a future hard-delete orphan/clear the trail.

CREATE TABLE auth_audit_log (
  id             bigserial   PRIMARY KEY,
  action         text        NOT NULL,  -- login_success | logout | create | edit_profile | activate | deactivate | reset_password | edit_permissions
  actor_auth_id  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_name     text        NOT NULL DEFAULT 'Unknown',
  target_auth_id uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  target_user_id uuid,                  -- erp_user.id (no FK — see header note)
  target_name    text,
  target_email   text,
  before_snapshot jsonb,
  after_snapshot  jsonb,
  diff            jsonb,                -- { field: { before, after } } or { added/removed } for permissions
  description     text,
  changed_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON auth_audit_log (target_auth_id);
CREATE INDEX ON auth_audit_log (actor_auth_id);
CREATE INDEX ON auth_audit_log (changed_at DESC);
CREATE INDEX ON auth_audit_log (action);

ALTER TABLE auth_audit_log ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can insert (the app writes its own audit rows);
-- SELECT is gated by the auth.audit_log.view permission at the app layer.
-- NOTE: login_failed is intentionally NOT logged here — at that point the user
-- is unauthenticated and the INSERT policy would reject it.  (Could be added
-- later via a service-role edge function if needed.)
CREATE POLICY "auth_audit_insert" ON auth_audit_log
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "auth_audit_select" ON auth_audit_log
  FOR SELECT TO authenticated USING (true);

-- Seed the view permission for the dev admin.
INSERT INTO user_permission_grant (user_id, module_id, resource, permission, approval_limit)
SELECT eu.id, 'auth', 'audit_log', 'view', NULL
FROM erp_user eu
WHERE eu.email = 'ysha@smu.edu'
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;


-- ===== merged from 20260623000007_qc_fix_mc_soft_band.sql (duplicate-version dedup for fresh db build) =====

-- Migration M-153: Correct MC% soft band from ±0.5 to ±0.05
-- M-152 seeded MC% soft limits as [min-0.5, max+0.5]; the intended band is
-- ±0.05. This UPDATEs only the Moisture Content (MC%) templates of the
-- NON-RED products (red products keep soft = hard, untouched). Hard limits and
-- Water Activity templates are not changed. Reads current hard limits from the
-- row, so it is idempotent and independent of the seeded soft values.

UPDATE qc_inspection_template t
SET soft_lower_limit = t.lower_limit - 0.05,
    soft_upper_limit = t.upper_limit + 0.05
FROM qc_product_sku sku
WHERE t.sku_id = sku.id
  AND t.item_name = 'Moisture Content (MC%)'
  AND sku.code IN (
    '56001', '56061', '00214', '04161', '04162', '04163', '04164', '04171',
    '04172', '04173', '04174', '04175', '04191', '04201', '04203', '04302',
    '04304', '06101', '06111', '06121', '10211', '10221', '10231', '10241',
    '10251', '10261', '10271', '10281', '11203', '11207', '11303', '11401',
    '11500', '11500N', '11600', '11980', '12280', '15001', '15100', '17500',
    '17600', '17700', '17800', '20011', '20012', '20013', '20014', '20021',
    '20022', '20023', '20024', '20031', '20032', '20033', '20034', '20041',
    '20042', '20043', '20044', '23061', '24011', '24013', '24031', '24041',
    '24051', '24091', '24093', '24111', '24113', '24401', '24701', '24801',
    '24821', '24841', '24851', '24861', '250036', '250043', '250248TJ', '250300',
    '250301', '250400', '250405', '250410', '250415', '25350', '25421', '25431',
    '25441', '25451', '25501', '32341', '32342', '32343', '32351', '32352',
    '32353', '32361', '32362', '32363', '32371', '32372', '32373', '32381',
    '32382', '32383', '32502', '32512', '32521', '34346', '34347', '35011',
    '35012', '35021', '35022', '35031', '35032', '35041', '35051', '35052',
    '35061', '35061N', '35062', '35062N', '35063', '35064', '35091', '35092',
    '35101', '35102', '37001', '37002', '37003', '37022', '37100', '37200',
    '37300', '37400', '05601', '38000', '38001', '38100', '38101', '38200',
    '38201', '40011', '40013', '42021', '42031', '43511', '45011', '45021',
    '46082', '47003', '48001', '48002', '48003', '48004', '48501', '48511',
    '48521', '48531', '48541', '51201', '51501', '51551', '56021', '56041',
    '56081', '58001', '58101', '58102', '58201', '58202', '63345', '63346',
    '63348', '63501', '63546', '63548', '63548-KR', '63701', '63745', '63745-KR',
    '63746', '63748', '64142', '64144', '64311', '64312', '64341', '65001',
    '65003', '65351', '71001', '71002', '71101', '71102', '72001', '72002',
    '72003', '72004', '80111', '80121', '85001', '85003', '87853', '87860',
    '87869', '87890', '87895', '87896', '87897', '87898', '87899', '90001',
    '90002', '90003', '90004', '90005', '90006', '90021', '90022', '90023',
    '90032', '90033', '90051', '92001', '92002', '92011', '92012', '92021',
    '92022', '92061', '92062', '92063', '92064', '93001', '96001', '96003',
    '38400', '38401', '38500', '38501', '38300', '38301', '34400', '34401',
    '34410', '34411', '34420', '34421'
  );

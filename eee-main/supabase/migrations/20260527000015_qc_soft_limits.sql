-- M-118: Soft tolerance band + supervisor-only override on QC inspections.
--
-- WHY: M-109's qc_submit_inspection lets ANY user with qc.testing.submit_inspection
-- override the auto-computed PASS/FAIL freely in either direction. Operations
-- reported this is too loose — readings well outside the spec range were being
-- pushed through as PASS by anyone. The new model has THREE bands per template:
--
--   • Hard inside [lower_limit, upper_limit]                 → auto PASS
--   • Soft band   [soft_lower, lower) ∪ (upper, soft_upper]  → SUPERVISOR decides
--   • Outside soft                                           → forced FAIL
--
-- Supervisors are users holding the new permission `qc.testing.supervisor_judge`.
-- Non-supervisors can only submit when their reading sits inside the hard band
-- (the system's auto-suggested verdict). They cannot override in any direction.
-- Even supervisors cannot override outside the soft band — the spec says
-- "anything beyond soft tolerance MUST fail" and the backend enforces it.
--
-- Migration default: backfill `soft = hard` so the new band logic kicks in
-- immediately for every existing SKU (closes the override loophole). Ops then
-- explicitly widen soft for each SKU that needs supervisor discretion.
--
-- CHANGES:
--   1) qc_inspection_template: add soft_lower_limit, soft_upper_limit (numeric 10,4
--      NOT NULL after backfill). CHECK constraints ensure soft wraps hard and
--      soft_lower <= soft_upper.
--   2) qc_submit_inspection: inject three-band logic; reject manual override
--      outside soft band; require supervisor permission for soft-band override.
--   3) qc_list_products: expose soft limits per template so ProductManagement
--      can edit them.
--   4) Seed permission qc.testing.supervisor_judge for the two existing dev
--      accounts (ysha@smu.edu, shayiqing16@gmail.com) so demos keep working.
--
-- Depends on: M-109 (20260527000006, qc_submit_inspection), M-088
--   (20260525000009, qc_list_products with test_type catalog).
-- Affects: src/services/qcApi.ts, src/pages/qc/ProductManagement.tsx,
--   src/pages/qc/TestingPage.tsx, src/lib/permissionStructure.ts,
--   docs/database/03_migrations-and-edge-functions.md, docs/modules/09_qc.md.

-- ── 1) Schema ──────────────────────────────────────────────────────────────
ALTER TABLE qc_inspection_template
  ADD COLUMN IF NOT EXISTS soft_lower_limit numeric(10, 4),
  ADD COLUMN IF NOT EXISTS soft_upper_limit numeric(10, 4);

-- Backfill: existing rows have soft = hard so the new "outside soft = forced
-- FAIL" rule activates immediately. Ops widen soft per SKU as needed.
UPDATE qc_inspection_template
   SET soft_lower_limit = lower_limit,
       soft_upper_limit = upper_limit
 WHERE soft_lower_limit IS NULL OR soft_upper_limit IS NULL;

ALTER TABLE qc_inspection_template
  ALTER COLUMN soft_lower_limit SET NOT NULL,
  ALTER COLUMN soft_upper_limit SET NOT NULL;

-- Drop and recreate CHECKs idempotently so re-running this migration is safe.
ALTER TABLE qc_inspection_template
  DROP CONSTRAINT IF EXISTS qc_inspection_template_soft_wraps_hard,
  DROP CONSTRAINT IF EXISTS qc_inspection_template_soft_order;

ALTER TABLE qc_inspection_template
  ADD CONSTRAINT qc_inspection_template_soft_wraps_hard
    CHECK (soft_lower_limit <= lower_limit AND soft_upper_limit >= upper_limit),
  ADD CONSTRAINT qc_inspection_template_soft_order
    CHECK (soft_lower_limit <= soft_upper_limit);

-- ── 2) qc_submit_inspection: three-band logic + supervisor gate ─────────────
CREATE OR REPLACE FUNCTION qc_submit_inspection(
    p_sub_lot_id uuid,
    p_aw numeric,
    p_sample_pk uuid DEFAULT NULL,
    p_result text DEFAULT NULL,
    p_remark text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    s qc_drying_sub_lot%ROWTYPE;
    lot qc_production_lot%ROWTYPE;
    tmpl qc_inspection_template%ROWTYPE;
    has_tmpl boolean := false;
    suggested text;
    judged text;
    new_status text;
    event_type text;
    rec_id uuid;
    sample qc_sample%ROWTYPE;
    propagated_count int := 0;
    in_hard boolean := false;
    in_soft boolean := true;   -- absent template behaves as "anything goes" for backward compat
    is_supervisor boolean := false;
    is_override boolean := false;
BEGIN
    IF p_aw IS NULL OR p_aw < 0 OR p_aw > 2 THEN
        RAISE EXCEPTION 'Invalid Aw value: %', p_aw;
    END IF;
    IF p_result IS NOT NULL AND p_result NOT IN ('pass', 'fail') THEN
        RAISE EXCEPTION 'Invalid result: %', p_result;
    END IF;

    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sub-lot not found'; END IF;

    IF p_sample_pk IS NOT NULL THEN
      SELECT * INTO sample FROM qc_sample WHERE id = p_sample_pk FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Sample not found'; END IF;
      IF sample.drying_sub_lot_id <> p_sub_lot_id THEN
        RAISE EXCEPTION 'Sample does not belong to this sub-lot';
      END IF;
      IF sample.status <> 'pending' THEN
        RAISE EXCEPTION 'Sample is already % — take a new sample to re-test', sample.status;
      END IF;
    END IF;

    IF s.status = 'pending' THEN
        UPDATE qc_drying_sub_lot SET status = 'inspecting', updated_at = now() WHERE id = p_sub_lot_id;
        s.status := 'inspecting';
    END IF;

    IF s.status <> 'inspecting' THEN
        RAISE EXCEPTION 'Sub-lot not inspectable (status=%)', s.status;
    END IF;

    SELECT * INTO lot FROM qc_production_lot WHERE id = s.production_lot_id;
    SELECT * INTO tmpl FROM qc_inspection_template WHERE sku_id = lot.sku_id LIMIT 1;
    has_tmpl := FOUND;

    IF has_tmpl THEN
        in_hard := (p_aw >= tmpl.lower_limit      AND p_aw <= tmpl.upper_limit);
        in_soft := (p_aw >= tmpl.soft_lower_limit AND p_aw <= tmpl.soft_upper_limit);
        suggested := CASE WHEN in_hard THEN 'pass' ELSE 'fail' END;
    ELSE
        suggested := NULL;
    END IF;

    -- Manual override gate. We only enforce when the caller's p_result diverges
    -- from `suggested` AND there's a template to validate against. The "no
    -- template, no manual result" failure mode still raises below.
    is_override := has_tmpl AND p_result IS NOT NULL AND p_result <> suggested;
    IF is_override THEN
        IF NOT in_soft THEN
            RAISE EXCEPTION 'Reading % is outside soft tolerance [%, %] — manual override not allowed',
                p_aw, tmpl.soft_lower_limit, tmpl.soft_upper_limit;
        END IF;
        SELECT EXISTS (
            SELECT 1
              FROM user_permission_grant g
              JOIN erp_user u ON u.id = g.user_id
             WHERE u.auth_user_id = auth.uid()
               AND g.module_id = 'qc'
               AND g.resource  = 'testing'
               AND g.permission = 'supervisor_judge'
        ) INTO is_supervisor;
        IF NOT is_supervisor THEN
            RAISE EXCEPTION 'Supervisor permission (qc.testing.supervisor_judge) required to override the auto-judgment';
        END IF;
    END IF;

    -- Final result: manual decision wins; fall back to the suggestion (legacy
    -- auto-judge path / bulk submit).
    judged := COALESCE(p_result, suggested);
    IF judged IS NULL THEN
        RAISE EXCEPTION 'No inspection template for SKU and no manual result provided';
    END IF;

    INSERT INTO qc_inspection_record (drying_sub_lot_id, inspector_auth_id, values_json, result, sample_id, remark)
    VALUES (p_sub_lot_id, auth.uid(),
            jsonb_build_object(
              'aw', p_aw,
              'suggested', suggested,
              'in_hard', in_hard,
              'in_soft', in_soft
            ),
            judged, p_sample_pk, p_remark)
    RETURNING id INTO rec_id;

    IF p_sample_pk IS NOT NULL THEN
      UPDATE qc_sample SET status = 'inspected', inspection_record_id = rec_id
      WHERE id = p_sample_pk;
    END IF;

    IF judged = 'pass' THEN
        new_status := 'passed';
        event_type := 'inspection_passed';
    ELSE
        new_status := 'hold';
        event_type := 'inspection_failed_hold';
    END IF;

    UPDATE qc_drying_sub_lot SET status = new_status, updated_at = now() WHERE id = p_sub_lot_id;

    -- ── Champion group propagation (unchanged from M-109) ───────────────────
    IF s.is_test_champion AND s.test_group_id IS NOT NULL THEN
        IF judged = 'pass' THEN
            UPDATE qc_drying_sub_lot
            SET status = 'passed', updated_at = now()
            WHERE test_group_id = s.test_group_id
              AND id <> p_sub_lot_id
              AND is_test_champion = false
              AND status IN ('awaiting_group_result', 'pending');
            GET DIAGNOSTICS propagated_count = ROW_COUNT;

            UPDATE qc_test_group
            SET status = 'passed', resolved_at = now()
            WHERE id = s.test_group_id;

            INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
            SELECT id, 'group_passed_by_champion',
                   jsonb_build_object('test_group_id', s.test_group_id, 'champion_id', s.id),
                   auth.uid()
            FROM qc_drying_sub_lot
            WHERE test_group_id = s.test_group_id AND id <> s.id AND status = 'passed'
              AND is_test_champion = false;
        ELSE
            UPDATE qc_drying_sub_lot
            SET status = 'hold', updated_at = now()
            WHERE test_group_id = s.test_group_id
              AND id <> p_sub_lot_id
              AND is_test_champion = false
              AND status IN ('awaiting_group_result', 'pending');
            GET DIAGNOSTICS propagated_count = ROW_COUNT;

            UPDATE qc_test_group
            SET status = 'closed_failed', resolved_at = now()
            WHERE id = s.test_group_id;

            INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
            SELECT id, 'group_failed_by_champion',
                   jsonb_build_object(
                       'test_group_id', s.test_group_id,
                       'champion_id', s.id,
                       'champion_aw', p_aw
                   ),
                   auth.uid()
            FROM qc_drying_sub_lot
            WHERE test_group_id = s.test_group_id AND id <> s.id AND status = 'hold'
              AND is_test_champion = false;
        END IF;
    END IF;

    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    VALUES (p_sub_lot_id, event_type,
            jsonb_build_object(
              'aw', p_aw, 'result', judged,
              'suggested', suggested,
              'in_hard', in_hard,
              'in_soft', in_soft,
              'manual_override', is_override,
              'manual_override_by_supervisor', (is_override AND is_supervisor),
              'remark', p_remark,
              'limits',      CASE WHEN has_tmpl THEN jsonb_build_array(tmpl.lower_limit,       tmpl.upper_limit) END,
              'soft_limits', CASE WHEN has_tmpl THEN jsonb_build_array(tmpl.soft_lower_limit,  tmpl.soft_upper_limit) END,
              'sample_pk', p_sample_pk,
              'sample_id', sample.sample_id,
              'is_test_champion', s.is_test_champion,
              'group_members_propagated', propagated_count
            ),
            auth.uid());

    RETURN jsonb_build_object(
        'id', rec_id,
        'drying_sub_lot_id', p_sub_lot_id,
        'result', judged,
        'suggested', suggested,
        'remark', p_remark,
        'values_json', jsonb_build_object('aw', p_aw),
        'submitted_at', now(),
        'new_status', new_status,
        'sample_pk', p_sample_pk,
        'group_members_propagated', propagated_count
    );
END;
$$;

-- ── 3) qc_list_products: expose soft limits per template ───────────────────
CREATE OR REPLACE FUNCTION qc_list_products()
RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id',                     sku.id,
            'code',                   sku.code,
            'name',                   sku.name,
            'standard_drying_minutes', sku.standard_drying_minutes,
            'sample_every_n_carts',   sku.sample_every_n_carts,
            'templates', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'id',               t.id,
                    'sku_id',           t.sku_id,
                    'test_type_id',     t.test_type_id,
                    'item_name',        COALESCE(tt.name, t.item_name),
                    'unit',             COALESCE(tt.unit, t.unit),
                    'lower_limit',      t.lower_limit,
                    'upper_limit',      t.upper_limit,
                    'soft_lower_limit', t.soft_lower_limit,
                    'soft_upper_limit', t.soft_upper_limit
                ) ORDER BY t.created_at)
                FROM qc_inspection_template t
                LEFT JOIN qc_test_type tt ON tt.id = t.test_type_id
                WHERE t.sku_id = sku.id
            ), '[]'::jsonb)
        ) ORDER BY sku.code
    ), '[]'::jsonb)
    FROM qc_product_sku sku;
$$;

-- ── 4) Seed qc.testing.supervisor_judge for existing dev accounts ──────────
INSERT INTO user_permission_grant (user_id, module_id, resource, permission, approval_limit)
SELECT eu.id, 'qc', 'testing', 'supervisor_judge', NULL
FROM erp_user eu
WHERE eu.email IN ('ysha@smu.edu', 'shayiqing16@gmail.com')
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;

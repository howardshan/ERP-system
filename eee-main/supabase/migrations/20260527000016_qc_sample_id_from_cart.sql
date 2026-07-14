-- M-119: Auto-generate sample IDs from cart codes.
--
-- WHY: Operations doesn't want to maintain a separate sample numbering scheme.
-- The cart code (sub_lot_code, e.g. "W12345-001") already uniquely identifies
-- the unit being tested, so the sample ID should mirror it directly. Retests
-- (subsequent samples on the same cart after a fail+disposition=retest cycle)
-- get an "R" / "R2" / "R3" ... suffix so the timeline can still distinguish
-- "the original test" from "the retest at this stage of the disposition flow".
--
-- BEHAVIOUR: qc_take_sample's `p_sample_id` becomes optional.
--   • Caller passes a value      → kept as-is (legacy callers / manual override).
--   • Caller passes NULL/empty   → server computes:
--       - n = count of existing qc_sample rows for this sub_lot
--       - n = 0 → sample_id = <sub_lot_code>                 (initial test)
--       - n = 1 → sample_id = <sub_lot_code>R                (first retest)
--       - n ≥ 2 → sample_id = <sub_lot_code>R<n>             (n-th retest)
--
-- Existing data is NOT touched — operators keep their hand-numbered IDs;
-- only NEW samples from the auto-gen path follow the convention.
--
-- Depends on: M-048 (qc_sample.test_group_id), M-053 (sub_lot_code format).
-- Affects: src/services/qcApi.ts, src/pages/qc/TestingPage.tsx.

CREATE OR REPLACE FUNCTION qc_take_sample(
    p_sub_lot_id uuid,
    p_sample_id text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    s            qc_drying_sub_lot%ROWTYPE;
    new_id       uuid;
    row          qc_sample%ROWTYPE;
    auto_id      text;
    sample_count int;
BEGIN
    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sub-lot not found'; END IF;
    IF s.status NOT IN ('pending', 'inspecting') THEN
        RAISE EXCEPTION 'Cannot take a sample for sub-lot in status %', s.status;
    END IF;

    -- M-119: auto-generate when caller omits the ID.
    IF p_sample_id IS NULL OR length(trim(p_sample_id)) = 0 THEN
        SELECT COUNT(*) INTO sample_count
          FROM qc_sample
         WHERE drying_sub_lot_id = p_sub_lot_id;
        IF sample_count = 0 THEN
            auto_id := s.sub_lot_code;
        ELSIF sample_count = 1 THEN
            auto_id := s.sub_lot_code || 'R';
        ELSE
            auto_id := s.sub_lot_code || 'R' || sample_count::text;
        END IF;
    ELSE
        auto_id := trim(p_sample_id);
    END IF;

    INSERT INTO qc_sample (drying_sub_lot_id, test_group_id, sample_id, taken_by_auth_id)
    VALUES (p_sub_lot_id, s.test_group_id, auto_id, auth.uid())
    RETURNING id INTO new_id;

    SELECT * INTO row FROM qc_sample WHERE id = new_id;

    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    VALUES (p_sub_lot_id, 'sample_taken',
            jsonb_build_object(
                'sample_id',     row.sample_id,
                'sample_pk',     row.id,
                'test_group_id', s.test_group_id,
                'auto_generated', (p_sample_id IS NULL OR length(trim(coalesce(p_sample_id, ''))) = 0)
            ),
            auth.uid());

    RETURN jsonb_build_object(
        'id',                row.id,
        'drying_sub_lot_id', row.drying_sub_lot_id,
        'test_group_id',     row.test_group_id,
        'sample_id',         row.sample_id,
        'taken_at',          row.taken_at,
        'status',            row.status
    );
END;
$$;


-- ===== merged from 20260527000016_qc_submit_inspection_restore_no_supervisor.sql (duplicate-version dedup for fresh db build) =====

-- Migration M-119: restore qc_submit_inspection — remove undeclared
-- "supervisor_judge" permission gate that was added directly on the live DB
-- via SQL Editor (NOT through any tracked migration).
--
-- Symptoms reported by operator:
--   The Testing page returned 400 from rpc/qc_submit_inspection with
--   "Supervisor permission (qc.testing.supervisor_judge) required to override
--    the auto-judgment" the moment the operator clicked Fail on a reading
--   whose Aw was within spec range (system suggested PASS, operator overrode
--   to FAIL).
--
-- Root cause: somebody ran a CREATE OR REPLACE FUNCTION on the live DB that
-- added a permission check requiring `qc.testing.supervisor_judge`. That
-- permission key:
--   • is not in any migration in this repo,
--   • is not in src/lib/permissionStructure.ts (no way to grant via UI),
--   • contradicts the M-109 / M-117 design where any operator with
--     `qc.testing.submit_inspection` may override the suggestion + write a
--     remark (BR-Q67).
--
-- Fix: byte-for-byte restore the M-117 (20260527000014) function body so the
-- repo and the live DB realign. Idempotent — re-applying it does no harm.
-- Behaviour preserved: the M-117 S4 hold-sync hook for fail propagation is
-- kept (writes 'qc_hold_synced_to_wh' events; no balance change).
--
-- If a supervisor approval gate is wanted later, do it properly:
--   1) add `supervisor_judge` to permissionStructure.ts under qc.testing,
--   2) add a permission seed migration,
--   3) re-introduce the check here in a tracked migration,
--   4) update the Testing page to disable the override buttons when the
--      operator lacks the permission (so the gate is not just a 400 surprise).
--
-- Depends on: M-117 (20260527000014). Affects: docs/database/03... only
-- (no schema changes, no frontend changes).

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
    v_wh_lot_id bigint;
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
        suggested := CASE WHEN p_aw >= tmpl.lower_limit AND p_aw <= tmpl.upper_limit THEN 'pass' ELSE 'fail' END;
    ELSE
        suggested := NULL;
    END IF;

    judged := COALESCE(p_result, suggested);
    IF judged IS NULL THEN
        RAISE EXCEPTION 'No inspection template for SKU and no manual result provided';
    END IF;

    INSERT INTO qc_inspection_record (drying_sub_lot_id, inspector_auth_id, values_json, result, sample_id, remark)
    VALUES (p_sub_lot_id, auth.uid(),
            jsonb_build_object('aw', p_aw, 'suggested', suggested),
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

    -- ── Champion group propagation (M-106 backstop) ───────────────────────────
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
    -- ─────────────────────────────────────────────────────────────────────────

    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    VALUES (p_sub_lot_id, event_type,
            jsonb_build_object(
              'aw', p_aw, 'result', judged,
              'suggested', suggested,
              'manual_override', (suggested IS NOT NULL AND p_result IS NOT NULL AND p_result <> suggested),
              'remark', p_remark,
              'limits', CASE WHEN has_tmpl THEN jsonb_build_array(tmpl.lower_limit, tmpl.upper_limit) END,
              'sample_pk', p_sample_pk,
              'sample_id', sample.sample_id,
              'is_test_champion', s.is_test_champion,
              'group_members_propagated', propagated_count
            ),
            auth.uid());

    -- ★ S4 hold-sync hook (no balance change — informational only).
    -- Covers the champion AND any group siblings just propagated to 'hold'.
    IF judged = 'fail' THEN
        v_wh_lot_id := lot.lot_id;

        INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
        SELECT sl.id, 'qc_hold_synced_to_wh',
               jsonb_build_object(
                 'wh_lot_id', v_wh_lot_id,
                 'source', CASE WHEN sl.id = p_sub_lot_id THEN 'inspection_fail' ELSE 'group_propagation' END,
                 'champion_id', s.id,
                 'test_group_id', s.test_group_id,
                 'inspection_record_id', rec_id
               ),
               auth.uid()
        FROM qc_drying_sub_lot sl
        WHERE sl.status = 'hold'
          AND (
                sl.id = p_sub_lot_id
                OR (s.test_group_id IS NOT NULL AND sl.test_group_id = s.test_group_id)
              );
    END IF;

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
        'group_members_propagated', propagated_count,
        'wh_lot_id', CASE WHEN judged = 'fail' THEN lot.lot_id END
    );
END;
$$;

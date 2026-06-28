-- M-151: Grant the new qc.daily_report resource (BR-Q82).
--
-- daily_report.view → everyone who can already see Testing status.
-- daily_report.sign → everyone who can already submit inspections.
-- Idempotent via ON CONFLICT DO NOTHING. Mirrors the M-149 backfill pattern.

INSERT INTO user_permission_grant (user_id, module_id, resource, permission, approval_limit)
SELECT g.user_id, 'qc', 'daily_report', 'view', NULL
FROM user_permission_grant g
WHERE g.module_id = 'qc'
  AND g.resource = 'testing'
  AND g.permission = 'view_status'
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;

INSERT INTO user_permission_grant (user_id, module_id, resource, permission, approval_limit)
SELECT g.user_id, 'qc', 'daily_report', 'sign', NULL
FROM user_permission_grant g
WHERE g.module_id = 'qc'
  AND g.resource = 'testing'
  AND g.permission = 'submit_inspection'
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;


-- ===== merged from 20260623000005_qc_quality_event_summary_human_readable.sql (duplicate-version dedup for fresh db build) =====

-- Migration M-151: humanise Batch Trace event summaries.
--
-- BUG REPORTED FROM PRODUCTION → BATCH TRACE:
--   The Quality events list shows raw event-type identifiers like
--   `sub_lot_created`, `group_assigned`, `resume_drying`,
--   `qc_disposition_synced_to_wh`, `released` — operators find these
--   programmer-speak unreadable.
--
-- ROOT CAUSE:
--   The original `qc_quality_event_summary` (in M-002 / 20260520000002) only
--   special-cases `check_in`, `check_out`, `inspection_passed`,
--   `inspection_failed_hold`, and `disposition_completed`. Anything else
--   falls through the catch-all `RETURN prefix || p_event_type;` and surfaces
--   the raw type name. Disposition-completed itself only labels the four
--   legacy types (rework / grind / scrap / concession) and prints the raw
--   `redry_dryer` / `room_temp_dry` / `retest` for the M-106-era flows.
--
-- FIX:
--   Replace the function with a comprehensive CASE that covers every
--   event_type the codebase actually emits to qc_quality_event, with concise
--   English summaries that surface the most useful payload bits (e.g. dryer
--   number moves, sample id taken, group sequence, target dry minutes for
--   redry, sync source). Falls back to a humanised version of the raw type
--   (underscores → spaces, first letter upper-cased) so even unknown events
--   render legibly.
--
-- This function is consumed by:
--   • qc_production_lot_detail (M-099 / M-150) — Batch Trace page
--   • qc_sub_lot_full_history (M-145 / M-146)   — Sub-lot history drawer
-- so both surfaces pick up the new summaries immediately on re-call.
--
-- Depends on: M-002 (20260520000002 original definition + qc_format_fail_reason).
-- Affects: docs/database/03..., docs/modules/09_qc.md. No frontend changes.

CREATE OR REPLACE FUNCTION qc_quality_event_summary(
    p_event_type text, p_payload jsonb, p_sub_lot_code text
) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    prefix text := CASE WHEN p_sub_lot_code IS NOT NULL THEN p_sub_lot_code || ' · ' ELSE '' END;
    aw_val numeric;
    lo numeric;
    hi numeric;
    dtype text;
    label text;
    remark text;
    n int;
    old_dryer int;
    new_dryer int;
    src text;
    sample_label text;
BEGIN
    -- ── Lifecycle ───────────────────────────────────────────────────────────
    IF p_event_type = 'sub_lot_created' THEN
        RETURN prefix || 'Cart created on production floor';

    ELSIF p_event_type = 'scanned_for_check_in' THEN
        RETURN prefix || 'Scanned at dryer door — ready to check in';

    ELSIF p_event_type = 'check_in' THEN
        RETURN prefix || 'Checked in to dryer (' || COALESCE(p_payload->>'sub_lot_code', p_sub_lot_code, 'sub-lot') || ')';

    ELSIF p_event_type = 'move_dryer' THEN
        old_dryer := NULLIF(p_payload->>'old_dryer', '')::int;
        new_dryer := NULLIF(p_payload->>'new_dryer', '')::int;
        IF old_dryer IS NOT NULL AND new_dryer IS NOT NULL THEN
            RETURN prefix || 'Moved to a different dryer (Dryer ' || old_dryer || ' → Dryer ' || new_dryer || ')';
        END IF;
        RETURN prefix || 'Moved to a different dryer cell';

    ELSIF p_event_type = 'resume_drying' THEN
        RETURN prefix || 'Drying resumed';

    ELSIF p_event_type = 'check_out' THEN
        RETURN prefix || 'Checked out of dryer — pending inspection';

    ELSIF p_event_type = 'displaced' THEN
        RETURN prefix || 'Displaced from cell by another cart';

    -- ── Sampling group lifecycle ────────────────────────────────────────────
    ELSIF p_event_type = 'group_assigned' THEN
        n := NULLIF(p_payload->>'member_count', '')::int;
        IF (p_payload->>'is_champion') = 'true' THEN
            label := 'champion';
        ELSE
            label := 'sibling';
        END IF;
        IF (p_payload->>'redry') = 'true' THEN
            RETURN prefix || 'Assigned to retest sampling group as ' || label
                || COALESCE(' (' || n || ' carts)', '');
        END IF;
        RETURN prefix || 'Assigned to sampling group as ' || label
            || COALESCE(' (' || n || ' carts)', '');

    ELSIF p_event_type = 'group_passed_by_champion' THEN
        RETURN prefix || 'Passed via the group champion''s test';

    ELSIF p_event_type = 'group_failed_by_champion' THEN
        aw_val := NULLIF(p_payload->>'champion_aw', '')::numeric;
        IF aw_val IS NOT NULL THEN
            RETURN prefix || 'Failed via the group champion''s test (champion Aw ' || aw_val || ')';
        END IF;
        RETURN prefix || 'Failed via the group champion''s test';

    ELSIF p_event_type = 'group_retest_reset' THEN
        RETURN prefix || 'Reset to await new sampling group (retest)';

    ELSIF p_event_type = 'group_orphan_repaired' THEN
        RETURN prefix || 'Sampling group state repaired';

    ELSIF p_event_type = 'champion_promoted' THEN
        RETURN prefix || 'Promoted to sampling group champion';

    -- ── Sampling / inspection ───────────────────────────────────────────────
    ELSIF p_event_type = 'sample_taken' THEN
        sample_label := NULLIF(p_payload->>'sample_id', '');
        IF sample_label IS NOT NULL THEN
            RETURN prefix || 'Sample taken (' || sample_label || ')';
        END IF;
        RETURN prefix || 'Sample taken';

    ELSIF p_event_type IN ('inspection_passed', 'inspection_failed_hold') THEN
        aw_val := NULLIF(p_payload->>'aw', '')::numeric;
        IF p_payload ? 'limits' AND jsonb_array_length(p_payload->'limits') >= 2 THEN
            lo := (p_payload->'limits'->>0)::numeric;
            hi := (p_payload->'limits'->>1)::numeric;
            IF p_event_type = 'inspection_passed' THEN
                RETURN prefix || 'Inspection passed: Water Activity (Aw) ' || COALESCE(aw_val::text, '—')
                       || ' (spec [' || lo || ', ' || hi || '])';
            ELSIF aw_val IS NOT NULL THEN
                RETURN prefix || 'Inspection failed — Hold: ' || qc_format_fail_reason(aw_val, lo, hi);
            ELSE
                RETURN prefix || 'Inspection failed — Hold (spec [' || lo || ', ' || hi || '])';
            END IF;
        END IF;
        IF p_event_type = 'inspection_passed' THEN
            RETURN prefix || 'Inspection passed: Water Activity (Aw) ' || COALESCE(aw_val::text, '—');
        END IF;
        RETURN prefix || 'Inspection failed — Hold: Water Activity (Aw) ' || COALESCE(aw_val::text, '—');

    -- ── Disposition ─────────────────────────────────────────────────────────
    ELSIF p_event_type = 'disposition_completed' THEN
        dtype := p_payload->>'type';
        label := CASE dtype
            WHEN 'rework'        THEN 'Rework'
            WHEN 'grind'         THEN 'Grind & re-line'
            WHEN 'scrap'         THEN 'Scrap'
            WHEN 'concession'    THEN 'Concession'
            WHEN 'redry_dryer'   THEN 'Re-dry in dryer'
            WHEN 'room_temp_dry' THEN 'Room-temp dry'
            WHEN 'retest'        THEN 'Retest (no re-dry)'
            ELSE COALESCE(dtype, 'Disposition')
        END;
        -- For redry, surface the new target drying time if present.
        IF dtype = 'redry_dryer' AND (p_payload->>'redry_expected_dry_minutes') IS NOT NULL THEN
            label := label || ' (' || (p_payload->>'redry_expected_dry_minutes') || ' min target)';
        END IF;
        remark := trim(COALESCE(p_payload->>'remark', ''));
        IF remark <> '' THEN
            RETURN prefix || 'Disposition completed: ' || label || ' — ' || remark;
        END IF;
        RETURN prefix || 'Disposition completed: ' || label;

    ELSIF p_event_type = 'room_temp_dry_completed' THEN
        RETURN prefix || 'Room-temp drying stopped — back to testing';

    -- ── Warehouse sync hooks (S4 audit only — no balance change) ────────────
    ELSIF p_event_type = 'qc_hold_synced_to_wh' THEN
        src := p_payload->>'source';
        IF src = 'group_propagation' THEN
            RETURN prefix || 'Hold synced to warehouse (via group propagation)';
        END IF;
        RETURN prefix || 'Hold synced to warehouse';

    ELSIF p_event_type = 'qc_disposition_synced_to_wh' THEN
        RETURN prefix || 'Disposition synced to warehouse';

    -- ── Release / packaging ────────────────────────────────────────────────
    ELSIF p_event_type = 'released' THEN
        RETURN prefix || 'Released to packaging';

    ELSIF p_event_type = 'packaging_item_set' THEN
        RETURN prefix || 'Packaging SKU assigned';

    -- ── Repair / admin ─────────────────────────────────────────────────────
    ELSIF p_event_type = 'manual_repair' THEN
        RETURN prefix || 'Manual data repair applied';
    END IF;

    -- Fallback: humanise the raw event_type so unknowns still read OK.
    RETURN prefix || initcap(replace(COALESCE(p_event_type, ''), '_', ' '));
END;
$$;

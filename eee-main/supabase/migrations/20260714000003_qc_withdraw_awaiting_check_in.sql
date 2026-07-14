-- ─────────────────────────────────────────────────────────────────────────────
-- M-166  Withdraw carts from the "awaiting check-in" queue (with reason + log)
--
-- Operators sometimes scan a cart to the dryer door (→ Awaiting check-in) by
-- mistake, or a shift change leaves a partial cart that should not be checked in.
-- This lets them withdraw such carts from the queue: it clears
-- scanned_for_check_in_at (the cart reverts to un-staged `created`, re-scannable)
-- and records WHY. The action is logged to each cart's timeline via a
-- `check_in_withdrawn` qc_quality_event, which — because qc_quality_event is a
-- source of v_system_audit_log (M-155) — also appears in the central operation
-- log automatically.
--
-- Reasons: 'shift_change' (换班半车) | 'scan_error' (扫码错误) | 'other' (其他,
-- requires a free-text note). Only carts still awaiting (status='created' AND
-- scanned_for_check_in_at IS NOT NULL) can be withdrawn; others are skipped.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION qc_withdraw_awaiting_check_in(
    p_sub_lot_ids uuid[],
    p_reason text,
    p_reason_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    sub_id uuid;
    s qc_drying_sub_lot%ROWTYPE;
    succeeded jsonb := '[]'::jsonb;
    failed jsonb := '[]'::jsonb;
    requested int := COALESCE(array_length(p_sub_lot_ids, 1), 0);
    v_note text := NULLIF(btrim(COALESCE(p_reason_note, '')), '');
BEGIN
    IF requested = 0 THEN
        RETURN jsonb_build_object('requested', 0, 'succeeded', succeeded, 'failed', failed);
    END IF;
    IF p_reason NOT IN ('shift_change', 'scan_error', 'other') THEN
        RAISE EXCEPTION 'Invalid withdraw reason: %', p_reason;
    END IF;
    IF p_reason = 'other' AND v_note IS NULL THEN
        RAISE EXCEPTION 'A note is required when the withdraw reason is "other"';
    END IF;

    FOREACH sub_id IN ARRAY p_sub_lot_ids LOOP
        SELECT * INTO s FROM qc_drying_sub_lot WHERE id = sub_id FOR UPDATE;
        IF NOT FOUND THEN
            failed := failed || jsonb_build_array(jsonb_build_object('sub_lot_id', sub_id, 'reason', 'not_found'));
            CONTINUE;
        END IF;
        -- Only carts still awaiting check-in (created + scanned) can be withdrawn.
        IF s.status <> 'created' OR s.scanned_for_check_in_at IS NULL THEN
            failed := failed || jsonb_build_array(jsonb_build_object(
                'sub_lot_id', sub_id, 'sub_lot_code', s.sub_lot_code,
                'reason', 'not_awaiting', 'status', s.status));
            CONTINUE;
        END IF;

        UPDATE qc_drying_sub_lot
        SET scanned_for_check_in_at = NULL, updated_at = now()
        WHERE id = sub_id;

        INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
        VALUES (sub_id, 'check_in_withdrawn',
                jsonb_build_object(
                    'sub_lot_code',       s.sub_lot_code,
                    'reason',             p_reason,
                    'reason_note',        v_note,
                    'work_order_barcode', (SELECT work_order_barcode FROM qc_production_lot WHERE id = s.production_lot_id)),
                auth.uid());

        succeeded := succeeded || jsonb_build_array(jsonb_build_object(
            'sub_lot_id', sub_id, 'sub_lot_code', s.sub_lot_code));
    END LOOP;

    RETURN jsonb_build_object('requested', requested, 'succeeded', succeeded, 'failed', failed);
END;
$$;

-- Re-create qc_quality_event_summary (verbatim current body) + a check_in_withdrawn
-- branch so the new event reads well on the cart timeline and central audit log.

CREATE OR REPLACE FUNCTION public.qc_quality_event_summary(p_event_type text, p_payload jsonb, p_sub_lot_code text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
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


    ELSIF p_event_type = 'check_in_withdrawn' THEN
        RETURN prefix || 'Withdrawn from check-in queue'
            || CASE p_payload->>'reason'
                 WHEN 'shift_change' THEN ' (shift change — partial cart)'
                 WHEN 'scan_error'   THEN ' (scan error)'
                 WHEN 'other'        THEN ' (other' || COALESCE(': ' || NULLIF(p_payload->>'reason_note', ''), '') || ')'
                 ELSE ''
               END;
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
$function$;

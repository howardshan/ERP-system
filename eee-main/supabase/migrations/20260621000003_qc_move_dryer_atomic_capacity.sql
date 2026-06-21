-- ─────────────────────────────────────────────────────────────────────────────
-- M-136  Move-dryer: capacity is ALL-OR-NOTHING (no silent partial move)
--
-- Same fix as M-135 (bulk check-in), applied to qc_move_sub_lots_dryer. The old
-- per-cart loop pushed over-capacity carts into `failed` while still moving the
-- ones that fit — and the front end never surfaced `failed`, so moving more
-- carts than the target dryer can hold silently partial-filled it.
--
-- After: pass 1 validates + sums the units of eligible carts (in 'drying', not
-- already in the target dryer); if the target can't hold them ALL, the whole
-- move is rejected with `OVER_CAPACITY|free=..|need=..|carts=..` and NOTHING
-- moves. Per-cart not_found / wrong_status / same_dryer are still reported
-- individually (they don't abort the batch).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.qc_move_sub_lots_dryer(p_sub_lot_ids uuid[], p_new_dryer_number integer)
returns jsonb language plpgsql as $function$
DECLARE
    succeeded jsonb[] := ARRAY[]::jsonb[];
    failed jsonb[] := ARRAY[]::jsonb[];
    sid uuid;
    s qc_drying_sub_lot%ROWTYPE;
    old_dryer int;
    cap numeric := qc_dryer_capacity(p_new_dryer_number);
    used numeric := qc_dryer_used_units(p_new_dryer_number);
    v_units numeric;
    eligible_units numeric := 0;
    eligible_count integer := 0;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM qc_dry_room WHERE dryer_number = p_new_dryer_number) THEN
        RAISE EXCEPTION 'Unknown dryer: %', p_new_dryer_number;
    END IF;

    -- ── Pass 1: validate + record per-cart skips + sum eligible units ─────────
    FOREACH sid IN ARRAY p_sub_lot_ids LOOP
        SELECT * INTO s FROM qc_drying_sub_lot WHERE id = sid FOR UPDATE;
        IF NOT FOUND THEN
            failed := failed || jsonb_build_object('sub_lot_id', sid, 'reason', 'not_found'); CONTINUE;
        END IF;
        IF s.status <> 'drying' THEN
            failed := failed || jsonb_build_object('sub_lot_id', sid, 'sub_lot_code', s.sub_lot_code, 'reason', 'wrong_status', 'status', s.status); CONTINUE;
        END IF;
        old_dryer := COALESCE(s.dryer_number, (SELECT dryer_number FROM qc_drying_location WHERE id = s.location_id));
        IF old_dryer = p_new_dryer_number THEN
            failed := failed || jsonb_build_object('sub_lot_id', sid, 'sub_lot_code', s.sub_lot_code, 'reason', 'same_dryer'); CONTINUE;
        END IF;
        eligible_units := eligible_units + COALESCE(qc_sub_lot_units(sid), 1);
        eligible_count := eligible_count + 1;
    END LOOP;

    -- ── All-or-nothing capacity gate: reject everything, move nothing ─────────
    IF eligible_count > 0 AND used + eligible_units > cap THEN
        RAISE EXCEPTION 'OVER_CAPACITY|free=%|need=%|carts=%', GREATEST(cap - used, 0), eligible_units, eligible_count
            USING ERRCODE = 'check_violation';
    END IF;

    -- ── Pass 2: move every eligible cart (guaranteed to fit) ──────────────────
    FOREACH sid IN ARRAY p_sub_lot_ids LOOP
        SELECT * INTO s FROM qc_drying_sub_lot WHERE id = sid FOR UPDATE;
        IF NOT FOUND THEN CONTINUE; END IF;                       -- already in failed
        IF s.status <> 'drying' THEN CONTINUE; END IF;
        old_dryer := COALESCE(s.dryer_number, (SELECT dryer_number FROM qc_drying_location WHERE id = s.location_id));
        IF old_dryer = p_new_dryer_number THEN CONTINUE; END IF;

        UPDATE qc_drying_sub_lot SET dryer_number = p_new_dryer_number, location_id = NULL, updated_at = now() WHERE id = sid;

        INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
        VALUES (sid, 'move_dryer', jsonb_build_object('old_dryer', old_dryer, 'new_dryer', p_new_dryer_number), auth.uid());

        succeeded := succeeded || jsonb_build_object('sub_lot_id', sid, 'sub_lot_code', s.sub_lot_code,
            'old_dryer', old_dryer, 'new_dryer', p_new_dryer_number);
    END LOOP;

    RETURN jsonb_build_object('requested', COALESCE(array_length(p_sub_lot_ids, 1), 0),
        'succeeded', to_jsonb(succeeded), 'failed', to_jsonb(failed));
END;
$function$;

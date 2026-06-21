-- ─────────────────────────────────────────────────────────────────────────────
-- M-135  Bulk check-in: capacity is ALL-OR-NOTHING (no silent partial fill)
--
-- Before: qc_register_sub_lots_in_dryer_bulk looped per cart and pushed any cart
-- that would exceed capacity into `failed` (reason 'over_capacity') while still
-- checking in the ones that fit — silently filling the first N carts. The front
-- end never surfaced these failures, so the operator got no feedback.
--
-- After: a pre-flight pass sums the units of all *eligible* carts (found +
-- check-in-able status). If the dryer can't hold them ALL, the whole call is
-- rejected with `OVER_CAPACITY|free=..|need=..|carts=..` and NOTHING is checked
-- in — the operator re-selects fewer carts. Per-cart not_found / wrong_status are
-- still reported individually (they don't abort the batch).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.qc_register_sub_lots_in_dryer_bulk(p_sub_lot_ids uuid[], p_dryer_number integer, p_in_time timestamp with time zone DEFAULT NULL::timestamp with time zone)
returns jsonb language plpgsql as $function$
DECLARE
    in_t timestamptz := COALESCE(p_in_time, now());
    sub_id uuid;
    s qc_drying_sub_lot%ROWTYPE;
    cap numeric := qc_dryer_capacity(p_dryer_number);
    used numeric := qc_dryer_used_units(p_dryer_number);
    eligible_units numeric := 0;
    eligible_count integer := 0;
    requested integer := array_length(p_sub_lot_ids, 1);
    succeeded jsonb := '[]'::jsonb;
    failed jsonb := '[]'::jsonb;
BEGIN
    IF p_dryer_number IS NULL OR NOT EXISTS (SELECT 1 FROM qc_dry_room WHERE dryer_number = p_dryer_number) THEN
        RAISE EXCEPTION 'Unknown dryer: %', p_dryer_number;
    END IF;

    -- ── Pass 1: validate + record per-cart skips + sum eligible units ─────────
    FOREACH sub_id IN ARRAY p_sub_lot_ids LOOP
        SELECT * INTO s FROM qc_drying_sub_lot WHERE id = sub_id FOR UPDATE;
        IF NOT FOUND THEN
            failed := failed || jsonb_build_array(jsonb_build_object('sub_lot_id', sub_id, 'reason', 'not_found'));
            CONTINUE;
        END IF;
        IF s.status NOT IN ('created', 'awaiting_recheck') THEN
            failed := failed || jsonb_build_array(jsonb_build_object(
                'sub_lot_id', sub_id, 'sub_lot_code', s.sub_lot_code, 'reason', 'wrong_status', 'status', s.status));
            CONTINUE;
        END IF;
        eligible_units := eligible_units + COALESCE(qc_sub_lot_units(sub_id), 1);
        eligible_count := eligible_count + 1;
    END LOOP;

    -- ── All-or-nothing capacity gate: reject everything, fill nothing ─────────
    IF eligible_count > 0 AND used + eligible_units > cap THEN
        RAISE EXCEPTION 'OVER_CAPACITY|free=%|need=%|carts=%', GREATEST(cap - used, 0), eligible_units, eligible_count
            USING ERRCODE = 'check_violation';
    END IF;

    -- ── Pass 2: check in every eligible cart (guaranteed to fit) ──────────────
    FOREACH sub_id IN ARRAY p_sub_lot_ids LOOP
        SELECT * INTO s FROM qc_drying_sub_lot WHERE id = sub_id FOR UPDATE;
        IF NOT FOUND THEN CONTINUE; END IF;                       -- already in failed
        IF s.status NOT IN ('created', 'awaiting_recheck') THEN CONTINUE; END IF;

        UPDATE qc_drying_sub_lot
        SET location_id = NULL, dryer_number = p_dryer_number,
            in_time = COALESCE(s.in_time, in_t), status = 'drying', updated_at = now()
        WHERE id = sub_id;

        INSERT INTO qc_sub_lot_spot_history (drying_sub_lot_id, location_id, dryer_number, cell_number, started_at)
        VALUES (sub_id, NULL, p_dryer_number, NULL, in_t);

        INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
        VALUES (sub_id,
                CASE WHEN s.status = 'awaiting_recheck' THEN 'resume_drying' ELSE 'check_in' END,
                jsonb_build_object('sub_lot_code', s.sub_lot_code, 'in_time', in_t,
                    'dryer_number', p_dryer_number, 'cell_number', NULL, 'mode', 'no_spot',
                    'previous_status', s.status),
                auth.uid());

        succeeded := succeeded || jsonb_build_array(jsonb_build_object(
            'sub_lot_id', sub_id, 'sub_lot_code', s.sub_lot_code));
    END LOOP;

    RETURN jsonb_build_object('dryer_number', p_dryer_number,
        'requested', COALESCE(requested, 0), 'succeeded', succeeded, 'failed', failed);
END;
$function$;

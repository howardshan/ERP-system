-- ─────────────────────────────────────────────────────────────────────────────
-- M-126  Data-driven dry rooms (no more hardcoded 1..5)
--
-- Dryers are now whatever exists in qc_dry_room — add/remove rooms freely.
--  * Seed rooms up to 16 (capacity 100 each).
--  * qc_dry_room_summary now enumerates from qc_dry_room and reports CAPACITY
--    (units) instead of physical cell counts.
--  * check-in / move validate the dryer against qc_dry_room existence instead of
--    a hardcoded 1..5 range.
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.qc_dry_room (dryer_number, capacity)
select g, 100 from generate_series(1, 16) g
on conflict (dryer_number) do nothing;

-- ── Summary: enumerate from qc_dry_room, capacity-based (units) ───────────────
create or replace function public.qc_dry_room_summary()
returns jsonb language sql stable as $function$
  with used as (
    select coalesce(s.dryer_number, l.dryer_number) as dn,
           sum(coalesce(ps.cart_units, 1)) filter (where s.status in ('drying','pending','inspecting','hold','disposing')) as used_units,
           count(s.id) filter (where s.status = 'drying') as drying_count,
           min(s.in_time + (s.expected_dry_minutes * interval '1 minute'))
             filter (where s.status = 'drying' and s.expected_dry_minutes is not null) as next_finish_at
    from qc_drying_sub_lot s
    left join qc_drying_location l on l.id = s.location_id
    left join qc_production_lot pl on pl.id = s.production_lot_id
    left join qc_product_sku ps on ps.id = pl.sku_id
    where coalesce(s.dryer_number, l.dryer_number) is not null
    group by coalesce(s.dryer_number, l.dryer_number)
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'dryer_number',    r.dryer_number,
      'total_cells',     r.capacity,                              -- now = capacity (units)
      'occupied_count',  coalesce(u.used_units, 0),
      'available_count', r.capacity - coalesce(u.used_units, 0),
      'drying_count',    coalesce(u.drying_count, 0),
      'next_finish_at',  u.next_finish_at
    ) order by r.dryer_number
  ), '[]'::jsonb)
  from qc_dry_room r
  left join used u on u.dn = r.dryer_number;
$function$;

-- ── Bulk check-in: validate dryer via qc_dry_room (not 1..5) ──────────────────
create or replace function public.qc_register_sub_lots_in_dryer_bulk(p_sub_lot_ids uuid[], p_dryer_number integer, p_in_time timestamp with time zone DEFAULT NULL::timestamp with time zone)
returns jsonb language plpgsql as $function$
DECLARE
    in_t timestamptz := COALESCE(p_in_time, now());
    sub_id uuid;
    s qc_drying_sub_lot%ROWTYPE;
    cap numeric := qc_dryer_capacity(p_dryer_number);
    used numeric := qc_dryer_used_units(p_dryer_number);
    v_units numeric;
    requested integer := array_length(p_sub_lot_ids, 1);
    succeeded jsonb := '[]'::jsonb;
    failed jsonb := '[]'::jsonb;
BEGIN
    IF p_dryer_number IS NULL OR NOT EXISTS (SELECT 1 FROM qc_dry_room WHERE dryer_number = p_dryer_number) THEN
        RAISE EXCEPTION 'Unknown dryer: %', p_dryer_number;
    END IF;

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

        v_units := COALESCE(qc_sub_lot_units(sub_id), 1);
        IF used + v_units > cap THEN
            failed := failed || jsonb_build_array(jsonb_build_object(
                'sub_lot_id', sub_id, 'sub_lot_code', s.sub_lot_code,
                'reason', 'over_capacity', 'capacity', cap, 'used', used, 'cart_units', v_units));
            CONTINUE;
        END IF;

        UPDATE qc_drying_sub_lot
        SET location_id = NULL, dryer_number = p_dryer_number,
            in_time = COALESCE(s.in_time, in_t), status = 'drying', updated_at = now()
        WHERE id = sub_id;
        used := used + v_units;

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

-- ── Move: validate target dryer via qc_dry_room (not 1..5) ────────────────────
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
BEGIN
    IF NOT EXISTS (SELECT 1 FROM qc_dry_room WHERE dryer_number = p_new_dryer_number) THEN
        RAISE EXCEPTION 'Unknown dryer: %', p_new_dryer_number;
    END IF;

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

        v_units := COALESCE(qc_sub_lot_units(sid), 1);
        IF used + v_units > cap THEN
            failed := failed || jsonb_build_object('sub_lot_id', sid, 'sub_lot_code', s.sub_lot_code,
                'reason', 'over_capacity', 'capacity', cap, 'used', used, 'cart_units', v_units); CONTINUE;
        END IF;

        UPDATE qc_drying_sub_lot SET dryer_number = p_new_dryer_number, location_id = NULL, updated_at = now() WHERE id = sid;
        used := used + v_units;

        INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
        VALUES (sid, 'move_dryer', jsonb_build_object('old_dryer', old_dryer, 'new_dryer', p_new_dryer_number), auth.uid());

        succeeded := succeeded || jsonb_build_object('sub_lot_id', sid, 'sub_lot_code', s.sub_lot_code,
            'old_dryer', old_dryer, 'new_dryer', p_new_dryer_number);
    END LOOP;

    RETURN jsonb_build_object('requested', COALESCE(array_length(p_sub_lot_ids, 1), 0),
        'succeeded', to_jsonb(succeeded), 'failed', to_jsonb(failed));
END;
$function$;

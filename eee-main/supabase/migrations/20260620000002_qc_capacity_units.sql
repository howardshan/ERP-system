-- ─────────────────────────────────────────────────────────────────────────────
-- M-125  Capacity-enforced check-in + per-product cart units
--
-- * Each product (qc_product_sku) gets `cart_units` — how many capacity units one
--   physical cart of that product consumes (e.g. 1 or 1.5).
-- * Dryer check-in / move now ENFORCE the room capacity (qc_dry_room.capacity),
--   counted in units (sum of each cart's product cart_units). A cart is rejected
--   when it would push the room over capacity.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.qc_product_sku
  add column if not exists cart_units numeric(6,2) not null default 1 check (cart_units > 0);

-- ── qc_list_products: expose cart_units ──────────────────────────────────────
create or replace function public.qc_list_products()
returns jsonb language sql stable as $function$
    select coalesce(jsonb_agg(
        jsonb_build_object(
            'id', sku.id, 'code', sku.code, 'name', sku.name,
            'standard_drying_minutes', sku.standard_drying_minutes,
            'sample_every_n_carts', sku.sample_every_n_carts,
            'cart_units', sku.cart_units,
            'templates', coalesce((
                select jsonb_agg(jsonb_build_object(
                    'id', t.id, 'sku_id', t.sku_id, 'test_type_id', t.test_type_id,
                    'item_name', coalesce(tt.name, t.item_name), 'unit', coalesce(tt.unit, t.unit),
                    'lower_limit', t.lower_limit, 'upper_limit', t.upper_limit,
                    'soft_lower_limit', t.soft_lower_limit, 'soft_upper_limit', t.soft_upper_limit
                ) order by t.created_at)
                from qc_inspection_template t
                left join qc_test_type tt on tt.id = t.test_type_id
                where t.sku_id = sku.id
            ), '[]'::jsonb)
        ) order by sku.code
    ), '[]'::jsonb)
    from qc_product_sku sku;
$function$;

-- ── helpers: a cart's unit weight, a dryer's used units & capacity ────────────
create or replace function public.qc_sub_lot_units(p_sub_lot_id uuid)
returns numeric language sql stable as $function$
  select coalesce(ps.cart_units, 1)
    from qc_drying_sub_lot dsl
    join qc_production_lot pl on pl.id = dsl.production_lot_id
    join qc_product_sku ps on ps.id = pl.sku_id
   where dsl.id = p_sub_lot_id;
$function$;

create or replace function public.qc_dryer_used_units(p_dryer_number integer)
returns numeric language sql stable as $function$
  select coalesce(sum(coalesce(ps.cart_units, 1)), 0)
    from qc_drying_sub_lot dsl
    join qc_production_lot pl on pl.id = dsl.production_lot_id
    join qc_product_sku ps on ps.id = pl.sku_id
   where coalesce(dsl.dryer_number,
           (select l.dryer_number from qc_drying_location l where l.id = dsl.location_id)) = p_dryer_number
     and dsl.status in ('drying','pending','inspecting','hold','disposing');
$function$;

create or replace function public.qc_dryer_capacity(p_dryer_number integer)
returns numeric language sql stable as $function$
  select coalesce((select capacity from qc_dry_room where dryer_number = p_dryer_number), 0);
$function$;

-- ── Bulk check-in: capacity-enforced, unit-based, per-cart ───────────────────
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
    IF p_dryer_number IS NULL OR p_dryer_number NOT BETWEEN 1 AND 5 THEN
        RAISE EXCEPTION 'Invalid dryer_number: %', p_dryer_number;
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

-- ── Move between dryers: capacity-enforced on the target ─────────────────────
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
    IF p_new_dryer_number < 1 OR p_new_dryer_number > 5 THEN
        RAISE EXCEPTION 'Invalid dryer_number: % (must be 1..5)', p_new_dryer_number;
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

-- ── Single cell placement: capacity-enforced on the cell's dryer ─────────────
create or replace function public.qc_register_in_dryer(p_sub_lot_id uuid, p_location_id uuid, p_in_time timestamp with time zone DEFAULT NULL::timestamp with time zone)
returns jsonb language plpgsql as $function$
DECLARE
    s qc_drying_sub_lot%ROWTYPE;
    in_t timestamptz := COALESCE(p_in_time, now());
    loc qc_drying_location%ROWTYPE;
    cap numeric;
    used numeric;
    v_units numeric;
BEGIN
    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sub-lot not found'; END IF;
    IF s.status NOT IN ('created', 'awaiting_recheck') THEN
        RAISE EXCEPTION 'Sub-lot is not awaiting check-in (status=%)', s.status;
    END IF;

    SELECT * INTO loc FROM qc_drying_location WHERE id = p_location_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Dryer cell not found'; END IF;

    IF EXISTS (SELECT 1 FROM qc_drying_sub_lot WHERE location_id = p_location_id AND id <> p_sub_lot_id
               AND status IN ('drying','pending','inspecting','hold','disposing')) THEN
        RAISE EXCEPTION 'Dryer cell % is already occupied', loc.code;
    END IF;

    cap := qc_dryer_capacity(loc.dryer_number);
    used := qc_dryer_used_units(loc.dryer_number);
    v_units := COALESCE(qc_sub_lot_units(p_sub_lot_id), 1);
    IF used + v_units > cap THEN
        RAISE EXCEPTION 'Dryer % is full (capacity %, used %, this cart %)', loc.dryer_number, cap, used, v_units;
    END IF;

    UPDATE qc_drying_sub_lot SET location_id = p_location_id, in_time = COALESCE(s.in_time, in_t), status = 'drying', updated_at = now()
    WHERE id = p_sub_lot_id;

    INSERT INTO qc_sub_lot_spot_history (drying_sub_lot_id, location_id, dryer_number, cell_number, started_at)
    VALUES (p_sub_lot_id, p_location_id, loc.dryer_number, loc.cell_number, in_t);

    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    VALUES (p_sub_lot_id,
            CASE WHEN s.status = 'awaiting_recheck' THEN 'resume_drying' ELSE 'check_in' END,
            jsonb_build_object('sub_lot_code', s.sub_lot_code, 'in_time', in_t,
                'dryer_number', loc.dryer_number, 'cell_number', loc.cell_number,
                'location_code', loc.code, 'previous_status', s.status),
            auth.uid());

    RETURN qc_sub_lot_to_json(p_sub_lot_id);
END;
$function$;

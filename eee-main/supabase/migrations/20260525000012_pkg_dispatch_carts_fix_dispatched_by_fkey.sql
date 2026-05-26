-- M-091: Fix `pkg_dispatch_carts.dispatched_by` FK violation.
--
-- `pkg_outbound.dispatched_by uuid REFERENCES erp_user(id)` (M-067), but
-- the function was inserting `auth.uid()` directly.  `auth.uid()` returns
-- the auth.users(id) UUID; the `erp_user(id)` UUID is a different value
-- linked via `erp_user.auth_user_id` (M-010 link table).
--
-- Result: every dispatch attempt fails with
--   ERROR: insert or update on table "pkg_outbound" violates foreign key
--          constraint "pkg_outbound_dispatched_by_fkey"
--
-- Fix: look up the dispatcher's `erp_user.id` from `auth.uid()` via the
-- `auth_user_id` column before insert.  Column is nullable, so unauthenticated
-- contexts (no auth.uid()) cleanly leave it NULL instead of breaking.

CREATE OR REPLACE FUNCTION pkg_dispatch_carts(
  p_sub_lot_ids uuid[],
  p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  outbound_id     int;
  sub_id          uuid;
  s               qc_drying_sub_lot%ROWTYPE;
  sku_id_val      uuid;
  success_count   int := 0;
  days_val        int;
  dispatched_ids  uuid[] := '{}';
  dispatcher_id   uuid;
BEGIN
  IF array_length(p_sub_lot_ids, 1) IS NULL OR array_length(p_sub_lot_ids, 1) = 0 THEN
    RAISE EXCEPTION 'No carts selected';
  END IF;

  -- Resolve the dispatcher's erp_user.id from the auth context.  NULL is
  -- acceptable (the column allows NULL) — only a fake/missing erp_user
  -- row would trip the FK.
  SELECT id INTO dispatcher_id
  FROM erp_user
  WHERE auth_user_id = auth.uid();

  -- Determine SKU from the first cart.
  SELECT lot.sku_id INTO sku_id_val
  FROM qc_drying_sub_lot s2
  JOIN qc_production_lot lot ON lot.id = s2.production_lot_id
  WHERE s2.id = p_sub_lot_ids[1];

  INSERT INTO pkg_outbound (sku_id, cart_count, note, dispatched_by)
  VALUES (sku_id_val, array_length(p_sub_lot_ids, 1), p_note, dispatcher_id)
  RETURNING id INTO outbound_id;

  FOREACH sub_id IN ARRAY p_sub_lot_ids LOOP
    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = sub_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF s.status <> 'closed' THEN
      RAISE EXCEPTION 'Cart % is not in packaging (status=%)', s.sub_lot_code, s.status;
    END IF;

    days_val := EXTRACT(DAY FROM now() - COALESCE(s.released_at, s.updated_at))::int;

    UPDATE qc_drying_sub_lot SET status = 'dispatched', updated_at = now() WHERE id = sub_id;

    INSERT INTO pkg_outbound_item (outbound_id, sub_lot_id, sub_lot_code, days_in_stock)
    VALUES (outbound_id, sub_id, s.sub_lot_code, days_val);

    success_count := success_count + 1;
    dispatched_ids := dispatched_ids || sub_id;
  END LOOP;

  UPDATE pkg_outbound SET cart_count = success_count WHERE id = outbound_id;

  RETURN jsonb_build_object(
    'outbound_id',     outbound_id,
    'cart_count',      success_count,
    'dispatched_ids',  to_jsonb(dispatched_ids)
  );
END;
$$;

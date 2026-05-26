-- M-090: Fix `pkg_dispatch_carts` two latent PL/pgSQL bugs.
--
-- Bug 1 — `column reference "lot.id" is ambiguous`:
--   The function declared a local variable `lot qc_production_lot%ROWTYPE`
--   AND used `lot` as a table alias in the SQL inside the function body.
--   PL/pgSQL's variable scope clashes with the SQL alias scope, so
--   `lot.id` is genuinely ambiguous.  Postgres validates this on first
--   actual execution (the SQL is parsed lazily), which is why the bug only
--   surfaced today after M-082 left some carts in 'closed' state and the
--   user clicked Dispatch for the first time.
--
-- Bug 2 — silent no-op UPDATE:
--     UPDATE pkg_outbound SET cart_count = cart_count WHERE id = outbound_id
--   This was meant to overwrite the initial (optimistic) count with the
--   real successful count, but PL/pgSQL resolves both sides of the SET to
--   the *column* `cart_count`, not the local variable.  Net effect: the
--   row keeps the initial array_length() value even when some carts were
--   skipped mid-loop.
--
-- Fix:
--   - Drop the unused `lot qc_production_lot%ROWTYPE` local; the SQL alias
--     keeps the same name (`lot`) and is no longer shadowed.
--   - Rename the success counter variable from `cart_count` →
--     `success_count` so the UPDATE assigns the variable, not the column.

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
BEGIN
  IF array_length(p_sub_lot_ids, 1) IS NULL OR array_length(p_sub_lot_ids, 1) = 0 THEN
    RAISE EXCEPTION 'No carts selected';
  END IF;

  -- Determine SKU from the first cart.  `lot` here is just a SQL alias,
  -- no longer shadowed by a PL/pgSQL variable.
  SELECT lot.sku_id INTO sku_id_val
  FROM qc_drying_sub_lot s2
  JOIN qc_production_lot lot ON lot.id = s2.production_lot_id
  WHERE s2.id = p_sub_lot_ids[1];

  INSERT INTO pkg_outbound (sku_id, cart_count, note, dispatched_by)
  VALUES (sku_id_val, array_length(p_sub_lot_ids, 1), p_note, auth.uid())
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

  -- Now the assignment actually overwrites the column with the variable.
  UPDATE pkg_outbound SET cart_count = success_count WHERE id = outbound_id;

  RETURN jsonb_build_object(
    'outbound_id',     outbound_id,
    'cart_count',      success_count,
    'dispatched_ids',  to_jsonb(dispatched_ids)
  );
END;
$$;

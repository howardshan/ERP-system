-- Add released_at column to track when QC released the cart
ALTER TABLE qc_drying_sub_lot ADD COLUMN IF NOT EXISTS released_at timestamptz;

-- Add 'dispatched' to status enum
ALTER TABLE qc_drying_sub_lot DROP CONSTRAINT qc_drying_sub_lot_status_check;
ALTER TABLE qc_drying_sub_lot ADD CONSTRAINT qc_drying_sub_lot_status_check
  CHECK (status IN (
    'created','drying','awaiting_recheck','room_temp_drying',
    'pending','inspecting','passed','hold','disposing','closed',
    'awaiting_group_result','dispatched'
  ));

-- Update qc_release_passed_sub_lot to set released_at
CREATE OR REPLACE FUNCTION qc_release_passed_sub_lot(p_sub_lot_id uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE s qc_drying_sub_lot%ROWTYPE;
BEGIN
  SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sub-lot not found'; END IF;
  IF s.status <> 'passed' THEN
    RAISE EXCEPTION 'Cannot release: sub-lot status is %, expected passed', s.status;
  END IF;
  UPDATE qc_drying_sub_lot
  SET status = 'closed', released_at = now(), updated_at = now()
  WHERE id = p_sub_lot_id;
  INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
  VALUES (p_sub_lot_id, 'released',
          jsonb_build_object('sub_lot_code', s.sub_lot_code, 'released_at', now()),
          auth.uid());
  RETURN qc_sub_lot_to_json(p_sub_lot_id);
END;
$$;

-- pkg_outbound: one record per dispatch event
CREATE TABLE pkg_outbound (
  id            serial PRIMARY KEY,
  sku_id        uuid NOT NULL REFERENCES qc_product_sku(id),
  cart_count    int NOT NULL,
  note          text,
  dispatched_by uuid REFERENCES erp_user(id),
  dispatched_at timestamptz DEFAULT now(),
  created_at    timestamptz DEFAULT now()
);
ALTER TABLE pkg_outbound ENABLE ROW LEVEL SECURITY;
CREATE POLICY dev_all ON pkg_outbound FOR ALL USING (true) WITH CHECK (true);

-- pkg_outbound_item: individual carts per dispatch
CREATE TABLE pkg_outbound_item (
  id             serial PRIMARY KEY,
  outbound_id    int NOT NULL REFERENCES pkg_outbound(id) ON DELETE CASCADE,
  sub_lot_id     uuid NOT NULL REFERENCES qc_drying_sub_lot(id),
  sub_lot_code   text NOT NULL,
  days_in_stock  int NOT NULL
);
ALTER TABLE pkg_outbound_item ENABLE ROW LEVEL SECURITY;
CREATE POLICY dev_all ON pkg_outbound_item FOR ALL USING (true) WITH CHECK (true);

-- pkg_available_carts: carts ready for packaging (closed, not yet dispatched), FIFO
CREATE OR REPLACE FUNCTION pkg_available_carts(p_sku_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(row ORDER BY (row->>'released_at') ASC)
    FROM (
      SELECT jsonb_build_object(
        'id',            s.id,
        'sub_lot_code',  s.sub_lot_code,
        'lot_number',    lot.lot_number,
        'work_order_barcode', lot.work_order_barcode,
        'sku_id',        lot.sku_id,
        'sku_name',      sku.name,
        'sku_code',      sku.code,
        'released_at',   COALESCE(s.released_at, s.updated_at),
        'days_in_stock', EXTRACT(DAY FROM now() - COALESCE(s.released_at, s.updated_at))::int
      ) AS row
      FROM qc_drying_sub_lot s
      JOIN qc_production_lot lot ON lot.id = s.production_lot_id
      JOIN qc_product_sku sku ON sku.id = lot.sku_id
      WHERE s.status = 'closed'
        AND (p_sku_id IS NULL OR lot.sku_id = p_sku_id)
      ORDER BY COALESCE(s.released_at, s.updated_at) ASC
    ) sub
  ), '[]'::jsonb);
END;
$$;

-- pkg_skus_with_stock: SKUs that currently have carts available for packaging
CREATE OR REPLACE FUNCTION pkg_skus_with_stock()
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'sku_id',    sku.id,
      'sku_name',  sku.name,
      'sku_code',  sku.code,
      'cart_count', COUNT(s.id)
    ) ORDER BY sku.name)
    FROM qc_drying_sub_lot s
    JOIN qc_production_lot lot ON lot.id = s.production_lot_id
    JOIN qc_product_sku sku ON sku.id = lot.sku_id
    WHERE s.status = 'closed'
    GROUP BY sku.id, sku.name, sku.code
  ), '[]'::jsonb);
END;
$$;

-- pkg_dispatch_carts: dispatch selected carts out
CREATE OR REPLACE FUNCTION pkg_dispatch_carts(
  p_sub_lot_ids uuid[],
  p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  outbound_id int;
  sub_id uuid;
  s qc_drying_sub_lot%ROWTYPE;
  lot qc_production_lot%ROWTYPE;
  sku_id_val uuid;
  cart_count int := 0;
  days_val int;
  dispatched_ids uuid[] := '{}';
BEGIN
  IF array_length(p_sub_lot_ids, 1) IS NULL OR array_length(p_sub_lot_ids, 1) = 0 THEN
    RAISE EXCEPTION 'No carts selected';
  END IF;

  -- Determine SKU from first cart
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

    cart_count := cart_count + 1;
    dispatched_ids := dispatched_ids || sub_id;
  END LOOP;

  UPDATE pkg_outbound SET cart_count = cart_count WHERE id = outbound_id;

  RETURN jsonb_build_object(
    'outbound_id', outbound_id,
    'cart_count', cart_count,
    'dispatched_ids', to_jsonb(dispatched_ids)
  );
END;
$$;

-- pkg_inventory_summary: for QC Home chart (per SKU, days-in-stock bucketed)
CREATE OR REPLACE FUNCTION pkg_inventory_summary()
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'sku_id',    sku.id,
      'sku_name',  sku.name,
      'sku_code',  sku.code,
      'total',     COUNT(s.id),
      'green',     COUNT(s.id) FILTER (WHERE EXTRACT(DAY FROM now() - COALESCE(s.released_at, s.updated_at)) < 10),
      'yellow',    COUNT(s.id) FILTER (WHERE EXTRACT(DAY FROM now() - COALESCE(s.released_at, s.updated_at)) BETWEEN 10 AND 14),
      'red',       COUNT(s.id) FILTER (WHERE EXTRACT(DAY FROM now() - COALESCE(s.released_at, s.updated_at)) >= 15)
    ) ORDER BY sku.name)
    FROM qc_drying_sub_lot s
    JOIN qc_production_lot lot ON lot.id = s.production_lot_id
    JOIN qc_product_sku sku ON sku.id = lot.sku_id
    WHERE s.status = 'closed'
    GROUP BY sku.id, sku.name, sku.code
  ), '[]'::jsonb);
END;
$$;

-- Module access + permissions for dev users
INSERT INTO user_module_access (user_id, module_id)
SELECT eu.id, 'packaging'
FROM erp_user eu
WHERE eu.email IN ('ysha@smu.edu', 'shayiqing16@gmail.com')
ON CONFLICT DO NOTHING;

INSERT INTO user_permission_grant (user_id, module_id, resource, permission, approval_limit)
SELECT eu.id, 'packaging', p.resource, p.permission, NULL
FROM erp_user eu
CROSS JOIN (VALUES
  ('outbound', 'view'),
  ('outbound', 'dispatch')
) AS p(resource, permission)
WHERE eu.email IN ('ysha@smu.edu', 'shayiqing16@gmail.com')
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;

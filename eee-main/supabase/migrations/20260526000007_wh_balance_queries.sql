-- M-104: Warehouse read queries — balance & transactions (Warehouse S1)
-- Read-only; LANGUAGE sql STABLE (no SECURITY DEFINER needed).

CREATE OR REPLACE FUNCTION wh_list_balance(
    p_location_id bigint DEFAULT NULL,
    p_item_id     bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE
AS $$
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'item_id',            b.item_id,
            'item_sku',           i.sku,
            'item_name',          i.name,
            'lot_id',             b.lot_id,
            'lot_number',         l.lot_number,
            'lot_status',         l.status,
            'expiry_date',        l.expiry_date,
            'location_id',        b.location_id,
            'location_code',      loc.code,
            'location_type',      loc.location_type,
            'quantity_on_hand',   b.quantity_on_hand,
            'quantity_allocated', b.quantity_allocated,
            'quantity_available', b.quantity_on_hand - b.quantity_allocated,
            'base_uom',           u.code
        ) ORDER BY i.sku, loc.code, l.lot_number
    ), '[]'::jsonb)
    FROM inventory_balance b
    JOIN item i        ON i.id = b.item_id
    LEFT JOIN lot l    ON l.id = b.lot_id
    JOIN location loc  ON loc.id = b.location_id
    JOIN uom u         ON u.id = i.base_uom_id
    WHERE (p_location_id IS NULL OR b.location_id = p_location_id)
      AND (p_item_id     IS NULL OR b.item_id     = p_item_id)
      AND b.quantity_on_hand <> 0;
$$;

CREATE OR REPLACE FUNCTION wh_list_transactions(
    p_item_id     bigint DEFAULT NULL,
    p_lot_id      bigint DEFAULT NULL,
    p_location_id bigint DEFAULT NULL,
    p_limit       int    DEFAULT 200
) RETURNS jsonb
LANGUAGE sql STABLE
AS $$
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id',               t.id,
            'transaction_date', t.transaction_date,
            'item_sku',         i.sku,
            'item_name',        i.name,
            'lot_number',       l.lot_number,
            'location_code',    loc.code,
            'quantity',         t.quantity,
            'transaction_type', t.transaction_type,
            'unit_cost',        t.unit_cost,
            'reference_type',   t.reference_type,
            'reference_id',     t.reference_id,
            'notes',            t.notes,
            'created_by',       t.created_by
        ) ORDER BY t.transaction_date DESC, t.id DESC
    ), '[]'::jsonb)
    FROM (
        SELECT *
        FROM inventory_transaction
        WHERE (p_item_id     IS NULL OR item_id     = p_item_id)
          AND (p_lot_id      IS NULL OR lot_id      = p_lot_id)
          AND (p_location_id IS NULL OR location_id = p_location_id)
        ORDER BY transaction_date DESC, id DESC
        LIMIT p_limit
    ) t
    JOIN item i       ON i.id = t.item_id
    LEFT JOIN lot l   ON l.id = t.lot_id
    JOIN location loc ON loc.id = t.location_id;
$$;

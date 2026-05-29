-- M-111: wh_list_balance — status-aware "quantity_available"
--
-- Problem surfaced in S3 testing: rejected/expired lots still showed full
-- "可用" quantity because the available field was `on_hand - allocated`
-- regardless of lot.status. The rollup "生鸡胸肉 可用 510 KG" was misleading
-- when 250 KG of it was rejected/expired and BR-W4 would block any outbound.
--
-- Fix: only lot.status='available' counts toward usable stock. Other statuses
-- (quarantine awaiting QC, on_hold/rejected/expired/consumed) show 0 available
-- even when quantity_on_hand > 0. UI can now display the "可用 vs 在库" gap.
--
-- `quantity_on_hand` stays as the physical count (no semantic change).
-- Same signature as M-104, so this is a pure body swap. Idempotent.

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
            -- status-aware: only released lots count toward usable stock
            'quantity_available', CASE
                WHEN l.status = 'available'
                  THEN b.quantity_on_hand - b.quantity_allocated
                ELSE 0
            END,
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

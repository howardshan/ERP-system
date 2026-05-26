-- M-092: Work-order-level packaging assignment.
--
-- Operator decision (2026-05-25): a work order packs into ONE packaging
-- spec — keep the model simple, one column on qc_production_lot pointing
-- to item.id (item_type='packaging').  No junction table for now.
--
-- Steps:
--   1. Seed 3 standard packaging items into `item` (Bag 500g / Bag 1kg /
--      Carton 5kg).  Idempotent via INSERT … ON CONFLICT (sku) DO NOTHING.
--   2. Add nullable `qc_production_lot.packaging_item_id` FK to item(id).
--   3. Round-robin assign one of the 3 packagings to every existing work
--      order that doesn't have a packaging yet (so the demo lights up).
--   4. Refresh `pkg_available_carts` so the cart-list RPC returns the
--      packaging label per cart (frontend can group + display).

-- ── 1) Seed packaging items ────────────────────────────────────────────────
INSERT INTO item (sku, name, item_type, base_uom_id, is_lot_controlled, created_by)
SELECT v.sku, v.name, 'packaging'::text, u.id, false, 'system:M-092'
FROM (VALUES
  ('PKG-BAG-500G',   'Bag 500g',  'BAG'),
  ('PKG-BAG-1KG',    'Bag 1kg',   'BAG'),
  ('PKG-CARTON-5KG', 'Carton 5kg','BOX')
) AS v(sku, name, uom_code)
JOIN uom u ON u.code = v.uom_code
ON CONFLICT (sku) DO NOTHING;

-- ── 2) Add packaging_item_id on qc_production_lot ──────────────────────────
ALTER TABLE qc_production_lot
  ADD COLUMN IF NOT EXISTS packaging_item_id bigint REFERENCES item(id);

CREATE INDEX IF NOT EXISTS idx_qc_production_lot_packaging_item
  ON qc_production_lot(packaging_item_id)
  WHERE packaging_item_id IS NOT NULL;

-- ── 3) Round-robin backfill for existing work orders ──────────────────────
-- Use the lot.id-based row number modulo 3 to spread evenly across the 3
-- seeded packagings.  Only touches lots where packaging_item_id IS NULL so
-- this is safe to re-run.
WITH pkg AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) - 1 AS idx
  FROM item
  WHERE sku IN ('PKG-BAG-500G', 'PKG-BAG-1KG', 'PKG-CARTON-5KG')
),
lots_to_assign AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) - 1 AS rn
  FROM qc_production_lot
  WHERE packaging_item_id IS NULL
)
UPDATE qc_production_lot pl
SET packaging_item_id = (
  SELECT pkg.id FROM pkg
  WHERE pkg.idx = (lots_to_assign.rn % 3)
)
FROM lots_to_assign
WHERE pl.id = lots_to_assign.id;

-- ── 4) Expose packaging on pkg_available_carts ─────────────────────────────
-- Frontend wants to group carts by work order and show the packaging label
-- on each group header.  Adding `packaging_id` / `packaging_name` to every
-- cart row keeps the RPC shape backward compatible (frontend groups by
-- work_order_barcode locally).

CREATE OR REPLACE FUNCTION pkg_available_carts(p_sku_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(row ORDER BY (row->>'released_at') ASC)
    FROM (
      SELECT jsonb_build_object(
        'id',                 s.id,
        'sub_lot_code',       s.sub_lot_code,
        'lot_number',         lot.lot_number,
        'work_order_barcode', lot.work_order_barcode,
        'sku_id',             lot.sku_id,
        'sku_name',           sku.name,
        'sku_code',           sku.code,
        'packaging_id',       pkg.id,
        'packaging_sku',      pkg.sku,
        'packaging_name',     pkg.name,
        'released_at',        COALESCE(s.released_at, s.updated_at),
        'days_in_stock',      EXTRACT(DAY FROM now() - COALESCE(s.released_at, s.updated_at))::int
      ) AS row
      FROM qc_drying_sub_lot s
      JOIN qc_production_lot lot ON lot.id = s.production_lot_id
      JOIN qc_product_sku sku    ON sku.id = lot.sku_id
      LEFT JOIN item pkg         ON pkg.id = lot.packaging_item_id
      WHERE s.status = 'closed'
        AND (p_sku_id IS NULL OR lot.sku_id = p_sku_id)
      ORDER BY COALESCE(s.released_at, s.updated_at) ASC
    ) sub
  ), '[]'::jsonb);
END;
$$;

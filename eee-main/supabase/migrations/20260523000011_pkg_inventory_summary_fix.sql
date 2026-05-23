-- Migration: fix pkg_inventory_summary to handle multiple SKUs without
-- erroring with "more than one row returned by a subquery used as an
-- expression". The original used GROUP BY sku inside a scalar subquery, which
-- only worked when at most 1 SKU had closed carts. Wrap with a CTE so the
-- outer SELECT does a single jsonb_agg over all SKUs.

CREATE OR REPLACE FUNCTION pkg_inventory_summary()
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(row ORDER BY row->>'sku_name')
    FROM (
      SELECT jsonb_build_object(
        'sku_id',    sku.id,
        'sku_name',  sku.name,
        'sku_code',  sku.code,
        'total',     COUNT(s.id),
        'green',     COUNT(s.id) FILTER (WHERE EXTRACT(DAY FROM now() - COALESCE(s.released_at, s.updated_at)) <  10),
        'yellow',    COUNT(s.id) FILTER (WHERE EXTRACT(DAY FROM now() - COALESCE(s.released_at, s.updated_at)) BETWEEN 10 AND 14),
        'red',       COUNT(s.id) FILTER (WHERE EXTRACT(DAY FROM now() - COALESCE(s.released_at, s.updated_at)) >= 15)
      ) AS row
      FROM qc_drying_sub_lot s
      JOIN qc_production_lot lot ON lot.id = s.production_lot_id
      JOIN qc_product_sku    sku ON sku.id = lot.sku_id
      WHERE s.status = 'closed'
      GROUP BY sku.id, sku.name, sku.code
    ) sub
  ), '[]'::jsonb);
END;
$$;

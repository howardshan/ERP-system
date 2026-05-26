-- M-084: Fix `pkg_skus_with_stock` nested-aggregate error.
--
-- Original (M-067) wrote:
--   SELECT jsonb_agg(jsonb_build_object(..., COUNT(s.id)) ORDER BY sku.name)
--   FROM qc_drying_sub_lot s ...
--   GROUP BY sku.id, sku.name, sku.code
--
-- jsonb_agg() AND COUNT(s.id) are both aggregates and Postgres rejects
-- the call:
--   ERROR: aggregate function calls cannot be nested
--
-- The query "ran" before only because the production DB had zero rows
-- where s.status = 'closed' so the GROUP BY produced no rows and the
-- aggregate never executed.  After M-082 repaired W11111-003/006/007/008
-- to status='closed', actual rows exist and the parser-time error fires.
--
-- Fix: compute the per-SKU COUNT in a CTE, then jsonb_agg over the flat
-- result.  Same shape returned to the frontend (PkgSku[]).

CREATE OR REPLACE FUNCTION pkg_skus_with_stock()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH per_sku AS (
    SELECT sku.id   AS sku_id,
           sku.name AS sku_name,
           sku.code AS sku_code,
           COUNT(s.id)::int AS cart_count
    FROM qc_drying_sub_lot s
    JOIN qc_production_lot lot ON lot.id = s.production_lot_id
    JOIN qc_product_sku sku    ON sku.id = lot.sku_id
    WHERE s.status = 'closed'
    GROUP BY sku.id, sku.name, sku.code
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'sku_id',     sku_id,
        'sku_name',   sku_name,
        'sku_code',   sku_code,
        'cart_count', cart_count
      )
      ORDER BY sku_name
    ),
    '[]'::jsonb
  )
  FROM per_sku;
$$;

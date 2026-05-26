-- M-093: qc_production_pipeline_summary() — per-SKU breakdown of where carts
--        currently sit in the production → packaging pipeline.
--
-- Powers the Production module's new Dashboard.  Buckets:
--   production       — status='created'             (created, not yet placed in dryer)
--   dry_room         — drying | awaiting_recheck | room_temp_drying
--   testing          — pending | inspecting | awaiting_group_result | hold | passed
--                      (anything between check-out and release)
--   released         — status='closed'              (released to packaging, not dispatched)
--   packaged         — status='dispatched'          (already shipped from packaging)
--
-- Only SKUs with at least one cart in any bucket appear.  Ordered by sku.code.

CREATE OR REPLACE FUNCTION qc_production_pipeline_summary()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH counts AS (
    SELECT
      sku.id   AS sku_id,
      sku.code AS sku_code,
      sku.name AS sku_name,
      COUNT(*) FILTER (WHERE s.status = 'created')::int                                                   AS production_count,
      COUNT(*) FILTER (WHERE s.status IN ('drying','awaiting_recheck','room_temp_drying'))::int           AS dry_room_count,
      COUNT(*) FILTER (WHERE s.status IN ('pending','inspecting','awaiting_group_result','hold','passed'))::int AS testing_count,
      COUNT(*) FILTER (WHERE s.status = 'closed')::int                                                    AS released_count,
      COUNT(*) FILTER (WHERE s.status = 'dispatched')::int                                                AS packaged_count
    FROM qc_product_sku sku
    LEFT JOIN qc_production_lot lot ON lot.sku_id = sku.id
    LEFT JOIN qc_drying_sub_lot s   ON s.production_lot_id = lot.id
    GROUP BY sku.id, sku.code, sku.name
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'sku_id',           sku_id,
      'sku_code',         sku_code,
      'sku_name',         sku_name,
      'production_count', production_count,
      'dry_room_count',   dry_room_count,
      'testing_count',    testing_count,
      'released_count',   released_count,
      'packaged_count',   packaged_count,
      'total',            production_count + dry_room_count + testing_count + released_count + packaged_count
    ) ORDER BY sku_code
  ), '[]'::jsonb)
  FROM counts
  WHERE production_count + dry_room_count + testing_count + released_count + packaged_count > 0;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- M-167  Packaging: per-work-order "entered dryer − dispatched" count
--
-- On the Packaging page each work-order row shows how many carts are ready to
-- pack now ("N CART(S)"). Operators also want the denominator: of this WO, how
-- many carts went through drying but haven't shipped yet — so the row can read
-- "N / REMAINING". REMAINING = (unique carts that ever entered a dryer) −
-- (carts already dispatched).
--
-- "Entered a dryer" = the cart has ≥1 qc_sub_lot_spot_history row (every physical
-- dryer placement writes one; robust to redry, unlike the live in_time which is
-- reset on redry). "Dispatched" = qc_drying_sub_lot.status = 'dispatched'.
-- Plain LANGUAGE sql STABLE, default execute for authenticated (matches M-093).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION pkg_wo_dry_dispatch_counts(p_sku_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'work_order_barcode', wo,
    'entered',    entered,
    'dispatched', dispatched,
    'remaining',  GREATEST(entered - dispatched, 0)
  ) ORDER BY wo), '[]'::jsonb)
  FROM (
    SELECT
      pl.work_order_barcode AS wo,
      count(DISTINCT s.id) FILTER (
        WHERE EXISTS (SELECT 1 FROM qc_sub_lot_spot_history h WHERE h.drying_sub_lot_id = s.id)
      )::int AS entered,
      count(DISTINCT s.id) FILTER (WHERE s.status = 'dispatched')::int AS dispatched
    FROM qc_drying_sub_lot s
    JOIN qc_production_lot pl ON pl.id = s.production_lot_id
    WHERE pl.work_order_barcode IS NOT NULL
      AND (p_sku_id IS NULL OR pl.sku_id = p_sku_id)
    GROUP BY pl.work_order_barcode
  ) t;
$$;

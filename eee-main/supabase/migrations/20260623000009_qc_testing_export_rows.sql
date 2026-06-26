-- ─────────────────────────────────────────────────────────────────────────────
-- M-155  Testing data export rows (WA / MC% template)
--
-- Feeds the "Testing Export" page (button next to Daily Report). Returns one row
-- per inspection, filtered by date range + product (SKU) + work order, shaped to
-- the customer's "WA_MC Template.xlsx" columns:
--   Product Description · Date · Item# · WO#/Lot# · Carts#(=sample id) · Mc% · Aw ·
--   Inspector · Test Result · Mc% Standard(Min/Max) · Aw Standard(Min/Max) ·
--   Retest/Accept · Note
--
-- Columns we don't capture (Size, Testing Temp, Humidity, Room Temp, Verification
-- Time, Verify) are left blank by the frontend for manual fill.
--
-- Retest/Accept is derived: a `retest` disposition on the cart → 'Retest';
-- otherwise a released cart (released_at set, or status closed/dispatched) →
-- 'Accept'; otherwise blank.
--
-- Dated by ir.submitted_at (the day the test was performed). MC% / Aw values are
-- pulled from the flattened readings (_qc_flatten_readings) by item-name match;
-- standards come from qc_inspection_template for the cart's SKU.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.qc_testing_export_rows(
  p_sku_id            uuid DEFAULT NULL,
  p_from_date         date DEFAULT NULL,
  p_to_date           date DEFAULT NULL,
  p_production_lot_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'test_date')), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'inspection_id', ir.id,
      'product_name',  sku.name,
      'item_no',       sku.code,
      'test_date',     ir.submitted_at,
      'wo_lot',        COALESCE(NULLIF(btrim(pl.work_order_barcode), ''), pl.lot_barcode),
      'sample_id',     sa.sample_id,
      'sub_lot_code',  sl.sub_lot_code,
      'mc_value', (
        SELECT (r->>'value')::numeric
        FROM jsonb_array_elements(_qc_flatten_readings(ir.values_json)) r
        WHERE lower(r->>'item_name') LIKE '%moist%' OR lower(r->>'item_name') LIKE '%mc%'
        LIMIT 1),
      'aw_value', (
        SELECT (r->>'value')::numeric
        FROM jsonb_array_elements(_qc_flatten_readings(ir.values_json)) r
        WHERE lower(r->>'item_name') LIKE '%water activity%' OR lower(r->>'unit') = 'aw'
        LIMIT 1),
      'testing_temp',  (ir.values_json #>> '{env,testing_temp}')::numeric,
      'humidity',      (ir.values_json #>> '{env,humidity}')::numeric,
      'room_temp',     (ir.values_json #>> '{env,room_temp}')::numeric,
      'inspector',     qc_actor_label(ir.inspector_auth_id),
      'result',        ir.result,
      'mc_min', (SELECT t.lower_limit FROM qc_inspection_template t
                 WHERE t.sku_id = pl.sku_id
                   AND (lower(t.item_name) LIKE '%moist%' OR lower(t.item_name) LIKE '%mc%') LIMIT 1),
      'mc_max', (SELECT t.upper_limit FROM qc_inspection_template t
                 WHERE t.sku_id = pl.sku_id
                   AND (lower(t.item_name) LIKE '%moist%' OR lower(t.item_name) LIKE '%mc%') LIMIT 1),
      'aw_min', (SELECT t.lower_limit FROM qc_inspection_template t
                 WHERE t.sku_id = pl.sku_id
                   AND (lower(t.item_name) LIKE '%water activity%' OR lower(t.unit) = 'aw') LIMIT 1),
      'aw_max', (SELECT t.upper_limit FROM qc_inspection_template t
                 WHERE t.sku_id = pl.sku_id
                   AND (lower(t.item_name) LIKE '%water activity%' OR lower(t.unit) = 'aw') LIMIT 1),
      'retest_accept', CASE
          WHEN EXISTS (SELECT 1 FROM qc_disposition d
                       WHERE d.drying_sub_lot_id = sl.id AND d.type = 'retest') THEN 'Retest'
          WHEN sl.released_at IS NOT NULL OR sl.status IN ('closed', 'dispatched') THEN 'Accept'
          ELSE ''
        END,
      'note',          ir.remark
    ) AS row_data
    FROM qc_inspection_record ir
    JOIN qc_drying_sub_lot sl  ON sl.id = ir.drying_sub_lot_id
    JOIN qc_production_lot  pl  ON pl.id = sl.production_lot_id
    LEFT JOIN qc_product_sku sku ON sku.id = pl.sku_id
    LEFT JOIN qc_sample      sa  ON sa.id  = ir.sample_id
    WHERE (p_sku_id IS NULL OR pl.sku_id = p_sku_id)
      AND (p_production_lot_id IS NULL OR sl.production_lot_id = p_production_lot_id)
      AND (p_from_date IS NULL OR ir.submitted_at >= p_from_date::timestamptz)
      AND (p_to_date   IS NULL OR ir.submitted_at <  (p_to_date + 1)::timestamptz)
  ) t;
$$;

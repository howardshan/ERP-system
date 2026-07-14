-- ─────────────────────────────────────────────────────────────────────────────
-- M-164  Batch Trace search: emit each work order's sub-lot codes
--
-- The Batch Trace list page (TraceListPage) searches client-side over the lots
-- returned by qc_list_production_lots. It can match product name / code and the
-- work-order barcode, but NOT a full drying sub-lot number, because the list RPC
-- never returned the per-cart codes.
--
-- A useful heuristic covered the common case: since M-053, new sub-lot codes are
-- `<work_order_barcode>-NNN`, so stripping the "-NNN" suffix off a query matched
-- the parent work order. But legacy carts created BEFORE M-053 used the
-- lot_barcode prefix (not work_order_barcode); for those the prefix differs and
-- the heuristic misses them.
--
-- FIX: the list RPC now also emits `sub_lot_codes` — a jsonb array of every
-- cart's sub_lot_code for that work order — so the page can match a full sub-lot
-- number directly, regardless of prefix. This is the only change; all other
-- fields (scanned_count / total_count / sku / dates) are unchanged.
--
-- Payload note: this adds one short string per cart per lot. At current volumes
-- (tens of carts per WO) that's negligible; if a lot ever holds thousands of
-- carts this could be narrowed to DISTINCT prefixes, but that's not needed now.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION qc_list_production_lots()
RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', lot.id,
            'lot_number', lot.lot_number,
            'lot_barcode', lot.lot_barcode,
            'work_order_barcode', lot.work_order_barcode,
            'sku_id', lot.sku_id,
            'sku_code', sku.code,
            'sku_name', sku.name,
            'created_at', lot.created_at,
            'scanned_count', (
                SELECT COUNT(*)::int FROM qc_drying_sub_lot s
                WHERE s.production_lot_id = lot.id
                  AND s.scanned_for_check_in_at IS NOT NULL
            ),
            'total_count', (
                SELECT COUNT(*)::int FROM qc_drying_sub_lot s
                WHERE s.production_lot_id = lot.id
            ),
            -- M-164: every cart's code for this WO, so the trace list page can
            -- fuzzy-match a full sub-lot number (incl. legacy divergent prefixes).
            'sub_lot_codes', COALESCE((
                SELECT jsonb_agg(s.sub_lot_code ORDER BY s.sub_lot_code)
                FROM qc_drying_sub_lot s
                WHERE s.production_lot_id = lot.id
            ), '[]'::jsonb)
        ) ORDER BY lot.created_at DESC
    ), '[]'::jsonb)
    FROM qc_production_lot lot
    LEFT JOIN qc_product_sku sku ON sku.id = lot.sku_id;
$$;

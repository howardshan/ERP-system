-- M-099: Batch Trace UX — only show scanned carts; per-WO scan counts.
--
-- Operator wants:
--   1. Batch Trace detail page lists only carts that have been physically
--      scanned at the dryer door (scanned_for_check_in_at IS NOT NULL).
--      Unscanned carts (status='created' AND scanned_for_check_in_at IS NULL)
--      are still on the production floor and shouldn't clutter the trace view.
--   2. Trace list page shows "<scanned>/<total>" next to each work order so
--      ops can see at a glance how many carts have been brought to the dryer.
--
-- Quality events list keeps showing all events — including those tied to
-- unscanned carts — because events are a historical timeline, not a current
-- state view.
--
-- Also emit lot.max_seq (computed over ALL carts including unscanned) so the
-- Add-carts dialog can default start_seq = max_seq + 1 without colliding with
-- carts still on the production floor that are hidden from sub_lots.

-- ── 1) Trace list RPC: emit scanned_count + total_count per WO ─────────────
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
            )
        ) ORDER BY lot.created_at DESC
    ), '[]'::jsonb)
    FROM qc_production_lot lot
    LEFT JOIN qc_product_sku sku ON sku.id = lot.sku_id;
$$;

-- ── 2) Trace detail RPC: filter sub_lots to scanned-only + emit counts ─────
CREATE OR REPLACE FUNCTION qc_production_lot_detail(p_lot_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
    lot       qc_production_lot%ROWTYPE;
    sku       qc_product_sku%ROWTYPE;
    v_scanned int;
    v_total   int;
    v_max_seq int;
BEGIN
    SELECT * INTO lot FROM qc_production_lot WHERE id = p_lot_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Production lot not found'; END IF;
    SELECT * INTO sku FROM qc_product_sku WHERE id = lot.sku_id;

    SELECT COUNT(*) FILTER (WHERE s.scanned_for_check_in_at IS NOT NULL),
           COUNT(*),
           COALESCE(MAX((regexp_replace(s.sub_lot_code, '^.*-(\d{3})$', '\1'))::int), 0)
      INTO v_scanned, v_total, v_max_seq
    FROM qc_drying_sub_lot s
    WHERE s.production_lot_id = p_lot_id;

    RETURN jsonb_build_object(
        'lot', jsonb_build_object(
            'id', lot.id,
            'lot_number', lot.lot_number,
            'lot_barcode', lot.lot_barcode,
            'work_order_barcode', lot.work_order_barcode,
            'sku_id', lot.sku_id,
            'sku_code', sku.code,
            'sku_name', sku.name,
            'created_at', lot.created_at,
            'scanned_count', v_scanned,
            'total_count', v_total,
            'max_seq', v_max_seq
        ),
        'sub_lots', COALESCE((
            SELECT jsonb_agg(qc_sub_lot_to_json(s.id) ORDER BY s.created_at)
            FROM qc_drying_sub_lot s
            WHERE s.production_lot_id = p_lot_id
              AND s.scanned_for_check_in_at IS NOT NULL
        ), '[]'::jsonb),
        'events', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', ev.id,
                'event_type', ev.event_type,
                'payload', ev.payload,
                'created_at', ev.created_at,
                'sub_lot_code', s2.sub_lot_code,
                'summary', qc_quality_event_summary(ev.event_type, ev.payload, s2.sub_lot_code)
            ) ORDER BY ev.created_at DESC)
            FROM qc_quality_event ev
            LEFT JOIN qc_drying_sub_lot s2 ON s2.id = ev.drying_sub_lot_id
            WHERE ev.drying_sub_lot_id IN (
                SELECT id FROM qc_drying_sub_lot WHERE production_lot_id = p_lot_id
            )
            LIMIT 50
        ), '[]'::jsonb)
    );
END;
$$;

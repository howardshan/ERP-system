-- Migration M-152: Batch Trace — unify on Drying sub-lots as the single source
-- of timeline truth; drop the separate Quality events list.
--
-- USER REQUEST:
--   The Batch Trace page has two sections that show the same data:
--     • Drying sub-lots — each cart card → History drawer shows the full
--                         per-cart timeline (M-145 / M-146 fixed all groups +
--                         multi-test readings).
--     • Quality events — every event on the whole WO in one flat list.
--   Per-cart events are visible in BOTH places — the second list is pure
--   duplication. Operators want one entry point: Drying sub-lots.
--
--   Gap that blocks the simplification: with M-099's filter
--   (`scanned_for_check_in_at IS NOT NULL`), unscanned carts are HIDDEN from
--   Drying sub-lots. For a freshly-created WO (e.g. 2626R01 0/10,
--   GNKtest5788 0/11) the list is empty, so there's nothing to click into.
--
-- FIX (this migration):
--   • sub_lots: drop the scanned-only filter → every cart on the WO is
--     listed, including carts still on the production floor. Their status
--     badge already reads "Created" and the History drawer shows the
--     `sub_lot_created` event — that's the timeline for an unscanned cart.
--   • sub_lots ordering: ORDER BY sub_lot_code (natural 001..NNN) instead
--     of created_at, so the list is stable and readable. Bulk-created carts
--     all share a created_at timestamp, which made the previous order
--     non-deterministic (visible as the scrambled "002, 005, 006, 007, 001…"
--     order in test001).
--   • events: returns an EMPTY array. The Batch Trace page no longer
--     renders Quality events; per-cart events are reached via the History
--     drawer. The field is kept (not removed) so the JSON shape and TS type
--     `ProductionLotDetail.events: QualityEvent[]` stay valid — avoids a
--     cascading type churn for one removed UI section. Drops the (mildly
--     expensive) JOIN+aggregate on qc_quality_event from the WO load path.
--
-- This pairs with the TracePage.tsx change that removes the Quality events
-- block AND the M-150 "no carts scanned" hint (now redundant since unscanned
-- carts ARE listed).
--
-- Depends on: M-150 (20260623000004) — last redefinition of this RPC.
-- Affects: docs/database/03..., docs/modules/09_qc.md, frontend TracePage.

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
        -- M-152: list ALL carts (no scanned filter), natural code order.
        'sub_lots', COALESCE((
            SELECT jsonb_agg(qc_sub_lot_to_json(s.id) ORDER BY s.sub_lot_code)
            FROM qc_drying_sub_lot s
            WHERE s.production_lot_id = p_lot_id
        ), '[]'::jsonb),
        -- M-152: events list deprecated on the Batch Trace page. Per-cart
        -- events live in the Sub-lot History drawer (qc_sub_lot_full_history).
        -- Kept as an empty array for TS-type compatibility.
        'events', '[]'::jsonb
    );
END;
$$;

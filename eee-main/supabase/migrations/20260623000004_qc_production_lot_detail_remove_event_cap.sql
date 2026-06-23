-- Migration M-150: drop the silent 50-event cap on Batch Trace's timeline.
--
-- BUG REPORT FROM PRODUCTION → BATCH TRACE:
--   Operators see "many operations and behaviors not recorded" on busy work
--   orders. The actual recorded events on those WOs ARE there — the trace
--   page just stops showing them past row 50.
--
-- ROOT CAUSE:
--   M-099's qc_production_lot_detail hardcoded `LIMIT 50` inside the events
--   subquery. A 10-cart WO that has gone through one complete cycle
--   (sub_lot_created × 10, scanned_for_check_in × 10, check_in × 10, possible
--   move_dryer × N, check_out × 10, group_assigned × N, sample_taken, plus
--   inspection / disposition / sync hooks) hits 50 well before the cycle is
--   done. With retest or redry the cap is blown wide open. The `ORDER BY
--   created_at DESC` then drops the OLDEST events first, so operators see
--   only the tail of recent activity — exactly the "missing history"
--   symptom they reported.
--
-- FIX:
--   Drop the LIMIT entirely. Per-WO events are intrinsically bounded by
--   sub-lot count × lifecycle length; a chaotic WO accumulates a few hundred
--   rows at most. JSON aggregation of that volume is fine; no pagination
--   layer downstream needs the cap.
--
-- Otherwise byte-identical to M-099. The `lot` / `sub_lots` blocks are
-- preserved verbatim — only the events subquery changes.
--
-- Depends on: M-099 (20260527000002 qc_production_lot_detail).
-- Affects: docs/database/03..., docs/modules/09_qc.md.
-- No frontend type changes (events array shape unchanged).

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
        -- M-150: no more `LIMIT 50`. Full per-WO event timeline.
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
        ), '[]'::jsonb)
    );
END;
$$;

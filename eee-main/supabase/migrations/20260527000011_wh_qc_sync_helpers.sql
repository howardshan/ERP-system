-- M-114: QC ↔ ERP sync helpers (Warehouse S4)
--
-- Two RPCs:
--   1. qc_set_lot_packaging_item(production_lot_id, item_id) — late-fill helper
--      for historical carts where packaging_item_id is NULL (decision §5.7).
--      Only allows NULL→SET (never overwrite); validates the item is linked
--      to the SKU via qc_sku_item; writes a qc_quality_event for audit.
--
--   2. wh_sync_release_from_qc(sub_lot_id, yield_quantity) — the BR-W3 sync
--      called from inside the modified qc_release_passed_sub_lot (M-116).
--      Handles three §5.7 dispatch cases for missing packaging_item_id, lazy-
--      creates the ERP lot for historical carts, posts a 'production_output'
--      transaction of +yield to LOC-PACK-STAGE via the kernel, and recomputes
--      lot.status per §5.1.
--
-- Error-code contract (caught by front-end):
--   'PACKAGING_REQUIRED:<production_lot_id>'  → multi-link, show picker modal
--   'NO_PACKAGING_LINKED:<sku_id>'            → SKU has 0 links, hard fail
--   'YIELD_REQUIRED: ...'                     → release form missed yield
--
-- Idempotent (CREATE OR REPLACE).

-- ── 1) qc_set_lot_packaging_item ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION qc_set_lot_packaging_item(
    p_production_lot_id uuid,
    p_item_id           bigint
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sku_id  uuid;
    v_current bigint;
    v_linked  boolean;
BEGIN
    SELECT sku_id, packaging_item_id
      INTO v_sku_id, v_current
      FROM qc_production_lot
     WHERE id = p_production_lot_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'qc_production_lot % not found', p_production_lot_id; END IF;

    IF v_current IS NOT NULL THEN
        RAISE EXCEPTION 'packaging_item_id already set (%) — cannot overwrite', v_current;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM qc_sku_item WHERE sku_id = v_sku_id AND item_id = p_item_id
    ) INTO v_linked;
    IF NOT v_linked THEN
        RAISE EXCEPTION 'item % is not linked to sku % via qc_sku_item', p_item_id, v_sku_id;
    END IF;

    UPDATE qc_production_lot SET packaging_item_id = p_item_id
     WHERE id = p_production_lot_id;

    -- Audit event on one representative sub_lot (cheap, no need to write N times)
    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    SELECT id, 'packaging_item_set',
           jsonb_build_object(
             'production_lot_id', p_production_lot_id,
             'item_id', p_item_id,
             'source', 'late_fill_on_release'
           ),
           auth.uid()
      FROM qc_drying_sub_lot
     WHERE production_lot_id = p_production_lot_id
     ORDER BY sub_lot_code
     LIMIT 1;

    RETURN jsonb_build_object(
        'production_lot_id', p_production_lot_id,
        'packaging_item_id', p_item_id
    );
END;
$$;

-- ── 2) wh_sync_release_from_qc ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION wh_sync_release_from_qc(
    p_sub_lot_id     uuid,
    p_yield_quantity numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sub_lot    qc_drying_sub_lot%ROWTYPE;
    v_pl         qc_production_lot%ROWTYPE;
    v_item_id    bigint;
    v_lot_id     bigint;
    v_link_count int;
    v_auto_item  bigint;
    v_loc_id     bigint;
    v_uom_id     bigint;
    v_txn_id     bigint;
    v_recompute  jsonb;
BEGIN
    IF p_yield_quantity IS NULL OR p_yield_quantity <= 0 THEN
        RAISE EXCEPTION 'YIELD_REQUIRED: yield must be positive (got %)', p_yield_quantity;
    END IF;

    SELECT * INTO v_sub_lot FROM qc_drying_sub_lot WHERE id = p_sub_lot_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'sub_lot % not found', p_sub_lot_id; END IF;

    SELECT * INTO v_pl
      FROM qc_production_lot
     WHERE id = v_sub_lot.production_lot_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'production_lot % not found', v_sub_lot.production_lot_id; END IF;

    v_item_id := v_pl.packaging_item_id;

    -- §5.7 historical NULL packaging_item_id three-way dispatch
    IF v_item_id IS NULL THEN
        SELECT COUNT(*) INTO v_link_count FROM qc_sku_item WHERE sku_id = v_pl.sku_id;

        IF v_link_count = 0 THEN
            RAISE EXCEPTION 'NO_PACKAGING_LINKED: %', v_pl.sku_id
                USING HINT = 'Configure final products for this SKU in ProductManagement first.';
        ELSIF v_link_count >= 2 THEN
            RAISE EXCEPTION 'PACKAGING_REQUIRED: %', v_pl.id
                USING HINT = 'Front-end should prompt operator to pick from qc_sku_item links, then call qc_set_lot_packaging_item + retry.';
        ELSE
            -- Exactly 1 link: auto-fill (no ambiguity)
            SELECT item_id INTO v_auto_item FROM qc_sku_item WHERE sku_id = v_pl.sku_id LIMIT 1;
            PERFORM qc_set_lot_packaging_item(v_pl.id, v_auto_item);
            v_item_id := v_auto_item;
            v_pl.packaging_item_id := v_auto_item;
        END IF;
    END IF;

    -- Lazy ERP-lot creation for historical carts that pre-date M-115
    v_lot_id := v_pl.lot_id;
    IF v_lot_id IS NULL THEN
        v_lot_id := wh_create_lot(
            p_item_id         => v_item_id,
            p_source_type     => 'produced',
            p_lot_number      => v_pl.lot_number,
            p_status          => 'quarantine',
            p_source_doc_type => 'qc_production_lot'
            -- p_source_doc_id stays NULL: qc_production_lot.id is uuid, lot.source_doc_id is bigint
            -- Reverse link goes via qc_production_lot.lot_id (set below).
        );
        UPDATE qc_production_lot SET lot_id = v_lot_id WHERE id = v_pl.id;
        -- Trigger only fires on sub_lot INSERT/UPDATE OF production_lot_id; push the
        -- new lot_id to every sub_lot of this production_lot now.
        UPDATE qc_drying_sub_lot SET lot_id = v_lot_id WHERE production_lot_id = v_pl.id;
    END IF;

    -- Resolve target location + item base UOM
    SELECT id INTO v_loc_id FROM location WHERE code = 'LOC-PACK-STAGE';
    IF v_loc_id IS NULL THEN RAISE EXCEPTION 'LOC-PACK-STAGE not seeded (M-079)'; END IF;

    SELECT base_uom_id INTO v_uom_id FROM item WHERE id = v_item_id;
    IF v_uom_id IS NULL THEN RAISE EXCEPTION 'item % has no base_uom_id', v_item_id; END IF;

    -- Post yield via kernel (transaction_type='production_output')
    -- reference_id stays NULL (qc_drying_sub_lot.id is uuid; bigint won't fit);
    -- traceability lives in notes + qc_quality_event written by caller.
    v_txn_id := _wh_apply_transaction(
        p_item_id          => v_item_id,
        p_lot_id           => v_lot_id,
        p_location_id      => v_loc_id,
        p_quantity         => p_yield_quantity,
        p_uom_id           => v_uom_id,
        p_transaction_type => 'production_output',
        p_unit_cost        => NULL,
        p_reference_type   => 'qc_release',
        p_reference_id     => NULL,
        p_notes            => 'QC release: sub_lot ' || v_sub_lot.sub_lot_code
                              || ' (production_lot ' || v_pl.lot_number || ')'
    );

    -- Recompute lot.status per §5.1
    v_recompute := wh_recompute_lot_status(v_lot_id);

    RETURN jsonb_build_object(
        'sub_lot_id', p_sub_lot_id,
        'production_lot_id', v_pl.id,
        'lot_id', v_lot_id,
        'item_id', v_item_id,
        'yield_quantity', p_yield_quantity,
        'transaction_id', v_txn_id,
        'recompute', v_recompute
    );
END;
$$;

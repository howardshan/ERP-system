-- M-115: qc_create_production_lot_with_sub_lots — call wh_create_lot at cart
--        creation, link the new ERP lot back via qc_production_lot.lot_id (S4)
--
-- Adds the BR-W3 entry-point on the QC side: every freshly built cart now
-- gets a paired ERP `lot` row (status='quarantine', item=packaging_item_id),
-- and the ERP lot_id is stamped on qc_production_lot. The qc_drying_sub_lot
-- rows pick up the lot_id automatically via the M-112 trigger.
--
-- Compared to M-095:
--   ① Hard-enforces `p_packaging_item_id IS NOT NULL` per decision §5.6 (the
--      front-end already requires it for grouped SKUs — this closes the back-
--      end gap so manual Studio inserts can't bypass it).
--   ② Calls wh_create_lot BEFORE the sub-lot loop so the trigger sees the
--      parent's lot_id when each sub_lot is INSERTed.
--   ③ Returns the ERP lot_id in the result jsonb for the front-end.
--
-- Historical carts (predating this migration) are NOT backfilled here; their
-- ERP lot is lazy-created in M-114's wh_sync_release_from_qc on first release.
--
-- Idempotent (CREATE OR REPLACE, same signature as M-095).

CREATE OR REPLACE FUNCTION qc_create_production_lot_with_sub_lots(
    p_lot_number text,
    p_lot_barcode text,
    p_work_order_barcode text,
    p_sku_id uuid,
    p_expected_dry_minutes int,
    p_sub_lot_start_seq int DEFAULT 1,
    p_sub_lot_end_seq int DEFAULT NULL,
    p_packaging_item_id bigint DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    new_lot_id     uuid;
    new_erp_lot_id bigint;
    i              int;
    code           text;
    ids            uuid[] := ARRAY[]::uuid[];
    new_sl_id      uuid;
    sub_count      int;
BEGIN
    IF p_expected_dry_minutes IS NULL OR p_expected_dry_minutes <= 0 THEN
        RAISE EXCEPTION 'expected_dry_minutes must be > 0 (BR-Q29)';
    END IF;
    IF p_sub_lot_end_seq IS NULL OR p_sub_lot_end_seq < p_sub_lot_start_seq THEN
        RAISE EXCEPTION 'sub_lot_end_seq must be >= sub_lot_start_seq';
    END IF;
    IF p_sub_lot_start_seq < 1 THEN
        RAISE EXCEPTION 'sub_lot_start_seq must be >= 1';
    END IF;

    -- ★ S4 / decision §5.6: packaging_item_id is now required at cart creation.
    -- Historical NULL rows still exist and are handled lazily by M-114.
    IF p_packaging_item_id IS NULL THEN
        RAISE EXCEPTION 'PACKAGING_REQUIRED_AT_CREATION: pick a final product (packaging_item_id) before building cart';
    END IF;

    INSERT INTO qc_production_lot
        (lot_number, lot_barcode, work_order_barcode, sku_id, expected_dry_minutes, packaging_item_id)
    VALUES
        (p_lot_number, p_lot_barcode, p_work_order_barcode, p_sku_id, p_expected_dry_minutes, p_packaging_item_id)
    RETURNING id INTO new_lot_id;

    -- ★ S4: create the paired ERP lot now, before sub_lots, so the M-112
    -- trigger sees parent.lot_id when each sub_lot is INSERTed.
    new_erp_lot_id := wh_create_lot(
        p_item_id         => p_packaging_item_id,
        p_source_type     => 'produced',
        p_lot_number      => p_lot_number,         -- D-W02: 1:1 same number with qc lot
        p_status          => 'quarantine',         -- BR-6a: new lots start quarantine
        p_source_doc_type => 'qc_production_lot'   -- source_doc_id stays NULL (uuid/bigint mismatch)
    );

    UPDATE qc_production_lot SET lot_id = new_erp_lot_id WHERE id = new_lot_id;

    FOR i IN p_sub_lot_start_seq..p_sub_lot_end_seq LOOP
        code := p_work_order_barcode || '-' || LPAD(i::text, 3, '0');
        IF EXISTS (SELECT 1 FROM qc_drying_sub_lot WHERE sub_lot_code = code) THEN
            RAISE EXCEPTION 'Sub-lot code already exists: %', code;
        END IF;
        INSERT INTO qc_drying_sub_lot
            (production_lot_id, sub_lot_code, status, expected_dry_minutes)
        VALUES
            (new_lot_id, code, 'created', p_expected_dry_minutes)
        RETURNING id INTO new_sl_id;
        ids := ids || new_sl_id;

        INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
        VALUES (new_sl_id, 'sub_lot_created',
                jsonb_build_object('sub_lot_code', code,
                                   'seq', i,
                                   'expected_dry_minutes', p_expected_dry_minutes,
                                   'wh_lot_id', new_erp_lot_id),
                auth.uid());
    END LOOP;

    sub_count := COALESCE(array_length(ids, 1), 0);

    RETURN jsonb_build_object(
        'lot_id', new_lot_id,
        'lot_number', p_lot_number,
        'lot_barcode', p_lot_barcode,
        'expected_dry_minutes', p_expected_dry_minutes,
        'packaging_item_id', p_packaging_item_id,
        'wh_lot_id', new_erp_lot_id,
        'sub_lot_count', sub_count,
        'sub_lot_ids', to_jsonb(ids)
    );
END;
$$;

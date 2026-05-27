-- M-102: Inventory-ledger kernel + number generators (Warehouse S1)
--
-- _wh_apply_transaction is the SINGLE entry point for every inventory write.
-- It enforces BR-3 (lot control), UOM→base conversion (BR-2), BR-W4 (double
-- condition on outbound issue/ship/consume), and BR-5 (no negative stock).
-- The balance is maintained by the M-100 AFTER-INSERT trigger.
--
-- Idempotent (CREATE OR REPLACE).

-- ── Generators ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION wh_next_grn_number()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE n int;
BEGIN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(grn_number, '^GRN-(\d+)$', '\1'), '')::int), 0) + 1
    INTO n FROM goods_receipt WHERE grn_number ~ '^GRN-\d+$';
    RETURN 'GRN-' || LPAD(n::text, 6, '0');
END;
$$;

-- Placeholder lot-number rule (计划书 §9); customer finalises later by swapping
-- this function only. purchased → RM-YYYYMMDD-SEQ4 ; produced → FG-{sku}-YYYYMMDD-SEQ4.
CREATE OR REPLACE FUNCTION wh_generate_lot_number(p_item_id bigint, p_source_type text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
    v_prefix text;
    v_sku    text;
    n        int;
BEGIN
    IF p_source_type = 'produced' THEN
        SELECT sku INTO v_sku FROM item WHERE id = p_item_id;
        v_prefix := 'FG-' || COALESCE(v_sku, p_item_id::text) || '-' || to_char(now(), 'YYYYMMDD') || '-';
    ELSE
        v_prefix := 'RM-' || to_char(now(), 'YYYYMMDD') || '-';
    END IF;

    SELECT COALESCE(MAX(NULLIF(regexp_replace(lot_number, '^' || v_prefix || '(\d{4})$', '\1'), '')::int), 0) + 1
    INTO n FROM lot WHERE lot_number LIKE v_prefix || '%';

    RETURN v_prefix || LPAD(n::text, 4, '0');
END;
$$;

-- ── Kernel ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _wh_apply_transaction(
    p_item_id          bigint,
    p_lot_id           bigint,
    p_location_id      bigint,
    p_quantity         numeric,        -- SIGNED, expressed in p_uom_id
    p_uom_id           bigint,
    p_transaction_type text,
    p_unit_cost        numeric DEFAULT NULL,
    p_reference_type   text    DEFAULT NULL,
    p_reference_id     bigint  DEFAULT NULL,
    p_notes            text    DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_base_uom_id       bigint;
    v_is_lot_controlled boolean;
    v_factor            numeric;
    v_qty_base          numeric;
    v_current           numeric;
    v_lot_status        text;
    v_loc_type          text;
    v_txn_id            bigint;
BEGIN
    SELECT base_uom_id, is_lot_controlled
      INTO v_base_uom_id, v_is_lot_controlled
      FROM item WHERE id = p_item_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'item % not found', p_item_id; END IF;

    -- BR-3: lot-controlled items must carry a lot
    IF v_is_lot_controlled AND p_lot_id IS NULL THEN
        RAISE EXCEPTION 'BR-3: item % is lot-controlled; lot_id is required', p_item_id;
    END IF;

    IF p_quantity IS NULL OR p_quantity = 0 THEN
        RAISE EXCEPTION 'quantity must be non-zero';
    END IF;

    -- BR-2: convert to the item's base UOM
    IF p_uom_id = v_base_uom_id THEN
        v_factor := 1;
    ELSE
        SELECT factor INTO v_factor
          FROM uom_conversion
         WHERE from_uom_id = p_uom_id AND to_uom_id = v_base_uom_id
           AND (item_id = p_item_id OR item_id IS NULL)
         ORDER BY item_id NULLS LAST   -- item-specific takes precedence
         LIMIT 1;
        IF v_factor IS NULL THEN
            RAISE EXCEPTION 'no uom_conversion from uom % to base uom % for item %', p_uom_id, v_base_uom_id, p_item_id;
        END IF;
    END IF;
    v_qty_base := p_quantity * v_factor;   -- factor > 0, sign preserved

    -- Outbound checks
    IF v_qty_base < 0 THEN
        -- BR-W4 double-condition (only issue / ship / production_consume;
        -- transfers out of quarantine are legitimate, e.g. QC release).
        IF p_transaction_type IN ('issue', 'ship', 'production_consume') THEN
            IF p_lot_id IS NOT NULL THEN
                SELECT status INTO v_lot_status FROM lot WHERE id = p_lot_id;
                IF v_lot_status IN ('on_hold', 'rejected', 'expired') THEN
                    RAISE EXCEPTION 'BR-W4: lot % is % and cannot be issued', p_lot_id, v_lot_status;
                END IF;
            END IF;
            SELECT location_type INTO v_loc_type FROM location WHERE id = p_location_id;
            IF v_loc_type = 'quarantine' THEN
                RAISE EXCEPTION 'BR-W4: location % is quarantine-typed and cannot be issued from', p_location_id;
            END IF;
        END IF;

        -- BR-5: no negative stock. Lock the balance row to serialise concurrency.
        SELECT quantity_on_hand INTO v_current
          FROM inventory_balance
         WHERE item_id = p_item_id AND lot_id = p_lot_id AND location_id = p_location_id
           FOR UPDATE;
        v_current := COALESCE(v_current, 0);
        IF v_current + v_qty_base < 0 THEN
            RAISE EXCEPTION 'BR-5: insufficient stock (on hand %, change %) for item % lot % at location %',
                v_current, v_qty_base, p_item_id, p_lot_id, p_location_id;
        END IF;
    END IF;

    INSERT INTO inventory_transaction
        (item_id, lot_id, location_id, quantity, transaction_type, unit_cost,
         reference_type, reference_id, notes, created_by)
    VALUES
        (p_item_id, p_lot_id, p_location_id, v_qty_base, p_transaction_type, p_unit_cost,
         p_reference_type, p_reference_id, p_notes, auth.uid()::text)
    RETURNING id INTO v_txn_id;

    RETURN v_txn_id;   -- balance maintained by trg_invtxn_maintain_balance (M-100)
END;
$$;

-- M-097: Retest on a group champion must reset hold-state siblings back to
--        `awaiting_group_result` so the eventual retest result propagates
--        across the whole group.
--
-- Bug flow (before this migration):
--   1. 2-cart group, champion FAILs.
--   2. M-055 group-fail propagation puts the sibling in `hold` too.
--   3. Operator clicks Retest on the champion.
--   4. qc_create_disposition's retest branch tries to find a NEW champion
--      among `awaiting_group_result` siblings -- but the sibling is in
--      `hold`, not `awaiting_group_result`, so the lookup returns NULL.
--   5. Function falls through to "keep this cart as champion, send back
--      to pending".  Sibling stays in `hold`, never updated.
--   6. Champion's new sample comes back PASS via qc_submit_inspection.
--      M-055 propagation only touches `awaiting_group_result` siblings
--      → sibling still in `hold`.
--
-- Resulting symptoms reported by operators:
--   - Analysis → Retest detail keeps showing "in progress" for the sibling
--     (sibling has no inspection after the retest disposition, so the
--      `dwell_minutes / next_result` columns are NULL forever).
--   - QC Home Needs Attention is mixed: champion shows PASS waiting
--     release, sibling shows FAIL waiting dispose.  Operator can't
--     release the group atomically.
--
-- Fix: when the retest branch keeps the original cart as champion
-- (no `awaiting_group_result` sibling to promote), reset every sibling
-- currently in `hold` back to `awaiting_group_result`.  Other statuses
-- (closed / dispatched / disposing / awaiting_recheck / room_temp_drying /
-- passed) are left alone — those are already past the testing stage and
-- shouldn't be dragged back.
--
-- Audit event `group_retest_reset` written per reset sibling so the
-- timeline shows the operator's retest fanned out to the group.

CREATE OR REPLACE FUNCTION qc_create_disposition(
    p_sub_lot_id uuid,
    p_type text,
    p_remark text DEFAULT NULL,
    p_redry_expected_dry_minutes int DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    s qc_drying_sub_lot%ROWTYPE;
    new_id uuid;
    next_status text;
    new_champion_id uuid;
    siblings_reset_count int := 0;
BEGIN
    IF p_type NOT IN ('rework', 'grind', 'scrap', 'concession',
                      'redry_dryer', 'room_temp_dry', 'retest') THEN
        RAISE EXCEPTION 'Invalid disposition type: %', p_type;
    END IF;
    IF p_type = 'redry_dryer' AND (p_redry_expected_dry_minutes IS NULL OR p_redry_expected_dry_minutes <= 0) THEN
        RAISE EXCEPTION 'redry_dryer requires a positive redry_expected_dry_minutes';
    END IF;

    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sub-lot not found'; END IF;

    IF s.status = 'hold' THEN
        UPDATE qc_drying_sub_lot SET status = 'disposing', updated_at = now() WHERE id = p_sub_lot_id;
        s.status := 'disposing';
    END IF;
    IF s.status <> 'disposing' THEN
        RAISE EXCEPTION 'Sub-lot not in disposition flow (status=%)', s.status;
    END IF;

    INSERT INTO qc_disposition (drying_sub_lot_id, type, remark, operator_auth_id, redry_expected_dry_minutes)
    VALUES (p_sub_lot_id, p_type, p_remark, auth.uid(), p_redry_expected_dry_minutes)
    RETURNING id INTO new_id;

    IF p_type = 'redry_dryer' THEN
        next_status := 'awaiting_recheck';
        UPDATE qc_drying_sub_lot
        SET status = 'awaiting_recheck',
            expected_dry_minutes = p_redry_expected_dry_minutes,
            in_time = NULL,
            out_time = NULL,
            updated_at = now()
        WHERE id = p_sub_lot_id;
    ELSIF p_type = 'room_temp_dry' THEN
        next_status := 'room_temp_drying';
        UPDATE qc_drying_sub_lot
        SET status = 'room_temp_drying', updated_at = now()
        WHERE id = p_sub_lot_id;
        INSERT INTO qc_room_temp_dry_session (drying_sub_lot_id, disposition_id, started_by_auth_id)
        VALUES (p_sub_lot_id, new_id, auth.uid());
    ELSIF p_type = 'retest' THEN
        IF s.is_test_champion AND s.test_group_id IS NOT NULL THEN
            SELECT id INTO new_champion_id
            FROM qc_drying_sub_lot
            WHERE test_group_id = s.test_group_id
              AND status = 'awaiting_group_result'
              AND id <> p_sub_lot_id
            ORDER BY random()
            LIMIT 1;

            IF new_champion_id IS NULL THEN
                -- Keep THIS cart as champion, back to pending.
                next_status := 'pending';
                UPDATE qc_drying_sub_lot
                SET status = 'pending', updated_at = now()
                WHERE id = p_sub_lot_id;

                -- M-097 FIX: reset hold-state siblings back to
                -- `awaiting_group_result` so the eventual retest result
                -- propagates to them.  Only `hold` is reset — other
                -- statuses are past the testing stage.
                UPDATE qc_drying_sub_lot
                SET status = 'awaiting_group_result', updated_at = now()
                WHERE test_group_id = s.test_group_id
                  AND id <> p_sub_lot_id
                  AND status = 'hold';
                GET DIAGNOSTICS siblings_reset_count = ROW_COUNT;

                INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
                SELECT sl.id, 'group_retest_reset',
                       jsonb_build_object(
                         'reset_from', 'hold',
                         'reset_to',   'awaiting_group_result',
                         'champion_id', s.id,
                         'disposition_id', new_id
                       ),
                       auth.uid()
                FROM qc_drying_sub_lot sl
                WHERE sl.test_group_id = s.test_group_id
                  AND sl.id <> p_sub_lot_id
                  AND sl.status = 'awaiting_group_result';
            ELSE
                -- A sibling was waiting (legacy path) — close failed
                -- champion, promote sibling as new champion.
                UPDATE qc_drying_sub_lot
                SET is_test_champion = false, status = 'closed', updated_at = now()
                WHERE id = p_sub_lot_id;

                UPDATE qc_drying_sub_lot
                SET is_test_champion = true,
                    status = 'pending',
                    updated_at = now()
                WHERE id = new_champion_id;

                INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
                VALUES (new_champion_id, 'champion_promoted',
                        jsonb_build_object(
                          'test_group_id', s.test_group_id,
                          'previous_champion_id', s.id
                        ),
                        auth.uid());

                next_status := 'closed';
            END IF;
        ELSE
            next_status := 'pending';
            UPDATE qc_drying_sub_lot
            SET status = 'pending', updated_at = now()
            WHERE id = p_sub_lot_id;
        END IF;
    ELSE
        next_status := 'closed';
        UPDATE qc_drying_sub_lot SET status = 'closed', updated_at = now() WHERE id = p_sub_lot_id;
    END IF;

    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    VALUES (p_sub_lot_id, 'disposition_completed',
            jsonb_build_object(
              'disposition_id', new_id,
              'type', p_type,
              'remark', p_remark,
              'new_status', next_status,
              'redry_expected_dry_minutes', p_redry_expected_dry_minutes,
              'new_champion_id', new_champion_id,
              'siblings_reset_count', siblings_reset_count
            ),
            auth.uid());

    RETURN jsonb_build_object(
        'id', new_id,
        'new_status', next_status,
        'type', p_type,
        'redry_expected_dry_minutes', p_redry_expected_dry_minutes,
        'new_champion_id', new_champion_id,
        'siblings_reset_count', siblings_reset_count
    );
END;
$$;


-- ===== merged from 20260526000005_wh_kernel_and_generators.sql (duplicate-version dedup for fresh db build) =====

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

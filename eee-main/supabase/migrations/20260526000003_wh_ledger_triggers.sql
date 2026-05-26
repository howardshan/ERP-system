-- M-100: Inventory-ledger guards & derived-balance maintenance (Warehouse S1)
--
-- BR-1  inventory_transaction is append-only: no UPDATE, no DELETE, ever.
-- BR-4  inventory_balance is derived: kept in sync from the ledger by trigger.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS before CREATE.

-- ── 1) Append-only guard (BR-1) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION wh_invtxn_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'BR-1: inventory_transaction is append-only — % is not allowed. Post a compensating adjustment instead.', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_invtxn_append_only ON inventory_transaction;
CREATE TRIGGER trg_invtxn_append_only
    BEFORE UPDATE OR DELETE ON inventory_transaction
    FOR EACH ROW EXECUTE FUNCTION wh_invtxn_append_only();

-- ── 2) Balance maintenance (BR-4) ───────────────────────────────────────────
-- Every inserted ledger row adjusts the (item, lot, location) on-hand balance.
-- inventory_balance PK includes lot_id (NOT NULL by PK rule), so a ledger row
-- without a lot cannot maintain a balance row — guarded with a clear error.
CREATE OR REPLACE FUNCTION wh_invtxn_maintain_balance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.lot_id IS NULL THEN
        RAISE EXCEPTION 'inventory_balance requires lot_id; non-lot-controlled balance is not supported (M1)';
    END IF;

    INSERT INTO inventory_balance (item_id, lot_id, location_id, quantity_on_hand, last_updated)
    VALUES (NEW.item_id, NEW.lot_id, NEW.location_id, NEW.quantity, now())
    ON CONFLICT (item_id, lot_id, location_id) DO UPDATE
        SET quantity_on_hand = inventory_balance.quantity_on_hand + NEW.quantity,
            last_updated = now();

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invtxn_maintain_balance ON inventory_transaction;
CREATE TRIGGER trg_invtxn_maintain_balance
    AFTER INSERT ON inventory_transaction
    FOR EACH ROW EXECUTE FUNCTION wh_invtxn_maintain_balance();

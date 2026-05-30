-- M-112: QC ↔ ERP lot link schema (Warehouse S4)
--
-- Adds the FK that ties QC's production_lot to the ERP `lot` table, plus a
-- redundant lot_id on qc_drying_sub_lot maintained by a BEFORE INSERT/UPDATE
-- trigger. This lets outbound RPCs (release/ship/consume) grab the ERP lot
-- straight off the sub_lot without an extra join.
--
-- Per decision §4.5: trigger (not generated column) because production_lot_id
-- is mutable — M-063 (20260523000001) regroups carts across production_lots
-- on bulk checkout, and generated columns require IMMUTABLE source columns.
-- Per decision §5.6: the ERP lot.item_id = qc_production_lot.packaging_item_id
-- (the final product), set by M-115's modified cart creation RPC.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF EXISTS).

ALTER TABLE qc_production_lot
    ADD COLUMN IF NOT EXISTS lot_id bigint REFERENCES lot(id);
CREATE INDEX IF NOT EXISTS idx_qc_production_lot_lot ON qc_production_lot(lot_id);

ALTER TABLE qc_drying_sub_lot
    ADD COLUMN IF NOT EXISTS lot_id bigint REFERENCES lot(id);
CREATE INDEX IF NOT EXISTS idx_qc_drying_sub_lot_lot ON qc_drying_sub_lot(lot_id);

-- Trigger function: sync lot_id from parent qc_production_lot.
-- Fires BEFORE INSERT or UPDATE OF production_lot_id so the row already has
-- the right lot_id by the time it lands. Reading the parent inside a BEFORE
-- trigger is safe because the parent INSERT/UPDATE is already committed in
-- the surrounding transaction context.
CREATE OR REPLACE FUNCTION qc_sync_sub_lot_lot_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' OR NEW.production_lot_id IS DISTINCT FROM OLD.production_lot_id THEN
        SELECT lot_id INTO NEW.lot_id
          FROM qc_production_lot
         WHERE id = NEW.production_lot_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_qc_sub_lot_sync_lot_id ON qc_drying_sub_lot;
CREATE TRIGGER trg_qc_sub_lot_sync_lot_id
    BEFORE INSERT OR UPDATE OF production_lot_id ON qc_drying_sub_lot
    FOR EACH ROW EXECUTE FUNCTION qc_sync_sub_lot_lot_id();

-- Backfill historical sub_lots whose parent production_lot already has a
-- lot_id (typically a no-op on the first S4 deploy since M-115 hasn't run
-- yet, but ensures the schema is in a consistent state if re-run later).
UPDATE qc_drying_sub_lot sl
   SET lot_id = pl.lot_id
  FROM qc_production_lot pl
 WHERE sl.production_lot_id = pl.id
   AND sl.lot_id IS NULL
   AND pl.lot_id IS NOT NULL;

-- Migration M-080: Bridge QC product SKUs to ERP master-data items (决议 1, 方案 A)
-- Adds a nullable FK from qc_product_sku to the ERP `item` table so a QC SKU
-- can be linked to the inventory item it represents.
--
-- Per Sprint 0 决议 §5.5 (回填方案 b): the column stays NULLable and is NOT
-- backfilled by a script. Items are created and linked manually through the
-- QC ProductManagement UI. The "SKU must be linked before a production lot can
-- be created" guard is implemented later in S4 alongside wh_sync_release_from_qc.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + guarded index creation.

ALTER TABLE qc_product_sku
  ADD COLUMN IF NOT EXISTS item_id bigint REFERENCES item(id);

COMMENT ON COLUMN qc_product_sku.item_id IS
  'FK to ERP item(id). NULLable; linked manually via QC ProductManagement UI. See Warehouse模块-Sprint0决议 §5.5.';

CREATE INDEX IF NOT EXISTS idx_qc_product_sku_item ON qc_product_sku(item_id);

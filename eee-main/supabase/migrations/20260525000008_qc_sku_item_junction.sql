-- M-086: Replace qc_product_sku.item_id (one-to-one) with qc_sku_item junction
--        table (one-to-many: one SKU → multiple ERP warehouse items).
--
-- Motivation: a single product can be packaged / sold under multiple ERP item
-- codes (e.g. different bag sizes, different customer labels).  The old
-- single-column approach could not represent this.
--
-- The UI for managing these links moves to the Production page so operators
-- see and edit the linkage in the same context where they create batches.

-- ── 1) Create junction table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qc_sku_item (
    sku_id   uuid   NOT NULL REFERENCES qc_product_sku(id) ON DELETE CASCADE,
    item_id  bigint NOT NULL REFERENCES item(id)           ON DELETE CASCADE,
    added_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (sku_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_qc_sku_item_sku  ON qc_sku_item (sku_id);
CREATE INDEX IF NOT EXISTS idx_qc_sku_item_item ON qc_sku_item (item_id);

ALTER TABLE qc_sku_item ENABLE ROW LEVEL SECURITY;
CREATE POLICY dev_all ON qc_sku_item FOR ALL USING (true) WITH CHECK (true);

-- ── 2) Migrate existing single-link data ────────────────────────────────────
INSERT INTO qc_sku_item (sku_id, item_id)
SELECT id, item_id
FROM   qc_product_sku
WHERE  item_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ── 3) Drop old column ───────────────────────────────────────────────────────
ALTER TABLE qc_product_sku DROP COLUMN IF EXISTS item_id;

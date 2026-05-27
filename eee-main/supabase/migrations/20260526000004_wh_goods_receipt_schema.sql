-- M-101: goods_receipt schema prep for no-PO "direct" receipts (Warehouse S1)
--
-- BR-W2: a no-PO receipt has po_id IS NULL AND receipt_type = 'direct'.
-- The blueprint made supplier_id NOT NULL, but a direct receipt may have no
-- supplier (supplier master is empty in v1.0). Make it nullable + add the
-- explicit receipt_type flag so the absence of a PO is auditable, not silent.
--
-- Idempotent.

ALTER TABLE goods_receipt ALTER COLUMN supplier_id DROP NOT NULL;

ALTER TABLE goods_receipt
    ADD COLUMN IF NOT EXISTS receipt_type text NOT NULL DEFAULT 'direct'
    CHECK (receipt_type IN ('po', 'direct'));

COMMENT ON COLUMN goods_receipt.receipt_type IS
    'po | direct. Direct = no purchase order (BR-W2); must be surfaced in UI.';

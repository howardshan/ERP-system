-- Run after initial migration (Supabase SQL Editor)

ALTER TABLE qc.product_sku
  ADD COLUMN IF NOT EXISTS standard_drying_minutes integer;

COMMENT ON COLUMN qc.product_sku.standard_drying_minutes IS 'SOP reference drying duration in minutes';

-- Allow drying status on sub-lots
ALTER TABLE qc.drying_sub_lot DROP CONSTRAINT IF EXISTS drying_sub_lot_status_check;
ALTER TABLE qc.drying_sub_lot ADD CONSTRAINT drying_sub_lot_status_check
  CHECK (status IN (
    'drying', 'pending', 'inspecting', 'passed', 'hold', 'disposing', 'closed'
  ));

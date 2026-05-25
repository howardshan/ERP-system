-- Migration M-081: Seed base units of measure (UOM)
-- The `uom` table (M-001) was never seeded, but `item.base_uom_id` is a NOT NULL
-- FK — so no item can be created until at least one UOM exists. This seeds a
-- standard set so the Warehouse Items master-data form is usable.
--
-- Item-specific conversions (uom_conversion) are intentionally NOT seeded here;
-- they are configured per item once real materials exist.
-- Idempotent: ON CONFLICT (code) DO NOTHING.

INSERT INTO uom (code, name, uom_type, created_by)
VALUES
  ('KG',     '千克',  'weight', 'system:M-081'),
  ('G',      '克',    'weight', 'system:M-081'),
  ('TON',    '吨',    'weight', 'system:M-081'),
  ('L',      '升',    'volume', 'system:M-081'),
  ('ML',     '毫升',  'volume', 'system:M-081'),
  ('EACH',   '个',    'count',  'system:M-081'),
  ('BAG',    '袋',    'count',  'system:M-081'),
  ('BOX',    '箱',    'count',  'system:M-081'),
  ('PALLET', '托盘',  'count',  'system:M-081')
ON CONFLICT (code) DO NOTHING;

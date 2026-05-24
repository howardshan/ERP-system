-- Migration M-079: Warehouse module — main warehouse + 7 logical locations seed
-- Implements 决议 D-W01 (Warehouse模块开发计划书 §5.1): one physical warehouse
-- (WH-MAIN) plus 7 logical zones modeled as `location` rows.
-- Idempotent: re-runnable via ON CONFLICT on the unique business keys.
--
-- location_type is constrained by the existing CHECK
--   ('storage','receiving','shipping','production','quarantine')
-- so the 7 zones are mapped onto those types per §5.1.

-- 1) Main warehouse (WH-MAIN)
INSERT INTO warehouse (code, name, address, created_by)
VALUES ('WH-MAIN', '主工厂', NULL, 'system:M-079')
ON CONFLICT (code) DO NOTHING;

-- 2) Seven logical zones under WH-MAIN
INSERT INTO location (warehouse_id, code, name, location_type, created_by)
SELECT w.id, z.code, z.name, z.location_type, 'system:M-079'
FROM warehouse w
CROSS JOIN (VALUES
  ('LOC-RM',         '原材料仓',        'storage'),     -- 原材料仓
  ('LOC-PRE-DRY',    '待烘干仓',        'production'),  -- 待烘干仓
  ('LOC-DRY-WIP',    '烘干区（汇总）',    'production'),  -- 烘干仓 WIP，与 QC 炉位联动过账
  ('LOC-QC-PENDING', '待检仓',          'quarantine'),  -- 烘干完成后待检
  ('LOC-PACK-STAGE', '待包装/合格仓',     'storage'),     -- 待包装（合格）
  ('LOC-NG',         '不合格仓',        'quarantine'),  -- 不合格仓
  ('LOC-FG',         '成品仓',          'storage')      -- 成品仓
) AS z(code, name, location_type)
WHERE w.code = 'WH-MAIN'
ON CONFLICT (warehouse_id, code) DO NOTHING;

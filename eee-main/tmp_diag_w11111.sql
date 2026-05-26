-- ============================================================================
-- 诊断:W11111-03/06/07/08 孤儿 sibling
-- 跑完贴结果,我根据状态决定 M-082 怎么写
-- ============================================================================

-- 1) 这 4 车现在的实际状态 + 它们的 group
SELECT
    s.sub_lot_code,
    s.status,
    s.test_group_id,
    s.is_test_champion,
    s.in_time,
    s.out_time
FROM qc_drying_sub_lot s
JOIN qc_production_lot lot ON lot.id = s.production_lot_id
WHERE lot.work_order_barcode = 'W11111'
  AND s.sub_lot_code IN ('W11111-003', 'W11111-006', 'W11111-007', 'W11111-008')
ORDER BY s.sub_lot_code;

-- 2) 这些 group 里所有成员 + champion 现在的状态
WITH target_groups AS (
  SELECT DISTINCT s.test_group_id
  FROM qc_drying_sub_lot s
  WHERE s.sub_lot_code IN ('W11111-003', 'W11111-006', 'W11111-007', 'W11111-008')
    AND s.test_group_id IS NOT NULL
)
SELECT
    sl.sub_lot_code,
    sl.status,
    sl.test_group_id,
    sl.is_test_champion,
    g.status AS group_status,
    g.member_count
FROM qc_drying_sub_lot sl
JOIN qc_test_group g ON g.id = sl.test_group_id
WHERE sl.test_group_id IN (SELECT test_group_id FROM target_groups)
ORDER BY sl.test_group_id, sl.is_test_champion DESC, sl.sub_lot_code;

-- 3) W11111 整批所有车的概况(确认还有没有别的孤儿没注意到)
SELECT
    s.sub_lot_code,
    s.status,
    s.test_group_id,
    s.is_test_champion
FROM qc_drying_sub_lot s
JOIN qc_production_lot lot ON lot.id = s.production_lot_id
WHERE lot.work_order_barcode = 'W11111'
ORDER BY s.sub_lot_code;

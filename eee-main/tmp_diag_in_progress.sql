-- ============================================================================
-- 诊断:W12345-005 / 11111-005 / 11111-008 为什么在 Analysis 显示 in progress
--                              但 Testing queue 里又没有它们
-- ============================================================================

-- 1) 当前 status + 最近 disposition + 最近 inspection 的总览
SELECT
    s.sub_lot_code,
    s.status                    AS current_status,
    s.test_group_id,
    s.is_test_champion,
    s.released_at,
    (SELECT d.type FROM qc_disposition d
       WHERE d.drying_sub_lot_id = s.id
       ORDER BY d.created_at DESC LIMIT 1)                    AS last_disposition_type,
    (SELECT d.created_at FROM qc_disposition d
       WHERE d.drying_sub_lot_id = s.id
       ORDER BY d.created_at DESC LIMIT 1)                    AS last_disposition_at,
    (SELECT ir.result FROM qc_inspection_record ir
       WHERE ir.drying_sub_lot_id = s.id
       ORDER BY ir.submitted_at DESC LIMIT 1)                 AS last_inspection_result,
    (SELECT (ir.values_json->>'aw')::numeric FROM qc_inspection_record ir
       WHERE ir.drying_sub_lot_id = s.id
       ORDER BY ir.submitted_at DESC LIMIT 1)                 AS last_inspection_aw,
    (SELECT ir.submitted_at FROM qc_inspection_record ir
       WHERE ir.drying_sub_lot_id = s.id
       ORDER BY ir.submitted_at DESC LIMIT 1)                 AS last_inspection_at
FROM qc_drying_sub_lot s
WHERE s.sub_lot_code IN ('W12345-005', 'W11111-005', 'W11111-008')
ORDER BY s.sub_lot_code;

-- 2) 这 3 车完整的事件流(状态怎么变迁的)
SELECT
    s.sub_lot_code,
    ev.event_type,
    ev.created_at,
    ev.payload
FROM qc_quality_event ev
JOIN qc_drying_sub_lot s ON s.id = ev.drying_sub_lot_id
WHERE s.sub_lot_code IN ('W12345-005', 'W11111-005', 'W11111-008')
ORDER BY s.sub_lot_code, ev.created_at;

-- 3) 模拟 Testing queue 看到的车(应该不包含上面 3 车)
SELECT s.sub_lot_code, s.status
FROM qc_drying_sub_lot s
WHERE s.status IN ('pending', 'inspecting')
ORDER BY s.sub_lot_code;

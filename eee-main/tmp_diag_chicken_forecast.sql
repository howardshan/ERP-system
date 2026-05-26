-- ============================================================================
-- 诊断:Predicted passes 显示 15 车 — 这 15 车具体是谁?
-- 注:如果远程缓存了旧前端的请求,刷新页面后再看一次。这个 SQL 反映的是
--     M-081 推上去之后 DB 的真实状态。
-- ============================================================================

-- 1) 拷贝 forecast 函数的精确口径:列出每辆「in flight」车
SELECT
    s.sub_lot_code,
    s.status,
    lot.work_order_barcode,
    lot.lot_number,
    s.test_group_id,
    s.is_test_champion,
    s.in_time,
    s.out_time,
    s.created_at
FROM qc_drying_sub_lot s
JOIN qc_production_lot lot ON lot.id = s.production_lot_id
JOIN qc_product_sku sku ON sku.id = lot.sku_id
WHERE sku.name ILIKE '%chicken%jerky%'  -- 调整成你看到的 SKU 名,或换成 sku.code
  AND s.status IN ('pending', 'inspecting', 'awaiting_group_result')
ORDER BY lot.work_order_barcode, s.sub_lot_code;

-- 2) 总数 + 按 status 分组,跟卡片上的数字直接对照
SELECT s.status, COUNT(*)::int AS n
FROM qc_drying_sub_lot s
JOIN qc_production_lot lot ON lot.id = s.production_lot_id
JOIN qc_product_sku sku ON sku.id = lot.sku_id
WHERE sku.name ILIKE '%chicken%jerky%'
  AND s.status IN ('pending', 'inspecting', 'awaiting_group_result')
GROUP BY s.status
ORDER BY n DESC;

-- 3) 顺带跑一次完整的 forecast RPC 看返回内容
SELECT jsonb_pretty(qc_dashboard_pass_rate_forecast());

# Dashboard 模块(按工单的生产流水看板)

> **状态**: 第一版已落地(M-157)。
> **入口**: 主页 Module Hub → Dashboard;侧边栏两个视图 → Work-Order Pipeline / Exit Forecast
> **UI 主题**: indigo
> **权限**: `dashboard.pipeline.view`(M-157 seed:补给所有已有 `production`/`qc` 模块访问的用户)

---

## 概述

操作员需要一个实时的总览:**每辆车(`qc_drying_sub_lot`,一行=一辆烘干车)当前处在生产→包装流水线的哪个阶段,并按产品(SKU)→工单拆分**。

Production 模块原有的 `ProductionDashboard`(M-093 `qc_production_pipeline_summary`)只做 per-SKU 的粗看板,既不按工单拆,也把 testing 压成一个桶,看不出有多少车已取样 / 在等测试 / 已 pass / 在复测。本模块补上这块,并额外给一个**烘干房出房预测**。

两个视图:
1. **Work-Order Pipeline** —— 按产品分组、工单可展开的表格,每个阶段一列。
2. **Exit Forecast** —— 当前在烘干的车,按预计出房日期分桶(单独区域,因为这是「按日期的预测」,形状和单一计数不同)。

---

## 阶段 ↔ 状态映射

所有计数都由单一的 `qc_drying_sub_lot.status` 列驱动(取数源:M-093 + M-035 `qc_overview` + M-081 forecast)。

| 看板列 | 定义 |
|---|---|
| **Dry Room** 烘干房 | `status IN ('drying','room_temp_drying','awaiting_recheck')` |
| **Waiting Sampling** 等待取样 | `status='pending'` 且无 pending `qc_sample`(已出房、未取样) |
| **Sampled** 已取样(等结果) | (`status='pending'` 且有 pending `qc_sample`)OR `status IN ('inspecting','awaiting_group_result')` |
| **Passed / Release** 通过·待放行 | `status='passed'` |
| **Retest / Hold** 复测·暂扣 | `status IN ('hold','disposing')`(测试失败,等待处置) |
| **Released** 已放行(待打包) | `status='closed'`(已放行、`released_at` 已置,进 `pkg_available_carts`) |
| **Dispatched** 已送包装 | `status='dispatched'` |

> **注意:passed ≡ 待放行**。本系统里「pass 了」和「等待放行」是**同一批车**——车一直停在 `status='passed'`,直到 QC 点 Release 才 → `closed`。所以它是**一列**(`Passed / Release`),不是两列。

> **未进烘干房(`status='created'`)的车不在看板显示**(操作员只关心已进入流水线的车);`totals.total` 因此只数非 `created` 的车。

**出房预测**:对 `status='drying'` 的车,ETA = `now() + (expected_dry_minutes − qc_total_dried_minutes(id)) 分钟`(复用 M-020 算法)。按本地日(America/Chicago,与前端 Dallas 助手一致)分桶:`overdue`(逾期)/ `day`(today..+p_days,逐日)/ `later`(窗口之外)/ `unknown`(无 `expected_dry_minutes`)。前端用 `grp + days_from_today` 渲染可翻译标签。

## 工单关联

`qc_drying_sub_lot.production_lot_id → qc_production_lot`,后者带 `work_order_barcode`(车上活跃工单,看板里展示的就是它)和 `sku_id → qc_product_sku`。按 sku 分组,再按 `work_order_barcode` 拆。

---

## 取数(M-157)

- `qc_dashboard_work_order_pipeline()` → jsonb:`[{sku_id, sku_code, sku_name, totals{8 桶+total}, work_orders:[{work_order_no, 8 桶, total}]}]`,只含至少有 1 辆车的产品/工单,按 `sku_code` → `work_order_barcode` 排序。
- `qc_dashboard_drying_exit_forecast(p_days int default 7)` → jsonb:`[{bucket_date, grp, days_from_today, cart_count}]`。

前端:[`src/services/qcApi.ts`](../../src/services/qcApi.ts) 的 `dashboardWorkOrderPipeline` / `dashboardDryingExitForecast`;页面 [`src/pages/dashboard/`](../../src/pages/dashboard/)(`DashboardModule` / `WorkOrderPipelinePage` / `DryingExitForecastPage`),15 秒自动刷新 + 手动 Refresh。

**关联文档**: [`docs/database/03_migrations-and-edge-functions.md`](../database/03_migrations-and-edge-functions.md) M-157、M-093。

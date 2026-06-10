# Production · Daily Report 模块(成型生产日报)

> **状态**: 第一阶段(1:1 复刻 Excel 录入)已落地。Schema/视图 M-122,主数据 seed M-123。
> **依据**: `ERP-system/docs/2026 Daily Report Forming Production.xlsx`(Daily Report sheet)
> **入口**: Production 模块侧边栏 → Reporting → Daily Report
> **UI 主题**: indigo(随 Production 模块)

---

## 概述

客户成型生产车间的工人按班次手工统计产量,交给生产管理(production manager),由其汇总填进一份 Excel —— `2026 Daily Report Forming Production.xlsx` 的 **Daily Report** sheet。本模块把"生产管理填这张表"的动作搬进系统。

该 Excel 是一张**生产流水表**:每行 = 一个(日期 × 班次 × 机台 × 工单 × 操作员)的记录。24 列里约 13 列人工填,其余 10 列是 Excel 公式(VLOOKUP 进 `RAW DATA` / `name item` 字典 + 算术)自动算。系统侧:人工字段存 `prod_daily_report`,计算列由视图 `prod_daily_report_view` 实时算。

**第一阶段范围**: 1:1 复刻录入 + 自动计算;独立产品主数据;操作员独立花名册(可选关联 HR);主数据一次性导入,历史日报行不导入。
**暂不含**: 分析看板(Excel 的 Analysis sheet)、与现有工单/生产批次/库存的集成、工人自助上报。

## 数据模型(M-122)

| 表 | 作用 | 对应 Excel |
|----|------|-----------|
| `prod_product_master` | 产品标准主数据(料号、描述、规格、`oz_per_piece`、`lbs_per_hr`、`pcs_lbs_per_hour`、`runner_avg`、`bone_avg`、`is_activity`) | RAW DATA(+ Other INF 特殊码) |
| `prod_machine` | 机台清单(`code`、`kind` inj/ext/other) | Machine DATA C 列 |
| `prod_downtime_reason` | 停机原因(`label` 双语原串) | Machine DATA A 列 |
| `prod_operator` | 操作员花名册(`badge_no` → `name`,可选 `erp_user_id`) | name item |
| `prod_daily_report` | 日报流水(仅人工录入字段) | Daily Report 行 |

视图 `prod_daily_report_view` = 流水 join 三张主数据表 + 10 个计算列。

### 为什么新建独立产品主数据表(设计决策)
现有 `qc_product_sku` 只有 code/name/烘干分钟,`item` 是仓储物料主数据,都不含日报公式所需的标准速率(`pcs_lbs_per_hour`、`runner_avg`、`bone_avg`)。第一阶段为降低耦合、快速复刻,新建独立 `prod_product_master`;后续如需统一产品主数据再做归并 migration。

### 为什么操作员不进 `erp_user`(设计决策)
`erp_user` 是登录/权限账号表。车间 ~159 名一线操作员多数没有系统账号,塞进去会污染用户体系。故建轻量 `prod_operator` 花名册(`badge_no` 即 Excel 工号),需要时再 FK 关联到对应 HR 账号。

## 录入页面

`src/pages/production/DailyReportPage.tsx`:
- 顶部 **日期选择器 + 班次切换(1st/2nd/3rd)**,贴合"一次录一个班"的习惯。
- 主体表格:当前 日期+班次 的记录;单行内联编辑(同一时刻仅一行可编辑),底部"+ 新增行"。机台/料号/工号/停机原因走下拉(查主数据),其余手填。
- 10 个计算列在编辑行**实时预览**(前端按 BR-P1 同口径算),保存后以视图返回值为准。
- 权限门:无 `view` 显示 `PermissionDenied`;增/改/删按钮按 `create/edit/delete` 控制。

服务层 `src/services/productionDailyApi.ts`:`listDailyReports(date,shift)` 读视图;`create/update/deleteDailyReport` 写流水表;`listProducts/Machines/Operators/DowntimeReasons` 取下拉。

## 业务规则

- **BR-P1 — 计算列口径(与 Excel 公式 1:1,已对 1 万+ 历史行验证)**
  | 列 | 公式 |
  |----|------|
  | Item Description | `product.description` |
  | Standard Lbs/Hr | `product.pcs_lbs_per_hour` |
  | Lbs Good Produced | `product.bone_avg × output_qty` |
  | Runner weight % | `product.runner_avg` |
  | Runner Regrind Lbs | `product.runner_avg × output_qty` |
  | Pcs(Lbs)/Hr | `output_qty / work_hours` |
  | Credit | `(output_qty / work_hours) / product.pcs_lbs_per_hour` |
  | Total Carts | `COALESCE(cart_to,0) − COALESCE(cart_from,0) + 1` |
  | Operator Name | `operator.name` |
  | Week # | `EXTRACT(week FROM report_date)` |

  除零、空料号、空车号均以 `NULLIF` / `COALESCE` 防护。`Total Carts` 用 `COALESCE` 复刻 Excel `=J−I+1` 在空车号行得 1 的行为。

- **BR-P2 — 非生产活动行**: Material Handler / Meeting / R&D Test / Machine Down 等没有真实料号/产出,作为 `prod_product_master` 里 `is_activity=true`、速率为空的真实条目录入,计算列自然归 0 / NULL。

## 权限

`production / daily_report / {view, create, edit, delete}`(`src/lib/permissionStructure.ts`)。M-122 把这四项授予已有 `production / module_permissions / manage` 的用户。

## 主数据导入(M-123)

由 `scripts/gen_prod_seed.py`(openpyxl)从工作簿生成幂等 seed:机台 45 / 停机原因 7 / 操作员 158 / 产品 383(含 44 个 activity)。客户换新工作簿时重跑脚本重生成。**历史日报流水行不导入。**

## 待办 / 后续阶段

- 分析看板(Daily production Analysis / Analysis)
- 与现有工单(work order)、生产批次、库存联动
- 工人自助上报(替代纸质交接)
- 录入交互可选增强:接近 Excel 的整屏网格批量录入/粘贴

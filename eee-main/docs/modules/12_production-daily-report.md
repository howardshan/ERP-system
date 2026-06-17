# Production · Daily Report 模块(成型生产日报)

> **状态**: 第一阶段(1:1 复刻 Excel 录入)已落地(M-122/M-123)。Phase 2 M1.1(工单主数据 + `prod_run` 单一事实源 + 工单驱动录入)已落地(M-125)。Phase 2 M1.2a(产线平板 kiosk + 设备登录 + 打卡)已落地(M-126)。Phase 2 M1.2b(平板生产录入 + 跨班续做车 + 停机实时)已落地(M-127)。
> **依据**: `ERP-system/docs/2026 Daily Report Forming Production.xlsx`(Daily Report sheet)、`ERP-system/docs/Production模块-Phase2-SPEC.md`
> **入口**: Production 模块侧边栏 → Reporting → Daily Report;Planning → Work Orders
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
- **紧凑列表**:当前 日期+班次 的记录只显示关键列(机台 / 料号 / 描述 / 操作员 / 产出 / 工时 / 总车数 / Pcs·Hr / Credit + 操作),宽度适配屏幕,不再横向溢出。Credit 以色块徽章呈现效率(≥1 绿 / ≥0.8 琥珀 / <0.8 红)。
- **右侧滑出抽屉**做新增/编辑:字段按「标识 / 车号 / 产量 / 停机 / 备注」分组;底部「自动计算」区按 BR-P1 同口径**实时预览** 10 个公式列,保存后以视图返回值为准。
  - 设计原因:Excel 原表 22 列一行,若整屏平铺会超出屏幕且录入困难;故列表只留关键列、完整录入收进抽屉。
  - **机台 / 操作员 / 料号** 选项过多(45 / 158 / 383),改用可搜索下拉组件 `src/components/ui/Combobox.tsx`(打字过滤 + 键盘导航):操作员按工号或姓名匹配,料号按料号或产品描述匹配。
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

## Phase 2 — M1.1(工单主数据 + prod_run 单一事实源 + 工单驱动录入,M-125)

Phase 2 把生产录入前移到一线、实时化(完整规划见 `docs/Production模块-Phase2-SPEC.md`,决策 D1–D10)。M1.1 是地基:

**1. 工单主数据 `prod_work_order`**(D1:工单源自外部系统,本期系统内手动维护):`work_order_no`(唯一)、`product_id`、`machine_id`、`planned_qty`、`status`(open/in_progress/closed/cancelled)、`planned_date`。**无 `process` 字段**(D10:工序由产品决定,经 `product_id` 读 `prod_product_master.process`)。管理页 `src/pages/production/WorkOrderPage.tsx`(Planning 区),服务 `productionWorkOrderApi.ts`。

**2. 方案 A 收敛(D3)—— `prod_daily_report` → 单一事实源 `prod_run`**:
- 原地 `RENAME`(保数据);`operator_id` 改 nullable;新增 `work_order_id`、`source`(tablet/manager)、`status`(draft/submitted/reviewed)、`final_cart_complete`、`continues_prev`、`device_id`。
- 计算视图改为 `prod_run_view`,**BR-P1 的 10 个计算表达式与 M-122 逐字一致**(口径零变化);operator/work_order 均 LEFT JOIN,补出 `process`。
- `prod_daily_report` 降为兼容视图(`SELECT * FROM prod_run`);应用层直接读写 `prod_run`/`prod_run_view`(服务 `productionDailyApi.ts` → `productionRunApi.ts`)。
- **BR-P3** prod_run 单一事实源;**BR-P4** 工单累计(SUM output)/ 车数去重(`MAX(cart_to)-MIN(cart_from)+1`),见视图 `prod_work_order_rollup_view`。

**3. 工单驱动录入(F3 / D9)**:Daily Report 录入抽屉的"工单号"框支持**扫码枪扫 + 手输**;失焦/回车调 `findWorkOrderByNo` → 命中即自动带出产品(描述/工序/速率),未命中提示可手选产品(降级)。

**设计取舍**:M1.1 仍保留 `operator_id`(nullable)与 `work_hours`,管理页维持 Phase-1 的"每操作员一行"形态,Credit/Pcs·Hr 仍以 `work_hours` 为分母;D5「工时=Σ打卡」留待 M1.2 引入 `prod_line_attendance` 后切换。**M1.1 不合并历史行**(避免产量重复计)。跨班"续做第 N 车"(D8)的交互 UI 留 M1.2 平板端(列已就绪)。

**权限**:新增 `production / work_order / {view, create, edit, close}`。

## Phase 2 — M1.2a(产线平板 kiosk + 设备登录 + 打卡,M-126)

把生产录入前移到一线平板的第一片。平板不是 `erp_user`,走独立设备账号。

**设备鉴权(沿用 `/superuser` + `set_module_visibility` 两个先例)**:
- 新增 **`/tablet`** kiosk 路径(`src/App.tsx` init 读 `pathname`,镜像 `/superuser`,绕过登录),渲染 `src/pages/tablet/TabletApp.tsx`。
- 设备登录经 SECURITY DEFINER RPC **`prod_tablet_login(p_code, p_pin)`**(授予 anon)校验、返回绑定产线;登录态存 `sessionStorage`。
- **`prod_line_device`** 仅对 `authenticated`(管理端)开放,**anon 不可直读 PIN**(BR-P5)。

**打卡(BR-P6)**:平板工作台顶栏显示绑定产线 + 班次切换;扫工牌/选工号 → 上岗(写 `prod_line_attendance.check_in_at`);"当前在岗"列表 = 该 (产线×日期×班次) `check_out_at IS NULL` 的操作员,可逐个下岗。工时 = Σ session 时长(M1.3 切换效率分母)。

**设备管理(管理端)**:`src/pages/production/DevicePage.tsx`(Planning 区)—— 生产管理自助创建/编辑/停用产线平板、设 PIN、绑定产线。权限 `production/device/{view,create,edit,disable}`。

**安全等级**:dev 级(PIN 明文、attendance 走 `dev_all`),与全站一致;生产硬化留后续。

## Phase 2 — M1.2b(平板生产录入 + 跨班续做车 + 停机实时,M-127)

平板从"只打卡"升级为"能录生产 + 记停机"。平板工作台改为 **Tab**:打卡 | 生产 | 停机(共享顶栏:绑定产线 + 班次切换 + 登出)。

- **生产**:扫/输工单号 → `findWorkOrderByNo` 带出产品;若上一 run 未完成最后一车,`getCarryOverCart` 提示"续做第 N 车?"(`cart_from=N`、`continues_prev=true`,D8);录车号/产出/废品/备注 + `final_cart_complete` → 提交 `submitTabletRun`(写 `prod_run`:`source='tablet'`、`device_id`、`machine_id`=设备线、`operator_id` 空)。下方"本班产出"列表。**与管理端 Daily Report 同写一张 `prod_run`**(方案 A 单一事实源,管理端按同一 日期+班次 即可看到 tablet 来源的行)。
  - **软提醒(不硬拦)**:本线本班无人上岗时,生产页显示琥珀提醒"请先打卡"(忘打卡不应丢产量;但工时归集靠在岗,故提醒)。
  - **车号去重(BR-P4,M-128)**:`prod_run` 触发器在写入时校验同一工单内 team run 车号不重叠(续做的交接车除外);冲突直接报错。
  - **管理端 Daily Report 信息补全**:列表新增「工单」列;「操作员/整线」列对 team/平板行(operator 空)展示 **TABLET + 当班在岗成员**(成员来自 `prod_line_attendance`,按 机台×日期×班次 取,经 `listShiftAttendance`),表示"整线产出、不挂单个操作员"(D2/D5),非缺数据;详情抽屉显示 日期·班次 上下文、工单号、整线成员;编辑 team 行时不再强制选操作员(保持 `operator_id` 空)。
- **停机(BR-P7)**:`prod_downtime_event` —— "开始停机"(选原因→开 event)/"结束停机"(算 `down_minutes`);或"补录停机"(原因+时长);本班停机列表。

**说明**:平板 run 本期 `work_hours=0`(无单操作员),故 Credit/Pcs·Hr 在平板 run 上暂空,M1.3 切 Σ打卡分母后补齐(D5)。

## 待办 / 后续阶段

- **M1.3** 工时自动汇总(分母切 Σ打卡,补齐平板 run 效率)+ 管理端实时产量看板 + 停机/run 审核视图。
- **M2** 生产数据 ↔ QC 数据(工单为键)关联分析/追溯。
- **M2** 生产数据 ↔ QC 数据(工单为键)关联分析/追溯。
- 分析看板(Daily production Analysis / Analysis)、与生产批次/库存联动、整屏网格批量录入等远期增强。

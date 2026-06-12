# Production 模块 Phase 2 开发 SPEC —— 生产线无纸化

> **状态**: 草案 v0.1（待评审）
> **作者**: —
> **日期**: 2026-06-11
> **前置**: Phase 1（Daily Report 录入)已落地 —— 见 `eee-main/docs/modules/12_production-daily-report.md`（M-122/M-123）
> **目标读者**: 产品 / 研发 / 客户生产管理

---

## 1. 背景与目标

### 1.1 现状（纸质 + Excel）
- 产量 / 工时填纸质记录单,字迹难辨、易丢失。
- 每日由生产管理手工汇总进 Excel(即 Phase 1 已数字化的 Daily Report),耗时且频繁出错。
- 停机原因(Form 451)班后手录,无实时记录。
- 生产数据与 QC 数据完全脱节,无法关联分析。
- 管理层无法实时查看当班产量,依赖人工汇报。

### 1.2 Phase 2 目标（全程线上系统）
1. 每条生产线配备**平板**,一线员工在平板上完成日报录入。
2. **输入工单号 → 产品 / 工序信息自动带出**,减少手填量。
3. **停机记录线上实时录入**,班次结束**自动汇总工时**。
4. 生产数据与 **Phase 1 QC 数据自动关联**。
5. 管理层**实时查看当班产量**,无需人工汇报。

### 1.3 与 Phase 1 的关系
Phase 1 把"生产管理填 Excel"这一步搬进了系统(`prod_daily_report`)。Phase 2 把**录入动作前移到一线、实时化**,并补上工单主数据、停机事件、实时看板与 QC 关联。两者**并存**:平板为主录入源,生产管理仍可补录 / 纠正(见 §6.5)。

---

## 2. 范围

### 2.1 本 SPEC 的里程碑划分
| 里程碑 | 内容 | 状态 |
|--------|------|------|
| **M1（本次优先)** | ① 工单主数据 + 工单驱动录入 ② 产线平板 + 生产 team 自助录入 ③ 停机实时录入 + 班次工时自动汇总 ④ 管理层实时产量看板 ⑤ 管理者审核 / 补录 | 本 SPEC 详述 |
| M2 | 生产数据 ↔ QC 数据自动关联(工单为键)、关联分析 / 追溯 | 本 SPEC 概述,后续细化 |
| M3 | 进阶看板(OEE/达成率趋势)、与库存产出/消耗联动、激活完整 MES(BOM/物料消耗) | 远期,仅列方向 |

### 2.2 Non-goals（本期不做）
- 不做完整 MES / MRP(物料消耗、BOM 反冲、投料追溯)—— 远期 M3。
- 不做工资 / 考勤结算(工时仅用于生产效率,不接 HR 薪酬)。
- 不做离线优先(offline-first)的复杂同步;平板默认在线(离线降级见 §12 开放问题)。
- 不替换 Phase 1 管理者录入页(并存)。

---

## 3. 角色与设备

| 角色 | 设备 | 职责 |
|------|------|------|
| **一线操作员 / 生产 team** | 产线共享**平板**(平板账号登录) | 选当班 team、输工单号、录产出/车号/停机,交班 |
| **生产管理(主管)** | PC / 平板 | 审核当班录入、补录 / 纠正、维护工单与 team 主数据 |
| **管理层** | PC / 大屏 | 实时看板,只读 |
| **计划员** | PC | 建 / 导入工单主数据 |

**关键身份模型(已确认)**:平板**按产线登录一个平板账号**;录入时绑定一个**当班生产 team**。team 含 1~N 名操作员(因为各产线人数不一)。产出与停机归属到 (产线 × 工单 × 班次 × team),而非单个工号。

---

## 4. 核心概念与术语

| 术语 | 含义 |
|------|------|
| **工单 Work Order** | 一次生产任务,有唯一工单号(如 `475T212-1`);绑定产品、计划量、工序/产线。Phase 2 起有主数据。 |
| **产线 / 机台 Machine** | 录入的物理单位(Inj 01、EXT 01/02…)。沿用 Phase 1 `prod_machine`,Phase 2 视为"产线/工位"。 |
| **生产 team** | 一组当班操作员的集合,挂在某产线上;是录入的归属主体。 |
| **班次 Shift** | 1st / 2nd / 3rd(沿用 Phase 1)。 |
| **生产记录 Run** | 一条(日期 × 班次 × 产线 × 工单 × team)的生产记录,含产出、车号、良品等。 |
| **停机事件 Downtime Event** | 一次实时停机记录(产线、起止/时长、原因)。替代纸质 Form 451。 |
| **工时汇总 Labor Hours** | 班次结束时,按 team 成员 × 在岗时长自动汇总。 |

---

## 5. 已确认的关键决策

| # | 决策点 | 结论 |
|---|--------|------|
| D1 | 工单来源 | **本系统内新建轻量工单主数据**;计划员建/批量导入;QC 工单后续对齐引用。 |
| D2 | 身份识别 | **产线平板账号 + 当班生产 team**(team 含数名操作员)。 |
| D3 | 与 Phase 1 日报 | **并存**;平板为主录入源,管理可补录/纠正。 |
| D4 | M1 优先级 | 平板录入(含工单带出)+ 停机实时录入与工时汇总 + 实时看板;QC 关联 → M2。 |

---

## 6. 领域数据模型(M1)

> 所有新表沿用现有约定:`prod_` 前缀、`uuid` 主键、`created_at/created_by`、`dev_all` RLS。

### 6.1 工单主数据 `prod_work_order`
| 字段 | 说明 |
|------|------|
| `id` uuid PK | |
| `work_order_no` text UNIQUE | 工单号(如 `475T212-1`) |
| `product_id` → `prod_product_master` | 决定自动带出的产品/工序/标准速率 |
| `machine_id` → `prod_machine` (nullable) | 计划产线(可空,允许临时改线) |
| `planned_qty` numeric (nullable) | 计划产量(pcs/lbs) |
| `process` text (nullable) | 工序/工艺(若产品自带可省) |
| `status` text | `open` / `in_progress` / `closed` / `cancelled` |
| `planned_date` date (nullable) | |

> 设计说明:这是"轻量"主数据 —— 只承载录入时**自动带出**与**校验**所需的最小字段,不引入 BOM/物料(那属 M3)。`work_order_no` 与 QC 的 `qc_production_lot.work_order_barcode` 同源同格式,M2 时对齐为引用键。

### 6.2 生产 team `prod_team` + `prod_team_member`
| `prod_team` | 说明 |
|------|------|
| `id` uuid PK | |
| `name` text | team 名称/编号 |
| `machine_id` → `prod_machine` (nullable) | 默认所属产线 |
| `shift` text (nullable) | 默认班次 |
| `active` boolean | |

| `prod_team_member` | 说明 |
|------|------|
| `team_id` → `prod_team` | |
| `operator_id` → `prod_operator` | 复用 Phase 1 花名册 |
| `active` boolean | 支持成员增减 |

> 成员关系按需可加生效日期(成员调动)。M1 先做简单成员表。

### 6.3 平板账号 `prod_line_device`(产线登录)
| 字段 | 说明 |
|------|------|
| `id` uuid PK | |
| `code` text UNIQUE | 设备/产线账号标识 |
| `machine_id` → `prod_machine` (nullable) | 绑定默认产线 |
| `pin_hash` text | 平板登录口令(轻量,非个人账号) |
| `active` boolean | |

> 设计说明:平板**不**进 `erp_user`(登录/权限账号表)。它是一个轻量产线设备账号,只能访问录入端 API。权限通过专门的 `production.tablet.*` 控制(见 §10)。

### 6.4 生产记录 `prod_run`（M1 核心交易表)
| 字段 | 说明 |
|------|------|
| `id` uuid PK | |
| `report_date` date | |
| `shift` text CHECK(1st/2nd/3rd) | |
| `machine_id` → `prod_machine` | 产线 |
| `work_order_id` → `prod_work_order` (nullable) | 工单(带出产品/工序) |
| `product_id` → `prod_product_master` (nullable) | 冗余存一份(工单带出/手选) |
| `team_id` → `prod_team` (nullable) | 当班 team |
| `device_id` → `prod_line_device` (nullable) | 录入来源平板 |
| `cart_from` / `cart_to` int | 车号 |
| `output_qty` numeric | 产出(pcs/lbs)—— **整条 run 记一次,不按人拆** |
| `defect_waste_lbs` numeric (nullable) | |
| `note` text | |
| `source` text | `tablet` / `manager`(并存来源标记,见 §6.5) |
| `status` text | `draft` / `submitted` / `reviewed` |
| 审计 | `created_at/by`、`updated_at/by` |

计算列(沿用 BR-P1,改由 `prod_run_view` 算):标准 Lbs/Hr、良品产出、Runner%、Pcs/Hr、Credit、总车数、周次等 —— **口径与 Phase 1 完全一致**,差异点是工时来源(见 §6.6 工时与开放问题 OQ-1)。

### 6.5 与 Phase 1 `prod_daily_report` 的并存策略
- 平板录入写入 **`prod_run`**(新的操作层、实时)。
- 生产管理的 Phase 1 页面**保留**,继续编辑 `prod_daily_report`(补录/纠正)。
- 提供一个**汇总视图**,把 `prod_run`(tablet 源)与 `prod_daily_report`(manager 源)按 (日期×班次×产线×工单) 合并呈现,标注来源、冲突高亮,供管理者审核。
- M1 不强一致;**`prod_run` 为新的事实源**,`prod_daily_report` 作为管理者补录/覆盖层。
- > ⚠️ 这是本期最大的架构取舍,详见开放问题 **OQ-2**(是否最终把 `prod_daily_report` 收敛为 `prod_run` 的视图)。

### 6.6 停机事件 `prod_downtime_event`
| 字段 | 说明 |
|------|------|
| `id` uuid PK | |
| `machine_id` → `prod_machine` | |
| `run_id` → `prod_run` (nullable) | 关联当时生产记录 |
| `report_date` / `shift` | |
| `reason_id` → `prod_downtime_reason` | 复用 Phase 1 双语原因 |
| `start_at` / `end_at` timestamptz (nullable) | 实时起止 |
| `down_minutes` numeric | 时长(起止算出或直接填) |
| `note` text | |
| 审计 | |

> 替代 Form 451 班后手录:支持"开始停机/结束停机"打点,或直接补一段时长。班次结束按 `prod_downtime_event` 汇总停机工时。

### 6.7 工时汇总
- 在岗工时来源:team 成员 × 班次在岗时长。
- M1 简化:录入时填/确认 team 成员与各自工时;**班次结束自动求和**(Σ 成员工时)= 当班该产线人工工时。
- 机台运行工时 = 班次时长 − 停机时长(由停机事件汇总)。
- > 效率口径(Credit / Pcs·Hr 的分母用"人工工时"还是"机台运行工时")见开放问题 **OQ-1**。

---

## 7. 功能需求（M1，用户故事 + 验收标准)

### F1 工单主数据管理（计划员 / 管理）
- US: 作为计划员,我能在系统里**新建 / 批量导入**工单(工单号、产品、计划量、产线、状态),供一线录入时带出。
- 验收:① 工单号唯一,重复报错;② 工单可改产品/产线/状态;③ 支持 CSV/Excel 批量导入;④ 关单后不再出现在录入可选列表(或标灰)。

### F2 产线平板登录 + team 选择
- US: 作为一线操作员,我在产线平板上用**产线账号**进入,开班时**选择当班 team**(或确认默认 team)。
- 验收:① 平板账号登录后默认锁定本产线;② 能选/换当班 team;③ 显示 team 成员清单;④ 平板会话不暴露管理端功能。

### F3 工单驱动录入（自动带出)
- US: 作为操作员,我**输入/扫工单号**,系统自动带出产品、工序、标准速率,我只需补产出、车号、备注。
- 验收:① 输工单号即带出产品描述/工序/标准 Lbs-Hr;② 工单号不存在时提示并允许手选产品(降级);③ 计算列(良品、Pcs/Hr、Credit、总车数…)实时显示,口径同 Phase 1 BR-P1;④ 提交写入 `prod_run`,`source='tablet'`。

### F4 停机实时录入
- US: 作为操作员,机台停机时我能**实时记一笔停机**(原因 + 起止/时长),不必等到班后。
- 验收:① 支持"开始/结束停机"打点或直接填时长;② 原因来自双语下拉;③ 一个班次可多笔;④ 与当前 run/产线关联;⑤ 写入 `prod_downtime_event`。

### F5 班次工时自动汇总
- US: 作为操作员/管理,班次结束时系统**自动汇总**该产线的人工工时与停机工时,无需手算。
- 验收:① 人工工时 = Σ team 成员工时;② 机台运行工时 = 班次时长 − 停机;③ 汇总结果在交班/看板可见;④ 可被管理者纠正。

### F6 管理层实时产量看板
- US: 作为管理层,我能**实时**看到当班各产线/机台的产量、效率(Credit)、停机,无需人工汇报。
- 验收:① 按产线/机台/产品维度展示当班产出、达成率、Credit、停机时长;② 数据准实时(轮询 ≤15s,或 realtime,见 OQ-3);③ 可切日期/班次;④ 只读。

### F7 管理者审核 / 补录（并存)
- US: 作为生产管理,我能审核平板录入、**补录**遗漏行、**纠正**错误数据。
- 验收:① 汇总视图按来源(tablet/manager)标注、冲突高亮;② 可编辑/补录;③ 留审计(谁改了什么)。

---

## 8. 关键工作流

```
计划员: 建/导入工单(prod_work_order)
   ↓
开班: 产线平板登录 → 选当班 team
   ↓
录入: 扫工单号 → 自动带出产品/工序 → 补产出/车号 → 提交(prod_run)
   ↓ (随时)
停机: 开始停机 → 结束停机 / 直接补时长(prod_downtime_event)
   ↓
交班: 系统自动汇总人工工时 + 停机 → 当班该产线小结
   ↓
实时: 管理层看板汇总当班全厂产出/效率/停机
   ↓
审核: 生产管理在汇总视图审核/补录/纠正
   ↓ (M2)
关联: 工单号为键,把 prod_run 与 QC 检验结果打通
```

---

## 9. UI / UX 概览

### 9.1 平板端（触屏优先、大按钮、少键盘)
- **登录页**:产线账号 + PIN。
- **开班/team 选择**:选当班 team,显示成员。
- **录入主页**:工单号输入(扫码/键入)→ 自动带出卡 → 产出/车号/备注;醒目"提交"。当班已录列表在下方。
- **停机按钮**:常驻"⏸ 停机"大按钮 → 选原因 → 开始/结束。
- **交班小结**:当班产出、工时、停机汇总。

### 9.2 管理 / 看板端（沿用现有 indigo 主题 + 侧边栏)
- **实时看板**:当班产线网格(产出/达成率/Credit/停机),自动刷新。
- **工单管理**:工单 CRUD + 导入。
- **team 管理**:team 与成员维护。
- **审核/补录**:Phase 1 日报页升级为"汇总 + 审核"视图(tablet/manager 双源合并)。

---

## 10. 权限模型

新增 `production` 模块下资源(沿用 `permissionStructure.ts` + 迁移种子):
| 资源 | 权限 |
|------|------|
| `work_order` | view / create / edit / close / import |
| `team` | view / manage |
| `tablet`（产线录入端) | submit_run / log_downtime（授予产线设备账号机制) |
| `run`（生产记录) | view / edit / review |
| `dashboard_live` | view |

> 产线平板用独立设备账号 + 受限权限,**不**走 `erp_user`。具体认证机制见 OQ-4。

---

## 11. 里程碑与排期建议

| 里程碑 | 交付 | 主要新建 |
|--------|------|----------|
| **M1.1** 工单 + 录入地基 | F1 工单主数据;F3 工单驱动录入(先在管理端跑通,验证带出/计算) | `prod_work_order` + 工单页 + run 写入 |
| **M1.2** 平板端 | F2 平板登录/team;F3 平板录入;F4 停机实时 | `prod_team(_member)`、`prod_line_device`、`prod_downtime_event`、平板 UI |
| **M1.3** 汇总与看板 | F5 工时汇总;F6 实时看板;F7 审核/补录 | `prod_run_view`、看板页、审核视图 |
| **M2** QC 关联 | 工单为键打通 QC 检验结果、关联分析/追溯 | QC↔run 关联视图/RPC |
| **M3** 远期 | OEE/趋势看板、库存产出消耗联动、完整 MES | 激活 `production_order`/`formula` |

---

## 12. 待决策的开放问题（评审时确认)

- **OQ-1 效率口径**:Credit / Pcs·Hr 的分母用"人工工时(Σteam 成员)"还是"机台运行工时(班次−停机)"?team 模式下 Phase 1 的"每人一行"口径要如何映射?(影响 `prod_run_view` 公式)
- **OQ-2 数据源收敛**:`prod_daily_report` 最终是否收敛为 `prod_run` 的派生视图,还是长期保留为管理者补录的独立层?(影响并存架构)
- **OQ-3 实时性**:看板用现有轮询(≤15s)即可,还是要上 Supabase realtime 订阅?
- **OQ-4 平板认证**:产线设备账号怎么落地 —— 自建 `prod_line_device` + PIN(走 anon + 受限 RPC),还是给产线开一个 `erp_user` 账号?
- **OQ-5 Form 451**:停机表 Form 451 是否有比现有 `prod_downtime_reason` 更多的字段(如责任部门、维修工、停机分类)需要纳入?(需要你提供 Form 451 样表)
- **OQ-6 工单来源细节**:你们现在工单实际在哪生成(纸质工单卡 / 外部系统 / 暂无)?是否需要批量导入的初始数据格式约定?
- **OQ-7 产出归属**:同一产线多 team / 跨班工单接续时,产出与车号如何归属与防重?

---

## 13. 验收与测试策略

- **口径回归**:沿用 Phase 1 做法,用历史 Excel 行验证 `prod_run_view` 计算列 1:1。
- **端到端**:建工单 → 平板录入(带出/提交) → 停机打点 → 交班汇总 → 看板呈现 → 管理审核补录,全链路跑通。
- **权限**:平板账号只能录入、不能进管理;管理能审核/补录;看板只读。
- **回归**:Phase 1 日报页与 QC/Packaging 不受影响;`npm run lint` 通过。

---

## 附:本期将新增/改动的关键对象（预估)
- 新表:`prod_work_order`、`prod_team`、`prod_team_member`、`prod_line_device`、`prod_run`、`prod_downtime_event`;视图 `prod_run_view`、`prod_shift_summary_view`。
- 前端:平板端(登录/team/录入/停机/交班)、工单管理页、team 管理页、实时看板页、审核/补录视图;`permissionStructure.ts`、`ProductionModule.tsx` 导航。
- 服务:`productionWorkOrderApi.ts`、`productionRunApi.ts`、`productionTabletApi.ts`、`productionDashboardApi.ts`。
- 文档:`eee-main/docs/modules/12_production-daily-report.md` 扩写、`docs/database/03...` 迁移条目、本 SPEC 维护。

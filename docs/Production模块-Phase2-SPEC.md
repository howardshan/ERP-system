# Production 模块 Phase 2 开发 SPEC —— 生产线无纸化

> **状态**: v0.4 —— M1 决策(D1–D10)已拍板。**M1.1 已落地(M-125)**;**M1.2a(产线平板 kiosk + 设备登录 + 打卡上岗/下岗)已落地(M-126)**;下一步 M1.2b 平板生产录入 + 停机实时。
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
| **M1（本次优先)** | ① 工单主数据 + 工单驱动录入 ② 产线平板 + 员工打卡自助录入 ③ 停机实时录入 + 班次工时自动汇总 ④ 管理层实时产量看板 ⑤ 管理者审核 / 补录 | 本 SPEC 详述 |
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
| **一线操作员** | 产线共享**平板**(产线设备账号常驻登录) | 上岗**打卡登记**、输工单号、录产出/车号/停机,下岗登出 |
| **生产管理(主管)** | PC / 平板 | 审核当班录入、补录 / 纠正、维护工单主数据 |
| **管理层** | PC / 大屏 | 实时看板,只读 |
| **计划员** | PC | 建/维护工单主数据 |

**关键身份模型(已确认)**:平板用**产线专用设备账号常驻登录**(非个人账号,见 D2/OQ-4)。员工通过**打卡**在某产线登记上岗 / 下岗 —— **「生产 team」不是固定实体、无编号、无成员主数据**,而是一个**打卡点**:某产线此刻的 team = 当前已登记上岗、尚未登出的操作员集合。上岗/下岗各自陆续进行,不要求整组同进同出。产出/停机归属到 (产线 × 工单 × 班次 × 日期),工时来自每人的打卡 session。

---

## 4. 核心概念与术语

| 术语 | 含义 |
|------|------|
| **工单 Work Order** | 一次生产任务,有唯一工单号(如 `475T212-1`);绑定产品、计划量、工序/产线。Phase 2 起有主数据。 |
| **产线 / 机台 Machine** | 录入的物理单位(Inj 01、EXT 01/02…)。沿用 Phase 1 `prod_machine`,Phase 2 视为"产线/工位"。 |
| **打卡 / 上岗登记 Attendance** | 操作员在某产线"上岗/下岗"的一次登记(session),决定其在该班该线的在岗工时。 |
| **生产 team(打卡点)** | 非实体、无编号:某产线某时刻"已上岗未下岗"的操作员集合。仅用于知道"现在这条线有哪几个人"。 |
| **班次 Shift** | 1st / 2nd / 3rd(沿用 Phase 1)。 |
| **生产记录 Run** | 一条(日期 × 班次 × 产线 × 工单)的生产记录,含产出、车号、良品等。 |
| **停机事件 Downtime Event** | 一次实时停机记录(产线、起止/时长、原因)。替代纸质 Form 451。 |
| **工时汇总 Labor Hours** | 班次结束时,按该产线**所有打卡 session 的在岗时长求和**(OQ-1)。 |

---

## 5. 已确认的关键决策

| # | 决策点 | 结论 |
|---|--------|------|
| D1 | 工单来源 | **本系统内新建轻量工单主数据**。工单实际来自**外部系统**;M1 由计划员在系统内手动建/维护(镜像外部工单),与外部系统的导入/对接**延后**(暂不定导入格式)。 |
| D2 | 身份识别 | **产线专用设备账号常驻登录平板** + 员工**打卡上岗/下岗**(非个人账号,见 OQ-4)。「生产 team」是打卡点,非固定实体。 |
| D3 | 与 Phase 1 日报 | **并存**(诉求=管理可补录/纠正)。底层存储**已定方案 A —— 单一事实源**:`prod_run` 为唯一物理表,`prod_daily_report` 收敛为视图(见 §6.5 / OQ-2)。 |
| D4 | M1 优先级 | 平板录入(含工单带出)+ 停机实时录入与工时汇总 + 实时看板;QC 关联 → M2。 |
| D5 | 工时口径(OQ-1) | Credit / Pcs·Hr 分母 = **人工工时(该产线所有打卡 session 之和)**。 |
| D6 | 看板实时性(OQ-3) | 现有**轮询 ≤15s + 手动刷新按钮**,暂不上 realtime。 |
| D7 | 停机字段(OQ-5) | 沿用现有 `prod_downtime_reason`,**暂不加**责任部门/维修工等字段。 |
| D8 | 跨班半车接续(OQ-7) | run 记 **`final_cart_complete`**;下一班扫工单时**系统自动识别未完成车并提示续做**;工单总车数按车号去重(max−min+1),产出按 run 累加,均不重复计。 |
| D9 | 扫码/键入(OQ-8) | 平板配条码枪。**工单号有条码 → 扫或键**;**工牌无条码 → 选工号/搜姓名**。所有扫码框同时支持扫与打,无需切模式。 |
| D10 | 工序来源(OQ-9) | **工序由产品决定(情况 A)**:`prod_work_order` 不加 `process`;自动带出工序经 `product_id` 读 `prod_product_master.process`。 |

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
| `status` text | `open` / `in_progress` / `closed` / `cancelled` |
| `planned_date` date (nullable) | |

> 设计说明:这是"轻量"主数据 —— 只承载录入时**自动带出**与**校验**所需的最小字段,不引入 BOM/物料(那属 M3)。`work_order_no` 与 QC 的 `qc_production_lot.work_order_barcode` 同源同格式,M2 时对齐为引用键。
> **工序来源(OQ-9 已定:情况 A)**:工序由产品决定(INJ/EXT 等),本表**不加** `process` 字段;录入时"自动带出工序"= 经 `product_id` 读 `prod_product_master.process`。

### 6.2 产线打卡 / 上岗登记 `prod_line_attendance`
> 取代原 team 主数据设计 —— team 是打卡点而非实体(见 §3/§4)。一行 = 一个操作员在某产线某班次的一段在岗 session。

| 字段 | 说明 |
|------|------|
| `id` uuid PK | |
| `operator_id` → `prod_operator` | 复用 Phase 1 花名册(打卡=扫工牌/选工号) |
| `machine_id` → `prod_machine` | 上岗所在产线 |
| `report_date` date / `shift` text | |
| `check_in_at` timestamptz | 上岗时间 |
| `check_out_at` timestamptz (nullable) | 下岗时间(空=仍在岗) |
| `work_minutes` numeric (derived) | = check_out − check_in;未登出时按当前/班次结束估算 |
| `device_id` → `prod_line_device` (nullable) | 打卡来源平板 |
| 审计 | `created_at/by` |

- 某产线"当前 team" = 该线 `check_out_at IS NULL` 的 session 集合。
- 上岗/下岗各自陆续,不要求同进同出。
- 班次该产线人工工时 = Σ 该线当班 session 的 `work_minutes`(→ D5/OQ-1 的效率分母)。

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
| `work_order_id` → `prod_work_order` (nullable) | 工单 → 自动带出产品/工序 |
| `product_id` → `prod_product_master` (nullable) | 工单带出 / 无工单时手选,冗余存一份 |
| `device_id` → `prod_line_device` (nullable) | 录入来源平板(无 `team_id` —— team 非实体) |
| `cart_from` / `cart_to` int | 本 run 实际作业的车号段 |
| `final_cart_complete` boolean | 交班时最后一车是否填满(默认 true);false=留给下一班续做 |
| `continues_prev` boolean | 本 run 首车是否为上一班未完成车的续做(系统自动判定) |
| `output_qty` numeric | 产出(pcs/lbs)—— **整条 run 记一次,不按人拆** |
| `defect_waste_lbs` numeric (nullable) | |
| `note` text | |
| `source` text | `tablet` / `manager`(单表区分来源,见 §6.5) |
| `status` text | `draft` / `submitted` / `reviewed` |
| 审计 | `created_at/by`、`updated_at/by` |

计算列(沿用 BR-P1,由 `prod_run_view` 算):标准 Lbs/Hr、良品产出、Runner%、Pcs/Hr、Credit、总车数、周次等 —— **口径与 Phase 1 完全一致**;Credit/Pcs·Hr 的工时分母 = 该 (产线×班次) 的**人工工时**(Σ 打卡 session,D5)。

> **跨班半车接续(OQ-7 / D8)**:
> - run 记 `final_cart_complete`;若某 run 该值为 false,该工单下一条 run 扫工单时,平板**自动提示「上次第 N 车未完成,继续?」**,确认后 `cart_from = N`、`continues_prev = true`。
> - **产出累加**:工单实际产出 = 其名下所有 run 的 `output_qty` 之和(各班只记自己产的量,天然不重复)。
> - **车数去重**:工单总车数 = 该工单所有 run 的 `MAX(cart_to) − MIN(cart_from) + 1`(续做的交接车按一辆计,不重复)。
> - **校验**:同一工单内车号段除"续做的交接车"外不应重叠。

### 6.5 与 Phase 1 `prod_daily_report` 的关系 —— 推荐单一事实源(方案 A)
- **推荐(方案 A)**:`prod_run` 为**唯一物理事实表**;平板写它、管理也直接改它(`source` 区分来源、留审计)。Phase 1 的 `prod_daily_report` **收敛为指向 `prod_run` 的读视图**,管理页改为编辑 `prod_run`。优点:数据一份、不会重复计/对不上、看板恒一致。代价:Phase 1 表+页面一次性迁移改造。
- 备选(方案 B):`prod_run` 与 `prod_daily_report` 双表并存 + 合并视图。改造最小,但**同一笔生产可能两边都有**,需去重对账,长期口径易漂移。
- > ✅ **已定:方案 A**(OQ-2)。`prod_daily_report` 收敛为 `prod_run` 视图,管理页改编辑 `prod_run`。下文 §11 排期按方案 A 估算。

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
- 人工工时来源:**`prod_line_attendance` 打卡 session**(谁、哪条线、上岗/下岗时间)。
- 班次结束**自动求和** = Σ 该产线当班所有 session 的 `work_minutes` = 当班该产线人工工时。
- 机台运行工时 = 班次时长 − 停机时长(由 `prod_downtime_event` 汇总)。
- **效率分母 = 人工工时(D5/OQ-1 已定)**;机台运行工时作为辅助指标在看板展示。

---

## 7. 功能需求（M1，用户故事 + 验收标准)

### F1 工单主数据管理（计划员 / 管理）
- US: 作为计划员,我能在系统里**新建/维护**工单(工单号、产品、计划量、产线、状态),供一线录入时带出。工单源自外部系统,M1 手动镜像录入,外部对接延后。
- 验收:① 工单号唯一,重复报错;② 工单可改产品/产线/状态;③ 关单后不再出现在录入可选列表(或标灰);④(延后)外部导入接口。

### F2 产线平板登录 + 打卡上岗
- US: 作为一线操作员,我在产线平板上(产线设备账号常驻登录)**打卡上岗**(扫工牌/选工号),完工时**打卡下岗**;同线多人各自陆续打卡。
- 验收:① 平板用产线设备账号,锁定本产线;② 操作员扫工牌/选工号即上岗,写 `prod_line_attendance`(`check_in_at`);③ 下岗写 `check_out_at`;④ 平板显示"当前在岗"列表(=该线未登出 session);⑤ 平板会话不暴露管理端功能。

### F3 工单驱动录入（自动带出)
- US: 作为操作员,我**扫码或键入工单号**,系统自动带出产品、工序、标准速率,我只需补产出、车号、备注。
- 验收:① 工单号支持**扫码枪扫 + 手输**(D9);② 输工单号即带出产品描述/工序/标准 Lbs-Hr;③ 工单号不存在时提示并允许手选产品(降级);④ **续做提示**:若该工单上一 run 未完成最后一车,弹「上次第 N 车未完成,继续?」,确认则 `cart_from=N`、`continues_prev=true`(D8);⑤ 计算列实时显示,口径同 Phase 1 BR-P1;⑥ 交班时可标 `final_cart_complete=false`;⑦ 提交写入 `prod_run`,`source='tablet'`。

### F4 停机实时录入
- US: 作为操作员,机台停机时我能**实时记一笔停机**(原因 + 起止/时长),不必等到班后。
- 验收:① 支持"开始/结束停机"打点或直接填时长;② 原因来自双语下拉;③ 一个班次可多笔;④ 与当前 run/产线关联;⑤ 写入 `prod_downtime_event`。

### F5 班次工时自动汇总
- US: 作为操作员/管理,班次结束时系统**自动汇总**该产线的人工工时与停机工时,无需手算。
- 验收:① 人工工时 = Σ 该产线当班打卡 session 在岗时长;② 机台运行工时 = 班次时长 − 停机;③ 汇总结果在交班/看板可见;④ 可被管理者纠正。

### F6 管理层实时产量看板
- US: 作为管理层,我能**实时**看到当班各产线/机台的产量、效率(Credit)、停机,无需人工汇报。
- 验收:① 按产线/机台/产品维度展示当班产出、达成率、Credit、停机时长;② 数据准实时(轮询 ≤15s,或 realtime,见 OQ-3);③ 可切日期/班次;④ 只读。

### F7 管理者审核 / 补录（并存)
- US: 作为生产管理,我能审核平板录入、**补录**遗漏行、**纠正**错误数据。
- 验收:① 汇总视图按来源(tablet/manager)标注、冲突高亮;② 可编辑/补录;③ 留审计(谁改了什么)。

---

## 8. 关键工作流

```
计划员: 建/维护工单(prod_work_order,镜像外部工单)
   ↓
上岗: 产线平板(设备账号常驻) → 操作员扫工牌打卡上岗(prod_line_attendance)
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
- **登录页**:产线设备账号 + PIN(常驻登录,锁定本产线)。
- **打卡区**:扫工牌/选工号 → 上岗;常驻显示"当前在岗"名单,各自可下岗。
- **录入主页**:工单号(**扫码枪扫 / 键入**)→ 自动带出卡 →(若有未完成车则弹"续做第 N 车?")→ 产出/车号/备注;醒目"提交"。当班已录列表在下方。
- **停机按钮**:常驻"⏸ 停机"大按钮 → 选原因 → 开始/结束。
- **交班小结**:当班产出、工时(Σ打卡)、停机汇总。

### 9.2 管理 / 看板端（沿用现有 indigo 主题 + 侧边栏)
- **实时看板**:当班产线网格(产出/达成率/Credit/停机),轮询 ≤15s + 手动刷新按钮(D6)。
- **工单管理**:工单 CRUD(M1 手动;外部导入延后)。
- **打卡 / 工时**:查看各产线当班在岗与工时汇总,可纠正。
- **审核/补录**:Phase 1 日报页升级为"汇总 + 审核"视图(单一事实源 `prod_run`,`source` 标注 tablet/manager)。

---

## 10. 权限模型

新增 `production` 模块下资源(沿用 `permissionStructure.ts` + 迁移种子):
| 资源 | 权限 |
|------|------|
| `work_order` | view / create / edit / close |
| `attendance`（打卡/工时) | view / manage(管理者纠正) |
| `tablet`（产线录入端) | check_in_out / submit_run / log_downtime（授予产线设备账号机制) |
| `run`（生产记录) | view / edit / review |
| `dashboard_live` | view |

> 产线平板用独立设备账号 + 受限权限,**不**走 `erp_user`(D2/OQ-4)。

---

## 11. 里程碑与排期建议

| 里程碑 | 交付 | 主要新建 |
|--------|------|----------|
| **M1.1** 工单 + 录入地基 ✅ **已落地(M-125)** | F1 工单主数据;F3 工单驱动录入;方案 A 收敛 `prod_run` | `prod_work_order` + 工单页 + `prod_run`/`prod_run_view` + rollup 视图 |
| **M1.2a** 平板 kiosk + 打卡 ✅ **已落地(M-126)** | F2 设备登录 + 打卡上岗/下岗;设备管理页 | `prod_line_device`、`prod_line_attendance`、`prod_tablet_login` RPC、`/tablet` kiosk、DevicePage |
| **M1.2b** 平板录入 + 停机 | F3 平板生产录入(source=tablet)+ 续做车(D8);F4 停机实时 | `prod_downtime_event`、平板录入/停机 UI |
| **M1.3** 汇总与看板 | F5 工时汇总;F6 实时看板;F7 审核/补录 | `prod_run_view`、看板页、审核视图 |
| **M2** QC 关联 | 工单为键打通 QC 检验结果、关联分析/追溯 | QC↔run 关联视图/RPC |
| **M3** 远期 | OEE/趋势看板、库存产出消耗联动、完整 MES | 激活 `production_order`/`formula` |

---

## 12. 开放问题状态

### 已定（→ 见 §5 决策表)
- **OQ-1 效率口径** ✅ 分母 = 人工工时(Σ 打卡 session)。→ D5
- **OQ-2 数据源架构** ✅ **方案 A 单一事实源**:`prod_daily_report` 收敛为 `prod_run` 视图。→ D3 / §6.5
- **OQ-3 实时性** ✅ 轮询 ≤15s + 手动刷新,暂不上 realtime。→ D6
- **OQ-4 平板认证** ✅ 产线专用设备账号(`prod_line_device` + PIN),员工打卡上岗。→ D2
- **OQ-5 Form 451** ✅ 暂沿用现有停机原因,不加字段。→ D7
- **OQ-6 工单来源** ✅ 来自外部系统;M1 系统内手动维护,外部对接/导入延后。→ D1
- **OQ-7 跨班半车接续** ✅ run 记 `final_cart_complete`;下一班扫工单自动提示续做;产出累加、车数去重。→ D8 / §6.4
- **OQ-8 扫码/键入** ✅ 工单号扫或键;工牌无码 → 选工号/搜姓名;扫码框同时支持扫与打。→ D9
- **OQ-9 工序来源** ✅ **情况 A** —— 工序由产品决定;`prod_work_order` 不加 `process`,经产品读 `process`。→ D10

### 仍待决策
- 暂无。M1 范围内的关键设计点均已拍板,可进入 M1.1 详细开发计划。

---

## 13. 验收与测试策略

- **口径回归**:沿用 Phase 1 做法,用历史 Excel 行验证 `prod_run_view` 计算列 1:1。
- **端到端**:建工单 → 平板录入(带出/提交) → 停机打点 → 交班汇总 → 看板呈现 → 管理审核补录,全链路跑通。
- **权限**:平板账号只能录入、不能进管理;管理能审核/补录;看板只读。
- **回归**:Phase 1 日报页与 QC/Packaging 不受影响;`npm run lint` 通过。

---

## 附:本期将新增/改动的关键对象（预估)
- 新表:`prod_work_order`、`prod_line_attendance`、`prod_line_device`、`prod_run`、`prod_downtime_event`;视图 `prod_run_view`、`prod_shift_summary_view`。
- 前端:平板端(登录/打卡/录入/停机/交班)、工单管理页、打卡/工时页、实时看板页、审核/补录视图;`permissionStructure.ts`、`ProductionModule.tsx` 导航。
- 服务:`productionWorkOrderApi.ts`、`productionRunApi.ts`、`productionTabletApi.ts`、`productionDashboardApi.ts`。
- 文档:`eee-main/docs/modules/12_production-daily-report.md` 扩写、`docs/database/03...` 迁移条目、本 SPEC 维护。

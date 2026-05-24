# Warehouse & Inventory 模块开发计划书

> **文档类型：** 内部开发与交付计划  
> **依据文档：** `files/data-model.md`、`files/business-rules.md`、`eee-main` 初始 schema、QC/包装模块文档  
> **版本：** v1.0  
> **更新日期：** 2026-05-24  
> **已确认决策：** 见 [§2 已确认决策记录](#2-已确认决策记录)（项目组 2026-05-24）

---

## 目录

1. [文档目的与定位](#1-文档目的与定位)
2. [已确认决策记录](#2-已确认决策记录)
3. [决策评审摘要](#3-决策评审摘要)
4. [目标与成功标准](#4-目标与成功标准)
5. [仓库与库位架构（定稿建议）](#5-仓库与库位架构定稿建议)
6. [范围定义](#6-范围定义)
7. [业务规则（Warehouse 模块）](#7-业务规则warehouse-模块)
8. [与 QC / 包装模块集成](#8-与-qc--包装模块集成)
9. [批号规则（v1.0 占位）](#9-批号规则v10-占位)
10. [功能清单与优先级](#10-功能清单与优先级)
11. [数据模型与 RPC 规划](#11-数据模型与-rpc-规划)
12. [页面与路由规划](#12-页面与路由规划)
13. [期初库存导入方案](#13-期初库存导入方案)
14. [开发阶段与里程碑](#14-开发阶段与里程碑)
15. [测试与验收](#15-测试与验收)
16. [风险、假设与待客户确认项](#16-风险假设与待客户确认项)
17. [附录：任务 Checklist](#17-附录任务-checklist)

---

## 1. 文档目的与定位

### 1.1 目的

在 **整套 ERP 替换** 路线下，建设 **Warehouse & Inventory** 运营库存中枢，实现：

- 可审计的 **只增库存流水**（`inventory_transaction`）；
- **批次 + 库位** 三维库存；
- 与 **QC 放行强制同步 `lot`**；
- 为后续 Production、Sales、AP/AR、成本核算提供统一数据源。

### 1.2 与现有模块关系

```text
files/ 蓝图（运营先于财务）          eee-main 现状
        │                              │
        ├─ 主数据/库存/采购/生产        ├─ 财务 GL ✅
        │                              ├─ QC + 包装 ✅（独立 qc_*）
        └─ 本计划：补齐库存层 ◄────────┘─ Warehouse 🔲
```

### 1.3 本计划不是什么

| 是 | 不是 |
|----|------|
| 可上线的库存 v1.0 | 完整采购 PO、生产、销售模块 |
| 与 QC 集成的批次库存 | 替换 QC 烘干炉位管理（仍由 QC 负责） |
| 期初导入与日常收货/调拨 | 自动财务凭证、MRP、全链路召回报表 v1.0 |

### 1.4 与其他文档的关系

```text
files/README.md / data-model.md / business-rules.md  ──►  ERP 蓝图与 BR
QC模块起步与设计指南.md                              ──►  制造现场与 QC 闭环
eee-main/docs/modules/09_qc.md, 10_packaging.md     ──►  已实现模块规格
         │
         ▼
Warehouse模块开发计划书.md（本文）                   ──►  库存模块 v1.0 交付计划
```

---

## 2. 已确认决策记录

| 编号 | 决策 | 记录日期 |
|------|------|----------|
| D-W01 | 逻辑库区：原料 / 待烘干 / 烘干区 / 待检 / 待包装(合格) / 不合格 / 成品（见 §5） | 2026-05-24 |
| D-W02 | 批号规则 v1.0 使用占位规则，与 QC 批号 1:1 对齐，客户定稿后替换生成器 | 2026-05-24 |
| D-W03 | v1.0 允许 **无 PO 收货**，系统必须显式标注 `direct` | 2026-05-24 |
| D-W04 | **QC 放行必须同步 ERP `lot`**（事务内，失败则 QC 不放行） | 2026-05-24 |
| D-W05 | 期初导入 **可含待检**（quarantine / on_hold） | 2026-05-24 |

---

## 3. 决策评审摘要

### 3.1 仓库结构划分（D-W01）

按现场工序划分的 7 类区域 **业务上正确**，与 QC 流程、包装模块一致。

**实现建议：** 使用 **1 个 `warehouse`（主工厂）+ 7 个 `location`（逻辑库区）**，而非 7 个独立 `warehouse` 记录。烘干炉 **cell 级** 数量由 QC（`qc_drying_location`）管理；ERP 仅设汇总库位「烘干区 WIP」，在进/出烘干时过账调拨。

### 3.2 批号规则（D-W02）

v1.0 采用占位规则（§9），与 `qc_production_lot.lot_number` **先 1:1 同号**；客户定稿后只改 `wh_generate_lot_number` 函数。

### 3.3 无 PO 收货（D-W03）

合理。`goods_receipt.po_id` 可为 NULL；须增加 `receipt_type = 'direct'` 并在 UI/列表 **醒目标注**。

### 3.4 QC 放行同步 lot（D-W04）

**必要。** 整套 ERP 替换下，Packaging、发货、成本均依赖 `lot` + `inventory_transaction`。

### 3.5 期初含待检（D-W05）

合理。导入时按库位 + `lot.status` 写入；使用 `OPENING_BALANCE` 调整原因码，不伪造历史流水。

---

## 4. 目标与成功标准

### 4.1 业务目标

| 编号 | 目标 |
|------|------|
| WH-G01 | 任一 SKU/批次/库区可查 **实时余额** |
| WH-G02 | 原料可无 PO 收货，且审计上可区分来源 |
| WH-G03 | QC 放行后，待包装库区 **ERP 库存与 QC 一致** |
| WH-G04 | 不合格品进入不合格库区，**不可被发货/领用**（BR-5、BR-6a） |
| WH-G05 | 期初导入后，现场待检/可用量与 Excel 对账误差在约定阈值内 |

### 4.2 技术目标

- 所有库存写入经 **SECURITY DEFINER RPC**；
- `inventory_balance` 与流水 **100% 一致**（可 `wh_rebuild_balance` 修复）；
- 扩展 `permissionStructure.warehouse` 与 RLS；
- 新增 `eee-main/docs/modules/11_warehouse-inventory.md` 与 migration 索引。

### 4.3 v1.0 验收标准（必须全部满足）

- [ ] 7 个逻辑库区在系统中可配置且已有默认 seed
- [ ] 完成：无 PO 收货 → 待检库位 → QC 放行 → 待包装库位 数量正确
- [ ] 完成：调拨、调整、冲销收货；负库存被拒绝
- [ ] 完成：期初导入（含 quarantine）+ 导入报告
- [ ] QC `qc_release_passed_sub_lot` 失败时无「已放行但无 lot」脏数据
- [ ] 权限：收货员/仓库主管/QC 角色分离可演示

---

## 5. 仓库与库位架构（定稿建议）

### 5.1 推荐主数据结构

| 层级 | v1.0 建议 |
|------|-----------|
| `warehouse` | **1 条**：`WH-MAIN` 主工厂 |
| `location` | **7 条**，`location_type` 映射如下 |

| 代码（占位） | 名称 | `location_type` | 对应业务划分 |
|-------------|------|-----------------|-------------|
| `LOC-RM` | 原材料仓 | `storage` | 原材料仓 |
| `LOC-PRE-DRY` | 待烘干仓 | `production` | 待烘干仓 |
| `LOC-DRY-WIP` | 烘干区（汇总） | `production` | 烘干仓（与 QC 炉位联动过账） |
| `LOC-QC-PENDING` | 待检仓 | `quarantine` | 烘干完成后待检 |
| `LOC-PACK-STAGE` | 待包装/合格仓 | `storage` | 待包装仓（合格） |
| `LOC-NG` | 不合格仓 | `quarantine` | 不合格仓 |
| `LOC-FG` | 成品仓 | `storage` | 成品仓 |

### 5.2 数量过账时点（与 QC 分工）

| 业务动作 | 负责模块 | 库存过账（v1.0） |
|----------|----------|------------------|
| 原料收货 | Warehouse | → `LOC-RM` 或 RM quarantine |
| 产线完工上车（待烘干） | QC Production | 可选：PRE-DRY 入库（若已有 lot） |
| 进烘干房 | QC check-in | `transfer`：PRE-DRY → LOC-DRY-WIP（按车 1 次） |
| 出烘干房 | QC check-out | `transfer`：DRY-WIP → LOC-QC-PENDING |
| 检验合格放行 | QC release | **D-W04**：`lot`→`available` + PENDING → PACK-STAGE |
| 检验不合格 | QC hold | → `LOC-NG`，`lot`→`on_hold` |
| 包装出库 | Packaging | PACK-STAGE →（可选经 LOC-FG）→ `ship` 扣减（v1.1） |

**原则：** 烘干炉 **cell 级** 不记 ERP 数量；**车/子批** 级与 `lot` 1:1 后记账。

### 5.3 逻辑库区 ↔ QC 状态 ↔ ERP 批次状态

| 逻辑库区 | QC `qc_drying_sub_lot.status`（典型） | ERP `lot.status` |
|----------|--------------------------------------|------------------|
| 原材料仓 | — | `quarantine` → `available`（来料放行后） |
| 待烘干仓 | `created` | `available`（production 类库位） |
| 烘干仓（汇总） | `drying`, `awaiting_recheck` | `available`（WIP，见 BR-W1） |
| 待检仓 | `pending`, `inspecting` | `quarantine` |
| 待包装/合格仓 | 放行后 `closed`（含 `released_at`） | `available` |
| 不合格仓 | `hold`, `disposing` | `on_hold` / `rejected` |
| 成品仓 | `dispatched`（包装后） | `available` → 出库后 `consumed` |

---

## 6. 范围定义

### 6.1 In Scope（v1.0）

- 主数据：物料 `item`、仓库/库位（7 区）、UOM（seed）
- 批次：`lot` 全生命周期（与 BR-6a 一致）
- 收货：无 PO / 有 PO 预留字段；**direct 醒目标注**
- 调拨、库存调整、余额与流水查询
- 批次放行/拒收（COA 简表或对接 QC 结果）
- QC 集成：`item_id` 映射、`lot_id` 绑定、放行同步
- 期初导入（含待检）
- 权限、RLS、审计字段

### 6.2 Out of Scope（v1.0，写入 v1.1+）

- 完整 PO 流程 UI
- 生产领料/产出（Production 模块）
- 销售发货、FEFO
- 自动 GL 凭证、加权平均成本自动计算
- 召回正向/反向追溯 UI（仅预留 `lot` 链路）
- 多工厂、多公司

---

## 7. 业务规则（Warehouse 模块）

在全局 BR-1～BR-6a、BR-11（见 `files/business-rules.md`）基础上，增加本模块规则：

| 编号 | 规则 |
|------|------|
| **BR-W1** | 烘干区库存以 **子批/车** 为单位过账；炉位仅 QC 管理，ERP 不记 cell 数量 |
| **BR-W2** | 无 PO 收货：`goods_receipt.po_id IS NULL` 且 `receipt_type = 'direct'` |
| **BR-W3** | QC 放行成功条件：`wh_sync_release_from_qc(sub_lot_id)` 返回成功 |
| **BR-W4** | `LOC-NG` / `on_hold` / `rejected` 批次禁止 `issue`/`ship`/`production_consume` |
| **BR-W5** | 待检库区批次 `lot.status` 必须为 `quarantine` 直至放行 |
| **BR-W6** | 期初导入行必须带 `import_batch_id` 与原因码 `OPENING_BALANCE` |

---

## 8. 与 QC / 包装模块集成

### 8.1 Schema 扩展（migration）

| 变更 | 说明 |
|------|------|
| `qc_product_sku.item_id` → `item(id)` | 主数据统一 |
| `qc_drying_sub_lot.lot_id` → `lot(id)` | 子批绑定 ERP 批 |
| `goods_receipt.receipt_type` | `po` / `direct` |
| 触发器：禁止 UPDATE/DELETE `inventory_transaction` | BR-1 |

### 8.2 关键 RPC：`wh_sync_release_from_qc`

```text
wh_sync_release_from_qc(p_sub_lot_id uuid)
  1. 校验 sub_lot 检验通过且已有 lot_id
  2. wh_release_lot → available
  3. transfer: LOC-QC-PENDING → LOC-PACK-STAGE
  4. 写 qc_quality_event / 关联字段
  失败 → 整个事务回滚，QC 不更新为 closed
```

### 8.3 包装模块（v1.0 末 / v1.1）

`pkg_dispatch_carts` 增加 `wh_post_ship_from_packaging`，从待包装/成品库扣减并写 `ship` 流水。

---

## 9. 批号规则（v1.0 占位）

| 类型 | 规则 | 示例 |
|------|------|------|
| 原料 | `RM-{YYYYMMDD}-{SEQ4}` | `RM-20260524-0001` |
| 成品/WIP | `FG-{item.sku}-{YYYYMMDD}-{SEQ4}` | `FG-CHICK-20260524-0003` |
| 与 QC | 创建 `qc_production_lot` 时同步生成 `lot`，**同号** | 客户定稿后可切换 |

实现函数：`wh_generate_lot_number(p_item_id, p_source_type)`。

---

## 10. 功能清单与优先级

| 优先级 | 功能 | 说明 |
|--------|------|------|
| **P0** | 库位主数据（7 区 seed） | §5 |
| **P0** | 物料主数据 CRUD | 关联 `qc_product_sku.item_id` |
| **P0** | 无 PO 收货 + direct 标识 | D-W03 |
| **P0** | 库存流水/余额查询 | |
| **P0** | 调拨、调整 | |
| **P0** | `wh_sync_release_from_qc` | D-W04 |
| **P0** | 期初导入 | D-W05 |
| **P1** | 有 PO 收货 | v1.1 完整 PO UI |
| **P1** | 临期预警列表 | `expiry_date` |
| **P1** | 包装出库写 `ship` 流水 | 对接 Packaging |
| **P2** | 简单追溯只读页 | 依赖 Production/Shipment 后完善 |

---

## 11. 数据模型与 RPC 规划

### 11.1 核心 RPC 列表

| RPC | 用途 |
|-----|------|
| `wh_list_balance` / `wh_list_transactions` | 查询 |
| `wh_create_lot` | 建批 |
| `wh_post_receipt` | 过账收货（含 direct） |
| `wh_post_transfer` | 调拨 |
| `wh_post_adjustment` | 调整 |
| `wh_release_lot` / `wh_reject_lot` | 放行/拒收 |
| `wh_sync_release_from_qc` | QC 集成 |
| `wh_import_opening_balance` | 期初（含 quarantine） |
| `wh_rebuild_balance` | 运维重建余额 |
| `wh_cancel_grn` | 冲销收货 |

内部共享：`_wh_apply_transaction(...)` — 统一 UOM 换算、批控、负库存校验。

### 11.2 前端服务层

| 路径 | 说明 |
|------|------|
| `eee-main/src/services/warehouseApi.ts` | 唯一 Supabase 数据访问层 |
| `eee-main/src/pages/warehouse/WarehouseModule.tsx` | 模块壳 + 侧边栏 |
| `eee-main/src/App.tsx` | `activeModule === 'warehouse'` |

### 11.3 权限扩展

```text
warehouse.master_data.items       view | create | edit
warehouse.master_data.locations   view | edit
warehouse.lots                    view | release | reject
warehouse.goods_receipt             view | create | post | cancel
warehouse.inventory               view | receive | transfer | adjust
```

（在现有 `permissionStructure.warehouse.inventory.*` 基础上扩展。）

---

## 12. 页面与路由规划

| Screen ID | 页面 | 权限 |
|-----------|------|------|
| `wh-home` | 仪表盘（各库区件数/重量） | inventory.view |
| `items` | 物料主数据 | master_data.items.* |
| `locations` | 库区维护 | master_data.locations.* |
| `balance` | 库存余额 | inventory.view |
| `lots` / `lot-detail` | 批次登记与流水 | lots.view |
| `gr-list` / `gr-form` | 收货单（含 Direct 标签） | goods_receipt.* |
| `transfer` | 调拨 | inventory.transfer |
| `adjustment` | 调整 | inventory.adjust |
| `opening-import` | 期初导入向导 | inventory.adjust 或专用 |

UI 主题色：**emerald**（与 Home 模块卡片一致）。

---

## 13. 期初库存导入方案

### 13.1 CSV 模板列

| 列 | 必填 | 说明 |
|----|------|------|
| item_sku | Y | |
| lot_number | Y | 可沿用现场批号 |
| location_code | Y | §5 七区代码 |
| quantity | Y | 基础单位 |
| lot_status | Y | `quarantine` / `available` / `on_hold` |
| expiry_date | N | |
| unit_cost | N | v1.0 可空 |
| notes | N | |

### 13.2 导入逻辑

- 单次导入生成 `import_batch_id`；
- 每行：`wh_create_lot` + `wh_post_adjustment`（原因 `OPENING_BALANCE`）；
- **待检**行：`lot_status=quarantine` 且库位为 `LOC-QC-PENDING` 或 RM 待检区；
- 结束输出成功/失败行报告，供客户对账。

---

## 14. 开发阶段与里程碑

**假设：1 名全栈 + 0.5 产品，2 周/Sprint。**

| Sprint | 周期 | 交付 | 里程碑 |
|--------|------|------|--------|
| **S0** | 第 1–2 周 | 设计定稿、7 库位 seed、`item`/`lot` 只读、物料 CRUD、`qc_product_sku.item_id` | M0：主数据可维护 |
| **S1** | 第 3–4 周 | 流水内核、`wh_post_receipt`（direct）、余额页 | M1：可收货入账 |
| **S2** | 第 5–6 周 | 调拨、调整、批次详情时间线 | M2：库内作业完整 |
| **S3** | 第 7–8 周 | 放行/拒收、临期列表 | M3：批次生命周期 |
| **S4** | 第 9–10 周 | `lot_id` 绑定、`wh_sync_release_from_qc`、改造 QC release | M4：D-W04 达标 |
| **S5** | 第 11–12 周 | 期初导入、权限/RLS、UAT、模块规格文档 | M5：可割接试运行 |

**总工期：约 12 周（v1.0）**；2 人全栈团队可压缩至 **8–9 周**。

### 14.1 后续模块建议顺序

```text
Warehouse v1.0 → Production → Procurement (PO) → Sales → AP/AR + 自动凭证
```

---

## 15. 测试与验收

| 类型 | 用例示例 |
|------|----------|
| SQL/RPC | 负库存、无 lot 批控、direct 收货标记、双流水调拨原子性 |
| 集成 | QC 放行 ↔ 待包装库位数量；失败回滚 |
| 对账 | 期初导入 SUM = 客户 Excel |
| 并发 | 两车同时放行同 SKU |

---

## 16. 风险、假设与待客户确认项

| 类型 | 内容 |
|------|------|
| **假设** | 单工厂；一车一批次 `lot`；v1.0 包装仍以 QC 车号为主键直至 ship 流水接入 |
| **风险** | QC 与 ERP 双写不一致 → 事务 RPC + 对账报表 |
| **待确认** | 批号最终规则；原料是否单独「待检原料区」；烘干区是否在 ERP 记汇总 WIP（默认：记） |
| **依赖** | S4 需改造 `qc_release_passed_sub_lot` |

---

## 17. 附录：任务 Checklist

### Sprint 0

- [ ] 定稿 `eee-main/docs/modules/11_warehouse-inventory.md`
- [ ] Migration：7 `location` seed + `receipt_type` + `qc_product_sku.item_id`
- [ ] `WarehouseModule` + Items + Locations 页面
- [ ] 权限 seed

### Sprint 1–2

- [ ] `_wh_apply_transaction` + balance trigger
- [ ] `wh_post_receipt`（direct UI 标签）
- [ ] Balance / GR 页面

### Sprint 3

- [ ] `wh_release_lot` / `wh_reject_lot`
- [ ] COA 简录入

### Sprint 4

- [ ] `qc_drying_sub_lot.lot_id` 在投产/收货时写入
- [ ] `wh_sync_release_from_qc` + QC RPC 改造
- [ ] 联调测试用例 20 条

### Sprint 5

- [ ] `wh_import_opening_balance` + CSV 模板
- [ ] UAT 脚本
- [ ] 更新 `eee-main/docs/README.md` 路由表

---

*文档结束*

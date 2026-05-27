# Warehouse & Inventory 模块

> **状态**: Sprint 0（主数据基座）已落地。库存流水内核、收货、调拨、QC 放行同步等在后续 Sprint。
> **依据**: `ERP-system/docs/Warehouse模块开发计划书.md`、`Warehouse模块-Sprint0决议.md`、`Warehouse模块-落地开发计划.md`
> **UI 主题**: emerald

---

## 概述

Warehouse 是整套 ERP 的运营库存中枢，目标是可审计的只增库存流水（`inventory_transaction`）+ 批次（`lot`）+ 库位（`location`）三维库存，并与 QC 放行同步。本模块底层表（`item`/`lot`/`inventory_transaction`/`inventory_balance`/`warehouse`/`location`/`goods_receipt`）在 M-001 已建。

## 仓库与库区（M-079）

1 个仓库 `WH-MAIN`（主工厂）+ 7 个逻辑库区：

| 代码 | 名称 | location_type |
|------|------|---------------|
| `LOC-RM` | 原材料仓 | storage |
| `LOC-PRE-DRY` | 待烘干仓 | production |
| `LOC-DRY-WIP` | 烘干区（汇总） | production |
| `LOC-QC-PENDING` | 待检仓 | quarantine |
| `LOC-PACK-STAGE` | 待包装/合格仓 | storage |
| `LOC-NG` | 不合格仓 | quarantine |
| `LOC-FG` | 成品仓 | storage |

## Sprint 0 已实现

| 子页面 / Screen | 说明 | 权限 |
|-----------------|------|------|
| `home`（Overview） | 模块概览 | warehouse 模块访问 |
| `items` | 物料主数据 CRUD（含停用/启用） | `warehouse.items.view/create/edit` |
| `locations` | 7 库区只读列表 | `warehouse.locations.view` |

**QC SKU ↔ ERP item 关联**：通过 `qc_sku_item` **联结表**（一对多，M-087）维护，入口在 ProductManagement / Production 模块（多选，复用 `warehouseApi.listItems`）。每张工单再用 `qc_production_lot.packaging_item_id`（M-092/M-095）从已关联 item 中选定最终产品。

> 注：初版 Sprint 0 用 `qc_product_sku.item_id`（一对一，M-080），已被 M-087 联结表回退替换。详见 `docs/Warehouse模块-Sprint0决议.md` §1.5/§5.6。

### 前端文件

- `src/services/warehouseApi.ts` — 唯一数据访问层（S0 用 `supabase.from()` 直查；库存写操作 RPC 在后续 Sprint）
- `src/pages/warehouse/WarehouseModule.tsx` — 模块壳 + 侧边栏
- `src/pages/warehouse/ItemsPage.tsx`、`LocationsPage.tsx`
- `src/lib/permissionStructure.ts` — `warehouse` 资源：`items`/`locations`/`lots`/`goods_receipt`/`inventory`/`module_permissions`

### 相关 migration

- M-079 `20260524000002_warehouse_seed_locations.sql` — WH-MAIN + 7 库区
- M-080 `20260524000003_qc_product_sku_add_item_id.sql` — QC↔item 桥接列（**已被 M-087 联结表回退替换**）
- M-087 `20260525000008_qc_sku_item_junction.sql` — `qc_sku_item` 一对多联结表（取代 M-080 的列）
- M-081 `20260524000004_warehouse_seed_uom.sql` — 基础 UOM seed（解除 Items 表单阻塞）
- M-082 `20260524000005_warehouse_permission_seed.sql` — 管理员 warehouse 全权

> ⚠️ S0 阶段 `item`/`uom`/`location`/`lot` 等核心表**未启用 RLS**（世界可写），正式 RLS 收紧在 S5。

---

## Sprint 1 已实现（库存流水内核 / 可收货入账，M1）

| 子页面 / Screen | 说明 | 权限 |
|-----------------|------|------|
| `balance` | 按物料/批次/库位的实时余额（派生自只增流水），可按库区筛选 | `warehouse.inventory.view` |
| `goods-receipt` | 无 PO 直接收货：列表（DIRECT 标签）+ 多行新建表单，过账即写流水 | `goods_receipt.view` / 创建需 `goods_receipt.create` |

### 库存账本内核

- **只增账本（BR-1）**：`inventory_transaction` 由触发器 `trg_invtxn_append_only` 禁止 UPDATE/DELETE；纠错只能反向过账。
- **派生余额（BR-4）**：`trg_invtxn_maintain_balance` 在每次 INSERT 后维护 `inventory_balance`。
- **唯一写入口 `_wh_apply_transaction`**（SECURITY DEFINER）：
  - BR-3 批控：批次控制物料必须带 lot；
  - BR-2 UOM 换算：录入单位 → 物料基础单位（`uom_conversion`，item 专属优先，无行且非基础单位报错）；
  - **BR-W4 双条件**（决议 §5.2）：`issue/ship/production_consume` 出库要求 `lot.status ∉ {on_hold,rejected,expired}` 且来源 `location.location_type ≠ quarantine`；`transfer` 不受此限（QC 放行需从 quarantine 调出）；
  - BR-5 负库存：出库前 `FOR UPDATE` 锁余额行校验，禁止为负。
- **收货 `wh_post_receipt`**：一次性建 GRN（`receipt_type='direct'`,`po_id=NULL`,supplier 选填,`status='posted'`）+ 建 lot（默认 `available`，可选 `quarantine`）+ 写 `receipt` 流水。批号留空自动生成（`RM-YYYYMMDD-SEQ4`，占位规则 §9）。

### M1 范围限定 / 已知限制

- **仅批次控制物料可收货**：`inventory_balance` 主键含 `lot_id`（PG 主键列隐含 NOT NULL），非批次物料（lot_id 空）无法建余额行——留待后续（需 schema 改造/哨兵值）。
- 收货为**一次性 post**；draft 工作流、`wh_cancel_grn`（冲销）、调拨、调整在 S2；放行/拒收（lot 状态流转）在 S3。
- UOM 换算仅当 `uom_conversion` 有行时支持非基础单位；M1 默认按基础单位收货。
- adjustment 受控负库存例外留 S2；RLS 留 S5。

### 相关 migration（S1）

- M-100 `wh_ledger_triggers.sql` — append-only + 余额维护触发器
- M-101 `wh_goods_receipt_schema.sql` — `supplier_id` 可空 + `receipt_type`
- M-102 `wh_kernel_and_generators.sql` — `_wh_apply_transaction` + `wh_next_grn_number` + `wh_generate_lot_number`
- M-103 `wh_create_lot_and_post_receipt.sql` — `wh_create_lot` + `wh_post_receipt`
- M-104 `wh_balance_queries.sql` — `wh_list_balance` + `wh_list_transactions`

---

## Sprint 2 已实现（库内作业完整，M2）

| 子页面 / Screen | 说明 | 权限 |
|-----------------|------|------|
| `lots` | 批次列表，点批次号进详情 | `warehouse.lots.view` |
| `lot-detail` | 批次头 + 各库位余额 + 流水时间线 + 内联调拨/调整 | `lots.view`；调拨需 `inventory.transfer`、调整需 `inventory.adjust` |
| `goods-receipt`（增强） | posted 收货单加「冲销」按钮 | `goods_receipt.cancel` |

### 库内作业 RPC（M-105，均经 `_wh_apply_transaction`）

- **`wh_post_transfer`**：调拨 = 一事务两腿（`transfer_out` -qty @源 + `transfer_in` +qty @目标），原子。BR-5 在出腿校验源在库；`transfer` **不受 BR-W4 限**（QC 放行需从 quarantine 调出）。
- **`wh_post_adjustment`**：调整带必填原因（存 `notes`）；**严守 BR-5**——不可把余额调到负（受控负库存例外不做）。
- **`wh_cancel_grn`**：冲销已过账收货——逐 `goods_receipt_line` 写**反向 `adjustment`**（不删原流水，符合 BR-1）+ GRN→`cancelled`；货若已调走（反冲变负）则 BR-5 拒、整单回滚。
- **`wh_rebuild_balance`**：运维重建——清空 `inventory_balance` 后从 `inventory_transaction` 按 (item,lot,location) SUM 重灌（BR-4 对账用；`quantity_allocated` 归 0）。

**范围限定（M2）**：调拨/调整以物料基础单位操作；放行/拒收（lot 状态流转）在 S3；QC 集成 S4；RLS S5。

### 相关 migration（S2）

- M-105 `wh_inventory_operations.sql` — `wh_post_transfer` / `wh_post_adjustment` / `wh_cancel_grn` / `wh_rebuild_balance`

---

## 后续 Sprint 的实现基准（来自 Sprint 0 决议 §5）

以下规则在 S1–S5 实现库存内核与 QC 集成时必须遵守。

### lot.status 聚合规则（决议 §5.1）

ERP `lot` 与 `qc_production_lot`（车）1:1。`lot.status` 不按 sub_lot 即时变化，按全车终态聚合：

- 仍有 sub_lot 未到终态 → 保持 `quarantine`
- 全部 pass/closed → `available`
- 全部 hold/disposing/rejected → `on_hold`
- 终态混合（既有 pass 又有 hold） → `available`（不合格部分靠物理位置 `LOC-NG` + BR-W4 隔离）

实现：`wh_recompute_lot_status(p_lot_id)`，由 `wh_sync_release_from_qc` 在事务末尾调用。

### BR-W4 双条件校验（决议 §5.2）

出库类型（`issue`/`ship`/`production_consume`）必须同时满足：
1. `lot.status` ∉ {`on_hold`, `rejected`, `expired`}；
2. 来源 `location.location_type` ≠ `quarantine`。

任一不满足，RPC 拒绝并回滚。实现位置：`_wh_apply_transaction` 出库分支。

### lot_id 贯穿（决议 §4.5）

`lot_id` 加在 `qc_production_lot`，并冗余到 `qc_drying_sub_lot`（触发器维护），使所有出库 RPC 直接用 `sub_lot.lot_id`，无需 join。

### 建车前置校验（决议 §5.6，取代原 §5.5）

`qc_production_lot` 创建时校验 **`packaging_item_id IS NOT NULL`**，未选最终产品则拒绝建车——保证放行时一定能用 `packaging_item_id` 建/取 ERP lot（lot 代表成品）。

---

## 业务规则

模块规则 BR-W1..W6 见 `files/business-rules.md`（BR-W1/W4 已按决议 §5.3/§5.2 修订为「lot 车级 / transaction 子批级」与双条件校验）。

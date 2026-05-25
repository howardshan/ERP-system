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

**QC SKU ↔ ERP item 关联**：入口在 QC `ProductManagement` 页（决议 §5.5）。`qc_product_sku.item_id`（M-080）可空 FK，由 QC 人员手动关联。

### 前端文件

- `src/services/warehouseApi.ts` — 唯一数据访问层（S0 用 `supabase.from()` 直查；库存写操作 RPC 在后续 Sprint）
- `src/pages/warehouse/WarehouseModule.tsx` — 模块壳 + 侧边栏
- `src/pages/warehouse/ItemsPage.tsx`、`LocationsPage.tsx`
- `src/lib/permissionStructure.ts` — `warehouse` 资源：`items`/`locations`/`lots`/`goods_receipt`/`inventory`/`module_permissions`

### 相关 migration

- M-079 `20260524000002_warehouse_seed_locations.sql` — WH-MAIN + 7 库区
- M-080 `20260524000003_qc_product_sku_add_item_id.sql` — QC↔item 桥接列
- M-081 `20260524000004_warehouse_seed_uom.sql` — 基础 UOM seed（解除 Items 表单阻塞）
- M-082 `20260524000005_warehouse_permission_seed.sql` — 管理员 warehouse 全权

> ⚠️ S0 阶段 `item`/`uom`/`location`/`lot` 等核心表**未启用 RLS**（世界可写），正式 RLS 收紧在 S5。

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

### 建车前置校验（决议 §5.5）

`qc_production_lot` 创建时校验 `qc_product_sku.item_id IS NOT NULL`，未关联则拒绝建车——保证放行时一定能建/取 ERP lot。

---

## 业务规则

模块规则 BR-W1..W6 见 `files/business-rules.md`（BR-W1/W4 已按决议 §5.3/§5.2 修订为「lot 车级 / transaction 子批级」与双条件校验）。

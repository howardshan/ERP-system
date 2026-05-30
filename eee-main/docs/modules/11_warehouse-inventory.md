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

## Sprint 3 已实现（批次生命周期，M3）

| 子页面 / Screen | 说明 | 权限 |
|-----------------|------|------|
| `lot-detail`（增强） | 加「放行」（quarantine + canRelease）/「拒收」（quarantine 或 available + canReject）按钮 + 内联表单 + 底部「质检记录（COA）」表 | `lots.release` / `lots.reject` |
| `expiring` | 临期预警列表：天数阈值（7/30/60/90 天）+ 「一键标定过期」按钮 + 已过期红色高亮 + ≤7 天琥珀色 | `lots.view`；标定需 `lots.reject` |

### Lot 状态机（BR-6a / BR-11 落点）

| RPC | 转换 | 副作用 |
|-----|------|--------|
| `wh_release_lot` | `quarantine → available` | 写 `coa(result='pass')` |
| `wh_reject_lot` | `quarantine` 或 `available → rejected` | 写 `coa(result='fail', notes=reason)`；BR-W4 自动拦截后续出库 |
| `wh_expire_lots` | `expiry_date < today` 的所有非终态批次 → `expired` | BR-W4 自动拦截后续出库 |

**S3 不做**：`on_hold` 转换（v1.0 计划书 §10 未列）；自动过期定时任务（手动按钮触发，留 v1.1）。

### COA（质检证书）首次启用

- 表 `coa`（M-001 已存在）首次被写入。COA 字段最小化（test_date / tested_by / document_ref / notes）；测试项/限值是蓝图 Phase 3。
- 编号 `COA-NNNNNN`，由 `wh_next_coa_number()` 生成（仿 `wh_next_grn_number`）。
- 详情页底部「质检记录（COA）」表显示该 lot 所有 coa 行；pass/fail 用色块区分。

### 范围限定 / 已知限制（M3）

- **BR-W5 软冲突**：从 quarantine 类型库位上的 lot 放行后，物理上仍在该库位（S3 手动放行典型场景是 LOC-RM 储存型库位的原料放行，无冲突；QC 集成 S4 的同步函数会一并 transfer 解决）
- **拒收不自动调拨**：reject 后 status=rejected，物理库存仍在原位；BR-W4 自动阻断出库；如需调到 LOC-NG 需手动调拨
- **`wh_expire_lots` 需手动触发**（临期页按钮）；定时任务留 v1.1
- 内核 `_wh_apply_transaction` 的 BR-W4 检查只查 `lot.status`（含 expired/rejected/on_hold）+ 库位类型，**不直接看 `expiry_date`**——所以"未标定的过期批次"在标定前仍可能被出库，需要管理员定期跑一次扫描

### 相关 migration（S3）

- M-110 `wh_lot_lifecycle.sql` — `wh_next_coa_number` / `wh_release_lot` / `wh_reject_lot` / `wh_expire_lots` / `wh_list_expiring`
- M-111 `wh_balance_status_aware_available.sql` — `wh_list_balance` 的 `quantity_available` 改为只算 `lot.status='available'` 的批次（修复 rejected/expired 批次"可用"虚高问题）；BalancePage 物料汇总行 `可用 < 在库` 时变琥珀色 + 旁注"冻结 N"

---

## Sprint 4 已实现（QC ↔ ERP 集成,达里程碑 M4 / D-W04 ★命脉）

S4 把 QC 的"建车 → 检验 → 放行"流程与 ERP 库存账本打通。从此 QC 释放的卡片就是 LOC-PACK-STAGE 的可用库存,Packaging(S5)才能写 ship 流水。

### 数据模型

- `qc_production_lot.lot_id bigint REFERENCES lot(id)` — QC 卡片 ↔ ERP 批次 1:1 链
- `qc_drying_sub_lot.lot_id bigint REFERENCES lot(id)` — 冗余列,触发器 `trg_qc_sub_lot_sync_lot_id`(BEFORE INSERT/UPDATE OF production_lot_id)自动维护;后续出库 RPC 直接读 sub_lot.lot_id

为何用触发器而非生成列:`production_lot_id` 是可变列(M-063 跨 production_lot 重新分组卡片),违反生成列的 IMMUTABLE 要求。

### 同步路径

| 阶段 | 触发函数 | ERP 动作 |
|------|---------|---------|
| 建车(新) | `qc_create_production_lot_with_sub_lots`(M-115) | 立刻调 `wh_create_lot(p_status='quarantine', p_source_type='produced', p_item_id=packaging_item_id)` → 写回 `qc_production_lot.lot_id`,在 sub_lot 循环**之前**完成(让触发器看到父 lot_id);0 余额 |
| 建车(历史 packaging_item_id=NULL) | 不补 | 由 M-114 `wh_sync_release_from_qc` 在首次放行时懒创建 |
| 检验失败(hold) | `qc_submit_inspection`(M-117 重写 M-109) | **不动 ERP 余额/状态**;写 `qc_quality_event(qc_hold_synced_to_wh, payload.wh_lot_id=...)` 给所有 hold 的 sub_lots(冠军 + 组传染的 siblings) |
| 处置(rework/grind/scrap/concession/retest/redry/room_temp_dry) | `qc_create_disposition`(M-117 重写 M-106) | **不动 ERP 余额/状态**;写 `qc_quality_event(qc_disposition_synced_to_wh, payload.wh_lot_id=...)` |
| 放行(closed) | `qc_release_passed_sub_lot`(M-116 重写 M-068) | 操作员录入 yield → 调内嵌 `wh_sync_release_from_qc` → `_wh_apply_transaction(transaction_type='production_output', +yield)` 到 LOC-PACK-STAGE → 调 `wh_recompute_lot_status` 聚合 lot.status |

### Yield 模型

操作员在放行时录入每车的实际产出(基础单位)。**释放路径是 yield 的唯一入口** — 建车不发余额、hold 不发余额、disposition 也不发余额。这样:
- Hold/scrap 永远没有"反向余额"的烦恼(因为 yield 从未流过)
- "实际产出 vs 期望"的差异留在 yield 输入这一个点上,事后稽查容易
- 内核 `_wh_apply_transaction` 只接收一种合法的 QC 路径:`transaction_type='production_output'` + 正数 quantity

### BR-W3 闭环

释放路径要么 ERP 同步成功 + QC sub_lot 进 'closed',要么整体回滚:
1. `qc_release_passed_sub_lot` 先 UPDATE status='closed'
2. 同事务内调 `wh_sync_release_from_qc`,后者任何 RAISE(BR-3/5/W4 / `PACKAGING_REQUIRED:`/`NO_PACKAGING_LINKED:`/`YIELD_REQUIRED:`)都让整个事务回滚 → sub_lot.status 恢复 'passed'
3. M-068 的 idempotent 短路保留:重复调放行(status 已是 closed/dispatched)直接 no-op,**不**再调 wh_sync(否则余额会重复 +yield)

### §5.7 历史 NULL packaging_item_id 兼容(混合策略)

S4 前建车的历史卡片可能 `packaging_item_id IS NULL`。`wh_sync_release_from_qc` 按 SKU 的 `qc_sku_item` 关联数三分流:
- 0 关联 → `RAISE 'NO_PACKAGING_LINKED:<sku_id>'`(硬阻断,提示去 ProductManagement 配置)
- 1 关联 → 自动 `qc_set_lot_packaging_item`(无歧义)+ 继续放行;`qc_quality_event(packaging_item_set, source='late_fill_on_release')`
- ≥2 关联 → `RAISE 'PACKAGING_REQUIRED:<production_lot_id>'`,前端 ReleaseDialog 捕获 → 弹包装选择器 → 调 `setLotPackagingItem` → 重试

### 错误码契约(前端 catch 用)

| Postgres RAISE 前缀 | qcApi 抛出的类 | UI 行为 |
|---------------------|---------------|---------|
| `PACKAGING_REQUIRED:<production_lot_id>` | `PackagingRequiredError` | ReleaseDialog 切到包装选择器 |
| `NO_PACKAGING_LINKED:<sku_id>` | `NoPackagingLinkedError` | 弹提示去 ProductManagement 配置 |
| `YIELD_REQUIRED: ...` | `YieldRequiredError` | 表单 yield 输入校验在前已挡,只是兜底 |
| `PACKAGING_REQUIRED_AT_CREATION: ...` | 普通 Error | 建车页应在前端先挡 |

### 范围限定 / 已知限制(M4)

- **Pre-release hold 无 ERP 余额变化**(决议):UI 上 hold 的车在 ERP balance 页看不到,仅 `qc_quality_event` 留痕;post-release reject 走 S3 的 `wh_reject_lot` 独立路径
- **Yield 输入精度**:操作员手输;无自动称重集成(留 v1.1)
- **`reference_id` uuid→bigint 障碍**:`inventory_transaction.reference_id` 是 bigint,`qc_drying_sub_lot.id` 是 uuid。采用 `reference_id=NULL` + `notes` 含 sub_lot_code/lot_number 字符串追溯(深度追溯通过 `qc_quality_event.payload.wh_lot_id` 反查)
- **历史车 lot_id 懒创建**:同步函数内做,不写单独 backfill migration
- **on_hold 状态转换**:v1.0 仍不做
- **组放行同 yield**:`releasePassedSubLotsGroup(ids, yield)` 给一组卡片同一个 per-cart yield;per-cart yield 差异请单卡片放行

### 相关 migration(S4)

- M-112 `wh_qc_lot_link_schema.sql` — `qc_production_lot.lot_id` + `qc_drying_sub_lot.lot_id` + 触发器 + backfill
- M-113 `wh_recompute_lot_status.sql` — 决议 §5.1 聚合
- M-114 `wh_qc_sync_helpers.sql` — `qc_set_lot_packaging_item` + `wh_sync_release_from_qc`
- M-115 `qc_create_production_lot_with_sub_lots_v2.sql` — 建车强制 packaging_item_id + 调 wh_create_lot
- M-116 `qc_release_passed_sub_lot_v2.sql` — 加 yield 参数 + 内嵌 wh_sync
- M-117 `qc_hold_event_hooks.sql` — qc_submit_inspection / qc_create_disposition 加 `qc_hold_synced_to_wh` / `qc_disposition_synced_to_wh` 审计事件

### 前端配套(S4)

- `src/services/warehouseApi.ts` — `setLotPackagingItem` / `syncReleaseFromQc` 函数 + `LotReleaseSyncResult` 类型
- `src/services/qcApi.ts` — `releasePassedSubLot(subLotId, yieldQuantity)` 签名加 yield 必填;新增 `PackagingRequiredError` / `NoPackagingLinkedError` / `YieldRequiredError` 类;新增 `getProductionLotSku` 辅助
- `src/pages/qc/components/ReleaseDialog.tsx`(新)— 三态模态框(yield → pick_packaging → no_packaging)
- `src/pages/qc/QcHome.tsx` — Needs Attention 区"放行"按钮改为打开 ReleaseDialog

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

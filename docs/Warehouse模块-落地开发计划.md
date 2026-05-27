# Warehouse 模块落地开发计划（执行级）

> **文档类型：** 执行级开发计划（task-level，可勾选落地）
> **依据：** `Warehouse模块开发计划书.md` v1.0（战略级）、`Warehouse模块-Sprint0决议.md`（4 项决议均选方案 A + 实施细则）
> **定位：** 计划书说"做什么、为什么"，决议文档说"怎么取舍"，**本文说"按什么顺序、改哪些文件、怎么验收"**
> **创建日期：** 2026-05-24

---

## 1. 当前进度基线（开工前已完成）

| 项 | 状态 | 证据 |
|----|------|------|
| ERP 核心表（item / lot / inventory_transaction / inventory_balance / warehouse / location / goods_receipt(_line)） | ✅ 已存在 | M-001 |
| 7 个库区 + WH-MAIN seed | ✅ 已上线 | M-079 |
| `qc_product_sku.item_id`（可空 FK） | ✅ 已上线 | M-080 |
| `permissionStructure.warehouse`（仅 `inventory.*` + `module_permissions`） | ⚠️ 存在但需扩展 | [permissionStructure.ts:69](../eee-main/src/lib/permissionStructure.ts#L69) |
| `warehouseApi.ts` | ❌ 不存在，需新建 | — |
| `WarehouseModule.tsx` | ❌ App.tsx 当前是 placeholder | [App.tsx:183](../eee-main/src/App.tsx#L183) |
| `docs/modules/11_warehouse-inventory.md` | ❌ 需新建 | — |
| BR-W1..W6 入册 + BR-W1/W4 措辞修订 | ✅ 已完成 | [files/business-rules.md](../../files/business-rules.md) |

**结论：** S0 已完成约 30%（两个 migration），可直接从 S0 剩余项接续。

> **现状更新（2026-05-26）**：
> 1. **Sprint 0 已全部完成并验证通过**（物料 CRUD、库区、QC↔item 关联、UOM seed、权限）。
> 2. **QC↔ERP 桥接模型已演进**：我的 M-080（`qc_product_sku.item_id` 一对一）被 **M-087（`qc_sku_item` 联结表，一对多）回退替换**，并新增 `qc_production_lot.packaging_item_id`（每工单选定的最终产品 item）。决议文档 §1.5/§5.6 已同步。**S1–S3 不受影响；S4 按 §5.6 实现。**
> 3. **新出现的 "Production 模块" 是 QC 界面重组**（把 QC 的 Production/Trace/Products/TestTypes 搬进新壳，权限仍 `qc.*`，**不碰库存/lot**），**≠** 蓝图里的制造模块（formula/BOM/production_order）。本计划 §14.1「Warehouse→Production」指的是后者。
> 4. **库存账本仍是空地**：全库无任何 `inventory_transaction`/ERP `lot` 写入，S1 内核 `_wh_apply_transaction` 从零开始。
> 5. **migration 编号**：Warehouse S0 的 4 个 migration 已补登为 **M-096～M-099**（追加到索引末尾），S1 起的新 migration 从 **M-100** 接续（下方 S1–S5 表中的 M-0xx 仅为**相对顺序示意**，实际号在创建时分配）。

---

## 2. 全局执行原则（每个 Sprint 都适用）

1. **RPC-first**：所有库存写入（收货/调拨/调整/放行/出库）必须经 `SECURITY DEFINER` RPC，前端**不得**直接 `INSERT/UPDATE inventory_transaction`（技术目标 §4.2）。读查询可走 view / `supabase.from()`。
2. **migration 幂等**：沿用 `IF NOT EXISTS` / `ON CONFLICT` / `CREATE OR REPLACE`，与 M-079/M-080 一致。
3. **唯一数据层**：所有 Supabase 访问收口到 `src/services/warehouseApi.ts`，页面不直接调 `supabase`（与 qcApi/pkgApi 一致）。
4. **文档同步（CLAUDE.md 强制）**：每个 migration → 补 `docs/database/03_migrations-and-edge-functions.md` 的 M-xxx 条目 + 快速参考表；业务变动 → 更新 `docs/modules/11_warehouse-inventory.md`。
5. **线上 DB push 边界**：migration 文件先本地写好 + review，**push 由用户执行或明确授权后执行**；push 前建议 `supabase db diff` 核对。
6. **每个 Sprint 有验证门**：达不到验证门不进下一 Sprint。验证门对齐计划书 §4.3 验收标准。
7. **UI 主题**：emerald（与 Home/QC 卡片一致，计划书 §12）。

---

## 3. 命名与约定速查

| 项 | 约定 |
|----|------|
| 下一个 migration 编号 | **M-100 起**（M-096～M-099 已分配给 Warehouse S0 补登）；文件名 `YYYYMMDDNNNNNN_<desc>.sql`。下方 S1–S5 表的 M-0xx 为相对示意，创建时按实际顺延 |
| RPC 命名 | 写操作 `wh_*`；内部共享 `_wh_*`；QC 集成 `wh_sync_*` |
| 内部事务内核 | `_wh_apply_transaction(...)` — 统一 UOM 换算、批控、负库存、BR-W4 双条件校验 |
| API 层文件 | `src/services/warehouseApi.ts` |
| 模块壳 | `src/pages/warehouse/WarehouseModule.tsx` + 子页面 |
| App 挂载 | `App.tsx` 中 `activeModule === 'warehouse'`（替换现有 placeholder） |
| 权限节点 | `permissionStructure.warehouse.*`（§11.3 扩展） |

---

## 4. Sprint 落地清单

> 工期假设：1 名全栈 + 0.5 产品，2 周/Sprint（计划书 §14）。
> 图例：🟢 已完成 · 🔲 待做 · ⚙️ migration · 🔌 RPC · 🧩 API · 🖥️ UI · 🔑 权限 · 📄 文档

### Sprint 0 — 主数据可维护（里程碑 M0）

**目标：** 库位/物料主数据可维护，QC SKU 可关联 ERP item。

| 类型 | 任务 | 状态 |
|------|------|------|
| ⚙️ | M-079 库位 seed | 🟢 |
| ⚙️ | M-080 `qc_product_sku.item_id` | 🟢 |
| ⚙️ | **M-081 UOM seed**（探索新发现：`uom` 空表阻塞 Items 表单） | 🟢 |
| 🔑 | 扩展 `permissionStructure.warehouse`：增 `items`、`locations`、`lots`、`goods_receipt`（§11.3，3 层拍平） | 🟢 |
| ⚙️ | M-082 权限 seed：给管理员 `tianzuohuang@crave-cook.com` 授 warehouse 全权（仿 M-035） | 🟢 |
| 🧩 | 新建 `warehouseApi.ts`：`listItems` / `createItem` / `updateItem` / `listUoms` / `listItemCategories` / `listLocations` / `listLots`(只读) | 🟢 |
| 🖥️ | `WarehouseModule.tsx` 壳 + sidebar（emerald），App.tsx 接线替换 placeholder；HomePage warehouse 卡片 `coming_soon→active` | 🟢 |
| 🖥️ | Items 页（物料 CRUD + 停用/启用）、Locations 页（库区只读） | 🟢 |
| 🖥️ | QC `ProductManagement.tsx` 加"关联 ERP 物料"下拉（写 `qc_product_sku.item_id`，决议 §5.5） | 🟢 |
| 📄 | 新建 `docs/modules/11_warehouse-inventory.md` 骨架 + 录入 §5 跨决议细则 | 🟢 |

> **编号顺延（2026-05-26 更正）**：S0 占用 M-081（UOM seed）、M-082（权限 seed）。其后 QC/production/notification 又用掉一批号，当前索引最大 **M-096**，**S1 起从 M-097 接续**（下表 M-0xx 为相对示意）。
> **关联读取实现（已演进）**：`item_id` 一对一已被 `qc_sku_item` 联结表取代（M-087）；`listProductItemLinks()` 现读 junction 返回一对多，并新增 `addSkuItemLink`/`removeSkuItemLink`。
> **RLS**：`item`/`uom`/`location`/`lot` 现无 RLS（世界可写），S5 收紧。

**✅ 验证门 M0：**
- 能在 UI 新建一个 item（base_uom 下拉有值=M-081 生效）、编辑、停用
- 能在 QC ProductManagement 把一个 SKU 关联到刚建的 item，刷新后 `qc_product_sku.item_id` 落库
- 7 个库区在 Locations 页可见
- 「三角色权限分离演示」改到后续单独建测试用户（本轮只给管理员授全权）

---

### Sprint 1 — 可收货入账（里程碑 M1）

**目标：** 流水内核打通，能无 PO 收货并看到余额。

| 类型 | 任务 | 状态 |
|------|------|------|
| ⚙️ | **M-100** append-only 守护触发器 + balance 维护触发器（BR-1/BR-4） | 🟢 |
| ⚙️ | **M-101** `goods_receipt.supplier_id` 可空 + `receipt_type`（BR-W2） | 🟢 |
| 🔌 | **M-102** `_wh_apply_transaction`（UOM 换算 + BR-3 批控 + BR-5 负库存 + BR-W4 双条件）+ `wh_next_grn_number` + `wh_generate_lot_number`（§9） | 🟢 |
| 🔌 | **M-103** `wh_create_lot` / `wh_post_receipt`（一次性 direct 收货） | 🟢 |
| 🔌 | **M-104** `wh_list_balance` / `wh_list_transactions` | 🟢 |
| 🧩 | warehouseApi：rpc helper + `postReceipt` / `listBalance` / `listTransactions` / `listGoodsReceipts` | 🟢 |
| 🖥️ | Balance 余额页（按 item/lot/location 三维 + 库区筛选） | 🟢 |
| 🖥️ | GR 收货单 list + 多行 form，**DIRECT 醒目标签** | 🟢 |
| 📄 | 文档：M-100~104 索引 + 11_warehouse-inventory.md 内核/收货章节 | 🟢 |

> **编号落定**：S1 实占 **M-100~M-104**（`20260526000003`~`007`）。下一个 migration 从 **M-105** 起。
> **M1 范围限定**：仅批次控制物料可收货（`inventory_balance` PK 含 lot_id）；收货为一次性 post，draft/冲销/调拨留 S2。

**✅ 验证门 M1：已通过（2026-05-27 验证）**
- ✅ 无 PO 收货一笔 → `LOC-RM`，余额页正确显示，`goods_receipt.receipt_type='direct'` 且 UI 有 DIRECT 标签
- ✅ 手动 `UPDATE inventory_transaction` → 被 `trg_invtxn_append_only` 拒绝
- ✅ 内核守护：批控物料无 lot → BR-3 拒；出库使 balance<0 → BR-5 拒；从 quarantine 出 issue/ship → BR-W4 拒
- ✅ 余额 = 流水累加（对账 0 差异）
- 修复记录：前端 `postReceipt` 对 `receipt_date` 传 null 触发 NOT NULL（SQL 参数 DEFAULT 对显式 null 不生效），已在 warehouseApi 默认填今天解决（无需 push）

---

### Sprint 2 — 库内作业完整（里程碑 M2）

**目标：** 调拨、调整、冲销、批次时间线。

| 类型 | 任务 | 状态 |
|------|------|------|
| 🔌 | **M-105** `wh_post_transfer`（双流水原子性）+ `wh_post_adjustment`（原因→notes，严守 BR-5）+ `wh_cancel_grn`（反向 adjustment，不删流水）+ `wh_rebuild_balance`（提前到 S2） | 🟢 |
| 🧩 | warehouseApi：`postTransfer` / `postAdjustment` / `cancelGrn` / `rebuildBalance` / `getLot`；时间线复用 `listTransactions({lotId})` | 🟢 |
| 🖥️ | Lots 列表页 + 批次详情页（各库位余额 + 流水时间线 + **内联调拨/调整**表单） | 🟢 |
| 🖥️ | Balance 批次号可点进详情；GR 列表加「冲销」按钮 | 🟢 |
| 📄 | 文档：M-105 索引 + 11_warehouse S2 章节 | 🟢 |

> **编号落定**：S2 实占 **M-105**（`20260527000001`）。下一个 migration 从 **M-106** 起。
> **入口决策**：调拨/调整从批次详情页发起（无独立 Transfer/Adjustment 导航页）；调整严守 BR-5。

**✅ 验证门 M2：**（migration 待 push 后走查）
- 调拨一笔 `LOC-RM → LOC-PRE-DRY`：源减目标增、两条流水、余额一致
- 调整盘盈成功；超量负调被 BR-5 拒
- 冲销 posted 收货单 → 状态 cancelled、余额回 0、原流水留存 + 反向 adjustment；货已调走的冲销被 BR-5 拒
- 批次详情页时间线按时间正确展示 receipt/transfer/adjustment
- `wh_rebuild_balance()` 重算结果 = 流水 SUM

---

### Sprint 3 — 批次生命周期（里程碑 M3）

**目标：** 放行/拒收、临期预警、余额自愈。

| 类型 | 任务 | 状态 |
|------|------|------|
| 🔌 | M-091 `wh_release_lot` / `wh_reject_lot`（`lot.status` 流转，BR-6a） | 🔲 |
| 🔌 | M-092 `wh_rebuild_balance`（运维重建，BR-4） | 🔲 |
| 🧩 | warehouseApi：`releaseLot` / `rejectLot` / `rebuildBalance` / `listExpiring` | 🔲 |
| 🖥️ | 批次放行/拒收操作 + COA 简表录入（计划书 §6.1） | 🔲 |
| 🖥️ | 临期预警列表（`expiry_date`，P1） | 🔲 |
| 📄 | 文档：M-091~092 + 批次生命周期章节 | 🔲 |

**✅ 验证门 M3：**
- 手动放行一个 quarantine lot → `available`，余额位置/状态正确
- 拒收 → `rejected`，且后续出库被 BR-W4 拒绝
- 临期列表能按 `expiry_date` 排序高亮

---

### Sprint 4 — QC 集成达标（里程碑 M4，D-W04）⭐ 核心

**目标：** ERP lot 与 QC 绑定，QC 放行事务内同步 ERP，失败回滚。

| 类型 | 任务 | 状态 |
|------|------|------|
| ⚙️ | `qc_production_lot.lot_id`（FK→lot）+ 索引（决议 §4.5 Migration A） | 🔲 |
| ⚙️ | `qc_drying_sub_lot.lot_id` 冗余 + 同步触发器 `qc_sync_sub_lot_lot_id`（决议 §4.5 Migration B）+ 历史 backfill | 🔲 |
| 🔌 | 建车时写 lot：`qc_create_production_lot_with_sub_lots`（M-095 已收 `p_packaging_item_id`）成功后，用 **`packaging_item_id`** 调 `wh_create_lot`（ERP lot.item_id = 成品 item）并回填 `lot_id`；校验 **`packaging_item_id IS NOT NULL`** 否则拒绝（决议 §5.6，已取代原 §5.5 的 item_id 写法） | 🔲 |
| 🔌 | M-096 `wh_recompute_lot_status(p_lot_id)`：全车终态聚合（决议 §5.1） | 🔲 |
| 🔌 | M-097 `wh_sync_release_from_qc(p_sub_lot_id)`：放行 transfer PENDING→PACK-STAGE + 调 recompute（计划书 §8.2，BR-W3） | 🔲 |
| 🔌 | M-098 hold 同步：QC hold/disposing → transfer →LOC-NG + recompute | 🔲 |
| 🔌 | M-099 改造 `qc_release_passed_sub_lot`：事务内调 `wh_sync_release_from_qc`，失败则整体回滚（不更新为 closed） | 🔲 |
| 🧩 | warehouseApi：`syncReleaseFromQc`（如需前端触发）；QC 侧无感 | 🔲 |
| 🧪 | 20 条联调用例（happy path + 部分合格 + 失败回滚 + 并发同 SKU 两车放行） | 🔲 |
| 📄 | 文档：M-093~099 + 09_qc.md 放行改造说明 + 11 集成章节 | 🔲 |

**✅ 验证门 M4（计划书 §4.3 关键项）：**
- 无 PO 收货 → 待检 → QC 放行 → 待包装，数量端到端正确
- `wh_sync_release_from_qc` 故意失败时，QC sub_lot **不**变 closed（无"已放行但无 lot"脏数据）
- 部分合格车：合格进 PACK-STAGE、不合格进 LOC-NG、lot.status=available（决议 §3.5 数据流示例可复现）
- 未选 `packaging_item_id` 的建车被拒绝（决议 §5.6；原"未关联 item 的 SKU 被拒"已按 junction 模型调整）

---

### Sprint 5 — 可割接试运行（里程碑 M5）

**目标：** 期初导入、包装写 ship 流水、权限/RLS、UAT、文档定稿。

| 类型 | 任务 | 状态 |
|------|------|------|
| 🔌 | M-100 `wh_import_opening_balance`：每行 `wh_create_lot` + `wh_post_adjustment`(原因 `OPENING_BALANCE`)，带 `import_batch_id`（BR-W6、D-W05） | 🔲 |
| 🔌 | M-101 改造 `pkg_dispatch_carts`：调 `_wh_apply_transaction` 写 `ship` 流水 + BR-W4 校验（决议 4 方案 A） | 🔲 |
| ⚙️ | M-102 RLS 策略：warehouse 相关表按角色（仿现有模块 RLS） | 🔲 |
| 🧩 | warehouseApi：`importOpeningBalance` + CSV 解析 | 🔲 |
| 🖥️ | 期初导入向导页（CSV 模板 §13.1 + 成功/失败行报告） | 🔲 |
| 🖥️ | wh-home 仪表盘（各库区件数/重量，计划书 §12） | 🔲 |
| 🧪 | UAT 脚本 + 对账：期初导入 SUM = 客户 Excel | 🔲 |
| 📄 | `11_warehouse-inventory.md` 定稿；更新 `docs/README.md` 路由表 | 🔲 |

**✅ 验证门 M5：**
- 期初导入（含 quarantine 行）+ 导入报告，SUM 与样例 Excel 对账通过
- 包装出库写 `ship` 流水，对 on_hold/LOC-NG 库存出库被 BR-W4 拒绝（可演示）
- 三角色权限分离可演示（计划书 §4.3 末项）

---

## 5. 关键依赖与里程碑

```
S0(主数据) ──► S1(流水内核) ──► S2(库内作业) ──► S3(批次生命周期) ──► S4(QC集成★) ──► S5(期初+割接)
   M0            M1               M2              M3                 M4                M5
              [_wh_apply_transaction 是 S1→S5 的公共内核，最先稳定]
              [S4 依赖 S1 的内核 + S3 的 release/reject + M-093/094 的 lot_id]
              [S5 的包装 ship 依赖 S4 的 lot_id 贯穿]
```

**硬依赖提醒：**
- `_wh_apply_transaction`（M-084）是所有写操作的根，**必须最先做稳**，含 BR-W4 双条件校验
- S4 的 `wh_sync_release_from_qc` 依赖：S1 内核 + S3 的 `wh_release_lot` + M-093/094 的 lot_id 字段
- 决议 §5.4 self-check 表对应到 M-082(append-only) / M-084(双条件) / M-093-094(lot_id) / M-096(recompute) / M-101(包装 ship)

---

## 6. 风险登记与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| QC 与 ERP 双写不一致 | 库存失真 | 事务 RPC（BR-W3 失败回滚）+ `wh_rebuild_balance` 对账 |
| `_wh_apply_transaction` 设计不稳导致 S2-S5 返工 | 工期 | S1 投入额外评审，先写 SQL 单测覆盖负库存/批控/双条件 |
| S4 改造 QC release 引入回归 | QC 现有功能 | M-099 仅在事务末尾加同步调用，保持 `qc_release_passed_sub_lot` 幂等（M-069）特性；联调 20 用例含 QC 回归 |
| 并发两车放行同 SKU | 余额竞态 | `_wh_apply_transaction` 内对 (item,lot,location) 加行锁；并发用例验证 |
| 线上 DB push 误操作 | 数据 | 每批 migration 先 `db diff`，push 由用户确认；所有 migration 幂等可重跑 |
| 包装 ship 纳入 v1.0 挤压 S5 | 工期 | 决议 4 选 A 已知占 S5 约 50%；若紧张可临时降级为决议 4 方案 C（写流水不强制 BR-W4），但需 v1.1 续接 |

---

## 7. 文档维护清单（每 Sprint 收尾自查）

- [ ] 新增/改动 migration 是否都在 `03_migrations-and-edge-functions.md` 补了 M-xxx 条目 + 快速参考表
- [ ] 业务变动是否更新 `docs/modules/11_warehouse-inventory.md`
- [ ] 引入新 BR 是否在 `files/business-rules.md` 补编号
- [ ] 新增模块/路由是否更新 `docs/README.md`
- [ ] 决议文档 §5.4 self-check 对应项是否打勾

---

## 8. 下一步（立即可做）

按 S0 剩余项，建议顺序：

1. **扩展 `permissionStructure.warehouse`**（纯前端，零风险，无需 push）
2. **新建 `warehouseApi.ts` + `WarehouseModule.tsx` 壳 + App.tsx 接线**（前端，可本地 `npm run dev` 验证）
3. **Items / Locations 页**
4. **QC ProductManagement 加关联列**
5. **M-081 权限 seed migration**（写好文件，push 由你确认）
6. **新建 11_warehouse-inventory.md 骨架**

---

## 修订记录

| 日期 | 修订者 | 内容 |
|------|--------|------|
| 2026-05-24 | 初稿 | 基于计划书 v1.0 + Sprint0 决议（全选方案 A）制定执行级落地计划 |
| 2026-05-26 | 现状同步 | S0 完成；QC↔ERP 桥接演进为 `qc_sku_item` 联结表 + `packaging_item_id`（M-087/M-092/M-095）；migration 编号更正为 M-097 起；S4 改按决议 §5.6；澄清 "Production 模块" 为 QC 界面重组（非制造模块） |

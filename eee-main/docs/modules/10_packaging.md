# Packaging Module

> 文件: [src/pages/packaging/PackagingModule.tsx](../../src/pages/packaging/PackagingModule.tsx)
> 路由: `activeModule === 'packaging'` (在 [App.tsx](../../src/App.tsx) 中分支渲染)
> 状态: ✅ Phase 1 MVP 完成(M-067)

---

## Overview

打包模块负责从 QC 接收 released 的车辆，按 FIFO 顺序展示待打包库存，支持扫码/手选出库，记录出库事件。

---

## 业务流程

1. QC 通过检验 → `qc_release_passed_sub_lot()` → cart 状态 `passed → closed`，同时写入 `released_at`
2. 打包操作员打开 Packaging 模块 → 选择产品 SKU
3. 系统按 `released_at` FIFO 展示该 SKU 的所有 `closed` carts
4. 操作员扫码或勾选车辆 → 点击 Dispatch
5. 系统调用 `pkg_dispatch_carts()` → cart 状态 `closed → dispatched`，写入 `pkg_outbound` + `pkg_outbound_item`

---

## 状态流

```
closed → dispatched
```

`dispatched` 是 Packaging 模块的终态，对应 `qc_drying_sub_lot.status` 的最终取值之一（M-067 加入）。

---

## 页面

### PackagingPage（两栏布局）

文件: [src/pages/packaging/PackagingPage.tsx](../../src/pages/packaging/PackagingPage.tsx)

- **左栏：SKU 卡片列表**（`pkg_skus_with_stock()`）
  - 每张卡片显示 SKU 名称 + 当前 `closed` 车辆数
  - 点击选中，右栏同步刷新
- **右栏：选中 SKU 的车辆列表**（`pkg_available_carts(sku_id)`），FIFO 排序（`released_at ASC`）
  - 列：车号、工单、入库日期、在库天数（彩色 badge）
  - 在库天数颜色：绿色 `<10` 天、琥珀色 `10-14` 天、红色 `≥15` 天
- **顶部扫码框**：Enter 自动勾选对应车（USB 扫描枪友好，同 DryRoom 扫描逻辑）
- **底部出库栏**：已选车辆数量 + 备注输入 + Dispatch 按钮

### PackagingModule（模块 Shell）

文件: [src/pages/packaging/PackagingModule.tsx](../../src/pages/packaging/PackagingModule.tsx)

- 模块容器，包含顶部返回按钮和 PackagingPage
- 通过 `activeModule === 'packaging'` 路由（App.tsx）

---

## QC Home Released Inventory 板块

`pkg_inventory_summary()` 返回每个 SKU 的绿/黄/红分桶数，在 QC Home 以横向堆叠色条展示（M-067 新增，详见 [09_qc.md QC Home 功能](./09_qc.md#qc-home-功能)）。

---

## 数据库表

| 表 | 关键字段 | 说明 |
|---|---|---|
| `qc_drying_sub_lot` | `released_at timestamptz` | QC release 时刻，`qc_release_passed_sub_lot()` 执行时写入；用于 FIFO 排序和在库天数计算（M-067） |
| `pkg_outbound` | sku_id, cart_count, note, dispatched_by, dispatched_at | 每次打包出库事件，`dispatched_by` 指向 `auth.users.id` |
| `pkg_outbound_item` | outbound_id, sub_lot_id, sub_lot_code, days_in_stock | 出库明细，每辆车一行；`days_in_stock` 为出库时计算的在库天数（冗余存储） |

---

## RPC 函数

| 函数 | 说明 |
|------|------|
| `pkg_available_carts(p_sku_id uuid)` | 返回指定 SKU 的 `closed` 车辆列表，按 `released_at` ASC（FIFO）；`p_sku_id` 为 NULL 时返回所有 SKU 的 closed 车 |
| `pkg_skus_with_stock()` | 返回有库存（至少 1 辆 `closed` 车）的 SKU 列表及各自数量 |
| `pkg_dispatch_carts(p_sub_lot_ids uuid[], p_note text DEFAULT NULL)` | 原子出库：batch UPDATE cart 状态 `closed → dispatched`，写 `pkg_outbound` + `pkg_outbound_item` 记录；任一失败整批回滚（BR-P2） |
| `pkg_inventory_summary()` | 按 SKU 统计 green（`<10d`）/ yellow（`10-14d`）/ red（`≥15d`）分桶数，供 QC Home Released Inventory 横向色条图使用 |

---

## 业务规则 (BR)

| 编号 | 内容 | 实现位置 |
|------|------|---------|
| **BR-P1** | FIFO 排序以 `released_at`（QC release 时刻）为准，早释放的车优先出库。 | `pkg_available_carts` |
| **BR-P2** | `pkg_dispatch_carts` 是原子操作：写 `pkg_outbound` + `pkg_outbound_item` + batch UPDATE sub-lot 状态在同一事务内完成；任一失败则整批回滚。 | M-067 `pkg_dispatch_carts` |
| **BR-P3** | 在库天数 = `floor(extract(epoch from now() - released_at) / 86400)`；`<10` 为 green，`10–14` 为 yellow，`≥15` 为 red。 | `pkg_inventory_summary` / `pkg_available_carts` |
| **BR-P4** | 只有 `closed` 状态的车才出现在打包队列；`dispatched` 是 Packaging 模块的终态，不可再进入其他流程。 | `pkg_available_carts` |

---

## 权限

权限定义见 [src/lib/permissionStructure.ts](../../src/lib/permissionStructure.ts) `packaging` 段。

| Resource | Permission | 说明 |
|----------|-----------|------|
| `outbound` | view | 查看打包队列（SKU 列表 + 车辆列表） |
| `outbound` | dispatch | 执行出库操作（Dispatch 按钮） |

### 页面级 view-permission 兜底（2026-05-23 起）

之前 `PackagingPage` 完全未做 `can()` 检查 — 任何能访问 `packaging` 模块的用户都能看到队列**并触发** Dispatch。本次补:

- 顶层 `canView = can('packaging','outbound','view')`,不通过渲染 [`PermissionDenied`](../../src/pages/qc/components/PermissionDenied.tsx)（QC 模块那边创建的复用组件）
- Dispatch 按钮的 `disabled` 条件加入 `!canDispatch`,并加 `title` 提示缺权限
- 沿用 QC 模块的 **BR-Q35/BR-Q36** 约定:view 控页面、action 控按钮,两者独立

---

## 前端文件

| 文件 | 说明 |
|------|------|
| `src/services/pkgApi.ts` | 类型化 API wrapper，导出 `getSkusWithStock()` / `getAvailableCarts(skuId?)` / `dispatchCarts(ids, note?)` / `getInventorySummary()` |
| `src/pages/packaging/PackagingModule.tsx` | 模块 shell，含返回按钮 |
| `src/pages/packaging/PackagingPage.tsx` | 主页面（两栏布局，扫码，出库操作） |

**相关改动**:
- `src/App.tsx` — 新增 `packaging` 模块路由分支
- `src/pages/HomePage.tsx` — 新增 Packaging 橙色主题卡片
- `src/lib/permissionStructure.ts` — 新增 `packaging.outbound.{view,dispatch}`
- `src/pages/qc/QcHome.tsx` — 新增 Released Inventory 板块（调 `pkg_inventory_summary()`）

---

## 依赖

| 依赖 | 原因 |
|------|------|
| M-041 (`qc_release_passed_sub_lot`) | 提供 `released_at` 时间戳写入逻辑 |
| M-064 (开发用户权限) | 保证两个开发账号有 `packaging` 模块访问 |
| QC Module 状态机 | `closed` 状态是 Packaging 队列的输入；`dispatched` 是 QC sub-lot 状态机的扩展终态 |

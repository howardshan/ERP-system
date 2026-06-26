# Products 与 Test Types 迁移及增强实施计划

> **状态：已实施（2026-06-23）。** M1–M4 全部完成，`tsc --noEmit` 0 错误、`npm run build` 通过。实际编号：migration = **M-147**（权限迁移 `20260623000001`）、**M-148**（审计表 `20260623000002`）；业务规则 = **BR-Q79**（UI/文案）、**BR-Q80**（编辑权回归 QC + 操作日志）、**BR-Q81**（Excel 导入）。新增依赖 `xlsx`（SheetJS）。技术文档同步已落在 `eee-main/docs/`（03_migrations、09_qc、06_users-auth）。下方为原始计划，存档。
>
> ── 以下为原始计划，存档 ──
>
> **状态：计划（待执行，2026-06-23 制定）。** 本文档为 Production 模块中 products / test types 管理功能迁移至 QC 模块、并叠加表格化 UI、搜索、Excel 导入导出、操作日志与权限调整的落地清单。决策已与需求方确认（见下方「已确认决策」）。按 M1 → M2 → M3 → M4 顺序实施，每个里程碑可独立交付。

## 背景 / 目标

现状要点（已核对代码）：

- products / test types 的组件本身已在 [src/pages/qc/](../src/pages/qc/) 下，但**入口当前挂在 Production 模块**（[ProductionModule.tsx](../src/pages/production/ProductionModule.tsx) 第 114-119 行），权限键为 `production.products.*`。这是 M-094（BR-Q51）当初从 `qc.*` 迁到 `production.*` 的结果。
- products 浏览页是**可展开列表**（`<ul><li>`，不是卡片），见 [ProductManagement.tsx](../src/pages/qc/ProductManagement.tsx) 第 308-416 行。
- "SKU" 仅出现在 UI 文案（i18n），DB 列名是 `qc_product_sku.code`。
- 系统已有成熟的审计日志范式：`finance_audit_log`（M-018）+ [finance/AuditLog.tsx](../src/pages/finance/AuditLog.tsx)，以及 `logFinanceAction` fire-and-forget 写入函数。
- 权限存储在 `user_permission_grant`（M-009），命名空间迁移有 M-094 的「INSERT 新键 → DELETE 旧键」三步法可复刻。
- 目前**无 Excel 库**；HR 有手写 CSV 导出先例。

目标：将编辑权回归 QC、Production 只读；products 页表格化 + 搜索；SKU 文案改名；新增 Excel 导入导出、操作日志；同步更新权限体系。

## 已确认决策

| 项 | 决策 |
|---|---|
| 需求3 改名范围 | **仅改字段标签** "SKU code" → "S2 WIP"，DB 列与概念名不动 |
| 需求5 导入范围 | **分期**：一期 = 导出 + 仅核心字段的 upsert-by-code 导入；嵌套 test 模板/final products 二期 |
| 需求1 Production 入口 | **保留只读入口**（同组件 + 只读渲染态） |

## 关键设计：单组件双形态

products 页在 Production（只读）与 QC（可编辑）下是**同一个组件 [ProductManagement.tsx](../src/pages/qc/ProductManagement.tsx)**。给它加 `module: 'production' | 'qc'` 属性（默认 `'qc'`），组件内所有 `can()` 检查改用该 module：

- Production 渲染 `<ProductManagement module="production" />` —— 只有 `production.products.view`=true，其余 false → 自然只读。
- QC 渲染 `<ProductManagement module="qc" />` —— 具备 create/edit/delete/export/import。

一份组件、两种形态，零代码重复。`TestTypesPage` 同样加 `module` 属性。

## 权限模型（先定，后续全依赖）

| 命名空间 | 用途 | 变化 |
|---|---|---|
| `production.products.view` | Production 只读浏览 | **保留** |
| `qc.products.view` | QC 浏览 | 新增 |
| `qc.products.create / edit / delete` | QC 编辑 | 从 `production.products.*` **迁移** |
| `qc.products.export` | 导出 Excel（prereq view） | 新增 |
| `qc.products.import` | 导入 Excel 更新（prereq edit） | 新增 |
| `qc.products.view_log` | 查看 products 操作日志（prereq view） | 新增 |

说明：

- test types 当前**复用 products 权限**（`TestTypesPage` 也查 `production.products.*`）。本期保持耦合，一并迁到 `qc.products.*`，不单拆 `test_types` 资源，减少改动面。
- 导出/导入/日志本期只放 QC 管理页；Production 纯只读。日后若要 Production 用户也能导出，再加 `production.products.export`。

## 里程碑

### M1 — 低风险 UI（需求 2 / 3 / 4）｜不碰权限与 DB

改 [ProductManagement.tsx](../src/pages/qc/ProductManagement.tsx)：

1. **加 `module` 属性**（默认 `'qc'`），把第 57-60 行的 `can('production','products',…)` 改为 `can(module,'products',…)`。
2. **表格化（需求2）**：第 308-416 行的 `<ul><li>` 换成 `<table>`。主列：产品名、S2 WIP 编码、参考干燥时间、抽样率、units/cart、required tests 数量；test 限值与 final products 明细放展开行或详情抽屉。编辑/删除按钮收进行尾操作列（受 `canEdit/canDelete` 控制）。
3. **搜索（需求4）**：列表上方加搜索框，前端按 `name` / `code` 即时过滤。
4. **改名（需求3）**：改 i18n 文案 `qc.json` 的 `productManagement.skuCode` → "S2 WIP"（及 `skuCodeHint`）；`production.json` 的 `productionDashboard.sku` 视情况一并改。DB 列 `code` 与概念名不动。

文档：`docs/modules/09_qc.md` 记 BR-Q52（UI 表格化 + S2 WIP 文案）。

### M2 — 入口迁移 + 只读化（需求 1）｜含权限迁移

1. **DB 迁移（M-127，复刻 M-094 三步法）**：
   - copy `production.products.view` → `qc.products.view`（INSERT，**不删**，Production 仍需 view）；
   - move `production.products.{create,edit,delete}` → `qc.products.{…}`（INSERT + DELETE）；
   - 确保被迁移用户有 `user_module_access('qc')`；
   - 为 dev admin（`ysha@smu.edu`）seed `export` / `import` / `view_log`（CROSS JOIN + VALUES + ON CONFLICT 范式）。
2. **[permissionStructure.ts](../src/lib/permissionStructure.ts)**：`qc` 模块新增 `products` 资源（view/create/edit/delete/export/import/view_log）；`production.products` 只保留 `view`（删 create/edit/delete）。
3. **入口**：
   - [QualityControlModule.tsx](../src/pages/qc/QualityControlModule.tsx) Master Data 区加 Products / Test Types 两个 NavItem（gate `qc.products.view`），`renderContent` 路由到 `<ProductManagement module="qc"/>` 与 `<TestTypesPage module="qc"/>`。
   - [ProductionModule.tsx](../src/pages/production/ProductionModule.tsx) 保留入口，渲染 `<ProductManagement module="production"/>`（只读）。
4. 文档：`docs/database/03_migrations-and-edge-functions.md` 补 M-127；`09_qc.md` 记 BR-Q53（编辑权回归 QC、Production 只读）。

### M3 — 操作日志（需求 6）｜复刻 finance 审计范式

1. **DB 迁移（M-128）**：建 `qc_product_audit_log`，**结构照搬 `finance_audit_log`（含 3 个索引）**：`entity_type`（`'product'｜'test_type'｜'product_import'`）、`entity_id`、`action`、`actor_auth_id` / `actor_name`、`before_snapshot` / `after_snapshot`、`diff`、`description`、`changed_at`。
2. **[qcApi.ts](../src/services/qcApi.ts)**：加 `logProductAction(...)`（照搬 [api.ts](../src/services/api.ts) 的 `logFinanceAction`：fire-and-forget、从 `erp_user` 取 `full_name`），并加 `getProductAuditLog(...)`。在 `createProduct/updateProduct/deleteProduct/createTestType/updateTestType/deleteTestType` 成功后调用。
3. **UI**：新建 `src/pages/qc/ProductAuditLog.tsx`（仿 [finance/AuditLog.tsx](../src/pages/finance/AuditLog.tsx)），QC 侧加入口，gate `qc.products.view_log`。
4. 文档：`docs/modules/08_finance-audit-log.md` 或 `09_qc.md` 记审计表设计 + M-128。

### M4 — Excel 导出 / 导入（需求 5，**仅核心字段**）｜最后做

1. 依赖：加 `xlsx`（SheetJS，可读可写）。
2. **导出**：QC 页加「导出 Excel」按钮（gate `export`），列 = 核心字段（`code` / `name` / drying days / `sample_every_n_carts` / `cart_units`）。
3. **导入**：上传 Excel → 解析 → **按 `code` 匹配**：存在则 update、不存在则 create（本期**不删**未出现的行，避免误删）→ 预览差异确认 → 逐行校验（数字有效性、必填 `name`）→ 整批提交，失败逐行报错。嵌套 test 模板 / final products **不在本期**。
4. 每次导入写一条 `product_import` 审计（含影响行数）。权限 `import`（prereq edit）。
5. 文档：`09_qc.md` 记 BR-Q54（导入语义：upsert-by-code、不删行、模板二期）。

## 风险与规避

- **权限迁移**：严格走 M-094 的「INSERT 新键 → DELETE 旧键」，且 `view` 只复制不删除 —— 现有授权零丢失。
- **导入**：本期 upsert-by-code、不删行、不碰嵌套模板 —— 数据事故面压到最小。
- **组件复用**：`module` 属性驱动只读，避免维护两份 products 页面。
- **文档同步**：每个里程碑都含对应 `docs/` 更新（项目 CLAUDE.md 强制要求）。

## 编号（实施后确认）

> 计划阶段占位为 M-127/128、BR-Q52/53/54；实施时按仓库实际最新序号（M-146 / BR-Q78）顺延，最终落定为：

- Migration：**M-147** `20260623000001_products_edit_back_to_qc.sql`（权限迁移）、**M-148** `20260623000002_qc_product_audit_log.sql`（审计表）。
- 业务规则：**BR-Q79**（UI 表格化 + S2 WIP 文案）、**BR-Q80**（编辑权回归 QC + Production 只读 + 操作日志）、**BR-Q81**（Excel 导入语义：upsert-by-code、不删行、模板二期）。

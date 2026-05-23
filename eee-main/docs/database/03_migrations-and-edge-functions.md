# SQL Migrations & Edge Functions 索引

> **规则**：每一次新增、修改数据库结构或 Edge Function，都必须：
> 1. 在 `supabase/migrations/` 下新建编号文件（格式见下）
> 2. 在本文件中追加对应的条目
> 3. 更新受影响的模块文档
> 4. 提交到 git

---

## 文件命名规范

### Migration 文件
```
supabase/migrations/YYYYMMDDNNNNNN_<描述>.sql
```
- `YYYYMMDD` — 创建日期
- `NNNNNN` — 当天序号，6 位，从 000000 开始
- `<描述>` — 下划线分隔的英文简述

### Edge Function 目录
```
supabase/functions/<function-name>/index.ts
supabase/functions/_shared/<共享模块>.ts
```

---

## Migrations 清单

### M-001 `20260517000000_initial_schema.sql`
**用途**: 整库初始建表，包含运营模块（7 个域）和财务模块（1 个域）全部 38 张表。

**包含的表**（按业务域）:

| 域 | 表 |
|---|---|
| 参考数据 | uom, item_category, warehouse, location, supplier, customer, item, uom_conversion |
| 库存 | lot, inventory_transaction, inventory_balance |
| 配方/BOM | formula, formula_version, formula_line |
| 采购 | purchase_order, purchase_order_line, goods_receipt, goods_receipt_line |
| 生产 | production_order, production_consumption, production_output |
| 销售/发货 | sales_order, sales_order_line, shipment, shipment_line |
| 质量 | coa |
| 财务 | department, cost_center, gl_account, account_segment, accounting_period, period_status_history, journal_entry, journal_entry_line, ap_invoice, ar_invoice, payment, payment_application |

**关键约束**:
- `journal_entry_line`: `CHECK (NOT (debit > 0 AND credit > 0))` — BR-F2 借贷互斥
- `journal_entry_line`: `CHECK (debit > 0 OR credit > 0)` — 不允许全零行
- `journal_entry.status`: `CHECK (status IN ('draft','posted','reversed'))`（后续 migration 扩展）
- `inventory_transaction`: 只追加，永不修改删除（append-only ledger）

---

### M-002 `20260517000001_rpc_and_views.sql`
**用途**: 创建财务模块所有核心 VIEW 和 RPC 函数（初始版本）。

**包含**:

| 对象 | 类型 | 说明 |
|------|------|------|
| `account_balance` | VIEW | 按科目汇总已过账凭证余额，遵循借贷方向约定 |
| `create_journal_entry` | RPC | 原子创建凭证（含行），初始版本（无 notes 参数） |
| `post_journal_entry` | RPC | 过账，验证 BR-F1/F3/F4/F5 |
| `reverse_journal_entry` | RPC | 反冲已过账凭证，借贷对调，自动过账 |
| `open_accounting_period` | RPC | 开放会计期间 |
| `close_accounting_period` | RPC | 关闭期间（阻止有草稿时关闭） |
| `create_accounting_period` | RPC | 新建期间（校验日期不重叠） |

**依赖**: M-001

---

### M-003 `20260517000002_journal_notes_attachments.sql`
**用途**: 给凭证添加备注字段，新建附件追踪表，在 Storage 创建私有附件桶。

**变更**:
- `ALTER TABLE journal_entry ADD COLUMN notes text` — 凭证内部备注
- `CREATE TABLE journal_entry_attachment` — 附件元数据记录
- `INSERT INTO storage.buckets` — 创建 `journal-attachments` 私有桶（10MB 单文件上限，支持 jpg/png/webp/pdf/xlsx/xls）

**文件路径格式**: `{entryId}/{timestamp}_{sanitizedFileName}`  
**访问方式**: 签名 URL（`createSignedUrl`，有效期 1 小时）

---

### M-004 `20260517000003_add_notes_to_create_je.sql`
**用途**: 为 `create_journal_entry` RPC 增加可选的 `p_notes` 参数（覆盖 M-002 中的版本）。

**变更**: `CREATE OR REPLACE FUNCTION create_journal_entry(...)` — 新增 `p_notes text DEFAULT NULL` 参数，INSERT 时写入 `notes` 列

**依赖**: M-002, M-003（notes 列必须先存在）

---

### M-005 `20260517000004_seed_2026_periods.sql`
**用途**: 预置 2026 年 1–12 月的 12 个会计期间（状态均为 `open`），确保系统开箱即可记账。

**数据**: JAN 2026（2026-01-01 ～ 2026-01-31）到 DEC 2026（2026-12-01 ～ 2026-12-31）

---

### M-006 `20260517000005_je_edit_and_audit.sql`
**用途**: 实现凭证可编辑 + 完整修改审计追踪。

**变更**:

| 对象 | 操作 | 说明 |
|------|------|------|
| `journal_entry.updated_at/by` | ADD COLUMN | 记录最后修改时间和操作人 |
| `journal_entry_edit_log` | CREATE TABLE | 凭证修改审计日志（action: created/updated/posted/reversed） |
| `create_je_shell` | CREATE FUNCTION | 仅建表头（无行），供附件先行上传使用 |
| `update_je_draft` | CREATE FUNCTION | 替换草稿凭证表头和所有明细行 |
| `create_journal_entry` | REPLACE | 修复 `gl_account_id` 空字符串 bigint 转换崩溃（使用 `NULLIF`） |
| `post_journal_entry` | REPLACE | 追加：过账后写入 edit log |

**关键问题修复**: `NULLIF(v_line->>'gl_account_id', '')::bigint` — 避免空字符串转 bigint 报错

---

### M-007 `20260517000006_approval_workflow.sql`
**用途**: 实现两级审批工作流，支持按职级设置单笔审批金额上限。

**变更**:

| 对象 | 操作 | 说明 |
|------|------|------|
| `approval_tier` | CREATE TABLE | 审批层级（manager/$5k, director/$10k, cfo/$100k, ceo/无限） |
| `user_profile` | CREATE TABLE | 用户与审批层级的绑定关系 |
| `journal_entry.status` 约束 | DROP + ADD | 扩展为含 `pending_approval` / `rejected` |
| `journal_entry` 审批字段 | ADD COLUMN | submitted_at/by, approved_at/by, rejected_at/by, rejection_reason, required_tier_id |
| `submit_journal_entry` | CREATE FUNCTION | 提交审批（自动计算所需最低层级） |
| `approve_journal_entry` | CREATE FUNCTION | 批准（校验审批人金额上限，过账） |
| `reject_journal_entry` | CREATE FUNCTION | 拒绝（写入拒绝原因，状态变 rejected） |
| `journal_entry_edit_log.action` 约束 | DROP + ADD | 扩展 action 枚举（+submitted/approved/rejected） |

**RLS 策略**:
- `user_profile`: 所有人可读；仅本人可写自己的记录

---

## Edge Functions 清单

### EF-001 `post-journal-entry`
**目录**: `supabase/functions/post-journal-entry/index.ts`  
**用途**: 为 `post_journal_entry` SQL RPC 提供 HTTP 端点，供外部系统（Webhook、定时任务、第三方集成）调用。前端直接使用 Supabase 客户端 SDK 的 `.rpc()` 调用，**不走此 Edge Function**。

**请求**:
```
POST /functions/v1/post-journal-entry
Authorization: Bearer <JWT>
Content-Type: application/json

{ "entry_id": 123 }
```

**响应**:
```json
// 成功
{ "success": true, "entry_id": 123 }

// 失败（业务规则）
{ "error": "Entry is not balanced: debit=1000 credit=900" }
```

**技术细节**:
- 使用 `SUPABASE_SERVICE_ROLE_KEY`（绕过 RLS）
- 所有业务规则（BR-F1～F5）在 SQL 函数中执行，Edge Function 只做参数传递
- 支持 CORS（通过 `_shared/cors.ts`）

**部署命令**:
```bash
supabase functions deploy post-journal-entry
```

---

### EF-SHARED `_shared/cors.ts`
**目录**: `supabase/functions/_shared/cors.ts`  
**用途**: 所有 Edge Function 共用的 CORS 响应头，统一维护允许的源和方法。

---

### EF-002 `create-auth-user`
**目录**: `supabase/functions/create-auth-user/index.ts`  
**用途**: 使用 service role key 在 Supabase Auth 中创建新用户，供 IT 管理员通过 app 内 IT 面板注册账号（不开放自助注册）。

**请求**:
```
POST /functions/v1/create-auth-user
Authorization: Bearer <JWT>
Content-Type: application/json

{ "email": "user@company.com", "password": "...", "full_name": "Jane Smith" }
```

**响应**:
```json
// 成功
{ "user_id": "<uuid>" }

// 失败
{ "error": "..." }
```

**技术细节**:
- 调用方需提供有效 JWT（验证已登录）
- 使用 `SUPABASE_SERVICE_ROLE_KEY`（服务端专用，不暴露前端）
- 创建后 `email_confirm: true`（跳过邮件验证）
- 触发器 `on_auth_user_created` 自动在 `erp_user` 创建 profile

**部署命令**:
```bash
supabase functions deploy create-auth-user
```

---

## 变更操作规范

### 新增 Migration

1. 确定编号（本文档最后一个 M 编号 +1）
2. 文件命名：`supabase/migrations/YYYYMMDD00000N_<描述>.sql`
3. 文件头部写清注释：
   ```sql
   -- Migration M-00N: <一句话说明>
   -- Depends on: M-00X (如有依赖)
   -- Affects: <受影响的模块文档>
   ```
4. 在本文档追加条目（格式同上）
5. 更新受影响的模块文档
6. `git add` + `git commit`

### 新增 Edge Function

1. 确定编号（本文档最后一个 EF 编号 +1）
2. 目录命名：`supabase/functions/<function-name>/`
3. 必须包含顶部 JSDoc 注释说明用途、请求格式、响应格式
4. 在本文档追加条目
5. `git add` + `git commit`
6. 部署：`supabase functions deploy <function-name>`

### 修改已有对象

- 用 `CREATE OR REPLACE`（函数/VIEW）
- 用 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`（列）
- **禁止**在新 migration 中 `DROP TABLE`（生产数据不可丢）
- 若需重命名/删除列，走 `ALTER TABLE ... RENAME/DROP COLUMN` 并在本文档记录原因

---

---

### M-008 `20260518000000_workflow_studio.sql`
**用途**: 创建 Workflow Studio 功能所需的两张表。

**包含**:

| 对象 | 操作 | 说明 |
|------|------|------|
| `workflow_definition` | CREATE TABLE | 存储工作流的节点和连线 JSON、状态、名称描述 |
| `workflow_run` | CREATE TABLE | 工作流执行历史（触发方式、状态、结果、错误信息） |
| RLS 策略 | CREATE POLICY | 开发阶段：所有用户可读写（生产应按 created_by 限制） |

**关键字段**:
- `workflow_definition.nodes_json` — React Flow 节点数组（JSON），包含节点位置、类型、配置
- `workflow_definition.edges_json` — React Flow 连线数组（JSON）
- `workflow_run.triggered_by` — manual / schedule / event
- `workflow_run.result_json` — 执行结果数据（JSON）

---

### M-009 `20260518000001_user_permission_system.sql`
**用途**: 用户管理与细粒度权限系统。

**包含**:

| 对象 | 操作 | 说明 |
|------|------|------|
| `erp_user` | CREATE TABLE | ERP 内部用户（姓名、邮箱、部门、上级） |
| `user_module_access` | CREATE TABLE | 用户有权访问的模块列表 |
| `user_permission_grant` | CREATE TABLE | 细粒度权限（module/resource/permission + approval_limit） |
| Seed data | INSERT | 3 个演示用户（John Controller、Sarah Manager、Mike Ops） |

**权限结构**（前端定义在 `src/lib/permissionStructure.ts`）：
- Finance: journal_entry（view/create/edit/delete/approve）、chart_of_accounts、approvals、accounting_periods
- Workflow: workflow（view/create/edit/delete/execute）
- Warehouse / Sales / Production: 各自的基础权限集

---

### M-010 `20260518000002_link_erp_user_to_auth.sql`
**用途**: 将 `erp_user` 表与 Supabase `auth.users` 关联，实现 ERP 用户与 Auth 账户的绑定。

**变更**:

| 对象 | 操作 | 说明 |
|------|------|------|
| `erp_user.auth_user_id` | ADD COLUMN | `uuid REFERENCES auth.users(id) UNIQUE`，允许 NULL（历史数据兼容） |
| `list_erp_users()` | CREATE FUNCTION | SECURITY DEFINER RPC，从 `auth.users` 出发 LEFT JOIN `erp_user`，返回合并视图 |
| `handle_new_auth_user()` | CREATE FUNCTION | SECURITY DEFINER 触发器函数，新 auth 用户注册后自动在 `erp_user` 创建 profile |
| `on_auth_user_created` | CREATE TRIGGER | AFTER INSERT ON auth.users，调用 `handle_new_auth_user()` |
| 存量同步 | INSERT | 将 auth.users 中已有用户同步到 erp_user（初次迁移时执行一次） |

**依赖**: M-009

---

### M-011 `20260518000003_fix_list_erp_users.sql`
**用途**: 修复 `list_erp_users()` 函数——原版以 `auth.users` 为主表，当 Supabase Auth 无用户时返回空集。改为以 `erp_user` 为主表，LEFT JOIN auth 数据，确保种子用户和历史数据始终可见。

**变更**:

| 对象 | 操作 | 说明 |
|------|------|------|
| `list_erp_users()` | CREATE OR REPLACE | 改为 `FROM erp_user ep LEFT JOIN auth.users au ON au.id = ep.auth_user_id`，兼容无 auth_user_id 的记录 |

**依赖**: M-010

---

---

### M-012 `20260518000004_seed_manage_permissions.sql`
**用途**: 为 ysha@smu.edu 预置 Finance 模块所有权限（首次让该账号进入财务模块可正常使用）。

**变更**:
- `user_module_access`: 新增 `finance` 模块访问
- `user_permission_grant`: 批量授予 `finance` 下全部权限（journal_entry、chart_of_accounts、accounting_periods 全套 + module_permissions.manage）

---

### M-013 `20260518000005_auth_module_permissions.sql`
**用途**: 为 ysha@smu.edu 预置 Auth 模块所有权限（让该账号可以管理用户和权限）。

**变更**:
- `user_module_access`: 新增 `auth` 模块访问
- `user_permission_grant`: 批量授予 `auth` 下全部权限（users 全套、roles 全套、departments 全套、module_permissions.manage）

---

### M-014 `20260518000006_workflow_permissions_seed.sql`
**用途**: 为 ysha@smu.edu 授予 Workflow Studio 权限，并补充 docs / warehouse / sales / production 模块访问（保证首页所有模块卡片可见）。

**变更**:
- `user_module_access`: 批量新增 `workflow`, `docs`, `warehouse`, `sales`, `production`
- `user_permission_grant`: 授予 `workflow` 下全部权限（view/create/edit/delete/execute + module_permissions.manage）

**背景**: HomePage 改为按 `canAccessModule()` 过滤模块卡片，无 module_access 记录则卡片不显示，故需为管理员账号补全所有模块。

---

### M-015 `20260518000007_add_role_to_erp_user.sql`
**用途**: 在 `erp_user` 表增加 `role` 字段（职位 / 职称），并更新 `list_erp_users()` RPC 包含该字段。

**变更**:
- `ALTER TABLE erp_user ADD COLUMN IF NOT EXISTS role text` — 职位/职称字段
- `list_erp_users()`: 更新返回类型及 SELECT，包含 `role` 列

**依赖**: M-011

---

### M-016 `20260518000008_hr_module_seed.sql`
**用途**: 为 ysha@smu.edu 预置 HR 模块访问及员工权限。

**变更**:
- `user_module_access`: 新增 `hr` 模块访问
- `user_permission_grant`: 授予 `hr.employees.view`（查看员工列表）和 `hr.employees.edit`（编辑员工档案）

**依赖**: M-009, M-015

---

### M-017 `20260518000009_storage_policies.sql`
**用途**: 为 `journal-attachments` Storage bucket 补充 RLS 策略，修复上传 JE 附件时触发的"new row violates row-level security policy"错误。

**变更**:
- `journal-attachments` bucket 新增 RLS 策略：
  - INSERT — `authenticated` 角色可上传
  - SELECT — `authenticated` 角色可读取
  - DELETE — `authenticated` 角色可删除

**依赖**: M-003

---

### M-018 `20260518000010_finance_audit_log.sql`
**用途**: 创建财务操作审计日志表，为所有财务模块变更提供完整追踪。

**包含**:

| 对象 | 操作 | 说明 |
|------|------|------|
| `finance_audit_log` | CREATE TABLE | 财务审计日志主表 |
| RLS 策略 | CREATE POLICY | `authenticated` 角色可 INSERT + SELECT |
| Seed data | INSERT | 为 ysha@smu.edu 授予 `finance.audit_log.view` 权限 |

**`finance_audit_log` 表结构**:

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | bigserial PK | 自增主键 |
| `entity_type` | text | `journal_entry` / `chart_of_accounts` / `accounting_period` / `attachment` |
| `entity_id` | text | 稳定的数据库主键（字符串化），即使科目代码等字段变更也不变 |
| `action` | text | `create` / `edit` / `delete` / `post` / `submit` / `approve` / `reject` / `reverse` / `open` / `close` |
| `actor_auth_id` | uuid | 操作人的 Supabase auth UUID |
| `actor_name` | text | 操作人姓名（冗余存储，防止用户被删后无法显示） |
| `changed_at` | timestamptz | 操作时间（默认 `now()`） |
| `before_snapshot` | jsonb | 操作前完整记录快照 |
| `after_snapshot` | jsonb | 操作后完整记录快照 |
| `diff` | jsonb | 变更字段的前后对比 |
| `entry_number` | text | 可搜索的业务引用：JE 编号 / 科目代码 / 期间名称 / 文件名 |
| `description` | text | 人类可读的操作摘要 |

**依赖**: M-009, M-012

---

### M-019 ~ M-032（HR 模块及 fix-up,待文档补全）

HR 模块的 11 个 migration（`20260519000001` ~ `20260519000011`）以及 `hr_calendar_events`、`fix_1100_parent`、`update_je_posted` 等文件在 SQL 文件源码中已经分配了 `Migration M-020` ~ `Migration M-030` 等编号，但尚未在本索引中展开。后续负责 HR 文档收尾时补齐。本次 QC 模块从 **M-033** 开始,以避免与 HR 已声明的 M-020 ~ M-030 冲突。

---

### M-033 `20260520000001_qc_initial_schema.sql`
**用途**: Quality Control 模块的初始 schema,移植自 `qc-demo/`。所有表以 `qc_` 前缀放在 `public` schema(沿用 `hr_*` 约定),actor 字段统一指向 `auth.users.id`,放弃 qc-demo 原有的 `qc.app_user` 表(改由现有 `erp_user` + 权限系统承担角色管理)。

**新增表**:

| 表 | 用途 |
|---|---|
| `qc_product_sku` | 产品 SKU(含 SOP 参考烘干时长 `standard_drying_minutes`) |
| `qc_inspection_template` | 每个 SKU 的检验上下限模板(`item_name`、`unit`、`lower_limit`、`upper_limit`) |
| `qc_drying_location` | 烘干房位置/层架的主数据(code + display_name) |
| `qc_production_lot` | 生产批(`lot_number`、`lot_barcode`、`work_order_barcode`、`sku_id`) |
| `qc_drying_sub_lot` | 烘干子批(状态机:drying → pending → inspecting → passed/hold → disposing → closed) |
| `qc_inspection_record` | 单次检验记录(`values_json` 存读数,`result` ∈ pass/fail) |
| `qc_disposition` | Hold 子批的处置记录(rework/grind/scrap/concession) |
| `qc_quality_event` | 质量事件流水(check_in/check_out/inspection_passed/inspection_failed_hold/disposition_completed) |

**设计决策**:
- 选择 `public.qc_*` 而非 `qc` schema,是为了让 PostgREST 默认暴露,避免在 Supabase Dashboard 手动添加暴露 schema。
- 状态机改为统一在 RPC 函数内强制(见 M-034)。
- 移除 `qc.app_user` 表 — QC 角色("qc 员"、"manager")通过 `user_permission_grant` 表达(如 `qc.inspections.submit` 即"qc 员能力", `qc.dispositions.create` 即"manager 能力")。

**RLS**: 开发期 `FOR ALL USING (true)`(沿用 HR 模式),生产期通过应用层权限收紧。

**依赖**: M-009(`erp_user` + `auth.users` 关联)

---

### M-034 `20260520000002_qc_rpc_functions.sql`
**用途**: 把 qc-demo FastAPI 后端的状态机 + 判定逻辑全部移植成 Postgres RPC 函数,均放在 `public` schema 下以 `qc_` 前缀。前端通过 `supabase.rpc('qc_*', ...)` 调用。

**核心函数**:

| 函数 | 输入 | 行为 |
|------|------|------|
| `qc_check_in_sub_lot(p_production_lot_id, p_location_id, p_in_time, p_sub_lot_code)` | uuid + 可选 | 创建子批(`drying`),生成 `<lot_barcode>-D##` 编号(可覆盖),发 `check_in` 事件 |
| `qc_check_out_sub_lot(p_sub_lot_id, p_out_time)` | uuid + 可选时间 | drying → pending,发 `check_out` 事件 |
| `qc_submit_inspection(p_sub_lot_id, p_aw)` | uuid + numeric | pending → inspecting → passed/hold(自动按上下限判定),写 `qc_inspection_record` + `inspection_passed`/`inspection_failed_hold` 事件 |
| `qc_create_disposition(p_sub_lot_id, p_type, p_remark)` | uuid + enum + 可选 text | hold → disposing → closed,写 `qc_disposition` + `disposition_completed` 事件;仅允许 type ∈ rework/grind/scrap/concession |
| `qc_dashboard_summary()` | — | 返回 pending/hold/今日通过/今日失败 计数、最长等待分钟数、今日通过率,以及详细的 pending_items / holds / today_passed_items / today_failed_items |
| `qc_list_pending_inspections()` | — | 待检子批列表 |
| `qc_list_production_lots()` | — | 生产批 + sku 关联 |
| `qc_list_sub_lots(p_production_lot_id?)` | 可选 uuid | 子批列表(可按 production_lot 过滤) |
| `qc_list_products()` | — | SKU + 嵌套检验模板 |
| `qc_list_locations()` | — | 烘干房位置 |
| `qc_production_lot_detail(p_lot_id)` | uuid | 单生产批 + 子批 + 最近 50 条事件(含 summary 文案) |
| `qc_seed_demo_data()` | — | 幂等地清空 QC 表并写入演示数据(2 SKU、6 location、2 lot、3 sub-lot) |

**Helper 函数**:
- `qc_format_fail_reason(value, lower, upper, item_name)` — 生成不合格原因英文文案
- `qc_quality_event_summary(event_type, payload, sub_lot_code)` — 给事件流生成可读摘要
- `qc_sub_lot_to_json(sub_lot_id, include_hold_detail?)` — 把子批组装成前端 SubLot 类型 jsonb(含 wait_minutes、hold_reason 等派生字段)
- `qc_today_inspection_item(record_id)` — dashboard 用,封装今日单条检验

**业务规则**:
- **BR-Q1** Aw 取值范围 `[lower_limit, upper_limit]` 闭区间内即为 pass,否则 fail。
- **BR-Q2** 状态机仅允许预定义的转移,跨步转移会抛 `Sub-lot not inspectable / disposition flow` 异常。
- **BR-Q3** `submit_inspection` 时若状态为 `pending`,函数会自动先转 `inspecting` 再判定(对应 qc-demo 的"start_inspection"事件)。
- **BR-Q4** 一个 SKU 当前默认对应一个检验模板(`LIMIT 1`),多模板支持留待 Phase 2。

**依赖**: M-033

---

### M-035 `20260520000003_qc_module_seed.sql`
**用途**: 给开发用户 `ysha@smu.edu` 赋予 QC 模块访问权限及所有资源动作权限,然后调用 `qc_seed_demo_data()` 写入演示数据。

**写入的权限**(`user_permission_grant`):

| Resource | Permission |
|----------|-----------|
| module_permissions | manage |
| products | view / create / edit / delete |
| locations | view / manage |
| production_lots | view / create |
| sub_lots | view / check_in / check_out |
| inspections | view / submit |
| dispositions | view / create |
| dashboard | view |
| trace | view |
| audit_log | view |

**依赖**: M-033, M-034, M-009(user_permission_grant)

---

### M-036 `20260520000004_qc_dryer_grid.sql`
**用途**: 引入 5 dryer × 10×10 = 500 格的物理网格,并把 sub-lot 创建拆成两步("created" → "drying"),前者由 Production 页面创建,后者由新的 Check-in to Dryer 网格页推动。

**变更**:

| 对象 | 操作 | 说明 |
|------|------|------|
| `qc_drying_sub_lot.location_id` FK | DROP + ADD | 改为 `ON DELETE SET NULL`(为重种 location 行铺路) |
| `qc_drying_sub_lot.status` CHECK | 替换 | 加入 `'created'` 状态(共 8 个状态) |
| `qc_drying_location` | ALTER + DELETE + INSERT | 加 `dryer_number int`、`cell_number int`(0..99) 列,清空旧 6 行,种 500 行(5 dryer × 100 cell);加 `UNIQUE (dryer_number, cell_number)` |
| `qc_list_locations` | REPLACE | 返回新的 dryer_number / cell_number |
| `qc_sub_lot_to_json` | REPLACE | sub-lot 输出加 dryer_number / cell_number |
| `qc_create_sub_lot(p_production_lot_id, p_sub_lot_code)` | CREATE | Production 创建用,状态 `created`,无 location/in_time,发 `sub_lot_created` 事件 |
| `qc_register_in_dryer(p_sub_lot_id, p_location_id, p_in_time)` | CREATE | created → drying,写 location_id + in_time + `check_in` 事件;若 cell 已被 active sub-lot 占用则抛异常 |
| `qc_seed_demo_data` | REPLACE | 改用新的网格 + 不再 truncate `qc_drying_location` |

**网格编号约定**:格子 0..99 行优先,`row = cell / 10`,`col = cell % 10`,UI 上显示为 "00".."99"。

**业务规则**:
- **BR-Q8** Sub-lot 默认在 `created` 状态(由 Production 创建),只有通过 Check-in to Dryer 才能进入 `drying`。
- **BR-Q9** 一个 dryer cell 同时最多只能被一个 active sub-lot 占用(`drying / pending / inspecting / hold / disposing`)。`qc_register_in_dryer` 在数据库层做最后一道校验。

**依赖**: M-033, M-034

---

### M-037 `20260520000005_qc_expected_dry.sql`
**用途**: 给 sub-lot 加预计烘干时长字段,为 Dry Rooms 列表页和 Dry Room 详情页提供倒计时数据。

**变更**:

| 对象 | 操作 | 说明 |
|------|------|------|
| `qc_drying_sub_lot.expected_dry_minutes int` | ADD COLUMN | 由 Production 表单设置,创建时写入每个 sub-lot;为 NULL 表示无倒计时 |
| `qc_create_sub_lot(..., p_expected_dry_minutes)` | REPLACE | 接受新参数 |
| `qc_sub_lot_to_json` | REPLACE | 输出新增 `expected_dry_minutes` + `expected_finish_at`(= `in_time + expected_dry_minutes`) |
| `qc_dry_room_summary()` | CREATE | 返回 5 行(每个 dryer)统计:`total_cells`、`occupied_count`、`available_count`、`drying_count`、`next_finish_at` |
| `qc_list_sub_lots_by_dryer(p_dryer_number)` | CREATE | 返回该 dryer 下所有 active sub-lot,按预计完成时间升序(NULL 排最后) |

**业务规则**:
- **BR-Q10** `expected_dry_minutes` 在 Production 表单填一次,应用到本次创建的所有 sub-lot;后续 sub-lot 进入烘干房后,UI 用 `in_time + expected_dry_minutes` 推导剩余时间。

**依赖**: M-033, M-034, M-036

---

### M-038 `20260520000006_qc_move_and_history.sql`
**用途**: 引入 cart 移位 + 暂停/累计的时长记录,为 Dry Room 详情页的"hover/click 占用格 → Move to other spot"流程兜底。

**变更**:

| 对象 | 操作 | 说明 |
|------|------|------|
| `qc_drying_sub_lot.status` CHECK | 替换 | 加入 `'awaiting_recheck'` 状态(被挤出来的车,暂停计时) |
| `qc_sub_lot_spot_history` | CREATE TABLE | 每段"在某格子的时段"一行:`drying_sub_lot_id` / `location_id` / `dryer_number` / `cell_number` / `started_at` / `ended_at` / `end_reason` (`check_out` / `move` / `displaced`) / `duration_minutes` (close 时 denormalised) |
| `qc_total_dried_minutes(sub_lot_id)` | CREATE | 把所有 history 行的 closed duration 加上当前 open 段的 elapsed,精确到现在为止的累计烘干时长 |
| `qc_sub_lot_to_json` | REPLACE | 用 `qc_total_dried_minutes` 重新算 `total_dried_minutes` / `remaining_minutes` / `expected_finish_at`;输出新增 `lot_number` |
| `qc_register_in_dryer` | REPLACE | 允许 `created` 或 `awaiting_recheck` 入烘干;开新 spot_history 行;事件类型按来源记 `check_in` 或 `resume_drying` |
| `qc_check_out_sub_lot` | REPLACE | 关闭当前 spot_history 行(end_reason=`check_out`);出烘干后清掉 `location_id` |
| `qc_move_sub_lot(sub_lot_id, new_location_id)` | CREATE | 关闭当前 spot_history 行(`move`);若目标格被占,把占用方挤到 `awaiting_recheck`(关其 history,end_reason=`displaced`,清掉 location);搬本人到新格 + 开新 spot_history 行;事件 `moved` |
| `qc_list_awaiting_recheck()` | CREATE | 返回所有 `awaiting_recheck` sub-lot,Dry Room 详情页用来渲染顶部"待重新放置"区 |
| 历史数据 backfill | INSERT | 已有 `drying` sub-lot 自动补一条 open 的 spot_history 行,避免新逻辑下倒计时归零 |

**业务规则**:
- **BR-Q11** Sub-lot 的累计烘干时长 = 所有 history 段 `duration_minutes`(关闭段) + 当前 open 段的 `now - started_at`。
- **BR-Q12** `qc_move_sub_lot` 移到被占格时,占用方进 `awaiting_recheck` 并暂停计时;再次入格(`qc_register_in_dryer`)时不重置 `in_time`,直接 resume,累计时长继续在 spot_history 上累加。
- **BR-Q13** 仅 `drying` 状态的 sub-lot 可移位;`awaiting_recheck` 只能通过再次 `register_in_dryer` 入烘干。

**依赖**: M-033, M-034, M-036, M-037

---

### M-039 `20260520000007_qc_sampling_and_room_temp.sql`
**用途**: 重做 Testing 流程 — 取样 → WA → 显式 Confirm → Pass/Fail 落盘 → 不合格走分流(redry 回烘干房 / Room Temp Dry / scrap / concession)。同时加 sub-lot 完整历史 RPC,支持时间线视图。

**变更**:

| 对象 | 操作 | 说明 |
|------|------|------|
| `qc_drying_sub_lot.status` CHECK | 替换 | 加入 `'room_temp_drying'`(共 10 个状态) |
| `qc_sample` | CREATE TABLE | 样品记录:`sample_id` (text, 用户输入), `taken_at`, `taken_by_auth_id`, `inspection_record_id` (WA 提交后回填), `status` ∈ `pending`/`inspected`/`voided`, void 三件套 |
| `qc_inspection_record.sample_id` | ADD COLUMN (FK → qc_sample) | 检验记录反向链回样品(每个 inspection 对应一个 sample) |
| `qc_room_temp_dry_session` | CREATE TABLE | 室温干 session:`drying_sub_lot_id`, `disposition_id`, `started_at` / `ended_at` / `duration_minutes`, 双 actor uuid |
| `qc_disposition.type` CHECK | 替换 | 加入 `'redry_dryer'` / `'room_temp_dry'`(共 6 种) |
| `qc_disposition.redry_expected_dry_minutes` | ADD COLUMN | 仅 `redry_dryer` 用,记录重新烘干的预计时长 |
| `qc_take_sample(sub_lot_id, sample_id)` | CREATE | 校验 sub-lot 在 `pending`/`inspecting`,INSERT `qc_sample` (pending),发 `sample_taken` 事件;返回 sample 行 |
| `qc_submit_inspection` | REPLACE | 新增 `p_sample_pk` 可选参数;若给定,校验属于此 sub-lot 且 status=`pending`,inspection 写入后回链 sample 并标 `inspected` |
| `qc_create_disposition` | REPLACE | 新增 `p_redry_expected_dry_minutes`;按 type 分流后续状态:`redry_dryer` → sub-lot 进 `awaiting_recheck`(清 in_time,改写 expected_dry_minutes);`room_temp_dry` → sub-lot 进 `room_temp_drying` 并自动开 `qc_room_temp_dry_session`;其他 → `closed` |
| `qc_stop_room_temp_dry(sub_lot_id)` | CREATE | 关闭当前 room_temp_dry session(填 ended_at + duration);sub-lot 回到 `pending` + out_time = now(),回到 Testing 队列 |
| `qc_list_room_temp_drying()` | CREATE | 列出正在室温干的 sub-lot + open session 的 `started_at` + 实时 elapsed |
| `qc_list_samples_for_sub_lot(sub_lot_id)` | CREATE | 该 sub-lot 的所有 sample(含 AW/result join) |
| `qc_sub_lot_full_history(sub_lot_id)` | CREATE | 返回完整时间线 jsonb:sub_lot 概览 + spot_history + samples + inspections + dispositions + room_temp_sessions + events,前端 SubLotHistoryDrawer 一次拉完展示 |
| `qc_find_sub_lot_by_sample(sample_id)` | CREATE | 用 text sample_id 反查所有匹配的 sample 记录(支持跨 sub-lot 查找) |

**业务规则**:
- **BR-Q14** 取样必须先于 WA 提交;一个 sample 一旦 `inspected` 不可再用(需重新 `qc_take_sample` 生成新 sample 才能再测)。
- **BR-Q15** Pass/Fail 永远由 backend 按 `qc_inspection_template` 上下限**自动判定**(BR-Q1 复用);前端的 Pass/Fail 预览仅供 QC 员 confirm,真正落盘还是 `qc_submit_inspection` 的判定结果。
- **BR-Q16** 不合格走 `redry_dryer` 时,sub-lot 进 `awaiting_recheck`,新的 `expected_dry_minutes` 覆盖旧值,`in_time` 清空(下次入烘干房会重置计时);spot_history 上之前的烘干段保留,但 `qc_total_dried_minutes` 也会同时累积,如果业务要求"重烘期间不计入累计已烘干时长",后续可加 `dried_reset_at` 字段切断累计。
- **BR-Q17** 不合格走 `room_temp_dry` 时,disposition 创建的同时自动 INSERT 一条 open 的 `qc_room_temp_dry_session`(operator 不需要再点 Start);UI 显示 count-up,操作工点 Stop 才结束 session 并把 sub-lot 切回 `pending`。
- **BR-Q18** **所有数据只追加,不覆盖**:sample 不能修改(只能 void 后重新 take_sample);inspection_record append-only;disposition append-only;room_temp session 只在结束时填 ended_at,不删行。

**依赖**: M-033, M-034, M-036, M-037, M-038

---

### M-040 `20260521000001_qc_permission_granularity.sql`
**用途**: 按客户在第 6 点提出的"production、create check-in、create new dry room、取样、输入测试数据、查看 dry room 状态、testing 状态、sub-lot 历史"分别拆出独立权限开关。一次性把旧 QC 权限全清,重种新结构。

**新权限结构**(同时在 [src/lib/permissionStructure.ts](../../src/lib/permissionStructure.ts) 同步声明):

| Resource | Permission | 含义 |
|----------|-----------|------|
| module_permissions | manage | 模块管理员 |
| **production** | create_batch | (1) 用 Production 表单创建 Batch + sub-lots |
| **batches** | view / create / delete | (3) 直接管理 Batch 列表 |
| **dry_rooms** | view_status | (6) 看 5 dryer 卡片 + grid + 占用 |
| dry_rooms | check_in | (2) Place sub-lot 进格子 |
| dry_rooms | move | (4) Move-to-other-spot |
| dry_rooms | check_out | Cart 出烘干房 |
| **testing** | view_status | (7) 看 Testing 队列 |
| testing | take_sample | (4) 取样 |
| testing | submit_inspection | (5) 录入 WA 并 confirm |
| testing | dispose_redry | 不合格 → redry_dryer |
| testing | dispose_room_temp | 不合格 → room_temp_dry |
| testing | dispose_scrap_concession | 不合格 → scrap / concession / rework / grind |
| testing | stop_room_temp | 停止 Room Temp Dry session |
| **sub_lots** | view_history | (8) 打开 SubLotHistoryDrawer |
| products | view / create / edit / delete | SKU + inspection template |
| locations | view / manage | Cell 主数据 |
| dashboard | view | 管理仪表盘 |
| trace | view | Batch trace |
| audit_log | view | QC 审计 |

**变更**:

| 对象 | 操作 |
|------|------|
| `user_permission_grant` (qc.*) | DELETE 所有 ysha@smu.edu 旧 qc 权限 |
| `user_permission_grant` (qc.*) | INSERT 上表全部新键 |

**业务规则**:
- **BR-Q19** 每一种动作必须有**独立**的权限开关,UI 不再用复合检查("能创建 Batch 又能 check-in" → 不行,必须 `production.create_batch` 单一开关);权限结构变更必须同步 PERMISSION_STRUCTURE,旧键不留向后兼容(开发期 only 一个 dev user,清洁断开)。

**配套前端改动**:
- `permissionStructure.ts` QC 段重写
- 所有 QC 页面 `can(...)` 调用替换为新键(LotsList / LotDetail / Production / DryRoomDetail / TestingPage / RoomTempDryPage / AdminDashboard / PendingQueue / ProductManagement / QualityControlModule / QcHome)
- TestingPage 的 DispositionPicker 按 dispose_redry / dispose_room_temp / dispose_scrap_concession 三个细分权限过滤可选项

**依赖**: M-033, M-035(原权限种子), M-039

---

### M-041 `20260521000002_qc_overview_and_release.sql`
**用途**: 提供合并版 "QC Home + Dashboard" 所需的 RPC,加 sub-lot 上的 `has_pending_sample` 派生字段(让 Testing 页能区分"待取样" vs "样品已取 / 待录 WA"),加 `qc_release_passed_sub_lot` RPC 用于 Pass 后"分配下一步"动作(passed → closed)。

**变更**:

| 对象 | 操作 |
|------|------|
| `qc_sub_lot_has_pending_sample(sub_lot_id)` | CREATE 布尔 helper |
| `qc_sub_lot_to_json` | REPLACE,输出新增 `has_pending_sample` / `latest_pending_sample_id` / `latest_pending_sample_pk` |
| `qc_release_passed_sub_lot(sub_lot_id)` | CREATE,`passed → closed`,发 `released` 事件 |
| `qc_overview()` | CREATE,返回 today 日期 + 8 项 stats + 最近 24h `needs_attention` 列表(每条带 result/aw/sample_id/current_status) |
| `user_permission_grant` | INSERT 新键 `qc.dashboard.release_pass` 给 ysha@smu.edu |

**业务规则**:
- **BR-Q20** `pending` 状态下,只要还没有 status='pending' 的 sample 就算"等待取样";一旦取样,就是"已取样 / 待录 WA"。
- **BR-Q21** Pass 的 sub-lot 显式 `release` 才进入 `closed`(append-only 一条 `released` 事件)。

**依赖**: M-039, M-040

---

### M-042 `20260521000003_qc_drop_batches_permissions.sql`
**用途**: 删掉 `qc.batches.*` 权限组。原因:`batches.create` 跟 `production.create_batch` 是重复入口(都是往 `qc_production_lot` 插一行),侧边栏 Batches 入口已经移除,权限保留没意义。LotsList.tsx 保留为 dead code,以后想恢复"管理员管 Batch 列表"再接回侧边栏即可。

**变更**:

| 对象 | 操作 |
|------|------|
| `user_permission_grant` (qc.batches.*) | DELETE 所有匹配行 |

**前端配套**:
- `permissionStructure.ts` 删除 `batches` 资源段
- `QualityControlModule.tsx` 移除 Batches NavItem(+ unused `Boxes` / `BarChart3` icon)
- `QualityControlModule.tsx` 同步移除 QC Dashboard NavItem(已合并入 QC Home)

**依赖**: M-040

---

### M-043 `20260521000004_qc_find_by_code.sql`
**用途**: 给 Dry Room 详情页的 "Scan QR" 按钮提供 sub-lot 编码反查 RPC。操作工扫码或手打 sub-lot code,前端调 `qc_find_sub_lot_by_code(text)` 拿到完整 SubLot json,然后按 status 分流(`created`/`awaiting_recheck` → 进 place mode;`drying` 在本 dryer → 弹 cell detail;其他 → 提示去 Testing/其他 dryer)。

**变更**:

| 对象 | 操作 |
|------|------|
| `qc_find_sub_lot_by_code(p_code text)` | CREATE STABLE,返回 jsonb 或 NULL |

**输入容错**:
- 直接 sub_lot_code 精确匹配
- 若失败,尝试把输入按 URL 解析,取最后一段路径(支持 QR 编码 URL)
- 自动 trim whitespace

**业务规则**:
- **BR-Q22** Scan QR 是 stateless 反查:不修改任何数据,只查;后续动作由前端按 status 决定(place / move / view-only)。
- **BR-Q23** 工业 USB 扫描枪触发 keydown + Enter,前端用 `<form onSubmit>` 拦截 Enter 即可,不需要 camera 库。

**依赖**: M-033

---

### M-044 `20260522000001_finance_pnl.sql`
**用途**: 给财务报表 P&L 提供按期间聚合的 RPC,补全 Finance P0 缺口里的"利润表"。数据全部来自现有的 posted journal lines,加 `entry_date` 区间过滤(VIEW 不能传参数,所以用 SQL function)。

**变更**:

| 对象 | 操作 | 说明 |
|------|------|------|
| `gl_pnl(p_start_date date, p_end_date date)` | CREATE STABLE SQL function | 返回 `(id, account_code, name, account_type, parent_id, is_postable, is_active, total_debit, total_credit, net_amount)`,仅 revenue + expense 科目;按 `account_type DESC, account_code` 排序让 revenue 先出 |

**判定逻辑**:
- `account_type='revenue'` → `net_amount = SUM(credit) - SUM(debit)`(贷方为正)
- `account_type='expense'` → `net_amount = SUM(debit) - SUM(credit)`(借方为正)
- 只统计 `journal_entry.status='posted'` 且 `entry_date BETWEEN p_start_date AND p_end_date` 的行
- 包含 non-postable 父科目(前端按需做层级 roll-up)+ inactive 科目(前端按需过滤)

**业务规则**:
- **BR-F9** P&L 只统计 `journal_entry.status='posted'` 的行;draft / pending_approval / rejected 都不计入,reversed 的原单也不计(跟 TB 口径一致)
- **BR-F10** P&L 期间过滤使用 `journal_entry.entry_date`(凭证业务日期),不是 `posted_at`(过账时间)

**前端配套**:
- [types/index.ts](../../src/types/index.ts) 新增 `PnLRow` interface
- [services/api.ts](../../src/services/api.ts) 新增 `getPnL(startDate, endDate)`
- 新页 [pages/finance/ProfitLoss.tsx](../../src/pages/finance/ProfitLoss.tsx) 含 PeriodSelector(period dropdown + custom date range)、两段(Revenue / Expense)、Net Income footer、行点击预留 drill-down hook(`pnl-drill:<account_id>:<start>:<end>` deep-link 格式,真过滤在 P0 #5 实现)
- Sidebar Reports 区加 `Profit & Loss` NavItem,权限点 `finance.journal_entry.view`(MVP 复用)

**依赖**: M-001(`gl_account` + `journal_entry` + `journal_entry_line` 基础表)

---

### M-045 `20260522000002_finance_balance_sheet.sql`
**用途**: 给财务报表 Balance Sheet 提供 as-of 日期聚合 RPC。仅返回 asset / liability / equity 三类科目的余额;Retained Earnings 不在 RPC 里算,前端通过调 `gl_pnl('1900-01-01', as_of)` 累计 net income 得到(BR-F11),复用现有 P&L 逻辑不重复 SQL。

**变更**:

| 对象 | 操作 | 说明 |
|------|------|------|
| `gl_balance_sheet(p_as_of_date date)` | CREATE STABLE SQL function | 返回 `(id, account_code, name, account_type, parent_id, is_postable, is_active, balance)`,过滤 `entry_date <= p_as_of_date AND status='posted'` |

**判定逻辑**:
- `account_type='asset'` → `balance = SUM(debit) - SUM(credit)`(借方正)
- `account_type IN ('liability', 'equity')` → `balance = SUM(credit) - SUM(debit)`(贷方正)
- 不包含 revenue / expense(由前端通过 P&L 累计 → 合成 Retained Earnings 行)

**业务规则**:
- **BR-F11** Balance Sheet 的 Retained Earnings(留存收益)= 前端调 `gl_pnl('1900-01-01', as_of_date)` 累计的 net income;不在 BS RPC 里重复算,保持单一数据源。BS 页底部的 balance check(Assets = Liabilities + Equity)依赖这个计算正确。

**前端配套**:
- [types/index.ts](../../src/types/index.ts) 新增 `BalanceSheetRow` interface
- [services/api.ts](../../src/services/api.ts) 新增 `getBalanceSheet(asOfDate)`
- 新页 [pages/finance/BalanceSheet.tsx](../../src/pages/finance/BalanceSheet.tsx) 含 `AsOfDateSelector`(Period End mode / Custom date mode)、三段(Assets / Liabilities / Equity)、合成 Retained Earnings 行、底部 "In Balance / OUT OF BALANCE" badge + 差额提示
- Sidebar Reports 区在 P&L 后加 `Balance Sheet` NavItem(Scale icon)

**依赖**: M-001(基础表)、M-044(`gl_pnl` 用于 RE 计算)

---

### M-046 `20260522000003_qc_disposition_retest.sql`
**用途**: 给 hold sub-lot 加第 4 种处置方式 `retest`(重新取样测试,不重烘)。同时修复 QcHome 上 "Dispose" 按钮跳到 Testing 后找不到 hold sub-lot 的问题(改成直接在 Dashboard 弹 modal)。

**变更**:

| 对象 | 操作 |
|------|------|
| `qc_disposition.type` CHECK | 替换 — 加入 `'retest'`(共 7 种) |
| `qc_create_disposition` | REPLACE — `retest` 分支让 sub-lot 状态从 `hold` → `pending`(回 Testing 队列,等重新取样) |
| `user_permission_grant` | INSERT `qc.testing.dispose_retest` for ysha@smu.edu |

**4 种处置方式 UI 标签(用户业务术语)**:
1. **再次进入 Dry Room** → `redry_dryer`(回烘干房,设新预计时长)
2. **进入 Room Temp Dry** → `room_temp_dry`(室温干,正计时)
3. **重新取样测试** → `retest`(回 Testing,不重烘)
4. **报废** → `scrap`(终结)

**业务规则**:
- **BR-Q24** `retest` disposition 让 sub-lot 回 `pending` 状态,旧 sample 已 `inspected/fail`,不会再被复用;操作工要去 Testing 取一个新 sample_id 才能继续录 WA。所有旧数据(spot_history / inspection_record / 旧 sample)全部保留 — append-only(BR-Q18)。

**前端配套**:
- 新组件 [components/DisposeDialog.tsx](../../src/pages/qc/components/DisposeDialog.tsx) — modal 形式的 4 选项处置面板,接受 sub-lot 概要,内部调 `createDisposition`
- [QcHome.tsx](../../src/pages/qc/QcHome.tsx) "Dispose" 按钮改成直接打开此 modal(修原本跳 Testing 找不到 hold 车的 bug)
- [TestingPage.tsx](../../src/pages/qc/TestingPage.tsx) DispositionPicker 也加 Retest 选项,UI 标签同步改成中英混排
- `PERMISSION_STRUCTURE` 加 `qc.testing.dispose_retest` 权限点
- `DispositionType` 类型加 `'retest'`

**依赖**: M-039

---

### M-047 `20260522000004_qc_spot_selection_toggle.sql`
**用途**: 加 runtime feature flag 控制是否启用 cell-level spot 选择,加无格子的批量 check-in 流程。grid UI 保留代码但默认隐藏(flag 为 `false`)。

**变更**:

| 对象 | 操作 |
|------|------|
| `app_settings(key, value, description, updated_at, updated_by)` | CREATE TABLE — 通用 key/value 配置表 |
| `get_app_setting(p_key)` | CREATE — 读单个 setting,返回 jsonb |
| Seed `qc.spot_selection_enabled = false` | INSERT |
| `qc_drying_sub_lot.dryer_number int` | ADD COLUMN — CHECK(1..5 或 NULL),让 sub-lot 不通过 location_id 也能挂到 dryer 上 |
| Backfill `dryer_number` from existing `location.dryer_number` | UPDATE |
| `qc_sub_lot_to_json` | REPLACE — `dryer_number` 优先取 column,fallback 到 location;同时输出 `sku_id` / `sku_code` 供前端按 SKU 分组 |
| `qc_register_sub_lots_in_dryer_bulk(p_sub_lot_ids[], p_dryer_number, p_in_time)` | CREATE — 批量入烘干,无 cell;返回 `{requested, succeeded, failed}` jsonb,逐个校验状态,容量超 100 整批拒绝 |
| `qc_list_sub_lots_by_dryer` | REPLACE — 用 `COALESCE(s.dryer_number, l.dryer_number)` 过滤,兼容两种模式 |
| `qc_dry_room_summary` | REPLACE — 同上,occupancy 统计能 mix-mode 工作 |

**业务规则**:
- **BR-Q25** spot_selection_enabled = false 时,sub-lot 入烘干房只设 `dryer_number` 而不设 `location_id`(cell);capacity 模型仍然每车占 100 容量中的 1 个槽。flag 切回 true 后,新检入会要求 cell,但已有不带 cell 的车不受影响(共存)。
- **BR-Q26** 批量 check-in 时,任何 sub-lot 的 status ∉ (`created`, `awaiting_recheck`) 都被跳过,记入 result.failed 数组,前端展示为"断码 / ineligible"警告;成功的进 result.succeeded。

**前端配套**:
- `useQcSpotSelectionEnabled()` hook,60s 内存缓存
- `DryRoomDetail` 根据 flag 在 Grid 模式 / List 模式间切换,grid 代码完整保留(P2 重启 spot 选择时无需重写)
- 新组件 `DryRoomListMode` — 按 Product/SKU → Work Order → carts 分层,sub-lot 按 remaining time 升序排;每个 work order 顶部显示 finish bucket 摘要
- 新组件 `BulkCheckInDialog` — 确认 modal,显示选中 cart 总数 + 断码警告
- `qcApi.ts` 新增 `getAppSetting` / `registerSubLotsBulk`,`SubLot` 类型加 `sku_id` / `sku_code`

**翻转开关方式**(暂无 UI):
```sql
UPDATE app_settings
SET value = 'true'::jsonb, updated_at = now()
WHERE key = 'qc.spot_selection_enabled';
```
前端有 60s 缓存,改完后下次访问 Dry Room 详情页或刷新一次会生效。

**依赖**: M-036(`qc_drying_location.dryer_number`)、M-038(`qc_sub_lot_spot_history`)

---

### M-048 `20260522000005_qc_sampling_groups.sql`
**用途**: 引入 sampling group(批量抽样组)机制 — 出库时按 work order 把 N 辆车一组,随机挑 champion 进 Testing,组内其他车进 `awaiting_group_result` 暂存;PASS 时整组放行,FAIL 时仅 champion 入 hold;champion 走 retest disposition 时同组自动 re-roll 下一辆。

**变更**:

| 对象 | 操作 |
|------|------|
| `qc_product_sku.sample_every_n_carts int DEFAULT 1` | ADD COLUMN — 每多少辆取 1 个 sample(SKU 维度);1 = 全检,2 = 每 2 辆抽 1 ... |
| `qc_test_group(id uuid pk, production_lot_id, group_sequence int, member_count int, status, created_at)` | CREATE TABLE — 一次批量出库针对某 work order 形成的抽样组 |
| `qc_drying_sub_lot.test_group_id uuid REFERENCES qc_test_group(id)` | ADD COLUMN |
| `qc_drying_sub_lot.is_test_champion boolean DEFAULT false` | ADD COLUMN |
| `qc_drying_sub_lot_status` enum 加 `awaiting_group_result` | ALTER TYPE |
| `qc_check_out_sub_lots_bulk(p_sub_lot_ids[], p_out_time)` | CREATE — 一次性出库 + 按 production_lot 拆组(`ceil(N/sample_every_n_carts)` 组)+ 随机挑 champion + 写 `test_group_*` 字段;返回 `{requested, succeeded, failed, groups[]}` jsonb |
| `qc_submit_inspection` | REPLACE — champion PASS 时整组成员 → `passed`,FAIL 仅 champion 入 `hold`,其余成员保持 `awaiting_group_result` |
| `qc_create_disposition` | REPLACE — champion 选 `retest` 时,从同组 `awaiting_group_result` 成员中随机选一个新 champion 提升为 `pending`(member_count > 1 时),保持组 ID 不变 |
| `qc_sub_lot_to_json` | REPLACE — 新增 `sku_id` / `sku_code` / `sample_every_n_carts` / `test_group_id` / `test_group_sequence` / `test_group_member_count` / `test_group_status` / `is_test_champion` |

**业务规则**:
- **BR-Q27** 每次 `qc_check_out_sub_lots_bulk` 调用内部按 `production_lot_id` 分桶,每桶按各车所在 SKU 的 `sample_every_n_carts` 切片 — 最后一段不足 N 的也单独成组(roundup),保证至少出一个 champion。
- **BR-Q28** Champion 在 Testing 阶段:PASS → 同组 `awaiting_group_result` 兄弟车批量晋升 `passed`(自动放行);FAIL → 仅 champion 转 `hold`,兄弟车仍 `awaiting_group_result` 等下一轮处置。Disposition = `retest` 是唯一能 re-roll champion 的路径 — 调用时同组 `awaiting_group_result` 成员随机选一个晋升 `pending` 成为新 champion,旧 champion 进 closed。

**前端配套**:
- `qcApi.ts`:`SubLot` 类型加 group/champion 字段;`SubLotStatus` 联合补 `awaiting_group_result`;`checkOutSubLotsBulk` 改为 `(input: { sub_lot_ids, out_time? })` 签名,返回 `BulkCheckOutResult { requested, succeeded, failed, groups[] }`
- `Product` / `ProductInput` 加 `sample_every_n_carts`,create/update 一并写入
- 新组件 `BulkCheckOutDialog` — 出库前 preview,按 work order 显示 carts → groups 摘要
- `DryRoomListMode` 右侧改为多选 drying carts → "Check out (N)" 走 bulk RPC;移除单车 check-out 按钮
- `TestingPage` champion 在 pending queue 显示 `Users ×N` 紫色 badge;选中后页头加紫色 banner 提示"PASS 整组放行 / FAIL 仅 champion"
- `ProductManagement` 表单新增 sample rate 输入字段
- `LotDetail` 老的 bulk check-out 调用同步换签名

**依赖**: M-035(`qc_product_sku`)、M-039(`qc_sub_lot_status` enum、`qc_submit_inspection`)、M-046(`qc_create_disposition` retest 分支)

---

### M-049 `20260522000006_qc_list_products_with_sample_n.sql`
**用途**: `qc_list_products()` 输出补上 `sample_every_n_carts`(M-048 follow-up),让 ProductManagement 能展示/编辑 sample rate。

**变更**:

| 对象 | 操作 |
|------|------|
| `qc_list_products()` | REPLACE — 输出 jsonb 中新增 `sample_every_n_carts` 字段 |

**依赖**: M-048

---

### M-050 `20260522000007_qc_wo_dry_days_and_analysis.sql`
**用途**: Work order 创建强制要求 expected dry time(分钟,UI 输入用天);sub-lot 改成按 min/max 范围批量创建(代码 `<lot_barcode>-NNN`);新增 add-to-existing / move-dryer / forecast / analysis RPCs;auto-gen SKU code helper。

**变更**:

| 对象 | 操作 |
|------|------|
| `qc_production_lot.expected_dry_minutes int NOT NULL` | ADD COLUMN — 先 backfill(子批 max → SKU SOP → 1440 fallback)再设 NOT NULL,加 CHECK > 0 (BR-Q29) |
| `qc_create_production_lot_with_sub_lots(p_lot_number, p_lot_barcode, p_work_order_barcode, p_sku_id, p_expected_dry_minutes, p_sub_lot_start_seq, p_sub_lot_end_seq)` | CREATE — 一次性创建 lot + 范围内所有 sub-lots,代码 `<lot_barcode>-NNN`(3 位填充);校验 expected dry > 0 (BR-Q29/Q30) |
| `qc_add_sub_lots_to_lot(p_production_lot_id, p_start_seq?, p_end_seq?, p_count?)` | CREATE — 给已有 work order 补车,默认从现有最大序号 + 1 续,继承 lot 的 expected_dry_minutes |
| `qc_move_sub_lots_dryer(p_sub_lot_ids[], p_new_dryer_number)` | CREATE — 批量把 drying 状态的 sub-lot 移到另一个 dryer (1..5);拒绝 `same_dryer` / `wrong_status` / `not_found`;清掉 `location_id` 走 list-mode;写 `move_dryer` event (BR-Q31) |
| `qc_dashboard_pass_rate_forecast()` | CREATE — 按 SKU 聚合"在制车 × 今日通过率"为预测通过数;无今日测试默认按 100% |
| `qc_analysis_metrics(p_sku_id?, p_from_date?, p_to_date?, p_dryer_number?, p_production_lot_id?)` | CREATE — Analysis 页指标:总车数 / 平均干燥时间 / 首检通过率 / 各 disposition 路径(retest / redry / room_temp)的次数+平均 dwell+下一次通过率 / 报废数 (BR-Q32) |
| `qc_next_sku_code()` | CREATE — 返回下一个 `SKU-NNNN`(BR-Q33),被前端 `createProduct` 在无 code 输入时调用 |

**业务规则**:
- **BR-Q29** Work order 创建时必须指定 `expected_dry_minutes > 0`;空值或 0 会被 RPC 抛异常拒绝。前端在 Production 表单上将其设为必填(以"天"为输入单位,1 day = 1440 min)。
- **BR-Q30** Sub-lot 编号规范统一为 `<lot_barcode>-NNN`(3 位零填充)。Production 表单要求输入 min/max 两个数字而非每车 code 列表;Add-carts 对话框默认从现有最大序号 + 1 续。
- **BR-Q31** Move-dryer 仅对 `drying` 状态 sub-lot 生效;移到同一 dryer 会被拒(`same_dryer`)。move 不改 in_time / total_dried,只换 dryer 归属 + 清掉 location_id。
- **BR-Q32** Analysis "next pass rate" 取 disposition `created_at` 之后第一条 inspection_record 的 result;dwell 时间 = `next_inspection_submitted_at - disposition.created_at`。
- **BR-Q33** SKU code 由 `qc_next_sku_code()` 自动生成为 `SKU-NNNN`;ProductManagement 表单不再暴露 code 输入。

**前端配套**:
- `qcApi.ts`:`ProductionLot.expected_dry_minutes` 必填;`createProductionLot` 改用新 RPC,签名加 `expected_dry_minutes` + `sub_lot_start/end_seq`;新增 `addSubLotsToLot` / `moveSubLotsDryer` / `dashboardPassRateForecast` / `analysisMetrics`;`ProductInput.code` 改为可选(无值时调 `qc_next_sku_code`)
- `lib/utils.ts`:新增 `MINUTES_PER_DAY` / `minutesToDays` / `daysToMinutes` / `fmtDays` / `fmtDuration` — 所有干燥时间 UI 显示统一用"天"为主单位
- `lib/audio.ts`:Web Audio `beep()` + `warnBeep()`(双音报警)— 用于 DuplicateScanDialog
- 新组件:`AddCartsDialog` / `MoveDryerDialog` / `DuplicateScanDialog`
- 新页面:`AnalysisPage`(BarChart3 图标进 sidebar Management 区,权限 `qc.trace.view`)
- `Production` 表单大改:移除每车 code 列表 → 只输 min/max;expected dry 改成"天"必填
- `ProductManagement`:移除 SKU code 输入,只输 product name(code 后端自动生成);days 输入
- `LotDetail`:页头加"Add carts"按钮 + AddCartsDialog;头部 metadata 显示 expected dry(天)
- `DryRoomListMode`:右侧 action bar 加 "Move ({N})" 紫色按钮 → MoveDryerDialog;scan 时同代码二次扫描触发 DuplicateScanDialog(蜂鸣 + Confirm 才进选择)
- `QcHome`:stats 下方新增"Predicted passes"卡片网格 — 每个 in-flight SKU 一张

**依赖**: M-033(`qc_drying_sub_lot`/`qc_production_lot`)、M-046(disposition retest)、M-047(`dryer_number` 列 + `app_settings`)、M-048(`awaiting_group_result` 状态)

---

### M-051 `20260522000008_qc_analysis_metrics_fix.sql`
**用途**: 修 `qc_analysis_metrics` 调用时报 `column reference "result" is ambiguous`。

**根因**: M-050 把 plpgsql 局部变量命名为 `result`,与 `qc_inspection_record.result` / `first_insp.result` / `disp_with_next.next_result` 在同一作用域里。Postgres 在子查询里看到无前缀的 `result` 引用时无法判断该用哪个,直接报 ambiguous。

**修复**:
- 局部变量改名 `out_json`
- 每个内部子查询的表加别名(`fi` / `dw` / `d2`),并把 `result` / `type` / `next_result` 等所有列引用都加前缀

**依赖**: M-050(`qc_analysis_metrics` 原定义)

---

### M-052 `20260522000009_qc_analysis_count_group_siblings.sql`
**用途**: Analysis 页"First time test"漏算 sampling group 中的 sibling 车。

**根因**: M-048 的 champion-propagation 让 sibling 车 status 升 `passed`,但**不写** `qc_inspection_record`。M-050/M-051 的 `qc_analysis_metrics` 只统计 inspection_record 行,所以 1 champion + 1 sibling 的组只算 1 次测试,与操作员"我刚刚做了 2 个测试"的直觉不符。

**修复**: 把 `first_insp` 拆成 `direct_insp`(本车的 inspection)+ `sibling_insp`(本车没 record,但同组 champion 有 → 继承 champion 的 result/submitted_at)两段 UNION ALL,再供下游 pass_rate / fail_count 等计算。`disp_with_next` 不动 — disposition 自带 record。

**业务规则**:
- **BR-Q35** Analysis 指标里,test_group 中没有自己 inspection_record 的 sibling 车,按 champion 的首次 inspection result 计入 first-time test 统计(BR-Q28 的 propagation 在分析口径上对齐操作员心智)。

**依赖**: M-048(`is_test_champion` / `test_group_id`)、M-051(`qc_analysis_metrics` 上一版)

---

### M-053 `20260522000010_qc_sub_lot_code_use_work_order.sql`
**用途**: 新建 sub-lot 的 code 前缀从 `lot_barcode` 改成 `work_order_barcode`,目标格式 `<work_order>-NNN`。

**变更**:
- `qc_create_production_lot_with_sub_lots` REPLACE — 内部 code 拼接改用 `p_work_order_barcode`
- `qc_add_sub_lots_to_lot` REPLACE — 改用 `lot.work_order_barcode`
- `qc_sub_lot_to_json` REPLACE — 输出新增 `work_order_barcode` 字段供前端展示

**注**: 已存在的 sub-lots(沿用 lot_barcode 前缀)保持原样,只对新建的生效;前缀混用不影响 RPC 的 regex `-\d{3}$` 序号解析。

**依赖**: M-050

---

### M-054 `20260522000011_qc_analysis_scope_by_any_activity.sql`
**用途**: Analysis 日期过滤改为 "any activity in range" — 一辆车只要在日期区间内有 check-in / inspection / disposition 任一活动,就计入 scope。

**根因**: 之前只看 `s.in_time`,昨天 check-in 但今天 test 的车在 "Today" 视图被排除;与操作员"今天的测试报告"心智不符。

**修复**: scope CTE 的 date 条件改成 OR 三项:`s.in_time`、`qc_inspection_record.submitted_at`、`qc_disposition.created_at` 任一落在 `[from, to+1day)`。`p_from_date` 和 `p_to_date` 同时为 NULL(All time)时跳过过滤。

**业务规则**:
- **BR-Q36** Analysis 日期 filter 按"活动"过滤而非"创建":区间内有任意 check-in / inspection / disposition 的 sub-lot 都计入。

**依赖**: M-052

---

### M-055 `20260522000012_fix_checkout_bulk_ambiguous_alias.sql`
**用途**: 修复 `qc_check_out_sub_lots_bulk` 函数中 SQL 别名歧义导致的运行时报错。

**根因**: Step 2 的 FOR 循环中用了别名 `s`,与 PL/pgSQL 局部变量 `s qc_drying_sub_lot%ROWTYPE` 在同一作用域内冲突,Postgres 无法消歧义。

**修复**: 把 Step 2 FOR 循环内部的 SQL 别名 `s` 重命名为 `sl`,消除与 PL/pgSQL 变量的歧义。

**依赖**: M-048

---

### M-056 `20260522000013_qc_group_fail_propagates_to_siblings.sql`
**用途**: Champion FAIL 时,同组所有处于 `awaiting_group_result` 状态的兄弟车一并转入 `hold`(原逻辑只处理 champion 本身)。

**变更**:
- `qc_submit_inspection` REPLACE — FAIL 分支新增:把同组所有 `awaiting_group_result` 成员 batch UPDATE 为 `hold`,写 `inspection_failed_hold` 事件

**业务规则**:
- **BR-Q28 更新** Champion FAIL → champion 入 `hold`,**同组所有 `awaiting_group_result` 兄弟车也同时入 `hold`**;后续统一走 disposition 流程。

**依赖**: M-048, M-055

---

### M-057 `20260522000014_qc_overview_add_group_info.sql`
**用途**: `qc_overview()` 的 `needs_attention` 行补充 sampling group 字段,让 QC Home 的每一行能展示组信息。

**变更**:
- `qc_overview()` REPLACE — `needs_attention` 每行新增字段:`test_group_id`、`group_size`、`group_sub_lot_ids`、`group_sub_lot_codes`、`work_order_barcode`

**依赖**: M-041, M-048

---

### M-058 `20260522000015_qc_analysis_grant_all_qc_users.sql`
**用途**: 将 `qc.analysis.view` 权限授予所有已拥有任意 QC 权限的用户,修复侧边栏 Analysis 入口对部分用户不可见的问题。

**变更**:
- `user_permission_grant` INSERT — 对所有在 `user_module_access` 中有 `qc` 模块访问记录的用户,批量补录 `qc.analysis.view`

**依赖**: M-040, M-050

---

### M-059 `20260522000016_qc_recent_failed_inspections.sql`
**用途**: 新增 RPC `qc_recent_failed_inspections(p_days int DEFAULT 2)`,为 QC Home FAIL 统计卡片的详情面板提供数据。

**变更**:

| 对象 | 操作 | 说明 |
|------|------|------|
| `qc_recent_failed_inspections(p_days int DEFAULT 2)` | CREATE | 返回最近 N 天的失败检验记录,含 group 成员明细 |

**返回字段**:
- 失败 inspection 的基础信息(sub_lot_code, sku_name, work_order_barcode, submitted_at, aw_value)
- `group_member_codes`、`group_size` — 方便展示整组受影响的车

**依赖**: M-048, M-057

---

### M-060 `20260522000017_qc_disposition_accept_awaiting_group.sql`
**用途**: `qc_create_disposition` 新增接受 `awaiting_group_result` 作为合法入口状态(与 `hold` 同等处理)。

**根因**: M-056 之前创建的组,兄弟车仍处于 `awaiting_group_result`(未被迁移到 `hold`),在 M-056 上线后这些车执行 disposition 时会抛 "Sub-lot not in disposition flow" 异常。

**修复**: `qc_create_disposition` REPLACE — 入口状态检查允许 `hold` 或 `awaiting_group_result`

**依赖**: M-039, M-056

---

### M-061 `20260522000018_qc_disposition_skip_already_processed.sql`
**用途**: `qc_create_disposition` 对已处理状态的子批静默跳过(no-op),不再抛异常。

**根因**: 对整组批量 re-dispatch 处置时,部分车已进入 `closed` / `awaiting_recheck` / `room_temp_drying` / `pending` 状态;原函数对这些状态抛异常,导致批量操作中途失败。

**修复**: `qc_create_disposition` REPLACE — 检测到 `closed` / `awaiting_recheck` / `room_temp_drying` / `pending` 状态时直接 RETURN(静默 no-op),不影响本次 batch 中其他车

**依赖**: M-060

---

### M-062 `20260522000019_qc_checkout_group_by_sub_lot_code.sql`
**用途**: 修复抽样组分配顺序,确保 sub-lot 按代码顺序(而非创建时间)编组。

**根因**: M-048 中 `array_agg` 按 `created_at` 排序,若多车在同一毫秒创建则顺序不确定,导致组的分配不稳定(非 001-002-003 / 004-005-006 的直觉顺序)。

**修复**: `qc_check_out_sub_lots_bulk` REPLACE — `array_agg(ORDER BY sub_lot_code)` 替换 `ORDER BY created_at`,保证编组按代码字典序确定性排列

**依赖**: M-048, M-055

---

### M-063 `20260523000001_qc_checkout_regroup_redry_carts.sql`
**用途**: 已重新烘干的车(曾有 `test_group_id`)在再次出库时,重新分配到新的 `qc_test_group`。

**根因**: 原逻辑跳过已有 `test_group_id` 的车,导致重烘车走 re-dispatch 后无法进入新一轮 champion 抽样流程。

**变更**:
- Step 1:clear `is_test_champion = false`(确保旧 champion 标记不干扰新一轮)
- Step 2b(新增):对已有 `test_group_id` 的 `awaiting_recheck` 状态车,创建新的 `qc_test_group` 行,并按 `sample_every_n_carts` 重新拆组、挑 champion

**依赖**: M-048, M-062

---

### M-064 `20260523000002_qc_full_permissions_gmail_user.sql`
**用途**: 为 `shayiqing16@gmail.com` 授予完整 QC 权限集 + 模块访问(原先只有 `ysha@smu.edu` 有种子权限)。

**变更**:
- `user_module_access` INSERT — `qc` 模块访问给 `shayiqing16@gmail.com`
- `user_permission_grant` INSERT — 全套 QC 权限(与 M-040/M-041 给 ysha 的一致)

**依赖**: M-040, M-041

---

### M-065 `20260523000003_qc_overview_needs_attention_active_only.sql`
**用途**: `qc_overview` 的 `needs_attention` 列表只展示组内仍有活跃车的条目(避免已处理完毕的旧 FAIL 记录一直残留)。

**变更**:
- `qc_overview()` REPLACE — `needs_attention` FAIL 结果增加过滤条件:组内仍有车处于 `hold` 或 `awaiting_group_result` 才纳入;PASS 结果过滤:组内仍有车处于 `passed`(等待 release)才纳入

**业务逻辑**:之前 `needs_attention` 会展示所有 24h 内的 pass/fail 检验结果(无论现状如何);改后只显示仍需人工干预的条目,操作完毕后自动从列表消失。

**依赖**: M-057

---

### M-066 `20260523000004_qc_overview_needs_attention_pass_and_fail.sql`
**用途**: 修复 M-065 的过度过滤——PASS 结果(status=`passed`,等待 release)被错误排除。

**根因**: M-065 的 PASS 过滤条件过严,导致 passed 状态的车不再出现在 `needs_attention` 列表,操作员看不到需要 Release 的车。

**修复**: `qc_overview()` REPLACE — 恢复 PASS 结果(status=`passed`,需 release)与 FAIL 结果并列展示;FAIL 过滤条件(组内有 `hold`/`awaiting_group_result`)保持 M-065 的逻辑不变

**依赖**: M-065

---

### M-067 `20260523000005_packaging_module.sql`
**用途**: 新增 Packaging(打包)模块。引入 `released_at` 时间戳、`dispatched` 状态、出库表及全套打包 RPC。

**变更**:

| 对象 | 操作 | 说明 |
|------|------|------|
| `qc_drying_sub_lot.released_at timestamptz` | ADD COLUMN | QC release 时刻,`qc_release_passed_sub_lot()` 执行时写入;供 FIFO 排序和在库天数计算 |
| `qc_drying_sub_lot.status` CHECK | 替换 | 加入 `'dispatched'` 状态(打包出库后,终态) |
| `qc_release_passed_sub_lot` | REPLACE | 执行 `passed → closed` 时同步写入 `released_at = now()` |
| `pkg_outbound` | CREATE TABLE | 每次打包出库事件:`sku_id`、`cart_count`、`note`、`dispatched_by`、`dispatched_at` |
| `pkg_outbound_item` | CREATE TABLE | 出库明细:`outbound_id`、`sub_lot_id`、`sub_lot_code`、`days_in_stock` |
| `pkg_available_carts(p_sku_id uuid)` | CREATE | 返回指定 SKU 的 `closed` 车辆列表,按 `released_at` ASC(FIFO) |
| `pkg_skus_with_stock()` | CREATE | 返回有库存(`closed` 车)的 SKU 列表及各自数量 |
| `pkg_dispatch_carts(p_sub_lot_ids uuid[], p_note text)` | CREATE | 原子出库:cart 状态 `closed → dispatched`,写 `pkg_outbound` + `pkg_outbound_item` 记录 |
| `pkg_inventory_summary()` | CREATE | 按 SKU 统计 green(`<10d`) / yellow(`10-14d`) / red(`≥15d`) 分桶数,供 QC Home 横向堆叠色条图使用 |
| `user_permission_grant` | INSERT | 为 `ysha@smu.edu` 和 `shayiqing16@gmail.com` 授予 `packaging.outbound.view` + `packaging.outbound.dispatch` |
| `user_module_access` | INSERT | 为两个开发用户新增 `packaging` 模块访问 |

**新增状态机转移**:
```
closed → dispatched   (pkg_dispatch_carts)
```

**业务规则**:
- **BR-P1** FIFO 排序以 `released_at`(QC release 时刻)为准,早释放的车优先出库。
- **BR-P2** `pkg_dispatch_carts` 是原子操作:写 `pkg_outbound` + `pkg_outbound_item` + batch UPDATE sub-lot 状态在同一事务内完成;任一失败则整批回滚。
- **BR-P3** 在库天数 = `now() - released_at`(天数,向下取整);≥0 且 <10 为 green,10-14 为 yellow,≥15 为 red。
- **BR-P4** 只有 `closed` 状态的车才出现在打包队列;`dispatched` 是 Packaging 模块的终态。

**前端配套**:
- 新文件 `src/services/pkgApi.ts` — 类型化 wrapper:`getSkusWithStock()` / `getAvailableCarts(skuId?)` / `dispatchCarts(ids, note?)` / `getInventorySummary()`
- 新页面 `src/pages/packaging/PackagingPage.tsx` — 两栏:左 SKU 卡片列表 + 右 FIFO 车辆表格,支持扫码/checkbox 选车,顶部在库天数 badge(绿/黄/红),底部出库操作栏
- 新文件 `src/pages/packaging/PackagingModule.tsx` — 模块 shell,含返回按钮
- `src/App.tsx` — 新增 `packaging` 模块路由分支
- `src/pages/HomePage.tsx` — 新增 Packaging 橙色主题卡片
- `src/lib/permissionStructure.ts` — 新增 `packaging.outbound.{view,dispatch}`
- `src/pages/qc/QcHome.tsx` — 新增 Released Inventory 板块:调 `pkg_inventory_summary()`,按 SKU 渲染横向堆叠色条(green/amber/red 分桶)

**依赖**: M-041(`qc_release_passed_sub_lot`)、M-064(开发用户权限)

---

## 快速 Migration 编号参考

| 编号 | 文件 |
|------|------|
| M-001 | 20260517000000_initial_schema.sql |
| M-002 | 20260517000001_rpc_and_views.sql |
| M-003 | 20260517000002_journal_notes_attachments.sql |
| M-004 | 20260517000003_add_notes_to_create_je.sql |
| M-005 | 20260517000004_seed_2026_periods.sql |
| M-006 | 20260517000005_je_edit_and_audit.sql |
| M-007 | 20260517000006_approval_workflow.sql |
| M-008 | 20260518000000_workflow_studio.sql |
| M-009 | 20260518000001_user_permission_system.sql |
| M-010 | 20260518000002_link_erp_user_to_auth.sql |
| M-011 | 20260518000003_fix_list_erp_users.sql |
| M-012 | 20260518000004_seed_manage_permissions.sql |
| M-013 | 20260518000005_auth_module_permissions.sql |
| M-014 | 20260518000006_workflow_permissions_seed.sql |
| M-015 | 20260518000007_add_role_to_erp_user.sql |
| M-016 | 20260518000008_hr_module_seed.sql |
| M-017 | 20260518000009_storage_policies.sql |
| M-018 | 20260518000010_finance_audit_log.sql |
| M-019 ~ M-032 | _(HR + 财务 fix-up 待补,详见 M-019~M-032 段)_ |
| M-033 | 20260520000001_qc_initial_schema.sql |
| M-034 | 20260520000002_qc_rpc_functions.sql |
| M-035 | 20260520000003_qc_module_seed.sql |
| M-036 | 20260520000004_qc_dryer_grid.sql |
| M-037 | 20260520000005_qc_expected_dry.sql |
| M-038 | 20260520000006_qc_move_and_history.sql |
| M-039 | 20260520000007_qc_sampling_and_room_temp.sql |
| M-040 | 20260521000001_qc_permission_granularity.sql |
| M-041 | 20260521000002_qc_overview_and_release.sql |
| M-042 | 20260521000003_qc_drop_batches_permissions.sql |
| M-043 | 20260521000004_qc_find_by_code.sql |
| M-044 | 20260522000001_finance_pnl.sql |
| M-045 | 20260522000002_finance_balance_sheet.sql |
| M-046 | 20260522000003_qc_disposition_retest.sql |
| M-047 | 20260522000004_qc_spot_selection_toggle.sql |
| M-048 | 20260522000005_qc_sampling_groups.sql |
| M-049 | 20260522000006_qc_list_products_with_sample_n.sql |
| M-050 | 20260522000007_qc_wo_dry_days_and_analysis.sql |
| M-051 | 20260522000008_qc_analysis_metrics_fix.sql |
| M-052 | 20260522000009_qc_analysis_count_group_siblings.sql |
| M-053 | 20260522000010_qc_sub_lot_code_use_work_order.sql |
| M-054 | 20260522000011_qc_analysis_scope_by_any_activity.sql |
| M-055 | 20260522000012_fix_checkout_bulk_ambiguous_alias.sql |
| M-056 | 20260522000013_qc_group_fail_propagates_to_siblings.sql |
| M-057 | 20260522000014_qc_overview_add_group_info.sql |
| M-058 | 20260522000015_qc_analysis_grant_all_qc_users.sql |
| M-059 | 20260522000016_qc_recent_failed_inspections.sql |
| M-060 | 20260522000017_qc_disposition_accept_awaiting_group.sql |
| M-061 | 20260522000018_qc_disposition_skip_already_processed.sql |
| M-062 | 20260522000019_qc_checkout_group_by_sub_lot_code.sql |
| M-063 | 20260523000001_qc_checkout_regroup_redry_carts.sql |
| M-064 | 20260523000002_qc_full_permissions_gmail_user.sql |
| M-065 | 20260523000003_qc_overview_needs_attention_active_only.sql |
| M-066 | 20260523000004_qc_overview_needs_attention_pass_and_fail.sql |
| M-067 | 20260523000005_packaging_module.sql |
| **M-068** | _(下一个)_ |

| 编号 | 目录 |
|------|------|
| EF-001 | functions/post-journal-entry/ |
| EF-SHARED | functions/_shared/ |
| EF-002 | functions/create-auth-user/ |
| **EF-003** | _(下一个)_ |

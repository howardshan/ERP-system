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
| **M-019** | _(下一个)_ |

| 编号 | 目录 |
|------|------|
| EF-001 | functions/post-journal-entry/ |
| EF-SHARED | functions/_shared/ |
| EF-002 | functions/create-auth-user/ |
| **EF-003** | _(下一个)_ |

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

### EF-003 `reset-user-password`
**目录**: `supabase/functions/reset-user-password/index.ts`
**用途**: 使用 service role key 重置某 Auth 用户密码,供 IT 管理员通过 app 内面板操作。

**请求**:
```
POST /functions/v1/reset-user-password
Authorization: Bearer <JWT>
Content-Type: application/json

{ "auth_user_id": "<uuid>", "new_password": "..." }
```

**响应**:
```json
{ "success": true }   // 成功
{ "error": "..." }    // 失败
```

**技术细节**:
- 调用方需提供有效 JWT(验证已登录)
- `new_password` 至少 6 位
- 使用 `SUPABASE_SERVICE_ROLE_KEY` 调 `auth.admin.updateUserById`

**部署命令**:
```bash
supabase functions deploy reset-user-password
```

---

### EF-004 `send-notification`
**目录**: `supabase/functions/send-notification/index.ts`
**用途**: 通过 SMTP2Go HTTP API 发送 ERP 通知邮件。Phase 1 处理 QC 测试结果通知,由 M-083 的 `trg_qc_notify_on_inspection` 触发器经 pg_net 调用——每记录一次 QC 测试自动发信。

**请求**(由 DB 触发器发起,无终端用户 JWT):
```
POST /functions/v1/send-notification
x-notify-secret: <NOTIFY_WEBHOOK_SECRET>
Content-Type: application/json

{ "type_key": "qc_test_result", "inspection_id": "<uuid>" }
```

**响应**:
```json
{ "sent": [{ "to": "...", "ok": true }] }   // 已发送(每个收件人一条)
{ "skipped": "no recipients enabled" }       // 无生效收件人
{ "error": "..." }                            // 失败
```

**技术细节**:
- **必须用 `--no-verify-jwt` 部署**(触发器无用户 JWT);改用共享密钥 `x-notify-secret` == `NOTIFY_WEBHOOK_SECRET` 鉴权
- 用 `SUPABASE_SERVICE_ROLE_KEY` 调 RPC `notification_recipients` 解析收件人、`qc_test_result_email` 组装内容
- 发件人取 `NOTIFY_SENDER_EMAIL`(默认 `noreply@crave-cook.com`),API key 取 `SMTP2GO_API_KEY`,均为 Supabase secret,**不入前端/不入库**
- 每个收件人逐封发送并写 `notification_log`

**部署命令**:
```bash
supabase functions deploy send-notification --no-verify-jwt
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

### M-075 `20260523000019_qc_bulk_checkout_fix_step2_cascade.sql`
**用途**: 修复 `qc_check_out_sub_lots_bulk` Step 2a → Step 2b 级联 bug,该 bug 会把同次 bulk checkout 中刚被分到 fresh group 的 champion 误判成 redry 车,再单独成组,把 sibling 孤立在已废弃的旧组里。

**问题现场**(W12345 批次,`sample_every_n_carts=3`,一次 bulk 出 [001,003,004,005]):

| 阶段 | 行为 |
|---|---|
| Step 2a | 把 [001,003,004] 分到 group A(champion=004),[005] 分到 group B。004/005 status='pending',001/003 status='awaiting_group_result' |
| Step 2b | WHERE `status='pending' AND test_group_id IS NOT NULL` 命中 004 和 005,把它们各自挪到新 singleton group C 和 D |
| 后果 | 001/003 留在 group A 当孤儿;champion 004 的 PASS 在 group C 里找不到 sibling,M-055 propagation `group_members_propagated=0`;001/003 永远卡在 awaiting_group_result,QC Home 不显示 |

**修复**: 在 Step 1 之后、Step 2a 之前**快照** `fresh_ids` 和 `redry_ids`,Step 2a 只迭代 fresh 集合、Step 2b 只迭代 redry 集合;不再依赖 Step 2a 之后的 `status='pending'` 作为分流条件。

**变更**:

| 对象 | 操作 | 说明 |
|------|------|------|
| `qc_check_out_sub_lots_bulk` | REPLACE | Step 2 之前显式分类 fresh / redry;两条循环各自 `WHERE sl.id = ANY(...)` 限定到对应集合 |

**业务规则**(沿用,未改语义):
- **BR-Q1** Fresh 车按 `(production_lot_id, sample_every_n_carts)` 聚合,按 `sub_lot_code` 顺序切块,每块大小 N(最后一块可能 <N),每块随机选 1 个 champion。
- **BR-Q2** Redry 车按 `(production_lot_id, 旧 test_group_id, sample_every_n_carts)` 聚合,同 cohort 重新切块、重新选 champion;不同 cohort 互不混组。
- **BR-Q3** 同一次 bulk 调用中 fresh 和 redry 永远进入两条独立的分组路径(M-075 修复保证)。

**配套修复**: 见 M-076,以独立 migration 形式修复因 bug 卡住的具体数据。

**依赖**: M-063(`qc_check_out_sub_lots_bulk` 引入 redry 重组逻辑)、M-056(`qc_submit_inspection` 的 group 传播,本次未改动)。

---

### M-076 `20260523000020_repair_w12345_orphan_siblings.sql`
**用途**: 一次性数据修复,把 M-075 bug 期间 W12345 批次被孤立的 sibling 车并到 champion 实际所在的 group 下,状态升到 `passed`(对应 champion 的 PASS 判定)。

**修复对象**(基于 `qc_quality_event` 审计):

| 孤儿 sibling | 原孤儿 group | 实际 champion | champion 当前 group | 操作 |
|---|---|---|---|---|
| W12345-001, W12345-003 | `d207adf6...` | W12345-004 (passed) | `7724ef98...` | 迁移并设为 `passed` |
| W12345-010 | `d088289a...` | W12345-009 (passed→released) | `1639a6a0...` | 迁移并设为 `passed` |

**变更**:
- 受影响 sibling 的 `qc_drying_sub_lot.test_group_id` 改为 champion 当前 group;`status='passed'`;`is_test_champion=false`
- champion 当前 group 的 `qc_test_group.member_count` 由 1 校正到 3 或 2;`status='passed'`、`resolved_at` 补齐
- 原孤儿 group 标记 `status='closed_failed'`,标识它们已废弃
- 写 `qc_quality_event` 类型 `manual_repair`(`payload.migration_ref='M-076'`)留审计;`NOT EXISTS` 保证重跑不重复写

**特性**: 幂等。每条 UPDATE 都带显式的原始破损状态 WHERE,修复完之后再跑都是 no-op。

**依赖**: M-075(必须先修代码,再修数据)。

---

### M-077 `20260523000021_qc_needs_attention_per_group.sql`
**用途**: 把 `qc_overview()` 的 `needs_attention` 从 M-074 的 per-cart 显示回退到 per-group 显示——一个组一行,旁边列出还需要 action 的成员 badge——同时保留 M-074 想修的「sibling 在 disposition 路径不丢」那个边角语义。

**背景对比**:

| 版本 | 行粒度 | disposition 过滤 | 已知问题 |
|---|---|---|---|
| M-070 | per-inspection (≈ per-group) | 仅查 champion 的 disposition | 若 champion 已 dispose 但 sibling 没,整组会被误隐藏 |
| M-074 | per-cart | 查每车自己的 disposition | UI 噪声大;3 车同 PASS 也要点 3 次 Release |
| **M-077** | per-group(本迁移) | 查 group 内**任一成员**的 disposition | 兼顾两者 |

**核心 SQL 变化**:
- 仍从 `qc_inspection_record` 出发(一行 inspection = 一行 needs_attention)
- WHERE 条件:`test_group_id IS NOT NULL` 时 EXISTS 子查询找「组内还有 status∈(passed,hold) 且未被 disposition 覆盖的成员」;solo 路径同理
- `group_size` / `group_sub_lot_ids` / `group_sub_lot_codes` 用同样的过滤条件聚合,**已 release/dispose 的成员不进 badge 列表**
- 前端 `QcHome.tsx` 不需要改 — 沿用 M-074 之前的 `removeAttentionItem(item.inspection_id)` + `group_size > 1` 语义即可

**业务规则**:
- **BR-Q4** Needs Attention 行的可见性以组为单位:组内只要还有一辆需要 action,这一行就一直显示;最后一辆被 action 之后,这一行从列表消失。
- **BR-Q5** badge 列表只列出**当前还需要 action**的成员,操作员可以一眼看到「这组还差几辆没处理」。

**依赖**: M-074(本迁移替换其 `qc_overview()` 实现)、M-070(原始 per-group 形式参考)、M-055(group propagation 语义,本次未改)。

---

### M-078 `20260523000022_qc_create_disposition_fix_room_temp_columns.sql`
**用途**: 修复 `qc_create_disposition` 的 `room_temp_dry` 分支两个 regression(由 M-072 引入):

1. **列名拼错** — INSERT 时写的 `started_by`,而表上实际列名是 `started_by_auth_id`。前端点 "Room temp dry" → Confirm disposition 直接报 `column "started_by" of relation "qc_room_temp_dry_session" does not exist`。
2. **disposition_id 链接丢失** — M-072 把 `qc_disposition` 的 INSERT 移到了 type 分支之后,导致写 `qc_room_temp_dry_session` 时还没有 `new_id`,disposition_id 字段被默默漏掉,事后按 disposition 追溯 session 找不到记录。

**修复**:
- 把 `qc_disposition` INSERT 移回 type 分支**之前**(M-048 / M-060 / M-061 / M-065 一直是这个顺序)
- room_temp_dry 分支恢复 `INSERT INTO qc_room_temp_dry_session (drying_sub_lot_id, disposition_id, started_by_auth_id)`,列名和 disposition_id 都对
- M-072 修的 「champion 无 sibling 时 retest 走回 'pending'」语义**完整保留**

**依赖**: M-072(继承其 retest 语义),M-039(`qc_room_temp_dry_session` 表 DDL)。

---

### M-079 `20260523000023_qc_testing_view_dashboard_permission.sql`
**用途**: 前端为 TestingPage 内嵌的「Dashboard」标签新增独立权限 `qc.testing.view_dashboard`(今日汇总 + 3 天预测,主要给计划/管理层看,而不是 QC 操作员)。本迁移把这条新权限补发给两个已有「全 QC 权限」的开发账号(`ysha@smu.edu` via M-040,`shayiqing16@gmail.com` via M-063),让 demo 行为不变。

**变更**:
- `user_permission_grant` 插入两行 `(qc, testing, view_dashboard)`;`ON CONFLICT DO NOTHING` 保证重跑无害

**业务规则**: 沿用 BR-Q19(每个动作一个独立开关)。视图也算「动作」之一时再拆分,避免「能看队列就能看预测」的粗粒度耦合。

**前端配套**:
- `src/lib/permissionStructure.ts` — `qc.testing` 资源下新增 `view_dashboard` 条目,prereq=`view_status`
- `src/pages/qc/TestingPage.tsx` — Dashboard 标签按钮仅在 `canViewDashboard` 时显示;`activeTab='dashboard'` 也要 `canViewDashboard` 才会渲染 `<TestingDashboard />`;且回退 queue 显示条件改为 `activeTab === 'queue' || !canViewDashboard`,防止权限被收回时页面空白

**依赖**: M-063(给 gmail 开发账号的全 QC 权限种子,本迁移在其基础上补 1 个 key)。

---

### M-080 `20260525000001_qc_location_crud.sql`
**用途**: 给 `qc_drying_location`(烘干位置主数据)加 CRUD,并把 `qc_dry_room_summary` 改成数据驱动,以便新增 dryer / cell 后 Dry Rooms 列表自动反映。之前 5×100 的 grid 是 M-036 一次性 seed,代码里 `qc.locations.{view,manage}` 权限早就定义了但没有任何后台 RPC / 前端页面,完全是占位。

**新增 RPC**:

| 函数 | 说明 |
|---|---|
| `qc_create_location(p_dryer_number, p_cell_number, p_display_name, p_code)` | 插入新 cell,code 不传则按 `DR<n>-<NN>` 自动生成;`UNIQUE(dryer_number, cell_number)` 保证不重复 |
| `qc_update_location(p_id, p_display_name, p_code)` | 只允许修改 `display_name` 和 `code`;`dryer_number` / `cell_number` 是 grid 拓扑的天然主键,不允许 re-key(要换位置请删 + 新建) |
| `qc_delete_location(p_id)` | 删除前检查占用:有 sub-lot 在 `drying / pending / inspecting / hold / disposing / awaiting_recheck / room_temp_drying` 状态指向这个 cell 时,抛 `Cannot delete <code>: cell is currently occupied by <sub_lot_code>` |

**修改**:
- `qc_dry_room_summary` 不再 hardcode `generate_series(1, 5)` 和 `total_cells: 100`。改成从 `qc_drying_location` 聚合得到每个 dryer 的实际 cell 总数和 dryer 列表。原有 500 个 seed 行为不变;但加第 6 个 dryer / 改 cell 数量后 DryRoomsList 会自动反映。

**业务规则**:
- **BR-Q37** Dryer location 删除必须保留**已结束**(closed / dispatched)sub-lot 的历史可追溯性。FK 早在 M-036 已设 `ON DELETE SET NULL`,所以删除一个不再使用的 cell 不会损坏历史 trace。
- **BR-Q38** 当前正占用某 cell 的 sub-lot 必须先释放(check-out / dispose / release)才能删除 cell。

**前端配套**:
- `src/services/qcApi.ts` — 新增 `createLocation` / `updateLocation` / `deleteLocation` wrapper
- `src/pages/qc/LocationManagement.tsx` — 新页面,按 dryer 分组折叠 + 行内编辑;权限:`qc.locations.view` 看,`qc.locations.manage` 改
- `src/pages/qc/QualityControlModule.tsx` — sidebar Master Data 区新增 "Dryer Locations" 入口(`MapPin` 图标),`screen='locations'` 路由分支

**依赖**: M-036(`qc_drying_location` schema + 5×100 seed),M-047(`qc_dry_room_summary` 上一版)。

---

### M-081 `20260525000002_qc_forecast_narrow_inflight.sql`
**用途**: 收窄 `qc_dashboard_pass_rate_forecast` 的「in flight」池子,让 QC Home 上 "Predicted passes" 卡片只算**正在/即将测试**的车。

**问题**: 之前的实现(M-050)把以下状态全算 in_progress:
```
'drying', 'pending', 'awaiting_group_result',
'awaiting_recheck', 'room_temp_drying', 'hold', 'inspecting'
```
这意味着 `forecast_passes = ROUND(in_progress × pass_rate)` 把还在烘干、室温干、redry、hold 等远没轮到测试的车都算进来。用户看到「Predicted passes 15」但 dry room 里只有 10 辆等出库,差额来自 hold/redry 的旧车——令人困惑。

**修复**: in_progress 收窄到三种状态:
- `'pending'` — 已出库,在 Testing queue 等取样
- `'inspecting'` — 已取样,正在录 Aw
- `'awaiting_group_result'` — sibling 等 champion 结果(propagation 后会继承 PASS/FAIL)

公式不变,`COALESCE(pass_rate, 1.0)`(无今日 inspection 默认 100%)也不变——只是「即将产生 inspection」的车数算得更准。

**业务规则**:
- **BR-Q41** Predicted passes 的 in-flight 集合只包含「正在/即将产生 inspection」的车。drying / room_temp_drying / awaiting_recheck / hold 不算——它们要么还没出库要么已 FAIL,不会直接产生 PASS 计数。

**依赖**: M-050(`qc_dashboard_pass_rate_forecast` 原始实现)。

---

### M-082 `20260525000003_repair_w11111_orphan_siblings.sql`
**用途**: 一次性数据修复,把 W11111-003/006/007/008 这 4 辆孤儿 sibling(同 M-075 时代级联 bug 的受害者,卡在 `awaiting_group_result`)按操作员决定 → 视作 PASS @ Aw 0.7 + 直接 release。

**变更**(用 PL/pgSQL DO block 循环 4 车,带 status='awaiting_group_result' 守卫保幂等):
- 每车 INSERT 一条 `qc_inspection_record` (result='pass', values_json={aw: 0.7}, sample_id=NULL)
- 每车 UPDATE 状态 → `closed`,`released_at` 写 now()
- 每车写 3 条 `qc_quality_event`:`inspection_passed` / `manual_repair`(`migration_ref='M-082'`)/ `released`

**业务规则**: 沿用 M-076 的 BR — 孤儿 sibling 修复必须保留 trace 历史;原 group 因为还没找到 champion / champion 不可用,直接跳到 closed 不算 propagation。

**依赖**: M-075(根因 bug 修复)、M-067(`released_at` 字段)。

---

### M-083 `20260525000004_qc_trace_action_permissions.sql`
**用途**: 给 [TracePage](../../src/pages/qc/TracePage.tsx) 新加的两个动作按钮播种权限:
- `qc.trace.add_carts` — Trace 详情页右上 "Add carts" 按钮(打开 `AddCartsDialog` 在现有 work order 上追加车)
- `qc.trace.reprint_sticker` — Trace 详情页右上 "Reprint sticker" 按钮(打开 `ReprintPickerDialog` 多选 + 走 `CartStickerSheet`)

种子给两个 dev 账号(`ysha@smu.edu`、`shayiqing16@gmail.com`),`ON CONFLICT DO NOTHING` 保幂等。

**业务规则**:
- **BR-Q42** Trace 页的 Add carts / Reprint sticker 是**独立权限**,跟 `qc.production.create_batch` 解耦——可以有人能看 trace + 重打贴纸但不能改生产数据,也可以有人能在 trace 页继续往 work order 追车但不能新建 lot。两者 prereq 都是 `qc.trace.view`。

**依赖**: M-040 / M-063(dev 用户全 QC 权限种子的延伸)。

---

### M-084 `20260525000005_qc_forecast_exclude_orphan_agr.sql`
**用途**: 进一步收窄 `qc_dashboard_pass_rate_forecast` 的 in-flight 池子,排除 **孤儿 awaiting_group_result 车**(其 champion 已经不在 testing 队列里——pass/fail/release/closed 都算)。

**问题**: M-081 把 in-flight 收到 `pending / inspecting / awaiting_group_result` 三种。但 `awaiting_group_result` 里可能有「孤儿」——它们的 champion 已经被释放或关闭,自己再也拿不到结果,却仍被算进 forecast,造成虚高。

**修复**: `awaiting_group_result` 只在「champion 还在 pending/inspecting」时才算 in-flight。`pending / inspecting` 永远算。SQL 通过 EXISTS 子查询找同 group 的 champion 当前状态。

---

### M-085 `20260525000006_repair_stuck_retest_carts.sql`
**用途**: 一次性数据修复——W12345-005 / W11111-005 / W11111-008 这 3 车走过 retest disposition 但卡在非可见状态(不在 Testing queue,也不在 Needs Attention)。把它们从任何卡住的非终态拉回 `pending`,以便重新取样。带 status 守卫保幂等。

---

### M-086 `20260525000007_repair_retest_carts_pass_07.sql`
**用途**: 跟 M-085 同样 3 车,但走**另一条决策**——直接 close as PASS @ Aw 0.7 + release(类似 M-082 对 W11111 orphans 的处理)。每车插 synthetic qc_inspection_record (result=pass, aw=0.7) + 状态 → 'closed' + released_at + 3 条 audit 事件。

> **注**: M-085 和 M-086 是**互补但语义对立**的两条处理路径。运行哪个取决于操作员当时的决策——回测 vs 直接 close。两者都带 status 守卫,所以先跑哪个都行,第二次会 no-op。

---

### M-087 `20260525000008_qc_sku_item_junction.sql`
**用途**: 把 `qc_product_sku.item_id`(一对一)替换为 `qc_sku_item` 多对多 junction 表。一个 SKU 可关联多个 ERP `item`(不同袋装规格、不同客户标签等)。

**变更**:
- 新表 `qc_sku_item (sku_id, item_id, added_at, PK(sku_id, item_id))`,双侧 FK with `ON DELETE CASCADE`
- 保留旧 `qc_product_sku.item_id` 列做 backwards-compat(后续会废弃)
- UI 在 Production 页面管理 SKU↔Item 关联

---

### M-088 `20260525000009_qc_test_type_catalog.sql`
**用途**: 引入 `qc_test_type` 全局测试类型目录(Water Activity / Moisture Content / pH 等),允许一个 SKU 配置多个测试,每个测试有自己的 per-SKU 上下限。

**变更**:
- 新表 `qc_test_type (id, name, unit)`,seed 第一条 "Water Activity (Aw)"
- `qc_inspection_template` 加 `test_type_id` FK(nullable 兼容旧数据,自动 back-fill 现有行)
- `qc_list_products()` 暴露 `test_type_id`

---

### M-089 `20260525000010_pkg_skus_with_stock_fix_nested_agg.sql`
**用途**: 修复 `pkg_skus_with_stock` 的 **nested aggregate** 错误,触发条件是终于有 `status='closed'` 的车被打包队列查到。

**问题**:
```sql
-- M-067 原始写法:
SELECT jsonb_agg(jsonb_build_object(..., COUNT(s.id)) ORDER BY sku.name)
FROM qc_drying_sub_lot s ...
GROUP BY sku.id, sku.name, sku.code
```
`jsonb_agg(...)` 和 `COUNT(s.id)` 同时出现在 SELECT 里,Postgres 拒绝:`aggregate function calls cannot be nested`。之前 production DB 没 closed 车 → GROUP BY 出空集 → 报错没触发。M-082 把 W11111-003/006/007/008 修到 closed 后,Packaging 页面终于读到这条 SQL → 一访问就报错。

**修复**: 把 COUNT 放到 CTE 里先算好,主查询 jsonb_agg 一个 flat 结果集,无嵌套。函数签名/返回类型不变。

---

### M-090 `20260525000011_pkg_dispatch_carts_fix_lot_ambiguous.sql`
**用途**: 修复 `pkg_dispatch_carts` 两个 latent bug,Dispatch 按钮一直没法用。

**Bug 1 — `column reference "lot.id" is ambiguous`**:
函数同时声明了 PL/pgSQL 局部变量 `lot qc_production_lot%ROWTYPE` 和 SQL 查询里的表别名 `JOIN qc_production_lot lot`。Postgres 校验函数体到这条 SQL 时,`lot.id` 无法判断是变量还是表列 → 直接报 ambiguous。注意函数体 SQL 是**延迟校验**(lazy),所以 dispatch RPC 直到今天 M-082 留下 closed 状态车、用户首次按 Dispatch,bug 才暴露。

**Bug 2 — silent no-op UPDATE**:
```sql
UPDATE pkg_outbound SET cart_count = cart_count WHERE id = outbound_id;
```
本意是把 SQL 列写成实际成功数(局部变量),但 PL/pgSQL 把右边 `cart_count` 也当成**列名**(同名局部变量被列遮蔽)。结果是「列 = 列」永远 no-op,即使中途有车被 CONTINUE 跳过,`pkg_outbound.cart_count` 永远等于最初 `array_length` 那个乐观值。

**修复**:
- 删掉没用到的局部变量 `lot qc_production_lot%ROWTYPE`,SQL 别名继续叫 `lot` 不变
- 局部计数变量 `cart_count` → 重命名为 `success_count`,避免与列同名;UPDATE 现在真的写新值进去

**业务规则**:
- **BR-Q46** PL/pgSQL 函数里**禁止局部变量名与已被使用的 SQL 表别名相同**(即便变量未实际引用)。Postgres 不在编译期阻止这种 shadowing,只在运行期抛 ambiguous。代码审查时一并检查。

---

### M-091 `20260525000012_pkg_dispatch_carts_fix_dispatched_by_fkey.sql`
**用途**: 修复 `pkg_dispatch_carts` 的 FK 违约错误:

> ERROR: insert or update on table "pkg_outbound" violates foreign key constraint "pkg_outbound_dispatched_by_fkey"

**根因**: `pkg_outbound.dispatched_by` 的 FK 是 `REFERENCES erp_user(id)`(M-067 DDL),但函数 INSERT 时塞的是 `auth.uid()`。`auth.uid()` 返回的是 `auth.users.id`,跟 `erp_user.id` 是两个不同体系——两者通过 `erp_user.auth_user_id` 列建关联(M-010)。

**修复**: INSERT 之前先 `SELECT id FROM erp_user WHERE auth_user_id = auth.uid()` 反查 `dispatcher_id`,再写入。列允许 NULL,所以无 auth context 时干净落 NULL,不会出错。

**业务规则**:
- **BR-Q47** **凡是 FK → `erp_user(id)` 的列(operator/dispatcher 类),写入时必须通过 `auth.uid()` 反查 `erp_user.id`,不能直接写 `auth.uid()`。** FK → `auth.users(id)` 类的列(actor_auth_id / inspector_auth_id 等)继续可以直接 `auth.uid()`。

---

### M-092 `20260525000013_pkg_work_order_packaging.sql`
**用途**: Packaging 模块按 **work order** 维度分组,每个 work order 关联一种 packaging。

**变更**:

| 对象 | 操作 | 说明 |
|---|---|---|
| `item` | INSERT 3 行 | 种子 packaging:`PKG-BAG-500G` (Bag 500g)、`PKG-BAG-1KG` (Bag 1kg)、`PKG-CARTON-5KG` (Carton 5kg);`ON CONFLICT (sku) DO NOTHING` |
| `qc_production_lot.packaging_item_id bigint` | ADD COLUMN | FK → `item(id)`,nullable |
| `qc_production_lot` 现有行 | UPDATE backfill | 按 `created_at, id` 排序后 mod 3 round-robin,把 3 个 packaging 平摊给所有 work order(只在 `packaging_item_id IS NULL` 时改,可重跑) |
| `pkg_available_carts` | REPLACE | 输出新增 `packaging_id` / `packaging_sku` / `packaging_name` 三个字段 (LEFT JOIN item),前端可直接 group by `work_order_barcode` 并展示 packaging 标签 |

**业务规则**:
- **BR-Q48** 一个 work order **绑定一种** packaging。一对一,简单可控;以后改 m:n 走新迁移。
- **BR-Q49** Packaging 是 ERP `item` 表里 `item_type='packaging'` 的子集——跟 raw_material/finished_good 共用同一张 master table,只通过 `item_type` 区分。

**前端配套**:
- `src/services/pkgApi.ts` — `PkgCart` interface 加 `packaging_id / packaging_sku / packaging_name`
- `src/pages/packaging/PackagingPage.tsx` — 车列表改成**按 work order group**;每组 header 显示 WO 号 + packaging 名称(`Package` 图标) + 组内 select-all + cart 数;未分配 packaging 时显示灰色斜体「No packaging assigned」

---

### M-092a (frontend-only,无 migration)

**ScanQrDialog 连续扫码模式**:
- 新增 `keepOpen?: boolean` 和 `runningSummary?: string` props
- `keepOpen=true` 时,扫到一辆车后 dialog **不自动关闭**:input 清空 + 重新 focus + 临时显示「✓ Added <code>」绿色提示。底部 Cancel 按钮文字变成 **Done**(突出黑色背景),Find cart 按钮文字变成 **Add cart**
- `runningSummary` 字符串(可选)在 dialog 底部以小灰条显示「N carts queued for check-in」之类的当前累计数,操作员心里有数

**接入点**: [DryRoomListMode.tsx](../../src/pages/qc/components/DryRoomListMode.tsx) 两个 `<ScanQrDialog>`(check-in / check-out)都加上 `keepOpen` + `runningSummary`,扫一个不再 dismiss dialog。`handleScanned` / `handleScannedForOut` 内部去掉 `setScanOpen(false)`。

**业务规则**:
- **BR-Q50** 扫码场景下的 ScanQrDialog 默认走 **continuous-scan 模式**,操作员一次性扫完所有车再点 Done,**不再每扫一辆都被弹回主页面**。grid mode 的 single-scan smart route 行为保留(不传 `keepOpen`)。

---

### M-093 `20260525000014_qc_production_pipeline_summary.sql`
**用途**: 新 RPC `qc_production_pipeline_summary()` —— 给 Production 模块的新 Dashboard 提供「每个 SKU 当前在 production → packaging 管道里各阶段有多少车」的快照。

**输出**: 每个有任何在飞车的 SKU 一行,包含 5 个 bucket:

| 字段 | 状态映射 |
|---|---|
| `production_count` | `created` |
| `dry_room_count` | `drying` + `awaiting_recheck` + `room_temp_drying` |
| `testing_count` | `pending` + `inspecting` + `awaiting_group_result` + `hold` + `passed` |
| `released_count` | `closed`(已 release 待打包) |
| `packaged_count` | `dispatched`(已出库) |

**业务规则**:
- **BR-Q51** **Production / Batch Trace / Products & Templates / Test Types** 这 4 个功能从 QC 模块迁移到新的 Production & Manufacturing 模块。组件文件仍在 `src/pages/qc/` 由 ProductionModule import(代码层面不动)。**M-093 时权限 key 暂保留 `qc.*` 命名**;**M-094 起改为 `production.*`**(见下条)。
- **BR-Q52** Production Dashboard 的 "testing" bucket 包含 `hold` 和 `passed`——它们都是「测试已发生,等人手 action」状态,从工厂经理视角看仍属于「在 QC 流程里」,没出 QC。

**前端配套**:
- `src/services/qcApi.ts` — 新 `productionPipelineSummary()` wrapper 和 `ProductionPipelineItem` 类型
- 新文件 `src/pages/production/ProductionModule.tsx` — Production 模块的 sidebar shell,默认 screen='dashboard'
- 新文件 `src/pages/production/ProductionDashboard.tsx` — 每 15s 自动刷新的 SKU × 5-bucket 表格
- `src/App.tsx` — case 'production' → `<ProductionModule>`
- `src/pages/qc/QualityControlModule.tsx` — 移除 Production / Trace / Products / Test Types 的 sidebar 入口和 renderContent 分支(BR-Q51)

---

### M-094 `20260525000015_permission_move_to_production_module.sql`
**用途**: 把 Production / Batch Trace / Products & Test Types 的权限 key 从 `qc.*` 命名空间**真正搬到** `production.*` 命名空间。M-093 时只搬了 UI、保留旧 key 避免破坏 grant;这次 key 也跟着搬。

**Key 映射**:

| 旧 (qc.*) | 新 (production.*) |
|---|---|
| `qc.production.create_batch` | `production.work_orders.create` |
| `qc.trace.view` | `production.trace.view` |
| `qc.trace.add_carts` | `production.trace.add_carts` |
| `qc.trace.reprint_sticker` | `production.trace.reprint_sticker` |
| `qc.products.view` | `production.products.view` |
| `qc.products.create` | `production.products.create` |
| `qc.products.edit` | `production.products.edit` |
| `qc.products.delete` | `production.products.delete` |

**Migration 步骤**(用 CTE 框定要搬的旧行):
1. `INSERT user_module_access (user_id, 'production') SELECT DISTINCT user_id FROM old_rows ON CONFLICT DO NOTHING` —— 凡是有这批旧 grant 的用户,先给他们「production 模块」可见权限,否则前端切到新 key 后 Module Hub 卡片就不见了
2. `INSERT user_permission_grant` 用 CASE 表达式 1:1 映射到新 key,`ON CONFLICT DO NOTHING` 幂等
3. `DELETE FROM user_permission_grant` 删掉所有旧 key 的行

**前端配套**(同一次任务):
- `src/lib/permissionStructure.ts` —— `qc.production` / `qc.trace` / `qc.products` 三个 resource 删除;`production` 模块新增 `work_orders` / `trace` / `products` 三个 resource(`production_order` 那个 placeholder 保留)
- 所有 `can('qc', 'production'|'trace'|'products', ...)` 调用站点改成 `can('production', 'work_orders'|'trace'|'products', ...)` —— 共 8 处文件
- PermissionDenied 的 `permission="qc.*"` 显示字符串也跟着改成 `permission="production.*"`,跟新 key 一致

**业务规则**:
- **BR-Q53** **Trace 资源的 `add_carts` 权限对应 SQL 写操作**(`qc_add_sub_lots_to_lot`);因为这是「修改 work order」的能力,跟 `work_orders.create` 解耦——只让某些角色追加车不让从零建。
- **BR-Q54** Module hub 卡片可见性由 `user_module_access` 控制,跟具体的 grant 行**不联动**。新模块上线时:加 grant **不会**自动让卡片出现,必须显式 `INSERT user_module_access`(BR 在 M-009 已经存在,本次强调一次)。

**已知 follow-up**:
- M-040 / M-063 的种子 migration 里仍写着 `('qc', 'production', 'create_batch')` 等旧 key —— 那些是历史 already-applied migration,DB 不会重跑;但任何**新种子**(给新用户)请直接用新 key。
- 后续如要给某些资源(比如 dashboard / analysis)做类似搬迁,参考本 M-094 的 CTE 模式。

---

### M-095 `20260526000001_qc_create_lot_with_packaging.sql`
**用途**: 让 `qc_create_production_lot_with_sub_lots` 接受 `p_packaging_item_id` 参数,把新建 work order 时操作员选中的「Final product」写到 `qc_production_lot.packaging_item_id` 上(M-092 加的列)。

**变更**:
- RPC 签名加 `p_packaging_item_id bigint DEFAULT NULL`(可选,向后兼容)
- 内层 `INSERT INTO qc_production_lot (...)` 加 `packaging_item_id` 列
- 返回 jsonb 多带 `packaging_item_id` 字段

**未做服务端校验**:有意不强制 `p_packaging_item_id` 必须出现在 `qc_sku_item(p_sku_id)` 里——前端 dropdown 已经收窄到允许集了,Studio 里手动指定别的 item 也允许(后台口子,不堵)。

**业务规则**:
- **BR-Q55** 每个 SKU 在 ProductManagement 里维护一个「Final products」多选列表(写入 `qc_sku_item` 多对多)。
- **BR-Q56** 新建 work order 时,如果所选 SKU 已配置至少一个 final product,操作员**必须**从这个列表里选一个;前端 submit 按钮在没选时 disabled,RPC 层不强制。`isAddMode`(给现有 lot 加车)不要求选——继承原 lot 的 packaging。

**前端配套**:
- `src/services/qcApi.ts` — `ProductionBatchInput` / `createProductionLot` 加 `packaging_item_id?: number | null`
- `src/pages/qc/ProductManagement.tsx` — 编辑表单加「Final products」勾选区,多选 ERP items;保存时 diff 旧/新 selection,调 `addSkuItem` / `removeSkuItem` 同步 `qc_sku_item`;复用已有 `listProductItemLinks` / `listItems` API
- `src/pages/qc/Production.tsx` — **删掉**老的「关联 ERP 物料」section(在 Production 表单里临场加关联那个);改成 SKU 选完后弹一个**必填**的 "Final product" 下拉,选项过滤到 `linkedItems`(qc_sku_item 已有的);空集时显示「先去 Products 配置」提示;submit 校验 + button disabled

---

### M-096 `20260526000002_qc_needs_attention_today_not_24h.sql`
**用途**: 把 `qc_overview` 的「Needs attention」窗口从滚动 24 小时改成「今天 00:00 起」的日历日。

**问题**: 之前用 `ir.submitted_at >= now() - interval '24 hours'`,过了午夜还会显示昨天的 inspection,操作员当日早会看到的列表既有今天的也有昨天的,容易混淆「今天该处理什么」。

**变更**:
- 局部变量 `day_start := date_trunc('day', now())` / `day_end := day_start + interval '1 day'`
- `passed_today` / `failed_today` 统计窗口同步用 `day_start ≤ submitted_at < day_end`
- `needs_attention` 列表的过滤改成 `ir.submitted_at >= day_start`,并显式按 `submitted_at DESC` 排序,`LIMIT 50` 保持不变
- 「group-aware action filter」(M-077 引入的)逻辑保持不动:只保留组内**仍在 passed/hold 且尚未被 disposition 跟上**的成员

**业务规则**:
- **BR-Q57** Needs Attention 列表以**自然日**(server local day,UTC)为窗口,过了 00:00 自动清空昨天的条目,不再用 24 小时滚动窗口。

---

### M-097 `20260526000005_qc_retest_reset_group_siblings.sql`
**用途**: 修复组(test_group)champion 走 retest 时,其他已被 group-fail 推到 `hold` 的 siblings 不会随之回到测试流的 bug。

**问题流程**(修复前):
1. 2 车一组,champion FAIL → M-056 group-fail 把 sibling 也推到 `hold`。
2. 操作员对 champion 点 Retest → `qc_create_disposition` 的 retest 分支去找 `awaiting_group_result` 的 sibling 当新 champion,但 sibling 已经在 `hold`,**找不到**。
3. 回退到「保留原 cart 当 champion,送回 pending」,sibling 留在 `hold` 不动。
4. champion 重测的新样本 PASS → M-055 propagation 只动 `awaiting_group_result` 的 siblings → sibling 永远卡在 `hold`。

**症状**: Analysis → Retest 详情里 sibling 永远显示 "in progress"(没有后续 inspection);QC Home Needs Attention 出现「champion 等待 release / sibling 等待 dispose」的混合状态,无法整组一起释放。

**变更**: `qc_create_disposition` 的 retest 分支,当**没有** `awaiting_group_result` sibling 可以接 champion 棒(亦即保留 this cart 当 champion 回 pending)时,把组内**所有**当前在 `hold` 的 siblings 重置回 `awaiting_group_result`。其他状态(closed / dispatched / disposing / awaiting_recheck / room_temp_drying / passed)**不动**——那些已经过了测试阶段,不应该被拽回去。

返回 jsonb 加 `siblings_reset_count` 字段,disposition_completed 事件 payload 同步带这个数;每个被重置的 sibling 都写一条 `group_retest_reset` 事件(payload 含 reset_from/reset_to/champion_id/disposition_id),便于审计。

**业务规则**:
- **BR-Q58** Champion 走 retest 且没有 `awaiting_group_result` sibling 可以替补时,所有 `hold` 状态的 siblings 必须回到 `awaiting_group_result`,以便 retest 结果在组内传播。
- **BR-Q59** retest 触发的 sibling 重置只动 `hold`;`closed / dispatched / disposing / awaiting_recheck / room_temp_drying / passed` 这些已经过了测试阶段的状态保留不动。

---

### M-098 `20260527000001_qc_scan_for_check_in.sql`
**用途**: 把「Awaiting check-in」队列从「work order 一建好就出现」改成「现场扫码后才出现」。

**旧逻辑**: 创建 work order 后,sub_lot 落到 `status='created'`,DryRoomDetail 侧栏的 Awaiting 面板立刻显示。操作员从列表里挑出来 check in 到 dryer cell。

**新逻辑**(本次变更):
1. work order 创建 → sub_lot 落到 `status='created'`,但 **不在** Awaiting 列表里(车还在生产线,还没推到 dryer)。
2. 操作员把车物理推到 dryer 门口扫码 → 后端给该 sub_lot 盖戳 `scanned_for_check_in_at = now()`。这时它才出现在 Awaiting 列表里。
3. 操作员在侧栏多选(常按 work order 分组)→ 走 BulkCheckInDialog → 一批送进 dryer cells。

**变更**:
- `qc_drying_sub_lot` 新增 `scanned_for_check_in_at timestamptz` 可空列(NULL = 还没扫,盖戳 = 在 Awaiting 列表)
- 部分索引 `idx_qc_sub_lot_awaiting_check_in` (`status='created' AND scanned_for_check_in_at IS NOT NULL`)加速 Awaiting 查询
- **回填**: 把现有 `status='created'` 的车 `scanned_for_check_in_at` 设为 `COALESCE(created_at, now())`,迁移瞬间不要让正在进行的工作消失
- 新 RPC `qc_scan_cart_for_check_in(p_sub_lot_id uuid)` — 幂等,只在 `status='created' AND scanned_for_check_in_at IS NULL` 时盖戳;其他状态(已扫 / 已进 dryer / closed / ...)是 no-op,把当前状态原样返回给前端。盖戳时写 `scanned_for_check_in` quality event
- 新 RPC `qc_list_awaiting_check_in()` — 替换前端原本 `qc_list_sub_lots → 前端 filter status=created` 的写法,直接在 SQL 里过滤 `status='created' AND scanned_for_check_in_at IS NOT NULL`,这样不必把新列加进 `qc_sub_lot_to_json` 的 schema

**前端配套**:
- `src/services/qcApi.ts` — `listAwaitingCheckIn` 改调新 RPC `qc_list_awaiting_check_in`;新增 `scanCartForCheckIn(subLotId)` wrapper
- `src/pages/qc/components/DryRoomListMode.tsx` — `handleScanned` 改 async;对 `status='created'` 的扫码先 `await scanCartForCheckIn(sl.id)` → `await load()` → 再走 `acceptScannedForIn`;`awaiting_recheck` 的车不走盖戳(那是另一套生命周期)
- `src/pages/qc/DryRoomDetail.tsx` — `handleScanned` 同步改 async;`created` 走盖戳 + 然后进 place 模式,`awaiting_recheck` 直接进 place 模式

**业务规则**:
- **BR-Q60** 新建 work order 后,sub_lot 默认**不可见**于 DryRoomDetail 的 Awaiting 队列;只有现场扫码盖戳 `scanned_for_check_in_at` 后才进入队列。
- **BR-Q61** 扫码盖戳操作必须幂等:重复扫同一个 sub_lot 不会重复写 quality event,也不会改变盖戳时间。

**未做**:
- 服务端不强制扫码必须发生在「物理位于 dryer 门口」;盖戳信任前端 + 扫码枪。
- BulkCheckInDialog 暂未加「按 work order 分组多选」,操作员仍按 sub_lot 单选/多选(列表本身按 scanned_for_check_in_at 排序,自然把同一 work order 的车聚在一起)。后续如需可再加。

---

### M-099 `20260527000002_qc_trace_scanned_only.sql`
**用途**: 配合 M-098 的「扫码后才进队列」语义,把 Batch Trace 也对齐——只展示已扫码进 dryer 的车,并在 work order 旁打 `scanned/total` 角标。

**问题**: M-098 把「未扫码的 created 车」从 dry room awaiting 队列里隐藏掉了,但 Batch Trace 还是把它们一起列出来。操作员看到的车数 ≠ 已进入烘干流程的车数,容易误判现场进度;同时无从知晓某个 WO 到底还有多少车没推到 dryer。

**变更**:
- `qc_list_production_lots` 每个 lot 多返 `scanned_count`(`scanned_for_check_in_at IS NOT NULL` 的车数)和 `total_count`(全部车数)
- `qc_production_lot_detail`:
  - `sub_lots` 列表过滤 `scanned_for_check_in_at IS NOT NULL`(未扫的车不进 trace 视图)
  - `lot` 对象多 `scanned_count` / `total_count` / `max_seq` 三个字段
  - `max_seq` 是**所有车**(含未扫)`sub_lot_code` 后 3 位的最大值,给 Add-carts 对话框默认 start_seq 用,避免和未扫车撞 seq
  - `events` 列表不动——历史事件即便绑在未扫车上也要可见

**前端配套**:
- `src/services/qcApi.ts` — `ProductionLot` 接口加 `scanned_count? / total_count? / max_seq?` 三个可选字段
- `src/pages/qc/TraceListPage.tsx` — 每个 work order 行加 `scanned/total` 角标:全部扫完时灰色(slate),还有未扫时琥珀色(amber),hover 提示「N cart(s) not yet scanned」
- `src/pages/qc/TracePage.tsx` — 标题旁同款角标;`maxSeq` 优先取 `detail.lot.max_seq`(服务端口径),fallback 才用本地可见 sub_lots 算

**业务规则**:
- **BR-Q62** Batch Trace detail 页的 sub-lots 列表只展示扫码过的车(`scanned_for_check_in_at IS NOT NULL`);未扫的 created 车保持隐藏直到现场扫码盖戳。
- **BR-Q63** Trace list 页的 work order 行必须显示 `scanned/total` 角标,让操作员一眼看到「这个 WO 还有多少车没推到 dryer」。
- **BR-Q64** Add-carts 对话框的 default start_seq 用 server-side `max_seq + 1`,不能依赖前端可见的 sub_lots 列表(未扫车被过滤掉会算错)。

---

### M-106 `20260527000003_qc_group_retest_normalize.sql`
**用途**: 修复「champion 检测结果没有代表抽样组其它车」的 bug(操作员反馈 + `qc_quality_event` 时间线实证)。

**根因**: 失败组「Dispose all N → retest」时,前端 `createDispositionGroup` 用 `Promise.all` 逐车调 `qc_create_disposition`。retest 分支把**非 champion 兄弟车**置成 `pending`(可单独被测)而非 `awaiting_group_result`;且兄弟车先被改成 pending 后,champion 的 retest 分支再也找不到 `awaiting_group_result` 兄弟来保持分组 → 整组被打散成独立 pending 车,champion 后续结果 `group_members_propagated=0`,谁也没代表。

**变更**:
- `qc_create_disposition` retest 分支重写为**整组归一化**:被 retest 的车设为唯一 champion(`pending`),同组其余仍在测试态(hold/disposing/pending/inspecting/awaiting_group_result)的车 → `awaiting_group_result` 且 `is_test_champion=false`,并重开 group(`status='sampling'`, `resolved_at=NULL`)。锁 `qc_test_group` 行串行化。solo 车仍直接 → pending。
- `qc_submit_inspection` 传播兜底:兄弟匹配从 `status='awaiting_group_result'` 放宽到 `status IN ('awaiting_group_result','pending') AND is_test_champion=false`,任何残留 pending 兄弟也能继承 champion 结果。
- **历史数据修复**:把现存「带组号却是非 champion `pending`」的孤儿兄弟车,按 champion 当前状态重新对齐(hold→hold / passed→passed / pending·inspecting→awaiting_group_result),写 `group_orphan_repaired` 审计事件。

**前端配套**: `src/services/qcApi.ts` — `createDispositionGroup` 对 `type==='retest'` **只调一次**(消除并发死锁/竞态),其余处置类型保持逐车 `Promise.all`。

**业务规则**:
- **BR-Q65** retest 是**组级动作**:对组内任意车 retest 都把该车设为唯一 champion、其余兄弟回 `awaiting_group_result`,使一次重测结果覆盖全组。仅 retest 如此;scrap/redry/room_temp 仍逐车独立处置。

**依赖**: M-055(20260522000013 传播)、M-097(20260526000005 `qc_create_disposition`)。**关联文档**: `docs/modules/09_qc.md`。

---

### M-107 `20260527000004_qc_needs_attention_dedup_by_group.sql`
**用途**: 修复 QC Home「Needs attention」同一组重复出卡。

**根因**: `qc_overview` 的 needs_attention 子查询是「每条今日 `qc_inspection_record` 一行」,从不按组去重(注释写着 ONE ROW PER GROUP 但实现没做)。每次 retest 失败都写一条新的 fail inspection,于是同一组一天累积多张卡(截图三张卡车号 006/007/008 互相重叠即同组多次失败叠出)。

**变更**: needs_attention 用 `DISTINCT ON (group_key)` 按组去重,每组(solo 车按 sub-lot)只留**最新一次**检测。最新检测本就驱动正确的当前车列表(disposition 过滤相对 `ir.submitted_at`),故留存的卡反映该组当前状态。仅改 needs_attention 块,stats 与 M-096 一致。

**配合 M-106**: retest 现复用同组、不再裂变新组,故未来同组多次 retest 收敛为一张卡。

**业务规则**:
- **BR-Q66** QC Home「Needs attention」每个抽样组只显示一张卡(取该组当日最新检测);solo 车每车一张。

**依赖**: M-096(20260526000002)。**关联文档**: `docs/modules/09_qc.md`。

---

### M-108 `20260527000005_qc_sub_lot_produced_at.sql`
**用途**: 在 `qc_sub_lot_to_json` 输出里新增 `produced_at` 字段(= `qc_production_lot.created_at`),供 Testing 头部显示「生产完成 / 烘干完成」时间。

**说明**: 烘干完成时间用现有 `out_time`;schema 没有专门的生产完成时间戳,用工单建立时间 `qc_production_lot.created_at` 作代理。纯 additive,只多一个字段,不影响既有调用方。

**前端配套**: `src/services/qcApi.ts` `SubLot` 加 `produced_at?`;`src/pages/qc/TestingPage.tsx` 头部卡片在 SKU 名下方加一行 `Produced <时间> · Drying done <时间>`。

**依赖**: M-067(20260523000017 `qc_sub_lot_to_json`)。**关联文档**: `docs/modules/09_qc.md`。

---

### M-109 `20260527000006_qc_manual_judgment_and_remark.sql`
**用途**: 检测裁定从「系统自动判定」改为「系统给建议 + 人工拍板 + 备注」(测试负责人反馈:水活之外还有其它数据综合判断,需人工裁定)。

**变更**:
- `qc_inspection_record` 加 `remark text` 列。
- `qc_submit_inspection` 加 `p_result`(人工最终结果)和 `p_remark` 两参数:
  - 模板仍算出**建议结果** `suggested`(存 `values_json.suggested` + 事件 payload),仅供参考。
  - 最终 `result = COALESCE(p_result, suggested)`;`p_result` 为空时退回旧的自动判定(批量提交等遗留路径不受影响)。
  - 模板变为**可选**:无模板也能人工裁定(此时 suggested 为 NULL)。
  - 事件 payload 增 `suggested` / `manual_override`(人工是否覆盖了建议)/ `remark`。
- `qc_sub_lot_full_history` 的 inspections 数组增 `remark`,供 Full History 抽屉展示。

**前端配套**: `submitInspection(subLotId, aw, samplePk?, result?, remark?)`;`TestingPage` 录数后显示「System suggests PASS/FAIL」,操作员用 Pass/Fail 两个按钮拍板(默认跟随建议、可覆盖)+ 选填 Remark 文本框;`SubLotHistoryDrawer` 在 inspection 行显示 remark。

**业务规则**:
- **BR-Q67** 检测最终合格与否由**操作员裁定**;系统依 SKU 模板给出建议(可被覆盖,覆盖记 `manual_override`)。Remark 选填,经 `qc_inspection_record.remark` 持久化,Full History 可调取。

**依赖**: M-106(20260527000003 `qc_submit_inspection`)、M-067(20260523000017 `qc_sub_lot_full_history`)。**关联文档**: `docs/modules/09_qc.md`。

---

### M-110 `20260527000007_wh_lot_lifecycle.sql`
**用途**: Warehouse S3 批次生命周期 — 放行 / 拒收 / 一键标定过期 / 临期查询。BR-6a 状态机 + BR-11 COA 门控；不改 S1 内核（BR-W4 已含 `expired`/`rejected` 拦截）。

**变更**:

| 对象 | 说明 |
|------|------|
| `wh_next_coa_number()` | `COA-NNNNNN`，max+1 正则（仿 `wh_next_grn_number`） |
| `wh_release_lot(p_lot_id, p_test_date?, p_tested_by?, p_document_ref?, p_notes?)` | 仅 `quarantine` → `available`；写 `coa(result='pass')`；返回 `{lot_id, new_status, coa_id, coa_number}` |
| `wh_reject_lot(p_lot_id, p_reason, p_test_date?, p_tested_by?, p_document_ref?)` | `quarantine` 或 `available` → `rejected`；`reason` 必填→`coa.notes`；result='fail' |
| `wh_expire_lots()` | 管理函数：把 `expiry_date < today AND status NOT IN ('consumed','rejected','expired')` 的批次 status 改为 `expired`；返回 `{expired_count, lot_ids}` |
| `wh_list_expiring(p_days_ahead int DEFAULT 30)` | `LANGUAGE sql STABLE`：返回 (已过期未标定 OR 未来 N 天到期) 的 lots；join `item` + 跨库位 SUM 在库；含 `days_until_expiry`（负=已过期） |

**特性**: 幂等（`CREATE OR REPLACE`）。无 schema 变更，`coa` 表来自 M-001。

**前端配套**:
- `src/services/warehouseApi.ts` — `releaseLot` / `rejectLot` / `expireLots` / `listExpiring` / `listLotCoa`；`Coa` / `ExpiringLot` 类型
- `src/pages/warehouse/LotDetailPage.tsx` — 加「放行」（仅 quarantine + canRelease）/「拒收」（quarantine 或 available + canReject）按钮 + 内联表单 + 底部「质检记录（COA）」表
- `src/pages/warehouse/ExpiringPage.tsx` — 新页：天数阈值（7/30/60/90）+ 一键标定过期按钮 + 表格

**依赖**: M-001（lot/coa 表）、M-102（`_wh_apply_transaction` BR-W4 已含 expired/rejected 检查）。**关联文档**: `docs/modules/11_warehouse-inventory.md`。

---

### M-111 `20260527000008_wh_balance_status_aware_available.sql`
**用途**: Warehouse 微调 — `wh_list_balance` 的 `quantity_available` 改为**状态感知**。S3 验证时发现：rejected/expired 批次的"可用"列仍按 `on_hand - allocated` 算,与 BR-W4 拦截语义不符（实际不能动用）。

**变更**: `CREATE OR REPLACE FUNCTION wh_list_balance(...)` 同签名替换;`quantity_available = CASE WHEN lot.status='available' THEN on_hand - allocated ELSE 0 END`。`quantity_on_hand` 保持物理数量不变。

**前端配套**: `BalancePage.tsx` 物料汇总行:`totalAvailable < totalOnHand` 时"可用"列变琥珀色 + 旁注"· 冻结 N"。

**特性**: 幂等（同签名 CREATE OR REPLACE）。**依赖**: M-104（原 `wh_list_balance`）。

---

### M-112 `20260527000009_wh_qc_lot_link_schema.sql`
**用途**: Warehouse S4 起点 — 给 QC 模块加 ERP `lot` 的反向 FK,并用触发器把 `qc_drying_sub_lot.lot_id` 自动同步到父 `qc_production_lot.lot_id`(决议 §4.5)。后续 wh_sync 写流水时直接读 sub_lot.lot_id 即可,无需多 join。

**变更**:

| 对象 | 说明 |
|------|------|
| `qc_production_lot.lot_id bigint REFERENCES lot(id)` + idx | QC 卡片 ↔ ERP 批次 1:1 链 |
| `qc_drying_sub_lot.lot_id bigint REFERENCES lot(id)` + idx | 冗余列,触发器维护 |
| `qc_sync_sub_lot_lot_id()` + `trg_qc_sub_lot_sync_lot_id` BEFORE INSERT OR UPDATE OF production_lot_id ON qc_drying_sub_lot | 写时从父 qc_production_lot 同步 lot_id |
| 一次性 backfill | `UPDATE qc_drying_sub_lot SET lot_id = pl.lot_id ... WHERE sl.lot_id IS NULL AND pl.lot_id IS NOT NULL` |

**为何用触发器不用生成列**: `qc_drying_sub_lot.production_lot_id` 是可变列（M-063 在 bulk checkout 时会跨 production_lot 重新分组卡片）,而 PostgreSQL 生成列要求源列 IMMUTABLE。

**特性**: 幂等（`ADD COLUMN IF NOT EXISTS` + `CREATE OR REPLACE` + `DROP TRIGGER IF EXISTS`）。**依赖**: M-001（lot 表）、M-001/M-063（qc_drying_sub_lot 已有 production_lot_id 列）。**关联文档**: `docs/modules/11_warehouse-inventory.md`、`docs/modules/09_qc.md`。

---

### M-113 `20260527000010_wh_recompute_lot_status.sql`
**用途**: Warehouse S4 — `wh_recompute_lot_status(p_lot_id)` 按决议 §5.1 把 ERP `lot.status` 从该批关联 sub_lots 的当前状态聚合出来。在每次释放结束被 `wh_sync_release_from_qc` 调用,也可单独跑做对账。

**聚合规则**:
- 任一 sub_lot 仍非终态(`created`/`drying`/`pending`/`inspecting`/`passed`/`awaiting_*`)→ 不动 lot.status,保留 `quarantine`
- 全部 sub_lots 终态 + 至少一个 `closed`/`dispatched` → `available`(混合:held 没有 ERP 余额,所以"混合=available"是诚实的)
- 全部 sub_lots 终态 + 全部 `hold`/`disposing` → `on_hold`(信息化,无 ERP 余额可动)

**特性**: `SECURITY DEFINER` + `SET search_path = public, pg_temp`;幂等。**依赖**: M-112(`qc_drying_sub_lot.lot_id`)。

---

### M-114 `20260527000011_wh_qc_sync_helpers.sql`
**用途**: Warehouse S4 — 把 QC 释放路径接入 ERP 库存账本的两个辅助 RPC。

**变更**:

| 对象 | 说明 |
|------|------|
| `qc_set_lot_packaging_item(p_production_lot_id uuid, p_item_id bigint)` SECURITY DEFINER | 历史卡片 packaging_item_id 为 NULL 时的补登入口(决议 §5.7)。仅当当前 NULL 才允许 SET(不可覆盖);校验 item ∈ `qc_sku_item` 关联表;写 `qc_quality_event(packaging_item_set, payload.source='late_fill_on_release')`。 |
| `wh_sync_release_from_qc(p_sub_lot_id uuid, p_yield_quantity numeric)` SECURITY DEFINER | BR-W3 同步主体。由 M-116 在释放事务内调。流程:① §5.7 三分流(0 关联 → `NO_PACKAGING_LINKED:<sku_id>`;≥2 关联 → `PACKAGING_REQUIRED:<production_lot_id>`;单关联 → 自动 setLotPackagingItem)。② 历史 NULL `lot_id` 懒创建 ERP lot(同 M-115 参数:`source_type='produced'`,`status='quarantine'`,`source_doc_type='qc_production_lot'`),并 UPDATE 同 production_lot 下所有 sub_lots 的 lot_id。③ 调内核 `_wh_apply_transaction(transaction_type='production_output', +yield)` 落 LOC-PACK-STAGE;`reference_id=NULL`(uuid/bigint 不兼容),追溯信息进 `reference_type='qc_release'` + `notes`。④ 调 `wh_recompute_lot_status` 聚合 lot.status。 |

**错误码契约**(前端 catch 用):
- `PACKAGING_REQUIRED:<production_lot_id>` — 多关联,弹窗让操作员选包装,选完调 `setLotPackagingItem` + 重试
- `NO_PACKAGING_LINKED:<sku_id>` — SKU 无包装,硬阻断,提示去 ProductManagement 配置
- `YIELD_REQUIRED: ...` — 产出 ≤ 0

**特性**: `SECURITY DEFINER` + `SET search_path = public, pg_temp`;幂等。**依赖**: M-001(`qc_quality_event`/`qc_sku_item`)、M-079(`LOC-PACK-STAGE` seed)、M-102(`_wh_apply_transaction` + BR-W4)、M-103(`wh_create_lot`)、M-112(`qc_production_lot.lot_id` + 触发器)、M-113(`wh_recompute_lot_status`)。

---

### M-115 `20260527000012_qc_create_production_lot_with_sub_lots_v2.sql`
**用途**: Warehouse S4 — `qc_create_production_lot_with_sub_lots` CREATE OR REPLACE M-095,把"建车 → 建 ERP lot"打通,完成决议 §5.6 新建路径硬约束。

**变更**:
1. **强校验** `p_packaging_item_id IS NOT NULL`,否则 `RAISE EXCEPTION 'PACKAGING_REQUIRED_AT_CREATION: ...'`(前端已要求填,这层把后端 Studio 直插路径也堵住)
2. **建 ERP lot 在 sub_lot 循环之前**:`wh_create_lot(p_item_id=p_packaging_item_id, p_source_type='produced', p_lot_number=p_lot_number, p_status='quarantine', p_source_doc_type='qc_production_lot')` → 返回 `new_erp_lot_id`
3. `UPDATE qc_production_lot SET lot_id = new_erp_lot_id WHERE id = new_lot_id` — 在 sub_lot 插入前完成,让 M-112 触发器看到父 lot_id
4. `sub_lot_created` qc_quality_event payload 加 `wh_lot_id`
5. 返回 jsonb 加 `wh_lot_id`

**为何 `source_doc_id` 不传**: `qc_production_lot.id` 是 uuid,`lot.source_doc_id` 是 bigint,不兼容。反向链通过 `qc_production_lot.lot_id`(此函数 step ③)实现。

**特性**: 幂等(同签名 CREATE OR REPLACE);**历史车辆不补建**(由 M-114 在首次放行时懒创建)。**依赖**: M-095(原函数)、M-103(`wh_create_lot`)、M-112(`qc_production_lot.lot_id`)。

---

### M-116 `20260527000013_qc_release_passed_sub_lot_v2.sql`
**用途**: Warehouse S4 — `qc_release_passed_sub_lot` CREATE OR REPLACE M-068,加 yield 入参 + 内嵌 ERP 同步。BR-W3 终于在代码层闭环:同步失败 → sub_lot 不进 closed。

**签名变更**: 加 `p_yield_quantity numeric DEFAULT NULL`(向后兼容老 callers 的类型,但运行时会抛 `YIELD_REQUIRED`)。

**流程**:
1. 锁 sub_lot,**M-068 幂等短路保留**:status IN ('closed','dispatched') 直接返回 `qc_sub_lot_to_json`,**不**调 wh_sync(再调一次就会重复 +yield)
2. status 必须是 'passed',否则报错
3. yield > 0 校验,否则 `RAISE 'YIELD_REQUIRED: ...'`
4. UPDATE status → 'closed'
5. `wh_sync_release_from_qc(p_sub_lot_id, p_yield_quantity)` — 任何错误整体回滚 → sub_lot 恢复 'passed'(BR-W3)
6. 写 `released` qc_quality_event,payload 嵌入 wh_sync 返回 jsonb

**特性**: 幂等(同签名 CREATE OR REPLACE)。**依赖**: M-068(原函数)、M-114(`wh_sync_release_from_qc`)。

---

### M-117 `20260527000014_qc_hold_event_hooks.sql`
**用途**: Warehouse S4 — `qc_submit_inspection`(原 M-109)+ `qc_create_disposition`(原 M-106)CREATE OR REPLACE,在 hold / disposition 路径追加 ERP 链接审计事件。**不改 ERP 余额/状态**(决议:hold 从未发过 yield;rework/grind/scrap/concession/retest 也都不发 yield,yield 只在释放路径流)。

**变更**:

| 函数 | 追加内容 |
|------|---------|
| `qc_submit_inspection` | 在 inspection_failed_hold 路径末尾,对**所有当前 status='hold'** 的 sub_lots(冠军本身 + 组传染的 siblings)写 `qc_quality_event(qc_hold_synced_to_wh)`,payload 含 `wh_lot_id`(来自 `qc_production_lot.lot_id`)/`source`(`inspection_fail` 或 `group_propagation`)/`champion_id`/`test_group_id`/`inspection_record_id`。返回 jsonb 加 `wh_lot_id`。 |
| `qc_create_disposition` | 在最末尾对当前 sub_lot 写 `qc_quality_event(qc_disposition_synced_to_wh)`,payload 含 `wh_lot_id` / `disposition_id` / `disposition_type` / `new_status`。返回 jsonb 加 `wh_lot_id`。 |

**为何不调内核**: hold 的 sub_lot 从未走过释放(yield=0 = 余额从未 +N),所以不存在"回滚"语义可写;disposition 后续要么不出货(scrap/grind/concession 都是终态),要么走 retest/redry 重回测试链,余额变动只在最终释放发生。

**特性**: 幂等(同签名 CREATE OR REPLACE);M-109 的手动判定 + 组传染 / M-106 的 retest 重组逻辑**完整保留**。**依赖**: M-106(原 qc_create_disposition)、M-109(原 qc_submit_inspection)、M-112(`qc_production_lot.lot_id`)。

**前端配套(S4 整体)**:
- `src/services/warehouseApi.ts` — `setLotPackagingItem` / `syncReleaseFromQc` 函数 + `LotReleaseSyncResult` 类型
- `src/services/qcApi.ts` — `releasePassedSubLot(subLotId, yieldQuantity)` 加 yield 必填 + catch `PACKAGING_REQUIRED:` / `NO_PACKAGING_LINKED:` / `YIELD_REQUIRED:` 并抛 `PackagingRequiredError` / `NoPackagingLinkedError` / `YieldRequiredError` 类;新增 `getProductionLotSku(productionLotId)` 辅助
- `src/pages/qc/components/ReleaseDialog.tsx`(新)— 三态模态框:yield 输入 → 捕获 PackagingRequiredError 弹包装选择 → setLotPackagingItem + 重试;NoPackagingLinkedError 显示"先去产品管理配置"
- `src/pages/qc/QcHome.tsx` — Needs Attention 区的"放行"按钮改为打开 ReleaseDialog,而不是直接调 RPC

---

### M-118 `20260527000015_qc_soft_limits.sql`
**用途**: QC 检验加 **三区分级判定**(hard / soft / out),并把手动 override 收紧到新加的 supervisor 权限 `qc.testing.supervisor_judge`。

**问题**: M-109 让 `qc_submit_inspection` 接受 `p_result` 直接 override 自动判定,但**没有任何约束** —— 任何持 `qc.testing.submit_inspection` 的人都能把超出 hard PASS 范围的读数硬过 PASS。运营反馈这放过了不合格品,需要把 override 限制到 (a) 受控范围内 (b) 受控人群手中。

**新规则**:

| 读数位置 | 判定 |
|---|---|
| Hard 内 `[lower_limit, upper_limit]` | 自动 PASS;**supervisor** 可改 FAIL |
| Soft 边带 `[soft_lower, lower) ∪ (upper, soft_upper]` | **仅 supervisor** 可决定 PASS/FAIL |
| Soft 外 | **强制 FAIL,任何人都不能 override** |

**Schema 变更**:
- `qc_inspection_template` 加 `soft_lower_limit / soft_upper_limit numeric(10,4) NOT NULL`
- 回填:**所有现有 7 个 template 都设 soft = hard**(立刻关掉 override 通道,运营按需重配)
- CHECK 约束 `qc_inspection_template_soft_wraps_hard`(soft 必须包住 hard)+ `qc_inspection_template_soft_order`(soft_lower ≤ soft_upper)

**RPC 变更**:
- `qc_submit_inspection`:加载 tmpl 后计算 `in_hard / in_soft`,如果 `p_result <> suggested`:
  - 不在 soft 内 → `RAISE EXCEPTION 'Reading … outside soft tolerance — manual override not allowed'`
  - 在 soft 内但无 `qc.testing.supervisor_judge` 权限 → `RAISE EXCEPTION 'Supervisor permission … required'`
  - 写库的 `values_json` 多记 `in_hard / in_soft`;quality_event payload 多记 `in_hard / in_soft / manual_override_by_supervisor / soft_limits`,审计可追溯
  - **群组传染逻辑完全不动**(冠军 PASS → siblings 全 passed,FAIL → siblings hold,这套 M-106 / M-109 引入的语义保留)
- `qc_list_products`:templates 输出多 `soft_lower_limit / soft_upper_limit`,ProductManagement 直接读

**新权限**:
- `qc.testing.supervisor_judge`(prereq `submit_inspection`)— 持有此权限才能在 soft 边带做决定,以及在 hard 内反向 override 成 FAIL
- 命名空间放在 `qc.testing.*` 跟其他 inspection 权限一致(M-094 没动 testing 子树)
- Seed: `ysha@smu.edu` / `shayiqing16@gmail.com` 两个 dev 账号开箱即有,延续 M-064 / M-083 习惯

**前端配套**:
- `src/services/qcApi.ts` — `TemplateInput` / `InspectionTemplate` 加 `soft_lower_limit / soft_upper_limit`;`createProduct` / `updateProduct` 的 insert/update rows 同步;`inspectionTemplateForSubLot` 的 select + 返回类型扩展
- `src/pages/qc/ProductManagement.tsx` — 每个 test template block 拆成两个 grouped fieldset:绿色 "Hard PASS range" + 琥珀色 "Soft tolerance"(各 2 列 Lower/Upper);`addTemplate` 初始化 4 个 NaN;submit 校验加 wrap check;SKU 卡片预览里 soft ≠ hard 时多打一段琥珀色 `· soft [...]`
- `src/pages/qc/TestingPage.tsx` — `canSupervise` hook;`band: 'hard' | 'soft' | 'out' | null` state 跟着读数变;`limits` 类型加 soft 两列;Pass/Fail 按钮按下表 disabled:

| band | Pass | Fail |
|---|---|---|
| hard | enabled | supervisor only |
| soft | supervisor only | supervisor only |
| out | **disabled** | enabled |

  显示区从原来的 `Spec range: [a, b]` 改成 `Hard [a, b]` + 必要时 `Soft [c, d]` + `band` 角标(emerald/amber/red),soft band 内但非 supervisor 时显示 "请叫 supervisor",out 时显示 "outside soft tolerance — must FAIL"
- `src/lib/permissionStructure.ts` — `qc.testing` 资源下加 `supervisor_judge` 条目,prereq `submit_inspection`

**业务规则**:
- **BR-Q70** 每个检验模板必须配 hard `[lower, upper]` + soft `[soft_lower, soft_upper]`,soft 必须**包住** hard(`soft_lower ≤ lower` AND `soft_upper ≥ upper`);DB CHECK 强制,前端 submit 同步校验。
- **BR-Q71** Manual override 受 `qc.testing.supervisor_judge` 守门:读数在 hard 内反向选 FAIL,或在 soft 边带选任意 verdict,都需此权限;无此权限的提交跟着自动判定走。
- **BR-Q72** 读数超出 soft 范围时,**任何人**(包括 supervisor)都不能 override,RPC 强制返回 FAIL。
- **BR-Q73** Migration 默认所有现有 SKU `soft = hard`,等于关闭 override 通道;运营按需为单个 SKU 加宽 soft 才开放 supervisor discretion。

**审计**: 走过 supervisor override 路径的 inspection,`qc_quality_event(inspection_passed | inspection_failed_hold)` 的 payload 含 `manual_override_by_supervisor: true / in_hard / in_soft / soft_limits`,Audit Log 可直接过滤。

---

### M-119 `20260527000016_qc_sample_id_from_cart.sql`
**用途**: 取消运营手动维护 sample 号码;sample ID 一律服务端从车号(`sub_lot_code`)派生。

**问题**: TestingPage Take Sample 之前必须手动输 `S-2026-0521-001` 这种自编号,运营反馈跟车号是两套独立编号体系,既麻烦又容易记错(尤其同一车多次 retest 时)。车号 `<work_order>-NNN` 本来就唯一,直接复用最干净。

**规则**(服务端在 `qc_take_sample` 自动算):
- n = 该 sub_lot 已有 qc_sample 行数
- n = 0(初次测) → `sample_id = <sub_lot_code>`,例如 `W12345-001`
- n = 1(第一次 retest) → `<sub_lot_code>R`,例如 `W12345-001R`
- n ≥ 2(第二/三/... 次 retest) → `<sub_lot_code>R<n>`,例如 `W12345-001R2`、`W12345-001R3`

**变更**:
- `qc_take_sample` 的 `p_sample_id` 参数变为可选(`DEFAULT NULL`);传 `NULL` 或空字符串 → 走自动派生;传非空 → 沿用旧的"使用调用方传入值"语义(保留 backward compat)
- `qc_quality_event(sample_taken).payload` 加 `auto_generated: boolean`,审计可追溯

**前端配套**:
- `src/services/qcApi.ts` — `takeSample` 的 `sample_id` 改 optional,默认不传 → 服务端派生
- `src/pages/qc/TestingPage.tsx` — Step 1 的手动输入框换成只读预览块,显示 server 会派出的 ID(`<code>` / `<code>R` / `<code>RN`),retest 时步骤标题改成 "Take retest sample #N" + 角标 "retest #N"

**业务规则**:
- **BR-Q74** Sample ID 默认服务端派生:初次 = 车号(`sub_lot_code`),retest 加 `R` / `R2` / `R3` ... 后缀。前端不再要求操作员手输 ID。
- **BR-Q75** 旧的手动输入路径**保留**(调用方传 `p_sample_id` 时跳过自动派生),便于脚本/补录场景按需提供显式 ID。

**未做**: `qc_sample.sample_id` 没有加 UNIQUE 约束(历史上手动输入允许重复 / 跨 sub_lot 同名);如未来要彻底归一,需要单独再做一个唯一性约束 migration。

---

### M-122 `20260610000001_prod_daily_report.sql`
**用途**: 把客户成型生产(Forming Production)的每日 Excel 报表(`docs/2026 Daily Report Forming Production.xlsx` 的 Daily Report sheet)的"填写"动作搬进系统。第一阶段 1:1 复刻该表录入功能。

**背景**: 该 Excel 是生产流水表,每行 = 一个(日期 × 班次 × 机台 × 工单 × 操作员)的记录。24 列里约 13 列人工填,其余 10 列是 Excel 公式(VLOOKUP 进 RAW DATA / name item 字典 + 算术)自动算。

**新建 5 张表**(均 `prod_` 前缀、`uuid` 主键、`created_at/created_by`、`dev_all` 宽松 RLS):
- `prod_product_master` — 独立产品主数据(料号、描述、规格、`oz_per_piece`、`lbs_per_hr`、`pcs_lbs_per_hour`、`runner_avg`、`bone_avg`、`is_activity`)。**刻意不复用** `qc_product_sku` / `item`,因为本表要承载公式所需的标准速率。
- `prod_machine` — 机台清单(`code`、`kind` inj/ext/other)。
- `prod_downtime_reason` — 停机原因(`label` 保留双语原串如 `Other其他问题`)。
- `prod_operator` — 操作员花名册(`badge_no` = Excel "Name Item" 工号 → `name`,可选 `erp_user_id` FK)。**不**把 ~159 个一线工人塞进登录表 `erp_user`。
- `prod_daily_report` — 日报流水,**只存人工录入字段**。索引 `(report_date, shift)`。

**视图 `prod_daily_report_view`**: join 三张主数据表,导出全部原始列 + 10 个计算列。前端直接 `.from('prod_daily_report_view').select()` 读(与 `account_balance` 视图用法一致)。

**业务规则**:
- **BR-P1** 计算列口径(与 Excel 公式 1:1,已对 1 万+ 历史行验证):`lbs_good_produced = bone_avg × output`;`standard_lbs_hr = pcs_lbs_per_hour`;`runner_weight_pct = runner_avg`;`runner_regrind_lbs = runner_avg × output`;`pcs_lbs_per_hr = output / work_hours`;`credit = (output/work_hours) / pcs_lbs_per_hour`;`total_carts = COALESCE(cart_to,0) − COALESCE(cart_from,0) + 1`(Excel `=J−I+1` 在空车号行得 1);`week_num = EXTRACT(week)`;描述/操作员名按 FK 取。
- **BR-P2** 非生产活动行(Material Handler / Meeting / R&D Test / Machine Down 等)是 `prod_product_master` 里 `is_activity=true`、速率为空的真实条目,可照常录入,计算列自然归 0 / NULL。

**权限种子**: 给已有 `production / module_permissions / manage` 的用户授予 `production / daily_report / {view,create,edit,delete}`(cross-join 模式,幂等)。

**前端配套**: `src/lib/permissionStructure.ts`(新增 `daily_report` 资源)、`src/services/productionDailyApi.ts`、`src/pages/production/DailyReportPage.tsx`、`ProductionModule.tsx`(Reporting 区导航)、`src/locales/*/production.json`(`dailyReport` 文案)。

### M-123 `20260610000002_prod_daily_report_seed.sql`
**用途**: 为 M-122 的四张字典表灌入主数据,使录入页下拉与计算可用。**历史日报流水行不导入**。

**来源**: 由 `scripts/gen_prod_seed.py`(openpyxl)从工作簿生成 —— 客户换新工作簿时重跑脚本即可重生成。

**内容**(全部 `ON CONFLICT (unique key) DO NOTHING`,`created_by='system:M-123'`):
- `prod_machine` ← Machine DATA C 列(45 台,前缀判 inj/ext/other)
- `prod_downtime_reason` ← Machine DATA A 列(7 条双语)
- `prod_operator` ← name item(158 个有名字的工号)
- `prod_product_master` ← RAW DATA(382 料号,按料号去重保留最后一条)+ Other INF 特殊码(合计 383,其中 44 个 `is_activity`)

---

### M-125 `20260613000001_prod_work_order_and_run.sql`
**用途**: Production Phase 2 M1.1 地基 —— 新建工单主数据,并把 Phase 1 的 `prod_daily_report` 收敛为单一事实源 `prod_run`(SPEC 方案 A / D3)。

**背景**: Phase 2 要把生产录入前移到一线平板、实时化、与 QC 打通(见 `docs/Production模块-Phase2-SPEC.md` 决策 D1–D10)。M1.1 先落工单主数据 + 工单驱动录入 + 收敛地基,为 M1.2 平板端、M1.3 看板铺路。

**新建 `prod_work_order`**(工单主数据,D1:工单源自外部系统,本期系统内手动维护):`work_order_no` UNIQUE、`product_id`→`prod_product_master`、`machine_id`(可空)、`planned_qty`(可空)、`status`(open/in_progress/closed/cancelled)、`planned_date`、`note`。**无 `process` 字段**(D10:工序由产品决定,经 `product_id` 读 `prod_product_master.process`)。`dev_all` RLS。

**收敛 `prod_daily_report` → `prod_run`**(原地改造,保数据):
- `DROP VIEW prod_daily_report_view` → `ALTER TABLE ... RENAME TO prod_run` → `operator_id` 改 nullable(M1.2 团队 run 无单一操作员)→ 新增列 `work_order_id`(FK)、`source`(default 'manager',CHECK tablet/manager)、`status`(default 'submitted',CHECK draft/submitted/reviewed)、`final_cart_complete`(default true)、`continues_prev`(default false)、`device_id`(M1.2 再加 FK)。`ADD COLUMN ... DEFAULT` 原子回填既有行。
- **新计算视图 `prod_run_view`**:BR-P1 的 10 个计算表达式与 M-122 **逐字一致**(回归核心);operator 改 LEFT JOIN、新增 work_order LEFT JOIN,补选工单/新 run 列(含 `process`)。
- **兼容视图** `CREATE VIEW prod_daily_report AS SELECT * FROM prod_run`(保险;应用层已直接读写 `prod_run`/`prod_run_view`)。

**新视图 `prod_work_order_rollup_view`**(BR-P4 / D8):`run_count`、`total_output=SUM(output_qty)`、`distinct_carts=MAX(cart_to)-MIN(cart_from)+1`(续做交接车去重)。

**权限种子**: 给已有 `production/module_permissions/manage` 用户授予 `production/work_order/{view,create,edit,close}`(cross-join,幂等)。

**业务规则**:
- **BR-P3** `prod_run` 单一事实源:平板与管理端生产记录统一落 `prod_run`,`source`(tablet/manager)区分来源、`status`(draft/submitted/reviewed)区分流转;`prod_daily_report` 仅为兼容视图。
- **BR-P4** 工单累计/车数去重:工单实际产出 = 名下各 run `output_qty` 之和;总车数 = `MAX(cart_to)-MIN(cart_from)+1`(跨班续做的交接车按一辆计)。

**设计取舍**: M1.1 保留 `operator_id`(nullable)与 `work_hours` —— 管理页仍是 Phase-1 的"每操作员一行"形态,Credit/Pcs·Hr 仍以 `work_hours` 为分母,口径零变化;D5「工时=Σ打卡」在 M1.2 引入 `prod_line_attendance` 后再切换。不在 M1.1 合并历史行(避免产量重复计)。

**前端配套**: `src/lib/permissionStructure.ts`(新增 `work_order` 资源)、`src/services/productionWorkOrderApi.ts`、`src/services/productionDailyApi.ts`→`productionRunApi.ts`(重指 `prod_run`/`prod_run_view`)、`src/pages/production/{WorkOrderPage,DailyReportPage,ProductionModule}.tsx`、`src/locales/*/production.json`。

---

### M-126 `20260614000001_prod_tablet_device_attendance.sql`
**用途**: Production Phase 2 M1.2a —— 产线平板 kiosk(`/tablet`)+ 设备账号登录 + 打卡上岗/下岗。把"现在这条线有哪几个人"跑通,为 M1.2b(平板生产录入/停机)、M1.3(工时汇总/看板)铺路。

**背景**: 平板不是 `erp_user`,走独立设备账号。沿用两个现成先例:`/superuser` kiosk(`App.tsx` init 读 `pathname` 绕过登录)+ `set_module_visibility` 的 SECURITY DEFINER + 校验密钥 RPC。

**新建 `prod_line_device`**(产线平板设备):`code` UNIQUE(登录设备码)、`name`、`machine_id`→`prod_machine`(绑定产线)、`pin`、`active`。RLS **仅 `authenticated`**(管理端 CRUD);**不建 anon 策略** → 平板(anon)不可直读 PIN。

**新建 `prod_line_attendance`**(打卡/上岗登记):`operator_id`、`machine_id`、`report_date`、`shift`、`check_in_at`、`check_out_at`(空=在岗)、`device_id`→`prod_line_device`。索引 `(machine_id, report_date, shift)`。RLS `dev_all`(平板 anon 读写)。

**`prod_run.device_id` 补 FK** → `prod_line_device`(M-125 时为 plain uuid)。

**RPC `prod_tablet_login(p_code, p_pin)`**(`SECURITY DEFINER`,`RETURNS jsonb`,`GRANT … TO anon`):按 `code+pin+active` 校验并返回 `{device_id, code, name, machine_id, machine_code}`,否则 `RAISE 'unauthorized'`。

**权限种子**:给 `production/module_permissions/manage` 用户授予 `production/device/{view,create,edit,disable}`(cross-join,幂等)。**演示设备 seed**:`LINE-INJ01` / PIN `1234`,绑定 Inj 01。

**业务规则**:
- **BR-P5** 平板设备登录经 `prod_tablet_login`(设备码+PIN)服务端校验;`prod_line_device` 不开放 anon 直读(PIN 不经 REST 暴露);设备绑定一条产线。
- **BR-P6** 「生产 team」是打卡点:某产线某班"当前在岗" = `prod_line_attendance` 中该 (machine×date×shift) `check_out_at IS NULL` 的操作员集合;工时 = Σ session 时长(M1.3 切换效率分母)。

**设计取舍/安全**:M1.2a 为 dev 级(PIN 明文存库、attendance 走 `dev_all` anon 写),与全站 `dev_all` + `/superuser` 一致。生产硬化(PIN 加盐、逐写 RPC 校验、收紧 RLS)列入后续。

**前端配套**: `src/App.tsx`(`/tablet` 路由,镜像 `/superuser`)、`src/pages/tablet/TabletApp.tsx`(设备登录 + 打卡工作台)、`src/services/{productionTabletApi,productionDeviceApi}.ts`、`src/pages/production/{DevicePage,ProductionModule}.tsx`、`src/lib/permissionStructure.ts`(新增 `device` 资源)、`src/locales/*/production.json`。

---

### M-127 `20260615000001_prod_downtime_event.sql`
**用途**: Production Phase 2 M1.2b —— 停机实时事件 `prod_downtime_event`,配合平板生产录入,替代纸质 Form 451。

**背景**: M1.2b 把产线平板从"只打卡"升级为"能录生产 + 记停机"。平板生产录入写既有 `prod_run`(`source='tablet'`,无需新表/新列);本迁移只建停机事件表。

**新建 `prod_downtime_event`**:`machine_id`→`prod_machine`、`run_id`→`prod_run`(可选,关联当时 run)、`report_date`、`shift`、`reason_id`→`prod_downtime_reason`、`start_at`/`end_at`(空=进行中)、`down_minutes`(结束算出或补录直填)、`note`、`device_id`→`prod_line_device`。索引 `(machine_id, report_date, shift)`。RLS `dev_all`(平板 anon 读写)。**无新 RPC、无权限种子**。

**业务规则**:
- **BR-P7** 停机事件:line 级、实时 start/end 打点(结束时 `down_minutes = round((end−start)/60)`)或补录时长;可选 `run_id` 关联当时生产记录。班次停机工时 = Σ `down_minutes`(M1.3 汇总用)。

**前端配套**: `src/services/productionTabletApi.ts`(`submitTabletRun`/`listTabletRuns` + 停机 start/end/add/list/getOpen)、`src/pages/tablet/TabletApp.tsx`(Tab 工作台:打卡 | 生产 | 停机)、`src/locales/*/production.json`。平板生产录入复用 `findWorkOrderByNo`/`getCarryOverCart`(M-125)。

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
| _(M-068–M-074)_ | _(中间几个 migration 文件存在但本索引未补登,详见 `supabase/migrations/`)_ |
| M-075 | 20260523000019_qc_bulk_checkout_fix_step2_cascade.sql |
| M-076 | 20260523000020_repair_w12345_orphan_siblings.sql |
| M-077 | 20260523000021_qc_needs_attention_per_group.sql |
| M-078 | 20260523000022_qc_create_disposition_fix_room_temp_columns.sql |
| M-079 | 20260523000023_qc_testing_view_dashboard_permission.sql |
| M-080 | 20260525000001_qc_location_crud.sql |
| M-081 | 20260525000002_qc_forecast_narrow_inflight.sql |
| M-082 | 20260525000003_repair_w11111_orphan_siblings.sql |
| M-083 | 20260525000004_qc_trace_action_permissions.sql |
| M-084 | 20260525000005_qc_forecast_exclude_orphan_agr.sql |
| M-085 | 20260525000006_repair_stuck_retest_carts.sql |
| M-086 | 20260525000007_repair_retest_carts_pass_07.sql |
| M-087 | 20260525000008_qc_sku_item_junction.sql |
| M-088 | 20260525000009_qc_test_type_catalog.sql |
| M-089 | 20260525000010_pkg_skus_with_stock_fix_nested_agg.sql |
| M-090 | 20260525000011_pkg_dispatch_carts_fix_lot_ambiguous.sql |
| M-091 | 20260525000012_pkg_dispatch_carts_fix_dispatched_by_fkey.sql |
| M-092 | 20260525000013_pkg_work_order_packaging.sql |
| M-093 | 20260525000014_qc_production_pipeline_summary.sql |
| M-094 | 20260525000015_permission_move_to_production_module.sql |
| M-095 | 20260526000001_qc_create_lot_with_packaging.sql |
| M-096 | 20260526000002_qc_needs_attention_today_not_24h.sql |
| M-097 | 20260526000005_qc_retest_reset_group_siblings.sql |
| M-098 | 20260527000001_qc_scan_for_check_in.sql |
| M-099 | 20260527000002_qc_trace_scanned_only.sql |
| M-100~105 | _(Warehouse S2 — 见 docs/modules/11_warehouse-inventory.md)_ |
| M-106 | 20260527000003_qc_group_retest_normalize.sql |
| M-107 | 20260527000004_qc_needs_attention_dedup_by_group.sql |
| M-108 | 20260527000005_qc_sub_lot_produced_at.sql |
| M-109 | 20260527000006_qc_manual_judgment_and_remark.sql |
| M-110 | 20260527000007_wh_lot_lifecycle.sql |
| M-111~M-117 | _(Warehouse S4 + QC v2 / hold hooks — 见 docs/modules/11_warehouse-inventory.md & 09_qc.md)_ |
| M-118 | 20260527000015_qc_check_out_bulk_sampling_method.sql |
| M-111 | 20260527000008_wh_balance_status_aware_available.sql |
| M-112 | 20260527000009_wh_qc_lot_link_schema.sql |
| M-113 | 20260527000010_wh_recompute_lot_status.sql |
| M-114 | 20260527000011_wh_qc_sync_helpers.sql |
| M-115 | 20260527000012_qc_create_production_lot_with_sub_lots_v2.sql |
| M-116 | 20260527000013_qc_release_passed_sub_lot_v2.sql |
| M-117 | 20260527000014_qc_hold_event_hooks.sql |
| M-118 | 20260527000015_qc_soft_limits.sql |
| M-119 | 20260527000016_qc_sample_id_from_cart.sql |
| M-120 | 20260609000001_qc_failed_outcome_split.sql |
| M-121 | 20260609000002_qc_recent_passed_inspections.sql |
| M-122 | 20260610000001_prod_daily_report.sql |
| M-123 | 20260610000002_prod_daily_report_seed.sql |
| M-124 | 20260611000001_app_module_visibility.sql · 开发者 superuser 面板的模块显隐配置(表 `app_module_visibility` 单行全局配置 + 公开只读 RLS + 校验密钥的 `set_module_visibility(p_hidden,p_secret)` RPC)。前端 `/superuser` 子路由读写,控制 HomePage 入口卡片、模块导航与权限开关的显示。 |
| M-125 | 20260613000001_prod_work_order_and_run.sql |
| M-126 | 20260614000001_prod_tablet_device_attendance.sql |
| M-127 | 20260615000001_prod_downtime_event.sql |
| **M-128** | _(下一个)_ |

| 编号 | 目录 |
|------|------|
| EF-001 | functions/post-journal-entry/ |
| EF-SHARED | functions/_shared/ |
| EF-002 | functions/create-auth-user/ |
| EF-003 | functions/reset-user-password/ |
| EF-004 | functions/send-notification/ |
| **EF-005** | _(下一个)_ |

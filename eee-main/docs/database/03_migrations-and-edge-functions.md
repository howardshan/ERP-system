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
| **M-043** | _(下一个)_ |

| 编号 | 目录 |
|------|------|
| EF-001 | functions/post-journal-entry/ |
| EF-SHARED | functions/_shared/ |
| EF-002 | functions/create-auth-user/ |
| **EF-003** | _(下一个)_ |

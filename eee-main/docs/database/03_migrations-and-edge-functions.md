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
| **M-008** | _(下一个)_ |

| 编号 | 目录 |
|------|------|
| EF-001 | functions/post-journal-entry/ |
| EF-SHARED | functions/_shared/ |
| **EF-002** | _(下一个)_ |

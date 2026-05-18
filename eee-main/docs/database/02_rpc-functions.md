# 数据库 RPC 函数 & Views

所有函数均使用 `SECURITY DEFINER` 执行，以绕过 RLS 限制，在服务端执行业务规则。

---

## VIEW：account_balance

**文件**: `20260517000001_rpc_and_views.sql`

```sql
CREATE OR REPLACE VIEW account_balance AS
SELECT
    a.id, a.account_code, a.name, a.account_type,
    a.parent_id, a.is_postable, a.is_active,
    COALESCE(SUM(jel.debit), 0)  AS total_debit,
    COALESCE(SUM(jel.credit), 0) AS total_credit,
    CASE
        WHEN a.account_type IN ('asset', 'expense')
            THEN COALESCE(SUM(jel.debit) - SUM(jel.credit), 0)
        ELSE
            COALESCE(SUM(jel.credit) - SUM(jel.debit), 0)
    END AS balance
FROM gl_account a
LEFT JOIN journal_entry_line jel ON jel.gl_account_id = a.id
LEFT JOIN journal_entry je
    ON je.id = jel.journal_entry_id AND je.status = 'posted'
GROUP BY a.id, a.account_code, a.name, a.account_type,
         a.parent_id, a.is_postable, a.is_active;
```

**用途**: 试算平衡表、科目表余额展示、仪表盘统计  
**注意**: 只统计 `status='posted'` 的凭证，草稿和待审批不计入余额

---

## create_je_shell

**文件**: `20260517000005_je_edit_and_audit.sql`  
**调用**: `supabase.rpc('create_je_shell', { p_entry_date, p_description, p_journal_type, p_notes })`

```sql
FUNCTION create_je_shell(
  p_entry_date   date,
  p_description  text,
  p_journal_type text DEFAULT 'general',
  p_notes        text DEFAULT NULL
) RETURNS bigint
```

**用途**: 创建只有表头没有明细行的草稿凭证，用于在填写行之前先上传附件。

**步骤**:
1. 查找 `p_entry_date` 对应的 open 会计期间
2. INSERT journal_entry（状态 draft，生成临时 entry_number）
3. UPDATE 替换为正式编号 `JE-YYYY-NNNNNN`
4. INSERT journal_entry_edit_log（action='created'）
5. 返回新凭证 id

**异常**:
- `No open accounting period found for date %` — 日期无对应 open 期间

---

## update_je_draft

**文件**: `20260517000005_je_edit_and_audit.sql`  
**调用**: `supabase.rpc('update_je_draft', { p_entry_id, p_entry_date, p_description, p_journal_type, p_notes, p_lines })`

```sql
FUNCTION update_je_draft(
  p_entry_id     bigint,
  p_entry_date   date,
  p_description  text,
  p_journal_type text,
  p_notes        text DEFAULT NULL,
  p_lines        jsonb DEFAULT '[]'
) RETURNS void
```

**用途**: 替换草稿凭证的表头字段和所有明细行，记录修改日志。

**步骤**:
1. 验证凭证存在且 `status='draft'`（rejected 状态不可 update，须先 submit）
2. 查找新日期对应的 open 期间
3. UPDATE 表头（entry_date, description, journal_type, notes, updated_at/by）
4. 若 `p_lines` 非空：DELETE 旧行，INSERT 新行（`NULLIF` 处理空字符串 bigint）
5. INSERT edit log（action='updated'）

**异常**:
- `Only draft entries can be edited (entry is %)`
- `No open accounting period found for date %`

---

## create_journal_entry

**文件**: `20260517000005_je_edit_and_audit.sql`（覆盖 migration 001 版本）  
**调用**: `supabase.rpc('create_journal_entry', { p_entry_date, p_description, p_journal_type, p_lines, p_notes })`

```sql
FUNCTION create_journal_entry(
  p_entry_date   date,
  p_description  text,
  p_journal_type text,
  p_lines        jsonb,
  p_notes        text DEFAULT NULL
) RETURNS bigint
```

**用途**: 原子创建带完整明细行的草稿凭证（一步完成，不需要 shell + update 两步）。

**p_lines JSON 格式**:
```json
[
  {
    "gl_account_id": 123,
    "description": "行描述",
    "debit": 1000.00,
    "credit": 0,
    "department_id": null,
    "cost_center_id": null
  },
  ...
]
```

**异常**:
- `No open accounting period found for date %`
- `A journal entry must have at least two lines`

---

## post_journal_entry

**文件**: `20260517000005_je_edit_and_audit.sql`（覆盖 migration 001 版本）  
**调用**: `supabase.rpc('post_journal_entry', { p_entry_id })`

```sql
FUNCTION post_journal_entry(p_entry_id bigint) RETURNS void
```

**验证规则（BR-F1 ～ BR-F5）**:
1. 凭证存在且 `status='draft'`（BR-F5）
2. ≥ 2 行（BR-F1）
3. `|Σdebit - Σcredit| ≤ 0.005`（BR-F1 平衡）
4. 所有行科目 `is_postable=true`（BR-F3）

**执行**:
- UPDATE status='posted', posted_at/by
- INSERT edit log（action='posted'）

---

## reverse_journal_entry

**文件**: `20260517000001_rpc_and_views.sql`  
**调用**: `supabase.rpc('reverse_journal_entry', { p_entry_id, p_reason })`

```sql
FUNCTION reverse_journal_entry(
  p_entry_id bigint,
  p_reason   text DEFAULT NULL
) RETURNS bigint
```

**用途**: 对已过账凭证创建反冲凭证（借贷对调），原凭证标记为 reversed。

**步骤**:
1. 验证原凭证 `status='posted'`
2. 找当前最新 open 期间作为反冲凭证的期间
3. INSERT 新凭证（description = `Reversal of JE-...` 或 p_reason）
4. INSERT 反向明细行（`debit ↔ credit` 对调）
5. 立即 UPDATE 新凭证 `status='posted'`
6. UPDATE 原凭证 `status='reversed'`, `reversed_by_entry_id = v_new_id`
7. 返回新凭证 id

---

## submit_journal_entry

**文件**: `20260517000006_approval_workflow.sql`  
**调用**: `supabase.rpc('submit_journal_entry', { p_entry_id })`

```sql
FUNCTION submit_journal_entry(p_entry_id bigint) RETURNS void
```

**前置检查**:
- `status IN ('draft', 'rejected')`（可从拒绝状态重新提交）
- ≥ 2 行
- 借贷平衡（精度 0.005）
- 所有科目 is_postable=true

**层级自动计算**:
```sql
SELECT id FROM approval_tier
WHERE approval_limit IS NULL OR approval_limit >= v_debit
ORDER BY COALESCE(approval_limit, 999999999) ASC
LIMIT 1;
-- 选择"刚好够"的最低层级
```

**执行**:
- status = 'pending_approval'
- submitted_at = now(), submitted_by = auth.uid()
- required_tier_id = 计算结果
- 清空 rejection_reason / rejected_at / rejected_by
- INSERT edit log（action='submitted'）

---

## approve_journal_entry

**文件**: `20260517000006_approval_workflow.sql`  
**调用**: `supabase.rpc('approve_journal_entry', { p_entry_id })`

```sql
FUNCTION approve_journal_entry(p_entry_id bigint) RETURNS void
```

**前置检查**:
- `status = 'pending_approval'`
- 会计期间 `status = 'open'`
- 审批人的 `approval_limit >= Σdebit`（无 user_profile 时跳过检查）

**执行**:
- status = 'posted'
- approved_at/by = now()/uid
- posted_at/by = now()/uid（同时视为已过账）
- INSERT edit log（action='approved'）

---

## reject_journal_entry

**文件**: `20260517000006_approval_workflow.sql`  
**调用**: `supabase.rpc('reject_journal_entry', { p_entry_id, p_reason })`

```sql
FUNCTION reject_journal_entry(p_entry_id bigint, p_reason text) RETURNS void
```

**前置检查**: `status = 'pending_approval'`

**执行**:
- status = 'rejected'
- rejected_at/by = now()/uid
- rejection_reason = p_reason
- INSERT edit log（action='rejected'）

---

## open_accounting_period

**文件**: `20260517000001_rpc_and_views.sql`

```sql
FUNCTION open_accounting_period(p_period_id bigint) RETURNS void
```

- 若已是 open 直接返回
- 否则：INSERT period_status_history，UPDATE status='open'

---

## close_accounting_period

**文件**: `20260517000001_rpc_and_views.sql`

```sql
FUNCTION close_accounting_period(p_period_id bigint) RETURNS void
```

**前置检查**:
- `status = 'open'`
- 该期间内无 `status='draft'` 的凭证（阻止关闭）

**执行**: INSERT period_status_history，UPDATE status='closed'

---

## create_accounting_period

**文件**: `20260517000001_rpc_and_views.sql`

```sql
FUNCTION create_accounting_period(
  p_name        text,
  p_start_date  date,
  p_end_date    date,
  p_fiscal_year integer
) RETURNS bigint
```

**前置检查**:
- `end_date >= start_date`
- 不与任何已有期间日期重叠（OVERLAPS 操作符）

**执行**: INSERT accounting_period（status='future'），返回 id

---

## 前端 API 函数汇总（src/services/api.ts）

| 函数名 | RPC / Table | 说明 |
|--------|-------------|------|
| `getAccounts()` | VIEW account_balance | 获取所有启用科目及余额 |
| `createAccount()` | INSERT gl_account | 新建科目 |
| `updateAccount()` | UPDATE gl_account | 更新科目 |
| `getJournalEntries()` | SELECT journal_entry | 分页+筛选列表 |
| `getJournalEntry()` | SELECT journal_entry + lines | 单条凭证（含行） |
| `createJournalEntry()` | RPC create_journal_entry | 原子创建含行凭证 |
| `createJeShell()` | RPC create_je_shell | 创建无行凭证表头 |
| `updateJeDraft()` | RPC update_je_draft | 更新草稿凭证 |
| `getEditLog()` | SELECT journal_entry_edit_log | 获取修改历史 |
| `postJournalEntry()` | RPC post_journal_entry | 过账 |
| `reverseJournalEntry()` | RPC reverse_journal_entry | 反冲 |
| `submitJournalEntry()` | RPC submit_journal_entry | 提交审批 |
| `approveJournalEntry()` | RPC approve_journal_entry | 审批通过 |
| `rejectJournalEntry()` | RPC reject_journal_entry | 审批拒绝 |
| `getPendingApprovals()` | SELECT journal_entry (pending) | 待审批列表 |
| `getAccountingPeriods()` | SELECT accounting_period | 所有期间 |
| `createAccountingPeriod()` | RPC create_accounting_period | 新建期间 |
| `openAccountingPeriod()` | RPC open_accounting_period | 开放期间 |
| `closeAccountingPeriod()` | RPC close_accounting_period | 关闭期间 |
| `getTrialBalance()` | VIEW account_balance | 试算平衡表 |
| `getDashboardStats()` | VIEW account_balance + journal_entry | 仪表盘统计 |
| `uploadAttachment()` | Storage upload + INSERT | 上传附件 |
| `getAttachments()` | SELECT journal_entry_attachment | 附件列表 |
| `deleteAttachment()` | Storage remove + DELETE | 删除附件 |
| `getAttachmentUrl()` | Storage createSignedUrl（1h） | 获取访问 URL |
| `getApInvoices()` | SELECT ap_invoice + supplier | AP 发票列表 |
| `getArInvoices()` | SELECT ar_invoice + customer | AR 发票列表 |
| `getApprovalTiers()` | SELECT approval_tier | 审批层级列表 |
| `updateApprovalTier()` | UPDATE approval_tier | 修改层级配置 |
| `createApprovalTier()` | INSERT approval_tier | 新增层级 |
| `deleteApprovalTier()` | DELETE approval_tier | 删除层级 |
| `getUserProfiles()` | SELECT user_profile + tier | 用户权限列表 |
| `upsertUserProfile()` | UPSERT user_profile | 更新用户权限 |

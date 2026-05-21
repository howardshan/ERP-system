# 模块 01：General Ledger（总账）

包含：财务仪表盘、科目表、记账凭证（新建/编辑/审计追踪）

---

## 1. 财务仪表盘（FinanceDashboard）

**路由**: `dashboard`  
**文件**: `src/pages/FinanceDashboard.tsx`  
**完整路径**: `eee-main/src/pages/FinanceDashboard.tsx`

### 功能
- 展示企业财务快照（资产、负债、权益、净利润）
- 显示最近 5 条记账凭证
- 提供快速导航按钮（新建凭证、查看列表）

### 数据来源

| 数据 | 来源 |
|------|------|
| 资产/负债/权益/营收/费用汇总 | `account_balance` VIEW，按 `account_type` 分组求和 |
| 最近凭证 | `journal_entry` 表，`ORDER BY created_at DESC LIMIT 5` |

### 计算逻辑
```
净利润 = 总营收 - 总费用
资产总额 = 所有 account_type='asset' 且 is_postable=true 的 balance 之和
负债总额 = 所有 account_type='liability' 且 is_postable=true 的 balance 之和
权益总额 = 所有 account_type='equity' 且 is_postable=true 的 balance 之和
```

### API 函数
```ts
getDashboardStats(): Promise<DashboardStats>
```

### TypeScript 类型
```ts
interface DashboardStats {
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  netIncome: number;
  draftEntryCount: number;
  recentEntries: JournalEntry[];
}
```

---

## 2. 科目表（ChartOfAccounts）

**路由**: `coa`  
**文件**: `src/pages/ChartOfAccounts.tsx`  
**完整路径**: `eee-main/src/pages/ChartOfAccounts.tsx`

### 功能
- 按类型分区展示所有会计科目（Asset / Liability / Equity / Revenue / Expense）
- 每个类型区块可折叠，显示该类型下所有科目及其余额
- 每行鼠标悬停显示编辑按钮（铅笔图标，需 `finance.chart_of_accounts.edit` 权限）
- 新建科目弹窗（AccountModal，需 `finance.chart_of_accounts.create` 权限）
- 编辑科目弹窗（复用同一 AccountModal）

### 权限控制
| 元素 | 所需权限 |
|------|---------|
| Create Account 按钮 | `finance.chart_of_accounts.create` |
| 行内编辑铅笔图标 | `finance.chart_of_accounts.edit` |
| 查看科目列表 | 无权限限制（导航项本身需要 `finance.chart_of_accounts.view`） |

### 颜色规则
| 类型 | 颜色 |
|------|------|
| Asset（资产） | 蓝色（blue） |
| Liability（负债） | 琥珀色（amber） |
| Equity（权益） | 紫色（purple） |
| Revenue（收入） | 绿色（green） |
| Expense（费用） | 红色（red） |

### 科目树
科目支持父子层级（`parent_id` 自引用）。列表展示为扁平列表（按 `account_code` 排序），层级在 UI 层通过缩进体现（规划中）。

### 父科目下拉规则
- 只显示与新科目**相同 account_type** 的科目
- 编辑时排除自身（防止自引用）

### 循环引用防护（BR-F8）

`updateAccount()` 在执行 UPDATE 前调用 `wouldCreateCycle(accountId, proposedParentId)`，从 `proposedParentId` 出发向上遍历祖先链，若在链上找到 `accountId` 则判定为循环引用，抛出错误：

> `"Cannot set this parent account: it would create a circular reference in the account hierarchy."`

此检查在前端（`src/services/api.ts`）执行，防止例如"将 A 的父科目设为 A 的子孙"这类操作在数据库层静默写入。

### API 函数
```ts
getAccounts(): Promise<GlAccount[]>           // 从 account_balance VIEW 读取
createAccount(account): Promise<GlAccount>    // 直接 INSERT gl_account
updateAccount(id, updates): Promise<void>     // 更新前验证循环引用（BR-F8），再 UPDATE gl_account
```

### TypeScript 类型
```ts
interface GlAccount {
  id: number;
  account_code: string;
  name: string;
  account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  parent_id: number | null;
  is_postable: boolean;    // false = 汇总科目（不可直接记账）
  is_active: boolean;
  // 来自 account_balance VIEW：
  total_debit?: number;
  total_credit?: number;
  balance?: number;        // 自然余额（遵循借贷方向约定）
}
```

### 余额符号约定（account_balance VIEW）
```sql
-- 资产、费用：借方增加，余额 = 累计借 - 累计贷
WHEN account_type IN ('asset','expense') THEN SUM(debit) - SUM(credit)
-- 负债、权益、收入：贷方增加，余额 = 累计贷 - 累计借
ELSE SUM(credit) - SUM(debit)
```

---

## 3. 记账凭证——新建（JournalEntryForm，create mode）

**路由**: `je-create`  
**文件**: `src/pages/JournalEntryForm.tsx`  
**完整路径**: `eee-main/src/pages/JournalEntryForm.tsx`

### 表单字段

| 字段 | 类型 | 说明 |
|------|------|------|
| JE 编号 | 只读 | 保存前显示 `JE-YYYY-AUTO`，保存后显示 `JE-2026-000001` |
| 凭证日期 | date picker | 必填，决定所属会计期间 |
| 凭证类型 | select | general / adjustment / accrual / depreciation |
| 摘要 | text | 整张凭证描述，必填 |
| 备注 (Notes) | textarea | 可选，内部备注 |
| 明细行 | 动态列表 | 最少 2 行 |
| 附件 | drag-drop | 可上传多个文件 |

### 明细行字段

| 字段 | 说明 |
|------|------|
| 科目 | `AccountCombobox`：可搜索下拉，输入过滤，键盘导航（↑↓ Enter Esc） |
| 行描述 | 可选文字说明 |
| 借方金额 | 与贷方互斥（不能同行同时有值） |
| 贷方金额 | 与借方互斥 |

### 借贷平衡实时检验
```
debit_sum = Σ 所有行借方
credit_sum = Σ 所有行贷方
isBalanced = |debit_sum - credit_sum| < 0.005
```
底部显示借方合计 / 贷方合计 / 差额，不平衡时高亮红色。

### 附件上传流程
1. 用户拖拽或点击上传文件
2. 若当前无 `entryId`（全新表单），先调用 `createJeShell()` 创建仅含表头的草稿，获得 `entryId`
3. 以 `{entryId}/{timestamp}_{sanitizedFileName}` 为路径上传至 `journal-attachments` Storage bucket
4. 在 `journal_entry_attachment` 表写入记录
5. 文件名净化：中文、空格、特殊字符统一替换为下划线（`sanitizeFileName()`）

### 保存流程
```
saveOrGetId():
  if editEntryId exists → 调用 updateJeDraft() 更新
  else if autoSavedId exists → 调用 updateJeDraft() 更新
  else → 调用 createJeShell() 创建表头，再 updateJeDraft() 写入行
```

### Action 按钮（草稿/拒绝状态下）
- **Save Draft** — 保存为 draft，不触发审批（需 `finance.journal_entry.create` 或 `.edit`）
- **Submit for Approval** — 调用 `submitJournalEntry()`，状态变为 `pending_approval`（需 `.create` 或 `.edit`）
- **Add Line** — 仅在可编辑状态且有 create/edit 权限时显示

---

## 4. 记账凭证——编辑/查看（JournalEntryForm，edit mode）

**路由**: `je-edit:<id>`  
**文件**: `src/pages/JournalEntryForm.tsx`  
**完整路径**: `eee-main/src/pages/JournalEntryForm.tsx`  
**Props**: `editEntryId: number`

### 状态感知行为

`isReadOnly` 由两个条件决定（任一满足即只读）：
1. 凭证状态不为 `draft` / `rejected`
2. 用户无 `finance.journal_entry.create`（新建模式）或 `.edit`（编辑模式）权限

| 凭证状态 | 表单是否可编辑 | 可用操作 |
|---------|--------------|---------|
| `draft` | ✅ 可编辑（需 create/edit 权限） | Save Draft / Submit for Approval |
| `rejected` | ✅ 可编辑（需 create/edit 权限） | Save Draft / Submit for Approval（可重新提交） |
| `pending_approval` | ❌ 只读 | — 显示"Awaiting Approval"提示 |
| `posted` | ❌ 只读 | Reverse Entry（需 `finance.journal_entry.edit`） |
| `reversed` | ❌ 只读 | — 显示"已反冲"标识 |

### 拒绝通知横幅
当 `status === 'rejected'` 时，在表单顶部显示橙色横幅，内含 `rejection_reason`。

### 反冲（Reverse Entry）
- 调用 `reverseJournalEntry(id, reason)`
- 后端创建一张新凭证（借贷方向对调），立即过账
- 原凭证状态变为 `reversed`
- 前端导航至新凭证 `je-edit:<newId>`

### 修改历史（Edit Log / Audit Trail）
表单底部展示 `journal_entry_edit_log` 时间线，记录所有操作：

| action 值 | 触发时机 |
|-----------|---------|
| `created` | `create_je_shell` / `create_journal_entry` |
| `updated` | `update_je_draft` |
| `submitted` | `submit_journal_entry` |
| `approved` | `approve_journal_entry` |
| `rejected` | `reject_journal_entry` |
| `posted` | `post_journal_entry` |
| `reversed` | `reverse_journal_entry` |

---

## 5. 凭证列表（JournalEntriesList）

**路由**: `je-list`  
**文件**: `src/pages/JournalEntriesList.tsx`  
**完整路径**: `eee-main/src/pages/JournalEntriesList.tsx`

### 功能
- 分页展示所有凭证（默认 20 条/页）
- 状态筛选（All / Draft / Pending / Posted / Reversed / Rejected）
- 关键字搜索（凭证号、摘要）
- 点击任意行导航至 `je-edit:<id>`（编辑/查看）
- 草稿行显示铅笔图标（需 `finance.journal_entry.edit`），否则显示眼睛图标

### 权限控制
| 元素 | 所需权限 |
|------|---------|
| New Entry 按钮 | `finance.journal_entry.create` |
| 行图标显示为铅笔（可编辑） | `finance.journal_entry.edit` |
| 导航至此页 | Sidebar 隐藏需要 `finance.journal_entry.view` |

### 列字段

| 列 | 数据来源 |
|----|---------|
| JE 编号 | `journal_entry.entry_number` |
| 日期 | `journal_entry.entry_date` |
| 会计期间 | `accounting_period.name`（JOIN） |
| 摘要 | `journal_entry.description` |
| 类型 | `journal_entry.journal_type` |
| 金额（借方） | `SUM(journal_entry_line.debit)` |
| 状态 | `journal_entry.status`（彩色标签） |

### 状态标签颜色

| 状态 | 颜色 |
|------|------|
| draft | 灰色 |
| pending_approval | 琥珀色 |
| posted | 绿色 |
| reversed | 蓝色 |
| rejected | 红色 |

### API 函数
```ts
getJournalEntries(params?: {
  status?: string;
  search?: string;
  page?: number;      // 0-based
  pageSize?: number;  // 默认 20
}): Promise<{ entries: JournalEntry[]; total: number }>
```

---

## 核心数据库表（GL 相关）

详细 DDL 见 `docs/database/01_schema.md`。

| 表名 | 说明 |
|------|------|
| `gl_account` | 科目表主表 |
| `accounting_period` | 会计期间 |
| `journal_entry` | 凭证表头 |
| `journal_entry_line` | 凭证明细行 |
| `journal_entry_attachment` | 凭证附件 |
| `journal_entry_edit_log` | 修改审计追踪 |
| `account_balance` | VIEW：按科目汇总已过账余额 |

---

## 业务规则（Business Rules）

| 规则 | 说明 |
|------|------|
| BR-F1 | 过账前借贷必须平衡（精度 0.005） |
| BR-F2 | 每行借方和贷方不能同时有值（CHECK 约束） |
| BR-F3 | 只有 `is_postable=true` 的科目才能记账 |
| BR-F4 | 凭证日期必须落在某个 `status='open'` 的会计期间内 |
| BR-F5 | 过账是单向的（draft → posted，不可撤销，只能反冲） |
| BR-F6 | 反冲凭证自动过账，原凭证状态变为 `reversed` |
| BR-F7 | 关闭会计期间前，该期间内不能有 draft 状态的凭证 |
| BR-F8 | 科目的父科目链不能形成环路（`updateAccount` 在更新 `parent_id` 前检测并阻止循环引用） |

---

## Finance 审计日志

所有财务模块的变更操作均会被记录到 `finance_audit_log` 表，包括科目的创建与修改、凭证的全生命周期操作、会计期间的开关、以及附件的上传与删除。

详见 `docs/modules/08_finance-audit-log.md`。

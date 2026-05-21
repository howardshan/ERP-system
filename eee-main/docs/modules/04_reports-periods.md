# 模块 04：报表 & 会计期间

---

## 1. 试算平衡表（Trial Balance）

**路由**: `trial-balance`  
**文件**: `src/pages/ReportsAndPeriods.tsx`（`TrialBalance` 组件）  
**完整路径**: `eee-main/src/pages/ReportsAndPeriods.tsx`

### 功能
- 展示所有启用科目的累计借方、贷方和余额
- 数据来源：`account_balance` VIEW（只含 `status='posted'` 的凭证行）
- 列字段：科目代码、科目名称、科目类型、累计借方、累计贷方、余额
- 底部显示借贷合计（平衡验证）

### 数据来源
```ts
getTrialBalance(): Promise<GlAccount[]>
// 查询 account_balance VIEW，filter: is_active = true，ORDER BY account_code
```

### 关键字段
```ts
interface GlAccount {
  account_code: string;
  name: string;
  account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  total_debit: number;    // 累计借方（所有已过账行）
  total_credit: number;   // 累计贷方（所有已过账行）
  balance: number;        // 自然余额（遵循借贷方向约定）
}
```

### 余额符号约定
- **资产 / 费用**：余额 = 累计借 − 累计贷（借方正常）
- **负债 / 权益 / 收入**：余额 = 累计贷 − 累计借（贷方正常）

### 待开发
- [ ] 按期间筛选（目前为全期间累计）
- [ ] 导出 Excel / PDF
- [ ] 比较期间（本期 vs 上期）

---

## 2. 会计期间管理（Accounting Periods）

**路由**: `periods`（`reports` 也路由到此）  
**文件**: `src/pages/ReportsAndPeriods.tsx`（`AccountingPeriods` 组件）  
**完整路径**: `eee-main/src/pages/ReportsAndPeriods.tsx`

### 功能
- 展示所有会计期间（按 `start_date` 倒序）
- 新建期间（日期、名称、财年）
- 修改期间状态：`future → open → soft_closed → closed`
- 快速操作：Open / Close 按钮
- 错误横幅：当凭证保存失败因"No open accounting period"时，展示跳转至本页的按钮

### 权限控制
| 元素 | 所需权限 |
|------|---------|
| New Period 按钮 | `finance.accounting_periods.close` 或 `.open` 之一 |
| Close Period 按钮 | `finance.accounting_periods.close` |
| Reopen / Open Period 按钮 | `finance.accounting_periods.open` |
| 导航至此页 | Sidebar 需要 `finance.accounting_periods.view` |

### 状态流

```
future ──[Open]──→ open ──[Close]──→ closed
                     │
                  [Soft Close]──→ soft_closed ──[Close]──→ closed
```

| 状态 | 说明 |
|------|------|
| `future` | 尚未到期，不可记账 |
| `open` | 当前开放，可新建/编辑凭证 |
| `soft_closed` | 软关闭，仅供管理员调整 |
| `closed` | 硬关闭，任何人无法在此期间记账 |

### 关闭限制
- 关闭前：该期间内不能有 `status='draft'` 的凭证
- 违反则 RPC 抛出异常，前端显示错误提示

### 2026 年种子数据
Migration `20260517000004_seed_2026_periods.sql` 预置了 2026 年 1–12 月共 12 个 `status='open'` 的期间。

### API 函数
```ts
getAccountingPeriods(): Promise<AccountingPeriod[]>
createAccountingPeriod(params): Promise<number>   // RPC: create_accounting_period
openAccountingPeriod(id): Promise<void>            // RPC: open_accounting_period
closeAccountingPeriod(id): Promise<void>           // RPC: close_accounting_period
```

---

## 数据库表

### `accounting_period`

| 列名 | 类型 | 说明 |
|------|------|------|
| `id` | bigint PK | |
| `name` | text UNIQUE | 显示名，如 "JAN 2026" |
| `start_date` | date | 期间开始日 |
| `end_date` | date | 期间结束日，≥ start_date |
| `fiscal_year` | integer | 财年（如 2026） |
| `status` | text | future / open / soft_closed / closed |
| `created_at` | timestamptz | |
| `created_by` | uuid | |

### `period_status_history`（期间状态变更审计）

| 列名 | 类型 | 说明 |
|------|------|------|
| `id` | bigint PK | |
| `accounting_period_id` | bigint | → accounting_period.id |
| `from_status` | text | 变更前状态 |
| `to_status` | text | 变更后状态 |
| `reason` | text | 变更原因（可选） |
| `changed_at` | timestamptz | |
| `changed_by` | uuid | → auth.users |

---

## TypeScript 类型

```ts
interface AccountingPeriod {
  id: number;
  name: string;
  start_date: string;      // ISO date string
  end_date: string;        // ISO date string
  fiscal_year: number;
  status: 'future' | 'open' | 'soft_closed' | 'closed';
  created_at: string;
}
```

---

## 规划中的报表

以下报表未开发，但所需数据已在数据库中存在：

### 利润表（P&L）
- 收入科目 `balance` 之和 = 总营收
- 费用科目 `balance` 之和 = 总成本
- 净利润 = 总营收 − 总费用
- 支持按期间筛选

### 资产负债表（Balance Sheet）
- 资产 = 负债 + 权益（复式记账恒等式）
- 支持指定日期截止

### 现金流量表
- 需要对科目打标签（经营/投资/融资活动）
- 目前 `gl_account` 无此字段，需扩展

### 账龄分析（AP/AR Aging）
- 基于 `ap_invoice` / `ar_invoice` 的 `due_date` 计算逾期天数
- 分桶：Current / 1-30 / 31-60 / 61-90 / 90+ 天

# 模块 02：审批工作流（Approval Workflow）

---

## 概述

记账凭证采用**两层审批机制**：
1. Staff Accountant 填写凭证 → 提交（Submit）
2. 具有相应权限的 Supervisor/Manager 审批（Approve）或拒绝（Reject）

不同职级对应不同的单笔审批金额上限，金额越大要求权级越高。

---

## 凭证状态机

```
draft
  │
  ├── [Submit for Approval] ──→ pending_approval
  │                                  │
  │                          ┌───────┴───────┐
  │                      [Approve]       [Reject]
  │                          │               │
  │                        posted        rejected
  │                                          │
  │                                   [重新 Submit]
  │                                          │
  └──────────────────────────────────────────┘

posted ──[Reverse Entry]──→ reversed（新建反冲凭证，自动 posted）
```

### 状态说明

| 状态 | 说明 |
|------|------|
| `draft` | 草稿，可编辑，可提交 |
| `pending_approval` | 已提交，等待审批，**只读** |
| `posted` | 已审批过账，不可修改，只可反冲 |
| `reversed` | 已被反冲，只读历史记录 |
| `rejected` | 被拒绝，可编辑修改后重新提交 |

---

## 审批层级（Approval Tier）

存储在 `approval_tier` 表。默认 4 个层级：

| name | label | approval_limit | 说明 |
|------|-------|---------------|------|
| `manager` | Manager | $5,000 | 单笔不超过 $5,000 |
| `director` | Director | $10,000 | 单笔不超过 $10,000 |
| `cfo` | CFO | $100,000 | 单笔不超过 $100,000 |
| `ceo` | CEO | NULL | 无限额 |

`approval_limit = NULL` 表示无上限。

### 自动匹配所需层级

提交凭证时（`submit_journal_entry()`），系统自动计算所需最低审批层级：

```sql
SELECT id FROM approval_tier
WHERE approval_limit IS NULL OR approval_limit >= v_debit
ORDER BY COALESCE(approval_limit, 999999999) ASC
LIMIT 1;
```

例：凭证金额 $7,000 → 需要 Director 及以上（Manager 上限 $5,000 不够）

---

## 用户权限绑定（User Profile）

`user_profile` 表将 Supabase Auth 用户与审批层级绑定：

```ts
interface UserProfile {
  user_id: string;           // FK → auth.users.id
  display_name: string | null;
  email: string | null;
  approval_tier_id: number | null;  // FK → approval_tier.id
  tier?: ApprovalTier;       // JOIN 查询时附带
}
```

若用户无 `user_profile` 记录或 `approval_tier_id` 为 null，审批函数允许操作（开发模式兼容，生产应锁定）。

---

## 审批队列页（ApprovalsQueue）

**路由**: `approvals`  
**文件**: `src/pages/ApprovalsQueue.tsx`  
**完整路径**: `eee-main/src/pages/ApprovalsQueue.tsx`

### 功能
- 展示所有 `status = 'pending_approval'` 的凭证
- 顶部显示当前系统内已配置的审批层级及金额上限
- 每条记录显示：JE 编号、日期、摘要、金额、所需层级
- 操作按钮：
  - **Approve** — 调用 `approveJournalEntry()`，凭证变为 `posted`
  - **Reject** — 弹出拒绝理由输入框，调用 `rejectJournalEntry(id, reason)`

### 权限控制
- **整个页面**：需要 `finance.journal_entry.approve`。无权限时显示 `ShieldOff` 拒绝画面（不跳转，原地显示提示）
- **Approve 按钮**：若当前用户的 `approval_limit` 不为 null 且凭证金额超过上限，按钮变为禁用状态，标注 "Over Limit ($X,XXX)"
- **Sidebar 中的 Approvals 导航项**：需要 `finance.journal_entry.view`（任何能查看 JE 的用户均可访问审批队列）

### 侧边栏徽章
`Sidebar` 从 `DashboardLayout` 接收 `pendingApprovalCount`，在 Approvals 导航项右侧显示琥珀色数字徽章，每次导航切换时刷新计数。

### API 函数
```ts
getPendingApprovals(): Promise<JournalEntry[]>
approveJournalEntry(id: number): Promise<void>
rejectJournalEntry(id: number, reason: string): Promise<void>
```

---

## 审批设置页（ApprovalSettings）

**路由**: `approval-settings`  
**文件**: `src/pages/ApprovalSettings.tsx`  
**完整路径**: `eee-main/src/pages/ApprovalSettings.tsx`  
**位置**: 侧边栏底部（设置区域）

### 功能
- 展示所有审批层级（来自 `approval_tier` 表）
- 行内编辑：修改 `label`（显示名）和 `approval_limit`（金额上限，NULL = 无限）
- 新增层级
- 删除层级
- 展示所有用户及其当前审批层级，支持修改绑定

### API 函数
```ts
getApprovalTiers(): Promise<ApprovalTier[]>
updateApprovalTier(id, updates): Promise<void>
createApprovalTier(tier): Promise<void>
deleteApprovalTier(id): Promise<void>
getUserProfiles(): Promise<UserProfile[]>
upsertUserProfile(profile): Promise<void>
```

---

## 数据库表

### `approval_tier`

| 列名 | 类型 | 说明 |
|------|------|------|
| `id` | serial PK | |
| `name` | text UNIQUE | 内部标识（manager/director/cfo/ceo） |
| `label` | text | 显示名称 |
| `approval_limit` | numeric(18,2) | NULL = 无上限 |
| `sort_order` | int | 排序权重 |
| `created_at` | timestamptz | |

### `user_profile`

| 列名 | 类型 | 说明 |
|------|------|------|
| `user_id` | uuid PK | → auth.users.id，CASCADE DELETE |
| `display_name` | text | |
| `email` | text | |
| `approval_tier_id` | int | → approval_tier.id |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### `journal_entry`（审批相关字段）

| 列名 | 类型 | 说明 |
|------|------|------|
| `status` | text | 扩展为含 pending_approval / rejected |
| `submitted_at` | timestamptz | 提交时间 |
| `submitted_by` | uuid | 提交人 → auth.users |
| `approved_at` | timestamptz | 审批时间 |
| `approved_by` | uuid | 审批人 → auth.users |
| `rejected_at` | timestamptz | 拒绝时间 |
| `rejected_by` | uuid | 拒绝人 → auth.users |
| `rejection_reason` | text | 拒绝原因 |
| `required_tier_id` | int | 所需最低审批层级 → approval_tier |

---

## RPC 函数汇总

### `submit_journal_entry(p_entry_id)`
- 前置检查：`status IN ('draft','rejected')`，≥2行，借贷平衡，所有科目可记账
- 计算并写入 `required_tier_id`
- 更新 `status = 'pending_approval'`
- 写入 edit log：`action='submitted'`

### `approve_journal_entry(p_entry_id)`
- 前置检查：`status = 'pending_approval'`，会计期间 open
- 读取 approver 的 `approval_limit`，若金额超限则抛出异常
- 更新 `status = 'posted'`，写入 `approved_at/by`，同时写入 `posted_at/by`
- 写入 edit log：`action='approved'`

### `reject_journal_entry(p_entry_id, p_reason)`
- 前置检查：`status = 'pending_approval'`
- 更新 `status = 'rejected'`，写入 `rejected_at/by`，`rejection_reason = p_reason`
- 写入 edit log：`action='rejected'`

---

## 权限与审批限额关系

审批权限通过 `user_permission_grant` 的 `approval_limit` 字段实现，与旧 `approval_tier` / `user_profile` 体系并存：

| 方式 | 说明 |
|------|------|
| `approval_tier`（旧） | 预定义层级（Manager/Director/CFO/CEO），在 `approve_journal_entry` RPC 中通过 `user_profile.approval_tier_id` 检查 |
| `user_permission_grant.approval_limit`（新） | 在 `PermissionContext` 中读取，前端在 ApprovalsQueue 中显示/禁用 Approve 按钮 |

前端判断逻辑（`ApprovalsQueue.tsx`）：
```tsx
const myLimit = approvalLimit('finance', 'journal_entry', 'approve'); // null = 无限
const overLimit = myLimit !== null && entryAmount > myLimit;
// overLimit 为 true 时按钮禁用，显示 "Over Limit ($X,XXX)"
```

## 待开发

- [ ] **邮件/站内通知**：凭证提交/审批/拒绝后向相关人员发送通知
- [ ] **RLS 数据库层拦截**：目前后端 `approve_journal_entry` RPC 使用 `user_profile.approval_tier_id` 检查，可考虑统一到 `user_permission_grant` 体系

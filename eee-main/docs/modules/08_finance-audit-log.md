# 模块 08：Finance Audit Log（财务审计日志）

记录财务模块所有变更操作的完整审计追踪，供财务管理员查阅。

---

## 模块入口

**路由**: `activeScreen = 'audit-log'`（Finance 模块内子页面）  
**文件**: `src/pages/finance/AuditLog.tsx`  
**Sidebar 位置**: Finance 模块 → Administration 分区 → Audit Log（ScrollText 图标）

**必需权限**: `finance.audit_log.view`（无权限时 Sidebar 不渲染该导航项）

---

## 页面功能

### 筛选与搜索

| 控件 | 说明 |
|------|------|
| Entity Type 下拉 | 按实体类型筛选：All / Journal Entry / Chart of Accounts / Accounting Period / Attachment |
| 搜索框 | 延迟 350ms 搜索，匹配 `description`（摘要）和 `entry_number`（业务引用编号） |

搜索框的 placeholder 文字根据选中的 Entity Type 动态变化，提示可搜索的典型值（如 JE 编号、科目代码等）。

### 列表列

| 列 | 说明 |
|----|------|
| Time（时间） | 相对时间（如"3 minutes ago"）+ 悬停显示绝对时间 |
| Who（操作人） | `actor_name` |
| Action（操作） | 操作类型徽章（颜色区分，见下表） |
| Entity（实体类型） | `entity_type` |
| Reference（引用） | `entry_number`（人类可读编号）+ `entity_id`（稳定 DB 主键） |
| Summary（摘要） | `description`（人类可读操作摘要） |

### Action 徽章颜色

| Action | 颜色 |
|--------|------|
| `create` | 绿色 |
| `edit` | 蓝色 |
| `delete` | 红色 |
| `post` | 绿色 |
| `submit` | 琥珀色 |
| `approve` | 绿色 |
| `reject` | 红色 |
| `reverse` | 紫色 |
| `open` | 青色 |
| `close` | 橙色 |

### 展开行：Diff 面板

点击任意行展开，显示 DiffPanel：

- **变更字段**：Before（删除线灰色） | After（红色高亮）
- **Journal Entry 明细行对比**：左右并排 before/after，变更单元格以红色标注
- **Create 操作**：仅显示新建后的字段
- **Delete 操作**：显示被删除的字段（红色）

---

## `entry_number` 与 `entity_id` 的区别

| 字段 | 含义 | 示例 |
|------|------|------|
| `entry_number` | 人类可读的业务引用编号，可搜索 | `JE-2026-000001`、`1100`、`JAN 2026`、`invoice.pdf` |
| `entity_id` | 稳定的数据库主键（字符串化） | `"42"`（gl_account.id=42） |

**关键设计**：`entity_id` 始终使用数据库主键，即使科目代码（`account_code`）被修改，`entity_id` 也不会变，保证审计记录可靠追溯。搜索"1100"会通过 `entry_number` 匹配到该科目的所有历史日志。

### Reference 字段按实体类型的值

| `entity_type` | `entry_number` 存储内容 | `entity_id` 存储内容 |
|---------------|----------------------|---------------------|
| `journal_entry` | JE 编号（如 `JE-2026-000001`） | `journal_entry.id`（bigint） |
| `chart_of_accounts` | 科目代码（如 `1100`） | `gl_account.id`（bigint） |
| `accounting_period` | 期间名称（如 `JAN 2026`） | `accounting_period.id`（bigint） |
| `attachment` | 文件名（如 `receipt.pdf`） | `journal_entry_attachment.id`（bigint） |

---

## 已记录的操作与触发来源

所有审计写入通过 `src/services/api.ts` 中的 `logFinanceAction()` 函数执行（fire-and-forget，失败不中断主操作）。

| 触发函数 | `entity_type` | `action` |
|---------|--------------|---------|
| `createAccount()` | `chart_of_accounts` | `create` |
| `updateAccount()` | `chart_of_accounts` | `edit` |
| `createJournalEntry()` | `journal_entry` | `create` |
| `createJeShell()` | `journal_entry` | `create` |
| `updateJeDraft()` | `journal_entry` | `edit`（含 before/after 快照及 diff） |
| `postJournalEntry()` | `journal_entry` | `post` |
| `reverseJournalEntry()` | `journal_entry` | `reverse` |
| `submitJournalEntry()` | `journal_entry` | `submit` |
| `approveJournalEntry()` | `journal_entry` | `approve` |
| `rejectJournalEntry()` | `journal_entry` | `reject` |
| `createAccountingPeriod()` | `accounting_period` | `create` |
| `openAccountingPeriod()` | `accounting_period` | `open` |
| `closeAccountingPeriod()` | `accounting_period` | `close` |
| `uploadAttachment()` | `attachment` | `create` |
| `deleteAttachment()` | `attachment` | `delete` |

**`updateJeDraft` 特殊处理**：执行前获取 before-snapshot（同步），执行后异步获取 after-snapshot，计算 diff 并写入审计记录。

---

## 数据库表结构（`finance_audit_log`）

详见 `docs/database/03_migrations-and-edge-functions.md` M-018 节。

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | bigserial PK | 自增主键 |
| `entity_type` | text | `journal_entry` / `chart_of_accounts` / `accounting_period` / `attachment` |
| `entity_id` | text | 稳定的 DB 主键（字符串化） |
| `action` | text | `create` / `edit` / `delete` / `post` / `submit` / `approve` / `reject` / `reverse` / `open` / `close` |
| `actor_auth_id` | uuid | 操作人的 Supabase auth UUID |
| `actor_name` | text | 操作人姓名（冗余存储） |
| `changed_at` | timestamptz | 操作时间（默认 `now()`） |
| `before_snapshot` | jsonb | 操作前完整记录快照 |
| `after_snapshot` | jsonb | 操作后完整记录快照 |
| `diff` | jsonb | 变更字段的前后对比 |
| `entry_number` | text | 人类可读的业务引用（可搜索） |
| `description` | text | 人类可读的操作摘要 |

**RLS 策略**：`authenticated` 角色可 INSERT（服务端写入）和 SELECT（前端读取）。

---

## Sidebar 导航

`src/components/layout/Sidebar.tsx` 在 Finance 模块底部新增 **Administration** 分区：

```
── Administration ────
  Audit Log                              （需 finance.audit_log.view）
```

该导航项使用 `ScrollText` 图标，仅当用户拥有 `finance.audit_log.view` 时渲染。

---

## 权限结构

```typescript
// src/lib/permissionStructure.ts — finance 模块下新增
audit_log: {
  label: 'Audit Log',
  permissions: [
    { id: 'view', label: 'View Audit Log', prereq: null }
  ]
}
```

---

## 相关 Migrations

| Migration | 说明 |
|-----------|------|
| M-018 (`20260518000010_finance_audit_log.sql`) | 创建 `finance_audit_log` 表，RLS 策略，为 ysha@smu.edu 授予 `finance.audit_log.view` |

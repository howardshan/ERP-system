# 模块 06：用户管理与权限系统（Users & Authentication）

---

## 模块入口

`activeModule = 'auth'` → `src/pages/auth/UserManagement.tsx`

---

## 三视图结构

### 视图一：By User（按用户）
- 展示所有 `erp_user` 记录（通过 `list_erp_users()` RPC 获取）
- 列：姓名、邮箱、部门、上级领导、已授权模块（标签）、状态
- 点击用户行 → 进入 `UserDetail`
- **权限控制**：需要 `auth.users.view` 才能看到按钮（Add User (IT) 需要 `auth.users.create`）

### 视图二：By Permission（按权限）
- 左侧树：Module → Resource → Permission 三级折叠导航
  - 点击模块名（如 Financial Management）可折叠/展开整个模块
  - 点击资源名（如 Journal Entries）可折叠/展开该资源下的权限列表
  - 默认全部展开，状态用 `▼` / `▶` 箭头指示
- 右侧：选中权限的持有人列表，可添加/移除用户
- 权限结构定义在 `src/lib/permissionStructure.ts`
- **权限控制**：Add User 和移除（×）按钮需要 `auth.roles.manage`

### 视图三：IT（IT 管理）
- 创建新的 Supabase Auth 账号（邮箱 + 密码 + 姓名）
- 调用 Edge Function `create-auth-user`（EF-002）
- 创建后触发器自动生成 `erp_user` 记录，再到 By User 视图分配权限
- **权限控制**：整个面板需要 `auth.users.create`，无权限时显示 `ShieldOff` 拒绝画面

---

## 权限上下文（PermissionContext）

**文件**: `src/contexts/PermissionContext.tsx`

所有前端权限检查通过 `usePermissions()` hook 获取，在用户登录后由 `PermissionProvider` 一次性加载并缓存：

```tsx
interface PermissionContextValue {
  erpUser: ErpUser | null;
  grants: UserPermissionGrant[];      // 当前用户的所有权限授权记录
  moduleAccess: string[];             // 当前用户可访问的模块列表
  loading: boolean;
  can: (module: string, resource: string, permission: string) => boolean;
  canAccessModule: (module: string) => boolean;
  approvalLimit: (module: string, resource: string, permission: string) => number | null;
  reload: () => Promise<void>;        // 修改自己权限后调用刷新
}
```

**加载流程**：
1. 调用 `list_erp_users()` RPC，找到与当前 `auth_user_id` 匹配的 `erp_user`
2. 并行查询 `user_module_access`（模块访问权） + `user_permission_grant`（细粒度权限）
3. 存入 Context，全局同步访问

**使用方式**：
```tsx
const { can, approvalLimit } = usePermissions();
if (can('finance', 'journal_entry', 'create')) { /* 显示新建按钮 */ }
const limit = approvalLimit('finance', 'journal_entry', 'approve'); // null = 无限
```

---

## 权限结构（`permissionStructure.ts`）

```typescript
PERMISSION_STRUCTURE = {
  finance: {
    label: 'Financial Management',
    resources: {
      module_permissions: { permissions: [manage] },
      journal_entry:      { permissions: [view, create, edit, delete, approve(hasLimit)] },
      chart_of_accounts:  { permissions: [view, create, edit, delete] },
      accounting_periods: { permissions: [view, close, open] },
    }
  },
  workflow: {
    label: 'Workflow Studio',
    resources: {
      module_permissions: { permissions: [manage] },
      workflow:           { permissions: [view, create, edit, delete, execute] },
    }
  },
  warehouse:  { resources: { module_permissions: { ... }, inventory: { ... } } },
  sales:      { resources: { module_permissions: { ... }, sales_order: { ... } } },
  production: { resources: { module_permissions: { ... }, production_order: { ... } } },
  auth: {
    label: 'Users & Authentication',
    resources: {
      module_permissions: { permissions: [manage] },
      users:              { permissions: [view, create, edit, delete, reset_password] },
      roles:              { permissions: [view, manage] },
      departments:        { permissions: [view, manage] },
    }
  },
}
```

**注意**：
- 每个模块都有 `module_permissions.manage`：允许管理该模块内其他用户的权限
- `prereq`：前置依赖（如 `create` 需要先有 `view`）
- `hasLimit`：`approve` 权限可设置 `approval_limit`（金额上限），`null` = 无限

---

## 前端权限执行映射

### Finance 模块 Sidebar（`src/components/layout/Sidebar.tsx`）

| 导航项 | 所需权限 |
|--------|---------|
| Chart of Accounts | `finance.chart_of_accounts.view` |
| New Journal Entry | `finance.journal_entry.create` |
| Journal Entries | `finance.journal_entry.view` |
| Approvals | `finance.journal_entry.view`（有权看 JE 即可访问审批队列） |
| Trial Balance | `finance.journal_entry.view` |
| Accounting Periods | `finance.accounting_periods.view` |

无权限时对应导航项**完全不渲染**（而非灰化）。

### 各页面权限门

| 页面/组件 | 元素 | 所需权限 |
|----------|------|---------|
| `JournalEntriesList` | New Entry 按钮 | `finance.journal_entry.create` |
| `JournalEntriesList` | 行图标：铅笔（可编辑）vs 眼睛（只读） | 铅笔需要 `finance.journal_entry.edit` |
| `JournalEntryForm` | Save Draft / Submit / Add Line | `finance.journal_entry.create` 或 `.edit` |
| `JournalEntryForm` | Reverse Entry 按钮 | `finance.journal_entry.edit` |
| `ChartOfAccounts` | Create Account 按钮 | `finance.chart_of_accounts.create` |
| `ChartOfAccounts` | 行内编辑铅笔 | `finance.chart_of_accounts.edit` |
| `ApprovalsQueue` | 整个页面 | `finance.journal_entry.approve`（否则显示 ShieldOff 拒绝画面） |
| `ApprovalsQueue` | Approve 按钮 | 金额超 `approval_limit` 时禁用并标注"Over Limit" |
| `AccountingPeriods` | New Period 按钮 | `finance.accounting_periods.close` 或 `.open` 之一 |
| `AccountingPeriods` | Close Period 按钮 | `finance.accounting_periods.close` |
| `AccountingPeriods` | Reopen / Open Period 按钮 | `finance.accounting_periods.open` |
| `WorkflowList` | New Workflow 按钮 | `workflow.workflow.create` |
| `WorkflowList` | Edit 按钮 | `workflow.workflow.edit` |
| `WorkflowList` | Pause/Activate 按钮 | `workflow.workflow.execute` |
| `WorkflowList` | Delete 按钮 | `workflow.workflow.delete` |
| `PermissionBrowser` | Add User 按钮 | `auth.roles.manage` |
| `PermissionBrowser` | 移除（×）按钮 | `auth.roles.manage` |
| `ITPanel` | 整个面板 | `auth.users.create` |

---

## UserDetail（单用户权限编辑）

**文件**: `src/pages/auth/UserDetail.tsx`

**左栏**：模块开关列表（`user_module_access` 表）
- 拨动开关 → 勾选该模块 → 右侧显示该模块的权限矩阵

**右栏**：选中模块的权限矩阵
- 每个 Resource 一行，显示 checkboxes
- 前置条件不满足时 checkbox 灰化
- `approve` 权限勾选后显示金额输入框（存入 `approval_limit`）

**其他操作**（需对应权限）：
- **Edit Profile**（姓名/部门/上级）：`auth.users.edit`
- **Deactivate / Activate**：`auth.users.edit`，两次点击确认（Tauri 不支持 `window.confirm()`）
- **Reset Password**：`auth.users.reset_password`，仅当用户已绑定 `auth_user_id` 时显示，调用 EF-003

**保存机制**：`handleSave()` 批量提交：
1. `updateUser()` — 更新 `full_name | department | manager_id | is_active`
2. `setModuleAccess(userId, moduleIds)` — delete + insert 整批
3. 对每个变更的权限调用 `setPermission()`

---

## 数据库层

| 表 / 函数 | 说明 |
|-----------|------|
| `erp_user` | ERP 用户档案，通过 `auth_user_id` 与 Supabase Auth 关联 |
| `user_module_access` | 用户可访问的模块列表（`user_id` + `module_id`） |
| `user_permission_grant` | 细粒度权限（`module_id` / `resource` / `permission` + `approval_limit`） |
| `list_erp_users()` | SECURITY DEFINER RPC，以 `erp_user` 为主表 LEFT JOIN `auth.users` |
| Edge Function `create-auth-user`（EF-002） | IT 管理员创建 Auth 用户，需 service role key，`email_confirm: true` |
| Edge Function `reset-user-password`（EF-003） | 重置指定用户密码，调用 `admin.updateUserById()`，验证密码 ≥ 6 字符 |

---

## Auth 登录流程

```
App 启动
  │
  ▼
supabase.auth.getSession()  ──── 无 session ──→ LoginPage（邮箱 + 密码，无注册入口）
  │                                               │
  │ 有 session                                    │ signInWithPassword()
  ▼                                               │
PermissionProvider 加载当前用户权限  ←────────────┘
  │
  ├─ 调用 list_erp_users() 找到对应 erp_user
  ├─ 加载 user_module_access + user_permission_grant
  └─ 注入 PermissionContext，全局 can() 同步可用
```

---

## Edge Functions 汇总

| 函数名 | 触发方式 | 关键逻辑 |
|--------|---------|---------|
| `create-auth-user`（EF-002） | POST，IT 面板调用 | 验证 JWT → `adminClient.auth.admin.createUser()`，`email_confirm: true` |
| `reset-user-password`（EF-003） | POST，UserDetail 调用 | 验证 JWT + 密码 ≥ 6 位 → `adminClient.auth.admin.updateUserById(authUserId, { password })` |

---

## Tauri 约束说明

- `window.confirm()` 在 Tauri v2 WKWebView 中始终返回 false，所有删除/危险操作使用**两次点击确认**（第一次点击变红显示"Confirm?"，3 秒内再次点击执行）
- 密码重置通过 Edge Function 服务端完成，不在前端直接调用 Supabase Admin API

---

## 已知 Auth 问题及修复

| 问题 | 原因 | 修复 |
|------|------|------|
| 登录报 "Database error querying schema" | Supabase Dashboard 创建的用户 `confirmation_token` 等字段为 NULL，GoTrue Go 代码扫描时 panic | 执行 `UPDATE auth.users SET confirmation_token = COALESCE(confirmation_token, ''), ...` 将所有 9 个 text 字段从 NULL 改为空字符串 |
| `list_erp_users()` 返回空 | M-010 原实现以 `auth.users` 为主表 LEFT JOIN `erp_user`，若 auth 账号为 0 则空 | M-011 改为以 `erp_user` 为主表 LEFT JOIN `auth.users` |

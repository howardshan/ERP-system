# 模块 06：用户管理与权限系统（Users & Authentication）

---

## 模块入口

`activeModule = 'auth'` → `src/pages/auth/UserManagement.tsx`

---

## 视图结构（四视图）

顶栏标签：**By User / By Permission / Add User / Activity Log**。其中 Add User、Activity Log 按权限显示。

### 视图一：By User（按用户）
- 展示所有 `erp_user` 记录（通过 `list_erp_users()` RPC 获取）
- 列：姓名、**Role（职位，来自 `erp_user.role`）**、部门、上级领导、已授权模块（标签）、状态
- **注意**：原"Email"列已重命名为"Role"，显示用户的职位/职称字段（`erp_user.role`），而非邮箱
- 点击用户行 → 进入 `UserDetail`
- **权限控制**：需要 `auth.users.view` 才能进入该模块

### 视图二：By Permission（按权限）
- 左侧树：Module → Resource → Permission 三级折叠导航
  - 点击模块名（如 Financial Management）可折叠/展开整个模块
  - 点击资源名（如 Journal Entries）可折叠/展开该资源下的权限列表
  - 默认全部展开，状态用 `▼` / `▶` 箭头指示
- 右侧：选中权限的持有人列表，可添加/移除用户
- 权限结构定义在 `src/lib/permissionStructure.ts`
- **权限控制**：Add User 和移除（×）按钮需要 `auth.roles.manage`

### 视图三：Add User（创建账户，原「IT」）
- 创建新的 Supabase Auth 账号（邮箱 + 密码 + 姓名）
- 调用 Edge Function `create-auth-user`（EF-002）
- 创建后触发器自动生成 `erp_user` 记录，再到 By User 视图分配权限
- **权限控制**：标签本身按 `auth.users.create` 显示；面板内部同样需要 `auth.users.create`，无权限时显示 `ShieldOff` 拒绝画面
- **变更**：标签由「IT」改名为「Add User」；原 By User 视图右上角那个独立的蓝色「Add User (IT)」按钮已删除——它与本标签是同一入口（都 `setView('it')`），属冗余

### 视图四：Activity Log（用户操作审计日志）
- 见下方「用户操作审计日志」章节。`UserAuditLog.tsx`，按 `auth.audit_log.view` 显示。

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
      audit_log:          { permissions: [view] },
    }
  },
  workflow: {
    label: 'Workflow Studio',
    resources: {
      module_permissions: { permissions: [manage] },
      workflow:           { permissions: [view, create, edit, delete, execute] },
    }
  },
  hr: {
    label: 'HR',
    resources: {
      module_permissions: { permissions: [manage] },
      employees:          { permissions: [view, edit] },
      audit_log:          { permissions: [manage] },
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
      audit_log:          { permissions: [view] },   // M-153 用户操作审计日志
    }
  },
}
```

**注意**：
- 每个模块都有 `module_permissions.manage`：允许管理该模块内其他用户的权限
- `prereq`：前置依赖（如 `create` 需要先有 `view`）
- `hasLimit`：`approve` 权限可设置 `approval_limit`（金额上限），`null` = 无限
- **M-147 / M-148（BR-Q80）产品主数据编辑权回归 QC**：`production.products` 收窄为只读 `view`；`qc` 新增 `products` 资源 `{view, create, edit, delete, export, import, view_log}`（Test Types 复用同一资源，不单拆）。`ProductManagement` / `TestTypesPage` 用 `module` 属性决定查 `production.*`（只读）还是 `qc.*`（可编辑）。产品/测试类型的 CRUD 与 Excel 导入写入 `qc_product_audit_log`，由 `qc.products.view_log` 门控查看。

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
| `UserManagement` | Add User 视图标签 | `auth.users.create`（原独立「Add User (IT)」按钮已删除，与此标签冗余） |
| `ProductManagement`（QC，`module="qc"`） | Add / Edit / Delete 按钮 | `qc.products.create` / `.edit` / `.delete` |
| `ProductManagement` | Export / Import 按钮 | `qc.products.export` / `.import` |
| `ProductManagement`（Production，`module="production"`） | 仅只读浏览（无新增/编辑/删除） | `production.products.view` |
| `ProductAuditLog` | 整个页面 | `qc.products.view_log`（否则 ShieldOff 拒绝画面） |
| `UserManagement` | Activity Log 视图标签 | `auth.audit_log.view` |
| `UserAuditLog` | 整个页面 | `auth.audit_log.view`（否则 ShieldOff 拒绝画面） |

---

## UserDetail（单用户权限编辑）

**文件**: `src/pages/auth/UserDetail.tsx`

> **注意**：员工档案编辑（姓名、职位/role、部门、上级）已迁移至 **HR 模块**（`src/pages/hr/HRModule.tsx`）。UserDetail 不再包含 Profile Information 卡片。

**当前包含功能**：
- **Module Access**：模块开关列表（`user_module_access` 表）
- **Permission Grants**：选中模块的细粒度权限矩阵
- **Account Status**：激活 / 停用账号
- **Reset Password**：重置指定用户密码

**左导航栏**：Account 面板（ShieldCheck 图标）+ 各模块级别面板。

**Module Access 面板**：
- 拨动开关 → 勾选该模块 → 右侧显示该模块的权限矩阵
- 每个 Resource 一行，显示 checkboxes
- 前置条件不满足时 checkbox 灰化
- `approve` 权限勾选后显示金额输入框（存入 `approval_limit`）

**其他操作**（需对应权限）：
- **Deactivate / Activate**：`auth.users.edit`，两次点击确认（Tauri 不支持 `window.confirm()`）
- **Reset Password**：`auth.users.reset_password`，仅当用户已绑定 `auth_user_id` 时显示，调用 EF-003

**保存机制**：`handleSave()` 批量提交：
1. `setModuleAccess(userId, moduleIds)` — delete + insert 整批
2. 对每个新增权限调用 `setPermission(..., true)`（upsert）
3. 对每个移除权限调用 `setPermission(..., false)`（delete）
4. 重新从 DB 拉取 `getUserPermissions(userId)` 验证每个待删权限已不存在；若仍存在则抛出错误（`"Failed to remove permission: module.resource.perm"`）
5. 无条件调用 `reloadPermissions()`，刷新整个 PermissionContext（不再以"是否编辑自己"为条件判断）

---

## 用户操作审计日志（M-153 / M-154）

记录账户与认证相关事件：登录/登出、账户创建、资料修改、启用/停用、重置密码、权限/模块访问变更。**已删除用户**当前为「停用」语义（`is_active=false`，行保留），所以其历史天然可查；表也按「将来可硬删」设计，删后记录仍可读。

**表 `auth_audit_log`（M-153）**：镜像 `finance_audit_log`，但**双主体**——同时记 `actor`（操作人）与 `target`（被操作的目标用户）。`actor_auth_id` / `target_auth_id` 均 `→ auth.users ON DELETE SET NULL`，并冗余 `actor_name` / `target_name` / `target_email`；`target_user_id`（erp_user.id）**不加 FK**（避免被 erp_user 的 `ON DELETE CASCADE` 影响）。`action ∈ {login_success, logout, create, edit_profile, activate, deactivate, reset_password, edit_permissions}`。

**写入与埋点**：`authApi.logAuthAction(...)`（fire-and-forget，actor 从当前会话解析）。埋点位置：
- `create` → [`ITPanel.tsx`](../../src/pages/auth/ITPanel.tsx)（创建成功后）
- `activate` / `deactivate`、`reset_password`、`edit_permissions`（一次保存写一条汇总，`diff` 存 granted/revoked/模块前后）→ [`UserDetail.tsx`](../../src/pages/auth/UserDetail.tsx)
- `login_success` → [`LoginPage.tsx`](../../src/pages/LoginPage.tsx)（登录成功后；**`login_failed` 不记**——未认证状态 RLS 会拒绝）
- `logout` → [`App.tsx`](../../src/App.tsx)（**在 `signOut` 之前**写，否则登出后 RLS 拒绝）

**浏览 UI**：[`UserAuditLog.tsx`](../../src/pages/auth/UserAuditLog.tsx)，作为 UserManagement 的**第 4 个视图「Activity Log」**，支持按**用户**（含停用用户）/ 操作类型筛选 + 搜索（actor/target/摘要），展开看 diff/快照。权限门 `auth.audit_log.view`。

**两年留存（M-154）**：`auth_audit_log_prune()` 删 2 年前的行；装了 `pg_cron` 则每日自动跑，否则手动/外部计划任务调用。

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
| `send-notification`（EF-004） | POST，DB 触发器调用 | 共享密钥 `x-notify-secret` 鉴权（`--no-verify-jwt`）→ 解析收件人 → SMTP2Go 发信。见下「通知系统」 |

---

## 通知系统（M-083，Phase 1 地基）

邮件通知的权限/偏好统一收归本模块管理。**通知偏好与操作权限解耦**(BR-N1):不复用只能表达布尔授权的 `user_permission_grant`,而用专门的三态模型。

**数据模型**:

| 表 | 作用 |
|---|---|
| `notification_type` | 通知类型目录;`module_id` 决定前端按模块分卡片(QC 卡片、Warehouse 卡片……) |
| `user_notification_setting` | 按用户三态:`admin_enabled`(管理员设定)/ `user_overridable`(是否允许账户自改)/ `user_enabled`(用户选择,NULL=回退 admin) |
| `notification_log` | 投递审计 |

**生效规则**(`notification_recipients` RPC 唯一来源):
`user_overridable AND user_enabled IS NOT NULL ? user_enabled : admin_enabled`。
→ 管理员开启且未授权自改 = 强制接收;授权自改 = 账户可在「账户设置」自行关闭。

**Phase 1(已完成)**:DB + Edge Function(EF-004)+ QC 测试结果通知打通(见 09_qc.md)。

### 管理员侧:通知设置面板(Phase 2,已完成)
- 位置:[UserDetail.tsx](../../src/pages/auth/UserDetail.tsx) 左栏「Account」下方新增 **Notifications** 入口(`selectedPanel === 'notifications'`)。
- 面板按 `notification_type.module_id` 分卡片(QC 卡片、未来 Warehouse 卡片……),每个通知类型两个勾选:
  - **Receive** → 写 `admin_enabled`
  - **User can self-manage** → 写 `user_overridable`
  - 两者**相互独立**:`admin_enabled=false + user_overridable=true` 表示「可选订阅」,用户可在账户设置主动打开(opt-in);`admin_enabled=true + user_overridable=false` 表示「强制接收」。
- 与现有 **Save Changes** 一起保存:`handleSave()` 末尾对 `localNotif` 逐条 `upsert`(`setUserNotificationSetting`),保存后回读刷新。
- 数据访问:[notificationApi.ts](../../src/services/notificationApi.ts)(`getNotificationTypes` / `getUserNotificationSettings` / `setUserNotificationSetting` / `effectiveEnabled` / `groupByModule`)。直连表(dev_all RLS),未走 RPC。
- **设计取舍**:通知**不进** `PERMISSION_STRUCTURE`(否则会变成授权勾选框),而是 UserDetail 内的专属面板。UserDetail 本身已被 auth 模块访问权限保护。

### 账户侧:账户设置页(Phase 2,已完成)
- 新页面 [AccountSettings.tsx](../../src/pages/AccountSettings.tsx),路由 `activeModule === 'account-settings'`(见 [App.tsx](../../src/App.tsx))。
- 入口:[HomePage.tsx](../../src/pages/HomePage.tsx) 头部用户名/邮箱块 + 齿轮图标,点击 `onNavigate('account-settings')`。
- 显示:账户名/邮箱/角色/部门;通知设置只列**该用户已有设置行**的类型,按模块分卡片。
  - `user_overridable=true` → 显示开关,切换写 `user_enabled`(即时保存、乐观更新)。
  - `user_overridable=false` → 只读,显示锁图标 + 当前生效状态(由 `effectiveEnabled` 计算)。
- 用户身份来自 `PermissionContext.erpUser`。

**Phase 3 可选**:① 增加 `auth.notifications.manage` 权限点细分「谁能配置他人通知」;② 给账户侧写操作加一个带鉴权的 RPC(目前 dev_all RLS 下前端可直写,仅靠 UI 限制可改字段)。

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
| 权限关闭后 UI 未即时反映 | `handleSave()` 原先只在 `erpUser?.id === userId` 时才调用 `reloadPermissions()`，条件判断偶发失效导致 PermissionContext 缓存陈旧 | 移除条件判断，任何 Save Changes 成功后均无条件调用 `reloadPermissions()` |
| 权限 delete 静默失败无报错 | Supabase JS 的 `.delete()` 若 0 行匹配时不返回 error，前端无法感知 | 保存后重新 `getUserPermissions()` 校验：若待删权限仍在 DB 中则抛出显式错误 |

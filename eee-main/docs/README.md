# ERP Financials — 项目总览

> 面向宠物食品制造业的桌面端 ERP 系统（Tauri v2 + React 19 + Supabase）

---

## 技术栈

| 层次 | 技术 |
|------|------|
| 桌面壳 | Tauri v2（Rust，使用系统 WebView） |
| 前端框架 | React 19 + TypeScript |
| 构建工具 | Vite 6 |
| UI 样式 | Tailwind CSS v4 |
| 图表 | Recharts |
| 图标 | Lucide-React |
| 动画 | Motion (Framer Motion) |
| 后端/数据库 | Supabase（PostgreSQL + Auth + Storage + Edge Functions） |
| ORM/客户端 | @supabase/supabase-js v2 |
| AI 功能（规划中） | @google/genai（Gemini） |

---

## 目录结构

```
eee-main/
├── src/
│   ├── App.tsx                    # 路由入口（手写 state machine）
│   ├── main.tsx                   # React DOM 挂载
│   ├── index.css                  # 全局样式
│   ├── vite-env.d.ts
│   ├── types/
│   │   ├── index.ts               # 财务模块 TypeScript 类型
│   │   └── auth.ts                # 用户权限模块类型（ErpUser, UserPermissionGrant 等）
│   ├── lib/
│   │   ├── supabase.ts            # Supabase 客户端实例
│   │   ├── utils.ts               # cn() 工具函数
│   │   └── permissionStructure.ts # 权限结构常量（前端定义）
│   ├── contexts/
│   │   └── PermissionContext.tsx  # 权限上下文（can() / approvalLimit() / reload()）
│   ├── services/
│   │   ├── api.ts                 # 财务模块 Supabase 调用
│   │   ├── authApi.ts             # 用户权限模块 Supabase 调用
│   │   └── workflowApi.ts         # Workflow Studio Supabase 调用
│   ├── components/
│   │   ├── layout/
│   │   │   ├── DashboardLayout.tsx  # 主布局（Sidebar + TopBar + 内容区）
│   │   │   ├── Sidebar.tsx          # 左侧导航
│   │   │   └── TopBar.tsx           # 顶部栏
│   │   └── ui/
│   │       └── Cards.tsx            # 通用卡片组件
│   └── pages/
│       ├── FinanceDashboard.tsx      # 仪表盘
│       ├── ChartOfAccounts.tsx       # 科目表
│       ├── JournalEntryForm.tsx      # 记账凭证（新建 + 编辑）
│       ├── JournalEntriesList.tsx    # 凭证列表
│       ├── ApprovalsQueue.tsx        # 审批队列
│       ├── ApprovalSettings.tsx      # 审批权限设置
│       ├── AccountsSubmodule.tsx     # AP / AR 占位页
│       ├── ReportsAndPeriods.tsx     # 试算表 + 会计期间
│       ├── LoginPage.tsx            # 登录页（Supabase Auth，仅登录，不可自助注册）
│       ├── WorkflowList.tsx         # Workflow Studio 列表页
│       ├── WorkflowBuilder.tsx      # Workflow Studio 画布编辑器
│       ├── DocsPage.tsx             # 文档阅读器（渲染 docs/*.md）
│       ├── auth/
│       │   ├── UserManagement.tsx   # 用户管理主页（By User / By Permission / IT 三视图）
│       │   ├── UserDetail.tsx       # 单用户权限编辑（模块开关 + 权限矩阵 + 账号状态）
│       │   ├── PermissionBrowser.tsx # 按权限查看持有人
│       │   └── ITPanel.tsx          # IT 管理：创建新 Auth 账号
│       ├── hr/
│       │   └── HRModule.tsx         # HR 模块：员工目录 + 员工档案编辑
│       └── finance/
│           └── AuditLog.tsx         # Finance 审计日志页
├── supabase/
│   ├── migrations/                  # 所有 DDL/DML，按顺序执行
│   └── functions/                   # Edge Functions
├── src-tauri/
│   ├── tauri.conf.json              # Tauri 配置（CSP、窗口、Bundle）
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs
│       └── lib.rs
└── docs/                            # ← 本文档所在目录
    ├── README.md                    # 本文件：总览与路由
    ├── modules/
    │   ├── 01_general-ledger.md     # GL：科目表 + 记账凭证
    │   ├── 02_approvals.md          # 审批工作流
    │   ├── 03_ap-ar.md              # 应付 / 应收
    │   ├── 04_reports-periods.md    # 报表 + 会计期间
    │   ├── 05_workflow-studio.md    # Workflow Studio
    │   ├── 06_users-auth.md         # 用户管理与权限系统
    │   ├── 07_hr.md                 # HR 模块：员工目录 + 档案编辑
    │   ├── 08_finance-audit-log.md  # Finance 审计日志
    │   ├── 09_qc.md                 # Quality Control：烘干后检验闭环
    │   ├── 10_packaging.md          # Packaging：合格车出库/包装
    │   ├── 11_warehouse-inventory.md # Warehouse & Inventory：库存基座
    │   └── 12_production-daily-report.md # Production 成型生产日报录入
    └── database/
        ├── 01_schema.md             # 完整数据库表结构
        ├── 02_rpc-functions.md      # 所有 RPC / View
        └── 03_migrations-and-edge-functions.md  # Migration + Edge Function 索引
```

---

## 路由结构（`src/App.tsx`）

系统使用**两层 state** 代替路由库：

- **第一层** `activeModule: string` — 当前所在大模块，由 `App.tsx` 管理
- **第二层** `activeScreen: string` — 模块内的子页面，由 `DashboardLayout` 管理

### 第一层：模块路由

| `activeModule` | 渲染内容 | 文件路径 | 状态 |
|----------------|---------|---------|------|
| `home` | `HomePage` | `src/pages/HomePage.tsx` | ✅ 已完成（模块卡片按 `canAccessModule()` 过滤，无访问权限则不显示） |
| `finance` | `DashboardLayout` + 财务子页面 | `src/components/layout/DashboardLayout.tsx` | ✅ 已完成 |
| `workflow` | `WorkflowModule` → `WorkflowList` / `WorkflowBuilder` | `src/pages/WorkflowList.tsx`, `src/pages/WorkflowBuilder.tsx` | ✅ 已完成（执行引擎待开发） |
| `warehouse` | `WarehouseModule` → Overview / Items / Locations | `src/pages/warehouse/WarehouseModule.tsx` | 🚧 Sprint 0（物料 CRUD + 7 库区只读 + QC↔item 关联），见 `docs/modules/11_warehouse-inventory.md` |
| `sales` | `ModulePlaceholder` | `src/App.tsx`（内联） | 🔲 规划中 |
| `production` | `ModulePlaceholder` | `src/App.tsx`（内联） | 🔲 规划中 |
| `auth` | `UserManagement` | `src/pages/auth/UserManagement.tsx` | ✅ 已完成 |
| `hr` | `HRModule` | `src/pages/hr/HRModule.tsx` | ✅ 已完成 |
| `qc` | `QualityControlModule` | `src/pages/qc/QualityControlModule.tsx` | ✅ 已完成（Phase 1 MVP，移植自 qc-demo） |
| `docs` | `DocsPage` | `src/pages/DocsPage.tsx` | ✅ 已完成 |

### Workflow 模块内子路由

| `screen` | 渲染内容 | 说明 |
|---------|---------|------|
| `wf-list` | `WorkflowList` | 工作流列表（默认） |
| `wf-builder:<id>` | `WorkflowBuilder` | 编辑指定工作流 |
| `wf-builder:new` | `WorkflowBuilder` | 新建工作流（id=null） |

### Auth 模块子视图

`UserManagement` 内部用 `view` state 切换三个视图：

| `view` | 组件/内容 | 说明 |
|--------|---------|------|
| `users` | 用户列表 + `UserDetail` | 所有 ERP 用户，点击进入权限编辑 |
| `permissions` | `PermissionBrowser` | 按权限维度查看持有人 |
| `it` | `ITPanel` | IT 管理员创建新 Supabase Auth 账号 |

### 第二层：Finance 模块内子页面路由

`DashboardLayout` 统一管理，初始值为 `dashboard`。

| `activeScreen` 值 | 组件 | 文件路径 | 说明 |
|-------------------|------|---------|------|
| `dashboard` | `FinanceDashboard` | `src/pages/FinanceDashboard.tsx` | 默认首页，财务总览 |
| `coa` | `ChartOfAccounts` | `src/pages/ChartOfAccounts.tsx` | 科目表 |
| `je-create` | `JournalEntryForm` | `src/pages/JournalEntryForm.tsx` | 新建记账凭证 |
| `je-list` | `JournalEntriesList` | `src/pages/JournalEntriesList.tsx` | 凭证列表（可翻页、搜索） |
| `je-edit:<id>` | `JournalEntryForm` | `src/pages/JournalEntryForm.tsx` | 编辑指定凭证（deep-link 格式） |
| `approvals` | `ApprovalsQueue` | `src/pages/ApprovalsQueue.tsx` | 待审批凭证队列 |
| `ap` | `AccountsSubmodule` | `src/pages/AccountsSubmodule.tsx` | 应付账款（规划中） |
| `ar` | `AccountsSubmodule` | `src/pages/AccountsSubmodule.tsx` | 应收账款（规划中） |
| `trial-balance` | `TrialBalance` | `src/pages/ReportsAndPeriods.tsx` | 试算平衡表 |
| `periods` / `reports` | `AccountingPeriods` | `src/pages/ReportsAndPeriods.tsx` | 会计期间管理 |
| `audit-log` | `AuditLog` | `src/pages/finance/AuditLog.tsx` | 财务审计日志（需 `finance.audit_log.view`） |
| `approval-settings` | `ApprovalSettings` | `src/pages/ApprovalSettings.tsx` | 审批权限配置（已迁移至 Auth 模块，Finance sidebar 不再显示） |
| _其他_ | `FinanceDashboard` | `src/pages/FinanceDashboard.tsx` | fallback |

### 返回首页

各模块的返回路径：

| 模块 | 返回方式 |
|------|---------|
| Finance | Sidebar 顶部 logo 区域（"← All Modules"），调用 `onHome()` |
| Workflow Studio | 列表页左上角 "← All Modules" 按钮，调用 `onNavigate('home')`（由 `WorkflowModule` 拦截） |
| Documentation | 顶部栏 "← Home" 按钮，调用 `onHome()` |
| Users & Auth | 页面顶部 "← All Users" / 返回按钮，调用 `onHome()` |
| HR 模块 | 页面顶部 "← All Modules" 按钮，调用 `onNavigate('home')` |

### Home Page 模块卡片可见性

`HomePage` 使用 `canAccessModule(mod.id)` 对 `MODULES` 数组过滤：
- **活跃模块**（finance / workflow / auth / docs）：仅当 `user_module_access` 中存在对应记录时显示
- **规划中模块**（warehouse / sales / production）：同样按 `canAccessModule` 过滤，无记录不显示
- 无模块访问权限时，对应卡片**完全不渲染**（不显示 "Coming Soon"，而是完全不存在）

### 共有布局组件

| 组件 | 文件路径 | 说明 |
|------|---------|------|
| `DashboardLayout` | `src/components/layout/DashboardLayout.tsx` | 主布局容器，管理 `activeScreen` state，拉取待审批数量 |
| `Sidebar` | `src/components/layout/Sidebar.tsx` | 左侧导航，显示审批徽章 |
| `TopBar` | `src/components/layout/TopBar.tsx` | 顶部栏 |

### Deep-link 格式

`je-edit:<number>` — 由 `JournalEntriesList` 行点击触发：
```ts
onNavigate(`je-edit:${entry.id}`)
```

---

## 侧边栏导航分区

导航项根据当前用户权限动态渲染（无权限则完全隐藏）：

```
── Overview ──────────
  Dashboard                              （始终显示）

── General Ledger ────
  Chart of Accounts                      （需 finance.chart_of_accounts.view）
  New Journal Entry                      （需 finance.journal_entry.create）
  Journal Entries                        （需 finance.journal_entry.view）
  Approvals          [徽章: 待审批数量]   （需 finance.journal_entry.view）

── Payables & Receivables ──
  Accounts Payable                       （始终显示，功能规划中）
  Accounts Receivable                    （始终显示，功能规划中）

── Reports ───────────                   （有任一权限时显示分区标题）
  Trial Balance                          （需 finance.journal_entry.view）
  Accounting Periods                     （需 finance.accounting_periods.view）

── Administration ────                   （有 finance.audit_log.view 时显示）
  Audit Log                              （需 finance.audit_log.view）

── 底部 ───────────────
  Support
```

---

## 数据流

```
UI Page
  │    ↑
  │    └── usePermissions()  ← PermissionContext（登录后一次性加载，全局同步）
  │             │
  │             ├─ can(module, resource, permission) → boolean
  │             ├─ approvalLimit(...)  → number | null
  │             └─ 数据来源：user_module_access + user_permission_grant
  ▼
src/services/api.ts          ← 唯一数据访问层（所有 Supabase 调用在此）
  │         │
  │         ├─ 直接表查询（SELECT/INSERT/UPDATE）
  │         └─ RPC 调用（复杂业务逻辑 SECURITY DEFINER 函数）
  │
  ▼
Supabase PostgreSQL
  ├─ Tables（数据存储）
  ├─ Views（account_balance）
  ├─ RPC Functions（create_journal_entry, post_journal_entry 等）
  ├─ Storage（journal-attachments bucket，私有，签名 URL）
  └─ Edge Functions（create-auth-user, reset-user-password，使用 service role key）
```

---

## 认证流程（Supabase Auth）

```
App 启动
  │
  ▼
supabase.auth.getSession()  ──── 无 session ──→ LoginPage（邮箱 + 密码）
  │                                               │
  │ 有 session                                    │ signInWithPassword()
  ▼                                               │
App（正常渲染）  ←─────────────────────────────────┘
  │
  ├─ onAuthStateChange 订阅（session 变化自动更新）
  └─ 登出：supabase.auth.signOut() → 返回 LoginPage
```

**账号管理规则**:
- 不开放自助注册，新账号只能由 IT 管理员在 `Users & Authentication → IT` 面板创建
- 创建调用 Edge Function `create-auth-user`（使用 service role key）
- 新账号创建后，触发器 `on_auth_user_created` 自动同步到 `erp_user`

---

## 模块开发状态

| 模块 | 状态 | 文档 |
|------|------|------|
| **Home Page（模块选择）** | ✅ 完成 | `src/pages/HomePage.tsx` |
| 财务仪表盘 | ✅ 完成 | → modules/01_general-ledger.md |
| 科目表 (CoA) | ✅ 完成 | → modules/01_general-ledger.md |
| 记账凭证 GL | ✅ 完成 | → modules/01_general-ledger.md |
| 审批工作流 | ✅ 完成 | → modules/02_approvals.md |
| 应付账款 AP | 🔲 框架已建（无业务逻辑） | → modules/03_ap-ar.md |
| 应收账款 AR | 🔲 框架已建（无业务逻辑） | → modules/03_ap-ar.md |
| 试算平衡表 | ✅ 完成（只读展示） | → modules/04_reports-periods.md |
| 会计期间 | ✅ 完成 | → modules/04_reports-periods.md |
| **Warehouse & Inventory** | 🔲 占位页（数据库表已建） | — |
| **Sales & Distribution** | 🔲 占位页（数据库表已建） | — |
| **Production & Manufacturing** | 🔲 占位页（数据库表已建） | — |
| **Users & Authentication** | ✅ 完成 | → modules/06_users-auth.md |
| **HR 模块** | ✅ 完成 | → modules/07_hr.md |
| **Finance Audit Log** | ✅ 完成 | → modules/08_finance-audit-log.md |
| **Quality Control (QC)** | ✅ 完成（Phase 1 MVP） | → modules/09_qc.md |
| **Production 成型生产日报** | ✅ 第一阶段（1:1 复刻 Excel 录入） | → modules/12_production-daily-report.md |
| P&L / 资产负债表 | 🔲 未开始 | — |
| **Workflow Studio** | ✅ 完成（执行引擎待开发） | → modules/05_workflow-studio.md |

---

## 设计规范

| Token | 值 | 说明 |
|-------|----|------|
| 主背景色（暖白） | `#faf8f5` | 所有页面背景：HomePage、WorkflowList、WorkflowBuilder toolbar/panels、DashboardLayout、ModulePlaceholder |
| 工作流画布背景 | `#1e293b`（slate-800） | WorkflowBuilder 内的 React Flow 画布，深色保留以突出节点 |
| 节点卡片背景 | `#111827` | BaseNode 组件，渲染于深色画布之上 |
| 登录页背景 | `#faf8f5` | 与全局背景一致，LoginPage 使用白色卡片居中布局 |
| IT 面板强调色 | violet-600 | ITPanel 区别于 By User（blue）和 By Permission（slate） |

---

## Claude Code 技能

| 文件 | 说明 |
|------|------|
| `.claude/commands/erp-doc-sync.md` | 每次回复前检查文档同步的 checklist（新 SQL、新路由、新文件、设计变更均需更新对应文档） |

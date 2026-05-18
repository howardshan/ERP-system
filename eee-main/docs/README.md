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
│   ├── types/index.ts             # 所有 TypeScript 类型定义
│   ├── lib/
│   │   ├── supabase.ts            # Supabase 客户端实例
│   │   └── utils.ts               # cn() 工具函数
│   ├── services/
│   │   └── api.ts                 # 所有 Supabase 调用（唯一数据层）
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
│       └── ReportsAndPeriods.tsx     # 试算表 + 会计期间
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
    │   └── 04_reports-periods.md   # 报表 + 会计期间
    └── database/
        ├── 01_schema.md             # 完整数据库表结构
        └── 02_rpc-functions.md      # 所有 RPC / View
```

---

## 路由结构（`src/App.tsx`）

系统使用单个 React state `activeScreen: string` 代替路由库，由 `DashboardLayout` 统一管理。

| `activeScreen` 值 | 渲染页面 | 说明 |
|-------------------|---------|------|
| `dashboard` | `FinanceDashboard` | 默认首页，财务总览 |
| `coa` | `ChartOfAccounts` | 科目表 |
| `je-create` | `JournalEntryForm` | 新建记账凭证 |
| `je-list` | `JournalEntriesList` | 凭证列表（可翻页、搜索） |
| `je-edit:<id>` | `JournalEntryForm` | 编辑指定凭证（deep-link 格式） |
| `approvals` | `ApprovalsQueue` | 待审批凭证队列 |
| `ap` | `AccountsSubmodule` (AP) | 应付账款（规划中） |
| `ar` | `AccountsSubmodule` (AR) | 应收账款（规划中） |
| `trial-balance` | `TrialBalance` | 试算平衡表 |
| `periods` / `reports` | `AccountingPeriods` | 会计期间管理 |
| `approval-settings` | `ApprovalSettings` | 审批权限配置 |
| _其他_ | `FinanceDashboard` | fallback |

### Deep-link 格式

`je-edit:<number>` — 由 `JournalEntriesList` 行点击触发：
```ts
onNavigate(`je-edit:${entry.id}`)
```

---

## 侧边栏导航分区

```
── Overview ──────────
  Dashboard

── General Ledger ────
  Chart of Accounts
  New Journal Entry
  Journal Entries
  Approvals          [徽章: 待审批数量]

── Payables & Receivables ──
  Accounts Payable
  Accounts Receivable

── Reports ───────────
  Trial Balance
  Accounting Periods

── 底部 ───────────────
  Approval Settings
  Support
```

---

## 数据流

```
UI Page
  │
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
  └─ Storage（journal-attachments bucket，私有，签名 URL）
```

---

## 模块开发状态

| 模块 | 状态 | 文档 |
|------|------|------|
| 财务仪表盘 | ✅ 完成 | → modules/01_general-ledger.md |
| 科目表 (CoA) | ✅ 完成 | → modules/01_general-ledger.md |
| 记账凭证 GL | ✅ 完成 | → modules/01_general-ledger.md |
| 审批工作流 | ✅ 完成 | → modules/02_approvals.md |
| 应付账款 AP | 🔲 框架已建（无业务逻辑） | → modules/03_ap-ar.md |
| 应收账款 AR | 🔲 框架已建（无业务逻辑） | → modules/03_ap-ar.md |
| 试算平衡表 | ✅ 完成（只读展示） | → modules/04_reports-periods.md |
| 会计期间 | ✅ 完成 | → modules/04_reports-periods.md |
| P&L / 资产负债表 | 🔲 未开始 | — |
| 用户认证 / 权限 | 🔲 未开始（Auth 已集成但无登录页） | — |

# Development Workflow

这份文档是这个项目的**开发工作流手册**。所有数据库变更、Edge Functions、
以及 ER 图都在本地维护，通过 Supabase CLI 同步到远端。  
不要直接在 Supabase Dashboard 里手改数据库——所有改动必须先在本地写好，再 push。

---

## 目录结构

```
ERP-system/
├── files/                          # 项目文档（你正在读的这里）
│   ├── workflow.md                 # 本文档
│   ├── er-diagram.mermaid          # 实体关系图（随 schema 一起更新）
│   ├── architecture.md
│   ├── data-model.md
│   ├── business-rules.md
│   ├── financial-core.md
│   ├── glossary.md
│   ├── project-status.md
│   └── schema.sql                  # 已过时 — 以 supabase/migrations/ 为准
│
└── eee-main/                       # 前端 + Supabase 本地工程
    ├── src/
    │   ├── services/api.ts         # 所有 Supabase 调用的唯一入口
    │   ├── lib/supabase.ts         # Supabase client 单例
    │   ├── pages/                  # React 页面
    │   ├── components/
    │   └── types/index.ts          # TypeScript 类型定义
    ├── supabase/
    │   ├── migrations/             # ★ 所有 SQL 变更都在这里
    │   │   ├── 20260517000000_initial_schema.sql
    │   │   └── 20260517000001_rpc_and_views.sql
    │   └── functions/              # ★ 所有 Edge Functions 都在这里
    │       ├── _shared/
    │       │   └── cors.ts         # 公共 CORS headers
    │       └── post-journal-entry/
    │           └── index.ts        # 示例 Edge Function
    ├── .env                        # 本地环境变量（不提交到 Git）
    └── .env.example                # 环境变量模板
```

---

## 环境变量

`.env` 文件放在 `eee-main/` 下，内容：

```bash
VITE_SUPABASE_URL="https://ooqygligyxjdwyfnsuqp.supabase.co"
VITE_SUPABASE_ANON_KEY="sb_publishable_..."
```

Edge Functions 在 Supabase 云端自动注入以下变量（无需手动配置）：
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`

---

## 数据库变更工作流

**规则：永远不要直接在 Dashboard SQL Editor 里改表结构。**  
所有 DDL、RPC 函数、视图都通过 migration 文件管理。

### 新建一个 Migration

```bash
cd eee-main

# 1. 创建 migration 文件（文件名自动带时间戳）
supabase migration new <描述性名称>
# 例：supabase migration new add_bank_account_table

# 2. 在生成的文件里写 SQL
# 文件路径：supabase/migrations/YYYYMMDDHHMMSS_<名称>.sql

# 3. 推送到远端
supabase db push
```

### 常用命令

```bash
# 查看哪些 migration 还没推送
supabase migration list

# 推送所有待推送的 migration（会询问确认）
supabase db push

# 从远端拉取 schema（当有人直接在 Dashboard 改了，需要拉回来对齐）
supabase db pull

# 比对本地和远端 schema 的差异
supabase db diff
```

### Migration 命名规范

```
YYYYMMDDHHMMSS_<动词>_<对象>.sql

示例：
20260601000000_add_bank_account_table.sql
20260605000000_add_rls_policies.sql
20260610000000_fix_account_balance_view.sql
```

### Migration 内容规范

每个 migration 文件应该：
- 只做一件事（加表、改列、加函数等）
- 是幂等的（加 `IF NOT EXISTS`、`CREATE OR REPLACE`）
- 在文件顶部用注释说明目的

```sql
-- Migration: add_bank_account_table
-- Purpose: Add bank account and bank transaction tables for bank reconciliation (Phase D)

CREATE TABLE IF NOT EXISTS bank_account (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ...
);
```

---

## RPC 函数（SQL 业务逻辑）

### 原则

所有**多步骤业务逻辑**都写成 PostgreSQL 函数（`SECURITY DEFINER`），
存放在 migration 文件里。前端通过 `supabase.rpc('function_name', params)` 调用。

**什么时候用 RPC vs 直接 `supabase.from()`：**

| 操作 | 方式 |
|------|------|
| 简单 SELECT（读数据）| `supabase.from('table').select(...)` |
| 简单 INSERT（新建记录）| `supabase.from('table').insert(...)` |
| 多步骤事务（改多张表）| `supabase.rpc('function_name', ...)` |
| 需要服务端校验（业务规则）| `supabase.rpc('function_name', ...)` |

### 已有 RPC 函数一览

| 函数 | 位置 | 说明 |
|------|------|------|
| `create_journal_entry(date, desc, type, lines[])` | migration 000001 | 原子创建日记账 + 行，自动找 open period |
| `post_journal_entry(entry_id)` | migration 000001 | 验证 BR-F1/F3/F4/F5，发布分录 |
| `reverse_journal_entry(entry_id, reason?)` | migration 000001 | 创建并发布冲销分录 |
| `open_accounting_period(period_id)` | migration 000001 | 开放会计期间，写审计日志 |
| `close_accounting_period(period_id)` | migration 000001 | 关闭期间，拒绝有未过账分录时关闭 |
| `create_accounting_period(name, start, end, fy)` | migration 000001 | 创建期间，检查日期不重叠 |

### 修改 RPC 函数

```bash
# 1. 新建 migration
supabase migration new update_post_journal_entry

# 2. 在文件里用 CREATE OR REPLACE FUNCTION
# （不要 ALTER FUNCTION，直接全量替换）

# 3. push
supabase db push
```

---

## 视图

### 已有视图

| 视图 | 说明 |
|------|------|
| `account_balance` | 从已发布分录聚合每个科目的 debit / credit / balance（按账户类型方向） |

视图是 **derived，不是 source of truth**。如果视图数据和原表对不上，原表永远是对的。

### 修改视图

```sql
-- migration 里用 CREATE OR REPLACE VIEW
CREATE OR REPLACE VIEW account_balance AS
SELECT ...
```

---

## Edge Functions 工作流

Edge Functions 适合做：
- 需要调用外部 API（发邮件、PDF 生成、webhook）
- 定时任务（逾期发票提醒、期间自动开放）
- 需要 service role key 的操作（绕过 RLS）

**不适合** 做纯 SQL 能搞定的业务逻辑（那些用 RPC 函数）。

### 目录结构

```
supabase/functions/
├── _shared/          # 公共工具（cors、auth helper 等）
│   └── cors.ts
├── <function-name>/  # 每个函数一个文件夹
│   └── index.ts      # 入口文件，必须叫 index.ts
└── ...
```

### 新建 Edge Function

```bash
cd eee-main

# 1. 创建文件夹和入口文件
mkdir -p supabase/functions/my-function
# 手动创建 supabase/functions/my-function/index.ts

# 2. 本地测试（需要先运行 supabase start 启动本地 Supabase）
supabase functions serve my-function --env-file .env

# 3. 部署到云端
supabase functions deploy my-function
```

### Edge Function 模板

```typescript
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req: Request) => {
  // 处理 CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ... 业务逻辑

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
```

### 计划中的 Edge Functions

| 函数 | 触发方式 | 说明 | 状态 |
|------|----------|------|------|
| `send-invoice-reminder` | 定时 / 手动 | 向逾期 AR 客户发提醒邮件 | 未建 |
| `generate-pdf-report` | HTTP | 生成 Trial Balance / P&L PDF | 未建 |
| `auto-open-period` | 定时 cron | 期间 start_date 到了自动从 future → open | 未建 |

---

## ER 图维护

ER 图文件：[`files/er-diagram.mermaid`](./er-diagram.mermaid)

### 规则

**每次修改 schema（加表、加列、改关系），同一个 commit 里同步更新 ER 图。**

### 怎么渲染

- **VS Code**：安装 "Markdown Preview Mermaid Support" 插件，在 `.mermaid` 文件里预览
- **GitHub**：直接在 `.md` 文件里用 ` ```mermaid ` 代码块，GitHub 自动渲染
- **在线**：粘贴到 [mermaid.live](https://mermaid.live)

---

## 数据库表总览

### 已建（38 张表）

| 模块 | 表 |
|------|----|
| 主数据 | `uom` `uom_conversion` `item` `item_category` `warehouse` `location` `supplier` `customer` |
| 库存 | `lot` `inventory_transaction` `inventory_balance` |
| 配方 | `formula` `formula_version` `formula_line` |
| 采购 | `purchase_order` `purchase_order_line` `goods_receipt` `goods_receipt_line` |
| 生产 | `production_order` `production_consumption` `production_output` |
| 销售 | `sales_order` `sales_order_line` `shipment` `shipment_line` |
| 质量 | `coa` |
| 财务 | `gl_account` `account_segment` `accounting_period` `period_status_history` `journal_entry` `journal_entry_line` `department` `cost_center` `ap_invoice` `ar_invoice` `payment` `payment_application` |

### 视图

| 视图 | 说明 |
|------|------|
| `account_balance` | 科目余额（从已发布分录聚合） |

---

## Git 提交规范

```
feat(finance): add bank_account table and reconciliation RPC
fix(schema): correct uom_conversion unique constraint for NULL item_id
chore(migration): add index on journal_entry_line(gl_account_id)
docs(er-diagram): sync diagram with bank_account changes
```

**提交必须包含的内容（如果改了数据库）：**
1. `supabase/migrations/` 里的新 migration 文件
2. `files/er-diagram.mermaid` 的同步更新
3. 受影响的前端类型定义（`src/types/index.ts`）和 API 调用（`src/services/api.ts`）

---

## 下一步开发计划

### Phase B — 财务报表
- [ ] `supabase/migrations/20260601_profit_loss_function.sql` — P&L 汇总 RPC
- [ ] `supabase/migrations/20260601_balance_sheet_function.sql` — 资产负债表 RPC
- [ ] 前端新增 P&L 和 Balance Sheet 页面

### Phase C — AP/AR 流程完善
- [ ] Migration：AP 付款录入 RPC（`record_ap_payment`）
- [ ] Migration：AR 收款录入 RPC（`record_ar_receipt`）
- [ ] 前端：AP/AR 页面接真实数据，支持录入发票和付款

### Phase D — 银行对账
- [ ] Migration：`bank_account` + `bank_transaction` 表
- [ ] Migration：对账 RPC
- [ ] 前端：对账页面

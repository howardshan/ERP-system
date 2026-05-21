# 模块 05：Workflow Studio（工作流编排）

**模块 ID**: `workflow`  
**入口**: Home Page → Workflow Studio 卡片

---

## 概述

Workflow Studio 是一个可视化的自动化工作流编排工具，允许用户通过拖拽节点、连接数据源，构建跨模块的自定义业务流程。

类似于 Zapier / Make.com，但完全集成在本 ERP 内，直接操作系统内的数据（GL、库存、采购、销售等）。

---

## 页面结构

### WorkflowList（工作流列表）

**路由**: `wf-list`（WorkflowModule 内默认页）  
**文件**: `src/pages/WorkflowList.tsx`  
**完整路径**: `eee-main/src/pages/WorkflowList.tsx`

**功能**:
- 展示所有已保存的工作流（卡片布局）
- 显示每个工作流的状态、节点数、最后修改时间
- 操作：Edit（进入编辑器）、Activate/Pause（切换状态）、Delete
- 新建按钮：直接创建草稿并跳转编辑器
- **← All Modules**：页面左上角返回首页按钮（调用 `onNavigate('home')`，由 `WorkflowModule` 拦截为 `onHome()`）

### 权限控制
| 元素 | 所需权限 |
|------|---------|
| New Workflow 按钮 | `workflow.workflow.create` |
| Edit 按钮 | `workflow.workflow.edit` |
| Pause / Activate 按钮 | `workflow.workflow.execute` |
| Delete 按钮（两次确认） | `workflow.workflow.delete` |

---

### WorkflowBuilder（工作流编辑器）

**路由**: `wf-builder:<id>`（id 为 workflow_definition.id）  
**文件**: `src/pages/WorkflowBuilder.tsx`  
**完整路径**: `eee-main/src/pages/WorkflowBuilder.tsx`

**布局（全屏，无侧边栏）**:
```
┌─────────────────────────────────────────────────────┐
│  ← Back  |  Workflow Name  |  Delete Node | Save | Run  │  ← Top Toolbar
├──────────┬────────────────────────────────┬──────────┤
│  Node    │                                │ Props    │
│ Palette  │      React Flow Canvas         │  Panel   │
│  (256px) │                                │  (288px) │
│          │  Background dots, MiniMap,     │          │
│          │  Controls (zoom/fit)           │          │
└──────────┴────────────────────────────────┴──────────┘
```

**交互**:
- **点击** 左侧面板节点 → 立即添加到画布中央（主要方式，Tauri WebView 原生 drag 兼容性有限）
- **拖拽** 左侧面板节点到画布 → 松开位置放置（辅助方式，可用时优先）
- 点击节点源 Handle（右侧圆点）拖拽到目标节点的目标 Handle（左侧圆点）→ 创建连线
- 点击节点 → 右侧属性面板展开，可修改 Label 和各字段配置
- Delete 键删除选中节点（同时删除关联连线）
- Top toolbar Save 按钮保存到数据库（新建 or 更新）
- Top toolbar Run 按钮（暂为 UI placeholder，执行引擎待开发）

> **Tauri 限制说明**：WKWebView (macOS) 会丢弃非标准 MIME type，dataTransfer 只用 `text/plain`；`window.confirm()` 在 Tauri v2 中被禁用，所有需要确认的操作改为内联二次点击确认（首次点击变红 → 3 秒内再次点击执行）。

---

## 节点类型

### Trigger（触发器，绿色）

| subtype | label | 说明 |
|---------|-------|------|
| `manual` | Manual Run | 手动触发 |
| `schedule` | On Schedule | 按 Cron 表达式定时触发 |
| `on_je_created` | JE Created | 有新凭证被创建时触发 |
| `on_inventory_change` | Inventory Change | 库存变动时触发 |
| `on_so_created` | Sales Order Created | 销售订单创建时触发 |
| `on_po_created` | PO Created | 采购订单创建时触发 |

**特征**: 只有输出 Handle，没有输入 Handle（流程起点）

---

### Data Source（数据源，蓝色）

| subtype | label | 说明 |
|---------|-------|------|
| `gl_accounts` | GL Accounts | 读取科目表数据 |
| `journal_entries` | Journal Entries | 读取凭证数据（可按状态/日期过滤） |
| `inventory_balance` | Inventory Balance | 读取库存余额 |
| `purchase_orders` | Purchase Orders | 读取采购订单 |
| `sales_orders` | Sales Orders | 读取销售订单 |
| `ap_invoices` | AP Invoices | 读取应付发票 |
| `ar_invoices` | AR Invoices | 读取应收发票 |

---

### Logic（逻辑，琥珀色）

| subtype | label | 说明 |
|---------|-------|------|
| `filter` | Filter / Where | 按条件过滤数据集 |
| `branch` | Branch (If/Else) | 条件分支，有两个输出 Handle（true/false） |
| `aggregate` | Aggregate | 对字段执行 sum/count/avg/min/max |
| `transform` | Transform Fields | 字段映射/重命名 |

**Branch 节点特殊性**: 有两个输出 Handle（`true` 在上方，`false` 在下方），分别连接不同后续节点。

---

### Action（动作，紫色）

| subtype | label | 说明 |
|---------|-------|------|
| `create_je` | Create Journal Entry | 基于上游数据创建凭证草稿 |
| `post_je` | Post Journal Entry | 过账指定凭证 |
| `send_notification` | Send Notification | 发送通知（email/in_app/webhook） |
| `export_csv` | Export to CSV | 将数据集导出为 CSV |

---

### Output（输出，灰色）

| subtype | label | 说明 |
|---------|-------|------|
| `dashboard_widget` | Dashboard Widget | 将数据推送到仪表盘小部件 |
| `email_report` | Email Report | 将数据以报表形式发送邮件 |
| `webhook` | Webhook | 调用外部 HTTP 接口 |

---

## 组件文件路径

| 组件 | 文件路径 |
|------|---------|
| NodePalette（左侧面板） | `eee-main/src/components/workflow/NodePalette.tsx` |
| PropertiesPanel（右侧面板） | `eee-main/src/components/workflow/PropertiesPanel.tsx` |
| BaseNode（节点基础样式） | `eee-main/src/components/workflow/nodes/BaseNode.tsx` |
| WorkflowNode + nodeTypes（React Flow 注册） | `eee-main/src/components/workflow/nodes/index.tsx` |
| WorkflowList（列表页） | `eee-main/src/pages/WorkflowList.tsx` |
| WorkflowBuilder（画布编辑器） | `eee-main/src/pages/WorkflowBuilder.tsx` |

---

## TypeScript 类型

**文件**: `eee-main/src/types/workflow.ts`

```ts
interface WorkflowNodeData {
  label: string;
  subtype: NodeSubtype;
  category: NodeCategory;
  config: Record<string, unknown>;
}

interface WorkflowDefinition {
  id: number;
  name: string;
  description: string | null;
  nodes_json: string;   // JSON array of React Flow nodes
  edges_json: string;   // JSON array of React Flow edges
  status: 'draft' | 'active' | 'paused' | 'archived';
  created_at: string;
  updated_at: string | null;
}

interface WorkflowRun {
  id: number;
  workflow_id: number;
  triggered_by: 'manual' | 'schedule' | 'event';
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
}
```

---

## 数据库表

### `workflow_definition`

| 列名 | 类型 | 说明 |
|------|------|------|
| `id` | bigint PK | |
| `name` | text | 工作流名称 |
| `description` | text | 可选描述 |
| `nodes_json` | jsonb | React Flow 节点数组（含位置、类型、data） |
| `edges_json` | jsonb | React Flow 连线数组（含 source/target/handle） |
| `status` | text | draft / active / paused / archived |
| `created_at` | timestamptz | |
| `created_by` | uuid | → auth.users |
| `updated_at` | timestamptz | |
| `updated_by` | uuid | → auth.users |

### `workflow_run`

| 列名 | 类型 | 说明 |
|------|------|------|
| `id` | bigint PK | |
| `workflow_id` | bigint | → workflow_definition.id，CASCADE DELETE |
| `triggered_by` | text | manual / schedule / event |
| `status` | text | running / completed / failed / cancelled |
| `started_at` | timestamptz | |
| `finished_at` | timestamptz | |
| `result_json` | jsonb | 执行结果数据 |
| `error_message` | text | 失败原因 |
| `created_by` | uuid | → auth.users |

---

## API 函数（`src/services/workflowApi.ts`）

| 函数 | 操作 | 说明 |
|------|------|------|
| `getWorkflows()` | SELECT | 获取所有工作流列表 |
| `getWorkflow(id)` | SELECT | 获取单个工作流 |
| `createWorkflow(params)` | INSERT | 新建工作流（返回完整对象含 id） |
| `saveWorkflow(id, params)` | UPDATE | 保存节点和连线（覆盖式更新） |
| `updateWorkflowStatus(id, status)` | UPDATE | 切换工作流状态 |
| `deleteWorkflow(id)` | DELETE | 删除工作流及其运行记录（CASCADE） |
| `getWorkflowRuns(workflowId)` | SELECT | 获取最近 20 条运行记录 |
| `createWorkflowRun(workflowId)` | INSERT | 手动创建运行记录 |

---

## 技术依赖

| 库 | 版本 | 说明 |
|----|------|------|
| `@xyflow/react` | latest | 拖拽画布、节点/连线渲染、MiniMap |

CSS 引入：`WorkflowBuilder.tsx` 中 `import '@xyflow/react/dist/style.css'`

---

## 待开发

- [ ] **执行引擎**：Run 按钮触发实际执行，遍历节点图，按顺序执行每个节点
- [ ] **Schedule 执行**：Cron 触发器集成（可通过 Supabase Edge Function + pg_cron 实现）
- [ ] **事件触发**：数据库 Trigger 或 Supabase Realtime 监听变更
- [ ] **执行日志面板**：在 WorkflowBuilder 底部展开 run history
- [ ] **节点执行状态**：运行时在节点上高亮显示 running/success/error
- [ ] **子工作流节点**：一个工作流调用另一个工作流
- [ ] **版本历史**：工作流版本管理，支持回滚

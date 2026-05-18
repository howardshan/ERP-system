# 模块 03：应付账款 & 应收账款（AP / AR）

> 当前状态：数据库表结构已完整定义，前端为**占位页面**，业务逻辑尚未实现。

---

## 应付账款（Accounts Payable）

**路由**: `ap`  
**文件**: `src/pages/AccountsSubmodule.tsx`（type="AP"）

### 规划功能
- 供应商发票登记与管理
- 付款申请与记录
- 应付账龄分析
- AP 凭证自动生成（GR 关联）

### 当前状态
页面渲染为空框架（Placeholder），显示"AP"标题，无实际数据交互。

---

## 应收账款（Accounts Receivable）

**路由**: `ar`  
**文件**: `src/pages/AccountsSubmodule.tsx`（type="AR"）

### 规划功能
- 客户发票开具与管理
- 收款记录
- 应收账龄分析
- AR 凭证自动生成（销售订单/发货关联）

### 当前状态
页面渲染为空框架（Placeholder），显示"AR"标题，无实际数据交互。

---

## 数据库表

### `ap_invoice`（应付发票）

| 列名 | 类型 | 说明 |
|------|------|------|
| `id` | bigint PK | |
| `invoice_number` | text | 发票号，UNIQUE(supplier_id, invoice_number) |
| `supplier_id` | bigint | → supplier.id |
| `invoice_date` | date | 发票日期 |
| `due_date` | date | 到期日 |
| `amount` | numeric(18,4) | 发票总金额 |
| `amount_paid` | numeric(18,4) | 已付金额，默认 0 |
| `status` | text | open / partially_paid / paid / cancelled |
| `created_at` | timestamptz | |
| `created_by` | uuid | |

### `ar_invoice`（应收发票）

| 列名 | 类型 | 说明 |
|------|------|------|
| `id` | bigint PK | |
| `invoice_number` | text UNIQUE | |
| `customer_id` | bigint | → customer.id |
| `invoice_date` | date | |
| `due_date` | date | |
| `amount` | numeric(18,4) | |
| `amount_received` | numeric(18,4) | 已收金额，默认 0 |
| `status` | text | open / partially_paid / paid / cancelled |
| `created_at` | timestamptz | |
| `created_by` | uuid | |

### `payment`（付/收款记录）

| 列名 | 类型 | 说明 |
|------|------|------|
| `id` | bigint PK | |
| `payment_number` | text UNIQUE | |
| `direction` | text | outgoing（付款）/ incoming（收款） |
| `party_type` | text | supplier / customer |
| `party_id` | bigint | 对应 supplier.id 或 customer.id |
| `payment_date` | date | |
| `amount` | numeric(18,4) | |
| `created_at` | timestamptz | |
| `created_by` | uuid | |

### `payment_application`（付款应用，支持部分付款/多发票）

| 列名 | 类型 | 说明 |
|------|------|------|
| `id` | bigint PK | |
| `payment_id` | bigint | → payment.id |
| `invoice_type` | text | ap / ar |
| `invoice_id` | bigint | 对应 ap_invoice.id 或 ar_invoice.id |
| `amount_applied` | numeric(18,4) | 本次应用金额，> 0 |
| `created_at` | timestamptz | |

### `supplier`（供应商）

| 列名 | 类型 | 说明 |
|------|------|------|
| `id` | bigint PK | |
| `code` | text UNIQUE | |
| `name` | text | |
| `contact_name` | text | |
| `email` | text | |
| `phone` | text | |
| `address` | text | |
| `payment_terms` | text | 账期（如 Net30） |
| `is_active` | boolean | |

### `customer`（客户）

| 列名 | 类型 | 说明 |
|------|------|------|
| `id` | bigint PK | |
| `code` | text UNIQUE | |
| `name` | text | |
| `contact_name` | text | |
| `email` | text | |
| `phone` | text | |
| `billing_address` | text | |
| `shipping_address` | text | |
| `payment_terms` | text | |
| `credit_limit` | numeric(18,4) | 信用额度 |
| `is_active` | boolean | |

---

## 已实现的 API 函数（读取）

```ts
getApInvoices(): Promise<ApInvoice[]>   // JOIN supplier.name
getArInvoices(): Promise<ArInvoice[]>   // JOIN customer.name
```

---

## 下一步开发计划

### AP 阶段
1. **供应商管理** — CRUD 供应商
2. **发票登记** — 手动录入 AP Invoice
3. **GRN 自动匹配** — Goods Receipt 过账时自动生成 AP Invoice + GL 凭证
4. **付款记录** — 录入付款，更新 `amount_paid`，触发 GL 凭证
5. **账龄分析** — 按 30/60/90/90+ 天分桶

### AR 阶段
1. **客户管理** — CRUD 客户
2. **发票开具** — 销售订单关联
3. **收款记录** — 录入收款，更新 `amount_received`，触发 GL 凭证
4. **账龄分析**

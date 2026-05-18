# 数据库 Schema（完整）

**数据库**: Supabase PostgreSQL  
**Migration 文件路径**: `supabase/migrations/`

---

## Migration 文件列表

| 文件名 | 内容 |
|--------|------|
| `20260517000000_initial_schema.sql` | 全库表结构（运营 + 财务，共 38 张表） |
| `20260517000001_rpc_and_views.sql` | account_balance VIEW + 核心 RPC 函数 |
| `20260517000002_journal_notes_attachments.sql` | 凭证 notes 字段 + journal_entry_attachment 表 |
| `20260517000003_add_notes_to_create_je.sql` | create_journal_entry 函数追加 notes 参数 |
| `20260517000004_seed_2026_periods.sql` | 2026 年 1–12 月 12 个 open 会计期间 |
| `20260517000005_je_edit_and_audit.sql` | create_je_shell、update_je_draft、journal_entry_edit_log |
| `20260517000006_approval_workflow.sql` | approval_tier、user_profile、审批 RPC 函数 |
| `20260518000000_workflow_studio.sql` | workflow_definition、workflow_run 表及 RLS |
| `20260518000001_user_permission_system.sql` | erp_user、user_module_access、user_permission_grant 表及种子数据 |
| `20260518000002_link_erp_user_to_auth.sql` | erp_user.auth_user_id、list_erp_users() RPC、on_auth_user_created 触发器 |
| `20260518000003_fix_list_erp_users.sql` | 修复 list_erp_users()，以 erp_user 为主表 |

---

## Section 1 — 参考数据 & 主数据

### `uom`（计量单位）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| code | text UNIQUE | 如 KG、BAG、PCS |
| name | text | |
| uom_type | text | weight / volume / count |

### `item_category`（物料分类）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| code | text UNIQUE | |
| name | text | |
| parent_id | bigint | 自引用，支持多层分类 |

### `warehouse`（仓库）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| code | text UNIQUE | |
| name | text | |
| address | text | |
| is_active | boolean | |

### `location`（库位）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| warehouse_id | bigint | → warehouse.id |
| code | text | UNIQUE(warehouse_id, code) |
| name | text | |
| location_type | text | storage / receiving / shipping / production / quarantine |
| is_active | boolean | |

### `supplier`（供应商）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| code | text UNIQUE | |
| name | text | |
| contact_name | text | |
| email | text | |
| phone | text | |
| address | text | |
| payment_terms | text | 如 Net30 |
| is_active | boolean | |

### `customer`（客户）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| code | text UNIQUE | |
| name | text | |
| contact_name | text | |
| email | text | |
| phone | text | |
| billing_address | text | |
| shipping_address | text | |
| payment_terms | text | |
| credit_limit | numeric(18,4) | |
| is_active | boolean | |

### `item`（物料）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| sku | text UNIQUE | |
| name | text | |
| description | text | |
| item_type | text | raw_material / packaging / intermediate / finished_good |
| category_id | bigint | → item_category.id |
| base_uom_id | bigint | → uom.id |
| is_lot_controlled | boolean | 是否批次管理 |
| shelf_life_days | integer | 保质期天数 |
| default_warehouse_id | bigint | → warehouse.id |
| costing_method | text | standard / weighted_average / fifo |
| standard_cost | numeric(18,4) | 标准成本 |
| allergen_info | text | 过敏原信息（宠物食品合规要求） |
| status | text | active / inactive |

### `uom_conversion`（计量单位换算）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| item_id | bigint | 物料特定换算（NULL 为通用换算） |
| from_uom_id | bigint | → uom.id |
| to_uom_id | bigint | → uom.id |
| factor | numeric(18,8) | 换算系数，如 1 BAG = 15 KG，factor=15 |
| UNIQUE NULLS NOT DISTINCT | (item_id, from_uom_id, to_uom_id) | |

---

## Section 2 — 库存 & 批次

### `lot`（批次）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| lot_number | text | UNIQUE(item_id, lot_number) |
| item_id | bigint | → item.id |
| supplier_lot_number | text | 供应商批号 |
| manufacture_date | date | |
| expiry_date | date | |
| source_type | text | purchased / produced |
| source_doc_type | text | 来源单据类型 |
| source_doc_id | bigint | 来源单据 ID |
| status | text | quarantine / available / on_hold / consumed / rejected / expired |

### `inventory_transaction`（库存台账，追加不删改）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| transaction_date | timestamptz | |
| item_id | bigint | |
| lot_id | bigint | |
| location_id | bigint | |
| quantity | numeric(18,4) | 有符号，基准单位 |
| transaction_type | text | receipt / issue / transfer_in / transfer_out / production_consume / production_output / adjustment / ship |
| unit_cost | numeric(18,4) | |
| reference_type | text | 关联单据类型 |
| reference_id | bigint | 关联单据 ID |
| notes | text | |

**索引**: `(item_id, lot_id)`, `(lot_id)`, `(reference_type, reference_id)`

### `inventory_balance`（库存余额缓存）
| 列 | 类型 | 说明 |
|----|------|------|
| item_id | bigint | PK 联合 |
| lot_id | bigint | PK 联合（可为 NULL） |
| location_id | bigint | PK 联合 |
| quantity_on_hand | numeric(18,4) | 现有量 |
| quantity_allocated | numeric(18,4) | 已分配量 |
| last_updated | timestamptz | |

> 台账（`inventory_transaction`）是数据真相，此表是查询缓存，从台账重建。

---

## Section 3 — 配方（BOM / Recipe）

### `formula`（配方头）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| code | text UNIQUE | |
| name | text | |
| output_item_id | bigint | → item.id（产出物料） |

### `formula_version`（配方版本）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| formula_id | bigint | → formula.id |
| version_no | integer | UNIQUE(formula_id, version_no) |
| base_output_quantity | numeric(18,4) | 基准产出量 |
| base_output_uom_id | bigint | → uom.id |
| status | text | draft / active / obsolete |
| effective_date | date | |
| approved_by | text | |

### `formula_line`（配方行，原料清单）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| formula_version_id | bigint | → formula_version.id |
| line_no | integer | UNIQUE(formula_version_id, line_no) |
| ingredient_item_id | bigint | → item.id（原料） |
| quantity | numeric(18,4) | |
| uom_id | bigint | → uom.id |
| scrap_percent | numeric(7,4) | 损耗率，默认 0 |
| notes | text | |

---

## Section 4 — 采购

### `purchase_order`（采购订单）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| po_number | text UNIQUE | |
| supplier_id | bigint | → supplier.id |
| order_date | date | |
| expected_date | date | |
| status | text | draft / confirmed / partially_received / received / closed / cancelled |
| currency | text | 默认 USD |
| notes | text | |

### `purchase_order_line`（采购订单行）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| po_id | bigint | UNIQUE(po_id, line_no) |
| line_no | integer | |
| item_id | bigint | → item.id |
| quantity | numeric(18,4) | |
| uom_id | bigint | |
| unit_price | numeric(18,4) | |
| received_quantity | numeric(18,4) | 已收量 |

### `goods_receipt`（收货单 GRN）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| grn_number | text UNIQUE | |
| po_id | bigint | → purchase_order.id（可为 NULL，支持无 PO 收货） |
| supplier_id | bigint | → supplier.id |
| receipt_date | date | |
| warehouse_id | bigint | |
| status | text | draft / posted / cancelled |

### `goods_receipt_line`（收货单行）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| grn_id | bigint | |
| line_no | integer | UNIQUE(grn_id, line_no) |
| po_line_id | bigint | → purchase_order_line.id（可为 NULL） |
| item_id | bigint | |
| lot_id | bigint | 入库批次 |
| quantity | numeric(18,4) | |
| uom_id | bigint | |
| location_id | bigint | 入库库位 |
| unit_cost | numeric(18,4) | |

---

## Section 5 — 生产

### `production_order`（生产工单）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| mo_number | text UNIQUE | |
| formula_version_id | bigint | → formula_version.id |
| output_item_id | bigint | → item.id |
| planned_quantity | numeric(18,4) | |
| planned_uom_id | bigint | |
| warehouse_id | bigint | |
| planned_date | date | |
| status | text | planned / released / in_progress / completed / closed / cancelled |

### `production_consumption`（原料消耗记录）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| production_order_id | bigint | |
| item_id | bigint | |
| lot_id | bigint | 消耗批次（溯源关键） |
| location_id | bigint | |
| planned_quantity | numeric(18,4) | |
| actual_quantity | numeric(18,4) | |
| uom_id | bigint | |

### `production_output`（成品产出记录）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| production_order_id | bigint | |
| item_id | bigint | |
| lot_id | bigint | 产出批次（溯源关键） |
| quantity | numeric(18,4) | |
| uom_id | bigint | |
| location_id | bigint | |
| output_type | text | primary / by_product |
| output_date | date | |

---

## Section 6 — 销售 & 发货

### `sales_order`（销售订单）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| so_number | text UNIQUE | |
| customer_id | bigint | → customer.id |
| order_date | date | |
| requested_date | date | |
| status | text | draft / confirmed / partially_shipped / shipped / closed / cancelled |
| currency | text | 默认 USD |
| notes | text | |

### `sales_order_line`（销售订单行）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| so_id | bigint | UNIQUE(so_id, line_no) |
| line_no | integer | |
| item_id | bigint | |
| quantity | numeric(18,4) | |
| uom_id | bigint | |
| unit_price | numeric(18,4) | |
| shipped_quantity | numeric(18,4) | 已发量 |

### `shipment`（发货单）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| shipment_number | text UNIQUE | |
| so_id | bigint | → sales_order.id（可为 NULL） |
| customer_id | bigint | → customer.id |
| ship_date | date | |
| warehouse_id | bigint | |
| status | text | draft / posted / cancelled |

### `shipment_line`（发货单行，含批次 — 正向追溯终点）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| shipment_id | bigint | |
| line_no | integer | UNIQUE(shipment_id, line_no) |
| so_line_id | bigint | → sales_order_line.id（可为 NULL） |
| item_id | bigint | |
| lot_id | bigint | 出货批次（追溯终点） |
| quantity | numeric(18,4) | |
| uom_id | bigint | |
| location_id | bigint | |

---

## Section 7 — 质量

### `coa`（质检报告 Certificate of Analysis）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| coa_number | text UNIQUE | |
| lot_id | bigint | → lot.id |
| test_date | date | |
| result | text | pass / fail / conditional / pending |
| tested_by | text | |
| document_ref | text | 外部文件引用 |
| notes | text | |

---

## Section 8 — 财务（Finance）

### `department`（部门）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| code | text UNIQUE | |
| name | text | |
| is_active | boolean | |

### `cost_center`（成本中心）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| code | text UNIQUE | |
| name | text | |
| is_active | boolean | |

### `account_segment`（科目段定义，可选扩展）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| segment_no | integer | 段序号 |
| name | text | 段名称 |
| length | integer | 位数 |

### `gl_account`（科目表）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| account_code | text UNIQUE | 科目代码 |
| name | text | 科目名称 |
| account_type | text | asset / liability / equity / revenue / expense |
| parent_id | bigint | 自引用，层级结构 |
| is_postable | boolean | false = 汇总科目，不可直接记账 |
| is_active | boolean | |
| created_by | uuid | |

### `accounting_period`（会计期间）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| name | text UNIQUE | 如 "JAN 2026" |
| start_date | date | |
| end_date | date | CHECK(end_date >= start_date) |
| fiscal_year | integer | |
| status | text | future / open / soft_closed / closed |
| created_by | uuid | |

### `period_status_history`（期间状态变更审计）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| accounting_period_id | bigint | → accounting_period.id |
| from_status | text | |
| to_status | text | |
| reason | text | |
| changed_at | timestamptz | |
| changed_by | uuid | |

### `journal_entry`（凭证表头）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| entry_number | text UNIQUE | 格式：JE-YYYY-NNNNNN |
| entry_date | date | |
| accounting_period_id | bigint | → accounting_period.id |
| description | text | 凭证摘要 |
| notes | text | 内部备注（Migration 002 添加） |
| journal_type | text | general / adjustment / accrual / depreciation 等 |
| source_type | text | manual / goods_receipt / production / shipment / adjustment |
| source_id | bigint | 关联来源单据 ID |
| status | text | draft / pending_approval / posted / reversed / rejected |
| reversed_by_entry_id | bigint | → journal_entry.id（自引用） |
| posted_at | timestamptz | |
| posted_by | uuid | |
| updated_at | timestamptz | Migration 005 |
| updated_by | uuid | Migration 005 |
| submitted_at | timestamptz | Migration 006 |
| submitted_by | uuid | Migration 006 |
| approved_at | timestamptz | Migration 006 |
| approved_by | uuid | Migration 006 |
| rejected_at | timestamptz | Migration 006 |
| rejected_by | uuid | Migration 006 |
| rejection_reason | text | Migration 006 |
| required_tier_id | int | → approval_tier.id，Migration 006 |
| created_at | timestamptz | |
| created_by | uuid | |

### `journal_entry_line`（凭证明细行）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| journal_entry_id | bigint | → journal_entry.id |
| line_no | integer | UNIQUE(journal_entry_id, line_no) |
| gl_account_id | bigint | → gl_account.id |
| description | text | 行描述 |
| debit | numeric(18,4) | 借方，默认 0 |
| credit | numeric(18,4) | 贷方，默认 0 |
| department_id | bigint | → department.id（可选维度） |
| cost_center_id | bigint | → cost_center.id（可选维度） |

**约束**:
```sql
CHECK (debit >= 0 AND credit >= 0)
CHECK (NOT (debit > 0 AND credit > 0))   -- BR-F2: 借贷互斥
CHECK (debit > 0 OR credit > 0)          -- BR-F2: 不能全零
```

**索引**: `(journal_entry_id)`, `(gl_account_id)`

### `journal_entry_attachment`（凭证附件）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | |
| journal_entry_id | bigint | → journal_entry.id |
| file_name | text | 原始文件名 |
| file_size | integer | 字节数 |
| storage_path | text | Storage bucket 内路径：`{entryId}/{timestamp}_{safeName}` |
| mime_type | text | |
| created_at | timestamptz | |

### `journal_entry_edit_log`（修改审计追踪）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigserial PK | |
| journal_entry_id | bigint | → journal_entry.id |
| action | text | created / updated / posted / reversed / submitted / approved / rejected |
| changed_at | timestamptz | |
| changed_by | uuid | → auth.users |
| summary | text | 操作摘要 |

### `approval_tier`（审批层级）
| 列 | 类型 | 说明 |
|----|------|------|
| id | serial PK | |
| name | text UNIQUE | manager / director / cfo / ceo |
| label | text | 显示名 |
| approval_limit | numeric(18,2) | NULL = 无限额 |
| sort_order | int | |
| created_at | timestamptz | |

### `user_profile`（用户权限档案）
| 列 | 类型 | 说明 |
|----|------|------|
| user_id | uuid PK | → auth.users.id，CASCADE DELETE |
| display_name | text | |
| email | text | |
| approval_tier_id | int | → approval_tier.id |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### `ap_invoice`（应付发票）
见 `docs/modules/03_ap-ar.md`

### `ar_invoice`（应收发票）
见 `docs/modules/03_ap-ar.md`

### `payment` / `payment_application`
见 `docs/modules/03_ap-ar.md`

---

## VIEW：`account_balance`

```sql
CREATE OR REPLACE VIEW account_balance AS
SELECT
    a.id, a.account_code, a.name, a.account_type,
    a.parent_id, a.is_postable, a.is_active,
    COALESCE(SUM(jel.debit), 0)  AS total_debit,
    COALESCE(SUM(jel.credit), 0) AS total_credit,
    CASE
        WHEN a.account_type IN ('asset', 'expense')
            THEN COALESCE(SUM(jel.debit) - SUM(jel.credit), 0)
        ELSE
            COALESCE(SUM(jel.credit) - SUM(jel.debit), 0)
    END AS balance
FROM gl_account a
LEFT JOIN journal_entry_line jel ON jel.gl_account_id = a.id
LEFT JOIN journal_entry je
    ON je.id = jel.journal_entry_id AND je.status = 'posted'
GROUP BY a.id, a.account_code, a.name, a.account_type,
         a.parent_id, a.is_postable, a.is_active;
```

---

## Storage Bucket

| Bucket 名 | 访问权限 | 说明 |
|----------|---------|------|
| `journal-attachments` | 私有（Private） | 凭证附件，通过签名 URL（1小时有效）访问 |

文件路径格式：`{entryId}/{timestamp}_{sanitizedFileName}`

文件名净化规则（`sanitizeFileName()`）：
- 非 ASCII 字符（中文等）→ `_`
- 空格、特殊字符 → `_`
- 连续下划线合并
- 文件名主体截断至 80 字符
- 保留原始扩展名

---

## Section 9 — 用户权限系统（Auth Module）

> Migration M-009 建表，M-010 增加 auth 绑定列。

### `erp_user`（ERP 内部用户档案）
| 列 | 类型 | 说明 |
|----|------|------|
| id | uuid PK | `gen_random_uuid()` |
| auth_user_id | uuid | → auth.users(id) UNIQUE，允许 NULL（M-010 新增） |
| full_name | text | 显示名 |
| email | text UNIQUE | |
| department | text | 部门 |
| manager_id | uuid | → erp_user.id 自引用，上级领导 |
| is_active | boolean | 默认 true |
| created_at | timestamptz | |

**关联**: 新 Auth 用户注册后由触发器 `on_auth_user_created` 自动创建对应行。

---

### `user_module_access`（用户可访问模块）
| 列 | 类型 | 说明 |
|----|------|------|
| user_id | uuid | → erp_user.id，ON DELETE CASCADE |
| module_id | text | 模块标识符（finance / workflow / warehouse / sales / production） |
| PK | (user_id, module_id) | |

---

### `user_permission_grant`（细粒度权限授予）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | GENERATED ALWAYS AS IDENTITY |
| user_id | uuid | → erp_user.id，ON DELETE CASCADE |
| module_id | text | 所属模块 |
| resource | text | 资源（journal_entry / chart_of_accounts / workflow 等） |
| permission | text | 操作（view / create / edit / delete / approve） |
| approval_limit | numeric | 审批金额上限（NULL = 无限额，仅 approve 权限有效） |
| granted_at | timestamptz | 授权时间 |
| granted_by_id | uuid | 授权人（可为 NULL） |
| UNIQUE | (user_id, module_id, resource, permission) | |

---

### `workflow_definition`（工作流定义，M-008）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | GENERATED ALWAYS AS IDENTITY |
| name | text | |
| description | text | |
| nodes_json | jsonb | React Flow 节点数组（含位置、类型、配置） |
| edges_json | jsonb | React Flow 连线数组 |
| status | text | draft / active / archived |
| created_by | uuid | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### `workflow_run`（工作流执行历史，M-008）
| 列 | 类型 | 说明 |
|----|------|------|
| id | bigint PK | GENERATED ALWAYS AS IDENTITY |
| workflow_id | bigint | → workflow_definition.id |
| triggered_by | text | manual / schedule / event |
| status | text | running / completed / failed |
| result_json | jsonb | 执行结果 |
| error_message | text | 失败时的错误信息 |
| started_at | timestamptz | |
| finished_at | timestamptz | |

---

### RPC：`list_erp_users()`（M-010/M-011）
SECURITY DEFINER 函数，读取 auth.users 并与 erp_user 合并：

```sql
SELECT
  ep.id                    AS erp_user_id,
  ep.auth_user_id,
  COALESCE(au.email, ep.email)         AS email,
  COALESCE(au.raw_user_meta_data->>'full_name', ep.full_name, ...) AS full_name,
  ep.department, ep.manager_id, mgr.full_name AS manager_name,
  ep.is_active, ep.created_at
FROM erp_user ep
LEFT JOIN auth.users au  ON au.id = ep.auth_user_id
LEFT JOIN erp_user mgr   ON mgr.id = ep.manager_id
ORDER BY ...
```

**说明**: 以 `erp_user` 为主表，即使没有对应 auth 账号的记录也会返回（如种子数据）。

---

## 批次追溯查询思路（递归 CTE）

```
正向追溯（原料批次 → 哪些产品 → 发给哪些客户）：
  lot → production_consumption → production_order
      → production_output → finished lot
      → shipment_line → shipment → customer

反向追溯（成品批次 → 用了哪些原料）：
  lot → production_output → production_order
      → production_consumption → raw material lots
```

使用 PostgreSQL `WITH RECURSIVE` 实现，非 Schema 中的表，而是查询逻辑。

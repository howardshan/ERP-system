# Logs & Audit 模块（中央系统日志）

> **状态：已实现（M-155）。** 顶层模块，把全系统已记录的操作/日志聚合到一处，按人员 / 模块 / 时间 / 关键词筛选。

## 背景 / 目标

系统各模块已各自写审计日志（`finance_audit_log` M-018、`hr_audit_log` M-029、`qc_product_audit_log` M-148、`auth_audit_log` M-153），外加若干运营事件表，但分散、各有独立查看页，没有统一入口。本模块提供一个**跨模块**的集中查询页，供管理员审计。

**设计取舍**：用一层**只读视图**聚合现有表，**不新建中央表、不改各模块写入逻辑**——现有数据自动可见，将来新模块加审计只需更新视图；避免大重构和数据重复。

## 统一视图 `v_system_audit_log`（M-155）

`UNION ALL` 7 张源表，归一为：
`id / source / module / ts / actor_auth_id / actor_name / action / entity_type / entity_id / summary / detail(jsonb)`

- `id` = `source || ':' || pk::text`（跨 union 唯一）。
- `detail` 携带各源表的 diff / before / after / payload，前端展开行直接读，无需二次回查。

| 源表 | module | ts | actor_name | action | summary |
|---|---|---|---|---|---|
| finance_audit_log | finance | changed_at | actor_name | action | description |
| hr_audit_log | hr | changed_at | actor_name | action | description |
| qc_product_audit_log | qc | changed_at | actor_name | action | description |
| auth_audit_log | auth | changed_at | actor_name | action | description |
| qc_quality_event | qc | created_at | LEFT JOIN erp_user→full_name | event_type | `qc_quality_event_summary()` |
| prod_downtime_event | production | created_at | created_by(文本) | `downtime` | reason(label) + note |
| notification_log | notifications | created_at | —（无操作人） | status | subject |

**排除**：`journal_entry_edit_log`（与 finance_audit_log 重复）、`hr_calendar_event`（面试排程业务数据，非操作日志）。

**安全**：视图以 owner 身份运行（默认非 invoker），可跨表读取；访问控制在 app 层用 `logs.entries.view` 门控，与现有审计表「表可读、页面权限门控」一致。

## 前端

- **模块注册**（照搬 auth 模块的四处接入）：`permissionStructure.ts`（新增顶层 `logs` 模块，资源 `entries.view` + `module_permissions.manage`）、`HomePage.tsx`（MODULES 卡片，i18n `homePage.modules.logs.*`）、`App.tsx`（`activeModule==='logs'` → `<LogsModule>`）、`lib/moduleVisibility.ts`（ALL_MODULES 加 logs）。
- **页面** [`src/pages/logs/LogsModule.tsx`](../../src/pages/logs/LogsModule.tsx)：仿 finance `AuditLog`。筛选 = 人员下拉（复用 `authApi.getUsers()`，按 `actor_auth_id` 过滤）+ 模块下拉 + 时间区间（from/to）+ 搜索（ilike summary/actor/entity/action）+ 清除；分页 load more；行展开看 `detail`。门控 `logs.entries.view`，无权限显示 ShieldOff。
- **API** [`src/services/logsApi.ts`](../../src/services/logsApi.ts)：`getSystemLog({module, actor_auth_id, from, to, search, limit, offset})` 查视图。
- **i18n**：新命名空间 `logs`（en/zh/es），在 `src/i18n/index.ts` 静态注册。

## 权限

| 权限 | 说明 |
|---|---|
| `logs.entries.view` | 查看中央系统日志（管理员）。M-155 已 seed 给 `ysha@smu.edu`，并加 `user_module_access('logs')`。 |

## 已知边界 / 后续增量

- 中央页只显示**已被记录**的操作。**warehouse / sales / workflow / packaging / production 工单等模块当前无审计埋点**，本期不覆盖——给这些模块补埋点是后续增量工程。
- 运营事件表（尤其 notification_log）无操作人，actor 列为空属正常。
- 视图为读时聚合，超大数据量下分页排序可能需后续给运营事件表补 `created_at` 索引或物化——当前规模不需要。

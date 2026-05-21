# 项目协作规则

## 文档同步规则(强制)

每次修改代码或 SQL / migration 后,必须在同一次任务中同步更新 `docs/` 下的相关文档,不得遗漏。

### 触发条件
只要本次改动涉及以下任一情况,就必须更新文档:
- 修改了数据库 schema、新增/修改 migration、改动 edge functions
- 新增/修改/删除了业务逻辑、业务规则(BR)、模块功能
- 改动了 API、数据模型、权限角色等对外可见的行为

### 文档对应关系
- **数据库结构 / migration / edge functions 变动** → 更新 `docs/database/03_migrations-and-edge-functions.md`
  - 新增 migration 时,补充对应的 M-xxx 条目
  - 同步更新文件内的「快速参考表」
- **业务模块变动** → 更新对应的 `docs/modules/` 文件:
  - 总账相关 → `docs/modules/01_general-ledger.md`
  - 用户与认证相关 → `docs/modules/06_users-auth.md`
  - HR 相关 → `docs/modules/07_hr.md`
  - 财务审计日志相关 → `docs/modules/08_finance-audit-log.md`
- **若改动引入了新的业务规则(BR)**,在对应模块文档中补充该 BR 的编号与说明
- **若新增了模块或文档结构有变动** → 同步更新 `docs/README.md`

### 撰写要求
- 文档条目要写清楚:改了什么、为什么、影响范围
- 设计决策类的改动(如字段命名、表结构取舍)要在文档中说明设计理由
- 涉及编号的(M-xxx、BR-xxx)按现有序号顺延,不要跳号或重复
- 文档更新与代码改动在同一次提交/任务中完成,保持同步

### 检查
完成任务前,自查:本次代码改动对应的文档是否都已更新?如有遗漏,补齐后再结束。

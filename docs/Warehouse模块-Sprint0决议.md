# Warehouse 模块 Sprint 0 决议文档

> **文档类型：** Sprint 0 前置决议（草案待审）
> **依据：** `Warehouse模块开发计划书.md` v1.0、现有代码库验证结果（2026-05-24）
> **状态：** 🟢 4 项决议已选择（均为方案 A），含跨决议实施细则（2026-05-24 修订）— 待签字归档
> **创建日期：** 2026-05-24
> **最近修订：** 2026-05-24（追加 §3.5、§4.5、§5）

---

## 0. 文档目的

Warehouse 计划书 v1.0 中有若干假设与现有代码不一致或方案模糊，进入 Sprint 0 前必须明确，否则 schema migration、`wh_sync_release_from_qc` 函数、UI 都会因为"基座未定"而返工。

本文档锁定以下 **4 个关键决议**：


| #   | 决议项                               | 影响范围                                     | 紧迫度   |
| --- | --------------------------------- | ---------------------------------------- | ----- |
| 1   | QC 主数据 ↔ ERP `item` 的桥接方式（主键类型差异） | Sprint 0 schema、QC 模块是否被改动               | 🔴 极高 |
| 2   | ERP `lot` 与 QC 工作单元的粒度对齐          | lot 数量、追溯精度、放行触发点                        | 🔴 极高 |
| 3   | QC 状态变迁 ↔ ERP `lot.status` 的同步事件集 | `wh_sync_release_from_qc` 实现复杂度、S2-S4 工期 | 🟡 高  |
| 4   | 包装出库写 `ship` 流水的版本归属（v1.0 / v1.1） | v1.0 末交付内容、BR-W4 可演示性                    | 🟡 高  |


---

## 决议 1：QC ↔ ERP 主数据桥接（PK 类型差异）

### 1.1 现状


| 表                | 主键                  | 来源                                     |
| ---------------- | ------------------- | -------------------------------------- |
| `qc_product_sku` | **UUID**            | `20260520000001_qc_initial_schema.sql` |
| `item`           | **bigint IDENTITY** | `20260517000000_initial_schema.sql`    |


两表当前**无直接关联**。计划书 §8.1 把"加 `qc_product_sku.item_id`"列为简单变更，但忽略了 PK 类型不一致带来的取舍。

### 1.2 备选方案

#### 方案 A — 在 `qc_product_sku` 加 `item_id bigint REFERENCES item(id)` ⭐ 推荐

```sql
ALTER TABLE qc_product_sku
  ADD COLUMN item_id bigint REFERENCES item(id);
CREATE INDEX idx_qc_sku_item ON qc_product_sku(item_id);
```


| 维度      | 评估                                       |
| ------- | ---------------------------------------- |
| 改动表数量   | 1（仅 `qc_product_sku`）                    |
| 查询性能    | 单次 JOIN，索引可覆盖                            |
| QC 模块影响 | 字段新增，向后兼容（NULLable 起步）                   |
| 数据回填    | 需手工对照 QC SKU 与 ERP item，一次性脚本            |
| 反规范化风险  | 低 — item 主数据由 ERP 拥有，qc_product_sku 只持引用 |


#### 方案 B — 新建 `qc_sku_item_map` 中间表

```sql
CREATE TABLE qc_sku_item_map (
  qc_sku_id uuid NOT NULL REFERENCES qc_product_sku(id),
  item_id   bigint NOT NULL REFERENCES item(id),
  effective_date date NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY (qc_sku_id, item_id)
);
```


| 维度      | 评估                                   |
| ------- | ------------------------------------ |
| 改动表数量   | 0（QC 模块零侵入）                          |
| 查询性能    | 每次双 JOIN                             |
| QC 模块影响 | 无 — 适合 QC 模块独立演进的场景                  |
| 反规范化风险  | 中 — 多对多语义会被误用，需 CHECK 约束             |
| 适用场景    | 一个 QC SKU 对应多个 ERP item（如散装 vs 包装规格） |


### 1.3 初步倾向

☑ **方案 A**（2026-05-24 评审，依据：v1.0 是 QC + Warehouse 同属一套 ERP，QC 不会独立演进；A 方案查询路径短、回填一次到位）

### 1.4 决议

```
☑ 方案 A     ☐ 方案 B     ☐ 其他：__________

签字：__________     日期：__________
```

### 1.5 ⚠️ 现状更新（2026-05-26）：本决议已被实现演进取代

方案 A（加 `qc_product_sku.item_id` **一对一**列）**已不再是现状**。团队在 M-087（`20260525000008_qc_sku_item_junction.sql`）中：

- 删除了 `qc_product_sku.item_id` 列（我的 M-080 被回退）；
- 改用 `qc_sku_item` **联结表**（一对多：1 个 QC SKU → 多个 ERP item，对应不同袋装规格/客户标签）；
- 并在 `qc_production_lot.packaging_item_id`（M-092 加列，M-095 让建车 RPC 写入）记录**每张工单选定的最终产品 item**。

**对本决议的影响**：决议 1 的"一对一"前提作废，现实更接近原方案 B（联结表）但为一对多。后续所有"QC SKU → ERP item"的引用，一律改用 `qc_sku_item` + `qc_production_lot.packaging_item_id`。S4 实施细则随之调整，见 §5.6。

---

## 决议 2：ERP `lot` 与 QC 工作单元的粒度

### 2.1 现状与冲突

计划书内部存在不一致：

- §16「假设」：**一车一批次 lot**（即 1 车 = 1 lot）
- §5.2 数量过账表：**「车/子批级与 lot 1:1 后记账」**（车 ≠ 子批）

QC 实际有三层结构：

```
qc_production_lot   ← 一个生产批次（一车）
    └─ qc_drying_sub_lot  ← 同车被分组后的子批（用于采样、分组通过/不通过）
        └─ qc_drying_location  ← 烘干炉位（cell 级，QC 内部用）
```

`qc_drying_sub_lot` 在 [20260520000001](../eee-main/supabase/migrations/20260520000001_qc_initial_schema.sql) 后有多次扩展，目前可能 1 个 production_lot 包含 1~N 个 sub_lot。

### 2.2 备选方案

#### 方案 A — 1 `qc_production_lot` = 1 ERP `lot` ⭐ 推荐

- 在 `qc_production_lot` 创建时同步生成 ERP `lot`
- `qc_drying_sub_lot` 不直接绑 lot；通过 `production_lot_id → qc_production_lot → lot_id` 间接查
- 放行/拒收：一个 production_lot 内的 N 个 sub_lot 全部到达终态后，再决定整 lot 是 `available` 还是部分拆分


| 维度         | 评估                                  |
| ---------- | ----------------------------------- |
| ERP lot 数量 | 较少（与车数相同）                           |
| 追溯精度       | 车级                                  |
| 实现复杂度      | 低 — 一次性创建，状态聚合在放行时计算                |
| 业务匹配度      | 高 — 客户日常按车号管理                       |
| 风险         | 同车内有 sub_lot 部分合格部分不合格时，需要"拆 lot"逻辑 |


#### 方案 B — 1 `qc_drying_sub_lot` = 1 ERP `lot`

- 每个 sub_lot 在创建时生成独立 lot
- 同车的 sub_lot 共享 `qc_production_lot.lot_number` 前缀（如 `RM-20260524-0001-A`、`-B`）


| 维度         | 评估                                 |
| ---------- | ---------------------------------- |
| ERP lot 数量 | 较多（sub_lot 数量级）                    |
| 追溯精度       | 子批级                                |
| 实现复杂度      | 中 — 但状态机简单（sub_lot → lot 1:1 同步即可） |
| 业务匹配度      | 中 — 仓库主管可能不关心子批                    |
| 风险         | lot 数量膨胀，期初导入和报表性能需关注              |


#### 方案 C — 放行时按 sub_lot 懒创建 ERP `lot`

- 进烘干前不创建 lot；只在 `qc_release_passed_sub_lot` 成功时创建
- ERP 视角：只有"已放行"的库存才有 lot


| 维度         | 评估                                         |
| ---------- | ------------------------------------------ |
| ERP lot 数量 | 最少 — 只覆盖合格部分                               |
| 追溯精度       | 子批级，但不合格品无 lot                             |
| 实现复杂度      | 高 — 不合格品需要"伪 lot"或"占位 lot"才能记 `LOC-NG` 库存  |
| 业务匹配度      | 低 — BR-W4 要求不合格批次能被阻断出库，无 lot 难以引用         |
| 风险         | 与 BR-W5 冲突（待检区批次必须有 lot.status=quarantine） |


### 2.3 初步倾向

☑ **方案 A**（2026-05-24 评审）

**配套规则（如选 A 需要补充）：**

- 当一个 `qc_production_lot` 内有 sub_lot 不合格时：合格部分仍然在原 lot 中放行至 `LOC-PACK-STAGE`；不合格部分通过 `inventory_transaction` 调拨至 `LOC-NG`，**lot 不拆分**，但 lot 内不同位置的余额分别可见
- BR-W1 的措辞将从「以子批/车为单位过账」精简为「以车（`qc_production_lot`）为单位过账」

> **现状更新（2026-05-26）**：决议 A 仍成立。一对多桥接（§1.5）下"lot 归哪个 item"的歧义，由 `qc_production_lot.packaging_item_id`（每工单选定的最终产品）解决——建车时创建的 ERP lot 即以 `packaging_item_id` 为 `item_id`，代表该工单的**成品**。

### 2.4 决议

```
☑ 方案 A     ☐ 方案 B     ☐ 方案 C     ☐ 其他：__________

如选 A，是否同意"不拆 lot"的处理方式？  ☑ 同意    ☐ 不同意（请补充：________）

签字：__________     日期：__________
```

---

## 决议 3：QC 状态 ↔ ERP `lot.status` 同步事件集

### 3.1 现状

QC 当前的 `qc_drying_sub_lot.status` 枚举有 12 个值：
`created` / `drying` / `awaiting_recheck` / `room_temp_drying` / `pending` / `inspecting` / `passed` / `hold` / `disposing` / `closed` / `awaiting_group_result` / `dispatched`

ERP `lot.status` 只有 6 个值：
`quarantine` / `available` / `on_hold` / `consumed` / `rejected` / `expired`

计划书 §5.2 列出了 5+ 个同步过账时点。**问题：v1.0 是否全部实现？**

### 3.2 备选方案

#### 方案 A — 最小同步：只在放行/拒收时同步 ⭐ 推荐（v1.0）


| QC 事件                           | ERP 动作（已按 §3.5 修订）                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| `qc_release_passed_sub_lot` 成功  | transfer **该 sub_lot 数量**：`LOC-QC-PENDING → LOC-PACK-STAGE`；**lot.status 不立刻改**，按 §5.1 聚合判定 |
| QC 标记 `hold` / `disposing`      | transfer **该 sub_lot 数量**：当前位置 → `LOC-NG`；**lot.status 不立刻改**，按 §5.1 聚合判定                    |
| 其他 QC 状态变化（drying、inspecting 等） | **不触发任何 ERP 动作**                                                                            |

> ⚠️ **重要：** 上表已修订。原措辞"按 sub_lot 改 lot.status"在"部分合格"场景下会与决议 2 的"不拆 lot"原则冲突。修订后改为**按 sub_lot 过账数量、按 lot 聚合状态**。详见 §3.5。


**优点：**

- 只需修改 1 个 QC RPC（`qc_release_passed_sub_lot`）
- S4 联调用例可控（核心 2 条 happy path + 4 条异常）
- 库存余额变化频率低，期初对账简单

**缺点：**

- 烘干区、待检区在 ERP 看是同一个 lot，**位置不变**（只有放行才动）
- 若客户要看"现在多少车在烘干"，需查 QC 而不是 ERP

#### 方案 B — 按计划书 §5.2 全量同步


| QC 事件                        | ERP 动作                                  |
| ---------------------------- | --------------------------------------- |
| 生产建车（`qc_production_lot` 创建） | `wh_post_receipt`：→ `LOC-PRE-DRY`       |
| 进烘干房 check-in                | transfer：`LOC-PRE-DRY → LOC-DRY-WIP`    |
| 出烘干房 check-out               | transfer：`LOC-DRY-WIP → LOC-QC-PENDING` |
| 放行 / 拒收                      | 同方案 A                                   |


**优点：**

- ERP 与现场实时一致，余额报表"所见即所得"
- 包装、销售模块未来可以从 ERP 拿到全量物理位置

**缺点：**

- 需修改 4+ 个 QC RPC，每个都要做事务原子性处理
- S4 至少要 3 周（而非计划的 2 周）
- 失败回滚路径多，QC 现有 12 个状态值全部需要分类决策

#### 方案 C — 仅同步放行（极简）

只实现 `wh_sync_release_from_qc`，不实现 hold 同步。

**淘汰**：与 BR-W4「不合格禁止出库」冲突，不合格批次没有 lot 状态约束就无从阻断。

### 3.3 初步倾向

☐ **未拍板** — 取决于客户是否要求 ERP 实时反映烘干区状态

**建议讨论点：**

- 客户日常是用 QC 模块还是 ERP 模块查"现在多少车在烘干"？
  - 用 QC → 选 A
  - 用 ERP → 选 B
- v1.0 上线后，仓库主管是否需要从 ERP 余额页看到 `LOC-DRY-WIP` 的实时数量？

### 3.4 决议

```
☑ 方案 A（最小同步，推荐 v1.0）
☐ 方案 B（全量同步，按 §5.2）
☐ 方案 A 起步，v1.1 升级到 B
☐ 其他：__________

签字：__________     日期：__________
```

### 3.5 实施细则（部分合格场景）— 2026-05-24 修订

#### 问题场景

一个 `qc_production_lot`（车级 lot）内有 N 个 `qc_drying_sub_lot`，其中 M1 个 pass、M2 个 hold、其余仍在 `inspecting`。

#### 原措辞的矛盾

- **决议 2 配套规则：** "合格部分仍在原 lot 中放行至 `LOC-PACK-STAGE`；不合格部分调拨至 `LOC-NG`，**lot 不拆分**" → 暗示 `lot.status` 保持 `available`
- **决议 3 方案 A 原措辞：** "QC 标记 `hold` → `lot.status = 'on_hold'`" → 把**整 lot** 标 `on_hold`

→ 同一个 lot 既要"合格部分 available 出包装"又要"整 lot on_hold 禁出库"——做不到。

#### 修订规则

1. **`inventory_transaction` 按 sub_lot 触发，多次小额过账**
   - 每个 sub_lot 到达终态时立即写入对应 transfer（数量 = 该 sub_lot 的实际量）
   - 同一个 lot 的库存会出现在多个 location 中并存：合格部分在 `LOC-PACK-STAGE`、不合格在 `LOC-NG`、未检的还在 `LOC-QC-PENDING`

2. **`lot.status` 不再"按 sub_lot 即时更新"，改为全车终态聚合**（详见 §5.1）

3. **BR-W4 的阻断不再单靠 lot.status，改为双条件校验**（详见 §5.2）

#### 数据流示例

```
车 RM-20260524-0001 含 3 个 sub_lot（各 100 kg）：
  T0：全部 inspecting，lot.status = quarantine，300 kg 在 LOC-QC-PENDING
  T1：sub_lot A pass → transfer 100 kg 至 LOC-PACK-STAGE，lot.status 保持 quarantine
  T2：sub_lot B hold → transfer 100 kg 至 LOC-NG，lot.status 保持 quarantine
  T3：sub_lot C pass → transfer 100 kg 至 LOC-PACK-STAGE，**聚合判定** → lot.status = available（混合视为可用）

最终库存（同一 lot 跨多 location 共存）：
  (RM-20260524-0001, LOC-PACK-STAGE) = 200 kg ✅ 可出包装
  (RM-20260524-0001, LOC-NG)         = 100 kg ❌ 被 location_type 阻断
  lot.status = available
```

---

## 决议 4：包装写 `ship` 流水的版本归属

### 4.1 现状

[pkg_dispatch_carts](../eee-main/supabase/migrations/20260523000005_packaging_module.sql) 当前**不写任何 `inventory_transaction`**——只把 `qc_drying_sub_lot.status` 改成 `dispatched`。

计划书 §8.3 将"包装写 `ship` 流水"标为 **v1.1**，但这与 BR-W4（不合格禁止出库）存在张力：

> 若 v1.0 不让包装写 `ship` 流水，BR-W4 在出库环节就无从校验—— 因为根本没有"出库"这个 ERP 事件可以拒绝。

### 4.2 备选方案

#### 方案 A — 包装写 `ship` 流水纳入 v1.0 末（S5）


| 工作量                                                   | 估算                        |
| ----------------------------------------------------- | ------------------------- |
| 修改 `pkg_dispatch_carts` 增加 `_wh_apply_transaction` 调用 | 0.5 周                     |
| 增加 BR-W4 检查（在 RPC 内拒绝 `on_hold`/`rejected`）           | 0.3 周                     |
| 联调用例                                                  | 0.3 周                     |
| **小计**                                                | **约 1 周（占用 S5 约 50% 时间）** |


**优点：**

- BR-W4 完整可演示
- v1.0 验收清单 §4.3 的"权限/角色分离演示"含金量更高
- 包装模块上线后立刻有"实物对账"能力

**缺点：**

- S5 已经塞了期初导入 + UAT + 模块文档，压力大
- 需要在 v1.0 内把 `lot_id` 真正贯穿到 `qc_drying_sub_lot.lot_id` 字段（即决议 1+2 必须先落地）

#### 方案 B — 推迟到 v1.1（计划书原方案）

**优点：**

- v1.0 工期可控
- S5 专注期初导入与 UAT

**缺点：**

- BR-W4 在 v1.0 只能"纸面存在"——验收清单需要降级
- v1.0 上线后到 v1.1 之间，包装出库无 ERP 流水，**期初快照与日常运营之间有一段灰色期**
- 客户若早期发现不合格品被包装出库，无 ERP 数据可查

#### 方案 C — 折中：v1.0 写流水但不强制 BR-W4

- `pkg_dispatch_carts` 写 `ship` 流水（轻量改造，约 0.5 周）
- BR-W4 的阻断逻辑延后到 v1.1
- 数据基础打好，规则后补

**优点：** 数据完整性 vs 工期取得平衡
**缺点：** "写了但不校验" 容易被遗忘，需要 v1.1 计划明确续接

### 4.3 初步倾向

☐ **未拍板** — 与决议 2/3 联动：

- 若决议 2 选 A（车级粒度）+ 决议 3 选 A（最小同步），**强烈建议本决议选 C 或 A**：因为车级粒度下，lot 数量少，写 ship 流水成本低；不写 ship 流水会让 v1.0 的"BR-W4 可演示"成为空头支票
- 若决议 3 选 B（全量同步），S4 已经吃紧，本决议倾向 B（延后）

### 4.4 决议

```
☑ 方案 A（v1.0 完整写流水 + 校验 BR-W4）
☐ 方案 B（v1.1 再做）
☐ 方案 C（v1.0 写流水但不强制 BR-W4）
☐ 其他：__________

签字：__________     日期：__________
```

### 4.5 实施细则（lot_id 查找路径）— 2026-05-24 修订

#### 问题

决议 2 把 `lot_id` 加在 `qc_production_lot` 上，而 `pkg_dispatch_carts` 与所有出库 RPC 的操作单位是 `sub_lot`。若不做处理，每次出库都要 join：

```sql
sub_lot.production_lot_id → qc_production_lot.lot_id
```

——代码冗长、易漏写、报表性能差。

#### 修订方案：在 `qc_drying_sub_lot` 冗余 `lot_id`

```sql
-- Migration A：在 qc_production_lot 加 lot_id（决议 2 原本就要做）
ALTER TABLE qc_production_lot
  ADD COLUMN lot_id bigint REFERENCES lot(id);
CREATE INDEX idx_qc_prod_lot_lot ON qc_production_lot(lot_id);

-- Migration B（本节新增）：在 qc_drying_sub_lot 冗余 lot_id
ALTER TABLE qc_drying_sub_lot
  ADD COLUMN lot_id bigint REFERENCES lot(id);
CREATE INDEX idx_qc_sub_lot_lot ON qc_drying_sub_lot(lot_id);

-- 触发器：sub_lot 创建/production_lot 变更时同步
CREATE OR REPLACE FUNCTION qc_sync_sub_lot_lot_id()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.production_lot_id IS DISTINCT FROM OLD.production_lot_id THEN
    SELECT lot_id INTO NEW.lot_id
    FROM qc_production_lot
    WHERE id = NEW.production_lot_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_qc_sync_sub_lot_lot_id
  BEFORE INSERT OR UPDATE ON qc_drying_sub_lot
  FOR EACH ROW EXECUTE FUNCTION qc_sync_sub_lot_lot_id();
```

#### 为什么用触发器而不是 PostgreSQL 生成列

生成列要求源字段不可变（`STORED` 列要求 `IMMUTABLE` 表达式）。`qc_drying_sub_lot.production_lot_id` 当前可被改组重排（参见 [20260523000001_qc_checkout_regroup_redry_carts.sql](../eee-main/supabase/migrations/20260523000001_qc_checkout_regroup_redry_carts.sql)），故触发器更稳。

#### 影响

| 项 | 影响 |
|----|------|
| 决议 2 落地 migration 数 | **1 → 2**（见 §落地动作） |
| 出库 RPC 代码 | 直接用 `sub_lot.lot_id`，无需 join |
| 回填历史数据 | 现有 sub_lot 需一次性 backfill：`UPDATE qc_drying_sub_lot SET lot_id = ...` |
| `wh_post_ship_from_packaging` 实现复杂度 | 显著降低 |

---

## 5. 跨决议实施细则

为协调决议 2、3、4 在边缘场景下的一致性，补充以下跨决议规则。这些规则**必须**作为 S0 末交付物的一部分写入 `eee-main/docs/modules/11_warehouse-inventory.md`。

### 5.1 `lot.status` 聚合规则

决议 2 选 A（车级粒度）+ 决议 3 选 A（最小同步）+ 不拆 lot 的组合下，`lot.status` **不再按 sub_lot 即时变化**，改为以下聚合规则：

```
聚合时机：每次 qc_release_passed_sub_lot 或 qc_hold_sub_lot 触发完毕后
聚合输入：该 lot 下所有 sub_lot 的当前 status
聚合输出（按优先级，从上到下匹配）：

  1. 仍有 sub_lot 未到终态（不在 {passed, closed, hold, disposing, rejected}）
     → lot.status 保持原值（首次创建为 'quarantine'）

  2. 全部 sub_lot ∈ {passed, closed}
     → lot.status = 'available'

  3. 全部 sub_lot ∈ {hold, disposing, rejected}
     → lot.status = 'on_hold'

  4. 终态混合（既有 pass 又有 hold/reject）
     → lot.status = 'available'
        理由：合格部分有出库价值，不合格部分靠物理位置（LOC-NG）和 §5.2 双条件校验阻断
```

**实现位置：** 新建函数 `wh_recompute_lot_status(p_lot_id bigint)`，由 `wh_sync_release_from_qc` 在事务末尾调用。

### 5.2 BR-W4 双条件校验

原 BR-W4 措辞："`LOC-NG` / `on_hold` / `rejected` 批次禁止 `issue` / `ship` / `production_consume`"。

按 §5.1 聚合规则，**lot 整体可能是 `available` 但仍有部分库存物理上在 `LOC-NG`**。因此 BR-W4 必须升级为双条件校验：

```sql
-- 在 _wh_apply_transaction 的出库分支中：
IF p_transaction_type IN ('issue','ship','production_consume') THEN
  -- 条件 1：lot 状态
  SELECT status INTO v_lot_status FROM lot WHERE id = p_lot_id;
  IF v_lot_status IN ('on_hold','rejected','expired') THEN
    RAISE EXCEPTION 'BR-W4: lot % is % and cannot be issued', p_lot_id, v_lot_status;
  END IF;

  -- 条件 2：来源 location 类型
  SELECT location_type INTO v_loc_type FROM location WHERE id = p_location_id;
  IF v_loc_type = 'quarantine' THEN
    RAISE EXCEPTION 'BR-W4: location % is quarantine-typed and cannot be issued from', p_location_id;
  END IF;
END IF;
```

#### BR-W4 修订措辞（同步更新到 [files/business-rules.md](../../files/business-rules.md)）

> **BR-W4 — Rejected / on-hold stock is not issuable.**
> 出库类型（`issue` / `ship` / `production_consume`）必须同时满足：
> (1) `lot.status` ∉ {`on_hold`, `rejected`, `expired`}；
> (2) 来源 `location.location_type` ≠ `quarantine`。
> 任一条件不满足，RPC 必须拒绝并回滚事务。

### 5.3 BR-W1 措辞精化

决议 2 选 A 后，BR-W1 原措辞"以子批/车为单位过账"在"粒度"上不准确（lot 是车级，transaction 是 sub_lot 级）。**同步修订** [files/business-rules.md](../../files/business-rules.md)：

> **BR-W1 — Drying-zone inventory: lot at cart level, transactions at sub-lot level.**
> ERP `lot` 与 `qc_production_lot`（车）1:1；`inventory_transaction` 的过账数量以 `qc_drying_sub_lot`（子批）为单位、对应该子批的实际量。
> 烘干炉位（cell 级）由 QC 模块管理，ERP 不记 cell 数量。

### 5.4 决议间一致性检查表（实施前 self-check）

| 检查项 | 期望 |
|--------|------|
| `qc_production_lot.lot_id` 字段存在并被外键约束 | ✅ Migration A 落地 |
| `qc_drying_sub_lot.lot_id` 冗余字段存在并被触发器维护 | ✅ Migration B 落地 |
| `_wh_apply_transaction` 含 §5.2 双条件校验 | ✅ 在 S1 实现 |
| `wh_recompute_lot_status` 函数存在并被 `wh_sync_release_from_qc` 调用 | ✅ 在 S4 实现 |
| `pkg_dispatch_carts` 调用 `_wh_apply_transaction` 写 `ship` 流水 | ✅ 在 S5 实现 |
| BR-W1、BR-W4 措辞已在 `files/business-rules.md` 同步 | ✅ S0 完成 |

### 5.5 SKU↔item 关联策略与未关联 SKU 的处理（回填方案 b）— 2026-05-24 备忘

#### 回填方案

决议 1 的 `qc_product_sku.item_id` **不做一次性脚本回填**，采用**方案 b**：

- `item_id` 列保持 NULLable
- 建空的 item 主数据 + CRUD UI，由业务人员在界面手动建 item 并关联
- 关联入口放在 **QC 的 [ProductManagement.tsx](../eee-main/src/pages/qc/ProductManagement.tsx)**（QC 人员熟悉自己的 SKU 对应什么物料，比仓库人员更适合做关联）

#### 未关联 SKU 的放行处理（S4 实现）

方案 b 下，某个 QC SKU 可能尚未关联 item。但 D-W04 / BR-W3 要求"放行必须同步 ERP lot"，未关联 item 就建不出 lot。

**决议：把校验关口前移到「建车」环节**——`qc_production_lot` 创建时校验其 `qc_product_sku.item_id IS NOT NULL`，未关联则拒绝建车。这样到放行时一定已关联，放行逻辑无需处理"半成品"状态。

```
建车 (qc_production_lot 创建)
  └─ 校验：SELECT item_id FROM qc_product_sku WHERE id = NEW.product_sku_id
           IF item_id IS NULL THEN RAISE EXCEPTION 'SKU 未关联 ERP 物料，无法建车'
进烘干 → 检验 → 放行 (此时 item_id 必非空，wh_sync_release_from_qc 可正常建 lot)
```

**实现时点：** S4（随 `wh_sync_release_from_qc` 一起），现在仅备忘，不做。

### 5.6 ⚠️ 现状更新（2026-05-26）：桥接模型演进，§5.5 实施细则随之调整

§5.5 写于 `item_id` 一对一时代。随 M-087（junction）+ M-092/M-095（`packaging_item_id`），S4 实施细则调整如下（**今后按右列实现**）：

| §5.5 原假设 | 现状（2026-05-26 起按此实现） |
|------------|------------------------------|
| `qc_product_sku.item_id` 一对一 | `qc_sku_item` 联结表，一对多（1 SKU → 多 item） |
| 关联入口在 QC ProductManagement | 在 ProductManagement / Production 模块**多选维护**（复用 `warehouseApi.listItems` + `qcApi.addSkuItemLink`/`removeSkuItemLink`） |
| 建车校验 `item_id IS NOT NULL` | 建车校验 **`packaging_item_id IS NOT NULL`**（操作员从该 SKU 已关联 item 中选定最终产品） |
| ERP lot 的 item = SKU 唯一 item | ERP lot 的 `item_id` = `qc_production_lot.packaging_item_id`，代表**成品**（烘干工序：原料 → 成品） |

**S4 落点**：`qc_create_production_lot_with_sub_lots` 已接受 `p_packaging_item_id`（M-095）。S4 在其成功后，用 `packaging_item_id` 调 `wh_create_lot` 并回填 `lot_id`（决议 §4.5），其余（§5.1 聚合、§5.2 双条件、§4.5 sub_lot.lot_id 冗余）不变。

---

## 决议依赖关系总览

```
决议 1 (PK 桥接) ──┐
                   ├──► 决议 2 (lot 粒度) ──┐
                   │                        ├──► 决议 4 (包装定位)
                   └────────────────────────┴──► 决议 3 (状态同步)
```

- 决议 1 与决议 2 互不依赖，可并行确认
- 决议 3 依赖决议 2 的结论（粒度决定状态机的复杂度）
- 决议 4 依赖决议 2 + 决议 3（写流水的前提是有 lot_id 和明确的释放时点）

**建议确认顺序：** 1 → 2 → 3 → 4

---

## 落地动作（决议通过后）


| 决议   | 触发的 Sprint 0 工作                                                                                                              |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1 通过 | 起草 migration：`alter_qc_product_sku_add_item_id.sql` + 数据回填脚本                                                                |
| 2 通过 | 起草 2 个 migration：①`alter_qc_production_lot_add_lot_id.sql`；②`alter_qc_drying_sub_lot_add_lot_id.sql`（含触发器，见 §4.5）+ 历史数据 backfill |
| 3 通过 | 修订计划书 §5.2、§8.2，明确 `wh_sync_release_from_qc` 边界；规划 `wh_recompute_lot_status` 函数（见 §5.1）                                       |
| 4 通过 | 修订计划书 §14（S5 工作清单）、§4.3（验收标准）；规划 `_wh_apply_transaction` 双条件校验（见 §5.2）                                                        |
| §5 通过 | 同步修订 [files/business-rules.md](../../files/business-rules.md) 中 BR-W1、BR-W4 措辞；这两条作为 S0 末交付物的一部分写入 `eee-main/docs/modules/11_warehouse-inventory.md` |


---

## 修订记录


| 日期         | 修订者       | 内容                                                                                  |
| ---------- | --------- | ----------------------------------------------------------------------------------- |
| 2026-05-24 | （草案）      | 初稿，4 项决议草案待审                                                                        |
| 2026-05-24 | （项目组评审）   | 4 项决议全部选择方案 A；选 A 后发现决议 2↔3 在"部分合格"场景下有内部矛盾                                          |
| 2026-05-24 | （AI 协助修订）  | 修订 §3.2 方案 A 表格；追加 §3.5（部分合格场景细则）、§4.5（lot_id 冗余方案）、§5（跨决议实施细则：聚合规则、双条件校验、BR-W1/W4 措辞修订） |
| 2026-05-26 | （现状同步）   | QC↔ERP 桥接从 item_id 一对一列演进为 `qc_sku_item` 联结表 + `qc_production_lot.packaging_item_id`（M-087/M-092/M-095）。追加 §1.5、§2.3 注、§5.6；决议 1 与 §5.5 的 S4 实施细则随之更新 |



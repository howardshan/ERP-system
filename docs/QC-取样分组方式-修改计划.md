# QC 取样分组方式 · 修改计划书

> 状态: ✅ 已实施(M-118, `20260527000015_qc_check_out_bulk_sampling_method.sql`)
> 起草: 2026-05-27 / 落地: 2026-05-27
> 范围: QC 批量出烘干时的**抽样组建组算法 + champion 选取规则**
> 关联文档: [`docs/modules/09_qc.md`](modules/09_qc.md) · [`docs/database/03_migrations-and-edge-functions.md`](database/03_migrations-and-edge-functions.md)

---

## 1. 背景与需求来源

测试负责人反馈:现行的「批量出烘干→自动按 N 切片→**随机**选 champion」对操作现场不够友好,实物排列上从最新生产的车开始测更顺手,且不同场景需要两套切片策略。

修改目标:在 **Bulk check-out** 时让操作员**显式选择**抽样方式(两选一),后端按确定性规则建组、确定性选 champion。

| 当前 | 修改后 |
|---|---|
| 按 `sub_lot_code` **升序**(低号→高号)每 N 辆切一组,余数自成一组 | 按 `sub_lot_code` **降序**(高号→低号)切片;两种方式由操作员选 |
| Champion = `random()` 选 | Champion 由确定性规则给出(见下) |
| 操作员无感知,系统自动 | 弹窗里二选一,可在 Confirm 前预览分组 |

不变:
- 抽样率 N 仍取自 SKU 的 `qc_product_sku.sample_every_n_carts`(Production 模块的 Products 页可改)。
- 组传播逻辑(M-055/M-106)、Needs Attention 去重(M-107)、retest 归一化(M-106)**完全不动**——仅改建组阶段。

---

## 2. 现行实现回顾

入口 RPC: [`qc_check_out_sub_lots_bulk`](../supabase/migrations/20260523000019_qc_bulk_checkout_fix_step2_cascade.sql)(最新版 M-075)。Step 2a/2b 的关键片段:

```sql
sample_n := GREATEST(1, sku.sample_every_n_carts);
-- 升序切片
member_ids := grp_rec.cart_ids[chunk_idx + 1 : LEAST(chunk_idx + sample_n, ...)];
-- 随机 champion
champion_id := member_ids[1 + floor(random() * chunk_size)::int];
```

`grp_rec.cart_ids` 由上游 `array_agg(sl.id ORDER BY sl.sub_lot_code)` 生成,即**升序**。

---

## 3. 目标算法(确定性)

> **共通规则**:carts 按 `sub_lot_code` **降序**排成数组(高号在前)。下面所有「位置」均指此降序数组中的 1-indexed 位置。

### 3.1 Method 1 — 「按 N 切片,余数自成一组」(**默认**)

- 从头(最高号)每 N 辆切一组。
- 剩余不足 N 辆自成一组。
- 每组 champion = **该组编号最大**(在降序数组中即位置 1)。

**示例**(用降序数组 `[..]`,champion 加粗):

| T | N | 分组 | champion |
|---|---|---|---|
| 10 | 3 | `[10,9,8]` · `[7,6,5]` · `[4,3,2]` · `[1]` | **10**, **7**, **4**, **1** |
| 4 | 3 | `[4,3,2]` · `[1]` | **4**, **1** |
| 3 | 3 | `[3,2,1]` | **3** |
| 2 | 3 | `[2,1]`(T ≤ N) | **2** |
| 1 | 3 | `[1]` | **1** |
| 9 | 3 | `[9,8,7]` · `[6,5,4]` · `[3,2,1]` | **9**, **6**, **3** |

### 3.2 Method 2 — 「合并余数到最后一组,中偏大 champion」

- 若 `R := T mod N == 0` 或 `T ≤ N` → 与 Method 1 完全一致。
- 否则(R > 0 且 T > N):**少做 1 组常规组**,把 `N + R` 辆放进**最后一组**(最低号那段)。
  - 前 `⌊T/N⌋ − 1` 个常规组:N 辆 / 组,champion = **该组最大**(降序数组位置 1)。
  - 最后 1 个大组:`N + R` 辆,champion = **「中偏大」**。

**「中偏大」位置定义**(对该组按编号**升序**排,K 辆):

$$\text{pos} = \left\lfloor \frac{K}{2} \right\rfloor + 1 \quad (\text{1-indexed,升序})$$

| K | pos | 例(组按升序) | champion |
|---|---|---|---|
| 3 | 2 | `[1,2,3]` | 2 |
| 4 | 3 | `[1,2,3,4]` | 3 |
| 5 | 3 | `[1,2,3,4,5]` | 3 |
| 6 | 4 | `[1,2,3,4,5,6]` | 4 |
| 7 | 4 | `[1,2,3,4,5,6,7]` | 4 |
| 8 | 5 | `[1,2,3,4,5,6,7,8]` | 5 |

**示例**:

| T | N | 分组(降序数组) | champion |
|---|---|---|---|
| 10 | 3 | `[10,9,8]` · `[7,6,5]` · `[4,3,2,1]` | **10**, **7**, **3** ⚠️ |
| 7 | 3 | `[7,6,5]` · `[4,3,2,1]` | **7**, **3** |
| 4 | 3 | `[4,3,2,1]`(单组) | **3** |
| 9 | 3 | `[9,8,7]` · `[6,5,4]` · `[3,2,1]`(R=0,等同 Method 1) | **9**, **6**, **3** |
| 3 | 3 | `[3,2,1]`(T=N,等同 Method 1) | **3** |
| 2 | 3 | `[2,1]`(T<N) | **2** |
| 5 | 3 | `[5,4,3,2,1]`(单大组,⌊5/2⌋+1=3 升序) | **3** |

> ⚠️ T=10/N=3 用户原例写为 `10, 6, 3`,本计划按规则修订为 `10, **7**, 3`(常规组 [7,6,5] 取最大 = 7)。**实施前请确认**。

---

## 4. 实施计划

### 4.1 DB — 新 migration `M-118 qc_check_out_bulk_sampling_method.sql`

`CREATE OR REPLACE FUNCTION qc_check_out_sub_lots_bulk(p_sub_lot_ids uuid[], p_out_time timestamptz DEFAULT NULL, p_sampling_method text DEFAULT 'method_1')` —— 新增第三个参数,默认 `method_1`(向后兼容,不传等价旧行为去掉随机)。

- 校验 `p_sampling_method IN ('method_1','method_2')`,否则报错。
- Step 2a / 2b 的 cart_ids 改为 `array_agg(sl.id ORDER BY sl.sub_lot_code DESC)` —— 降序。
- Step 2a / 2b 的切片 + champion 选取改为下列伪代码:

```text
T := array_length(cart_ids, 1)
R := T mod N
groups := []

if p_sampling_method = 'method_2' AND T > N AND R > 0:
    full_chunks := floor(T / N) - 1      -- 常规组数减 1
    for i in 0..full_chunks-1:
        member := cart_ids[i*N+1 .. (i+1)*N]
        groups.append({ members: member, champion: member[1] })   -- 降序首位 = 最大
    tail := cart_ids[full_chunks*N+1 .. T]                        -- 末段 N+R 辆
    K := array_length(tail)
    tail_asc := reverse(tail)                                     -- 升序
    pos := floor(K/2) + 1
    groups.append({ members: tail, champion: tail_asc[pos] })
else:
    # Method 1,或 Method 2 但 R==0 / T<=N
    chunk_idx := 0
    while chunk_idx < T:
        member := cart_ids[chunk_idx+1 .. min(chunk_idx+N, T)]
        groups.append({ members: member, champion: member[1] })   -- 降序首位 = 最大
        chunk_idx += N
```

- 每个 group 仍 INSERT 到 `qc_test_group`(`member_count=length(members)`),UPDATE sub-lots 设 `test_group_id` / `is_test_champion=(id=champion)` / `status = 'pending' / 'awaiting_group_result'`,写 `group_assigned` 事件(payload 增 `sampling_method` 字段便于审计/排查)。
- **不**把 `sampling_method` 持久化到 `qc_test_group`(决策 #2:redry 时操作员重新选)。

### 4.2 前端

| 文件 | 改动 |
|---|---|
| [`src/services/qcApi.ts`](../src/services/qcApi.ts) | `checkOutSubLotsBulk` 多一个 `samplingMethod: 'method_1' \| 'method_2'` 参数,RPC body 加 `p_sampling_method` |
| [`src/pages/qc/components/BulkCheckOutDialog.tsx`](../src/pages/qc/components/BulkCheckOutDialog.tsx) | 在弹窗里加一个单选(2 个 radio):**Method 1 · 按 N 切片**(默认勾选) / **Method 2 · 余数并入末组**。每个选项下方一行小字描述 |
| 同上 | (可选)在 Confirm 前显示**分组预览**:列出每组 sub_lot_code + champion 高亮,操作员看清楚再 Confirm。**建议做**,降低误操作 |

### 4.3 文档

- [`docs/modules/09_qc.md`](modules/09_qc.md) Sampling Groups 章节:更新建组规则描述、加 BR-Q68(两种取样方式)、改 example。
- [`docs/database/03_migrations-and-edge-functions.md`](database/03_migrations-and-edge-functions.md):补 M-118 条目,快速参考表更新。

---

## 5. 业务规则

- **BR-Q68** 批量出烘干时,操作员必须选择抽样方式(默认 Method 1)。建组按 `sub_lot_code` 降序进行;**Method 1** = 每 N 辆切一组、余数自成一组、champion = 组内最大编号;**Method 2** = 若有余数则少做 1 组常规组、把余数并入最后一组、最后大组的 champion = 升序排列中的第 `⌊K/2⌋+1` 位(中偏大),常规组仍取最大。同一次 bulk 调用的 Step 2b(redry)沿用同一方法参数。

---

## 6. 风险与边界

- **`sub_lot_code` 排序的语义**:现行 sub_lot_code 形如 `<WO>-NNN`,trailing 3 位为数字 seq,词典序与数字序一致。如果未来引入不同后缀格式(`-D1` / `-D10`),词典序会乱(`-D10` 排在 `-D2` 前)。**短期不变**,但要在 BR 里记一笔「依赖末位 3 位数字 seq」。
- **N=1 的退化**:每辆都自成组,champion 永远是自己,与方式无关。当前实现已用 `GREATEST(1, sample_n)`,继续兼容。
- **空数组**:`T=0` 函数早返回,不进 Step 2a。
- **`p_sampling_method` 默认值**:服务端默认 `method_1`,所以即使前端旧版本不传也能正常工作(不报错、行为可预测)。
- **审计**:`group_assigned` 事件加 `sampling_method` 字段,后续 Analysis / 调试可还原使用过的方式。

---

## 7. 验证清单(里程碑)

1. **DB push**:`supabase db push` 应用 M-118 成功;`\df qc_check_out_sub_lots_bulk` 看到 3 参数签名。
2. **类型检查**:`npm run lint` (tsc) 通过(忽略 USB 打印的既有报错)。
3. **功能走查**:
   - 用 WO-20260608-001(10 辆)走一遍 **Method 1** 出烘干 → 应出 4 组,champion 分别是 sub_lot_code 末位 = 10、7、4、1 的 4 辆。
   - 另起一批(10 辆)走 **Method 2** → 应出 3 组,champion 末位 = 10、7、3。
   - 走 T < N(如 2 辆)→ 两个方式都 1 组,champion = 末位最大。
   - 走 T = N(如 3 辆)→ 两个方式都 1 组,champion = 末位最大。
   - **redry 验证**:某组 fail → Dispose all → redry → 这批 redry 车再次 bulk check-out 时,弹窗仍能选方法,Step 2b 按新方法重组,事件 payload 里有 `sampling_method`。
4. **回归**:M-106 (retest 归一化) / M-107 (needs_attention 去重) / 检测页人工裁定(M-109)依旧工作 —— 这次只动建组阶段,不影响下游。

---

## 8. 待用户确认 / 决策记录

- ✅ **抽样率 N** 取 `sku.sample_every_n_carts`(Production · Products 页面维护),不引入新表。
- ✅ **默认方式**:Method 1。
- ✅ **redry 二次出烘干**:操作员重选,不沿用(选项 A)。
- ⚠️ **「中偏大」公式**:`⌊K/2⌋+1` 1-indexed 升序。K=4→3, K=5→3, K=6→4 等。
- ✅ **示例校对**:用户原例 T=10/N=3 Method 2 写 `10, 6, 3` 为笔误,已确认按规则 `10, 7, 3` 实施。
- ✅ **`sub_lot_code` 排序**:依靠末位 3 位数字 seq 的词典序 = 数字序。后续若改 seq 格式需注意。
- 💡 **可选增强**:Confirm 前显示分组预览(强烈建议,降低误操作)。

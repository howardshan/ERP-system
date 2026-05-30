# Warehouse 模块 — Sprint 4 测试用例（M4 / D-W04 验收）

> **范围**：QC ↔ ERP 集成。建车 → 检验 → 放行 → ERP 余额。涉及 migration M-112 ~ M-117。
> **前提**：M-112~117 已 push 到线上 Supabase；前端 `npm run dev` 跑起来；用 `tianzuohuang@crave-cook.com`（管理员，含 qc.* + warehouse.* 全权）登录。
> **执行顺序**：从 §0 准备开始，按章节顺序往下跑（套件之间有依赖：A 建立基础数据被 B/C/D 复用）。每个用例都给了 SQL 校验 query，可贴到 Supabase SQL Editor。

---

## §0 准备测试数据（一次性）

在 Supabase SQL Editor 跑一次。**先确认 SKU `S4-TEST` 不存在**（如重跑，先清掉测试残留，见末尾 §X 清理脚本）。

```sql
-- 0.1 拿到几个 location id，后续 SQL 会用
SELECT id, code FROM location WHERE code IN ('LOC-PACK-STAGE','LOC-NG','LOC-RM','LOC-QC-PENDING');
-- 记下 LOC-PACK-STAGE 的 id（后面叫它 :PACK_STAGE_ID）

-- 0.2 选两个 active 的 packaging item（任意两个 finished_good / packaging 类型 item）
SELECT id, sku, name, item_type, base_uom_id FROM item
 WHERE status='active' AND item_type IN ('packaging','finished_good')
 ORDER BY id LIMIT 5;
-- 记下两个 id：:ITEM_A_ID（"主包装"）和 :ITEM_B_ID（"次包装"，用于多关联场景）

-- 0.3 建一个 S4 测试专用 SKU（QC 端）
INSERT INTO qc_product_sku (code, name, standard_drying_minutes, sample_every_n_carts)
VALUES ('S4-TEST', 'S4 测试 SKU', 60, 3);
-- 记下返回的 id（:SKU_ID）；下面所有 qc_sku_item 关联都用它

-- 0.4 给这个 SKU 关联包装 item（先 1 个，后续套件 E 会演示 2 个/0 个的场景）
INSERT INTO qc_sku_item (sku_id, item_id) VALUES (:SKU_ID, :ITEM_A_ID);

-- 0.5 给 SKU 配一个检验模板（Aw 0.55~0.65 合格）
INSERT INTO qc_inspection_template (sku_id, test_type_id, lower_limit, upper_limit)
SELECT :SKU_ID, id, 0.55, 0.65 FROM qc_test_type WHERE name ILIKE '%Aw%' LIMIT 1;
```

校验：

```sql
SELECT s.code, s.name,
       (SELECT count(*) FROM qc_sku_item WHERE sku_id=s.id) AS link_count,
       (SELECT count(*) FROM qc_inspection_template WHERE sku_id=s.id) AS tmpl_count
FROM qc_product_sku s WHERE code='S4-TEST';
-- 期望：link_count=1, tmpl_count=1
```

---

## §A 套件 A — Happy Path（建车 → 检验 → 放行）

### A1. 建车（packaging_item_id 已选）→ ERP lot 同步生成

**步骤**：
1. UI → QC → **Production**（建工单页）→ 新建：SKU 选 `S4-TEST`，干燥分钟 60，工单条码 `WO-S4-A1`，车次 1~2（建 2 车），**"最终产品"下拉选 ITEM_A**，提交。

**预期 UI**：建车成功，跳到工单详情页，看到 2 个 sub-lot 行。

**DB 校验**：

```sql
-- 1) qc_production_lot.lot_id 已写入；ERP lot 已创建为 quarantine
SELECT pl.id AS pl_id, pl.lot_number, pl.packaging_item_id,
       pl.lot_id AS wh_lot_id, l.status AS wh_lot_status, l.lot_number AS wh_lot_number
  FROM qc_production_lot pl
  LEFT JOIN lot l ON l.id = pl.lot_id
 WHERE pl.work_order_barcode = 'WO-S4-A1';
-- 期望：wh_lot_id NOT NULL；wh_lot_status='quarantine'；wh_lot_number=pl.lot_number（D-W02 1:1）

-- 2) sub_lots 的 lot_id 由触发器自动同步（与父 production_lot 一致）
SELECT sl.sub_lot_code, sl.status, sl.lot_id, pl.lot_id AS parent_lot_id
  FROM qc_drying_sub_lot sl
  JOIN qc_production_lot pl ON pl.id = sl.production_lot_id
 WHERE pl.work_order_barcode = 'WO-S4-A1';
-- 期望：每行 sl.lot_id = parent_lot_id（不为 NULL）

-- 3) ERP balance 还没有任何行（建车时余额=0，yield 还没流）
SELECT count(*) FROM inventory_balance WHERE lot_id = (
  SELECT lot_id FROM qc_production_lot WHERE work_order_barcode='WO-S4-A1' LIMIT 1
);
-- 期望：0

-- 4) qc_quality_event 里有 sub_lot_created 事件，payload 含 wh_lot_id
SELECT event_type, payload->>'wh_lot_id' AS wh_lot_id
  FROM qc_quality_event
 WHERE drying_sub_lot_id IN (
   SELECT id FROM qc_drying_sub_lot
   WHERE production_lot_id = (SELECT id FROM qc_production_lot WHERE work_order_barcode='WO-S4-A1')
 )
 ORDER BY created_at;
-- 期望：2 行 'sub_lot_created'，wh_lot_id 都不为空
```

✅ **通过判定**：wh_lot_id 非空 + ERP lot status='quarantine' + balance=0 + event payload 含 wh_lot_id。

---

### A2. 检验通过

**步骤**：
1. UI → QC → **Production** → 把两辆车依次"扫码盖戳"check-in（如果是 demo 环境且没真扫码枪，可在 SQL 里直接 `UPDATE qc_drying_sub_lot SET scanned_for_check_in_at = now(), status='drying', in_time=now() WHERE production_lot_id = :PL_ID`）。
2. UI → QC → **Dry Rooms** → check-in 到某个空闲炉位 → wait（或 SQL 里直接 `UPDATE qc_drying_sub_lot SET out_time=now()+interval '1 minute', status='pending' WHERE ...`）。
3. UI → QC → **Testing** → 第一辆车录 Aw=0.60 → PASS。

**预期 UI**：第一辆车状态变 `passed`；QC Home Needs Attention 出现一行 PASS（含两辆车的 group badge）。

**DB 校验**：

```sql
SELECT sub_lot_code, status, lot_id
  FROM qc_drying_sub_lot
 WHERE production_lot_id = (SELECT id FROM qc_production_lot WHERE work_order_barcode='WO-S4-A1');
-- 期望：champion 状态 'passed'；另一辆（sample_every_n_carts=3 但只 2 辆，所以无组）也 'passed' 或独立检验也 PASS
```

> 💡 如果 `sample_every_n_carts=3` 而你只建 2 辆，可能两辆都是独立检验（不分组）；这种情况两辆都需要单独录 Aw。如果要测组传染，建 3 辆。

---

### A3. 放行 → ERP 余额 +yield

**步骤**：
1. UI → QC Home → 看到 PASS 的"Needs Attention"行 → 点 **Release** 按钮。
2. **ReleaseDialog 弹出**：显示车次/产品/批号；填 "每车实际产出" = `50`（基础单位）→ 点"放行"。

**预期 UI**：
- 模态框关闭；提示 "X carts released to next process"；该行从 Needs Attention 消失。
- 底部 **Released Inventory** 区出现这个 SKU 的卡片（如刚好满 10 天阈值会显示色条）。

**DB 校验**：

```sql
-- 1) sub_lot.status='closed'，released_at 已写
SELECT sub_lot_code, status, released_at
  FROM qc_drying_sub_lot
 WHERE production_lot_id = (SELECT id FROM qc_production_lot WHERE work_order_barcode='WO-S4-A1');
-- 期望：放行的车 status='closed', released_at IS NOT NULL

-- 2) ERP balance 在 LOC-PACK-STAGE 出现 +50（每辆放行的车都 +50）
SELECT b.quantity_on_hand, b.quantity_available, l.lot_number, loc.code AS location
  FROM inventory_balance b
  JOIN lot l ON l.id = b.lot_id
  JOIN location loc ON loc.id = b.location_id
 WHERE l.id = (SELECT lot_id FROM qc_production_lot WHERE work_order_barcode='WO-S4-A1');
-- 期望：1 行（如两辆都放行则数量=100），location='LOC-PACK-STAGE'，
--       quantity_on_hand = N * 50，quantity_available 同上（因为下面 lot.status 会聚合到 available）

-- 3) 流水：每辆放行的车一条 production_output
SELECT t.transaction_type, t.quantity, t.reference_type, t.notes, t.created_by, t.transaction_date
  FROM inventory_transaction t
 WHERE t.lot_id = (SELECT lot_id FROM qc_production_lot WHERE work_order_barcode='WO-S4-A1')
 ORDER BY t.id;
-- 期望：N 行 'production_output', quantity=+50,
--       reference_type='qc_release', notes 含 'QC release: sub_lot WO-S4-A1-NNN'

-- 4) lot.status 聚合
SELECT id, lot_number, status FROM lot
 WHERE id = (SELECT lot_id FROM qc_production_lot WHERE work_order_barcode='WO-S4-A1');
-- 期望：全部 sub_lot 都 closed/released → status='available'；
--       如还有未放行的 sub_lot（非终态）→ 仍 'quarantine'

-- 5) qc_quality_event 'released' 事件含 wh_sync 子对象
SELECT event_type, payload->>'sub_lot_code', payload->'wh_sync'->>'transaction_id', payload->'wh_sync'->>'lot_id'
  FROM qc_quality_event
 WHERE event_type='released'
   AND drying_sub_lot_id IN (
     SELECT id FROM qc_drying_sub_lot
     WHERE production_lot_id = (SELECT id FROM qc_production_lot WHERE work_order_barcode='WO-S4-A1')
   );
-- 期望：N 行，每行 transaction_id 与流水 id 对得上
```

✅ **通过判定**：sub_lot=closed + LOC-PACK-STAGE 余额 = N×50 + 流水 N 条 production_output + lot.status 按聚合规则。

---

## §B 套件 B — 建车 guard

### B1. 不传 packaging_item_id → 报错

**步骤**：UI → Production 新建工单，**"最终产品"下拉留空**，提交。

**预期 UI**：报错（前端表单本身应该挡，但即便前端放行了，后端也会拒）。

**SQL 直测**（绕过前端）：

```sql
SELECT qc_create_production_lot_with_sub_lots(
  p_lot_number => 'LOT-B1-TEST',
  p_lot_barcode => 'WO-S4-B1',
  p_work_order_barcode => 'WO-S4-B1',
  p_sku_id => (SELECT id FROM qc_product_sku WHERE code='S4-TEST'),
  p_expected_dry_minutes => 60,
  p_sub_lot_start_seq => 1,
  p_sub_lot_end_seq => 1,
  p_packaging_item_id => NULL
);
-- 期望：ERROR PACKAGING_REQUIRED_AT_CREATION: pick a final product (packaging_item_id) before building cart
```

✅ **通过判定**：拒绝，无 qc_production_lot 行创建。

---

### B2. 触发器在 production_lot_id 变更时同步 lot_id（M-063 跨工单分组场景）

> 这个场景在 v1.0 比较少见（M-063 bulk-checkout-and-regroup）；如果当前没现成入口，可跳过——M-112 backfill 已确保历史一致。

**SQL 模拟**：

```sql
-- 1) 创建两个工单，A1 已建，B2 再建一个
SELECT qc_create_production_lot_with_sub_lots(
  'LOT-B2', 'WO-S4-B2', 'WO-S4-B2',
  (SELECT id FROM qc_product_sku WHERE code='S4-TEST'),
  60, 1, 1, (SELECT id FROM qc_sku_item WHERE sku_id=(SELECT id FROM qc_product_sku WHERE code='S4-TEST') LIMIT 1)
);

-- 2) 把 A1 的某 sub_lot 强行改 production_lot_id 到 B2
UPDATE qc_drying_sub_lot SET production_lot_id = (SELECT id FROM qc_production_lot WHERE work_order_barcode='WO-S4-B2')
 WHERE sub_lot_code = 'WO-S4-A1-001';

-- 3) 校验 lot_id 跟着切换
SELECT sub_lot_code, production_lot_id, lot_id,
       (SELECT lot_id FROM qc_production_lot WHERE id=qc_drying_sub_lot.production_lot_id) AS expected_lot_id
  FROM qc_drying_sub_lot WHERE sub_lot_code='WO-S4-A1-001';
-- 期望：lot_id = expected_lot_id（触发器自动同步）

-- 清理：把它改回去
UPDATE qc_drying_sub_lot SET production_lot_id = (SELECT id FROM qc_production_lot WHERE work_order_barcode='WO-S4-A1')
 WHERE sub_lot_code = 'WO-S4-A1-001';
```

✅ **通过判定**：lot_id 跟随 production_lot_id 自动迁移。

---

## §C 套件 C — 放行 guard

### C1. 不传 yield → YIELD_REQUIRED

**步骤**：UI 表单本身校验"必填+>0"，所以正常 UI 不会触发。**SQL 直测**：

```sql
-- 准备一辆 passed 状态的车（建一辆 A1 类似的，并 PASS）
-- 然后：
SELECT qc_release_passed_sub_lot(
  (SELECT id FROM qc_drying_sub_lot WHERE sub_lot_code='WO-S4-A1-002'),
  NULL  -- 或 0 / 负数
);
-- 期望：ERROR YIELD_REQUIRED: yield quantity must be provided and positive (got <null>)
```

✅ **通过判定**：报错，sub_lot 仍 'passed'，无 transaction 写入。

---

### C2. 同 sub_lot 二次放行 → no-op（M-068 幂等）

**步骤**：对 A3 已放行的 sub_lot 再调一次放行。

```sql
-- 先记下当前余额
SELECT quantity_on_hand FROM inventory_balance
 WHERE lot_id = (SELECT lot_id FROM qc_production_lot WHERE work_order_barcode='WO-S4-A1')
   AND location_id = (SELECT id FROM location WHERE code='LOC-PACK-STAGE');
-- 假设当前 = 100

-- 再放一次（status 已是 closed）
SELECT qc_release_passed_sub_lot(
  (SELECT id FROM qc_drying_sub_lot WHERE sub_lot_code='WO-S4-A1-001'),
  999  -- yield 故意填异常大，验证 no-op 路径不会真用
);
-- 期望：返回 qc_sub_lot_to_json 但不写任何流水

-- 再查余额
SELECT quantity_on_hand FROM inventory_balance
 WHERE lot_id = (SELECT lot_id FROM qc_production_lot WHERE work_order_barcode='WO-S4-A1')
   AND location_id = (SELECT id FROM location WHERE code='LOC-PACK-STAGE');
-- 期望：仍 = 100（未 +999）

-- 校验流水也没多
SELECT count(*) FROM inventory_transaction
 WHERE lot_id = (SELECT lot_id FROM qc_production_lot WHERE work_order_barcode='WO-S4-A1');
-- 期望：与 A3 之后相同（无新增）
```

✅ **通过判定**：余额未变，无新流水，无新 quality_event 'released'。

---

### C3. BR-W3 同步失败 → 整体回滚（sub_lot 保持 'passed'）

**思路**：制造 wh_sync 失败的最稳办法 = 故意把 LOC-PACK-STAGE 改名让函数找不到。

```sql
-- 准备：再建一辆 SKU 'S4-TEST' 的车 → 检验 → passed
-- （步骤同 A1+A2，工单条码用 'WO-S4-C3'，建 1 车，PASS）

BEGIN;
-- 1) 临时改名 LOC-PACK-STAGE 让 sync 失败
UPDATE location SET code='LOC-PACK-STAGE-BROKEN' WHERE code='LOC-PACK-STAGE';

-- 2) 尝试放行（会失败）
DO $$ BEGIN
  PERFORM qc_release_passed_sub_lot(
    (SELECT id FROM qc_drying_sub_lot WHERE sub_lot_code='WO-S4-C3-001'),
    30
  );
  RAISE EXCEPTION 'unexpected: release should have failed';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'release failed as expected: %', SQLERRM;
END $$;

-- 3) 校验 sub_lot 没进 closed（回滚生效）
SELECT sub_lot_code, status FROM qc_drying_sub_lot WHERE sub_lot_code='WO-S4-C3-001';
-- 期望：status='passed'（未变 closed）

-- 4) 没写流水
SELECT count(*) FROM inventory_transaction
 WHERE lot_id = (SELECT lot_id FROM qc_production_lot WHERE work_order_barcode='WO-S4-C3');
-- 期望：0

-- 5) 还原 location（必须）
UPDATE location SET code='LOC-PACK-STAGE' WHERE code='LOC-PACK-STAGE-BROKEN';
COMMIT;

-- 6) 还原后再放一次应该成功
SELECT qc_release_passed_sub_lot(
  (SELECT id FROM qc_drying_sub_lot WHERE sub_lot_code='WO-S4-C3-001'),
  30
);
-- 期望：成功，余额 +30
```

✅ **通过判定**：故意失败时 sub_lot.status='passed' 且无流水；location 还原后能正常放行。

> ⚠️ 这一步**务必跑完 COMMIT** 把 LOC-PACK-STAGE 改回来，否则后续测试全挂。

---

## §D 套件 D — §5.7 历史 NULL packaging_item_id 三分流

**先制造一辆"历史车"**（绕过 M-115 硬约束，模拟旧数据）：

```sql
INSERT INTO qc_production_lot (lot_number, lot_barcode, work_order_barcode, sku_id, expected_dry_minutes, packaging_item_id, lot_id)
VALUES ('LOT-D-HIST', 'WO-S4-D', 'WO-S4-D',
        (SELECT id FROM qc_product_sku WHERE code='S4-TEST'),
        60, NULL, NULL)  -- 关键：两个都 NULL
RETURNING id;
-- 记下 :PL_HIST_ID

INSERT INTO qc_drying_sub_lot (production_lot_id, sub_lot_code, status, expected_dry_minutes)
VALUES (:PL_HIST_ID, 'WO-S4-D-001', 'passed', 60)
RETURNING id;
-- 记下 :SL_HIST_ID
```

### D1. SKU 单关联 → auto-fill 后放行成功

**前置**：SKU `S4-TEST` 此时只关联了 1 个 item（§0.4 建的）。

**步骤**：UI → 临时让这辆"历史车"出现在 QC Home Needs Attention（最简：SQL 写一条 inspection_record 让它进 needs_attention，或直接 SQL 放行）。

```sql
SELECT qc_release_passed_sub_lot(:SL_HIST_ID, 40);
-- 期望：成功
```

**DB 校验**：

```sql
SELECT pl.packaging_item_id, pl.lot_id FROM qc_production_lot pl WHERE id = :PL_HIST_ID;
-- 期望：packaging_item_id 自动填上了（= ITEM_A_ID）；lot_id 由 sync 懒创建

SELECT event_type, payload FROM qc_quality_event
 WHERE drying_sub_lot_id = :SL_HIST_ID
   AND event_type IN ('packaging_item_set','released')
 ORDER BY created_at;
-- 期望：先 packaging_item_set（payload.source='late_fill_on_release'）+ 后 released

SELECT count(*) FROM inventory_transaction WHERE lot_id = (
  SELECT lot_id FROM qc_production_lot WHERE id = :PL_HIST_ID
);
-- 期望：1（+40 production_output）
```

✅ **通过判定**：放行成功 + packaging_item_id 自动写入 + 事件含 source='late_fill_on_release'。

---

### D2. SKU 多关联 → PACKAGING_REQUIRED → 弹窗 → 重试成功

**前置**：再给 SKU 加一条关联，让它有 2 个 item 关联。

```sql
INSERT INTO qc_sku_item (sku_id, item_id)
VALUES ((SELECT id FROM qc_product_sku WHERE code='S4-TEST'), :ITEM_B_ID);
```

再建一辆历史车（同 §D 顶部的 SQL，工单条码改 'WO-S4-D2'，sub_lot 'WO-S4-D2-001'）。

**UI 步骤**：
1. （想办法让这辆车出现在 QC Home —— 最简做法：在 SQL 里直接调 release 来测，或者把它 status 改成 'passed' 后手动写一条 needs_attention 触发条件的 inspection_record）
2. 点 **Release** → 填 yield = 30 → 提交。

**预期 UI**：dialog 不关闭，**切到"选择包装规格"分屏**，下拉显示 ITEM_A 和 ITEM_B 两项；选 ITEM_B → "保存并放行" → 成功。

**SQL 直测版（替代 UI）**：

```sql
-- 第一次调（无 packaging）→ 期望 PACKAGING_REQUIRED 报错
DO $$
BEGIN
  PERFORM qc_release_passed_sub_lot(
    (SELECT id FROM qc_drying_sub_lot WHERE sub_lot_code='WO-S4-D2-001'),
    30);
  RAISE EXCEPTION 'unexpected: should have raised PACKAGING_REQUIRED';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'got expected error: %', SQLERRM;
END $$;

-- 模拟前端"选择 ITEM_B"
SELECT qc_set_lot_packaging_item(
  (SELECT id FROM qc_production_lot WHERE work_order_barcode='WO-S4-D2'),
  :ITEM_B_ID
);

-- 重试
SELECT qc_release_passed_sub_lot(
  (SELECT id FROM qc_drying_sub_lot WHERE sub_lot_code='WO-S4-D2-001'),
  30);
-- 期望：成功
```

**校验**：

```sql
SELECT pl.packaging_item_id, pl.lot_id, l.item_id AS wh_item_id
  FROM qc_production_lot pl
  LEFT JOIN lot l ON l.id = pl.lot_id
 WHERE pl.work_order_barcode='WO-S4-D2';
-- 期望：packaging_item_id = :ITEM_B_ID；wh_item_id = :ITEM_B_ID（懒创建的 lot 用的是回填的 item）
```

✅ **通过判定**：第一次报 `PACKAGING_REQUIRED:<id>`、setLotPackagingItem 后第二次成功、ERP lot 的 item_id 是回填那个。

---

### D3. SKU 0 关联 → NO_PACKAGING_LINKED 硬阻断

**前置**：再造一个 SKU 完全没关联（避免影响 S4-TEST）。

```sql
INSERT INTO qc_product_sku (code, name, standard_drying_minutes) VALUES ('S4-TEST-NOLINK', '无关联 SKU', 60);
INSERT INTO qc_production_lot (lot_number, lot_barcode, work_order_barcode, sku_id, expected_dry_minutes, packaging_item_id)
VALUES ('LOT-D3', 'WO-S4-D3', 'WO-S4-D3',
        (SELECT id FROM qc_product_sku WHERE code='S4-TEST-NOLINK'), 60, NULL);
INSERT INTO qc_drying_sub_lot (production_lot_id, sub_lot_code, status, expected_dry_minutes)
VALUES ((SELECT id FROM qc_production_lot WHERE work_order_barcode='WO-S4-D3'),
        'WO-S4-D3-001', 'passed', 60);

-- 测试
SELECT qc_release_passed_sub_lot(
  (SELECT id FROM qc_drying_sub_lot WHERE sub_lot_code='WO-S4-D3-001'), 20);
-- 期望：ERROR NO_PACKAGING_LINKED:<sku_id> HINT: Configure final products for this SKU in ProductManagement first.
```

**UI 验证**：从 UI 走一遍 → ReleaseDialog 应切到红色 "no_packaging" 分屏，提示去 ProductManagement 配置。

✅ **通过判定**：报错 + sub_lot.status='passed'（未变）。

---

## §E 套件 E — Hold + Disposition（不动 ERP 余额）

### E1. 检验 fail → hold + qc_hold_synced_to_wh 事件

**步骤**：建新车（工单 `WO-S4-E1`，1 车）→ check-in/out → 录 Aw=`0.90`（超出 0.55~0.65）→ FAIL。

**DB 校验**：

```sql
-- 1) sub_lot 进 hold
SELECT sub_lot_code, status FROM qc_drying_sub_lot WHERE sub_lot_code='WO-S4-E1-001';
-- 期望：status='hold'

-- 2) qc_quality_event 含 qc_hold_synced_to_wh
SELECT event_type, payload->>'wh_lot_id', payload->>'source'
  FROM qc_quality_event
 WHERE drying_sub_lot_id = (SELECT id FROM qc_drying_sub_lot WHERE sub_lot_code='WO-S4-E1-001')
 ORDER BY created_at DESC LIMIT 5;
-- 期望：第一行 event_type='qc_hold_synced_to_wh', wh_lot_id 非空, source='inspection_fail'

-- 3) **ERP balance 无变化**
SELECT count(*) FROM inventory_transaction
 WHERE lot_id = (SELECT lot_id FROM qc_production_lot WHERE work_order_barcode='WO-S4-E1');
-- 期望：0（hold 不发余额）

-- 4) lot.status 仍 'quarantine'（非终态 sub_lot 存在）
SELECT status FROM lot WHERE id = (SELECT lot_id FROM qc_production_lot WHERE work_order_barcode='WO-S4-E1');
-- 期望：'quarantine'
```

✅ **通过判定**：sub_lot=hold + 事件含 wh_lot_id + 0 流水。

---

### E2. Champion fail 组传染 → 多个 qc_hold_synced_to_wh

**前置**：把 SKU 的 `sample_every_n_carts` 改 2，建一辆工单含 3 车（自动分 1 组 2 个 sibling + 1 个独立 champion）。

```sql
UPDATE qc_product_sku SET sample_every_n_carts=2 WHERE code='S4-TEST';
```

**步骤**：建工单 `WO-S4-E2`，3 车 → check-in/out → 录 champion Aw=0.95（FAIL）。

**DB 校验**：

```sql
-- 1) champion + 组内 sibling 都进 hold
SELECT sub_lot_code, status, is_test_champion, test_group_id
  FROM qc_drying_sub_lot
 WHERE production_lot_id = (SELECT id FROM qc_production_lot WHERE work_order_barcode='WO-S4-E2')
 ORDER BY sub_lot_code;
-- 期望：champion + 组内 sibling 都 status='hold'

-- 2) qc_hold_synced_to_wh 事件 = 组内 hold 数量
SELECT count(*) FILTER (WHERE event_type='qc_hold_synced_to_wh') AS hold_events
  FROM qc_quality_event
 WHERE drying_sub_lot_id IN (
   SELECT id FROM qc_drying_sub_lot
   WHERE production_lot_id = (SELECT id FROM qc_production_lot WHERE work_order_barcode='WO-S4-E2')
 );
-- 期望：hold_events = hold 状态 sub_lot 数量；source 字段在 champion 上是 'inspection_fail'，
--       在 sibling 上是 'group_propagation'（细查可加 GROUP BY）

-- 3) ERP 仍 0 流水
SELECT count(*) FROM inventory_transaction
 WHERE lot_id = (SELECT lot_id FROM qc_production_lot WHERE work_order_barcode='WO-S4-E2');
-- 期望：0
```

✅ **通过判定**：组内多车 hold + 多条事件（champion=inspection_fail, siblings=group_propagation）+ 0 ERP 流水。

---

### E3. Disposition（scrap）→ qc_disposition_synced_to_wh

**前置**：用 E1 那辆 hold 的车。

**步骤**：UI → QC Home → 该 hold 行 → **Dispose** 按钮 → 选 "Scrap"（报废）→ 提交。

**DB 校验**：

```sql
SELECT status FROM qc_drying_sub_lot WHERE sub_lot_code='WO-S4-E1-001';
-- 期望：status='closed'（scrap → closed 终态）

SELECT event_type, payload->>'wh_lot_id', payload->>'disposition_type', payload->>'new_status'
  FROM qc_quality_event
 WHERE drying_sub_lot_id = (SELECT id FROM qc_drying_sub_lot WHERE sub_lot_code='WO-S4-E1-001')
   AND event_type='qc_disposition_synced_to_wh';
-- 期望：1 行，disposition_type='scrap', new_status='closed', wh_lot_id 非空

-- ERP 仍无流水
SELECT count(*) FROM inventory_transaction
 WHERE lot_id = (SELECT lot_id FROM qc_production_lot WHERE work_order_barcode='WO-S4-E1');
-- 期望：0
```

✅ **通过判定**：sub_lot=closed + disposition 事件含 wh_lot_id + ERP 0 流水。

---

## §F 套件 F — §5.1 lot.status 聚合

### F1. 全 pass 放行 → available

WO-S4-A1（已在 §A 跑完）：两辆都 closed → `lot.status='available'`。

```sql
SELECT status FROM lot WHERE id = (SELECT lot_id FROM qc_production_lot WHERE work_order_barcode='WO-S4-A1');
-- 期望：'available'
```

### F2. 全 hold/disposing → on_hold

**前置**：建工单 `WO-S4-F2`，1 车 → fail → 然后 dispose scrap（让它走完终态）。

```sql
-- 跑完 dispose 后
SELECT wh_recompute_lot_status(
  (SELECT lot_id FROM qc_production_lot WHERE work_order_barcode='WO-S4-F2')
);
-- 期望：jsonb 返回 new_status='on_hold' 或 'available'（取决于 disposition 终态）

SELECT status FROM lot WHERE id = (SELECT lot_id FROM qc_production_lot WHERE work_order_barcode='WO-S4-F2');
```

> 说明：M-113 的规则是 "全部 hold/disposing → on_hold；任一 closed/dispatched → available"。Scrap 进 closed，所以会聚合到 available（混合）。要测出 on_hold 需要让车永远停在 hold（不调 dispose）。

### F3. 部分 pass + 部分 hold（混合）→ available

WO-S4-E2 + 后续若只放行 1 辆、其它 hold → 聚合 = available。

✅ **通过判定**：聚合规则 vs 实际 lot.status 匹配。

---

## §G 套件 G — 对账（与 S2 一致性）

```sql
-- 重建余额，确认与流水 SUM 一致
SELECT wh_rebuild_balance();
-- 期望：jsonb { "rebuilt_rows": N }

-- 校验：余额 vs 流水 SUM 应完全一致（任意 lot 都对）
SELECT b.lot_id, b.location_id, b.quantity_on_hand,
       (SELECT COALESCE(SUM(quantity), 0)
          FROM inventory_transaction t
         WHERE t.item_id = b.item_id AND t.lot_id = b.lot_id AND t.location_id = b.location_id) AS txn_sum
  FROM inventory_balance b
 WHERE b.lot_id IN (
   SELECT lot_id FROM qc_production_lot WHERE work_order_barcode LIKE 'WO-S4-%'
 );
-- 期望：每行 quantity_on_hand = txn_sum
```

✅ **通过判定**：每行 on_hand = sum(transactions)。

---

## §H 套件 H — 前端流程（手工走查）

### H1. ReleaseDialog 三态切换

- yield 输入空 → 点放行 → 显示"请输入大于 0 的产出数量"
- yield = "abc" → 同上
- 多关联场景：点放行 → 切到 pick_packaging → 选包装 → 保存并放行 → 成功
- 0 关联场景：点放行 → 切到 no_packaging 红色提示 → 关闭

### H2. Released Inventory 区即时刷新

放行后 QC Home 底部 Released Inventory 应在下次 load() 时（~15s 内 or 手动 Refresh）出现该 SKU 行。

### H3. 权限门控

用一个**没有 qc.dashboard.release_pass 权限**的用户登录 → QC Home → PASS 行**不应该**显示 Release 按钮。

✅ **通过判定**：UI 行为符合预期；权限正确控制。

---

## §X 清理脚本（重跑测试前用）

```sql
-- 删 S4 测试相关数据（按反向依赖）
DELETE FROM qc_quality_event WHERE drying_sub_lot_id IN (
  SELECT id FROM qc_drying_sub_lot WHERE sub_lot_code LIKE 'WO-S4-%-%'
);
DELETE FROM qc_inspection_record WHERE drying_sub_lot_id IN (
  SELECT id FROM qc_drying_sub_lot WHERE sub_lot_code LIKE 'WO-S4-%-%'
);
DELETE FROM inventory_transaction WHERE lot_id IN (
  SELECT lot_id FROM qc_production_lot WHERE work_order_barcode LIKE 'WO-S4-%'
);
DELETE FROM inventory_balance WHERE lot_id IN (
  SELECT lot_id FROM qc_production_lot WHERE work_order_barcode LIKE 'WO-S4-%'
);
DELETE FROM qc_drying_sub_lot WHERE production_lot_id IN (
  SELECT id FROM qc_production_lot WHERE work_order_barcode LIKE 'WO-S4-%'
);
DELETE FROM lot WHERE id IN (
  SELECT lot_id FROM qc_production_lot WHERE work_order_barcode LIKE 'WO-S4-%' AND lot_id IS NOT NULL
);
DELETE FROM qc_production_lot WHERE work_order_barcode LIKE 'WO-S4-%';
DELETE FROM qc_inspection_template WHERE sku_id IN (
  SELECT id FROM qc_product_sku WHERE code IN ('S4-TEST', 'S4-TEST-NOLINK')
);
DELETE FROM qc_sku_item WHERE sku_id IN (
  SELECT id FROM qc_product_sku WHERE code IN ('S4-TEST', 'S4-TEST-NOLINK')
);
DELETE FROM qc_product_sku WHERE code IN ('S4-TEST', 'S4-TEST-NOLINK');
```

⚠️ **append-only 保护**：M-100 的 `trg_invtxn_append_only` 会拒绝 `DELETE inventory_transaction`！如果上面 DELETE 报 BR-1 错误,需要先**临时禁用触发器**：

```sql
ALTER TABLE inventory_transaction DISABLE TRIGGER trg_invtxn_append_only;
-- ... DELETE ...
ALTER TABLE inventory_transaction ENABLE TRIGGER trg_invtxn_append_only;
```

⚠️ **生产环境绝对不要做**——这是测试环境清场专用。

---

## 验收总结清单（M4 验证门）

| # | 用例 | 状态 |
|---|------|------|
| 1 | A1 建车自动建 ERP lot, 触发器同步 sub_lot.lot_id | ☐ |
| 2 | A3 放行 +yield 到 LOC-PACK-STAGE, lot 聚合 available | ☐ |
| 3 | B1 不传 packaging_item_id 被拒 | ☐ |
| 4 | C1 不传 yield → YIELD_REQUIRED | ☐ |
| 5 | C2 二次放行幂等(余额不重复 +) | ☐ |
| 6 | C3 sync 失败 → sub_lot 保持 passed(BR-W3) | ☐ |
| 7 | D1 单关联 → auto-fill 成功放行 | ☐ |
| 8 | D2 多关联 → PACKAGING_REQUIRED → 弹窗 → 重试成功 | ☐ |
| 9 | D3 0 关联 → NO_PACKAGING_LINKED | ☐ |
| 10 | E1 fail → hold + qc_hold_synced_to_wh + 0 流水 | ☐ |
| 11 | E2 champion fail 组传染多车 hold + 多事件 | ☐ |
| 12 | E3 dispose scrap → qc_disposition_synced_to_wh + 0 流水 | ☐ |
| 13 | F 系列 lot.status 聚合正确 | ☐ |
| 14 | G wh_rebuild_balance 与流水 SUM 一致 | ☐ |
| 15 | H1 ReleaseDialog 三态 + H3 权限门控 | ☐ |

全部 ✅ → **M4 / D-W04 验收通过**, S4 闭环, 可以开始 S5(期初导入 + 包装 ship)。

-- Migration M-128: Production — 车号重叠校验(BR-P4 enforcement)
--
-- M1.2b 做了"续做车提示"(getCarryOverCart)却漏了"重叠校验",导致同一工单可录出
-- 重叠车号(如 1–5 后又录 3–6,3/4/5 被算两次)。本迁移用 BEFORE INSERT/UPDATE 触发器
-- 在数据库层强制 BR-P4,一处生效覆盖平板与管理端两条写入路径。
--
-- 规则(只管 team/平板 run,即 operator_id IS NULL;管理端"每操作员"行 operator_id 非空,
-- 沿用 Phase-1 语义,多操作员可共享车号,故豁免):
--   * 同一工单(work_order_id)内,新 run 车号须接在已有最大 cart_to 之后;
--   * 若标记续做(continues_prev),cart_from 须正好 = 那辆未完成的交接车(= 当前最大 cart_to);
--   * cart_to 须 >= cart_from。
-- 既往数据不回溯校验(触发器只拦新增/修改)。
--
-- 业务规则: BR-P4(车号去重)—— 由本触发器在写入时强制。
-- Depends on: M-125(prod_run)。
-- Affects: 平板生产录入(productionTabletApi.submitTabletRun)、管理端 Daily Report(team 行);
--   docs/database/03...、docs/modules/12...。

CREATE OR REPLACE FUNCTION prod_run_check_cart_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  max_to integer;
BEGIN
  -- 仅 team/平板 run(operator_id 空)+ 有工单 + 有车号段时校验。
  IF NEW.operator_id IS NOT NULL
     OR NEW.work_order_id IS NULL
     OR NEW.cart_from IS NULL
     OR NEW.cart_to IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.cart_to < NEW.cart_from THEN
    RAISE EXCEPTION 'cart_to (%) must be >= cart_from (%)', NEW.cart_to, NEW.cart_from
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT max(cart_to) INTO max_to
  FROM prod_run
  WHERE work_order_id = NEW.work_order_id
    AND operator_id IS NULL
    AND id <> NEW.id
    AND cart_to IS NOT NULL;

  IF max_to IS NOT NULL THEN
    IF NEW.continues_prev THEN
      IF NEW.cart_from <> max_to THEN
        RAISE EXCEPTION
          'continuation must start at cart % (the unfinished cart of this work order)', max_to
          USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      IF NEW.cart_from <= max_to THEN
        RAISE EXCEPTION
          'cart range %-% overlaps this work order''s carts (already up to %); start after cart % or mark it as a continuation',
          NEW.cart_from, NEW.cart_to, max_to, max_to
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prod_run_cart_overlap ON prod_run;
CREATE TRIGGER trg_prod_run_cart_overlap
  BEFORE INSERT OR UPDATE ON prod_run
  FOR EACH ROW EXECUTE FUNCTION prod_run_check_cart_overlap();

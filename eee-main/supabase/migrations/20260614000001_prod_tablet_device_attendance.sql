-- Migration M-126: Production Phase 2 M1.2a — 产线平板设备 + 打卡上岗/下岗
--
-- Phase 2 把生产录入前移到一线平板(见 docs/Production模块-Phase2-SPEC.md)。M1.2a 是
-- 平板端第一片:产线平板 kiosk(/tablet)+ 设备账号登录 + 打卡上岗/下岗(把"现在这条
-- 线有哪几个人"跑通)。生产录入 + 停机(M1.2b)、工时汇总 + 看板(M1.3)随后。
--
-- 设备鉴权设计(沿用 /superuser + set_module_visibility 两个先例):
--   * 平板不是 erp_user。它走 /tablet kiosk(绕过登录),用设备码 + PIN 登录。
--   * prod_line_device 仅对 authenticated(管理端)开放;anon(平板)不可直读 PIN。
--   * 登录经 SECURITY DEFINER RPC prod_tablet_login(校验 PIN、返回绑定产线),授予 anon。
--   * 打卡数据 prod_line_attendance 用 dev_all,平板(anon)直接读写。
--
-- 安全等级 = dev 级(PIN 明文、attendance 走 dev_all),与全站 dev_all + /superuser 一致;
-- 生产硬化(PIN 加盐、逐写 RPC 校验、收紧 RLS)列入后续,不在本期。
--
-- 业务规则:
--   BR-P5 — 平板设备登录经 prod_tablet_login(设备码 + PIN)服务端校验;prod_line_device
--     不开放 anon 直读(PIN 不经 REST 暴露)。设备绑定一条产线(machine)。
--   BR-P6 — 「生产 team」是打卡点:某产线某班"当前在岗" = prod_line_attendance 中该
--     (machine × date × shift) check_out_at IS NULL 的操作员集合;工时 = Σ session 时长(M1.3 切换效率分母)。
--
-- Depends on: M-122(prod_machine/prod_operator)、M-125(prod_run.device_id 占位列)、M-009(权限表)。
-- Affects: src/App.tsx、src/lib/permissionStructure.ts、src/services/{productionTabletApi,productionDeviceApi}.ts、
--   src/pages/tablet/TabletApp.tsx、src/pages/production/{DevicePage,ProductionModule}.tsx、
--   docs/database/03...、docs/modules/12...、docs/Production模块-Phase2-SPEC.md。

-- ── 1. 产线平板设备 prod_line_device ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prod_line_device (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,                       -- 登录设备码
  name        text,                                       -- 友好名称
  machine_id  uuid NOT NULL REFERENCES prod_machine(id),  -- 绑定产线
  pin         text NOT NULL,                              -- dev 级:仅经 RPC 校验,anon 不可直读
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text,
  updated_at  timestamptz,
  updated_by  text
);

ALTER TABLE prod_line_device ENABLE ROW LEVEL SECURITY;
-- 仅 authenticated(管理端登录用户带 JWT)可读写;不建 anon 策略 → 平板取不到 PIN。
DO $$ BEGIN
  CREATE POLICY "auth_all" ON prod_line_device FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. 产线打卡 / 上岗登记 prod_line_attendance ─────────────────────────────
CREATE TABLE IF NOT EXISTS prod_line_attendance (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id   uuid NOT NULL REFERENCES prod_operator(id),
  machine_id    uuid NOT NULL REFERENCES prod_machine(id),
  report_date   date NOT NULL,
  shift         text NOT NULL CHECK (shift IN ('1st','2nd','3rd')),
  check_in_at   timestamptz NOT NULL DEFAULT now(),
  check_out_at  timestamptz,                              -- 空 = 仍在岗
  device_id     uuid REFERENCES prod_line_device(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text
);
CREATE INDEX IF NOT EXISTS idx_prod_line_attendance_line_shift
  ON prod_line_attendance (machine_id, report_date, shift);

ALTER TABLE prod_line_attendance ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "dev_all" ON prod_line_attendance FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. prod_run.device_id 补 FK(M-125 时是 plain uuid)────────────────────────
DO $$ BEGIN
  ALTER TABLE prod_run
    ADD CONSTRAINT prod_run_device_fk FOREIGN KEY (device_id) REFERENCES prod_line_device(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 4. 设备登录 RPC(SECURITY DEFINER,校验 PIN,返回绑定产线)──────────────────
CREATE OR REPLACE FUNCTION prod_tablet_login(p_code text, p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d record;
BEGIN
  SELECT dev.id, dev.code, dev.name, dev.machine_id, m.code AS machine_code
    INTO d
  FROM prod_line_device dev
  JOIN prod_machine m ON m.id = dev.machine_id
  WHERE dev.code = p_code AND dev.pin = p_pin AND dev.active;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN jsonb_build_object(
    'device_id',    d.id,
    'code',         d.code,
    'name',         d.name,
    'machine_id',   d.machine_id,
    'machine_code', d.machine_code
  );
END;
$$;

GRANT EXECUTE ON FUNCTION prod_tablet_login(text, text) TO anon, authenticated;

-- ── 5. 权限种子(同 M-122 cross-join,幂等)──────────────────────────────────
INSERT INTO user_permission_grant (user_id, module_id, resource, permission)
SELECT g.user_id, 'production', 'device', perm.permission
FROM (
  SELECT DISTINCT user_id
  FROM user_permission_grant
  WHERE module_id = 'production'
    AND resource = 'module_permissions' AND permission = 'manage'
) g
CROSS JOIN (VALUES ('view'), ('create'), ('edit'), ('disable')) AS perm(permission)
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;

-- ── 6. 演示设备(便于即时验证;绑定 Inj 01)──────────────────────────────────
INSERT INTO prod_line_device (code, name, machine_id, pin, created_by)
SELECT 'LINE-INJ01', 'Inj 01 Tablet', m.id, '1234', 'system:M-126'
FROM prod_machine m
WHERE m.code = 'Inj 01'
ON CONFLICT (code) DO NOTHING;

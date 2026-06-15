-- Migration M-127: Production Phase 2 M1.2b — 停机实时事件 prod_downtime_event
--
-- M1.2b 把产线平板从"只打卡"升级为"能录生产 + 记停机"。本迁移只建停机事件表;
-- 平板生产录入(submitTabletRun)写的是既有 prod_run(source='tablet'),无需新表/新列。
--
-- 替代纸质 Form 451:支持实时"开始停机/结束停机"打点(start_at/end_at),
-- 或事后补录一段时长(down_minutes)。停机归属到产线(machine)+ 班次,可选关联当时 run。
--
-- 业务规则:
--   BR-P7 — 停机事件:line 级、实时 start/end 打点(结束时 down_minutes = round((end-start)/60))
--     或补录时长;可选 run_id 关联当时生产记录。班次停机工时 = Σ down_minutes(M1.3 汇总用)。
--
-- Depends on: M-122(prod_machine/prod_downtime_reason)、M-125(prod_run)、M-126(prod_line_device)。
-- Affects: src/services/productionTabletApi.ts、src/pages/tablet/TabletApp.tsx、
--   docs/database/03...、docs/modules/12...、docs/Production模块-Phase2-SPEC.md。

CREATE TABLE IF NOT EXISTS prod_downtime_event (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id    uuid NOT NULL REFERENCES prod_machine(id),
  run_id        uuid REFERENCES prod_run(id),              -- 可选:关联当时生产记录
  report_date   date NOT NULL,
  shift         text NOT NULL CHECK (shift IN ('1st','2nd','3rd')),
  reason_id     uuid NOT NULL REFERENCES prod_downtime_reason(id),
  start_at      timestamptz,                               -- 实时打点起;补录时可空
  end_at        timestamptz,                               -- 空 = 进行中
  down_minutes  numeric,                                   -- 结束时算出 / 补录直填
  note          text,
  device_id     uuid REFERENCES prod_line_device(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text
);

CREATE INDEX IF NOT EXISTS idx_prod_downtime_event_line_shift
  ON prod_downtime_event (machine_id, report_date, shift);

ALTER TABLE prod_downtime_event ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "dev_all" ON prod_downtime_event FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- M-150  QC Daily Test Report — daily roll-up + e-signature + PDF archive
--
-- Operators run many inspections a day (qc_inspection_record: sample, readings,
-- pass/fail, time, inspector) but there was no "end-of-day sign-off" closure.
-- This adds a per-day report a person signs (typed full name OR hand-drawn), the
-- sign time is recorded, an immutable PDF is archived to Storage, and every data
-- node is snapshotted in the DB.  History is browsable and the PDF downloadable
-- by date.  Past dates may be back-signed but require a reason, which is written
-- into the PDF and stored.
--
-- BR-Q82: one signed report per business day (report_date UNIQUE → sign locks
-- the day). Signer identity + back-date rule are derived server-side in
-- qc_sign_daily_report so the client can't forge them. Back-dated = report_date
-- differs from sign date; reason then mandatory (CHECK + RPC guard).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Archive table ───────────────────────────────────────────────────────────
CREATE TABLE qc_daily_test_report (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date       date          NOT NULL UNIQUE,                 -- one report per day
  signer_auth_id    uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  signer_name       text          NOT NULL,                        -- qc_actor_label snapshot
  signed_at         timestamptz   NOT NULL DEFAULT now(),
  signature_type    text          NOT NULL CHECK (signature_type IN ('typed','drawn')),
  signature_data    text          NOT NULL,                        -- PNG data URL (typed rendered to image too)
  is_backdated      boolean       NOT NULL DEFAULT false,
  backdate_reason   text,                                          -- required when is_backdated
  snapshot          jsonb         NOT NULL,                        -- all data nodes: rows + summary
  pdf_storage_path  text,                                          -- path in qc-daily-reports bucket
  test_count        integer       NOT NULL DEFAULT 0,
  pass_count        integer       NOT NULL DEFAULT 0,
  fail_count        integer       NOT NULL DEFAULT 0,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT qc_daily_report_backdate_reason_chk
    CHECK (NOT is_backdated OR btrim(COALESCE(backdate_reason, '')) <> '')
);

CREATE INDEX ON qc_daily_test_report (report_date DESC);
CREATE INDEX ON qc_daily_test_report (signer_auth_id);

ALTER TABLE qc_daily_test_report ENABLE ROW LEVEL SECURITY;

-- Authenticated users can insert/select; app layer gates by qc.daily_report.*
CREATE POLICY "qc_daily_report_insert" ON qc_daily_test_report
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "qc_daily_report_select" ON qc_daily_test_report
  FOR SELECT TO authenticated USING (true);

-- ── Storage bucket for the signed PDFs ──────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'qc-daily-reports',
  'qc-daily-reports',
  false,
  10485760,                 -- 10 MB per file
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "qc_daily_report_pdf_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'qc-daily-reports');

CREATE POLICY "qc_daily_report_pdf_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'qc-daily-reports');

-- ── RPC: all inspections submitted on a given day ───────────────────────────
-- One row per qc_inspection_record. readings reuses _qc_flatten_readings so the
-- multi-test shape ({item_name, unit, value, …}) matches the timeline UI.
CREATE OR REPLACE FUNCTION public.qc_daily_test_report_data(p_date date)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT COALESCE(
    jsonb_agg(rec ORDER BY (rec->>'submitted_at')),
    '[]'::jsonb
  )
  FROM (
    SELECT jsonb_build_object(
      'inspection_id', ir.id,
      'sample_id',     (SELECT sa.sample_id FROM qc_sample sa WHERE sa.id = ir.sample_id),
      'sub_lot_code',  sl.sub_lot_code,
      'sku_name',      sku.name,
      'result',        ir.result,
      'readings',      _qc_flatten_readings(ir.values_json),
      'remark',        ir.remark,
      'submitted_at',  ir.submitted_at,
      'inspector',     qc_actor_label(ir.inspector_auth_id)
    ) AS rec
    FROM qc_inspection_record ir
    JOIN qc_drying_sub_lot sl ON sl.id = ir.drying_sub_lot_id
    JOIN qc_production_lot  pl ON pl.id = sl.production_lot_id
    LEFT JOIN qc_product_sku sku ON sku.id = pl.sku_id
    WHERE ir.submitted_at >= p_date::timestamptz
      AND ir.submitted_at <  (p_date + 1)::timestamptz
  ) t;
$$;

-- ── RPC: sign + archive a daily report ──────────────────────────────────────
-- Signer + back-date flag derived server-side. UNIQUE(report_date) makes a second
-- sign for the same day fail. Returns the inserted row as jsonb.
CREATE OR REPLACE FUNCTION public.qc_sign_daily_report(
  p_date            date,
  p_signature_type  text,
  p_signature_data  text,
  p_snapshot        jsonb,
  p_pdf_path        text DEFAULT NULL,
  p_backdate_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_auth_id     uuid := auth.uid();
  v_name        text;
  v_backdated   boolean := (p_date <> current_date);
  v_test_count  integer;
  v_pass_count  integer;
  v_fail_count  integer;
  v_row         qc_daily_test_report%ROWTYPE;
BEGIN
  IF v_backdated AND btrim(COALESCE(p_backdate_reason, '')) = '' THEN
    RAISE EXCEPTION 'Back-signing a past date requires a reason';
  END IF;

  v_name := COALESCE(qc_actor_label(v_auth_id), 'Unknown');

  SELECT
    count(*),
    count(*) FILTER (WHERE elem->>'result' = 'pass'),
    count(*) FILTER (WHERE elem->>'result' = 'fail')
  INTO v_test_count, v_pass_count, v_fail_count
  FROM jsonb_array_elements(COALESCE(p_snapshot->'rows', '[]'::jsonb)) elem;

  INSERT INTO qc_daily_test_report (
    report_date, signer_auth_id, signer_name, signature_type, signature_data,
    is_backdated, backdate_reason, snapshot, pdf_storage_path,
    test_count, pass_count, fail_count
  ) VALUES (
    p_date, v_auth_id, v_name, p_signature_type, p_signature_data,
    v_backdated, CASE WHEN v_backdated THEN p_backdate_reason ELSE NULL END,
    p_snapshot, p_pdf_path,
    v_test_count, v_pass_count, v_fail_count
  )
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'A report for % is already signed', p_date;
END;
$$;

-- ── RPC: signed-report history ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.qc_list_daily_reports()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',               r.id,
    'report_date',      r.report_date,
    'signer_name',      r.signer_name,
    'signed_at',        r.signed_at,
    'signature_type',   r.signature_type,
    'is_backdated',     r.is_backdated,
    'backdate_reason',  r.backdate_reason,
    'pdf_storage_path', r.pdf_storage_path,
    'test_count',       r.test_count,
    'pass_count',       r.pass_count,
    'fail_count',       r.fail_count
  ) ORDER BY r.report_date DESC), '[]'::jsonb)
  FROM qc_daily_test_report r;
$$;

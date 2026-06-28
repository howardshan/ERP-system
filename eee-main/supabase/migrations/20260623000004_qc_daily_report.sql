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


-- ===== merged from 20260623000004_qc_production_lot_detail_remove_event_cap.sql (duplicate-version dedup for fresh db build) =====

-- Migration M-150: drop the silent 50-event cap on Batch Trace's timeline.
--
-- BUG REPORT FROM PRODUCTION → BATCH TRACE:
--   Operators see "many operations and behaviors not recorded" on busy work
--   orders. The actual recorded events on those WOs ARE there — the trace
--   page just stops showing them past row 50.
--
-- ROOT CAUSE:
--   M-099's qc_production_lot_detail hardcoded `LIMIT 50` inside the events
--   subquery. A 10-cart WO that has gone through one complete cycle
--   (sub_lot_created × 10, scanned_for_check_in × 10, check_in × 10, possible
--   move_dryer × N, check_out × 10, group_assigned × N, sample_taken, plus
--   inspection / disposition / sync hooks) hits 50 well before the cycle is
--   done. With retest or redry the cap is blown wide open. The `ORDER BY
--   created_at DESC` then drops the OLDEST events first, so operators see
--   only the tail of recent activity — exactly the "missing history"
--   symptom they reported.
--
-- FIX:
--   Drop the LIMIT entirely. Per-WO events are intrinsically bounded by
--   sub-lot count × lifecycle length; a chaotic WO accumulates a few hundred
--   rows at most. JSON aggregation of that volume is fine; no pagination
--   layer downstream needs the cap.
--
-- Otherwise byte-identical to M-099. The `lot` / `sub_lots` blocks are
-- preserved verbatim — only the events subquery changes.
--
-- Depends on: M-099 (20260527000002 qc_production_lot_detail).
-- Affects: docs/database/03..., docs/modules/09_qc.md.
-- No frontend type changes (events array shape unchanged).

CREATE OR REPLACE FUNCTION qc_production_lot_detail(p_lot_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
    lot       qc_production_lot%ROWTYPE;
    sku       qc_product_sku%ROWTYPE;
    v_scanned int;
    v_total   int;
    v_max_seq int;
BEGIN
    SELECT * INTO lot FROM qc_production_lot WHERE id = p_lot_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Production lot not found'; END IF;
    SELECT * INTO sku FROM qc_product_sku WHERE id = lot.sku_id;

    SELECT COUNT(*) FILTER (WHERE s.scanned_for_check_in_at IS NOT NULL),
           COUNT(*),
           COALESCE(MAX((regexp_replace(s.sub_lot_code, '^.*-(\d{3})$', '\1'))::int), 0)
      INTO v_scanned, v_total, v_max_seq
    FROM qc_drying_sub_lot s
    WHERE s.production_lot_id = p_lot_id;

    RETURN jsonb_build_object(
        'lot', jsonb_build_object(
            'id', lot.id,
            'lot_number', lot.lot_number,
            'lot_barcode', lot.lot_barcode,
            'work_order_barcode', lot.work_order_barcode,
            'sku_id', lot.sku_id,
            'sku_code', sku.code,
            'sku_name', sku.name,
            'created_at', lot.created_at,
            'scanned_count', v_scanned,
            'total_count', v_total,
            'max_seq', v_max_seq
        ),
        'sub_lots', COALESCE((
            SELECT jsonb_agg(qc_sub_lot_to_json(s.id) ORDER BY s.created_at)
            FROM qc_drying_sub_lot s
            WHERE s.production_lot_id = p_lot_id
              AND s.scanned_for_check_in_at IS NOT NULL
        ), '[]'::jsonb),
        -- M-150: no more `LIMIT 50`. Full per-WO event timeline.
        'events', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', ev.id,
                'event_type', ev.event_type,
                'payload', ev.payload,
                'created_at', ev.created_at,
                'sub_lot_code', s2.sub_lot_code,
                'summary', qc_quality_event_summary(ev.event_type, ev.payload, s2.sub_lot_code)
            ) ORDER BY ev.created_at DESC)
            FROM qc_quality_event ev
            LEFT JOIN qc_drying_sub_lot s2 ON s2.id = ev.drying_sub_lot_id
            WHERE ev.drying_sub_lot_id IN (
                SELECT id FROM qc_drying_sub_lot WHERE production_lot_id = p_lot_id
            )
        ), '[]'::jsonb)
    );
END;
$$;

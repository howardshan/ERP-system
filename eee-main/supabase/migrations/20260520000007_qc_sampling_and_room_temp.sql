-- Migration M-039: Sampling, room-temp dry, redry disposition, full history
--
-- Reworks Testing flow:
--   1. QC operator types a `sample_id`, clicks 取样 → qc_take_sample inserts
--      a qc_sample row in 'pending' state (sub-lot stays in 'pending').
--   2. Operator enters a WA value; frontend shows auto-judged Pass/Fail
--      preview (BR-Q1).
--   3. On Confirm, qc_submit_inspection is called with the sample_id;
--      it links the inspection record to the sample and marks the sample
--      'inspected'. Sub-lot moves to 'passed' or 'hold' as before.
--   4. If Fail, operator picks a disposition; new types `redry_dryer` and
--      `room_temp_dry` route the sub-lot back into drying or into the new
--      Room Temp Dry queue.
--
-- All writes are append-only (no overwrites). Samples can be voided
-- (`status='voided'`) but the original row is preserved for audit.

-- ── 1) Status: room_temp_drying ─────────────────────────────────────────────

ALTER TABLE qc_drying_sub_lot DROP CONSTRAINT IF EXISTS qc_drying_sub_lot_status_check;
ALTER TABLE qc_drying_sub_lot ADD CONSTRAINT qc_drying_sub_lot_status_check
  CHECK (status IN (
    'created', 'drying', 'awaiting_recheck', 'room_temp_drying',
    'pending', 'inspecting', 'passed', 'hold', 'disposing', 'closed'
  ));

-- ── 2) Sample table ─────────────────────────────────────────────────────────

CREATE TABLE qc_sample (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drying_sub_lot_id     uuid NOT NULL REFERENCES qc_drying_sub_lot(id) ON DELETE CASCADE,
  sample_id             text NOT NULL,              -- user-entered identifier (e.g. "S-001")
  taken_at              timestamptz NOT NULL DEFAULT now(),
  taken_by_auth_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  inspection_record_id  uuid REFERENCES qc_inspection_record(id) ON DELETE SET NULL,
  status                text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'inspected', 'voided')),
  voided_at             timestamptz,
  voided_by_auth_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason           text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_qc_sample_sub_lot ON qc_sample(drying_sub_lot_id);
CREATE INDEX idx_qc_sample_status ON qc_sample(status);

ALTER TABLE qc_sample ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dev_all" ON qc_sample FOR ALL USING (true) WITH CHECK (true);

-- ── 3) Inspection record: add sample_id link + dispositioned-from link ─────

ALTER TABLE qc_inspection_record
  ADD COLUMN IF NOT EXISTS sample_id uuid REFERENCES qc_sample(id) ON DELETE SET NULL;

-- ── 4) Room temp dry session table ──────────────────────────────────────────

CREATE TABLE qc_room_temp_dry_session (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drying_sub_lot_id   uuid NOT NULL REFERENCES qc_drying_sub_lot(id) ON DELETE CASCADE,
  disposition_id      uuid REFERENCES qc_disposition(id) ON DELETE SET NULL,
  started_at          timestamptz NOT NULL DEFAULT now(),
  started_by_auth_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ended_at            timestamptz,
  ended_by_auth_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  duration_minutes    numeric(10, 2),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_qc_room_temp_sub_lot ON qc_room_temp_dry_session(drying_sub_lot_id);
CREATE INDEX idx_qc_room_temp_open ON qc_room_temp_dry_session(drying_sub_lot_id) WHERE ended_at IS NULL;

ALTER TABLE qc_room_temp_dry_session ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dev_all" ON qc_room_temp_dry_session FOR ALL USING (true) WITH CHECK (true);

-- ── 5) Extend disposition types ─────────────────────────────────────────────

ALTER TABLE qc_disposition DROP CONSTRAINT IF EXISTS qc_disposition_type_check;
ALTER TABLE qc_disposition ADD CONSTRAINT qc_disposition_type_check
  CHECK (type IN ('rework', 'grind', 'scrap', 'concession', 'redry_dryer', 'room_temp_dry'));

-- New optional column: how long to re-dry (only relevant when type='redry_dryer')
ALTER TABLE qc_disposition
  ADD COLUMN IF NOT EXISTS redry_expected_dry_minutes int;

-- ── 6) qc_take_sample ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION qc_take_sample(
    p_sub_lot_id uuid,
    p_sample_id text
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    s qc_drying_sub_lot%ROWTYPE;
    new_id uuid;
    row qc_sample%ROWTYPE;
BEGIN
    IF p_sample_id IS NULL OR length(trim(p_sample_id)) = 0 THEN
      RAISE EXCEPTION 'Sample id is required';
    END IF;
    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sub-lot not found'; END IF;
    IF s.status NOT IN ('pending', 'inspecting') THEN
        RAISE EXCEPTION 'Cannot take a sample for sub-lot in status %', s.status;
    END IF;

    INSERT INTO qc_sample (drying_sub_lot_id, sample_id, taken_by_auth_id)
    VALUES (p_sub_lot_id, trim(p_sample_id), auth.uid())
    RETURNING id INTO new_id;

    SELECT * INTO row FROM qc_sample WHERE id = new_id;

    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    VALUES (p_sub_lot_id, 'sample_taken',
            jsonb_build_object('sample_id', row.sample_id, 'sample_pk', row.id),
            auth.uid());

    RETURN jsonb_build_object(
      'id', row.id,
      'drying_sub_lot_id', row.drying_sub_lot_id,
      'sample_id', row.sample_id,
      'taken_at', row.taken_at,
      'status', row.status
    );
END;
$$;

-- ── 7) qc_submit_inspection: accept optional p_sample_pk, link inspection ──

CREATE OR REPLACE FUNCTION qc_submit_inspection(
    p_sub_lot_id uuid,
    p_aw numeric,
    p_sample_pk uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    s qc_drying_sub_lot%ROWTYPE;
    lot qc_production_lot%ROWTYPE;
    tmpl qc_inspection_template%ROWTYPE;
    judged text;
    new_status text;
    event_type text;
    rec_id uuid;
    sample qc_sample%ROWTYPE;
BEGIN
    IF p_aw IS NULL OR p_aw < 0 OR p_aw > 2 THEN
        RAISE EXCEPTION 'Invalid Aw value: %', p_aw;
    END IF;

    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sub-lot not found'; END IF;

    IF p_sample_pk IS NOT NULL THEN
      SELECT * INTO sample FROM qc_sample WHERE id = p_sample_pk FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Sample not found'; END IF;
      IF sample.drying_sub_lot_id <> p_sub_lot_id THEN
        RAISE EXCEPTION 'Sample does not belong to this sub-lot';
      END IF;
      IF sample.status <> 'pending' THEN
        RAISE EXCEPTION 'Sample is already % — take a new sample to re-test', sample.status;
      END IF;
    END IF;

    IF s.status = 'pending' THEN
        UPDATE qc_drying_sub_lot SET status = 'inspecting', updated_at = now() WHERE id = p_sub_lot_id;
        s.status := 'inspecting';
    END IF;

    IF s.status <> 'inspecting' THEN
        RAISE EXCEPTION 'Sub-lot not inspectable (status=%)', s.status;
    END IF;

    SELECT * INTO lot FROM qc_production_lot WHERE id = s.production_lot_id;
    SELECT * INTO tmpl FROM qc_inspection_template WHERE sku_id = lot.sku_id LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'No inspection template for SKU'; END IF;

    judged := CASE WHEN p_aw >= tmpl.lower_limit AND p_aw <= tmpl.upper_limit THEN 'pass' ELSE 'fail' END;

    INSERT INTO qc_inspection_record (drying_sub_lot_id, inspector_auth_id, values_json, result, sample_id)
    VALUES (p_sub_lot_id, auth.uid(), jsonb_build_object('aw', p_aw), judged, p_sample_pk)
    RETURNING id INTO rec_id;

    IF p_sample_pk IS NOT NULL THEN
      UPDATE qc_sample
      SET status = 'inspected', inspection_record_id = rec_id
      WHERE id = p_sample_pk;
    END IF;

    IF judged = 'pass' THEN
        new_status := 'passed';
        event_type := 'inspection_passed';
    ELSE
        new_status := 'hold';
        event_type := 'inspection_failed_hold';
    END IF;

    UPDATE qc_drying_sub_lot SET status = new_status, updated_at = now() WHERE id = p_sub_lot_id;

    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    VALUES (p_sub_lot_id, event_type,
            jsonb_build_object(
              'aw', p_aw, 'result', judged,
              'limits', jsonb_build_array(tmpl.lower_limit, tmpl.upper_limit),
              'sample_pk', p_sample_pk,
              'sample_id', sample.sample_id
            ),
            auth.uid());

    RETURN jsonb_build_object(
        'id', rec_id,
        'drying_sub_lot_id', p_sub_lot_id,
        'result', judged,
        'values_json', jsonb_build_object('aw', p_aw),
        'submitted_at', now(),
        'new_status', new_status,
        'sample_pk', p_sample_pk
    );
END;
$$;

-- ── 8) qc_create_disposition: extend with redry/room_temp side effects ──────

CREATE OR REPLACE FUNCTION qc_create_disposition(
    p_sub_lot_id uuid,
    p_type text,
    p_remark text DEFAULT NULL,
    p_redry_expected_dry_minutes int DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    s qc_drying_sub_lot%ROWTYPE;
    new_id uuid;
    next_status text;
BEGIN
    IF p_type NOT IN ('rework', 'grind', 'scrap', 'concession', 'redry_dryer', 'room_temp_dry') THEN
        RAISE EXCEPTION 'Invalid disposition type: %', p_type;
    END IF;
    IF p_type = 'redry_dryer' AND (p_redry_expected_dry_minutes IS NULL OR p_redry_expected_dry_minutes <= 0) THEN
        RAISE EXCEPTION 'redry_dryer requires a positive redry_expected_dry_minutes';
    END IF;

    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sub-lot not found'; END IF;

    IF s.status = 'hold' THEN
        UPDATE qc_drying_sub_lot SET status = 'disposing', updated_at = now() WHERE id = p_sub_lot_id;
        s.status := 'disposing';
    END IF;
    IF s.status <> 'disposing' THEN
        RAISE EXCEPTION 'Sub-lot not in disposition flow (status=%)', s.status;
    END IF;

    INSERT INTO qc_disposition (drying_sub_lot_id, type, remark, operator_auth_id, redry_expected_dry_minutes)
    VALUES (p_sub_lot_id, p_type, p_remark, auth.uid(), p_redry_expected_dry_minutes)
    RETURNING id INTO new_id;

    -- Decide downstream state based on disposition type
    IF p_type = 'redry_dryer' THEN
        -- Cart goes back to dryer queue with a fresh target time; existing
        -- spot history is preserved but a new drying session will start when
        -- placed.
        next_status := 'awaiting_recheck';
        UPDATE qc_drying_sub_lot
        SET status = 'awaiting_recheck',
            expected_dry_minutes = p_redry_expected_dry_minutes,
            in_time = NULL,
            updated_at = now()
        WHERE id = p_sub_lot_id;
    ELSIF p_type = 'room_temp_dry' THEN
        -- Cart routed to Room Temp Dry queue; session auto-opens so the
        -- count-up starts immediately.
        next_status := 'room_temp_drying';
        UPDATE qc_drying_sub_lot
        SET status = 'room_temp_drying', updated_at = now()
        WHERE id = p_sub_lot_id;
        INSERT INTO qc_room_temp_dry_session (drying_sub_lot_id, disposition_id, started_by_auth_id)
        VALUES (p_sub_lot_id, new_id, auth.uid());
    ELSE
        next_status := 'closed';
        UPDATE qc_drying_sub_lot SET status = 'closed', updated_at = now() WHERE id = p_sub_lot_id;
    END IF;

    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    VALUES (p_sub_lot_id, 'disposition_completed',
            jsonb_build_object(
              'type', p_type,
              'remark', p_remark,
              'redry_expected_dry_minutes', p_redry_expected_dry_minutes,
              'next_status', next_status
            ),
            auth.uid());

    RETURN jsonb_build_object(
        'id', new_id,
        'drying_sub_lot_id', p_sub_lot_id,
        'type', p_type,
        'remark', p_remark,
        'redry_expected_dry_minutes', p_redry_expected_dry_minutes,
        'created_at', now(),
        'new_status', next_status
    );
END;
$$;

-- ── 9) Room temp dry stop ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION qc_stop_room_temp_dry(p_sub_lot_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    s qc_drying_sub_lot%ROWTYPE;
    now_t timestamptz := now();
BEGIN
    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sub-lot not found'; END IF;
    IF s.status <> 'room_temp_drying' THEN
        RAISE EXCEPTION 'Sub-lot is not in room_temp_drying (status=%)', s.status;
    END IF;

    UPDATE qc_room_temp_dry_session
    SET ended_at = now_t,
        ended_by_auth_id = auth.uid(),
        duration_minutes = EXTRACT(EPOCH FROM (now_t - started_at)) / 60.0
    WHERE drying_sub_lot_id = p_sub_lot_id AND ended_at IS NULL;

    -- After room-temp drying, route the cart back to pending for re-test
    UPDATE qc_drying_sub_lot
    SET status = 'pending', out_time = now_t, updated_at = now_t
    WHERE id = p_sub_lot_id;

    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    VALUES (p_sub_lot_id, 'room_temp_dry_completed',
            jsonb_build_object('ended_at', now_t),
            auth.uid());

    RETURN qc_sub_lot_to_json(p_sub_lot_id);
END;
$$;

-- ── 10) Listing helpers ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION qc_list_room_temp_drying() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(
    qc_sub_lot_to_json(s.id) || jsonb_build_object(
      'room_temp_started_at', sess.started_at,
      'room_temp_elapsed_minutes', ROUND(EXTRACT(EPOCH FROM (now() - sess.started_at)) / 60.0, 1)
    )
    ORDER BY sess.started_at
  ), '[]'::jsonb)
  FROM qc_drying_sub_lot s
  INNER JOIN qc_room_temp_dry_session sess
    ON sess.drying_sub_lot_id = s.id AND sess.ended_at IS NULL
  WHERE s.status = 'room_temp_drying';
$$;

CREATE OR REPLACE FUNCTION qc_list_samples_for_sub_lot(p_sub_lot_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'sample_id', s.sample_id,
      'taken_at', s.taken_at,
      'status', s.status,
      'inspection_record_id', s.inspection_record_id,
      'aw', (SELECT (ir.values_json->>'aw')::numeric FROM qc_inspection_record ir WHERE ir.id = s.inspection_record_id),
      'result', (SELECT ir.result FROM qc_inspection_record ir WHERE ir.id = s.inspection_record_id)
    ) ORDER BY s.taken_at DESC
  ), '[]'::jsonb)
  FROM qc_sample s
  WHERE s.drying_sub_lot_id = p_sub_lot_id;
$$;

-- ── 11) Full sub-lot history ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION qc_sub_lot_full_history(p_sub_lot_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
    s qc_drying_sub_lot%ROWTYPE;
    result jsonb;
BEGIN
    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sub-lot not found'; END IF;

    result := jsonb_build_object(
      'sub_lot', qc_sub_lot_to_json(p_sub_lot_id, true),
      'spot_history', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', h.id,
          'dryer_number', h.dryer_number,
          'cell_number', h.cell_number,
          'started_at', h.started_at,
          'ended_at', h.ended_at,
          'end_reason', h.end_reason,
          'duration_minutes', h.duration_minutes
        ) ORDER BY h.started_at)
        FROM qc_sub_lot_spot_history h
        WHERE h.drying_sub_lot_id = p_sub_lot_id
      ), '[]'::jsonb),
      'samples', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', sa.id,
          'sample_id', sa.sample_id,
          'taken_at', sa.taken_at,
          'status', sa.status,
          'aw', (SELECT (ir.values_json->>'aw')::numeric FROM qc_inspection_record ir WHERE ir.id = sa.inspection_record_id),
          'result', (SELECT ir.result FROM qc_inspection_record ir WHERE ir.id = sa.inspection_record_id),
          'inspection_record_id', sa.inspection_record_id
        ) ORDER BY sa.taken_at)
        FROM qc_sample sa
        WHERE sa.drying_sub_lot_id = p_sub_lot_id
      ), '[]'::jsonb),
      'inspections', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', ir.id,
          'result', ir.result,
          'aw', (ir.values_json->>'aw')::numeric,
          'submitted_at', ir.submitted_at,
          'sample_id', (SELECT sa.sample_id FROM qc_sample sa WHERE sa.id = ir.sample_id)
        ) ORDER BY ir.submitted_at)
        FROM qc_inspection_record ir
        WHERE ir.drying_sub_lot_id = p_sub_lot_id
      ), '[]'::jsonb),
      'dispositions', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', d.id,
          'type', d.type,
          'remark', d.remark,
          'redry_expected_dry_minutes', d.redry_expected_dry_minutes,
          'created_at', d.created_at
        ) ORDER BY d.created_at)
        FROM qc_disposition d
        WHERE d.drying_sub_lot_id = p_sub_lot_id
      ), '[]'::jsonb),
      'room_temp_sessions', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', sess.id,
          'started_at', sess.started_at,
          'ended_at', sess.ended_at,
          'duration_minutes', sess.duration_minutes
        ) ORDER BY sess.started_at)
        FROM qc_room_temp_dry_session sess
        WHERE sess.drying_sub_lot_id = p_sub_lot_id
      ), '[]'::jsonb),
      'events', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', ev.id,
          'event_type', ev.event_type,
          'payload', ev.payload,
          'created_at', ev.created_at,
          'summary', qc_quality_event_summary(ev.event_type, ev.payload, s.sub_lot_code)
        ) ORDER BY ev.created_at)
        FROM qc_quality_event ev
        WHERE ev.drying_sub_lot_id = p_sub_lot_id
      ), '[]'::jsonb)
    );

    RETURN result;
END;
$$;

-- ── 12) Lookup: find sub-lot by sample identifier (text) ────────────────────

CREATE OR REPLACE FUNCTION qc_find_sub_lot_by_sample(p_sample_id text) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'sample_id', s.sample_id,
    'sample_pk', s.id,
    'drying_sub_lot_id', s.drying_sub_lot_id,
    'taken_at', s.taken_at,
    'status', s.status
  ) ORDER BY s.taken_at DESC), '[]'::jsonb)
  FROM qc_sample s
  WHERE s.sample_id = p_sample_id;
$$;

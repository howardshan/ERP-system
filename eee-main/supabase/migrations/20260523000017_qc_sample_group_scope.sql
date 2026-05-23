-- M-073: Group-scoped samples
--
-- A sample taken by a group champion now represents the ENTIRE group, not just
-- the one cart. Every sibling member should be able to see the sample and the
-- resulting inspection in its own history / badges.
--
-- Changes:
--   1. qc_sample.test_group_id (nullable FK to qc_test_group)
--   2. qc_take_sample: populate test_group_id from champion's sub_lot
--   3. qc_sub_lot_has_pending_sample: also checks group-level samples
--   4. qc_sub_lot_to_json: has_pending_sample / latest_pending_sample_id/pk
--      now search group samples too
--   5. qc_list_samples_for_sub_lot: returns group samples for all members
--   6. qc_sub_lot_full_history: samples + inspections include the group's
--      records for non-champion siblings

-- ── 1) DDL ───────────────────────────────────────────────────────────────────

ALTER TABLE qc_sample
  ADD COLUMN IF NOT EXISTS test_group_id uuid
    REFERENCES qc_test_group(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_qc_sample_test_group
  ON qc_sample(test_group_id)
  WHERE test_group_id IS NOT NULL;

-- ── 2) qc_take_sample — store group id alongside cart id ─────────────────────

CREATE OR REPLACE FUNCTION qc_take_sample(
    p_sub_lot_id uuid,
    p_sample_id  text
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    s      qc_drying_sub_lot%ROWTYPE;
    new_id uuid;
    row    qc_sample%ROWTYPE;
BEGIN
    IF p_sample_id IS NULL OR length(trim(p_sample_id)) = 0 THEN
        RAISE EXCEPTION 'Sample id is required';
    END IF;

    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sub-lot not found'; END IF;
    IF s.status NOT IN ('pending', 'inspecting') THEN
        RAISE EXCEPTION 'Cannot take a sample for sub-lot in status %', s.status;
    END IF;

    INSERT INTO qc_sample (drying_sub_lot_id, test_group_id, sample_id, taken_by_auth_id)
    VALUES (p_sub_lot_id, s.test_group_id, trim(p_sample_id), auth.uid())
    RETURNING id INTO new_id;

    SELECT * INTO row FROM qc_sample WHERE id = new_id;

    INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
    VALUES (p_sub_lot_id, 'sample_taken',
            jsonb_build_object(
                'sample_id',    row.sample_id,
                'sample_pk',    row.id,
                'test_group_id', s.test_group_id
            ),
            auth.uid());

    RETURN jsonb_build_object(
        'id',                  row.id,
        'drying_sub_lot_id',   row.drying_sub_lot_id,
        'test_group_id',       row.test_group_id,
        'sample_id',           row.sample_id,
        'taken_at',            row.taken_at,
        'status',              row.status
    );
END;
$$;

-- ── 3) qc_sub_lot_has_pending_sample — group-aware ───────────────────────────
--
-- Returns true when:
--   (a) this cart has a pending sample directly, OR
--   (b) it belongs to a group whose champion has a pending sample

CREATE OR REPLACE FUNCTION qc_sub_lot_has_pending_sample(p_sub_lot_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM   qc_sample sa
    WHERE  sa.status = 'pending'
      AND (
            sa.drying_sub_lot_id = p_sub_lot_id
        OR (
              sa.test_group_id IS NOT NULL
          AND sa.test_group_id = (
                SELECT test_group_id
                FROM   qc_drying_sub_lot
                WHERE  id = p_sub_lot_id
              )
          )
      )
  );
$$;

-- ── 4) qc_sub_lot_to_json — group-aware sample badge fields ──────────────────
--
-- Full replacement of the M-010 version; only the three pending-sample
-- sub-selects change (+ a minor inline comment update).

CREATE OR REPLACE FUNCTION qc_sub_lot_to_json(
    p_sub_lot_id         uuid,
    p_include_hold_detail boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
    s              qc_drying_sub_lot%ROWTYPE;
    lot            qc_production_lot%ROWTYPE;
    sku            qc_product_sku%ROWTYPE;
    loc            qc_drying_location%ROWTYPE;
    base_in_time   timestamptz;
    total_dried    int;
    remaining_min  int;
    expected_finish timestamptz;
    wait_min       int;
    out_json       jsonb;
    grp            qc_test_group%ROWTYPE;
    has_grp        boolean := false;
    hold_part      jsonb   := '{}'::jsonb;
    last_disp      record;
BEGIN
    SELECT * INTO s   FROM qc_drying_sub_lot WHERE id = p_sub_lot_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT * INTO lot FROM qc_production_lot  WHERE id = s.production_lot_id;
    SELECT * INTO sku FROM qc_product_sku     WHERE id = lot.sku_id;
    IF s.location_id IS NOT NULL THEN
        SELECT * INTO loc FROM qc_drying_location WHERE id = s.location_id;
    END IF;
    IF s.test_group_id IS NOT NULL THEN
        SELECT * INTO grp FROM qc_test_group WHERE id = s.test_group_id;
        has_grp := FOUND;
    END IF;

    base_in_time := s.in_time;
    total_dried := CASE
        WHEN s.in_time IS NULL THEN NULL
        WHEN s.out_time IS NULL THEN EXTRACT(EPOCH FROM (now() - s.in_time))::int / 60
        ELSE EXTRACT(EPOCH FROM (s.out_time - s.in_time))::int / 60
    END;

    IF s.expected_dry_minutes IS NOT NULL THEN
        remaining_min   := s.expected_dry_minutes - total_dried;
        expected_finish := s.in_time + (s.expected_dry_minutes * interval '1 minute');
    END IF;

    IF s.out_time IS NOT NULL AND s.status IN ('pending','inspecting','hold') THEN
        wait_min := EXTRACT(EPOCH FROM (now() - s.out_time))::int / 60;
    END IF;

    out_json := jsonb_build_object(
        'id',                    s.id,
        'production_lot_id',     s.production_lot_id,
        'sub_lot_code',          s.sub_lot_code,
        'location_id',           s.location_id,
        'location_name',         loc.display_name,
        'dryer_number',          COALESCE(s.dryer_number, loc.dryer_number),
        'cell_number',           loc.cell_number,
        'in_time',               s.in_time,
        'out_time',              s.out_time,
        'status',                s.status,
        'expected_dry_minutes',  s.expected_dry_minutes,
        'expected_finish_at',    expected_finish,
        'total_dried_minutes',   total_dried,
        'remaining_minutes',     remaining_min,
        'lot_number',            lot.lot_number,
        'lot_barcode',           lot.lot_barcode,
        'work_order_barcode',    lot.work_order_barcode,
        'sku_id',                lot.sku_id,
        'sku_code',              sku.code,
        'sku_name',              sku.name,
        'sample_every_n_carts',  sku.sample_every_n_carts,
        'test_group_id',         s.test_group_id,
        'test_group_sequence',   CASE WHEN has_grp THEN grp.group_sequence END,
        'test_group_status',     CASE WHEN has_grp THEN grp.status END,
        'test_group_member_count', CASE WHEN has_grp THEN grp.member_count END,
        'is_test_champion',      s.is_test_champion,
        'wait_minutes',          wait_min,
        -- Group-scoped: shows true for any member whose group champion has a
        -- pending sample (not just the champion itself).
        'has_pending_sample', EXISTS (
            SELECT 1 FROM qc_sample sa
            WHERE sa.status = 'pending'
              AND (
                    sa.drying_sub_lot_id = s.id
                OR  (s.test_group_id IS NOT NULL
                     AND sa.test_group_id = s.test_group_id)
              )
        ),
        'latest_pending_sample_id', (
            SELECT sa.sample_id FROM qc_sample sa
            WHERE sa.status = 'pending'
              AND (
                    sa.drying_sub_lot_id = s.id
                OR  (s.test_group_id IS NOT NULL
                     AND sa.test_group_id = s.test_group_id)
              )
            ORDER BY sa.taken_at DESC LIMIT 1
        ),
        'latest_pending_sample_pk', (
            SELECT sa.id FROM qc_sample sa
            WHERE sa.status = 'pending'
              AND (
                    sa.drying_sub_lot_id = s.id
                OR  (s.test_group_id IS NOT NULL
                     AND sa.test_group_id = s.test_group_id)
              )
            ORDER BY sa.taken_at DESC LIMIT 1
        )
    );

    IF p_include_hold_detail
       AND s.status IN ('hold','disposing','closed','room_temp_drying','awaiting_recheck')
    THEN
        SELECT d.* INTO last_disp
        FROM qc_disposition d
        WHERE d.drying_sub_lot_id = s.id
        ORDER BY d.created_at DESC LIMIT 1;

        SELECT jsonb_build_object(
            'hold_reason',       NULL,
            'hold_aw',           (ir.values_json->>'aw')::numeric,
            'hold_item_name',    t.item_name,
            'hold_lower_limit',  t.lower_limit,
            'hold_upper_limit',  t.upper_limit,
            'hold_inspected_at', ir.submitted_at
        ) INTO hold_part
        FROM qc_inspection_record ir
        LEFT JOIN qc_inspection_template t ON t.sku_id = lot.sku_id
        WHERE ir.drying_sub_lot_id = s.id AND ir.result = 'fail'
        ORDER BY ir.submitted_at DESC LIMIT 1;

        out_json := out_json || COALESCE(hold_part, '{}'::jsonb);
    END IF;

    RETURN out_json;
END;
$$;

-- ── 5) qc_list_samples_for_sub_lot — return group samples for all members ─────

CREATE OR REPLACE FUNCTION qc_list_samples_for_sub_lot(p_sub_lot_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id',                   sa.id,
      'sample_id',            sa.sample_id,
      'taken_at',             sa.taken_at,
      'status',               sa.status,
      'test_group_id',        sa.test_group_id,
      -- was this sample taken directly for this cart, or for the group champion?
      'is_group_sample',      sa.drying_sub_lot_id <> p_sub_lot_id,
      'inspection_record_id', sa.inspection_record_id,
      'aw',    (SELECT (ir.values_json->>'aw')::numeric FROM qc_inspection_record ir WHERE ir.id = sa.inspection_record_id),
      'result',(SELECT ir.result               FROM qc_inspection_record ir WHERE ir.id = sa.inspection_record_id)
    ) ORDER BY sa.taken_at DESC
  ), '[]'::jsonb)
  FROM qc_sample sa
  WHERE sa.id IN (
    -- direct samples for this cart
    SELECT id FROM qc_sample WHERE drying_sub_lot_id = p_sub_lot_id
    UNION
    -- group-level samples (champion's sample, any group member sees it)
    SELECT id FROM qc_sample
    WHERE test_group_id IS NOT NULL
      AND test_group_id = (
        SELECT test_group_id FROM qc_drying_sub_lot WHERE id = p_sub_lot_id
      )
  );
$$;

-- ── 6) qc_sub_lot_full_history — group samples + champion inspections ─────────

CREATE OR REPLACE FUNCTION qc_sub_lot_full_history(p_sub_lot_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
    s      qc_drying_sub_lot%ROWTYPE;
    result jsonb;
    grp_id uuid;
BEGIN
    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sub-lot not found'; END IF;

    grp_id := s.test_group_id;  -- may be NULL for solo carts

    result := jsonb_build_object(
        'sub_lot', qc_sub_lot_to_json(p_sub_lot_id, true),

        'spot_history', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id',               h.id,
                'dryer_number',     h.dryer_number,
                'cell_number',      h.cell_number,
                'started_at',       h.started_at,
                'ended_at',         h.ended_at,
                'end_reason',       h.end_reason,
                'duration_minutes', h.duration_minutes
            ) ORDER BY h.started_at)
            FROM qc_sub_lot_spot_history h
            WHERE h.drying_sub_lot_id = p_sub_lot_id
        ), '[]'::jsonb),

        -- Samples: direct + group (so siblings see champion's sample)
        'samples', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id',                   sa.id,
                'sample_id',            sa.sample_id,
                'taken_at',             sa.taken_at,
                'status',               sa.status,
                'test_group_id',        sa.test_group_id,
                'is_group_sample',      sa.drying_sub_lot_id <> p_sub_lot_id,
                'aw',    (SELECT (ir.values_json->>'aw')::numeric FROM qc_inspection_record ir WHERE ir.id = sa.inspection_record_id),
                'result',(SELECT ir.result               FROM qc_inspection_record ir WHERE ir.id = sa.inspection_record_id),
                'inspection_record_id', sa.inspection_record_id
            ) ORDER BY sa.taken_at)
            FROM qc_sample sa
            WHERE sa.id IN (
                SELECT id FROM qc_sample WHERE drying_sub_lot_id = p_sub_lot_id
                UNION
                SELECT id FROM qc_sample
                WHERE test_group_id = grp_id AND grp_id IS NOT NULL
            )
        ), '[]'::jsonb),

        -- Inspections: direct + group-champion's (via group sample linkage)
        -- This ensures a sibling can see the inspection that was done on the
        -- champion's sample and decided the group outcome.
        'inspections', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id',           ir.id,
                'result',       ir.result,
                'aw',           (ir.values_json->>'aw')::numeric,
                'submitted_at', ir.submitted_at,
                'sample_id',    (SELECT sa2.sample_id FROM qc_sample sa2 WHERE sa2.id = ir.sample_id),
                'is_group_inspection', ir.drying_sub_lot_id <> p_sub_lot_id
            ) ORDER BY ir.submitted_at)
            FROM qc_inspection_record ir
            WHERE ir.id IN (
                -- direct inspections for this cart
                SELECT id FROM qc_inspection_record WHERE drying_sub_lot_id = p_sub_lot_id
                UNION
                -- inspections linked to group samples (champion's inspections)
                SELECT ir2.id
                FROM   qc_inspection_record ir2
                JOIN   qc_sample sa ON sa.id = ir2.sample_id
                                   AND sa.test_group_id = grp_id
                WHERE  grp_id IS NOT NULL
            )
        ), '[]'::jsonb),

        'dispositions', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id',                         d.id,
                'type',                       d.type,
                'remark',                     d.remark,
                'redry_expected_dry_minutes', d.redry_expected_dry_minutes,
                'created_at',                 d.created_at
            ) ORDER BY d.created_at)
            FROM qc_disposition d
            WHERE d.drying_sub_lot_id = p_sub_lot_id
        ), '[]'::jsonb),

        'room_temp_sessions', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id',               sess.id,
                'started_at',       sess.started_at,
                'ended_at',         sess.ended_at,
                'duration_minutes', sess.duration_minutes
            ) ORDER BY sess.started_at)
            FROM qc_room_temp_dry_session sess
            WHERE sess.drying_sub_lot_id = p_sub_lot_id
        ), '[]'::jsonb),

        'events', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id',         ev.id,
                'event_type', ev.event_type,
                'payload',    ev.payload,
                'created_at', ev.created_at,
                'summary',    qc_quality_event_summary(ev.event_type, ev.payload, s.sub_lot_code)
            ) ORDER BY ev.created_at)
            FROM qc_quality_event ev
            WHERE ev.drying_sub_lot_id = p_sub_lot_id
        ), '[]'::jsonb)
    );

    RETURN result;
END;
$$;

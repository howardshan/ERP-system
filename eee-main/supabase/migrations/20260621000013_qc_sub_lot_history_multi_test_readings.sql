-- Migration M-146: surface ALL test readings (not just Aw) on each inspection
-- and sample row of qc_sub_lot_full_history.
--
-- WHY: M-138 introduced multi-test inspections; values_json now stores every
-- reading under the `readings` object keyed by template id. The Sub-lot
-- History drawer was still only reading the single `aw` field, so for SKUs
-- with multiple tests (Aw + Water Density, etc.) only Aw was visible —
-- operators couldn't see the density reading from the timeline.
--
-- WHAT: each inspection row and each sample row (joined via inspection_record_id)
-- gains a `readings` jsonb array of `{item_name, unit, value, in_hard, in_soft}`
-- sorted by item_name. For legacy single-Aw rows (no `readings` object) we
-- fall back to a synthetic single-entry array built from `values_json->>'aw'`,
-- so the drawer can always iterate `readings` uniformly.
--
-- Otherwise byte-identical to M-145.
--
-- Depends on: M-145 (20260621000012, historical groups), M-138
-- (20260621000005, multi-test values_json shape).
-- Affects: src/services/qcApi.ts (SubLotFullHistory types),
--   src/pages/qc/SubLotHistoryDrawer.tsx, docs/database/03..., docs/modules/09_qc.md.

-- ── Helper: flatten an inspection's values_json to a clean readings array ──
-- Multi-test path (M-138): values_json->'readings' is an object keyed by
-- template id; each value already carries item_name / unit / value / in_hard /
-- in_soft. We flatten to an array sorted by item_name for stable display.
-- Legacy single-Aw path: no 'readings' key — synthesise one entry from the
-- top-level 'aw' so the frontend can iterate `readings` uniformly.
-- NULL input → empty array (sample without an inspection_record yet).

CREATE OR REPLACE FUNCTION _qc_flatten_readings(p_values jsonb)
RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT CASE
        WHEN p_values IS NULL THEN '[]'::jsonb
        WHEN p_values ? 'readings' AND jsonb_typeof(p_values->'readings') = 'object' THEN
            COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'item_name', r.value->>'item_name',
                    'unit',      r.value->>'unit',
                    'value',     (r.value->>'value')::numeric,
                    'in_hard',   (r.value->>'in_hard')::boolean,
                    'in_soft',   (r.value->>'in_soft')::boolean
                ) ORDER BY r.value->>'item_name')
                FROM jsonb_each(p_values->'readings') r
            ), '[]'::jsonb)
        WHEN (p_values->>'aw') IS NOT NULL THEN
            jsonb_build_array(jsonb_build_object(
                'item_name', 'Water Activity',
                'unit',      'Aw',
                'value',     (p_values->>'aw')::numeric
            ))
        ELSE '[]'::jsonb
    END;
$$;

CREATE OR REPLACE FUNCTION qc_sub_lot_full_history(p_sub_lot_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
    s       qc_drying_sub_lot%ROWTYPE;
    result  jsonb;
    grp_ids uuid[];
BEGIN
    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sub-lot not found'; END IF;

    -- M-145: current group + every historical group this cart was ever in.
    SELECT array_agg(DISTINCT g) INTO grp_ids
    FROM (
        SELECT s.test_group_id AS g
        UNION
        SELECT (e.payload->>'test_group_id')::uuid AS g
        FROM   qc_quality_event e
        WHERE  e.drying_sub_lot_id = p_sub_lot_id
          AND  e.event_type = 'group_assigned'
          AND  e.payload ? 'test_group_id'
    ) t
    WHERE g IS NOT NULL;

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
                'readings', _qc_flatten_readings(
                    (SELECT ir.values_json FROM qc_inspection_record ir WHERE ir.id = sa.inspection_record_id)
                ),
                'inspection_record_id', sa.inspection_record_id
            ) ORDER BY sa.taken_at)
            FROM qc_sample sa
            WHERE sa.id IN (
                SELECT id FROM qc_sample WHERE drying_sub_lot_id = p_sub_lot_id
                UNION
                SELECT id FROM qc_sample
                WHERE grp_ids IS NOT NULL AND test_group_id = ANY(grp_ids)
            )
        ), '[]'::jsonb),

        'inspections', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id',           ir.id,
                'result',       ir.result,
                'aw',           (ir.values_json->>'aw')::numeric,
                'readings',     _qc_flatten_readings(ir.values_json),
                'remark',       ir.remark,
                'submitted_at', ir.submitted_at,
                'sample_id',    (SELECT sa2.sample_id FROM qc_sample sa2 WHERE sa2.id = ir.sample_id),
                'is_group_inspection', ir.drying_sub_lot_id <> p_sub_lot_id
            ) ORDER BY ir.submitted_at)
            FROM qc_inspection_record ir
            WHERE ir.id IN (
                SELECT id FROM qc_inspection_record WHERE drying_sub_lot_id = p_sub_lot_id
                UNION
                SELECT ir2.id
                FROM   qc_inspection_record ir2
                JOIN   qc_sample sa ON sa.id = ir2.sample_id
                WHERE  grp_ids IS NOT NULL AND sa.test_group_id = ANY(grp_ids)
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

-- Migration M-145: include samples and inspections from ALL historical
-- sampling groups in qc_sub_lot_full_history (not just the current one).
--
-- BUG REPORTED FROM PRODUCTION → BATCH TRACE:
--   A cart that went through several rounds of testing (e.g. champion fails →
--   redry → new group → re-tested again, repeat) only ever showed the LATEST
--   "Sample taken" entry plus the latest inspection in the Sub-lot History
--   drawer. Earlier cycles' results were invisible.
--
-- ROOT CAUSE:
--   M-109's qc_sub_lot_full_history scoped the samples and inspections queries
--   to the cart's CURRENT `test_group_id` (`s.test_group_id`). Every time the
--   cart goes through a redry pass it gets a NEW `test_group_id` written into
--   qc_drying_sub_lot via Step 2a/2b of qc_check_out_sub_lots_bulk — the old
--   group id is lost from the row. Any sample or inspection that lived under
--   the old group id (e.g. on a former champion sibling) is no longer matched.
--
-- FIX:
--   Collect the cart's CURRENT test_group_id plus EVERY historical
--   test_group_id from its `group_assigned` quality events. Match samples and
--   inspections against the union — both direct (on this cart) and any group
--   the cart has ever been a member of. Identical query shape otherwise.
--
-- Depends on: M-109 (20260527000006, latest qc_sub_lot_full_history).
-- Affects: docs/database/03..., docs/modules/09_qc.md. No frontend changes.

CREATE OR REPLACE FUNCTION qc_sub_lot_full_history(p_sub_lot_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
    s       qc_drying_sub_lot%ROWTYPE;
    result  jsonb;
    grp_ids uuid[];
BEGIN
    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sub-lot not found'; END IF;

    -- M-145: current group + every historical group this cart was ever a
    -- member of (tracked via group_assigned events). May be empty for a solo
    -- cart that's never been part of any sampling group.
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

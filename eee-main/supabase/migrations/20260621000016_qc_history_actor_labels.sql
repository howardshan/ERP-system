-- ─────────────────────────────────────────────────────────────────────────────
-- M-149  Surface "who did it" on the QC sub-lot timeline
--
-- Every QC write already stamps the acting account (actor_auth_id / inspector_
-- auth_id / taken_by_auth_id / operator_auth_id / started_by/ended_by_auth_id),
-- but qc_sub_lot_full_history never returned it, so the timeline UI couldn't show
-- it. This resolves each id to a display label and adds it to every history row.
--
-- qc_actor_label(uuid): SECURITY DEFINER so it can fall back to auth.users.email
-- for accounts not in erp_user (e.g. the dev superuser). Resolution order:
-- erp_user.full_name → erp_user.email → auth.users.email → NULL.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.qc_actor_label(p_auth_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
    SELECT CASE WHEN p_auth_id IS NULL THEN NULL ELSE COALESCE(
        (SELECT NULLIF(btrim(eu.full_name), '') FROM erp_user eu WHERE eu.auth_user_id = p_auth_id LIMIT 1),
        (SELECT eu.email FROM erp_user eu WHERE eu.auth_user_id = p_auth_id LIMIT 1),
        (SELECT au.email FROM auth.users au WHERE au.id = p_auth_id)
    ) END;
$$;

CREATE OR REPLACE FUNCTION public.qc_sub_lot_full_history(p_sub_lot_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $function$
DECLARE
    s       qc_drying_sub_lot%ROWTYPE;
    result  jsonb;
    grp_ids uuid[];
BEGIN
    SELECT * INTO s FROM qc_drying_sub_lot WHERE id = p_sub_lot_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sub-lot not found'; END IF;

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
                'taken_by',             qc_actor_label(sa.taken_by_auth_id),
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
                'inspector',    qc_actor_label(ir.inspector_auth_id),
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
                'created_at',                 d.created_at,
                'operator',                   qc_actor_label(d.operator_auth_id)
            ) ORDER BY d.created_at)
            FROM qc_disposition d
            WHERE d.drying_sub_lot_id = p_sub_lot_id
        ), '[]'::jsonb),

        'room_temp_sessions', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id',               sess.id,
                'started_at',       sess.started_at,
                'ended_at',         sess.ended_at,
                'duration_minutes', sess.duration_minutes,
                'started_by',       qc_actor_label(sess.started_by_auth_id),
                'ended_by',         qc_actor_label(sess.ended_by_auth_id)
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
                'actor',      qc_actor_label(ev.actor_auth_id),
                'summary',    qc_quality_event_summary(ev.event_type, ev.payload, s.sub_lot_code)
            ) ORDER BY ev.created_at)
            FROM qc_quality_event ev
            WHERE ev.drying_sub_lot_id = p_sub_lot_id
        ), '[]'::jsonb)
    );

    RETURN result;
END;
$function$;

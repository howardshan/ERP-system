-- Migration M-108: expose the production lot's created_at as `produced_at` on
-- the sub-lot JSON, so the Testing header can show "produced / drying done".
--
-- Drying-done time is already available as out_time. There is no dedicated
-- production-completed timestamp in the schema; qc_production_lot.created_at
-- (when the work order / batch was registered) is the best available proxy.
-- Additive only — adds one field to qc_sub_lot_to_json output.
--
-- Depends on: M-067 (20260523000017, latest qc_sub_lot_to_json).
-- Affects: src/services/qcApi.ts (SubLot type), src/pages/qc/TestingPage.tsx,
--          docs/modules/09_qc.md.

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
        'produced_at',           lot.created_at,
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

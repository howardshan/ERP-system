-- Migration M-085: Add sampling-group members to the QC test-result email payload.
--
-- WHY: a QC test on a sampling group only physically tests ONE champion cart, but
-- its pass/fail applies to ALL carts in the group (pass → all pass, fail → all fail,
-- see M-048/M-056). The email previously showed only the tested cart's sub_lot_code,
-- so recipients couldn't see which other carts the result actually covers.
-- This adds is_group / group_size / group_members (each {code, tested}) to the payload.
-- Solo (ungrouped) tests report a single-member group with tested=true.
--
-- Depends on: M-083 (qc_test_result_email), M-048 (qc_test_group / test_group_id).
-- Affects: supabase/functions/send-notification (EF-004 renders the new fields),
--          docs/database/03..., docs/modules/09_qc.md.

CREATE OR REPLACE FUNCTION qc_test_result_email(p_inspection_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'batch', jsonb_build_object(
            'inspection_id', ir.id,
            'sub_lot_code',  s.sub_lot_code,
            'sku_code',      sku.code,
            'sku_name',      sku.name,
            'lot_number',    lot.lot_number,
            'aw',            (ir.values_json->>'aw')::numeric,
            'result',        ir.result,
            'current_status', s.status,
            'submitted_at',  ir.submitted_at,
            'inspector',     COALESCE(eu.full_name, au.email),
            'sample_id',     (SELECT sa.sample_id FROM qc_sample sa WHERE sa.id = ir.sample_id),
            -- Sampling group: the tested cart is the champion; its result covers the
            -- whole group. is_group is true only when the group has more than one cart.
            'is_group',      (s.test_group_id IS NOT NULL
                              AND (SELECT COUNT(*) FROM qc_drying_sub_lot sl
                                     WHERE sl.test_group_id = s.test_group_id) > 1),
            'group_size',    CASE WHEN s.test_group_id IS NOT NULL
                                  THEN (SELECT COUNT(*) FROM qc_drying_sub_lot sl
                                          WHERE sl.test_group_id = s.test_group_id)
                                  ELSE 1 END,
            'group_members', CASE WHEN s.test_group_id IS NOT NULL THEN
                               (SELECT jsonb_agg(
                                          jsonb_build_object('code', sl.sub_lot_code,
                                                             'tested', sl.id = s.id)
                                          ORDER BY sl.sub_lot_code)
                                FROM qc_drying_sub_lot sl
                                WHERE sl.test_group_id = s.test_group_id)
                             ELSE jsonb_build_array(
                                    jsonb_build_object('code', s.sub_lot_code, 'tested', true))
                             END
        ),
        'stats', (qc_overview() -> 'stats')
    )
    FROM qc_inspection_record ir
    JOIN qc_drying_sub_lot s        ON s.id = ir.drying_sub_lot_id
    LEFT JOIN qc_production_lot lot ON lot.id = s.production_lot_id
    LEFT JOIN qc_product_sku sku    ON sku.id = lot.sku_id
    LEFT JOIN auth.users au         ON au.id = ir.inspector_auth_id
    LEFT JOIN erp_user eu           ON eu.auth_user_id = au.id
    WHERE ir.id = p_inspection_id;
$$;

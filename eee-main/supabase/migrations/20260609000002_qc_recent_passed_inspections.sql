-- Migration M-121: qc_recent_passed_inspections(p_days)
--
-- Mirrors M-058 (qc_recent_failed_inspections) for passes. Powers the new
-- "Passed today" detail panel on QC Home — operators wanted the same
-- click-to-expand view they have for fails, so they can audit what passed,
-- see the Aw readings, and tell at a glance which carts are still sitting
-- in `passed` waiting for someone to click Release.
--
-- Each row carries an `outcome`:
--   `released`         — no group member is still in status `passed`
--                        (everything moved on: closed / dispatched / etc.)
--   `awaiting_release` — at least one group member is still `passed`
--
-- For solo carts (no test_group_id) the outcome is read straight off the
-- cart's own status.
--
-- Depends on: M-058 (qc_recent_failed_inspections — shape reference).
-- Affects: src/services/qcApi.ts, src/pages/qc/QcHome.tsx,
--   docs/database/03..., docs/modules/09_qc.md.

CREATE OR REPLACE FUNCTION qc_recent_passed_inspections(p_days int DEFAULT 2)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(row_obj ORDER BY (row_obj->>'submitted_at') DESC)
    FROM (
      SELECT jsonb_build_object(
        'inspection_id',      ir.id,
        'sample_id',          (SELECT sa.sample_id FROM qc_sample sa WHERE sa.id = ir.sample_id),
        'aw',                 (ir.values_json->>'aw')::numeric,
        'submitted_at',       ir.submitted_at,
        'sku_name',           sku.name,
        'lot_number',         lot.lot_number,
        'work_order_barcode', lot.work_order_barcode,
        'champion_code',      s.sub_lot_code,
        'test_group_id',      s.test_group_id,
        'outcome',            CASE
          WHEN s.test_group_id IS NOT NULL THEN (
            CASE
              WHEN EXISTS (
                SELECT 1 FROM qc_drying_sub_lot sl
                WHERE sl.test_group_id = s.test_group_id
                  AND sl.status = 'passed'
              ) THEN 'awaiting_release'
              ELSE 'released'
            END
          )
          ELSE
            CASE WHEN s.status = 'passed' THEN 'awaiting_release' ELSE 'released' END
        END,
        'group_members',      CASE
          WHEN s.test_group_id IS NOT NULL THEN (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id',            m.id,
                'sub_lot_code',  m.sub_lot_code,
                'status',        m.status,
                'is_champion',   m.is_test_champion
              ) ORDER BY m.sub_lot_code
            )
            FROM qc_drying_sub_lot m
            WHERE m.test_group_id = s.test_group_id
          )
          ELSE jsonb_build_array(
            jsonb_build_object(
              'id',           s.id,
              'sub_lot_code', s.sub_lot_code,
              'status',       s.status,
              'is_champion',  true
            )
          )
        END
      ) AS row_obj
      FROM qc_inspection_record ir
      JOIN qc_drying_sub_lot s ON s.id = ir.drying_sub_lot_id
      LEFT JOIN qc_production_lot lot ON lot.id = s.production_lot_id
      LEFT JOIN qc_product_sku sku ON sku.id = lot.sku_id
      WHERE ir.result = 'pass'
        AND ir.submitted_at >= now() - (p_days * interval '1 day')
      ORDER BY ir.submitted_at DESC
    ) sub
  ), '[]'::jsonb);
END;
$$;

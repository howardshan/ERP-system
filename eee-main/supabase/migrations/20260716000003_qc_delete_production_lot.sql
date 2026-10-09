-- ─────────────────────────────────────────────────────────────────────────────
-- M-174  qc_delete_production_lot: delete a work order that hasn't started
--        production (BR-Q90)
--
-- Operators occasionally create a work order against the wrong product / number
-- and want to remove it before any carts reach a dryer. This RPC deletes a
-- qc_production_lot, but ONLY while it is untouched:
--   * every cart still status='created' (never scanned, never in a dryer):
--       scanned_for_check_in_at IS NULL AND in_time IS NULL
--   * no sampling groups, no samples, no inspection records
-- If any of those exist, production has begun and the delete is refused — we must
-- never cascade-erase real drying / sampling / inspection history.
--
-- Deleting the qc_production_lot cascades to its carts (ON DELETE CASCADE) and,
-- through them, to their sub_lot_created quality events / samples / spot history,
-- plus the lot's qc_test_group rows (also ON DELETE CASCADE). The only thing NOT
-- reachable by cascade is the paired warehouse lot pre-created at creation
-- (qc_production_lot.lot_id → lot(id), M-134): it's an empty quarantine lot
-- (wh_create_lot inserts only the lot row, no inventory activity), so we remove
-- it too. The delete is wrapped so that if that lot somehow has downstream
-- references it is simply left in place rather than aborting the whole operation.
--
-- Confirmation ("type DELETE") is enforced in the UI; the RPC is the authority on
-- the not-started invariant.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION qc_delete_production_lot(p_production_lot_id uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    lot         qc_production_lot%ROWTYPE;
    v_total     int;
    v_started   int;
    v_groups    int;
    v_samples   int;
    v_insp      int;
    v_wh_lot_id bigint;
    v_wh_deleted boolean := false;
BEGIN
    SELECT * INTO lot FROM qc_production_lot WHERE id = p_production_lot_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Work order not found' USING ERRCODE = 'no_data_found';
    END IF;

    -- Not-started invariant: all carts still 'created', never scanned / dried.
    SELECT count(*),
           count(*) FILTER (
             WHERE s.status <> 'created'
                OR s.scanned_for_check_in_at IS NOT NULL
                OR s.in_time IS NOT NULL)
      INTO v_total, v_started
      FROM qc_drying_sub_lot s
     WHERE s.production_lot_id = p_production_lot_id;

    SELECT count(*) INTO v_groups
      FROM qc_test_group WHERE production_lot_id = p_production_lot_id;

    SELECT count(*) INTO v_samples
      FROM qc_sample sa
      JOIN qc_drying_sub_lot s ON s.id = sa.drying_sub_lot_id
     WHERE s.production_lot_id = p_production_lot_id;

    SELECT count(*) INTO v_insp
      FROM qc_inspection_record ir
      JOIN qc_drying_sub_lot s ON s.id = ir.drying_sub_lot_id
     WHERE s.production_lot_id = p_production_lot_id;

    IF v_started > 0 OR v_groups > 0 OR v_samples > 0 OR v_insp > 0 THEN
        RAISE EXCEPTION
          'Cannot delete work order % — production has started (started carts=%, groups=%, samples=%, inspections=%)',
          lot.work_order_barcode, v_started, v_groups, v_samples, v_insp
          USING ERRCODE = 'check_violation';
    END IF;

    v_wh_lot_id := lot.lot_id;

    -- Cascades: carts → their events / samples / spot history; + qc_test_group.
    DELETE FROM qc_production_lot WHERE id = p_production_lot_id;

    -- Remove the empty quarantine warehouse lot pre-created at WO creation, if
    -- any. Guarded: if it has downstream references, leave it rather than abort.
    IF v_wh_lot_id IS NOT NULL THEN
        BEGIN
            DELETE FROM lot WHERE id = v_wh_lot_id;
            v_wh_deleted := true;
        EXCEPTION WHEN foreign_key_violation THEN
            v_wh_deleted := false;
        END;
    END IF;

    RETURN jsonb_build_object(
        'deleted',               true,
        'work_order_barcode',    lot.work_order_barcode,
        'lot_number',            lot.lot_number,
        'carts_deleted',         v_total,
        'warehouse_lot_deleted', v_wh_deleted
    );
END;
$$;

COMMENT ON FUNCTION qc_delete_production_lot(uuid) IS
  'M-174 (BR-Q90): delete a work order only while un-started (all carts still ''created'', never scanned/dried, no groups/samples/inspections). Cascades carts + test groups; also removes the empty pre-created quarantine warehouse lot. Refuses once production has begun.';

-- Seed the delete permission for the dev admin (same pattern as other seeds).
INSERT INTO user_permission_grant (user_id, module_id, resource, permission, approval_limit)
SELECT eu.id, 'production', 'trace', 'delete_work_order', NULL
FROM erp_user eu
WHERE eu.email = 'ysha@smu.edu'
ON CONFLICT (user_id, module_id, resource, permission) DO NOTHING;

-- M-069: Sort qc_list_sub_lots by sub_lot_code ASC instead of created_at DESC.
--
-- Root cause: with ORDER BY created_at DESC, the first-created cart (e.g. 001)
-- sinks to the bottom of the "Awaiting check-in" list.  Sorting by sub_lot_code
-- gives a natural, predictable ascending order (001 → 002 → … → 010).

CREATE OR REPLACE FUNCTION qc_list_sub_lots(p_production_lot_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        jsonb_agg(qc_sub_lot_to_json(s.id) ORDER BY s.sub_lot_code ASC),
        '[]'::jsonb
    )
    FROM qc_drying_sub_lot s
    WHERE p_production_lot_id IS NULL OR s.production_lot_id = p_production_lot_id;
$$;

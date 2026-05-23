-- Migration M-049: expose sample_every_n_carts on qc_list_products() output
-- (follow-up to M-048 — needed by ProductManagement to display/edit the rate)

CREATE OR REPLACE FUNCTION qc_list_products() RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', sku.id,
            'code', sku.code,
            'name', sku.name,
            'standard_drying_minutes', sku.standard_drying_minutes,
            'sample_every_n_carts', sku.sample_every_n_carts,
            'templates', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'id', t.id,
                    'sku_id', t.sku_id,
                    'item_name', t.item_name,
                    'unit', t.unit,
                    'lower_limit', t.lower_limit,
                    'upper_limit', t.upper_limit
                ))
                FROM qc_inspection_template t WHERE t.sku_id = sku.id
            ), '[]'::jsonb)
        ) ORDER BY sku.code
    ), '[]'::jsonb)
    FROM qc_product_sku sku;
$$;

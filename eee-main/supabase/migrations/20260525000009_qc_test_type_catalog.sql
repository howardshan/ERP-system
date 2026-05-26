-- M-087: Introduce qc_test_type catalog so products can be assigned multiple
--        named tests (Water Activity, Moisture Content, pH, etc.) each with
--        their own per-SKU acceptance limits.
--
-- Changes:
--   1. New table: qc_test_type  (global catalog of test names + default units)
--   2. Add test_type_id FK to qc_inspection_template (nullable for compat)
--   3. Seed "Water Activity (Aw)" as the first type and back-fill existing rows
--   4. Update qc_list_products() to expose test_type_id in each template object

-- ── 1) qc_test_type catalog ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qc_test_type (
    id          serial      PRIMARY KEY,
    name        text        NOT NULL UNIQUE,
    unit        text,           -- default display unit (e.g. "Aw", "%", "pH")
    description text,
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE qc_test_type ENABLE ROW LEVEL SECURITY;
CREATE POLICY dev_all ON qc_test_type FOR ALL USING (true) WITH CHECK (true);

-- ── 2) Seed the original Water Activity type ────────────────────────────────
INSERT INTO qc_test_type (id, name, unit, description)
VALUES (1, 'Water Activity (Aw)', 'Aw', 'Water activity measurement for post-dry QC')
ON CONFLICT (name) DO NOTHING;

-- Keep the serial sequence in sync after explicit id insert
SELECT setval(pg_get_serial_sequence('qc_test_type', 'id'), GREATEST(1, (SELECT MAX(id) FROM qc_test_type)));

-- ── 3) Add test_type_id FK to qc_inspection_template ────────────────────────
ALTER TABLE qc_inspection_template
    ADD COLUMN IF NOT EXISTS test_type_id int REFERENCES qc_test_type(id) ON DELETE SET NULL;

-- Back-fill: existing "Water Activity (Aw)" templates → type 1
UPDATE qc_inspection_template
SET    test_type_id = 1
WHERE  test_type_id IS NULL
  AND  item_name ILIKE '%water activity%';

-- ── 4) Update qc_list_products() to expose test_type_id + type metadata ─────
CREATE OR REPLACE FUNCTION qc_list_products() RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id',                     sku.id,
            'code',                   sku.code,
            'name',                   sku.name,
            'standard_drying_minutes', sku.standard_drying_minutes,
            'sample_every_n_carts',   sku.sample_every_n_carts,
            'templates', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'id',           t.id,
                    'sku_id',       t.sku_id,
                    'test_type_id', t.test_type_id,
                    'item_name',    COALESCE(tt.name, t.item_name),
                    'unit',         COALESCE(tt.unit, t.unit),
                    'lower_limit',  t.lower_limit,
                    'upper_limit',  t.upper_limit
                ) ORDER BY t.created_at)
                FROM qc_inspection_template t
                LEFT JOIN qc_test_type tt ON tt.id = t.test_type_id
                WHERE t.sku_id = sku.id
            ), '[]'::jsonb)
        ) ORDER BY sku.code
    ), '[]'::jsonb)
    FROM qc_product_sku sku;
$$;

-- Migration M-033: Quality Control initial schema
-- Ports qc-demo into main ERP. All tables live in the default `public` schema
-- under the `qc_` prefix (mirroring the `hr_*` convention) so PostgREST exposes
-- them without extra config. Actor references point at auth.users; permission
-- gating is done at the app layer via user_permission_grant.

-- ─── Product master ─────────────────────────────────────────────────────────

CREATE TABLE qc_product_sku (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code                     text NOT NULL UNIQUE,
    name                     text NOT NULL,
    standard_drying_minutes  integer,
    created_at               timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN qc_product_sku.standard_drying_minutes IS 'SOP reference drying duration in minutes';

CREATE TABLE qc_inspection_template (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sku_id       uuid NOT NULL REFERENCES qc_product_sku(id) ON DELETE CASCADE,
    item_name    text NOT NULL,
    unit         text,
    lower_limit  numeric(10, 4) NOT NULL,
    upper_limit  numeric(10, 4) NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (sku_id, item_name),
    CONSTRAINT qc_inspection_template_limits_check CHECK (lower_limit <= upper_limit)
);

-- ─── Drying locations (dryer racks / positions) ─────────────────────────────

CREATE TABLE qc_drying_location (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code          text NOT NULL UNIQUE,
    display_name  text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- ─── Production lots & drying sub-lots ──────────────────────────────────────

CREATE TABLE qc_production_lot (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lot_number          text NOT NULL UNIQUE,
    lot_barcode         text NOT NULL,
    work_order_barcode  text NOT NULL,
    sku_id              uuid NOT NULL REFERENCES qc_product_sku(id),
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE qc_drying_sub_lot (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    production_lot_id   uuid NOT NULL REFERENCES qc_production_lot(id) ON DELETE CASCADE,
    sub_lot_code        text NOT NULL UNIQUE,
    location_id         uuid REFERENCES qc_drying_location(id),
    in_time             timestamptz,
    out_time            timestamptz,
    status              text NOT NULL DEFAULT 'pending'
        CHECK (status IN (
            'drying', 'pending', 'inspecting', 'passed', 'hold', 'disposing', 'closed'
        )),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ─── Inspection records, dispositions, quality events ──────────────────────

CREATE TABLE qc_inspection_record (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    drying_sub_lot_id    uuid NOT NULL REFERENCES qc_drying_sub_lot(id) ON DELETE CASCADE,
    inspector_auth_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    values_json          jsonb NOT NULL DEFAULT '{}'::jsonb,
    result               text NOT NULL CHECK (result IN ('pass', 'fail')),
    submitted_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE qc_disposition (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    drying_sub_lot_id    uuid NOT NULL REFERENCES qc_drying_sub_lot(id) ON DELETE CASCADE,
    type                 text NOT NULL
        CHECK (type IN ('rework', 'grind', 'scrap', 'concession')),
    remark               text,
    operator_auth_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE qc_quality_event (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    drying_sub_lot_id    uuid REFERENCES qc_drying_sub_lot(id) ON DELETE SET NULL,
    event_type           text NOT NULL,
    payload              jsonb NOT NULL DEFAULT '{}'::jsonb,
    actor_auth_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at           timestamptz NOT NULL DEFAULT now()
);

-- ─── Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX idx_qc_drying_sub_lot_status         ON qc_drying_sub_lot(status);
CREATE INDEX idx_qc_drying_sub_lot_out_time       ON qc_drying_sub_lot(out_time);
CREATE INDEX idx_qc_drying_sub_lot_production_lot ON qc_drying_sub_lot(production_lot_id);
CREATE INDEX idx_qc_quality_event_sub_lot         ON qc_quality_event(drying_sub_lot_id);
CREATE INDEX idx_qc_inspection_record_sub_lot     ON qc_inspection_record(drying_sub_lot_id);
CREATE INDEX idx_qc_disposition_sub_lot           ON qc_disposition(drying_sub_lot_id);

-- ─── RLS (dev-mode permissive; tightened later via app-level grants) ───────

ALTER TABLE qc_product_sku         ENABLE ROW LEVEL SECURITY;
ALTER TABLE qc_inspection_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE qc_drying_location     ENABLE ROW LEVEL SECURITY;
ALTER TABLE qc_production_lot      ENABLE ROW LEVEL SECURITY;
ALTER TABLE qc_drying_sub_lot      ENABLE ROW LEVEL SECURITY;
ALTER TABLE qc_inspection_record   ENABLE ROW LEVEL SECURITY;
ALTER TABLE qc_disposition         ENABLE ROW LEVEL SECURITY;
ALTER TABLE qc_quality_event       ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dev_all" ON qc_product_sku         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON qc_inspection_template FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON qc_drying_location     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON qc_production_lot      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON qc_drying_sub_lot      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON qc_inspection_record   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON qc_disposition         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dev_all" ON qc_quality_event       FOR ALL USING (true) WITH CHECK (true);

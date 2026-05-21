-- QC Demo initial schema (run in Supabase SQL Editor or via supabase db push)

CREATE SCHEMA IF NOT EXISTS qc;

CREATE TABLE qc.app_user (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username    text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    role        text NOT NULL CHECK (role IN ('qc', 'manager')),
    display_name text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE qc.product_sku (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code        text NOT NULL UNIQUE,
    name        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE qc.inspection_template (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sku_id      uuid NOT NULL REFERENCES qc.product_sku(id) ON DELETE CASCADE,
    item_name   text NOT NULL,
    unit        text,
    lower_limit numeric(10, 4) NOT NULL,
    upper_limit numeric(10, 4) NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (sku_id, item_name)
);

CREATE TABLE qc.drying_location (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code        text NOT NULL UNIQUE,
    display_name text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE qc.production_lot (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lot_number          text NOT NULL UNIQUE,
    lot_barcode         text NOT NULL,
    work_order_barcode  text NOT NULL,
    sku_id              uuid NOT NULL REFERENCES qc.product_sku(id),
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE qc.drying_sub_lot (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    production_lot_id   uuid NOT NULL REFERENCES qc.production_lot(id) ON DELETE CASCADE,
    sub_lot_code        text NOT NULL UNIQUE,
    location_id         uuid REFERENCES qc.drying_location(id),
    in_time             timestamptz,
    out_time            timestamptz,
    status              text NOT NULL DEFAULT 'pending'
        CHECK (status IN (
            'pending', 'inspecting', 'passed', 'hold', 'disposing', 'closed'
        )),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE qc.inspection_record (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    drying_sub_lot_id   uuid NOT NULL REFERENCES qc.drying_sub_lot(id) ON DELETE CASCADE,
    inspector_id        uuid REFERENCES qc.app_user(id),
    values_json         jsonb NOT NULL DEFAULT '{}',
    result              text NOT NULL CHECK (result IN ('pass', 'fail')),
    submitted_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE qc.disposition (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    drying_sub_lot_id   uuid NOT NULL REFERENCES qc.drying_sub_lot(id) ON DELETE CASCADE,
    type                text NOT NULL
        CHECK (type IN ('rework', 'grind', 'scrap', 'concession')),
    remark              text,
    operator_id         uuid REFERENCES qc.app_user(id),
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE qc.quality_event (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    drying_sub_lot_id   uuid REFERENCES qc.drying_sub_lot(id) ON DELETE SET NULL,
    event_type          text NOT NULL,
    payload             jsonb NOT NULL DEFAULT '{}',
    actor_id            uuid REFERENCES qc.app_user(id),
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_drying_sub_lot_status ON qc.drying_sub_lot(status);
CREATE INDEX idx_drying_sub_lot_out_time ON qc.drying_sub_lot(out_time);
CREATE INDEX idx_quality_event_sub_lot ON qc.quality_event(drying_sub_lot_id);

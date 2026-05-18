-- =============================================================
--  Pet Food ERP — Full Schema (PostgreSQL / Supabase)
--  Sections 1-7: Operations core
--  Section 8:    Finance (financial-core.md version — more complete)
-- =============================================================


-- =============================================================
--  SECTION 1 — REFERENCE & MASTER DATA
-- =============================================================

CREATE TABLE uom (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code        text NOT NULL UNIQUE,
    name        text NOT NULL,
    uom_type    text NOT NULL
                CHECK (uom_type IN ('weight','volume','count')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  text
);

CREATE TABLE item_category (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code        text NOT NULL UNIQUE,
    name        text NOT NULL,
    parent_id   bigint REFERENCES item_category(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  text
);

CREATE TABLE warehouse (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code        text NOT NULL UNIQUE,
    name        text NOT NULL,
    address     text,
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  text
);

CREATE TABLE location (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    warehouse_id  bigint NOT NULL REFERENCES warehouse(id),
    code          text NOT NULL,
    name          text,
    location_type text NOT NULL
                  CHECK (location_type IN
                  ('storage','receiving','shipping','production','quarantine')),
    is_active     boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    text,
    UNIQUE (warehouse_id, code)
);

CREATE TABLE supplier (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code           text NOT NULL UNIQUE,
    name           text NOT NULL,
    contact_name   text,
    email          text,
    phone          text,
    address        text,
    payment_terms  text,
    is_active      boolean NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now(),
    created_by     text
);

CREATE TABLE customer (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code             text NOT NULL UNIQUE,
    name             text NOT NULL,
    contact_name     text,
    email            text,
    phone            text,
    billing_address  text,
    shipping_address text,
    payment_terms    text,
    credit_limit     numeric(18,4),
    is_active        boolean NOT NULL DEFAULT true,
    created_at       timestamptz NOT NULL DEFAULT now(),
    created_by       text
);

CREATE TABLE item (
    id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sku                  text NOT NULL UNIQUE,
    name                 text NOT NULL,
    description          text,
    item_type            text NOT NULL
                         CHECK (item_type IN
                         ('raw_material','packaging','intermediate','finished_good')),
    category_id          bigint REFERENCES item_category(id),
    base_uom_id          bigint NOT NULL REFERENCES uom(id),
    is_lot_controlled    boolean NOT NULL DEFAULT true,
    shelf_life_days      integer,
    default_warehouse_id bigint REFERENCES warehouse(id),
    costing_method       text NOT NULL DEFAULT 'weighted_average'
                         CHECK (costing_method IN
                         ('standard','weighted_average','fifo')),
    standard_cost        numeric(18,4),
    allergen_info        text,
    status               text NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','inactive')),
    created_at           timestamptz NOT NULL DEFAULT now(),
    created_by           text
);

-- factor = how many to_uom in one from_uom (1 BAG -> 15 KG : factor 15)
CREATE TABLE uom_conversion (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    item_id      bigint REFERENCES item(id),
    from_uom_id  bigint NOT NULL REFERENCES uom(id),
    to_uom_id    bigint NOT NULL REFERENCES uom(id),
    factor       numeric(18,8) NOT NULL CHECK (factor > 0),
    created_at   timestamptz NOT NULL DEFAULT now(),
    created_by   text,
    UNIQUE NULLS NOT DISTINCT (item_id, from_uom_id, to_uom_id)
);


-- =============================================================
--  SECTION 2 — INVENTORY & LOTS
-- =============================================================

CREATE TABLE lot (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lot_number          text NOT NULL,
    item_id             bigint NOT NULL REFERENCES item(id),
    supplier_lot_number text,
    manufacture_date    date,
    expiry_date         date,
    source_type         text NOT NULL
                        CHECK (source_type IN ('purchased','produced')),
    source_doc_type     text,
    source_doc_id       bigint,
    status              text NOT NULL DEFAULT 'quarantine'
                        CHECK (status IN
                        ('quarantine','available','on_hold','consumed','rejected','expired')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    created_by          text,
    UNIQUE (item_id, lot_number)
);

-- Append-only inventory ledger. Never updated, never deleted.
CREATE TABLE inventory_transaction (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    transaction_date  timestamptz NOT NULL DEFAULT now(),
    item_id           bigint NOT NULL REFERENCES item(id),
    lot_id            bigint REFERENCES lot(id),
    location_id       bigint NOT NULL REFERENCES location(id),
    quantity          numeric(18,4) NOT NULL,          -- signed, base UOM
    transaction_type  text NOT NULL
                      CHECK (transaction_type IN
                      ('receipt','issue','transfer_in','transfer_out',
                       'production_consume','production_output',
                       'adjustment','ship')),
    unit_cost         numeric(18,4),
    reference_type    text,
    reference_id      bigint,
    notes             text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    created_by        text
);
CREATE INDEX idx_invtxn_item_lot ON inventory_transaction(item_id, lot_id);
CREATE INDEX idx_invtxn_lot      ON inventory_transaction(lot_id);
CREATE INDEX idx_invtxn_ref      ON inventory_transaction(reference_type, reference_id);

-- Derived balance cache. Ledger is the truth; this is rebuilt from it.
CREATE TABLE inventory_balance (
    item_id              bigint NOT NULL REFERENCES item(id),
    lot_id               bigint REFERENCES lot(id),
    location_id          bigint NOT NULL REFERENCES location(id),
    quantity_on_hand     numeric(18,4) NOT NULL DEFAULT 0,
    quantity_allocated   numeric(18,4) NOT NULL DEFAULT 0,
    last_updated         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (item_id, lot_id, location_id)
);


-- =============================================================
--  SECTION 3 — FORMULAS (recipes / BOM)
-- =============================================================

CREATE TABLE formula (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code            text NOT NULL UNIQUE,
    name            text NOT NULL,
    output_item_id  bigint NOT NULL REFERENCES item(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      text
);

CREATE TABLE formula_version (
    id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    formula_id           bigint NOT NULL REFERENCES formula(id),
    version_no           integer NOT NULL,
    base_output_quantity numeric(18,4) NOT NULL,
    base_output_uom_id   bigint NOT NULL REFERENCES uom(id),
    status               text NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft','active','obsolete')),
    effective_date       date,
    approved_by          text,
    created_at           timestamptz NOT NULL DEFAULT now(),
    created_by           text,
    UNIQUE (formula_id, version_no)
);

CREATE TABLE formula_line (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    formula_version_id  bigint NOT NULL REFERENCES formula_version(id),
    line_no             integer NOT NULL,
    ingredient_item_id  bigint NOT NULL REFERENCES item(id),
    quantity            numeric(18,4) NOT NULL,
    uom_id              bigint NOT NULL REFERENCES uom(id),
    scrap_percent       numeric(7,4) NOT NULL DEFAULT 0,
    notes               text,
    UNIQUE (formula_version_id, line_no)
);


-- =============================================================
--  SECTION 4 — PROCUREMENT
-- =============================================================

CREATE TABLE purchase_order (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    po_number     text NOT NULL UNIQUE,
    supplier_id   bigint NOT NULL REFERENCES supplier(id),
    order_date    date NOT NULL,
    expected_date date,
    status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN
                  ('draft','confirmed','partially_received','received','closed','cancelled')),
    currency      text NOT NULL DEFAULT 'USD',
    notes         text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    text
);

CREATE TABLE purchase_order_line (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    po_id             bigint NOT NULL REFERENCES purchase_order(id),
    line_no           integer NOT NULL,
    item_id           bigint NOT NULL REFERENCES item(id),
    quantity          numeric(18,4) NOT NULL,
    uom_id            bigint NOT NULL REFERENCES uom(id),
    unit_price        numeric(18,4) NOT NULL,
    received_quantity numeric(18,4) NOT NULL DEFAULT 0,
    UNIQUE (po_id, line_no)
);

CREATE TABLE goods_receipt (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    grn_number    text NOT NULL UNIQUE,
    po_id         bigint REFERENCES purchase_order(id),
    supplier_id   bigint NOT NULL REFERENCES supplier(id),
    receipt_date  date NOT NULL,
    warehouse_id  bigint NOT NULL REFERENCES warehouse(id),
    status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','posted','cancelled')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    text
);

CREATE TABLE goods_receipt_line (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    grn_id        bigint NOT NULL REFERENCES goods_receipt(id),
    line_no       integer NOT NULL,
    po_line_id    bigint REFERENCES purchase_order_line(id),
    item_id       bigint NOT NULL REFERENCES item(id),
    lot_id        bigint NOT NULL REFERENCES lot(id),
    quantity      numeric(18,4) NOT NULL,
    uom_id        bigint NOT NULL REFERENCES uom(id),
    location_id   bigint NOT NULL REFERENCES location(id),
    unit_cost     numeric(18,4),
    UNIQUE (grn_id, line_no)
);


-- =============================================================
--  SECTION 5 — PRODUCTION
-- =============================================================

CREATE TABLE production_order (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    mo_number           text NOT NULL UNIQUE,
    formula_version_id  bigint NOT NULL REFERENCES formula_version(id),
    output_item_id      bigint NOT NULL REFERENCES item(id),
    planned_quantity    numeric(18,4) NOT NULL,
    planned_uom_id      bigint NOT NULL REFERENCES uom(id),
    warehouse_id        bigint NOT NULL REFERENCES warehouse(id),
    planned_date        date,
    status              text NOT NULL DEFAULT 'planned'
                        CHECK (status IN
                        ('planned','released','in_progress','completed','closed','cancelled')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    created_by          text
);

-- Backward-trace link: which raw lots went into this run
CREATE TABLE production_consumption (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    production_order_id bigint NOT NULL REFERENCES production_order(id),
    item_id             bigint NOT NULL REFERENCES item(id),
    lot_id              bigint NOT NULL REFERENCES lot(id),
    location_id         bigint NOT NULL REFERENCES location(id),
    planned_quantity    numeric(18,4),
    actual_quantity     numeric(18,4) NOT NULL,
    uom_id              bigint NOT NULL REFERENCES uom(id),
    consumed_at         timestamptz NOT NULL DEFAULT now(),
    created_by          text
);

-- Forward-trace link: finished lots produced
CREATE TABLE production_output (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    production_order_id bigint NOT NULL REFERENCES production_order(id),
    item_id             bigint NOT NULL REFERENCES item(id),
    lot_id              bigint NOT NULL REFERENCES lot(id),
    quantity            numeric(18,4) NOT NULL,
    uom_id              bigint NOT NULL REFERENCES uom(id),
    location_id         bigint NOT NULL REFERENCES location(id),
    output_type         text NOT NULL DEFAULT 'primary'
                        CHECK (output_type IN ('primary','by_product')),
    output_date         date NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    created_by          text
);


-- =============================================================
--  SECTION 6 — SALES & SHIPPING
-- =============================================================

CREATE TABLE sales_order (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    so_number       text NOT NULL UNIQUE,
    customer_id     bigint NOT NULL REFERENCES customer(id),
    order_date      date NOT NULL,
    requested_date  date,
    status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN
                    ('draft','confirmed','partially_shipped','shipped','closed','cancelled')),
    currency        text NOT NULL DEFAULT 'USD',
    notes           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      text
);

CREATE TABLE sales_order_line (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    so_id             bigint NOT NULL REFERENCES sales_order(id),
    line_no           integer NOT NULL,
    item_id           bigint NOT NULL REFERENCES item(id),
    quantity          numeric(18,4) NOT NULL,
    uom_id            bigint NOT NULL REFERENCES uom(id),
    unit_price        numeric(18,4) NOT NULL,
    shipped_quantity  numeric(18,4) NOT NULL DEFAULT 0,
    UNIQUE (so_id, line_no)
);

CREATE TABLE shipment (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    shipment_number text NOT NULL UNIQUE,
    so_id           bigint REFERENCES sales_order(id),
    customer_id     bigint NOT NULL REFERENCES customer(id),
    ship_date       date NOT NULL,
    warehouse_id    bigint NOT NULL REFERENCES warehouse(id),
    status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','posted','cancelled')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      text
);

-- Records the exact lot shipped — final forward-trace link
CREATE TABLE shipment_line (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    shipment_id   bigint NOT NULL REFERENCES shipment(id),
    line_no       integer NOT NULL,
    so_line_id    bigint REFERENCES sales_order_line(id),
    item_id       bigint NOT NULL REFERENCES item(id),
    lot_id        bigint NOT NULL REFERENCES lot(id),
    quantity      numeric(18,4) NOT NULL,
    uom_id        bigint NOT NULL REFERENCES uom(id),
    location_id   bigint NOT NULL REFERENCES location(id),
    UNIQUE (shipment_id, line_no)
);


-- =============================================================
--  SECTION 7 — QUALITY
-- =============================================================

CREATE TABLE coa (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    coa_number   text NOT NULL UNIQUE,
    lot_id       bigint NOT NULL REFERENCES lot(id),
    test_date    date NOT NULL,
    result       text NOT NULL
                 CHECK (result IN ('pass','fail','conditional','pending')),
    tested_by    text,
    document_ref text,
    notes        text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    created_by   text
);


-- =============================================================
--  SECTION 8 — FINANCE  (financial-core.md version)
--  More complete than schema.sql placeholder:
--  + accounting_period, period_status_history
--  + department / cost_center dimensions (EP-2)
--  + account_segment (EP-1)
--  + journal_entry linked to period, with journal_type & reversal
--  + journal_entry_line with BR-F2 (debit XOR credit) enforced
--  + payment / payment_application tables
-- =============================================================

-- EP-2: department & cost-center dimensions (nullable on lines)
CREATE TABLE department (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code        text NOT NULL UNIQUE,
    name        text NOT NULL,
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  uuid
);

CREATE TABLE cost_center (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code        text NOT NULL UNIQUE,
    name        text NOT NULL,
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  uuid
);

-- Chart of accounts with parent hierarchy and postable flag
CREATE TABLE gl_account (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_code  text NOT NULL UNIQUE,
    name          text NOT NULL,
    account_type  text NOT NULL
                  CHECK (account_type IN
                  ('asset','liability','equity','revenue','expense')),
    parent_id     bigint REFERENCES gl_account(id),
    is_postable   boolean NOT NULL DEFAULT true,
    is_active     boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    uuid
);

-- EP-1: optional segment descriptor (empty if client uses plain codes)
CREATE TABLE account_segment (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    segment_no  integer NOT NULL,
    name        text NOT NULL,
    length      integer,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Accounting periods (monthly, grouped by fiscal year)
CREATE TABLE accounting_period (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name         text NOT NULL UNIQUE,           -- 'OCT 2023'
    start_date   date NOT NULL,
    end_date     date NOT NULL,
    fiscal_year  integer NOT NULL,
    status       text NOT NULL DEFAULT 'future'
                 CHECK (status IN ('future','open','soft_closed','closed')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    created_by   uuid,
    CHECK (end_date >= start_date)
);

-- Full audit trail of every period status change
CREATE TABLE period_status_history (
    id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    accounting_period_id bigint NOT NULL REFERENCES accounting_period(id),
    from_status          text,
    to_status            text NOT NULL,
    reason               text,
    changed_at           timestamptz NOT NULL DEFAULT now(),
    changed_by           uuid
);

-- Journal entries — linked to an accounting period
CREATE TABLE journal_entry (
    id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entry_number         text NOT NULL UNIQUE,
    entry_date           date NOT NULL,
    accounting_period_id bigint NOT NULL REFERENCES accounting_period(id),
    description          text,
    journal_type         text NOT NULL DEFAULT 'general',
    source_type          text NOT NULL DEFAULT 'manual'
                         CHECK (source_type IN
                         ('manual','goods_receipt','production','shipment','adjustment')),
    source_id            bigint,
    status               text NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft','posted','reversed')),
    reversed_by_entry_id bigint REFERENCES journal_entry(id),
    posted_at            timestamptz,
    posted_by            uuid,
    created_at           timestamptz NOT NULL DEFAULT now(),
    created_by           uuid
);

-- Journal lines: debit XOR credit enforced by CHECK (BR-F2)
CREATE TABLE journal_entry_line (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    journal_entry_id bigint NOT NULL REFERENCES journal_entry(id),
    line_no          integer NOT NULL,
    gl_account_id    bigint NOT NULL REFERENCES gl_account(id),
    description      text,
    debit            numeric(18,4) NOT NULL DEFAULT 0,
    credit           numeric(18,4) NOT NULL DEFAULT 0,
    department_id    bigint REFERENCES department(id),
    cost_center_id   bigint REFERENCES cost_center(id),
    UNIQUE (journal_entry_id, line_no),
    CHECK (debit >= 0 AND credit >= 0),
    CHECK (NOT (debit > 0 AND credit > 0)),   -- BR-F2: debit XOR credit
    CHECK (debit > 0 OR credit > 0)           -- BR-F2: not both zero
);
CREATE INDEX idx_jel_entry   ON journal_entry_line(journal_entry_id);
CREATE INDEX idx_jel_account ON journal_entry_line(gl_account_id);

-- AP invoices
CREATE TABLE ap_invoice (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_number text NOT NULL,
    supplier_id    bigint NOT NULL REFERENCES supplier(id),
    invoice_date   date NOT NULL,
    due_date       date,
    amount         numeric(18,4) NOT NULL,
    amount_paid    numeric(18,4) NOT NULL DEFAULT 0,
    status         text NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','partially_paid','paid','cancelled')),
    created_at     timestamptz NOT NULL DEFAULT now(),
    created_by     uuid,
    UNIQUE (supplier_id, invoice_number)
);

-- AR invoices
CREATE TABLE ar_invoice (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_number  text NOT NULL UNIQUE,
    customer_id     bigint NOT NULL REFERENCES customer(id),
    invoice_date    date NOT NULL,
    due_date        date,
    amount          numeric(18,4) NOT NULL,
    amount_received numeric(18,4) NOT NULL DEFAULT 0,
    status          text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','partially_paid','paid','cancelled')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid
);

-- Payment record (outgoing to supplier, incoming from customer)
CREATE TABLE payment (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    payment_number text NOT NULL UNIQUE,
    direction      text NOT NULL CHECK (direction IN ('outgoing','incoming')),
    party_type     text NOT NULL CHECK (party_type IN ('supplier','customer')),
    party_id       bigint NOT NULL,
    payment_date   date NOT NULL,
    amount         numeric(18,4) NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    created_by     uuid
);

-- Applies part/all of a payment to one invoice (supports partial & multi-invoice)
CREATE TABLE payment_application (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    payment_id     bigint NOT NULL REFERENCES payment(id),
    invoice_type   text NOT NULL CHECK (invoice_type IN ('ap','ar')),
    invoice_id     bigint NOT NULL,
    amount_applied numeric(18,4) NOT NULL CHECK (amount_applied > 0),
    created_at     timestamptz NOT NULL DEFAULT now()
);

-- =============================================================
--  END OF SCHEMA
--
--  Traceability is a query, not a table:
--  Backward: lot -> production_output -> production_order
--            -> production_consumption -> raw lots  (recurse)
--  Forward:  lot -> production_consumption -> production_order
--            -> production_output -> finished lots
--            -> shipment_line -> shipment -> customer  (recurse)
--  Use PostgreSQL WITH RECURSIVE for both directions.
-- =============================================================

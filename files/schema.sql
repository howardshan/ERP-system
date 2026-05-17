-- =============================================================
--  Pet Food ERP — Database Schema (PostgreSQL)
-- =============================================================
--  This file is the data model expressed as runnable DDL.
--  Conventions:
--    * snake_case, singular table names
--    * surrogate primary key `id` (bigint identity) on every table
--    * human-readable business keys (sku, po_number, ...) are separate
--    * quantities: numeric(18,4)   money: numeric(18,4)
--    * timestamps: timestamptz
--    * status fields constrained with CHECK (easy to evolve early on)
--    * every table carries created_at / created_by audit columns
--    * nothing is hard-deleted — use status fields
-- =============================================================


-- =============================================================
--  SECTION 1 — REFERENCE & MASTER DATA
-- =============================================================

-- Units of measure (kg, lb, bag, pallet, each ...)
CREATE TABLE uom (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code        text NOT NULL UNIQUE,                 -- 'KG', 'LB', 'BAG'
    name        text NOT NULL,
    uom_type    text NOT NULL
                CHECK (uom_type IN ('weight','volume','count')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  text
);

-- Item categories (optional hierarchy)
CREATE TABLE item_category (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code        text NOT NULL UNIQUE,
    name        text NOT NULL,
    parent_id   bigint REFERENCES item_category(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  text
);

-- Physical sites
CREATE TABLE warehouse (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code        text NOT NULL UNIQUE,
    name        text NOT NULL,
    address     text,
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  text
);

-- Locations / bins inside a warehouse
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

-- Suppliers (vendors)
CREATE TABLE supplier (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code           text NOT NULL UNIQUE,
    name           text NOT NULL,
    contact_name   text,
    email          text,
    phone          text,
    address        text,
    payment_terms  text,                              -- e.g. 'NET30'
    is_active      boolean NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now(),
    created_by     text
);

-- Customers
CREATE TABLE customer (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code           text NOT NULL UNIQUE,
    name           text NOT NULL,
    contact_name   text,
    email          text,
    phone          text,
    billing_address  text,
    shipping_address text,
    payment_terms  text,
    credit_limit   numeric(18,4),
    is_active      boolean NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now(),
    created_by     text
);

-- Items: raw materials, packaging, intermediates, finished goods
CREATE TABLE item (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sku                 text NOT NULL UNIQUE,
    name                text NOT NULL,
    description         text,
    item_type           text NOT NULL
                        CHECK (item_type IN
                        ('raw_material','packaging','intermediate','finished_good')),
    category_id         bigint REFERENCES item_category(id),
    base_uom_id         bigint NOT NULL REFERENCES uom(id),
    is_lot_controlled   boolean NOT NULL DEFAULT true,
    shelf_life_days     integer,                       -- null = no expiry
    default_warehouse_id bigint REFERENCES warehouse(id),
    costing_method      text NOT NULL DEFAULT 'weighted_average'
                        CHECK (costing_method IN
                        ('standard','weighted_average','fifo')),
    standard_cost       numeric(18,4),
    allergen_info       text,
    status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','inactive')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    created_by          text
);

-- UOM conversion rules. item_id NULL = a universal rule.
--   factor = how many to_uom in one from_uom  (1 BAG -> 15 KG : factor 15)
CREATE TABLE uom_conversion (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    item_id      bigint REFERENCES item(id),           -- NULL = global
    from_uom_id  bigint NOT NULL REFERENCES uom(id),
    to_uom_id    bigint NOT NULL REFERENCES uom(id),
    factor       numeric(18,8) NOT NULL CHECK (factor > 0),
    created_at   timestamptz NOT NULL DEFAULT now(),
    created_by   text,
    UNIQUE (item_id, from_uom_id, to_uom_id)
);


-- =============================================================
--  SECTION 2 — INVENTORY & LOTS
-- =============================================================

-- A lot / batch of a specific item
CREATE TABLE lot (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lot_number          text NOT NULL,
    item_id             bigint NOT NULL REFERENCES item(id),
    supplier_lot_number text,                          -- supplier's own number
    manufacture_date    date,
    expiry_date         date,
    source_type         text NOT NULL
                        CHECK (source_type IN ('purchased','produced')),
    source_doc_type     text,                          -- 'goods_receipt' | 'production_order'
    source_doc_id       bigint,                        -- soft link, see note below
    status              text NOT NULL DEFAULT 'quarantine'
                        CHECK (status IN
                        ('quarantine','available','on_hold','consumed','rejected','expired')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    created_by          text,
    UNIQUE (item_id, lot_number)
);

-- The inventory LEDGER. Append-only. Never updated, never deleted.
-- quantity is SIGNED and always stored in the item's base UOM:
--   positive = stock entering this location
--   negative = stock leaving  this location
-- reference_type/reference_id are a SOFT link to the document that
-- caused the movement (no FK, because it can point at several tables).
CREATE TABLE inventory_transaction (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    transaction_date  timestamptz NOT NULL DEFAULT now(),
    item_id           bigint NOT NULL REFERENCES item(id),
    lot_id            bigint REFERENCES lot(id),       -- required if item is lot-controlled
    location_id       bigint NOT NULL REFERENCES location(id),
    quantity          numeric(18,4) NOT NULL,          -- signed, base UOM
    transaction_type  text NOT NULL
                      CHECK (transaction_type IN
                      ('receipt','issue','transfer_in','transfer_out',
                       'production_consume','production_output',
                       'adjustment','ship')),
    unit_cost         numeric(18,4),                   -- cost per base UOM
    reference_type    text,                            -- 'goods_receipt','production_order',...
    reference_id      bigint,
    notes             text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    created_by        text
);
CREATE INDEX idx_invtxn_item_lot ON inventory_transaction(item_id, lot_id);
CREATE INDEX idx_invtxn_lot      ON inventory_transaction(lot_id);
CREATE INDEX idx_invtxn_ref      ON inventory_transaction(reference_type, reference_id);

-- Derived current balance. Maintained from inventory_transaction by
-- application logic or a DB trigger. NOT a source of truth.
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
    base_output_quantity numeric(18,4) NOT NULL,       -- recipe yields this much...
    base_output_uom_id   bigint NOT NULL REFERENCES uom(id),  -- ...in this UOM
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
    quantity            numeric(18,4) NOT NULL,        -- needed per base_output_quantity
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
    lot_id        bigint NOT NULL REFERENCES lot(id),   -- lot created at receipt
    quantity      numeric(18,4) NOT NULL,
    uom_id        bigint NOT NULL REFERENCES uom(id),
    location_id   bigint NOT NULL REFERENCES location(id),
    unit_cost     numeric(18,4),
    UNIQUE (grn_id, line_no)
);


-- =============================================================
--  SECTION 5 — PRODUCTION (process / batch manufacturing)
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

-- Raw-material lots consumed by a production order (the backward-trace link)
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

-- Finished goods / by-products produced (the forward-trace link)
CREATE TABLE production_output (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    production_order_id bigint NOT NULL REFERENCES production_order(id),
    item_id             bigint NOT NULL REFERENCES item(id),
    lot_id              bigint NOT NULL REFERENCES lot(id),    -- new lot created here
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
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    shipment_number text NOT NULL UNIQUE,
    so_id         bigint REFERENCES sales_order(id),
    customer_id   bigint NOT NULL REFERENCES customer(id),
    ship_date     date NOT NULL,
    warehouse_id  bigint NOT NULL REFERENCES warehouse(id),
    status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','posted','cancelled')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    text
);

-- shipment_line records WHICH LOT went to the customer — the
-- final link in forward traceability.
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
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    coa_number  text NOT NULL UNIQUE,
    lot_id      bigint NOT NULL REFERENCES lot(id),
    test_date   date NOT NULL,
    result      text NOT NULL
                CHECK (result IN ('pass','fail','conditional','pending')),
    tested_by   text,
    document_ref text,                                 -- link/path to the COA file
    notes       text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  text
);


-- =============================================================
--  SECTION 8 — FINANCE  (Phase 2)
-- =============================================================
--  Built after the operations core. Operational documents
--  (goods receipt, production output, shipment) generate the
--  journal entries below.

CREATE TABLE gl_account (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_code  text NOT NULL UNIQUE,
    name          text NOT NULL,
    account_type  text NOT NULL
                  CHECK (account_type IN
                  ('asset','liability','equity','revenue','expense')),
    is_active     boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    text
);

CREATE TABLE journal_entry (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entry_number  text NOT NULL UNIQUE,
    entry_date    date NOT NULL,
    description   text,
    source_type   text,                                -- 'goods_receipt','shipment',...
    source_id     bigint,
    status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','posted','reversed')),
    posted_at     timestamptz,
    posted_by     text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    text
);

-- Debits and credits of an entry. Sum of debit must equal sum of credit.
CREATE TABLE journal_entry_line (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    journal_entry_id  bigint NOT NULL REFERENCES journal_entry(id),
    line_no           integer NOT NULL,
    gl_account_id     bigint NOT NULL REFERENCES gl_account(id),
    debit             numeric(18,4) NOT NULL DEFAULT 0,
    credit            numeric(18,4) NOT NULL DEFAULT 0,
    description       text,
    UNIQUE (journal_entry_id, line_no),
    CHECK (debit >= 0 AND credit >= 0),
    CHECK (NOT (debit > 0 AND credit > 0))             -- a line is debit OR credit
);

CREATE TABLE ap_invoice (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_number text NOT NULL,
    supplier_id   bigint NOT NULL REFERENCES supplier(id),
    po_id         bigint REFERENCES purchase_order(id),
    invoice_date  date NOT NULL,
    due_date      date,
    amount        numeric(18,4) NOT NULL,
    status        text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','partially_paid','paid','cancelled')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    text,
    UNIQUE (supplier_id, invoice_number)
);

CREATE TABLE ar_invoice (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_number text NOT NULL UNIQUE,
    customer_id   bigint NOT NULL REFERENCES customer(id),
    so_id         bigint REFERENCES sales_order(id),
    shipment_id   bigint REFERENCES shipment(id),
    invoice_date  date NOT NULL,
    due_date      date,
    amount        numeric(18,4) NOT NULL,
    status        text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','partially_paid','paid','cancelled')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    text
);

-- =============================================================
--  END OF SCHEMA
-- =============================================================
--  Traceability is not a table — it is a query.
--  Backward trace (finished lot -> raw lots):
--    finished lot -> production_output -> production_order
--    -> production_consumption -> raw lots  (repeat upward).
--  Forward trace (raw lot -> customers):
--    raw lot -> production_consumption -> production_order
--    -> production_output -> finished lots -> shipment_line
--    -> shipment -> customer  (repeat downward).
--  Because production can be multi-level, write this as a
--  recursive query (PostgreSQL WITH RECURSIVE). See business-rules.md.
-- =============================================================

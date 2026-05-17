# Data Model — Entity Reference

This document explains every entity in plain language: what it represents,
its key fields, how it relates to others, and — most importantly — *why* it
is designed this way. `schema.sql` is the same model as runnable SQL; read
the two together.

The model has eight modules: Reference & Master Data, Inventory & Lots,
Formulas, Procurement, Production, Sales & Shipping, Quality, and Finance.

---

## Module 1 — Reference & Master Data

These tables describe the "nouns" of the business. They change slowly and
everything else points at them.

**`uom`** — A unit of measure. `uom_type` (weight / volume / count) prevents
nonsense conversions (you cannot convert kilograms to "each").

**`uom_conversion`** — A rule to convert one UOM into another. `factor` is
how many `to_uom` are in one `from_uom`. A conversion can be **global**
(`item_id` is null — e.g. 1 kg = 1000 g) or **item-specific** (`item_id`
set — e.g. one bag of *this* product = 15 kg). Getting unit conversion wrong
is one of the most common ways an inventory system silently produces wrong
numbers, so it gets its own table rather than being hard-coded.

**`item_category`** — Optional grouping of items, with a self-reference for
a hierarchy.

**`item`** — Anything bought, made, stored, or sold. The important fields:
`item_type` (raw_material / packaging / intermediate / finished_good)
controls behavior; `base_uom_id` is the one UOM all of this item's inventory
is calculated in; `is_lot_controlled` decides whether movements of this item
must carry a lot; `shelf_life_days` drives expiry-date calculation;
`costing_method` decides how its cost is valued.

**`warehouse`** / **`location`** — A warehouse is a site; a location is a
specific bin/zone inside it. Inventory always lives in a *location*, never
just a warehouse. Note the location types: `quarantine` (for stock awaiting
QC) and `production` (the shop floor) are not optional niceties — they are
how the system models real food-safety workflow.

**`supplier`** / **`customer`** — Trading partners. They are kept as two
separate tables for clarity. (Some ERPs merge them into one
`business_partner` table; that is a valid alternative but adds complexity
not worth it here.)

---

## Module 2 — Inventory & Lots

This is the heart of the system. Read the principle below before the tables.

> **Principle: inventory is an append-only ledger.** Stock levels are never
> edited. Every movement is a new permanent row. The quantity of something
> is the *sum* of its movement rows. This is the same idea as a bank
> statement, and it is exactly why a CPA's instinct applies here:
> `inventory_transaction` is a subledger.

**`lot`** — One batch of one item. `lot_number` is what is printed on the
physical product; it is unique *per item*. `expiry_date` drives FEFO and
quarantine. `source_type` records whether the lot was purchased or produced,
and `source_doc_type` / `source_doc_id` point back to the goods receipt or
production order that created it. `status` moves a lot through its life:
`quarantine` → `available` → `consumed`, with `on_hold`, `rejected`, and
`expired` as off-ramps.

**`inventory_transaction`** — The ledger itself. Every row is one movement
of one item/lot into or out of one location. `quantity` is **signed**:
positive means stock arrived, negative means stock left. It is always stored
in the item's **base UOM**, so the math never depends on which UOM a user
happened to type. The table is **append-only**: no `UPDATE`, no `DELETE`,
ever. A mistake is corrected by posting a new `adjustment` transaction, not
by editing history. `reference_type` + `reference_id` are a *soft* link
(deliberately not a foreign key) back to the document that caused the
movement, because that document could be a goods receipt, a shipment, a
production order, etc.

**`inventory_balance`** — A convenience table holding the *current*
on-hand and allocated quantity per item/lot/location, so the system does not
re-sum the whole ledger on every screen. It is **derived** — kept in sync
from `inventory_transaction` by application code or a database trigger. If
it ever disagrees with the ledger, the ledger wins and the balance is
rebuilt. `quantity_allocated` is the part of on-hand already promised to an
order; *available* = on_hand − allocated.

---

## Module 3 — Formulas

**`formula`** — The recipe for one product (`output_item_id`). A thin header.

**`formula_version`** — A formula changes over time; each change is a new
version. `base_output_quantity` + `base_output_uom_id` say how much the
recipe yields (e.g. "this recipe makes 1,000 kg"). `status` (draft / active
/ obsolete) controls which version may be used in production. **Production
always references a specific version**, never the formula directly — so for
any past lot we know the exact recipe used.

**`formula_line`** — One ingredient of one formula version: an item and the
quantity needed *per base output quantity*. `scrap_percent` accounts for
expected loss. To make a different batch size, all line quantities are
scaled proportionally — see business rule BR-7.

---

## Module 4 — Procurement

**`purchase_order`** + **`purchase_order_line`** — The instruction to a
supplier to deliver items. Each line tracks `received_quantity` so the order
can move through `partially_received` to `received`.

**`goods_receipt`** + **`goods_receipt_line`** — The record that goods
physically arrived. **This is where inbound lots are born.** Each receipt
line creates a `lot` row, places it in a `location`, and generates a
`receipt` inventory transaction. Received stock typically lands in a
`quarantine` location/status until QC clears it.

---

## Module 5 — Production

This module is where the traceability chain is forged.

**`production_order`** — Authorization to manufacture a quantity of a
product using a specific `formula_version`. Moves through planned → released
→ in_progress → completed.

**`production_consumption`** — One row per raw-material lot actually used by
a production order. **This table is the backward-trace link**: it records,
permanently, exactly which input lots went into this run. `planned_quantity`
vs `actual_quantity` is what makes yield variance visible. Each row generates
a `production_consume` inventory transaction (negative quantity).

**`production_output`** — The finished goods (and any by-products) the run
produced. **A new `lot` is created here** for the finished product. This is
the forward-trace link's starting point. Each row generates a
`production_output` inventory transaction (positive quantity).

Together, `production_consumption` and `production_output` connected through
`production_order` form the genealogy: input lots ↔ output lot.

---

## Module 6 — Sales & Shipping

**`sales_order`** + **`sales_order_line`** — A customer's order. Lines track
`shipped_quantity`.

**`shipment`** + **`shipment_line`** — Goods physically leaving. Each
shipment line records the **specific lot** sent to the customer, which is the
final link in forward traceability — it connects a lot to a customer. The
lot is normally chosen by FEFO (business rule BR-9). Each line generates a
`ship` inventory transaction (negative quantity).

---

## Module 7 — Quality

**`coa`** — A Certificate of Analysis for a lot: the test result that lets a
lot move from `quarantine` to `available`. `document_ref` points to the
stored COA file. (A deeper version with individual test parameters and
specification limits is Phase 3.)

---

## Module 8 — Finance (Phase 2)

**`gl_account`** — One line of the chart of accounts.

**`journal_entry`** + **`journal_entry_line`** — A balanced set of debits
and credits. The sum of debits must equal the sum of credits (business rule
BR-12). `source_type` / `source_id` link an entry back to the operational
event that produced it — a goods receipt, a production output, a shipment.
This is how operations and accounting stay reconciled.

**`ap_invoice`** / **`ar_invoice`** — Money owed to suppliers / by customers.

> Finance is intentionally Phase 2. Its numbers — inventory value, cost of
> goods sold — are *computed from* the inventory transactions Phase 1
> creates. Build the operations core first so finance has correct data to
> stand on.

---

## A note on traceability

There is no `traceability` table, and there should not be. Traceability is a
**query** over data the system already records:
`lot` ↔ `production_consumption` ↔ `production_order` ↔ `production_output`
↔ `shipment_line`. Because a finished good can itself be an ingredient in
another product (multi-level manufacturing), the query is recursive. See
`business-rules.md`, rule BR-10, for the definition.

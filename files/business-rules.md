# Business Rules

The data model says what data *looks like*. These rules say how data is
allowed to *change*. They are numbered (BR-1, BR-2, ...) so code, tests, and
conversations can refer to them precisely.

---

## Inventory ledger

**BR-1 — The inventory ledger is append-only.**
Rows in `inventory_transaction` are never updated and never deleted. A
mistake is corrected by posting a compensating `adjustment` transaction.

**BR-2 — Every transaction is signed and in base UOM.**
`quantity` is positive for stock entering a location, negative for stock
leaving. It is always stored in the item's `base_uom_id`. Any quantity a
user enters in another UOM is converted to base UOM before the transaction
is written.

**BR-3 — Lot-controlled items always carry a lot.**
If `item.is_lot_controlled` is true, every `inventory_transaction` for that
item must have a `lot_id`. The application enforces this.

**BR-4 — The balance is derived, the ledger is the truth.**
`inventory_balance` is recomputed from `inventory_transaction`. If they
disagree, the ledger is correct and the balance is rebuilt.

**BR-5 — Stock cannot go negative.**
An issue, shipment, or consumption may not drive an item/lot/location
balance below zero. The transaction is rejected before it is written.
(A controlled exception for `adjustment` may be allowed with a reason.)

---

## Lots and expiry

**BR-6 — Expiry date is set when a lot is created.**
If the item has `shelf_life_days`, then on lot creation:
`expiry_date = manufacture_date + shelf_life_days`.
A lot may also receive its expiry from the supplier (purchased lots) — the
supplier's date takes precedence if provided.

**BR-6a — Lot status lifecycle.**
A new lot starts in `quarantine`. It becomes `available` only when released
(typically after a passing COA — BR-11). It becomes `consumed` when its
balance reaches zero, `expired` past its expiry date, `rejected` if it fails
QC, or `on_hold` if manually held. Only `available` lots may be consumed in
production or shipped.

---

## Formulas and production

**BR-7 — Formula quantities scale proportionally.**
A `formula_version` yields `base_output_quantity`. To produce a different
quantity Q, every `formula_line` quantity is scaled by
`Q / base_output_quantity`. Scrap is then applied:
`required = scaled_quantity * (1 + scrap_percent)`.
All scaling math is done in base UOM after UOM conversion.

**BR-8 — Production consumes available lots and produces a new lot.**
When a production order completes: each raw-material lot used is recorded in
`production_consumption` and generates a negative `production_consume`
transaction; the finished output creates a **new** `lot` and generates a
positive `production_output` transaction. Only `available` lots may be
consumed (BR-6a).

**BR-8a — Yield variance is recorded, not hidden.**
The difference between formula-predicted output and actual
`production_output` quantity is computed and stored for cost and quality
review. A large variance does not block completion but should be flagged.

---

## Sales and shipping

**BR-9 — Shipments pick lots by FEFO.**
When fulfilling a shipment, the default lot selection is *First Expired,
First Out*: among `available` lots of the item with sufficient quantity,
choose the earliest `expiry_date` first. A user may override the suggestion,
but the override is recorded. Expired lots are never auto-selected.

**BR-9a — A shipment records the exact lot sent.**
Every `shipment_line` carries the `lot_id` actually shipped. This is the
link that ties a lot to a customer and makes forward traceability and recall
possible. It is mandatory.

---

## Traceability

**BR-10 — Traceability is a recursive query, not a stored table.**

*Backward trace* (given a finished lot, find all raw-material lots in it):
1. From the lot, find its `production_output` row → its `production_order`.
2. From that production order, find all `production_consumption` rows → the
   consumed lots.
3. For each consumed lot that was itself produced, repeat from step 1.

*Forward trace* (given a raw-material lot, find every customer reached):
1. Find all `production_consumption` rows for the lot → their
   `production_order`s.
2. For each, find `production_output` rows → the finished lots produced.
3. For each finished lot, find `shipment_line` rows → `shipment` →
   `customer`.
4. For each finished lot also used as an ingredient, repeat from step 1.

Implement both with `WITH RECURSIVE` in PostgreSQL. The system must be able
to return a complete trace in seconds — this is the recall capability and a
regulatory requirement.

**BR-10a — A recall is a forward trace plus actions.**
A recall takes the forward-trace result (affected lots, locations,
customers) and records the disposition of each: hold, return, destroy.

---

## Quality

**BR-11 — A lot is released only after quality clearance.**
A lot leaves `quarantine` for `available` when it has a `coa` with
`result = 'pass'` (or `conditional` with explicit sign-off). A `fail` COA
moves the lot to `rejected`.

---

## Finance (Phase 2)

**BR-12 — Every journal entry must balance.**
For any `journal_entry`, the sum of `journal_entry_line.debit` must equal
the sum of `journal_entry_line.credit`. An entry that does not balance
cannot be posted.

**BR-13 — Posting is one-way.**
A `journal_entry` with status `posted` is never edited or deleted. It is
corrected by posting a reversing entry. Same principle as the inventory
ledger (BR-1).

**BR-14 — Operational events drive accounting.**
Goods receipt, production output, and shipment each generate a draft
`journal_entry` linked back via `source_type` / `source_id`. This keeps the
subledgers (inventory) and the general ledger reconciled.

**BR-15 — Inventory cost follows the item's costing method.**
`unit_cost` on each inventory transaction is determined by
`item.costing_method` (standard, weighted average, or FIFO). Cost of goods
sold and inventory value are computed from these transaction costs.

---

## General

**BR-16 — Nothing is hard-deleted.**
Master data and documents are cancelled or deactivated via a status field.
Physical deletion is not permitted anywhere in the system.

**BR-17 — Every record is attributable.**
Every table records `created_at` and `created_by`. Documents that are posted
also record who posted them and when. An ERP must always be able to answer
"who did this, and when".

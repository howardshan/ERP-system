# Glossary — Domain Vocabulary

A shared, precise vocabulary. Most confusion on an ERP project comes from
two people using the same word to mean different things. Before building
anything, the team agrees on every definition below.

---

### Item
Anything the business buys, makes, stores, or sells. Includes raw materials
(chicken meal, rice, vitamins), packaging (bags, labels), intermediates
(a mixed base not yet finished), and finished goods (a sellable bag of dog
food). Every item has a type that controls how it behaves.

### SKU
The unique code that identifies an item. One item = one SKU.

### Lot (also: Batch)
A specific quantity of an item produced or received together, sharing the
same characteristics and the same expiry date. "Lot" and "batch" mean the
same thing in this project — we use **lot** everywhere. A 1,000 kg delivery
of rice received on one day is one lot. A production run of dog food is one
lot.

### Lot number
The human-readable identifier printed on the physical product and used to
trace it. Distinct from the lot's internal database ID.

### Unit of Measure (UOM)
How a quantity is counted: kilogram, pound, bag, pallet, each. Items are
weighed, counted, and stored in UOMs.

### Base UOM
The single UOM an item's inventory is *stored and calculated* in. All other
UOMs convert to it. Choose the smallest practical unit (e.g. kilogram) as
the base.

### UOM conversion
A rule for converting one UOM to another. Some are universal (1 kg = 1000 g).
Some are item-specific (1 bag of *this* product = 15 kg) and must be stored
per item.

### Catch weight
When a unit's exact weight varies (e.g. a "case" that is nominally 20 kg but
actually 19.6–20.4 kg). Relevant if the business sells or buys by variable
weight; flagged here so it is not forgotten during design.

### Formula
The recipe for making a product: which ingredients, and how much of each, to
produce a given output quantity. In other ERPs this is called a Bill of
Materials (BOM). We use **formula**.

### Formula version
A formula changes over time (ingredient swaps, ratio tweaks). Each change is
a new version. Production always references a specific version, so we always
know exactly what recipe a past lot was made with.

### Formula line (Ingredient)
One row of a formula: one ingredient item and the quantity of it needed.

### Warehouse
A physical site where inventory is held.

### Location (also: Bin)
A specific place inside a warehouse — a rack, a zone, a receiving dock, a
quarantine area. Inventory always sits in a location, not just a warehouse.

### Inventory transaction
A single, permanent record of stock movement: a quantity of an item/lot
moving into or out of a location. The complete history of these is the
inventory ledger.

### Inventory balance
The current quantity of an item/lot/location, derived by summing all its
inventory transactions. A convenience record, not a source of truth.

### On-hand vs. allocated
**On-hand** is the physical quantity present. **Allocated** is the part of
on-hand already promised to an order but not yet shipped. *Available* =
on-hand − allocated.

### Purchase Order (PO)
A document instructing a supplier to deliver specified items.

### Goods Receipt (GRN)
A document recording that ordered goods physically arrived. Receiving
creates the inbound lots and inventory transactions.

### Production Order (also: MO, Manufacturing Order)
A document authorizing the manufacture of a quantity of a product using a
specific formula version.

### Consumption (Issue)
Raw-material lots being used up by a production order.

### Output (Yield)
The finished goods (and any by-products) a production order produces.

### Yield variance
The difference between the quantity a formula *predicts* and the quantity
actually produced. Tracking it is essential for cost accuracy.

### Sales Order (SO)
A document recording a customer's order for goods.

### Shipment
A document recording goods physically leaving to a customer. Shipping
consumes finished-good lots.

### FEFO — First Expired, First Out
The rule for choosing which lot to ship: the lot with the earliest expiry
date goes first. The default picking rule for perishable food.

### FIFO — First In, First Out
Choosing the oldest-received lot first. An alternative to FEFO.

### Shelf life / Expiry date
How long an item stays usable. Expiry date = manufacture/receipt date +
shelf-life period. Drives FEFO and quarantine of expired stock.

### Quarantine / Hold
A lot status meaning the stock physically exists but may not be used or
shipped yet (e.g. awaiting a quality test).

### COA — Certificate of Analysis
A quality document confirming a lot meets specification (nutritional,
microbiological, contaminant limits).

### Allergen
An ingredient that must be declared and segregated for safety and labeling.

### Traceability
The ability to follow a lot through the chain.
*Backward trace:* given a finished lot, find every raw-material lot in it.
*Forward trace:* given a raw-material lot, find every finished lot and
customer it reached.

### Recall
Removing an unsafe product from the market. A recall is a forward trace plus
the actions taken on what it finds.

### GL account (Chart of accounts)
A category in the general ledger (e.g. "Inventory — Raw Materials",
"Sales Revenue"). The chart of accounts is the full list.

### Journal entry
A balanced set of debits and credits posted to the general ledger. Operational
events (receipts, production, shipments) generate journal entries.

### AP / AR — Accounts Payable / Accounts Receivable
**AP:** money owed to suppliers. **AR:** money owed by customers.

### Costing method
How an item's unit cost is determined — standard cost, weighted average, or
FIFO. Determines inventory value and cost of goods sold.

### Standard cost
A pre-set expected unit cost, compared against actual cost to surface
variances.

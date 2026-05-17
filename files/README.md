# Pet Food ERP — Project Documentation

> Custom ERP system for a pet (dog) food manufacturer.
> Greenfield build. Standalone system — not integrated with Sage 100.

---

## 1. Purpose

This system manages the day-to-day operations of a pet food manufacturing
company: purchasing raw materials, storing and tracking inventory by lot,
manufacturing finished goods from formulas, shipping to customers, and the
financial records behind those activities.

The single defining requirement of this business is **lot/batch
traceability**. For any finished-good lot the system must identify every
raw-material lot that went into it (backward trace). For any raw-material
lot it must identify every finished-good lot — and every customer — that it
reached (forward trace). This is mandatory under US FSMA food-safety
regulation and is the backbone of recall management. Every design decision
in this system bends toward making that trace fast and reliable.

---

## 2. Document set

| File | What it contains |
|------|------------------|
| `README.md` | This file — purpose, scope, phasing, how to use the docs |
| `glossary.md` | Precise definition of every domain term used in the project |
| `data-model.md` | Every entity explained in prose: fields, relationships, *why* |
| `schema.sql` | The data model as runnable PostgreSQL `CREATE TABLE` statements |
| `er-diagram.mermaid` | Entity-relationship diagram (renders as a picture) |
| `business-rules.md` | The rules that govern how data is allowed to change |
| `architecture.md` | Technology stack, environments, testing approach, risks |

These files are the **single source of truth** for the project. They live
in version control (Git) next to the code. When a decision changes, the
file changes — never a verbal agreement, never a private chat.

---

## 3. Scope

### In scope
- Master data: items, units of measure, formulas, warehouses, suppliers, customers
- Inventory management with full lot/batch control and expiry dates
- Procurement: purchase orders and goods receipt
- Production: formula-based (process / batch) manufacturing
- Sales: sales orders and shipping, with FEFO lot selection
- Lot traceability (forward and backward) and recall support
- Financials: general ledger, accounts payable, accounts receivable, inventory costing
- Quality: certificate of analysis (COA) per lot

### Out of scope (initial release)
- Payroll
- Fixed-asset accounting
- Advanced production planning / MRP
- EDI integration with retailers
- E-commerce / web storefront
- Multi-company / multi-currency consolidation

Writing down what is *out* of scope is as important as what is in. It is the
guardrail that stops the project from quietly growing past what the team can
deliver. Anything added later is a deliberate, documented decision.

---

## 4. Build sequence (phasing)

A full ERP is too large to release all at once. It is built and released in
phases so that something usable goes live early rather than everything going
live late.

**Phase 1 — Operations core.** Master data, inventory & lots, procurement,
production, sales/shipping, traceability. This is the foundation: it produces
the inventory and lot data that everything else depends on.

**Phase 2 — Finance.** General ledger, accounts payable, accounts receivable,
inventory costing. Built on top of Phase 1, because costing and journal
entries are driven by the inventory transactions Phase 1 creates.

**Phase 3 — Advanced.** Quality/COA depth, regulatory reporting, planning,
analytics and dashboards.

> **Open question for the client.** Within Phase 1, which module hurts the
> most today should be built first (batch traceability, or formula/production,
> or inventory visibility). Confirm this with the customer before construction
> starts — it sets the order of work.

---

## 5. Key design principles

These ideas run through the whole data model. Understand them before reading
the schema.

1. **Inventory is an immutable ledger.** Stock levels are never edited in
   place. Every movement (receipt, issue, transfer, adjustment) is recorded
   as a new, permanent row in `inventory_transaction`. The current quantity
   is the *sum* of those rows. This is the same principle as an accounting
   ledger — and it is what makes traceability and auditing possible.

2. **Lots are first-class.** A lot-controlled item never moves without a
   lot. Quantity always has three coordinates: *which item, which lot, which
   location*.

3. **Documents drive transactions.** A goods receipt, a production order, a
   shipment — each is a business document, and each *generates* inventory
   transactions. The document is the human-facing record; the transaction is
   the ledger entry.

4. **Nothing is hard-deleted.** Records are cancelled or marked obsolete via
   a status field, never physically removed. An ERP must be able to explain
   its own history.

---

## 6. Using these documents with an AI assistant

An AI assistant has no memory between sessions and does not know your code
base. To get useful, consistent help: keep these files in Git, and when you
ask for help, paste the relevant file(s) into the conversation first. The
assistant then works *from your decisions* instead of inventing new ones.
When a decision is made, update the file — the file is the memory.

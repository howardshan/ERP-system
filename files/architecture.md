# Architecture & Technical Approach

This document covers the technology choices, how the system is structured,
the environments it runs in, how it is tested, and the main risks. It is
deliberately conservative: an ERP rewards "boring and correct" over clever.

---

## 1. Guiding choices

**Database: PostgreSQL.** An ERP lives or dies on transactional integrity —
inventory and accounting must never disagree because two things happened at
once. PostgreSQL gives strong ACID transactions, the constraints used
throughout `schema.sql`, and `WITH RECURSIVE` for the traceability queries.
Do not use a NoSQL store for the core data.

**Backend: a mainstream, well-supported framework** in whatever language the
team is most productive in. The ERP needs no exotic technology. Priorities,
in order: correctness, clarity, ease of hiring help later.

**Frontend: a mainstream web framework.** Most ERP screens are forms and
lists. Favor clarity and data density over visual flourish — the users are
warehouse, production, and office staff doing the same tasks all day.

**Money and quantities: fixed-point decimals only.** Never floating point.
The schema uses `numeric` for exactly this reason.

---

## 2. Layered structure

Keep three layers cleanly separated:

1. **Data layer** — the PostgreSQL schema. The constraints in the schema are
   the last line of defense for data integrity.
2. **Domain / service layer** — the business rules (BR-1 … BR-17) live here:
   posting inventory transactions, scaling formulas, running traces,
   generating journal entries. This layer is the most important code in the
   system and deserves the most tests.
3. **Presentation layer** — the web UI and any API. It should contain no
   business logic; it calls the domain layer.

Business rules belong in **one** place (the domain layer), never duplicated
in the UI. A rule implemented twice will eventually be implemented two
different ways.

---

## 3. Environments

Four environments, all owned by the development team — none depends on any
outside subscription:

| Environment | Purpose | Data |
|-------------|---------|------|
| **Development** | Each developer's own machine | Synthetic / sample data |
| **QA / Test** | Shared; integration & regression testing | Synthetic data |
| **UAT** | Customer's staff verify against real workflows | Realistic, sanitized data |
| **Production** | The live system | Real data |

Use Docker so every environment is reproducible and identical. Use a CI
pipeline (e.g. GitHub Actions) so the only way code reaches Production is
through automated tests and a controlled deploy. Never edit Production by
hand.

---

## 4. Testing approach

ERP testing is not mainly about the UI. It is about **data correctness** and
**end-to-end business processes**. Test in layers:

**Unit tests** — the calculation core. Highest priority targets for this
business:
- UOM conversion (kg ↔ bag ↔ pallet)
- Formula scaling and scrap (BR-7)
- Yield variance (BR-8a)
- Inventory transaction signing and balance math (BR-2, BR-4)
- Costing per method (BR-15)
- Journal entry balancing (BR-12)
A wrong number here corrupts everything downstream, so these run on every
commit in CI.

**Integration tests** — one action, many effects. Example: "receive a
purchase order line" must be checked for *all* its consequences — a lot
created, expiry set, inventory transaction posted, balance updated, PO line
`received_quantity` advanced.

**End-to-end process tests** — the core of ERP testing. Walk a full chain
and verify every step: purchase → receive (lot born) → produce (consume raw
lots, output finished lot) → ship (FEFO) → then run a backward trace and a
forward trace and confirm they return the complete, correct genealogy. The
trace tests are not optional — they are the product's reason to exist.

**Data migration tests** — treat migration as its own project. Whatever the
source of the customer's existing data (items, suppliers, customers,
on-hand balances, open orders), the import is rehearsed repeatedly and each
result is reconciled item by item: counts match, quantities match, values
match.

**UAT** — the customer's real staff (warehouse, production, purchasing,
sales) run their real daily workflows in the UAT environment. Developers
testing their own software cannot find process gaps; only real users can.

**Parallel run** — before go-live, run the new system alongside the
customer's current process on the *same real transactions* for a period
(commonly one to two months). Compare inventory, lots, and key numbers daily.
Only cut over when they agree. Do not skip this step.

---

## 5. Sequencing the build

Follow the phasing in `README.md`: operations core first (it generates the
data everything else needs), then finance, then advanced features. Within
the operations core, build the module the customer most needs first — that
question should be settled with the customer before construction begins.

Before writing feature code, do two things:
1. **Finish the domain model.** The entities in `data-model.md` and
   `schema.sql` are the foundation. A flaw here is expensive to fix later.
2. **Walk the real workflow with the customer** — on paper or a prototype —
   to confirm the team's understanding matches how the business actually
   operates. ERP projects fail far more often from misunderstood processes
   than from bad code.

---

## 6. Risks to manage actively

- **Scope growth.** The "out of scope" list in `README.md` is a contract
  with yourselves. Anything added is a documented, deliberate decision.
- **Effort estimation.** A full ERP is large. After building one real
  module, honestly recalibrate how long the rest will take from measured
  pace, not optimism.
- **Concurrency.** Two users moving the same stock at once must not corrupt
  the balance. Rely on database transactions and appropriate locking; cover
  it with tests.
- **The general ledger.** Accounting logic is unforgiving and its errors are
  expensive. It is Phase 2 precisely so it is built deliberately, on top of
  a proven operations core, with the team's accounting expertise validating
  every rule.
- **Maintenance.** An ERP is not "done" at go-live; it is operated and
  changed for years. Account for that ongoing commitment from the start.

---

## 7. Keeping these documents alive

This file and its companions are the project's memory. When a decision
changes — a new field, a changed rule, a scope adjustment — change the file
in the same commit. Documentation that drifts from reality is worse than
none, because people trust it. Keep it true.

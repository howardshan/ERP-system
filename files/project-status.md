# Project Status & Decisions Log

A living record of where the project stands, what has been decided, and what
is still open. Update it whenever a decision is made. It is the project's
memory — for the team, for new collaborators, and for any AI assistant
helping later (paste the relevant docs into the conversation so the
assistant works from these decisions).

_Last updated: project setup phase._

---

## 1. What this project is

A custom ERP system for a single pet (dog) food manufacturing company.
Greenfield build — no existing code reused. Standalone — not integrated with
the customer's current system. Built by a two-person team (one is a CPA,
both have web development experience).

---

## 2. Decisions made

| # | Decision | Notes |
|---|----------|-------|
| D1 | Build a fully custom ERP in-house | Team decision |
| D2 | First module to develop: **Financial** | Team decision. See risk R1 below. |
| D3 | Tech stack: **React + Vercel** (frontend), **Supabase / PostgreSQL** (backend) | |
| D4 | Frontend scaffolded with Google AI Studio | 8 finance screens generated |
| D5 | Database is PostgreSQL; all financial writes go through server-side RPC, never direct client writes | See `financial-core.md` §7 |
| D6 | Two extension points reserved in the schema now: segmented account codes (EP-1), department/cost-center dimension (EP-2) | So customer specifics slot in later without a rebuild |

---

## 3. Open items — must be resolved

| # | Item | Why it matters | Owner |
|---|------|----------------|-------|
| O1 | **Can a closed accounting period be reopened?** Options: no reopen / reopen with audit / two-stage close. | Determines `accounting_period` status logic and triggers. Recommended default: no reopen. See `financial-core.md` §3. | CPA decision |
| O2 | Obtain the customer's **chart of accounts** (export from their current system) | It is the spec for the account list, code format, and sub-account depth | Contact customer |
| O3 | Interview the customer's accountant: fiscal year, month-end procedure, AP/AR terms, required reports | Defines the customer-specific layer | Contact customer |
| O4 | Customer's inventory **costing method** (standard / weighted average / FIFO) | Needed for inventory valuation in a later phase | Contact customer |
| O5 | Confirm which Phase-1 operations module to build first | Sets the build order after finance setup | Contact customer |

---

## 4. Known risks

**R1 — Finance is being built before the operations modules.**
Financial figures (inventory value, cost of goods sold, AP, AR, and most
journal entries) are produced *by* operations: procurement, production,
shipping. Built first, the finance module has no real transaction data
feeding it and can only be exercised with manually entered entries; when the
operations modules are later added, the finance module's data model and
interfaces may need revision to consume their events. Mitigation: build the
finance *skeleton* (chart of accounts, periods, manual journal entries, the
universal rules) now, and treat automatic entry generation, inventory
costing, and reports as work that resumes once an operations module exists.
The schema's `source_type`/`source_id` fields and the `journal_entry`
structure are designed so manual and operation-driven entries share one
shape, which limits the rework.

**R2 — First ERP for the team.**
The team has web development experience but this is their first ERP. The
parts that differ most from a typical web app: concurrency on shared data
(two users moving the same stock or the same account balance), the
append-only ledger pattern, cross-module transactions, and the fact that
errors become real money and compliance issues. Mitigation: enforce
invariants at the database layer (constraints + triggers), not only in
application code; test end-to-end business processes, not just UI.

**R3 — Scope growth.**
The AI-generated frontend contains features that were not requested
(revenue/expense charts, aging analytics, "smart suggestions"). These are
not Phase-1 scope. Mitigation: keep the future-scope list (section 6) and do
not let placeholder UI drive development priority.

---

## 5. Current state

- **Documentation:** this `docs/` folder — see section 7.
- **Frontend:** 8 finance screens scaffolded in Google AI Studio
  (React + Vite + Tailwind). `src/services/api.ts` contains stub functions
  awaiting connection to the Supabase backend.
- **Backend:** not yet built. Next step is creating the Supabase project,
  running the schema, and implementing the RPC functions.
- **Frontend corrections still to apply:** journal-entry line debit/credit
  exclusion (BR-F2), remove one-click year-end closing, remove
  multi-company wording, treat unrequested charts/widgets as out of scope.

---

## 6. Future scope (not Phase 1 — deliberately deferred)

Recorded so these ideas are not lost and not built prematurely:
- Revenue/expense trend charts, expense distribution charts
- AP/AR aging analytics, DSO, collection-rate widgets
- Supplier risk scoring, "smart suggestions"
- Year-end closing workflow
- Operations modules: inventory & lots, procurement, production, sales/shipping
- Automatic journal entries from operational events
- Inventory valuation and cost of goods sold
- Lot traceability and recall
- Financial reports: balance sheet, P&L
- Multi-company consolidation, multi-currency, payroll, fixed assets

---

## 7. Document index

| File | Purpose |
|------|---------|
| `README.md` | Project overview, scope, phasing |
| `project-status.md` | This file — decisions, open items, risks, status |
| `glossary.md` | Definitions of every domain term |
| `data-model.md` | Every entity explained: fields, relations, rationale |
| `schema.sql` | Full ERP schema as PostgreSQL DDL |
| `financial-core.md` | Finance module spec + Supabase DDL, RLS, RPC, triggers |
| `business-rules.md` | Numbered business rules (BR-1…BR-17) |
| `architecture.md` | Tech stack, environments, testing, risks |
| `er-diagram.mermaid` | Entity-relationship diagram |

---

## 8. Recommended next steps

1. Resolve open item O1 (accounting-period reopen policy).
2. Send the customer a request for their chart-of-accounts export and an
   accountant interview (open items O2, O3).
3. Create the Supabase project; run `schema.sql` and the finance DDL from
   `financial-core.md`.
4. Implement the finance RPC functions and triggers (`financial-core.md` §7).
5. Connect the AI Studio frontend's `api.ts` stubs to the Supabase RPC.
6. Apply the frontend corrections listed in section 5.

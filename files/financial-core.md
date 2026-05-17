# Financial Core — Specification

> The **universal** part of the financial module — the double-entry skeleton
> that is the same for every company. The **customer-specific** part (the
> actual chart of accounts content, sub-account depth, exact month-end
> procedure, report layouts) is filled in later, from the client's existing
> chart-of-accounts export and an interview with their accountant.
>
> This document is designed so that filling in the customer-specific part
> later is **filling in blanks, not rebuilding**. Every place customer
> variation can occur is an extension point, called out explicitly.
>
> Target backend: **Supabase (PostgreSQL)**. Frontend: React on Vercel.

---

## 1. Universal vs. customer-specific

| Universal — built now | Customer-specific — filled in later |
|------------------------|--------------------------------------|
| Double-entry mechanics (every entry balances) | The actual list of accounts |
| Account / journal / period **table structure** | Account code format & segment meaning |
| Posting is one-way (reverse, never edit) | How many sub-account levels |
| Audit trail on every record | Whether department / cost-center is used |
| Accounting-period model | Fiscal year start month |
| AP / AR core structure | Exact month-end / year-end procedure |
|                        | Which financial reports, and their layout |

The **mechanics** of accounting are mathematics and do not vary. The
**content and policy** vary per company. We build the mechanics now, with
structure roomy enough that content slots in.

---

## 2. Chart of accounts — structure and two extension points

### 2.1 Sub-account hierarchy
`gl_account` has a self-referencing `parent_id`: an account can have a
parent, to any depth. A 2-level or a 5-level chart uses the same table.
`is_postable` is true only for leaf accounts — journal lines post only to
leaf accounts; parent/roll-up accounts are for grouping and reporting.

### 2.2 Account code format — Extension Point EP-1
Some companies use a plain code (`1200`); some use a segmented code
(`1200-10-300` = account-department-costcenter). `account_code` is stored as
wide free text that accepts either. The optional `account_segment` table can
later describe segments if the client uses them; if not, it stays empty.
**Decision deferred, structure ready.**

### 2.3 Department / cost-center dimension — Extension Point EP-2
`journal_entry_line` carries **nullable** `department_id` and
`cost_center_id` from day one. Client does not use them → null, no effect.
Client does use them → populated, no table change. This is the single most
important "design for the unknown" decision, because retrofitting a
dimension later touches the entry table, the entry screen, and every report.

---

## 3. Accounting periods

A company posts into accounting periods (normally calendar months) grouped
into a fiscal year. The fiscal-year start month is customer-specific
(Extension Point EP-3) — one configuration value, deferred at no cost.

Period status: `open` (postable), `closed` (locked), `future` (not yet
open). A journal entry's date must fall in an `open` period (BR-F4).

> **OPEN DECISION — must be made before this module is built.**
> Can a `closed` period be reopened? Three options:
> 1. **No reopen** — `closed` is permanent; corrections go to the current
>    open period as adjusting entries. Simplest, cleanest audit trail.
> 2. **Reopen with audit** — a controller may reopen a closed period; every
>    reopen is logged (who/when/why).
> 3. **Two-stage close** — `open` → `soft_closed` (controller can still
>    adjust) → `locked` (permanent).
>
> The schema below includes a `period_status_history` table that records
> every status change regardless of which option is chosen, and the
> `accounting_period.status` CHECK currently lists all values. Once the
> decision is made: for option 1, add a trigger forbidding
> `closed → open`; for option 3, use `soft_closed` / `locked`. Recommended
> default: **option 1** unless the client requires otherwise.

---

## 4. Universal business rules (Finance)

Extends the BR-list in `business-rules.md`. Universal — true for any company.

**BR-F1 — Every journal entry must balance.** Sum of all line debits = sum
of all line credits. An unbalanced entry cannot be posted.

**BR-F2 — A journal line is debit XOR credit.** A line has either a debit
amount or a credit amount, never both, never neither.

**BR-F3 — Postings go only to postable (leaf) accounts.** A line may
reference a `gl_account` only where `is_postable` is true.

**BR-F4 — An entry posts only into an open period.** `entry_date` must fall
within an `accounting_period` whose status is `open`.

**BR-F5 — Posting is one-way (no edit, no delete).** A `posted`
`journal_entry` is immutable; correct it with a reversing entry.

**BR-F6 — Every entry is fully attributable.** Records who created/posted it
and when.

**BR-F7 — Operational events generate draft entries.** Later, goods receipt,
production output, and shipment each create a draft `journal_entry` linked
via `source_type`/`source_id`. Until the operations modules exist, entries
are manual. Same table structure either way.

**BR-F8 — Account balances are derived from posted lines.** An account's
balance is the sum of posted journal lines, never a stored editable number.

---

## 5. AP / AR core

AP (owed to suppliers) and AR (owed by customers) share one pattern: an
**invoice** records an amount owed; one or more **payment applications**
settle it; status moves `open → partially_paid → paid`. The
`payment`/`payment_application` split lets one payment cover several
invoices and supports partial payment and prepayment. Exact payment terms
and discount rules are customer-specific (EP-5) — the structure holds them
all; only policy values differ.

---

## 6. Schema (PostgreSQL / Supabase)

This DDL is the finance module. It supersedes the placeholder finance
section in `schema.sql`. Conventions match that file: `snake_case`,
surrogate `id`, `numeric(18,4)` for money, `timestamptz`, audit columns,
no hard deletes.

```sql
-- ===== Dimensions (Extension Point EP-2) =====
CREATE TABLE department (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code        text NOT NULL UNIQUE,
    name        text NOT NULL,
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  uuid          -- references auth.users(id) in Supabase
);

CREATE TABLE cost_center (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code        text NOT NULL UNIQUE,
    name        text NOT NULL,
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  uuid
);

-- ===== Chart of accounts =====
CREATE TABLE gl_account (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_code  text NOT NULL UNIQUE,       -- EP-1: wide enough for 1200-10-300
    name          text NOT NULL,
    account_type  text NOT NULL
                  CHECK (account_type IN
                  ('asset','liability','equity','revenue','expense')),
    parent_id     bigint REFERENCES gl_account(id),   -- sub-account hierarchy
    is_postable   boolean NOT NULL DEFAULT true,      -- false = roll-up/group
    is_active     boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    uuid
);

-- EP-1: optional, describes segments if the client uses a segmented code.
-- Stays empty if the client uses a plain account code.
CREATE TABLE account_segment (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    segment_no    integer NOT NULL,           -- 1 = account, 2 = dept, ...
    name          text NOT NULL,
    length        integer,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- ===== Accounting periods =====
CREATE TABLE accounting_period (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name          text NOT NULL UNIQUE,       -- 'OCT 2023'
    start_date    date NOT NULL,
    end_date      date NOT NULL,
    fiscal_year   integer NOT NULL,
    status        text NOT NULL DEFAULT 'future'
                  CHECK (status IN
                  ('future','open','soft_closed','closed')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    uuid,
    CHECK (end_date >= start_date)
);

-- Records every status change of a period (audit; supports all 3 options)
CREATE TABLE period_status_history (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    accounting_period_id bigint NOT NULL REFERENCES accounting_period(id),
    from_status         text,
    to_status           text NOT NULL,
    reason              text,
    changed_at          timestamptz NOT NULL DEFAULT now(),
    changed_by          uuid
);

-- ===== Journal entries =====
CREATE TABLE journal_entry (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entry_number  text NOT NULL UNIQUE,
    entry_date    date NOT NULL,
    accounting_period_id bigint NOT NULL REFERENCES accounting_period(id),
    description   text,
    journal_type  text NOT NULL DEFAULT 'general',
    source_type   text NOT NULL DEFAULT 'manual'    -- 'manual','goods_receipt',...
                  CHECK (source_type IN
                  ('manual','goods_receipt','production','shipment','adjustment')),
    source_id     bigint,
    status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','posted','reversed')),
    reversed_by_entry_id bigint REFERENCES journal_entry(id),
    posted_at     timestamptz,
    posted_by     uuid,
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    uuid
);

CREATE TABLE journal_entry_line (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    journal_entry_id  bigint NOT NULL REFERENCES journal_entry(id),
    line_no           integer NOT NULL,
    gl_account_id     bigint NOT NULL REFERENCES gl_account(id),
    description       text,
    debit             numeric(18,4) NOT NULL DEFAULT 0,
    credit            numeric(18,4) NOT NULL DEFAULT 0,
    department_id     bigint REFERENCES department(id),    -- EP-2, nullable
    cost_center_id    bigint REFERENCES cost_center(id),   -- EP-2, nullable
    UNIQUE (journal_entry_id, line_no),
    CHECK (debit >= 0 AND credit >= 0),
    CHECK (NOT (debit > 0 AND credit > 0)),          -- BR-F2: debit XOR credit
    CHECK (debit > 0 OR credit > 0)                  -- BR-F2: not both zero
);
CREATE INDEX idx_jel_entry   ON journal_entry_line(journal_entry_id);
CREATE INDEX idx_jel_account ON journal_entry_line(gl_account_id);

-- ===== AP / AR =====
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

CREATE TABLE ar_invoice (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_number text NOT NULL UNIQUE,
    customer_id    bigint NOT NULL REFERENCES customer(id),
    invoice_date   date NOT NULL,
    due_date       date,
    amount         numeric(18,4) NOT NULL,
    amount_received numeric(18,4) NOT NULL DEFAULT 0,
    status         text NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','partially_paid','paid','cancelled')),
    created_at     timestamptz NOT NULL DEFAULT now(),
    created_by     uuid
);

-- A payment (out to a supplier, or in from a customer)
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

-- Applies part or all of a payment to a specific invoice (supports
-- partial payment and one payment across many invoices)
CREATE TABLE payment_application (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    payment_id     bigint NOT NULL REFERENCES payment(id),
    invoice_type   text NOT NULL CHECK (invoice_type IN ('ap','ar')),
    invoice_id     bigint NOT NULL,
    amount_applied numeric(18,4) NOT NULL CHECK (amount_applied > 0),
    created_at     timestamptz NOT NULL DEFAULT now()
);
```

---

## 7. Supabase-specific: enforce the rules server-side

The danger of building an ERP on Supabase is that the client can talk to the
database directly. Financial integrity requires that the client **cannot**
write financial tables directly. Three layers of defense:

### 7.1 Row Level Security (RLS)
Enable RLS on `journal_entry`, `journal_entry_line`, `gl_account`,
`accounting_period`, `ap_invoice`, `ar_invoice`, `payment`,
`payment_application`. Grant `SELECT` to authenticated users as appropriate,
but **do not** grant direct `INSERT/UPDATE/DELETE` on these tables to the
client role. All writes go through the RPC functions below.

### 7.2 RPC functions (the accounting engine entry points)
Implement these as PostgreSQL functions (`SECURITY DEFINER`), called from
the frontend's `api.ts`. They are where business rules are enforced:

- `create_journal_entry(...)` / `update_draft_journal_entry(...)` — create or
  edit a *draft* entry only.
- `post_journal_entry(entry_id)` — enforces BR-F1 (balanced), BR-F3
  (postable accounts), BR-F4 (open period); sets status `posted`.
- `reverse_journal_entry(entry_id, reason)` — creates the opposite entry
  (BR-F5).
- `close_accounting_period(period_id)` / `open_accounting_period(period_id)` —
  changes period status, writes `period_status_history`.
- `record_payment(...)` / `apply_payment(...)` — records payments and updates
  invoice `amount_paid` / status.

### 7.3 Triggers (last line of defense)
Application code has bugs; triggers do not lie. Add at minimum:

- **Posting lock:** a `BEFORE UPDATE/DELETE` trigger on `journal_entry` that
  raises an error if the row's current status is `posted` (BR-F5). Same for
  `journal_entry_line` of a posted entry.
- **Balance check:** a trigger (or a check inside `post_journal_entry`) that
  refuses to set status `posted` unless sum(debit) = sum(credit) (BR-F1).
- **Period guard:** refuse to attach an entry to a non-`open` period (BR-F4).

The `CHECK` constraints on `journal_entry_line` already enforce BR-F2 at the
column level — keep them; they cost nothing and cannot be bypassed.

---

## 8. What is NOT in this spec yet (deliberately)

- Year-end closing procedure (multi-step; out of Phase 1).
- Financial report layouts (balance sheet, P&L) — depend on the client's
  chart of accounts; specified after the client interview.
- Automatic journal entries from operations (BR-F7) — depend on the
  inventory / procurement / production modules existing.
- Inventory valuation and cost of goods sold — computed from inventory
  transactions, which the operations modules produce.

These are tracked in `project-status.md` under open items and future scope.

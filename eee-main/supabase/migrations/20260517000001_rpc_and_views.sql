-- =============================================================
--  RPC Functions + Views for Financial Module
-- =============================================================

-- -------------------------------------------------------------
--  VIEW: account_balance
--  Aggregates posted journal lines per account.
--  balance = "natural" balance per account type convention.
-- -------------------------------------------------------------
CREATE OR REPLACE VIEW account_balance AS
SELECT
    a.id,
    a.account_code,
    a.name,
    a.account_type,
    a.parent_id,
    a.is_postable,
    a.is_active,
    COALESCE(SUM(jel.debit), 0)  AS total_debit,
    COALESCE(SUM(jel.credit), 0) AS total_credit,
    CASE
        WHEN a.account_type IN ('asset', 'expense')
            THEN COALESCE(SUM(jel.debit) - SUM(jel.credit), 0)
        ELSE
            COALESCE(SUM(jel.credit) - SUM(jel.debit), 0)
    END AS balance
FROM gl_account a
LEFT JOIN journal_entry_line jel ON jel.gl_account_id = a.id
LEFT JOIN journal_entry je ON je.id = jel.journal_entry_id AND je.status = 'posted'
GROUP BY a.id, a.account_code, a.name, a.account_type, a.parent_id, a.is_postable, a.is_active;


-- -------------------------------------------------------------
--  FUNCTION: create_journal_entry
--  Creates a draft entry + its lines atomically.
--  Returns the new journal_entry.id.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_journal_entry(
    p_entry_date   date,
    p_description  text,
    p_journal_type text,
    p_lines        jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_entry_id   bigint;
    v_period_id  bigint;
    v_line       jsonb;
    v_line_no    integer := 1;
BEGIN
    -- Find the open period that covers this date (BR-F4 pre-check)
    SELECT id INTO v_period_id
    FROM accounting_period
    WHERE p_entry_date BETWEEN start_date AND end_date
      AND status = 'open'
    LIMIT 1;

    IF v_period_id IS NULL THEN
        RAISE EXCEPTION 'No open accounting period found for date %', p_entry_date;
    END IF;

    IF jsonb_array_length(p_lines) < 2 THEN
        RAISE EXCEPTION 'A journal entry must have at least two lines';
    END IF;

    -- Insert entry with temporary placeholder number
    INSERT INTO journal_entry (
        entry_number, entry_date, accounting_period_id,
        description, journal_type, source_type, status, created_by
    )
    VALUES (
        'PENDING-' || gen_random_uuid()::text,
        p_entry_date, v_period_id,
        p_description,
        COALESCE(p_journal_type, 'general'),
        'manual', 'draft', auth.uid()
    )
    RETURNING id INTO v_entry_id;

    -- Replace placeholder with proper sequential number
    UPDATE journal_entry
    SET entry_number = 'JE-' || to_char(p_entry_date, 'YYYY') || '-' || lpad(v_entry_id::text, 6, '0')
    WHERE id = v_entry_id;

    -- Insert lines
    FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
        INSERT INTO journal_entry_line (
            journal_entry_id, line_no, gl_account_id,
            description, debit, credit,
            department_id, cost_center_id
        )
        VALUES (
            v_entry_id,
            v_line_no,
            (v_line->>'gl_account_id')::bigint,
            v_line->>'description',
            COALESCE((v_line->>'debit')::numeric, 0),
            COALESCE((v_line->>'credit')::numeric, 0),
            NULLIF(v_line->>'department_id', '')::bigint,
            NULLIF(v_line->>'cost_center_id', '')::bigint
        );
        v_line_no := v_line_no + 1;
    END LOOP;

    RETURN v_entry_id;
END;
$$;


-- -------------------------------------------------------------
--  FUNCTION: post_journal_entry
--  Validates and posts a draft entry. Enforces:
--    BR-F1: entry must balance (sum debit = sum credit)
--    BR-F2: each line is debit XOR credit (enforced by CHECK constraint)
--    BR-F3: all accounts must be postable leaf accounts
--    BR-F4: entry date must fall in an open period
--    BR-F5: posting is one-way
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION post_journal_entry(p_entry_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_entry         journal_entry%ROWTYPE;
    v_period_status text;
    v_total_debit   numeric;
    v_total_credit  numeric;
    v_bad_accounts  integer;
    v_line_count    integer;
BEGIN
    SELECT * INTO v_entry FROM journal_entry WHERE id = p_entry_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Journal entry % not found', p_entry_id;
    END IF;

    -- BR-F5: only draft entries can be posted
    IF v_entry.status != 'draft' THEN
        RAISE EXCEPTION 'Entry % is not in draft status (current: %)', p_entry_id, v_entry.status;
    END IF;

    -- BR-F4: period must still be open
    SELECT status INTO v_period_status
    FROM accounting_period WHERE id = v_entry.accounting_period_id;

    IF v_period_status != 'open' THEN
        RAISE EXCEPTION 'Accounting period is not open (status: %)', v_period_status;
    END IF;

    -- Check there are lines
    SELECT COUNT(*) INTO v_line_count FROM journal_entry_line WHERE journal_entry_id = p_entry_id;
    IF v_line_count < 2 THEN
        RAISE EXCEPTION 'Entry must have at least two lines';
    END IF;

    -- BR-F3: all accounts must be postable
    SELECT COUNT(*) INTO v_bad_accounts
    FROM journal_entry_line jel
    JOIN gl_account a ON a.id = jel.gl_account_id
    WHERE jel.journal_entry_id = p_entry_id AND NOT a.is_postable;

    IF v_bad_accounts > 0 THEN
        RAISE EXCEPTION '% line(s) post to non-postable roll-up accounts', v_bad_accounts;
    END IF;

    -- BR-F1: entry must balance
    SELECT SUM(debit), SUM(credit)
    INTO v_total_debit, v_total_credit
    FROM journal_entry_line WHERE journal_entry_id = p_entry_id;

    IF COALESCE(v_total_debit, 0) = 0 AND COALESCE(v_total_credit, 0) = 0 THEN
        RAISE EXCEPTION 'Entry has no amounts';
    END IF;

    IF ROUND(COALESCE(v_total_debit, 0), 4) != ROUND(COALESCE(v_total_credit, 0), 4) THEN
        RAISE EXCEPTION 'Entry is not balanced: debit=% credit=%', v_total_debit, v_total_credit;
    END IF;

    UPDATE journal_entry
    SET status = 'posted', posted_at = now(), posted_by = auth.uid()
    WHERE id = p_entry_id;
END;
$$;


-- -------------------------------------------------------------
--  FUNCTION: reverse_journal_entry
--  Creates and immediately posts a mirror entry (debit↔credit).
--  Marks the original as 'reversed'.
--  Returns the new reversing entry id.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION reverse_journal_entry(p_entry_id bigint, p_reason text DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_entry      journal_entry%ROWTYPE;
    v_new_id     bigint;
    v_period_id  bigint;
BEGIN
    SELECT * INTO v_entry FROM journal_entry WHERE id = p_entry_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Journal entry % not found', p_entry_id;
    END IF;

    IF v_entry.status != 'posted' THEN
        RAISE EXCEPTION 'Only posted entries can be reversed (current: %)', v_entry.status;
    END IF;

    -- Find the current open period for the reversing entry
    SELECT id INTO v_period_id
    FROM accounting_period
    WHERE status = 'open'
    ORDER BY start_date DESC
    LIMIT 1;

    IF v_period_id IS NULL THEN
        RAISE EXCEPTION 'No open accounting period for the reversing entry';
    END IF;

    -- Create the reversing entry
    INSERT INTO journal_entry (
        entry_number, entry_date, accounting_period_id,
        description, journal_type, source_type, status, created_by
    )
    VALUES (
        'PENDING-' || gen_random_uuid()::text,
        CURRENT_DATE,
        v_period_id,
        COALESCE(p_reason, 'Reversal of ' || v_entry.entry_number),
        v_entry.journal_type,
        'manual', 'draft', auth.uid()
    )
    RETURNING id INTO v_new_id;

    UPDATE journal_entry
    SET entry_number = 'JE-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(v_new_id::text, 6, '0')
    WHERE id = v_new_id;

    -- Mirror lines with debit↔credit swapped
    INSERT INTO journal_entry_line (
        journal_entry_id, line_no, gl_account_id,
        description, debit, credit,
        department_id, cost_center_id
    )
    SELECT
        v_new_id, line_no, gl_account_id,
        description, credit, debit,
        department_id, cost_center_id
    FROM journal_entry_line
    WHERE journal_entry_id = p_entry_id;

    -- Post it immediately
    UPDATE journal_entry
    SET status = 'posted', posted_at = now(), posted_by = auth.uid()
    WHERE id = v_new_id;

    -- Mark original as reversed
    UPDATE journal_entry
    SET status = 'reversed', reversed_by_entry_id = v_new_id
    WHERE id = p_entry_id;

    RETURN v_new_id;
END;
$$;


-- -------------------------------------------------------------
--  FUNCTION: open_accounting_period
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION open_accounting_period(p_period_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_period accounting_period%ROWTYPE;
BEGIN
    SELECT * INTO v_period FROM accounting_period WHERE id = p_period_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Period % not found', p_period_id; END IF;
    IF v_period.status = 'open' THEN RETURN; END IF;

    INSERT INTO period_status_history (accounting_period_id, from_status, to_status, changed_by)
    VALUES (p_period_id, v_period.status, 'open', auth.uid());

    UPDATE accounting_period SET status = 'open' WHERE id = p_period_id;
END;
$$;


-- -------------------------------------------------------------
--  FUNCTION: close_accounting_period
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION close_accounting_period(p_period_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_period        accounting_period%ROWTYPE;
    v_draft_count   integer;
BEGIN
    SELECT * INTO v_period FROM accounting_period WHERE id = p_period_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Period % not found', p_period_id; END IF;

    IF v_period.status != 'open' THEN
        RAISE EXCEPTION 'Only open periods can be closed (current: %)', v_period.status;
    END IF;

    -- Block close if there are pending drafts in this period
    SELECT COUNT(*) INTO v_draft_count
    FROM journal_entry
    WHERE accounting_period_id = p_period_id AND status = 'draft';

    IF v_draft_count > 0 THEN
        RAISE EXCEPTION 'Cannot close: % draft entr(ies) still pending in this period', v_draft_count;
    END IF;

    INSERT INTO period_status_history (accounting_period_id, from_status, to_status, changed_by)
    VALUES (p_period_id, 'open', 'closed', auth.uid());

    UPDATE accounting_period SET status = 'closed' WHERE id = p_period_id;
END;
$$;


-- -------------------------------------------------------------
--  FUNCTION: create_accounting_period
--  Creates a new period. Validates no overlap with existing periods.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_accounting_period(
    p_name        text,
    p_start_date  date,
    p_end_date    date,
    p_fiscal_year integer
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_period_id bigint;
    v_overlap   integer;
BEGIN
    IF p_end_date < p_start_date THEN
        RAISE EXCEPTION 'end_date must be >= start_date';
    END IF;

    SELECT COUNT(*) INTO v_overlap
    FROM accounting_period
    WHERE (p_start_date, p_end_date) OVERLAPS (start_date, end_date);

    IF v_overlap > 0 THEN
        RAISE EXCEPTION 'New period overlaps with an existing accounting period';
    END IF;

    INSERT INTO accounting_period (name, start_date, end_date, fiscal_year, status, created_by)
    VALUES (p_name, p_start_date, p_end_date, p_fiscal_year, 'future', auth.uid())
    RETURNING id INTO v_period_id;

    RETURN v_period_id;
END;
$$;

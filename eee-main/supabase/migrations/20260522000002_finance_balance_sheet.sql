-- Migration M-045: Balance Sheet report RPC
--
-- Returns asset / liability / equity account balances as of a given date.
-- The asset/liability/equity rows are direct posted-line aggregates.
-- Retained Earnings (cumulative net income) is NOT included here — the
-- frontend computes it by calling gl_pnl('1900-01-01', p_as_of_date) and
-- summing revenue minus expense (BR-F11).
--
-- This split keeps the SQL clean and reuses the existing P&L logic
-- instead of duplicating it.

CREATE OR REPLACE FUNCTION gl_balance_sheet(
    p_as_of_date date
) RETURNS TABLE (
    id             bigint,
    account_code   text,
    name           text,
    account_type   text,
    parent_id      bigint,
    is_postable    boolean,
    is_active      boolean,
    balance        numeric
) LANGUAGE sql STABLE AS $$
    SELECT
        a.id,
        a.account_code,
        a.name,
        a.account_type,
        a.parent_id,
        a.is_postable,
        a.is_active,
        CASE
            WHEN a.account_type = 'asset'
                THEN COALESCE(SUM(jel.debit) - SUM(jel.credit), 0)
            ELSE  -- liability, equity
                COALESCE(SUM(jel.credit) - SUM(jel.debit), 0)
        END AS balance
    FROM gl_account a
    LEFT JOIN journal_entry_line jel ON jel.gl_account_id = a.id
    LEFT JOIN journal_entry je ON je.id = jel.journal_entry_id
        AND je.status = 'posted'
        AND je.entry_date <= p_as_of_date
    WHERE a.account_type IN ('asset', 'liability', 'equity')
    GROUP BY a.id, a.account_code, a.name, a.account_type, a.parent_id,
             a.is_postable, a.is_active
    ORDER BY a.account_type, a.account_code;
$$;

COMMENT ON FUNCTION gl_balance_sheet(date) IS
  'Balance Sheet aggregation as of p_as_of_date. Counts only posted journal lines. Retained Earnings is computed by the frontend via gl_pnl (BR-F11). See docs/modules/04_reports-periods.md.';

-- Migration M-044: Profit & Loss report RPC
--
-- Returns revenue + expense accounts with period-scoped totals.
-- Only posted journal lines are counted (BR-F9). Period boundary
-- is on journal_entry.entry_date, not posted_at (BR-F10).
--
-- Designed parallel to the account_balance VIEW (M-001) but adds
-- a date-range filter, which a VIEW cannot express directly.

CREATE OR REPLACE FUNCTION gl_pnl(
    p_start_date date,
    p_end_date   date
) RETURNS TABLE (
    id             bigint,
    account_code   text,
    name           text,
    account_type   text,
    parent_id      bigint,
    is_postable    boolean,
    is_active      boolean,
    total_debit    numeric,
    total_credit   numeric,
    net_amount     numeric
) LANGUAGE sql STABLE AS $$
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
            WHEN a.account_type = 'revenue'
                THEN COALESCE(SUM(jel.credit) - SUM(jel.debit), 0)
            WHEN a.account_type = 'expense'
                THEN COALESCE(SUM(jel.debit) - SUM(jel.credit), 0)
            ELSE 0
        END AS net_amount
    FROM gl_account a
    LEFT JOIN journal_entry_line jel ON jel.gl_account_id = a.id
    LEFT JOIN journal_entry je ON je.id = jel.journal_entry_id
        AND je.status = 'posted'
        AND je.entry_date BETWEEN p_start_date AND p_end_date
    WHERE a.account_type IN ('revenue', 'expense')
    GROUP BY a.id, a.account_code, a.name, a.account_type, a.parent_id,
             a.is_postable, a.is_active
    ORDER BY a.account_type DESC, a.account_code;
$$;

COMMENT ON FUNCTION gl_pnl(date, date) IS
  'P&L aggregation for [p_start_date, p_end_date]. Counts only posted journal lines; filters by journal_entry.entry_date. See BR-F9/F10 in docs/modules/04_reports-periods.md.';

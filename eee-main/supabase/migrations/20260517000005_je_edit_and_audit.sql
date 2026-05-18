-- Migration 005: JE shell creation, draft editing, and audit trail

-- ─── Audit columns on journal_entry ───────────────────────────────────────────
ALTER TABLE journal_entry
  ADD COLUMN IF NOT EXISTS updated_at  timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by  uuid REFERENCES auth.users(id);

-- ─── Edit log ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS journal_entry_edit_log (
  id               bigserial PRIMARY KEY,
  journal_entry_id bigint      NOT NULL REFERENCES journal_entry(id),
  action           text        NOT NULL CHECK (action IN ('created','updated','posted','reversed')),
  changed_at       timestamptz NOT NULL DEFAULT now(),
  changed_by       uuid        REFERENCES auth.users(id),
  summary          text
);

-- RLS: anyone who can read journal_entry can read the log
ALTER TABLE journal_entry_edit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read edit log" ON journal_entry_edit_log FOR SELECT USING (true);
CREATE POLICY "insert edit log" ON journal_entry_edit_log FOR INSERT WITH CHECK (true);


-- ─── create_je_shell ──────────────────────────────────────────────────────────
-- Creates only the header (no lines). Used so attachments can be uploaded before
-- the user has finished filling in the lines.
CREATE OR REPLACE FUNCTION create_je_shell(
  p_entry_date   date,
  p_description  text,
  p_journal_type text DEFAULT 'general',
  p_notes        text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_entry_id  bigint;
  v_period_id bigint;
BEGIN
  SELECT id INTO v_period_id
  FROM accounting_period
  WHERE p_entry_date BETWEEN start_date AND end_date AND status = 'open'
  LIMIT 1;

  IF v_period_id IS NULL THEN
    RAISE EXCEPTION 'No open accounting period found for date %', p_entry_date;
  END IF;

  INSERT INTO journal_entry (
    entry_number, entry_date, accounting_period_id,
    description, journal_type, source_type, status, notes, created_by
  )
  VALUES (
    'PENDING-' || gen_random_uuid()::text,
    p_entry_date, v_period_id,
    p_description, COALESCE(p_journal_type, 'general'),
    'manual', 'draft', p_notes, auth.uid()
  )
  RETURNING id INTO v_entry_id;

  UPDATE journal_entry
  SET entry_number = 'JE-' || to_char(p_entry_date, 'YYYY') || '-' || lpad(v_entry_id::text, 6, '0')
  WHERE id = v_entry_id;

  INSERT INTO journal_entry_edit_log (journal_entry_id, action, changed_by, summary)
  VALUES (v_entry_id, 'created', auth.uid(), 'Draft created');

  RETURN v_entry_id;
END;
$$;


-- ─── update_je_draft ──────────────────────────────────────────────────────────
-- Replaces header fields and all lines of a draft entry.
-- Logs the change. Rejects updates to non-draft entries.
CREATE OR REPLACE FUNCTION update_je_draft(
  p_entry_id     bigint,
  p_entry_date   date,
  p_description  text,
  p_journal_type text,
  p_notes        text DEFAULT NULL,
  p_lines        jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_period_id bigint;
  v_current   record;
  v_line      jsonb;
  v_line_no   integer := 1;
BEGIN
  -- Must be a draft
  SELECT status, entry_number, description INTO v_current
  FROM journal_entry WHERE id = p_entry_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry % not found', p_entry_id;
  END IF;

  IF v_current.status != 'draft' THEN
    RAISE EXCEPTION 'Only draft entries can be edited (entry is %)', v_current.status;
  END IF;

  -- Resolve period for new date
  SELECT id INTO v_period_id
  FROM accounting_period
  WHERE p_entry_date BETWEEN start_date AND end_date AND status = 'open'
  LIMIT 1;

  IF v_period_id IS NULL THEN
    RAISE EXCEPTION 'No open accounting period found for date %', p_entry_date;
  END IF;

  -- Update header
  UPDATE journal_entry SET
    entry_date          = p_entry_date,
    accounting_period_id = v_period_id,
    description         = p_description,
    journal_type        = COALESCE(p_journal_type, 'general'),
    notes               = p_notes,
    updated_at          = now(),
    updated_by          = auth.uid()
  WHERE id = p_entry_id;

  -- Replace lines only if a non-empty lines array was provided
  IF jsonb_array_length(p_lines) > 0 THEN
    DELETE FROM journal_entry_line WHERE journal_entry_id = p_entry_id;
    FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
      INSERT INTO journal_entry_line (
        journal_entry_id, line_no, gl_account_id,
        description, debit, credit,
        department_id, cost_center_id
      )
      VALUES (
        p_entry_id, v_line_no,
        NULLIF(v_line->>'gl_account_id', '')::bigint,
        v_line->>'description',
        COALESCE((v_line->>'debit')::numeric, 0),
        COALESCE((v_line->>'credit')::numeric, 0),
        NULLIF(v_line->>'department_id', '')::bigint,
        NULLIF(v_line->>'cost_center_id', '')::bigint
      );
      v_line_no := v_line_no + 1;
    END LOOP;
  END IF;

  -- Log
  INSERT INTO journal_entry_edit_log (journal_entry_id, action, changed_by, summary)
  VALUES (p_entry_id, 'updated', auth.uid(),
    'Updated: ' || p_description);
END;
$$;


-- ─── patch create_journal_entry: safe gl_account_id parsing ───────────────────
-- Use NULLIF so empty string doesn't crash the bigint cast.
CREATE OR REPLACE FUNCTION create_journal_entry(
  p_entry_date   date,
  p_description  text,
  p_journal_type text,
  p_lines        jsonb,
  p_notes        text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_entry_id  bigint;
  v_period_id bigint;
  v_line      jsonb;
  v_line_no   integer := 1;
BEGIN
  SELECT id INTO v_period_id
  FROM accounting_period
  WHERE p_entry_date BETWEEN start_date AND end_date AND status = 'open'
  LIMIT 1;

  IF v_period_id IS NULL THEN
    RAISE EXCEPTION 'No open accounting period found for date %', p_entry_date;
  END IF;

  IF jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'A journal entry must have at least two lines';
  END IF;

  INSERT INTO journal_entry (
    entry_number, entry_date, accounting_period_id,
    description, journal_type, source_type, status, notes, created_by
  )
  VALUES (
    'PENDING-' || gen_random_uuid()::text,
    p_entry_date, v_period_id,
    p_description, COALESCE(p_journal_type, 'general'),
    'manual', 'draft', p_notes, auth.uid()
  )
  RETURNING id INTO v_entry_id;

  UPDATE journal_entry
  SET entry_number = 'JE-' || to_char(p_entry_date, 'YYYY') || '-' || lpad(v_entry_id::text, 6, '0')
  WHERE id = v_entry_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO journal_entry_line (
      journal_entry_id, line_no, gl_account_id,
      description, debit, credit,
      department_id, cost_center_id
    )
    VALUES (
      v_entry_id, v_line_no,
      NULLIF(v_line->>'gl_account_id', '')::bigint,
      v_line->>'description',
      COALESCE((v_line->>'debit')::numeric, 0),
      COALESCE((v_line->>'credit')::numeric, 0),
      NULLIF(v_line->>'department_id', '')::bigint,
      NULLIF(v_line->>'cost_center_id', '')::bigint
    );
    v_line_no := v_line_no + 1;
  END LOOP;

  INSERT INTO journal_entry_edit_log (journal_entry_id, action, changed_by, summary)
  VALUES (v_entry_id, 'created', auth.uid(), 'Draft created');

  RETURN v_entry_id;
END;
$$;


-- ─── patch post_journal_entry: log the post action ────────────────────────────
CREATE OR REPLACE FUNCTION post_journal_entry(p_entry_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_debit   numeric;
  v_credit  numeric;
  v_status  text;
  v_count   integer;
BEGIN
  SELECT status INTO v_status FROM journal_entry WHERE id = p_entry_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Journal entry % not found', p_entry_id; END IF;
  IF v_status != 'draft' THEN RAISE EXCEPTION 'Only draft entries can be posted (status: %)', v_status; END IF;

  SELECT COUNT(*), SUM(debit), SUM(credit)
  INTO v_count, v_debit, v_credit
  FROM journal_entry_line WHERE journal_entry_id = p_entry_id;

  IF v_count < 2 THEN RAISE EXCEPTION 'A journal entry must have at least two lines (BR-F1)'; END IF;
  IF ABS(v_debit - v_credit) > 0.005 THEN
    RAISE EXCEPTION 'Journal entry is out of balance: debit=% credit=% (BR-F1)', v_debit, v_credit;
  END IF;

  -- Verify all lines have postable accounts
  IF EXISTS (
    SELECT 1 FROM journal_entry_line jel
    JOIN gl_account a ON a.id = jel.gl_account_id
    WHERE jel.journal_entry_id = p_entry_id AND NOT a.is_postable
  ) THEN
    RAISE EXCEPTION 'All lines must reference postable accounts (BR-F3)';
  END IF;

  UPDATE journal_entry
  SET status = 'posted', posted_at = now(), posted_by = auth.uid()
  WHERE id = p_entry_id;

  INSERT INTO journal_entry_edit_log (journal_entry_id, action, changed_by, summary)
  VALUES (p_entry_id, 'posted', auth.uid(), 'Entry posted');
END;
$$;

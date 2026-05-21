-- Allow editing a posted journal entry (header + lines), keeping status = 'posted'.
-- A log entry is written with action = 'edited_posted'.
CREATE OR REPLACE FUNCTION update_je_posted(
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
  SELECT status, entry_number, description INTO v_current
  FROM journal_entry WHERE id = p_entry_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry % not found', p_entry_id;
  END IF;

  IF v_current.status NOT IN ('posted', 'draft', 'rejected') THEN
    RAISE EXCEPTION 'Cannot edit entry with status %', v_current.status;
  END IF;

  -- Resolve accounting period for new date
  SELECT id INTO v_period_id
  FROM accounting_period
  WHERE p_entry_date BETWEEN start_date AND end_date AND status = 'open'
  LIMIT 1;

  IF v_period_id IS NULL THEN
    RAISE EXCEPTION 'No open accounting period found for date %', p_entry_date;
  END IF;

  UPDATE journal_entry SET
    entry_date           = p_entry_date,
    accounting_period_id = v_period_id,
    description          = p_description,
    journal_type         = COALESCE(p_journal_type, 'general'),
    notes                = p_notes,
    updated_at           = now(),
    updated_by           = auth.uid()
  WHERE id = p_entry_id;

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

  INSERT INTO journal_entry_edit_log (journal_entry_id, action, changed_by, summary)
  VALUES (p_entry_id, 'edited_posted', auth.uid(),
    'Posted entry edited: ' || p_description);
END;
$$;

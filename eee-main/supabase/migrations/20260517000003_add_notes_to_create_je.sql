-- Update create_journal_entry to accept optional notes parameter
CREATE OR REPLACE FUNCTION create_journal_entry(
    p_entry_date   date,
    p_description  text,
    p_journal_type text,
    p_lines        jsonb,
    p_notes        text DEFAULT NULL
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

    INSERT INTO journal_entry (
        entry_number, entry_date, accounting_period_id,
        description, journal_type, source_type, status, notes, created_by
    )
    VALUES (
        'PENDING-' || gen_random_uuid()::text,
        p_entry_date, v_period_id,
        p_description,
        COALESCE(p_journal_type, 'general'),
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

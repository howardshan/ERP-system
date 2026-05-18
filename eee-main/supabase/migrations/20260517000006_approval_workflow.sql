-- Migration 006: Two-tier approval workflow
-- Flow: draft → pending_approval → posted (approved) | rejected → draft

-- ─── 1. Approval tiers ────────────────────────────────────────────────────────
CREATE TABLE approval_tier (
  id             serial PRIMARY KEY,
  name           text        NOT NULL UNIQUE,   -- 'manager','director','cfo','ceo'
  label          text        NOT NULL,           -- display name
  approval_limit numeric(18,2),                  -- NULL = unlimited
  sort_order     int         NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Seed default tiers
INSERT INTO approval_tier (name, label, approval_limit, sort_order) VALUES
  ('manager',  'Manager',   5000.00,   1),
  ('director', 'Director',  10000.00,  2),
  ('cfo',      'CFO',       100000.00, 3),
  ('ceo',      'CEO',       NULL,      4);   -- NULL = unlimited

-- ─── 2. User profiles ─────────────────────────────────────────────────────────
CREATE TABLE user_profile (
  user_id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name     text,
  email            text,
  approval_tier_id int  REFERENCES approval_tier(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz
);

ALTER TABLE user_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users can read all profiles" ON user_profile FOR SELECT USING (true);
CREATE POLICY "users can upsert own profile" ON user_profile FOR ALL USING (auth.uid() = user_id);

-- ─── 3. Extend journal_entry status ───────────────────────────────────────────
ALTER TABLE journal_entry
  DROP CONSTRAINT IF EXISTS journal_entry_status_check;

ALTER TABLE journal_entry
  ADD CONSTRAINT journal_entry_status_check
    CHECK (status IN ('draft','pending_approval','posted','reversed','rejected'));

ALTER TABLE journal_entry
  ADD COLUMN IF NOT EXISTS submitted_at      timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_by      uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS approved_at       timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by       uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS rejected_at       timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by       uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS rejection_reason  text,
  ADD COLUMN IF NOT EXISTS required_tier_id  int REFERENCES approval_tier(id);

-- ─── 4. submit_journal_entry ──────────────────────────────────────────────────
-- Staff accountant submits a draft for approval.
-- Validates: balanced, ≥2 lines, all accounts postable.
-- Sets required_tier_id based on the entry amount vs tier limits.
CREATE OR REPLACE FUNCTION submit_journal_entry(p_entry_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_status  text;
  v_debit   numeric;
  v_credit  numeric;
  v_count   int;
  v_tier_id int;
BEGIN
  SELECT status INTO v_status FROM journal_entry WHERE id = p_entry_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Journal entry % not found', p_entry_id; END IF;
  IF v_status NOT IN ('draft','rejected') THEN
    RAISE EXCEPTION 'Only draft or rejected entries can be submitted (current: %)', v_status;
  END IF;

  SELECT COUNT(*), SUM(debit), SUM(credit)
  INTO v_count, v_debit, v_credit
  FROM journal_entry_line WHERE journal_entry_id = p_entry_id;

  IF v_count < 2 THEN RAISE EXCEPTION 'At least two lines are required before submitting'; END IF;
  IF ABS(COALESCE(v_debit,0) - COALESCE(v_credit,0)) > 0.005 THEN
    RAISE EXCEPTION 'Entry is out of balance (debit=%, credit=%). Balance it before submitting.',
      v_debit, v_credit;
  END IF;
  IF EXISTS (
    SELECT 1 FROM journal_entry_line jel
    JOIN gl_account a ON a.id = jel.gl_account_id
    WHERE jel.journal_entry_id = p_entry_id AND NOT a.is_postable
  ) THEN
    RAISE EXCEPTION 'All lines must reference postable accounts';
  END IF;

  -- Determine minimum tier required (smallest limit that covers the amount)
  SELECT id INTO v_tier_id
  FROM approval_tier
  WHERE approval_limit IS NULL OR approval_limit >= v_debit
  ORDER BY COALESCE(approval_limit, 999999999) ASC
  LIMIT 1;

  UPDATE journal_entry SET
    status           = 'pending_approval',
    submitted_at     = now(),
    submitted_by     = auth.uid(),
    required_tier_id = v_tier_id,
    rejection_reason = NULL,
    rejected_at      = NULL,
    rejected_by      = NULL
  WHERE id = p_entry_id;

  INSERT INTO journal_entry_edit_log (journal_entry_id, action, changed_by, summary)
  VALUES (p_entry_id, 'submitted', auth.uid(), 'Submitted for approval');
END;
$$;

-- ─── 5. approve_journal_entry ─────────────────────────────────────────────────
-- Approver posts the entry. Checks that approver's tier limit covers the amount.
-- If no user_profile / tier exists, assumes unlimited (for dev without auth).
CREATE OR REPLACE FUNCTION approve_journal_entry(p_entry_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_entry       record;
  v_debit       numeric;
  v_tier_limit  numeric;
  v_tier_name   text;
  v_period_status text;
BEGIN
  SELECT je.*, ap.status AS period_status
  INTO v_entry
  FROM journal_entry je
  LEFT JOIN accounting_period ap ON ap.id = je.accounting_period_id
  WHERE je.id = p_entry_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Journal entry % not found', p_entry_id; END IF;
  IF v_entry.status != 'pending_approval' THEN
    RAISE EXCEPTION 'Only pending_approval entries can be approved (current: %)', v_entry.status;
  END IF;
  IF v_entry.period_status != 'open' THEN
    RAISE EXCEPTION 'Accounting period is not open';
  END IF;

  -- Get approver's limit
  SELECT at.approval_limit, at.name INTO v_tier_limit, v_tier_name
  FROM user_profile up
  JOIN approval_tier at ON at.id = up.approval_tier_id
  WHERE up.user_id = auth.uid();
  -- If no profile / tier found, allow (anonymous dev mode)

  SELECT SUM(debit) INTO v_debit
  FROM journal_entry_line WHERE journal_entry_id = p_entry_id;

  IF v_tier_limit IS NOT NULL AND v_debit > v_tier_limit THEN
    RAISE EXCEPTION 'Amount $% exceeds your approval limit of $% (%). Requires a higher authority.',
      v_debit, v_tier_limit, v_tier_name;
  END IF;

  UPDATE journal_entry SET
    status      = 'posted',
    approved_at = now(),
    approved_by = auth.uid(),
    posted_at   = now(),
    posted_by   = auth.uid()
  WHERE id = p_entry_id;

  INSERT INTO journal_entry_edit_log (journal_entry_id, action, changed_by, summary)
  VALUES (p_entry_id, 'approved', auth.uid(), 'Approved and posted');
END;
$$;

-- ─── 6. reject_journal_entry ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reject_journal_entry(p_entry_id bigint, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM journal_entry WHERE id = p_entry_id AND status = 'pending_approval') THEN
    RAISE EXCEPTION 'Entry is not pending approval';
  END IF;

  UPDATE journal_entry SET
    status           = 'rejected',
    rejected_at      = now(),
    rejected_by      = auth.uid(),
    rejection_reason = p_reason
  WHERE id = p_entry_id;

  INSERT INTO journal_entry_edit_log (journal_entry_id, action, changed_by, summary)
  VALUES (p_entry_id, 'rejected', auth.uid(), 'Rejected: ' || COALESCE(p_reason, '(no reason given)'));
END;
$$;

-- ─── 7. patch submit action into edit_log constraint ──────────────────────────
ALTER TABLE journal_entry_edit_log
  DROP CONSTRAINT IF EXISTS journal_entry_edit_log_action_check;

ALTER TABLE journal_entry_edit_log
  ADD CONSTRAINT journal_entry_edit_log_action_check
    CHECK (action IN ('created','updated','posted','reversed','submitted','approved','rejected'));

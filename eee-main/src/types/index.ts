export interface GlAccount {
  id: number;
  account_code: string;
  name: string;
  account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  parent_id: number | null;
  is_postable: boolean;
  is_active: boolean;
  total_debit?: number;
  total_credit?: number;
  balance?: number;
  children?: GlAccount[];
}

export interface JournalEntryLine {
  id?: number;
  journal_entry_id?: number;
  line_no?: number;
  gl_account_id: number | '';
  description?: string;
  debit: number;
  credit: number;
  department_id?: number | null;
  cost_center_id?: number | null;
  // display helpers (joined from gl_account)
  account_code?: string;
  account_name?: string;
}

export type JournalEntryStatus = 'draft' | 'pending_approval' | 'posted' | 'reversed' | 'rejected';

export interface JournalEntry {
  id: number;
  entry_number: string;
  entry_date: string;
  accounting_period_id: number;
  description?: string;
  notes?: string;
  journal_type: string;
  source_type: string;
  status: JournalEntryStatus;
  posted_at?: string;
  submitted_at?: string;
  submitted_by?: string;
  approved_at?: string;
  approved_by?: string;
  rejected_at?: string;
  rejected_by?: string;
  rejection_reason?: string;
  required_tier_id?: number;
  created_at: string;
  lines?: JournalEntryLine[];
  period_name?: string;
  total_debit?: number;
  total_credit?: number;
}

export interface ApprovalTier {
  id: number;
  name: string;
  label: string;
  approval_limit: number | null; // null = unlimited
  sort_order: number;
}

export interface UserProfile {
  user_id: string;
  display_name: string | null;
  email: string | null;
  approval_tier_id: number | null;
  tier?: ApprovalTier;
}

export interface JournalEntryAttachment {
  id: number;
  journal_entry_id: number;
  file_name: string;
  file_size?: number;
  storage_path: string;
  mime_type?: string;
  created_at: string;
}

export interface AccountingPeriod {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  fiscal_year: number;
  status: 'future' | 'open' | 'soft_closed' | 'closed';
  created_at: string;
}

export interface ApInvoice {
  id: number;
  invoice_number: string;
  supplier_id: number;
  invoice_date: string;
  due_date?: string;
  amount: number;
  amount_paid: number;
  status: 'open' | 'partially_paid' | 'paid' | 'cancelled';
  supplier_name?: string;
}

export interface ArInvoice {
  id: number;
  invoice_number: string;
  customer_id: number;
  invoice_date: string;
  due_date?: string;
  amount: number;
  amount_received: number;
  status: 'open' | 'partially_paid' | 'paid' | 'cancelled';
  customer_name?: string;
}

export interface DashboardStats {
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  netIncome: number;
  draftEntryCount: number;
  recentEntries: JournalEntry[];
}

// P&L row returned by gl_pnl(p_start_date, p_end_date) RPC (M-044).
// One row per revenue/expense account in the chart of accounts;
// totals reflect only journal_entry.status='posted' lines with
// entry_date in the requested range (BR-F9/F10).
export interface PnLRow {
  id: number;
  account_code: string;
  name: string;
  account_type: 'revenue' | 'expense';
  parent_id: number | null;
  is_postable: boolean;
  is_active: boolean;
  total_debit: number;
  total_credit: number;
  net_amount: number;
}

// Balance Sheet row returned by gl_balance_sheet(p_as_of_date) RPC (M-045).
// One row per asset / liability / equity account; balance reflects only
// posted journal lines with entry_date <= as-of date. Retained Earnings
// is computed separately on the frontend via gl_pnl (BR-F11).
export interface BalanceSheetRow {
  id: number;
  account_code: string;
  name: string;
  account_type: 'asset' | 'liability' | 'equity';
  parent_id: number | null;
  is_postable: boolean;
  is_active: boolean;
  balance: number;
}

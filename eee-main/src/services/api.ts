import { supabase } from '../lib/supabase';
import type {
  GlAccount, JournalEntry, JournalEntryLine,
  AccountingPeriod, ApInvoice, ArInvoice, DashboardStats,
  JournalEntryAttachment,
} from '../types';

// ---------------------------------------------------------------
// Chart of Accounts
// ---------------------------------------------------------------

export async function getAccounts(): Promise<GlAccount[]> {
  const { data, error } = await supabase
    .from('account_balance')
    .select('*')
    .eq('is_active', true)
    .order('account_code');
  if (error) throw new Error(error.message);
  return data as GlAccount[];
}

export async function createAccount(account: {
  account_code: string;
  name: string;
  account_type: GlAccount['account_type'];
  parent_id?: number | null;
  is_postable: boolean;
}): Promise<GlAccount> {
  const { data, error } = await supabase
    .from('gl_account')
    .insert({ ...account, is_active: true })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as GlAccount;
}

export async function updateAccount(id: number, updates: Partial<GlAccount>): Promise<void> {
  const { error } = await supabase
    .from('gl_account')
    .update(updates)
    .eq('id', id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------
// Journal Entries
// ---------------------------------------------------------------

export async function getJournalEntries(params?: {
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ entries: JournalEntry[]; total: number }> {
  const page = params?.page ?? 0;
  const pageSize = params?.pageSize ?? 20;

  let query = supabase
    .from('journal_entry')
    .select(`
      id, entry_number, entry_date, description, journal_type,
      source_type, status, posted_at, created_at, accounting_period_id,
      accounting_period(name),
      journal_entry_line(debit, credit)
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1);

  if (params?.status) query = query.eq('status', params.status);
  if (params?.search) query = query.or(
    `entry_number.ilike.%${params.search}%,description.ilike.%${params.search}%`
  );

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  const entries = (data ?? []).map((row: any) => ({
    ...row,
    period_name: row.accounting_period?.name,
    total_debit: row.journal_entry_line?.reduce((s: number, l: any) => s + Number(l.debit), 0) ?? 0,
    total_credit: row.journal_entry_line?.reduce((s: number, l: any) => s + Number(l.credit), 0) ?? 0,
  }));

  return { entries, total: count ?? 0 };
}

export async function getJournalEntry(id: number): Promise<JournalEntry> {
  const { data, error } = await supabase
    .from('journal_entry')
    .select(`
      *,
      accounting_period(name),
      journal_entry_line(
        id, line_no, gl_account_id, description, debit, credit,
        gl_account(account_code, name)
      )
    `)
    .eq('id', id)
    .single();
  if (error) throw new Error(error.message);

  const entry = data as any;
  return {
    ...entry,
    period_name: entry.accounting_period?.name,
    lines: (entry.journal_entry_line ?? [])
      .sort((a: any, b: any) => a.line_no - b.line_no)
      .map((l: any) => ({
        ...l,
        account_code: l.gl_account?.account_code,
        account_name: l.gl_account?.name,
      })),
  };
}

export async function createJournalEntry(params: {
  entry_date: string;
  description: string;
  journal_type: string;
  notes?: string;
  lines: Omit<JournalEntryLine, 'id' | 'journal_entry_id' | 'line_no'>[];
}): Promise<number> {
  const { data, error } = await supabase.rpc('create_journal_entry', {
    p_entry_date: params.entry_date,
    p_description: params.description,
    p_journal_type: params.journal_type,
    p_notes: params.notes ?? null,
    p_lines: params.lines.map(l => ({
      gl_account_id: l.gl_account_id,
      description: l.description ?? '',
      debit: l.debit,
      credit: l.credit,
      department_id: l.department_id ?? null,
      cost_center_id: l.cost_center_id ?? null,
    })),
  });
  if (error) throw new Error(error.message);
  return data as number;
}

export async function createJeShell(params: {
  entry_date: string;
  description: string;
  journal_type: string;
  notes?: string;
}): Promise<number> {
  const { data, error } = await supabase.rpc('create_je_shell', {
    p_entry_date: params.entry_date,
    p_description: params.description,
    p_journal_type: params.journal_type,
    p_notes: params.notes ?? null,
  });
  if (error) throw new Error(error.message);
  return data as number;
}

export async function updateJeDraft(params: {
  entry_id: number;
  entry_date: string;
  description: string;
  journal_type: string;
  notes?: string;
  lines: Omit<JournalEntryLine, 'id' | 'journal_entry_id' | 'line_no'>[];
}): Promise<void> {
  const { error } = await supabase.rpc('update_je_draft', {
    p_entry_id: params.entry_id,
    p_entry_date: params.entry_date,
    p_description: params.description,
    p_journal_type: params.journal_type,
    p_notes: params.notes ?? null,
    p_lines: params.lines.map(l => ({
      gl_account_id: l.gl_account_id || null,
      description: l.description ?? '',
      debit: l.debit,
      credit: l.credit,
      department_id: l.department_id ?? null,
      cost_center_id: l.cost_center_id ?? null,
    })),
  });
  if (error) throw new Error(error.message);
}

export interface EditLogEntry {
  id: number;
  action: string;
  changed_at: string;
  changed_by: string | null;
  summary: string | null;
}

export async function getEditLog(entryId: number): Promise<EditLogEntry[]> {
  const { data, error } = await supabase
    .from('journal_entry_edit_log')
    .select('id, action, changed_at, changed_by, summary')
    .eq('journal_entry_id', entryId)
    .order('changed_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data as EditLogEntry[];
}

export async function postJournalEntry(id: number): Promise<void> {
  const { error } = await supabase.rpc('post_journal_entry', { p_entry_id: id });
  if (error) throw new Error(error.message);
}

export async function reverseJournalEntry(id: number, reason?: string): Promise<number> {
  const { data, error } = await supabase.rpc('reverse_journal_entry', {
    p_entry_id: id,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
  return data as number;
}

// ---------------------------------------------------------------
// Accounting Periods
// ---------------------------------------------------------------

export async function getAccountingPeriods(): Promise<AccountingPeriod[]> {
  const { data, error } = await supabase
    .from('accounting_period')
    .select('*')
    .order('start_date', { ascending: false });
  if (error) throw new Error(error.message);
  return data as AccountingPeriod[];
}

export async function createAccountingPeriod(params: {
  name: string;
  start_date: string;
  end_date: string;
  fiscal_year: number;
}): Promise<number> {
  const { data, error } = await supabase.rpc('create_accounting_period', {
    p_name: params.name,
    p_start_date: params.start_date,
    p_end_date: params.end_date,
    p_fiscal_year: params.fiscal_year,
  });
  if (error) throw new Error(error.message);
  return data as number;
}

export async function openAccountingPeriod(id: number): Promise<void> {
  const { error } = await supabase.rpc('open_accounting_period', { p_period_id: id });
  if (error) throw new Error(error.message);
}

export async function closeAccountingPeriod(id: number): Promise<void> {
  const { error } = await supabase.rpc('close_accounting_period', { p_period_id: id });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------
// AP / AR
// ---------------------------------------------------------------

export async function getApInvoices(): Promise<ApInvoice[]> {
  const { data, error } = await supabase
    .from('ap_invoice')
    .select('*, supplier(name)')
    .order('invoice_date', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: any) => ({
    ...row,
    supplier_name: row.supplier?.name,
  }));
}

export async function getArInvoices(): Promise<ArInvoice[]> {
  const { data, error } = await supabase
    .from('ar_invoice')
    .select('*, customer(name)')
    .order('invoice_date', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: any) => ({
    ...row,
    customer_name: row.customer?.name,
  }));
}

// ---------------------------------------------------------------
// Reports
// ---------------------------------------------------------------

export async function getTrialBalance(): Promise<GlAccount[]> {
  const { data, error } = await supabase
    .from('account_balance')
    .select('*')
    .eq('is_active', true)
    .order('account_code');
  if (error) throw new Error(error.message);
  return data as GlAccount[];
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const [accountsRes, recentRes] = await Promise.all([
    supabase.from('account_balance').select('account_type, balance, is_postable'),
    supabase
      .from('journal_entry')
      .select('id, entry_number, entry_date, description, status, source_type, created_at, journal_entry_line(debit)')
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  if (accountsRes.error) throw new Error(accountsRes.error.message);
  if (recentRes.error) throw new Error(recentRes.error.message);

  const accounts = accountsRes.data ?? [];
  const totalAssets = accounts
    .filter(a => a.account_type === 'asset' && a.is_postable)
    .reduce((s, a) => s + Number(a.balance ?? 0), 0);
  const totalLiabilities = accounts
    .filter(a => a.account_type === 'liability' && a.is_postable)
    .reduce((s, a) => s + Number(a.balance ?? 0), 0);
  const totalEquity = accounts
    .filter(a => a.account_type === 'equity' && a.is_postable)
    .reduce((s, a) => s + Number(a.balance ?? 0), 0);
  const totalRevenue = accounts
    .filter(a => a.account_type === 'revenue' && a.is_postable)
    .reduce((s, a) => s + Number(a.balance ?? 0), 0);
  const totalExpenses = accounts
    .filter(a => a.account_type === 'expense' && a.is_postable)
    .reduce((s, a) => s + Number(a.balance ?? 0), 0);
  const draftEntryCount = 0; // will do a count query if needed

  const recentEntries = (recentRes.data ?? []).map((row: any) => ({
    ...row,
    total_debit: row.journal_entry_line?.reduce((s: number, l: any) => s + Number(l.debit), 0) ?? 0,
    lines: undefined,
    journal_entry_line: undefined,
  }));

  return {
    totalAssets,
    totalLiabilities,
    totalEquity,
    netIncome: totalRevenue - totalExpenses,
    draftEntryCount,
    recentEntries,
  };
}

// ---------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------

const BUCKET = 'journal-attachments';

function sanitizeFileName(name: string): string {
  const ext = name.includes('.') ? '.' + name.split('.').pop() : '';
  const base = name.slice(0, name.length - ext.length);
  // Replace non-ASCII and unsafe storage chars with underscores, collapse runs
  const safe = base.replace(/[^\w\-.]/g, '_').replace(/_+/g, '_').slice(0, 80);
  return safe + ext;
}

export async function uploadAttachment(
  entryId: number,
  file: File,
): Promise<JournalEntryAttachment> {
  const ext = file.name.split('.').pop() ?? '';
  const path = `${entryId}/${Date.now()}_${sanitizeFileName(file.name)}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) throw new Error(uploadError.message);

  const { data, error } = await supabase
    .from('journal_entry_attachment')
    .insert({
      journal_entry_id: entryId,
      file_name: file.name,
      file_size: file.size,
      storage_path: path,
      mime_type: file.type || `application/${ext}`,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as JournalEntryAttachment;
}

export async function getAttachments(entryId: number): Promise<JournalEntryAttachment[]> {
  const { data, error } = await supabase
    .from('journal_entry_attachment')
    .select('*')
    .eq('journal_entry_id', entryId)
    .order('created_at');
  if (error) throw new Error(error.message);
  return data as JournalEntryAttachment[];
}

export async function deleteAttachment(attachment: JournalEntryAttachment): Promise<void> {
  await supabase.storage.from(BUCKET).remove([attachment.storage_path]);
  const { error } = await supabase
    .from('journal_entry_attachment')
    .delete()
    .eq('id', attachment.id);
  if (error) throw new Error(error.message);
}

export async function getAttachmentUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 3600); // 1-hour expiry
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

// ---------------------------------------------------------------
// Approval workflow
// ---------------------------------------------------------------

import type { ApprovalTier, UserProfile } from '../types';

export async function submitJournalEntry(id: number): Promise<void> {
  const { error } = await supabase.rpc('submit_journal_entry', { p_entry_id: id });
  if (error) throw new Error(error.message);
}

export async function approveJournalEntry(id: number): Promise<void> {
  const { error } = await supabase.rpc('approve_journal_entry', { p_entry_id: id });
  if (error) throw new Error(error.message);
}

export async function rejectJournalEntry(id: number, reason: string): Promise<void> {
  const { error } = await supabase.rpc('reject_journal_entry', {
    p_entry_id: id,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

export async function getPendingApprovals(): Promise<import('../types').JournalEntry[]> {
  const { data, error } = await supabase
    .from('journal_entry')
    .select(`
      *,
      accounting_period (name)
    `)
    .eq('status', 'pending_approval')
    .order('submitted_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((e: any) => ({
    ...e,
    period_name: e.accounting_period?.name,
    total_debit: undefined,
  }));
}

export async function getApprovalTiers(): Promise<ApprovalTier[]> {
  const { data, error } = await supabase
    .from('approval_tier')
    .select('*')
    .order('sort_order');
  if (error) throw new Error(error.message);
  return data as ApprovalTier[];
}

export async function updateApprovalTier(id: number, updates: Partial<ApprovalTier>): Promise<void> {
  const { error } = await supabase
    .from('approval_tier')
    .update(updates)
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function createApprovalTier(tier: Omit<ApprovalTier, 'id'>): Promise<void> {
  const { error } = await supabase.from('approval_tier').insert(tier);
  if (error) throw new Error(error.message);
}

export async function deleteApprovalTier(id: number): Promise<void> {
  const { error } = await supabase.from('approval_tier').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function getUserProfiles(): Promise<UserProfile[]> {
  const { data, error } = await supabase
    .from('user_profile')
    .select('*, tier:approval_tier(*)');
  if (error) throw new Error(error.message);
  return (data ?? []).map((u: any) => ({ ...u, tier: u.tier ?? null }));
}

export async function upsertUserProfile(profile: Partial<UserProfile> & { user_id: string }): Promise<void> {
  const { error } = await supabase
    .from('user_profile')
    .upsert({ ...profile, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

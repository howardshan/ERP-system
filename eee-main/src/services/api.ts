import { supabase } from '../lib/supabase';
import type {
  GlAccount, JournalEntry, JournalEntryLine,
  AccountingPeriod, ApInvoice, ArInvoice, DashboardStats,
  JournalEntryAttachment,
} from '../types';

// ---------------------------------------------------------------
// Audit log helpers (internal)
// ---------------------------------------------------------------

interface AuditParams {
  entity_type: string;
  entity_id: string | number;
  action: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  diff?: Record<string, { before: unknown; after: unknown }> | null;
  entry_number?: string | null;
  description?: string | null;
}

function computeDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { before: unknown; after: unknown }> | null {
  const result: Record<string, { before: unknown; after: unknown }> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      result[k] = { before: before[k], after: after[k] };
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

function pick<T extends Record<string, unknown>>(obj: T | null | undefined, keys: string[]): Record<string, unknown> {
  if (!obj) return {};
  return Object.fromEntries(keys.filter(k => k in obj).map(k => [k, obj[k]]));
}

async function logFinanceAction(params: AuditParams): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: erpRow } = await supabase
      .from('erp_user')
      .select('full_name')
      .eq('auth_user_id', user.id)
      .single();

    let diff = params.diff ?? null;
    if (diff === undefined && params.before && params.after) {
      diff = computeDiff(params.before as Record<string, unknown>, params.after as Record<string, unknown>);
    }

    await supabase.from('finance_audit_log').insert({
      entity_type: params.entity_type,
      entity_id:   String(params.entity_id),
      action:      params.action,
      actor_auth_id: user.id,
      actor_name:  erpRow?.full_name ?? user.email ?? 'Unknown',
      before_snapshot: params.before ?? null,
      after_snapshot:  params.after  ?? null,
      diff,
      entry_number: params.entry_number ?? null,
      description:  params.description  ?? null,
    });
  } catch {
    // Logging must never break the main operation
  }
}

async function getJeCompactSnapshot(id: number) {
  const entry = await getJournalEntry(id);
  return {
    entry_date:   entry.entry_date,
    description:  entry.description,
    journal_type: entry.journal_type,
    notes:        (entry as any).notes ?? null,
    entry_number: entry.entry_number,
    lines: (entry.lines ?? []).map(l => ({
      line_no:      l.line_no,
      account_code: (l as any).account_code ?? null,
      account_name: (l as any).account_name ?? null,
      gl_account_id: l.gl_account_id,
      debit:        Number(l.debit),
      credit:       Number(l.credit),
      description:  l.description ?? '',
    })),
  };
}

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

async function wouldCreateCycle(accountId: number, proposedParentId: number): Promise<boolean> {
  let currentId: number | null = proposedParentId;
  const visited = new Set<number>();
  while (currentId != null) {
    if (currentId === accountId) return true;   // cycle: proposed parent is a descendant of accountId
    if (visited.has(currentId)) break;          // guard against pre-existing cycle in DB
    visited.add(currentId);
    const { data } = await supabase
      .from('gl_account')
      .select('parent_id')
      .eq('id', currentId)
      .single();
    currentId = data?.parent_id ?? null;
  }
  return false;
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
  const created = data as GlAccount;

  logFinanceAction({
    entity_type:  'chart_of_accounts',
    entity_id:    created.id,
    action:       'create',
    after:        pick(created as any, ['account_code', 'name', 'account_type', 'parent_id', 'is_postable']),
    entry_number: created.account_code,
    description:  `Created account ${created.account_code} — ${created.name}`,
  }).catch(() => {});

  return created;
}

export async function updateAccount(id: number, updates: Partial<GlAccount>): Promise<void> {
  // Guard: reject updates that would create a circular parent chain
  if ('parent_id' in updates && updates.parent_id != null) {
    const hasCycle = await wouldCreateCycle(id, updates.parent_id);
    if (hasCycle) throw new Error(
      'Cannot set this parent account: it would create a circular reference in the account hierarchy.'
    );
  }

  let beforeSnap: Record<string, unknown> | null = null;
  try {
    const { data } = await supabase.from('gl_account').select('*').eq('id', id).single();
    beforeSnap = pick(data as any, ['account_code', 'name', 'account_type', 'parent_id', 'is_postable', 'is_active']);
  } catch { /* non-blocking */ }

  const { error } = await supabase
    .from('gl_account')
    .update(updates)
    .eq('id', id);
  if (error) throw new Error(error.message);

  (async () => {
    try {
      const { data: afterData } = await supabase.from('gl_account').select('*').eq('id', id).single();
      const afterSnap = pick(afterData as any, ['account_code', 'name', 'account_type', 'parent_id', 'is_postable', 'is_active']);
      await logFinanceAction({
        entity_type:  'chart_of_accounts',
        entity_id:    id,
        action:       'edit',
        before:       beforeSnap ?? undefined,
        after:        afterSnap,
        diff:         beforeSnap ? computeDiff(beforeSnap, afterSnap) : null,
        entry_number: String(afterSnap.account_code ?? beforeSnap?.account_code ?? id),
        description:  `Edited account ${beforeSnap?.account_code ?? id}`,
      });
    } catch { /* non-blocking */ }
  })();
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
    period_name:  row.accounting_period?.name,
    total_debit:  row.journal_entry_line?.reduce((s: number, l: any) => s + Number(l.debit), 0) ?? 0,
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
    p_entry_date:    params.entry_date,
    p_description:   params.description,
    p_journal_type:  params.journal_type,
    p_notes:         params.notes ?? null,
    p_lines: params.lines.map(l => ({
      gl_account_id:  l.gl_account_id,
      description:    l.description ?? '',
      debit:          l.debit,
      credit:         l.credit,
      department_id:  l.department_id ?? null,
      cost_center_id: l.cost_center_id ?? null,
    })),
  });
  if (error) throw new Error(error.message);
  const id = data as number;

  (async () => {
    try {
      const snap = await getJeCompactSnapshot(id);
      await logFinanceAction({
        entity_type:  'journal_entry',
        entity_id:    id,
        action:       'create',
        after:        snap as unknown as Record<string, unknown>,
        entry_number: snap.entry_number,
        description:  `Created journal entry ${snap.entry_number}`,
      });
    } catch { /* non-blocking */ }
  })();

  return id;
}

export async function createJeShell(params: {
  entry_date: string;
  description: string;
  journal_type: string;
  notes?: string;
}): Promise<number> {
  const { data, error } = await supabase.rpc('create_je_shell', {
    p_entry_date:   params.entry_date,
    p_description:  params.description,
    p_journal_type: params.journal_type,
    p_notes:        params.notes ?? null,
  });
  if (error) throw new Error(error.message);
  const id = data as number;

  logFinanceAction({
    entity_type: 'journal_entry',
    entity_id:   id,
    action:      'create',
    after: { entry_date: params.entry_date, description: params.description, journal_type: params.journal_type, notes: params.notes ?? null },
    description: `Created draft journal entry (header only)`,
  }).catch(() => {});

  return id;
}

export async function updateJeDraft(params: {
  entry_id: number;
  entry_date: string;
  description: string;
  journal_type: string;
  notes?: string;
  lines: Omit<JournalEntryLine, 'id' | 'journal_entry_id' | 'line_no'>[];
}): Promise<void> {
  // Fetch before-state for diff (blocking — must happen before the update)
  let beforeSnap: Awaited<ReturnType<typeof getJeCompactSnapshot>> | null = null;
  try { beforeSnap = await getJeCompactSnapshot(params.entry_id); } catch { /* non-blocking */ }

  const { error } = await supabase.rpc('update_je_draft', {
    p_entry_id:     params.entry_id,
    p_entry_date:   params.entry_date,
    p_description:  params.description,
    p_journal_type: params.journal_type,
    p_notes:        params.notes ?? null,
    p_lines: params.lines.map(l => ({
      gl_account_id:  l.gl_account_id || null,
      description:    l.description ?? '',
      debit:          l.debit,
      credit:         l.credit,
      department_id:  l.department_id ?? null,
      cost_center_id: l.cost_center_id ?? null,
    })),
  });
  if (error) throw new Error(error.message);

  (async () => {
    try {
      const afterSnap = await getJeCompactSnapshot(params.entry_id);
      const headerKeys = ['entry_date', 'description', 'journal_type', 'notes'];
      await logFinanceAction({
        entity_type:  'journal_entry',
        entity_id:    params.entry_id,
        action:       'edit',
        before:       beforeSnap as unknown as Record<string, unknown>,
        after:        afterSnap  as unknown as Record<string, unknown>,
        diff: beforeSnap
          ? computeDiff(pick(beforeSnap as any, headerKeys), pick(afterSnap as any, headerKeys))
          : null,
        entry_number: afterSnap.entry_number,
        description:  `Edited journal entry ${afterSnap.entry_number}`,
      });
    } catch { /* non-blocking */ }
  })();
}

export async function updateJePosted(params: {
  entry_id: number;
  entry_date: string;
  description: string;
  journal_type: string;
  notes?: string;
  lines: Omit<JournalEntryLine, 'id' | 'journal_entry_id' | 'line_no'>[];
}): Promise<void> {
  let beforeSnap: Awaited<ReturnType<typeof getJeCompactSnapshot>> | null = null;
  try { beforeSnap = await getJeCompactSnapshot(params.entry_id); } catch { /* non-blocking */ }

  const { error } = await supabase.rpc('update_je_posted', {
    p_entry_id:     params.entry_id,
    p_entry_date:   params.entry_date,
    p_description:  params.description,
    p_journal_type: params.journal_type,
    p_notes:        params.notes ?? null,
    p_lines: params.lines.map(l => ({
      gl_account_id:  l.gl_account_id || null,
      description:    l.description ?? '',
      debit:          l.debit,
      credit:         l.credit,
      department_id:  l.department_id ?? null,
      cost_center_id: l.cost_center_id ?? null,
    })),
  });
  if (error) throw new Error(error.message);

  (async () => {
    try {
      const afterSnap = await getJeCompactSnapshot(params.entry_id);
      const headerKeys = ['entry_date', 'description', 'journal_type', 'notes'];
      await logFinanceAction({
        entity_type:  'journal_entry',
        entity_id:    params.entry_id,
        action:       'edit',
        before:       beforeSnap as unknown as Record<string, unknown>,
        after:        afterSnap  as unknown as Record<string, unknown>,
        diff: beforeSnap
          ? computeDiff(pick(beforeSnap as any, headerKeys), pick(afterSnap as any, headerKeys))
          : null,
        entry_number: afterSnap.entry_number,
        description:  `Edited posted entry ${afterSnap.entry_number}`,
      });
    } catch { /* non-blocking */ }
  })();
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
  let entryNumber = '';
  try { entryNumber = (await getJournalEntry(id)).entry_number ?? ''; } catch { /* non-blocking */ }

  const { error } = await supabase.rpc('post_journal_entry', { p_entry_id: id });
  if (error) throw new Error(error.message);

  logFinanceAction({
    entity_type:  'journal_entry',
    entity_id:    id,
    action:       'post',
    after:        { status: 'posted' },
    entry_number: entryNumber,
    description:  `Posted journal entry ${entryNumber}`,
  }).catch(() => {});
}

export async function reverseJournalEntry(id: number, reason?: string): Promise<number> {
  let entryNumber = '';
  try { entryNumber = (await getJournalEntry(id)).entry_number ?? ''; } catch { /* non-blocking */ }

  const { data, error } = await supabase.rpc('reverse_journal_entry', {
    p_entry_id: id,
    p_reason:   reason ?? null,
  });
  if (error) throw new Error(error.message);
  const newId = data as number;

  logFinanceAction({
    entity_type:  'journal_entry',
    entity_id:    id,
    action:       'reverse',
    after:        { reversed_by_entry_id: newId, reason: reason ?? null },
    entry_number: entryNumber,
    description:  `Reversed journal entry ${entryNumber}${reason ? ` — ${reason}` : ''}`,
  }).catch(() => {});

  return newId;
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
    p_name:        params.name,
    p_start_date:  params.start_date,
    p_end_date:    params.end_date,
    p_fiscal_year: params.fiscal_year,
  });
  if (error) throw new Error(error.message);
  const id = data as number;

  logFinanceAction({
    entity_type:  'accounting_period',
    entity_id:    id,
    action:       'create',
    after:        { name: params.name, start_date: params.start_date, end_date: params.end_date, fiscal_year: params.fiscal_year },
    entry_number: params.name,
    description:  `Created accounting period "${params.name}"`,
  }).catch(() => {});

  return id;
}

export async function openAccountingPeriod(id: number): Promise<void> {
  let periodName = '';
  try {
    const { data } = await supabase.from('accounting_period').select('name').eq('id', id).single();
    periodName = data?.name ?? '';
  } catch { /* non-blocking */ }

  const { error } = await supabase.rpc('open_accounting_period', { p_period_id: id });
  if (error) throw new Error(error.message);

  logFinanceAction({
    entity_type:  'accounting_period',
    entity_id:    id,
    action:       'open',
    after:        { status: 'open' },
    entry_number: periodName,
    description:  `Opened accounting period "${periodName}"`,
  }).catch(() => {});
}

export async function closeAccountingPeriod(id: number): Promise<void> {
  let periodName = '';
  try {
    const { data } = await supabase.from('accounting_period').select('name').eq('id', id).single();
    periodName = data?.name ?? '';
  } catch { /* non-blocking */ }

  const { error } = await supabase.rpc('close_accounting_period', { p_period_id: id });
  if (error) throw new Error(error.message);

  logFinanceAction({
    entity_type:  'accounting_period',
    entity_id:    id,
    action:       'close',
    after:        { status: 'closed' },
    entry_number: periodName,
    description:  `Closed accounting period "${periodName}"`,
  }).catch(() => {});
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
  if (recentRes.error)   throw new Error(recentRes.error.message);

  const accounts = accountsRes.data ?? [];
  const totalAssets      = accounts.filter(a => a.account_type === 'asset'     && a.is_postable).reduce((s, a) => s + Number(a.balance ?? 0), 0);
  const totalLiabilities = accounts.filter(a => a.account_type === 'liability' && a.is_postable).reduce((s, a) => s + Number(a.balance ?? 0), 0);
  const totalEquity      = accounts.filter(a => a.account_type === 'equity'    && a.is_postable).reduce((s, a) => s + Number(a.balance ?? 0), 0);
  const totalRevenue     = accounts.filter(a => a.account_type === 'revenue'   && a.is_postable).reduce((s, a) => s + Number(a.balance ?? 0), 0);
  const totalExpenses    = accounts.filter(a => a.account_type === 'expense'   && a.is_postable).reduce((s, a) => s + Number(a.balance ?? 0), 0);

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
    draftEntryCount: 0,
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
  const safe = base.replace(/[^\w\-.]/g, '_').replace(/_+/g, '_').slice(0, 80);
  return safe + ext;
}

export async function uploadAttachment(
  entryId: number,
  file: File,
): Promise<JournalEntryAttachment> {
  const ext  = file.name.split('.').pop() ?? '';
  const path = `${entryId}/${Date.now()}_${sanitizeFileName(file.name)}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) throw new Error(uploadError.message);

  const { data, error } = await supabase
    .from('journal_entry_attachment')
    .insert({
      journal_entry_id: entryId,
      file_name:        file.name,
      file_size:        file.size,
      storage_path:     path,
      mime_type:        file.type || `application/${ext}`,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  const attachment = data as JournalEntryAttachment;

  logFinanceAction({
    entity_type:  'attachment',
    entity_id:    attachment.id,
    action:       'create',
    after:        { file_name: file.name, file_size: file.size, journal_entry_id: entryId },
    entry_number: file.name,
    description:  `Uploaded attachment "${file.name}" to journal entry #${entryId}`,
  }).catch(() => {});

  return attachment;
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

  logFinanceAction({
    entity_type:  'attachment',
    entity_id:    attachment.id,
    action:       'delete',
    before:       { file_name: attachment.file_name, file_size: attachment.file_size, journal_entry_id: attachment.journal_entry_id },
    entry_number: attachment.file_name,
    description:  `Deleted attachment "${attachment.file_name}"`,
  }).catch(() => {});
}

export async function getAttachmentUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 3600);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

// ---------------------------------------------------------------
// Approval workflow
// ---------------------------------------------------------------

import type { ApprovalTier, UserProfile } from '../types';

export async function submitJournalEntry(id: number): Promise<void> {
  let entryNumber = '';
  try { entryNumber = (await getJournalEntry(id)).entry_number ?? ''; } catch { /* non-blocking */ }

  const { error } = await supabase.rpc('submit_journal_entry', { p_entry_id: id });
  if (error) throw new Error(error.message);

  logFinanceAction({
    entity_type:  'journal_entry',
    entity_id:    id,
    action:       'submit',
    after:        { status: 'pending_approval' },
    entry_number: entryNumber,
    description:  `Submitted journal entry ${entryNumber} for approval`,
  }).catch(() => {});
}

export async function approveJournalEntry(id: number): Promise<void> {
  let entryNumber = '';
  try { entryNumber = (await getJournalEntry(id)).entry_number ?? ''; } catch { /* non-blocking */ }

  const { error } = await supabase.rpc('approve_journal_entry', { p_entry_id: id });
  if (error) throw new Error(error.message);

  logFinanceAction({
    entity_type:  'journal_entry',
    entity_id:    id,
    action:       'approve',
    after:        { status: 'posted' },
    entry_number: entryNumber,
    description:  `Approved journal entry ${entryNumber}`,
  }).catch(() => {});
}

export async function rejectJournalEntry(id: number, reason: string): Promise<void> {
  let entryNumber = '';
  try { entryNumber = (await getJournalEntry(id)).entry_number ?? ''; } catch { /* non-blocking */ }

  const { error } = await supabase.rpc('reject_journal_entry', {
    p_entry_id: id,
    p_reason:   reason,
  });
  if (error) throw new Error(error.message);

  logFinanceAction({
    entity_type:  'journal_entry',
    entity_id:    id,
    action:       'reject',
    after:        { status: 'rejected', reason },
    entry_number: entryNumber,
    description:  `Rejected journal entry ${entryNumber} — ${reason}`,
  }).catch(() => {});
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
    period_name:  e.accounting_period?.name,
    total_debit:  undefined,
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

// ---------------------------------------------------------------
// Finance Audit Log (read)
// ---------------------------------------------------------------

export interface FinanceAuditLogEntry {
  id: number;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_auth_id: string | null;
  actor_name: string;
  changed_at: string;
  before_snapshot: Record<string, unknown> | null;
  after_snapshot: Record<string, unknown> | null;
  diff: Record<string, { before: unknown; after: unknown }> | null;
  entry_number: string | null;
  description: string | null;
}

export async function getFinanceAuditLog(params?: {
  entity_type?: string;
  entity_id?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<FinanceAuditLogEntry[]> {
  let query = supabase
    .from('finance_audit_log')
    .select('*')
    .order('changed_at', { ascending: false })
    .range(params?.offset ?? 0, (params?.offset ?? 0) + (params?.limit ?? 100) - 1);

  if (params?.entity_type) query = query.eq('entity_type', params.entity_type);
  if (params?.entity_id)   query = query.eq('entity_id',   params.entity_id);

  // Search across description (contains account codes, file names, period names)
  // and entry_number (account code for COA, JE number for JEs, period name, file name)
  if (params?.search) {
    const q = params.search.trim();
    query = query.or(
      `description.ilike.%${q}%,entry_number.ilike.%${q}%`
    );
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data as FinanceAuditLogEntry[];
}

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Plus, X, Loader2, Pencil, ChevronDown, ChevronRight } from 'lucide-react';
import { Card, Badge } from '../components/ui/Cards';
import { cn, formatCurrency } from '../lib/utils';
import { GlAccount } from '../types';
import { getAccounts, createAccount, updateAccount } from '../services/api';
import { usePermissions } from '../contexts/PermissionContext';

const ACCOUNT_TYPES: GlAccount['account_type'][] = ['asset', 'liability', 'equity', 'revenue', 'expense'];

const TYPE_COLORS: Record<string, string> = {
  asset:     'bg-blue-50 border-blue-200 text-blue-800',
  liability: 'bg-amber-50 border-amber-200 text-amber-800',
  equity:    'bg-purple-50 border-purple-200 text-purple-800',
  revenue:   'bg-emerald-50 border-emerald-200 text-emerald-800',
  expense:   'bg-rose-50 border-rose-200 text-rose-800',
};

// ---------------------------------------------------------------
// Account form modal (shared by Create and Edit)
// ---------------------------------------------------------------

function AccountModal({
  title,
  initial,
  allAccounts,
  onClose,
  onSave,
}: {
  title: string;
  initial: Partial<GlAccount> & { account_type: GlAccount['account_type'] };
  allAccounts: GlAccount[];
  onClose: () => void;
  onSave: (data: Omit<GlAccount, 'id' | 'balance' | 'total_debit' | 'total_credit' | 'children'>) => Promise<void>;
}) {
  const { t } = useTranslation('finance');
  const [form, setForm] = useState({
    account_code: initial.account_code ?? '',
    name: initial.name ?? '',
    account_type: initial.account_type,
    parent_id: initial.parent_id != null ? String(initial.parent_id) : '',
    is_postable: initial.is_postable ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Parent candidates: all accounts of the same type, excluding self
  const parentOptions = allAccounts.filter(
    a => a.account_type === form.account_type && a.id !== initial.id,
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.account_code.trim() || !form.name.trim()) {
      setError(t('chartOfAccounts.errorRequired'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({
        account_code: form.account_code.trim(),
        name: form.name.trim(),
        account_type: form.account_type,
        parent_id: form.parent_id === '' ? null : Number(form.parent_id),
        is_postable: form.is_postable,
        is_active: true,
      });
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
        <div className="flex justify-between items-center mb-5">
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('chartOfAccounts.accountCode')}</label>
              <input
                type="text"
                placeholder={t('chartOfAccounts.accountCodePlaceholder')}
                value={form.account_code}
                onChange={e => setForm({ ...form, account_code: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('chartOfAccounts.type')}</label>
              <select
                value={form.account_type}
                onChange={e => setForm({ ...form, account_type: e.target.value as GlAccount['account_type'], parent_id: '' })}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {ACCOUNT_TYPES.map(opt => (
                  <option key={opt} value={opt}>{t(`chartOfAccounts.typeLabels.${opt}`)}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('chartOfAccounts.accountName')}</label>
            <input
              type="text"
              placeholder={t('chartOfAccounts.accountNamePlaceholder')}
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              {t('chartOfAccounts.parentAccount')} <span className="normal-case font-normal text-slate-400">{t('chartOfAccounts.optional')}</span>
            </label>
            <select
              value={form.parent_id}
              onChange={e => setForm({ ...form, parent_id: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{t('chartOfAccounts.noneTopLevel')}</option>
              {parentOptions.map(a => (
                <option key={a.id} value={a.id}>
                  {a.account_code} · {a.name}
                </option>
              ))}
            </select>
            {parentOptions.length === 0 && (
              <p className="text-[11px] text-slate-400">{t('chartOfAccounts.noOtherAccounts', { type: t(`chartOfAccounts.typeLabels.${form.account_type}`) })}</p>
            )}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <input
              type="checkbox"
              id="is_postable_modal"
              checked={form.is_postable}
              onChange={e => setForm({ ...form, is_postable: e.target.checked })}
              className="rounded border-slate-300 accent-blue-600"
            />
            <label htmlFor="is_postable_modal" className="text-sm text-slate-700">
              {t('chartOfAccounts.postableHelp')}
            </label>
          </div>

          {error && <p className="text-sm text-rose-600 bg-rose-50 px-3 py-2 rounded-lg">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm font-bold border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              {t('chartOfAccounts.cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-bold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {saving ? t('chartOfAccounts.saving') : t('chartOfAccounts.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Single account row (recursive for children)
// ---------------------------------------------------------------

interface AccountRowProps {
  account: GlAccount;
  depth: number;
  onEdit: (a: GlAccount) => void;
  canEdit: boolean;
}

function AccountRow({ account, depth, onEdit, canEdit }: AccountRowProps) {
  const { t } = useTranslation('finance');
  const [open, setOpen] = useState(true);
  const hasChildren = (account.children?.length ?? 0) > 0;

  return (
    <>
      <tr className="group border-t border-slate-100 hover:bg-slate-50/60 transition-colors">
        <td className="px-5 py-3">
          <div className="flex items-center" style={{ paddingLeft: `${depth * 20}px` }}>
            {hasChildren ? (
              <button
                onClick={() => setOpen(!open)}
                className="mr-2 text-slate-400 hover:text-slate-600 flex-shrink-0"
              >
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            ) : (
              <span className="mr-2 w-[14px] flex-shrink-0" />
            )}
            <span className="font-mono text-xs text-slate-500 tracking-wider">{account.account_code}</span>
          </div>
        </td>
        <td className="px-5 py-3">
          <span className={cn('text-sm', hasChildren ? 'font-semibold text-slate-800' : 'font-medium text-slate-700')}>
            {account.name}
          </span>
        </td>
        <td className="px-5 py-3">
          <Badge type={account.is_postable ? 'info' : 'neutral'}>
            {account.is_postable ? t('chartOfAccounts.postable') : t('chartOfAccounts.rollUp')}
          </Badge>
        </td>
        <td className="px-5 py-3 text-right">
          <span className="font-mono text-sm text-slate-700">{formatCurrency(account.balance ?? 0)}</span>
        </td>
        <td className="px-5 py-3 text-right">
          {canEdit && (
            <button
              onClick={() => onEdit(account)}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-blue-600 p-1 rounded"
              title={t('chartOfAccounts.editAccount')}
            >
              <Pencil size={14} />
            </button>
          )}
        </td>
      </tr>
      {open && account.children?.map(child => (
        <AccountRow key={child.id} account={child} depth={depth + 1} onEdit={onEdit} canEdit={canEdit} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------
// Type section (collapsible group)
// ---------------------------------------------------------------

function TypeSection({
  type,
  accounts,
  onEdit,
  canEdit,
}: {
  type: GlAccount['account_type'];
  accounts: GlAccount[];
  onEdit: (a: GlAccount) => void;
  canEdit: boolean;
}) {
  const { t } = useTranslation('finance');
  const [open, setOpen] = useState(true);
  const total = accounts.reduce((s, a) => s + (a.balance ?? 0), 0);

  if (accounts.length === 0) return null;

  // Build tree within this type
  const map = new Map<number, GlAccount>();
  accounts.forEach(a => map.set(a.id, { ...a, children: [] }));
  const roots: GlAccount[] = [];
  map.forEach(node => {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children!.push(node);
    } else {
      roots.push(node);
    }
  });

  return (
    <>
      {/* Section header */}
      <tr
        className={cn('cursor-pointer select-none', TYPE_COLORS[type])}
        onClick={() => setOpen(!open)}
      >
        <td colSpan={3} className="px-5 py-3">
          <div className="flex items-center gap-2">
            {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            <span className="text-xs font-bold uppercase tracking-widest">{t(`chartOfAccounts.typeLabels.${type}`)}</span>
            <span className="text-xs opacity-60">{t('chartOfAccounts.accountCount', { count: accounts.length })}</span>
          </div>
        </td>
        <td className="px-5 py-3 text-right">
          <span className="font-mono text-sm font-bold">{formatCurrency(total)}</span>
        </td>
        <td className="px-5 py-3" />
      </tr>

      {/* Account rows */}
      {open && roots.map(acc => (
        <AccountRow key={acc.id} account={acc} depth={0} onEdit={onEdit} canEdit={canEdit} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------
// Main page
// ---------------------------------------------------------------

export default function ChartOfAccounts() {
  const { t } = useTranslation('finance');
  const { can } = usePermissions();
  const canCreate = can('finance', 'chart_of_accounts', 'create');
  const canEdit   = can('finance', 'chart_of_accounts', 'edit');
  const [allAccounts, setAllAccounts] = useState<GlAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<GlAccount | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAccounts();
      setAllAccounts(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = allAccounts.filter(a => {
    if (typeFilter && a.account_type !== typeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return a.account_code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q);
    }
    return true;
  });

  const byType = (type: GlAccount['account_type']) =>
    filtered.filter(a => a.account_type === type);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">{t('chartOfAccounts.title')}</h2>
          <p className="text-xs text-slate-500 mt-1 uppercase font-bold tracking-wider">
            {t('chartOfAccounts.subtitle', { count: allAccounts.length })}
          </p>
        </div>
        {canCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 text-xs font-bold bg-blue-600 text-white rounded-lg shadow hover:bg-blue-700 transition-colors uppercase tracking-wide flex items-center gap-2"
          >
            <Plus size={14} /> {t('chartOfAccounts.createAccount')}
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-4 items-center bg-white p-4 border border-slate-200 rounded-xl">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder={t('chartOfAccounts.searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-600"
        >
          <option value="">{t('chartOfAccounts.allTypes')}</option>
          {ACCOUNT_TYPES.map(opt => <option key={opt} value={opt}>{t(`chartOfAccounts.typeLabels.${opt}`)}</option>)}
        </select>
      </div>

      {/* Table */}
      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-400 gap-3">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm font-medium">{t('chartOfAccounts.loading')}</span>
          </div>
        ) : allAccounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
            <p className="text-sm">{t('chartOfAccounts.empty')}</p>
            {canCreate && (
              <button onClick={() => setShowCreate(true)} className="text-sm font-bold text-blue-600 hover:underline">
                {t('chartOfAccounts.createFirst')}
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-200">
                  <th className="px-5 py-3 w-40">{t('chartOfAccounts.colCode')}</th>
                  <th className="px-5 py-3">{t('chartOfAccounts.colName')}</th>
                  <th className="px-5 py-3 w-28">{t('chartOfAccounts.colStatus')}</th>
                  <th className="px-5 py-3 text-right w-36">{t('chartOfAccounts.colBalance')}</th>
                  <th className="px-5 py-3 w-12" />
                </tr>
              </thead>
              <tbody>
                {ACCOUNT_TYPES.map(type => (
                  <TypeSection
                    key={type}
                    type={type}
                    accounts={byType(type)}
                    onEdit={setEditing}
                    canEdit={canEdit}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create modal */}
      {showCreate && canCreate && (
        <AccountModal
          title={t('chartOfAccounts.createAccount')}
          initial={{ account_type: 'asset', is_postable: true }}
          allAccounts={allAccounts}
          onClose={() => setShowCreate(false)}
          onSave={async data => {
            await createAccount(data);
            setShowCreate(false);
            load();
          }}
        />
      )}

      {/* Edit modal */}
      {editing && canEdit && (
        <AccountModal
          title={t('chartOfAccounts.editTitle', { code: editing.account_code, name: editing.name })}
          initial={editing}
          allAccounts={allAccounts}
          onClose={() => setEditing(null)}
          onSave={async data => {
            await updateAccount(editing.id, data);
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

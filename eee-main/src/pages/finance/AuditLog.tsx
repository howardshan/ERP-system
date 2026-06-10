import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  ChevronRight, ChevronDown, Loader2, ShieldOff,
  RefreshCw, Filter, Search, X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getFinanceAuditLog, type FinanceAuditLogEntry } from '../../services/api';
import { usePermissions } from '../../contexts/PermissionContext';
import { cn } from '../../lib/utils';

// ---------------------------------------------------------------
// Constants
// ---------------------------------------------------------------

const ACTION_META: Record<string, { cls: string }> = {
  create:  { cls: 'bg-emerald-100 text-emerald-700' },
  edit:    { cls: 'bg-amber-100   text-amber-700'   },
  delete:  { cls: 'bg-red-100     text-red-700'     },
  post:    { cls: 'bg-blue-100    text-blue-700'    },
  submit:  { cls: 'bg-indigo-100  text-indigo-700'  },
  approve: { cls: 'bg-teal-100    text-teal-700'    },
  reject:  { cls: 'bg-rose-100    text-rose-700'    },
  reverse: { cls: 'bg-orange-100  text-orange-700'  },
  open:    { cls: 'bg-cyan-100    text-cyan-700'    },
  close:   { cls: 'bg-slate-100   text-slate-600'   },
};

const ENTITY_KEYS = ['journal_entry', 'chart_of_accounts', 'accounting_period', 'attachment'];

const FIELD_KEYS = [
  'entry_date', 'description', 'journal_type', 'notes', 'account_code',
  'name', 'account_type', 'is_postable', 'is_active', 'status', 'reason',
  'file_name', 'file_size', 'parent_id',
];

const ENTITY_TYPE_OPTION_VALUES = ['', 'journal_entry', 'chart_of_accounts', 'accounting_period', 'attachment'];

const PAGE_SIZE = 50;

// ---------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------

function fmtVal(val: unknown, t: (k: string) => string): string {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'boolean') return val ? t('auditLog.yes') : t('auditLog.no');
  if (typeof val === 'number') return val.toLocaleString();
  return String(val);
}

function fmtAmt(n: number | null | undefined): string {
  if (n == null || n === 0) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function relativeTime(iso: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return t('auditLog.secondsAgo', { count: s });
  const m = Math.floor(s / 60);
  if (m < 60)  return t('auditLog.minutesAgo', { count: m });
  const h = Math.floor(m / 60);
  if (h < 24)  return t('auditLog.hoursAgo', { count: h });
  const day = Math.floor(h / 24);
  return t('auditLog.daysAgo', { count: day });
}

// ---------------------------------------------------------------
// Lines comparison sub-component
// ---------------------------------------------------------------

function LinesComparison({ before, after }: { before: any[]; after: any[] }) {
  const { t } = useTranslation('finance');
  if (!before.length && !after.length) return null;

  const beforeByNo = new Map<number, any>(before.map(l => [l.line_no, l]));
  const afterByNo  = new Map<number, any>(after.map(l => [l.line_no, l]));
  const allNos = [...new Set([...before.map(l => l.line_no), ...after.map(l => l.line_no)])].sort((a, b) => a - b);

  const accountLabel = (l: any) =>
    l.account_code ? `${l.account_code} · ${l.account_name ?? ''}` : `#${l.gl_account_id ?? '?'}`;

  return (
    <div>
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">{t('auditLog.journalLines')}</p>
      <div className="grid grid-cols-2 gap-4">
        {/* Before */}
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">{t('auditLog.before')}</p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-slate-400 border-b border-slate-100">
                <th className="text-left font-bold pb-1 pr-2 w-6">#</th>
                <th className="text-left font-bold pb-1 pr-2">{t('auditLog.account')}</th>
                <th className="text-right font-bold pb-1 pr-2 w-20">{t('auditLog.debit')}</th>
                <th className="text-right font-bold pb-1 w-20">{t('auditLog.credit')}</th>
              </tr>
            </thead>
            <tbody>
              {allNos.map(no => {
                const l = beforeByNo.get(no);
                if (!l) return (
                  <tr key={no} className="border-t border-slate-50">
                    <td className="py-1 pr-2 text-slate-300">{no}</td>
                    <td colSpan={3} className="py-1 text-slate-300 italic text-[10px]">{t('auditLog.removed')}</td>
                  </tr>
                );
                return (
                  <tr key={no} className="border-t border-slate-100">
                    <td className="py-1 pr-2 text-slate-400">{no}</td>
                    <td className="py-1 pr-2 text-slate-600 truncate max-w-[120px]">{accountLabel(l)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums text-slate-600">{fmtAmt(l.debit)}</td>
                    <td className="py-1 text-right tabular-nums text-slate-600">{fmtAmt(l.credit)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* After */}
        <div>
          <p className="text-[10px] font-bold text-red-400 uppercase tracking-wider mb-1.5">{t('auditLog.after')}</p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-slate-400 border-b border-slate-100">
                <th className="text-left font-bold pb-1 pr-2 w-6">#</th>
                <th className="text-left font-bold pb-1 pr-2">{t('auditLog.account')}</th>
                <th className="text-right font-bold pb-1 pr-2 w-20">{t('auditLog.debit')}</th>
                <th className="text-right font-bold pb-1 w-20">{t('auditLog.credit')}</th>
              </tr>
            </thead>
            <tbody>
              {allNos.map(no => {
                const l  = afterByNo.get(no);
                const bl = beforeByNo.get(no);
                if (!l) return (
                  <tr key={no} className="border-t border-slate-50">
                    <td className="py-1 pr-2 text-slate-300">{no}</td>
                    <td colSpan={3} className="py-1 text-slate-300 italic text-[10px]">{t('auditLog.removed')}</td>
                  </tr>
                );
                const isNew           = !bl;
                const accountChanged  = bl && (bl.account_code !== l.account_code || bl.gl_account_id !== l.gl_account_id);
                const debitChanged    = bl && String(bl.debit)  !== String(l.debit);
                const creditChanged   = bl && String(bl.credit) !== String(l.credit);
                return (
                  <tr key={no} className="border-t border-slate-100">
                    <td className="py-1 pr-2 text-slate-400">{no}</td>
                    <td className={cn('py-1 pr-2 truncate max-w-[120px]', (accountChanged || isNew) ? 'font-semibold text-red-600' : 'text-slate-600')}>
                      {accountLabel(l)}
                    </td>
                    <td className={cn('py-1 pr-2 text-right tabular-nums', (debitChanged || isNew) ? 'font-semibold text-red-600' : 'text-slate-600')}>
                      {fmtAmt(l.debit)}
                    </td>
                    <td className={cn('py-1 text-right tabular-nums', (creditChanged || isNew) ? 'font-semibold text-red-600' : 'text-slate-600')}>
                      {fmtAmt(l.credit)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Diff panel (expanded row content)
// ---------------------------------------------------------------

function DiffPanel({ log }: { log: FinanceAuditLogEntry }) {
  const { t } = useTranslation('finance');
  const { diff, before_snapshot: before, after_snapshot: after, action } = log;
  const hasDiff  = diff  && Object.keys(diff).length > 0;
  const hasLines = (before as any)?.lines?.length > 0 || (after as any)?.lines?.length > 0;

  const fieldLabel = (k: string) =>
    FIELD_KEYS.includes(k) ? t(`auditLog.field.${k}`) : k;

  if (!hasDiff && !hasLines && !after && !before) {
    return <p className="text-xs text-slate-400 py-2 px-4">{t('auditLog.noDetails')}</p>;
  }

  return (
    <div className="px-6 pb-5 pt-3 space-y-5 bg-slate-50 border-t border-slate-100">
      {/* Changed header fields */}
      {hasDiff && (
        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">{t('auditLog.changedFields')}</p>
          <table className="text-xs w-full max-w-2xl">
            <thead>
              <tr className="text-[10px] text-slate-400 border-b border-slate-200">
                <th className="text-left font-bold pb-1.5 pr-6 w-36">{t('auditLog.fieldHeader')}</th>
                <th className="text-left font-bold pb-1.5 pr-6">{t('auditLog.before')}</th>
                <th className="text-left font-bold pb-1.5">{t('auditLog.after')}</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(diff!).map(([key, { before: bv, after: av }]) => (
                <tr key={key} className="border-t border-slate-100">
                  <td className="py-1.5 pr-6 text-slate-500 font-medium">{fieldLabel(key)}</td>
                  <td className="py-1.5 pr-6 text-slate-400 line-through">{fmtVal(bv, t)}</td>
                  <td className="py-1.5 font-semibold text-red-600">{fmtVal(av, t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Lines comparison (journal entry edits) */}
      {hasLines && (
        <LinesComparison
          before={(before as any)?.lines ?? []}
          after={(after as any)?.lines ?? []}
        />
      )}

      {/* Create: show the created record's fields */}
      {action === 'create' && after && !hasDiff && (
        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">{t('auditLog.createdRecord')}</p>
          <table className="text-xs w-full max-w-xl">
            <tbody>
              {Object.entries(after)
                .filter(([k]) => k !== 'lines' && k !== 'entry_number')
                .map(([k, v]) => (
                  <tr key={k} className="border-t border-slate-100">
                    <td className="py-1.5 pr-6 text-slate-500 font-medium w-36">{fieldLabel(k)}</td>
                    <td className="py-1.5 text-slate-700">{fmtVal(v, t)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {/* Lines for a newly created JE */}
          {(after as any)?.lines?.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">{t('auditLog.lines')}</p>
              <table className="text-xs w-full max-w-2xl">
                <thead>
                  <tr className="text-[10px] text-slate-400 border-b border-slate-100">
                    <th className="text-left font-bold pb-1 pr-2 w-6">#</th>
                    <th className="text-left font-bold pb-1 pr-2">{t('auditLog.account')}</th>
                    <th className="text-right font-bold pb-1 pr-2 w-24">{t('auditLog.debit')}</th>
                    <th className="text-right font-bold pb-1 w-24">{t('auditLog.credit')}</th>
                  </tr>
                </thead>
                <tbody>
                  {((after as any).lines as any[]).map((l: any) => (
                    <tr key={l.line_no} className="border-t border-slate-100">
                      <td className="py-1 pr-2 text-slate-400">{l.line_no}</td>
                      <td className="py-1 pr-2 text-slate-700">
                        {l.account_code ? `${l.account_code} · ${l.account_name ?? ''}` : `#${l.gl_account_id ?? '?'}`}
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums text-slate-700">{fmtAmt(l.debit)}</td>
                      <td className="py-1 text-right tabular-nums text-slate-700">{fmtAmt(l.credit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Delete: show the removed record's fields */}
      {action === 'delete' && before && (
        <div>
          <p className="text-[10px] font-bold text-red-500 uppercase tracking-wider mb-2">{t('auditLog.deletedRecord')}</p>
          <table className="text-xs w-full max-w-xl">
            <tbody>
              {Object.entries(before).map(([k, v]) => (
                <tr key={k} className="border-t border-slate-100">
                  <td className="py-1.5 pr-6 text-slate-500 font-medium w-36">{fieldLabel(k)}</td>
                  <td className="py-1.5 text-red-600 line-through">{fmtVal(v, t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Status-change actions: just show the after state */}
      {['post', 'submit', 'approve', 'reject', 'reverse', 'open', 'close'].includes(action) && after && !hasDiff && (
        <div className="text-xs text-slate-500 space-y-1">
          {Object.entries(after).map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <span className="font-medium text-slate-400 w-32">{fieldLabel(k)}</span>
              <span className="text-slate-700">{fmtVal(v, t)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// Main page
// ---------------------------------------------------------------

export default function AuditLog() {
  const { t } = useTranslation('finance');
  const { can } = usePermissions();
  const canView = can('finance', 'audit_log', 'view');

  const [logs, setLogs]                 = useState<FinanceAuditLogEntry[]>([]);
  const [loading, setLoading]           = useState(false);
  const [offset, setOffset]             = useState(0);
  const [hasMore, setHasMore]           = useState(true);
  const [expanded, setExpanded]         = useState<Set<number>>(new Set());
  const [entityFilter, setEntityFilter] = useState('');
  const [searchInput, setSearchInput]   = useState('');
  const [search, setSearch]             = useState('');          // debounced
  const debounceRef                     = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleSearchChange(val: string) {
    setSearchInput(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(val.trim()), 350);
  }

  function clearSearch() {
    setSearchInput('');
    setSearch('');
  }

  const load = useCallback(async (reset = false) => {
    setLoading(true);
    const off = reset ? 0 : offset;
    try {
      const rows = await getFinanceAuditLog({
        entity_type: entityFilter || undefined,
        search:      search || undefined,
        limit:       PAGE_SIZE,
        offset:      off,
      });
      setLogs(prev => reset ? rows : [...prev, ...rows]);
      setHasMore(rows.length === PAGE_SIZE);
      if (reset) setOffset(PAGE_SIZE);
      else       setOffset(off + PAGE_SIZE);
    } catch { /* show empty */ }
    setLoading(false);
  }, [entityFilter, search, offset]);

  // Reload whenever filter or debounced search changes
  useEffect(() => {
    setOffset(0);
    setLogs([]);
    setExpanded(new Set());
    load(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityFilter, search]);

  function toggle(id: number) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4 text-slate-400">
        <ShieldOff size={36} strokeWidth={1.5} />
        <p className="font-bold text-sm">{t('auditLog.noPermission')}</p>
        <p className="text-xs">{t('auditLog.askAdminPrefix')}<code className="bg-slate-100 px-1 rounded">finance › audit_log › view</code>{t('auditLog.askAdminSuffix')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{t('auditLog.finance')}</p>
          <h1 className="text-2xl font-bold text-slate-900">{t('auditLog.title')}</h1>
        </div>
        <button
          onClick={() => load(true)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-600 text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          {t('auditLog.refresh')}
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Filter size={13} className="text-slate-400 shrink-0" />
        <select
          value={entityFilter}
          onChange={e => setEntityFilter(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700"
        >
          {ENTITY_TYPE_OPTION_VALUES.map(v => (
            <option key={v} value={v}>{t(`auditLog.entityOption.${v || 'all'}`)}</option>
          ))}
        </select>

        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchInput}
            onChange={e => handleSearchChange(e.target.value)}
            placeholder={
              entityFilter === 'chart_of_accounts' ? t('auditLog.searchAccounts') :
              entityFilter === 'journal_entry'      ? t('auditLog.searchJournalEntry') :
              entityFilter === 'accounting_period'  ? t('auditLog.searchPeriod') :
              entityFilter === 'attachment'         ? t('auditLog.searchAttachment') :
              t('auditLog.searchAll')
            }
            className="text-xs border border-slate-200 rounded-lg pl-8 pr-8 py-1.5 w-72 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 placeholder:text-slate-400"
          />
          {searchInput && (
            <button
              onClick={clearSearch}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {search && (
          <span className="text-[10px] text-slate-400 font-medium">
            {loading ? t('auditLog.searching') : t('auditLog.resultsFor', { query: search })}
          </span>
        )}
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {['time', 'who', 'action', 'entity', 'reference', 'summary', 'expand'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">{h === 'expand' ? '' : t(`auditLog.col.${h}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {logs.length === 0 && !loading && (
              <tr>
                <td colSpan={7} className="px-4 py-16 text-center text-slate-400 text-sm">
                  {t('auditLog.empty')}
                </td>
              </tr>
            )}
            {logs.map(log => {
              const isOpen = expanded.has(log.id);
              const actionMeta = ACTION_META[log.action] ?? { cls: 'bg-slate-100 text-slate-600' };
              const actionLabel = ACTION_META[log.action] ? t(`auditLog.action.${log.action}`) : log.action;
              return (
                <React.Fragment key={log.id}>
                  <tr
                    onClick={() => toggle(log.id)}
                    className="hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    {/* Time */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-xs text-slate-700 font-medium">{relativeTime(log.changed_at, t)}</div>
                      <div className="text-[10px] text-slate-400">{fmtTime(log.changed_at)}</div>
                    </td>

                    {/* Who */}
                    <td className="px-4 py-3 text-sm text-slate-700 whitespace-nowrap font-medium">
                      {log.actor_name}
                    </td>

                    {/* Action badge */}
                    <td className="px-4 py-3">
                      <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap', actionMeta.cls)}>
                        {actionLabel}
                      </span>
                    </td>

                    {/* Entity */}
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                      {ENTITY_KEYS.includes(log.entity_type) ? t(`auditLog.entity.${log.entity_type}`) : log.entity_type}
                    </td>

                    {/* Reference — searchable code + stable DB ID */}
                    <td className="px-4 py-3">
                      {log.entry_number && (
                        <div className="text-xs font-mono font-semibold text-slate-800">{log.entry_number}</div>
                      )}
                      <div className="text-[10px] font-mono text-slate-400">{t('auditLog.idPrefix')}{log.entity_id}</div>
                    </td>

                    {/* Summary */}
                    <td className="px-4 py-3 text-xs text-slate-500 max-w-xs truncate">
                      {log.description ?? '—'}
                    </td>

                    {/* Expand toggle */}
                    <td className="px-4 py-3 text-slate-400">
                      {isOpen
                        ? <ChevronDown size={14} />
                        : <ChevronRight size={14} />}
                    </td>
                  </tr>

                  {/* Expanded diff panel */}
                  {isOpen && (
                    <tr>
                      <td colSpan={7} className="p-0">
                        <DiffPanel log={log} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>

        {/* Load more / spinner */}
        {(loading || hasMore) && (
          <div className="px-4 py-4 border-t border-slate-100 flex justify-center">
            {loading ? (
              <Loader2 size={16} className="animate-spin text-slate-400" />
            ) : (
              <button
                onClick={() => load(false)}
                className="text-xs font-bold text-blue-600 hover:text-blue-700"
              >
                {t('auditLog.loadMore')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

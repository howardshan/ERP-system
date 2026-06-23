import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  ChevronRight, ChevronDown, Loader2, ShieldOff, RefreshCw, Filter, Search, X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getProductAuditLog, type ProductAuditLogEntry } from '../../services/qcApi';
import { usePermissions } from '../../contexts/PermissionContext';
import { cn } from '../../lib/utils';

const ACTION_META: Record<string, { cls: string }> = {
  create: { cls: 'bg-emerald-100 text-emerald-700' },
  edit:   { cls: 'bg-amber-100   text-amber-700'   },
  delete: { cls: 'bg-red-100     text-red-700'     },
  import: { cls: 'bg-blue-100    text-blue-700'    },
};

const ENTITY_KEYS = ['product', 'test_type', 'product_import'];
const ENTITY_OPTION_VALUES = ['', 'product', 'test_type', 'product_import'];
const FIELD_KEYS = [
  'code', 'name', 'standard_drying_minutes', 'sample_every_n_carts',
  'cart_units', 'unit', 'description', 'is_active',
];
const PAGE_SIZE = 50;

function fmtVal(val: unknown, t: (k: string) => string): string {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'boolean') return val ? t('productAuditLog.yes') : t('productAuditLog.no');
  if (typeof val === 'number') return val.toLocaleString();
  return String(val);
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function relativeTime(iso: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return t('productAuditLog.secondsAgo', { count: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t('productAuditLog.minutesAgo', { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('productAuditLog.hoursAgo', { count: h });
  return t('productAuditLog.daysAgo', { count: Math.floor(h / 24) });
}

function DiffPanel({ log }: { log: ProductAuditLogEntry }) {
  const { t } = useTranslation('qc');
  const { diff, before_snapshot: before, after_snapshot: after, action } = log;
  const hasDiff = diff && Object.keys(diff).length > 0;
  const fieldLabel = (k: string) => (FIELD_KEYS.includes(k) ? t(`productAuditLog.field.${k}`) : k);

  if (!hasDiff && !after && !before) {
    return <p className="text-xs text-slate-400 py-2 px-4">{t('productAuditLog.noDetails')}</p>;
  }

  return (
    <div className="px-6 pb-5 pt-3 space-y-4 bg-slate-50 border-t border-slate-100">
      {hasDiff && (
        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">{t('productAuditLog.changedFields')}</p>
          <table className="text-xs w-full max-w-2xl">
            <thead>
              <tr className="text-[10px] text-slate-400 border-b border-slate-200">
                <th className="text-left font-bold pb-1.5 pr-6 w-44">{t('productAuditLog.fieldHeader')}</th>
                <th className="text-left font-bold pb-1.5 pr-6">{t('productAuditLog.before')}</th>
                <th className="text-left font-bold pb-1.5">{t('productAuditLog.after')}</th>
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

      {action === 'create' && after && !hasDiff && (
        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">{t('productAuditLog.createdRecord')}</p>
          <table className="text-xs w-full max-w-xl">
            <tbody>
              {Object.entries(after).map(([k, v]) => (
                <tr key={k} className="border-t border-slate-100">
                  <td className="py-1.5 pr-6 text-slate-500 font-medium w-44">{fieldLabel(k)}</td>
                  <td className="py-1.5 text-slate-700">{fmtVal(v, t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {action === 'import' && after && (() => {
        const items = Array.isArray((after as { items?: unknown }).items)
          ? ((after as { items: { code: string; name: string; action: string }[] }).items)
          : [];
        return (
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">{t('productAuditLog.importItems')}</p>
            {items.length === 0 ? (
              <p className="text-xs text-slate-400">{t('productAuditLog.importNoItemDetail')}</p>
            ) : (
              <div className="max-h-72 overflow-auto">
                <table className="text-xs w-full max-w-2xl">
                  <thead>
                    <tr className="text-[10px] text-slate-400 border-b border-slate-200">
                      <th className="text-left font-bold pb-1.5 pr-6 w-24">{t('productAuditLog.col.action')}</th>
                      <th className="text-left font-bold pb-1.5 pr-6 w-32">{t('productAuditLog.field.code')}</th>
                      <th className="text-left font-bold pb-1.5">{t('productAuditLog.field.name')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="py-1 pr-6">
                          <span className={cn(
                            'px-1.5 py-0.5 rounded text-[10px] font-bold',
                            it.action === 'create' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700',
                          )}>
                            {it.action === 'create' ? t('productAuditLog.action.create') : t('productAuditLog.action.update')}
                          </span>
                        </td>
                        <td className="py-1 pr-6 font-mono text-slate-600">{it.code}</td>
                        <td className="py-1 text-slate-700">{it.name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })()}

      {action === 'delete' && before && (
        <div>
          <p className="text-[10px] font-bold text-red-500 uppercase tracking-wider mb-2">{t('productAuditLog.deletedRecord')}</p>
          <table className="text-xs w-full max-w-xl">
            <tbody>
              {Object.entries(before).map(([k, v]) => (
                <tr key={k} className="border-t border-slate-100">
                  <td className="py-1.5 pr-6 text-slate-500 font-medium w-44">{fieldLabel(k)}</td>
                  <td className="py-1.5 text-red-600 line-through">{fmtVal(v, t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ProductAuditLog() {
  const { t } = useTranslation('qc');
  const { can } = usePermissions();
  const canView = can('qc', 'products', 'view_log');

  const [logs, setLogs]                 = useState<ProductAuditLogEntry[]>([]);
  const [loading, setLoading]           = useState(false);
  const [offset, setOffset]             = useState(0);
  const [hasMore, setHasMore]           = useState(true);
  const [expanded, setExpanded]         = useState<Set<number>>(new Set());
  const [entityFilter, setEntityFilter] = useState('');
  const [searchInput, setSearchInput]   = useState('');
  const [search, setSearch]             = useState('');
  const debounceRef                     = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleSearchChange(val: string) {
    setSearchInput(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(val.trim()), 350);
  }

  const load = useCallback(async (reset = false) => {
    setLoading(true);
    const off = reset ? 0 : offset;
    try {
      const rows = await getProductAuditLog({
        entity_type: entityFilter || undefined,
        search:      search || undefined,
        limit:       PAGE_SIZE,
        offset:      off,
      });
      setLogs(prev => reset ? rows : [...prev, ...rows]);
      setHasMore(rows.length === PAGE_SIZE);
      setOffset(reset ? PAGE_SIZE : off + PAGE_SIZE);
    } catch { /* show empty */ }
    setLoading(false);
  }, [entityFilter, search, offset]);

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
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4 text-slate-400">
        <ShieldOff size={36} strokeWidth={1.5} />
        <p className="font-bold text-sm">{t('productAuditLog.noPermission')}</p>
        <p className="text-xs">{t('productAuditLog.askAdminPrefix')}<code className="bg-slate-100 px-1 rounded">qc › products › view_log</code>{t('productAuditLog.askAdminSuffix')}</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{t('productAuditLog.module')}</p>
          <h1 className="text-2xl font-bold text-slate-900">{t('productAuditLog.title')}</h1>
        </div>
        <button
          onClick={() => load(true)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-600 text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          {t('productAuditLog.refresh')}
        </button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Filter size={13} className="text-slate-400 shrink-0" />
        <select
          value={entityFilter}
          onChange={e => setEntityFilter(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700"
        >
          {ENTITY_OPTION_VALUES.map(v => (
            <option key={v} value={v}>{t(`productAuditLog.entityOption.${v || 'all'}`)}</option>
          ))}
        </select>

        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchInput}
            onChange={e => handleSearchChange(e.target.value)}
            placeholder={t('productAuditLog.searchPlaceholder')}
            className="text-xs border border-slate-200 rounded-lg pl-8 pr-8 py-1.5 w-72 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 placeholder:text-slate-400"
          />
          {searchInput && (
            <button
              onClick={() => { setSearchInput(''); setSearch(''); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {['time', 'who', 'action', 'entity', 'reference', 'summary', 'expand'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  {h === 'expand' ? '' : t(`productAuditLog.col.${h}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {logs.length === 0 && !loading && (
              <tr>
                <td colSpan={7} className="px-4 py-16 text-center text-slate-400 text-sm">{t('productAuditLog.empty')}</td>
              </tr>
            )}
            {logs.map(log => {
              const isOpen = expanded.has(log.id);
              const actionMeta = ACTION_META[log.action] ?? { cls: 'bg-slate-100 text-slate-600' };
              const actionLabel = ACTION_META[log.action] ? t(`productAuditLog.action.${log.action}`) : log.action;
              return (
                <React.Fragment key={log.id}>
                  <tr onClick={() => toggle(log.id)} className="hover:bg-slate-50 cursor-pointer transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-xs text-slate-700 font-medium">{relativeTime(log.changed_at, t)}</div>
                      <div className="text-[10px] text-slate-400">{fmtTime(log.changed_at)}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700 whitespace-nowrap font-medium">{log.actor_name}</td>
                    <td className="px-4 py-3">
                      <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap', actionMeta.cls)}>{actionLabel}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                      {ENTITY_KEYS.includes(log.entity_type) ? t(`productAuditLog.entity.${log.entity_type}`) : log.entity_type}
                    </td>
                    <td className="px-4 py-3">
                      {log.entry_number && <div className="text-xs font-mono font-semibold text-slate-800">{log.entry_number}</div>}
                      <div className="text-[10px] font-mono text-slate-400">{t('productAuditLog.idPrefix')}{log.entity_id}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 max-w-xs truncate">{log.description ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-400">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={7} className="p-0"><DiffPanel log={log} /></td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>

        {(loading || hasMore) && (
          <div className="px-4 py-4 border-t border-slate-100 flex justify-center">
            {loading
              ? <Loader2 size={16} className="animate-spin text-slate-400" />
              : <button onClick={() => load(false)} className="text-xs font-bold text-blue-600 hover:text-blue-700">{t('productAuditLog.loadMore')}</button>}
          </div>
        )}
      </div>
    </div>
  );
}

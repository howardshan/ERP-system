import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, ChevronRight, ChevronDown, Loader2, ShieldOff, RefreshCw, Filter, Search, X, ScrollText,
} from 'lucide-react';
import { getSystemLog, type SystemLogEntry } from '../../services/logsApi';
import { getUsers } from '../../services/authApi';
import type { ErpUser } from '../../types/auth';
import { usePermissions } from '../../contexts/PermissionContext';
import { cn } from '../../lib/utils';

interface Props { onHome: () => void }

// Source modules present in the unified view.
const MODULE_OPTIONS = ['finance', 'hr', 'qc', 'auth', 'production', 'notifications'];

const MODULE_BADGE: Record<string, string> = {
  finance:       'bg-blue-100 text-blue-700',
  hr:            'bg-rose-100 text-rose-700',
  qc:            'bg-emerald-100 text-emerald-700',
  auth:          'bg-slate-200 text-slate-700',
  production:    'bg-amber-100 text-amber-700',
  notifications: 'bg-violet-100 text-violet-700',
};

const ACTION_CLS: Record<string, string> = {
  create: 'text-emerald-700', edit: 'text-amber-700', edit_profile: 'text-amber-700',
  edit_permissions: 'text-indigo-700', delete: 'text-red-700', import: 'text-blue-700',
  login_success: 'text-emerald-700', logout: 'text-slate-500', activate: 'text-emerald-700',
  deactivate: 'text-red-700', reset_password: 'text-violet-700',
  post: 'text-blue-700', approve: 'text-teal-700', reject: 'text-rose-700',
  downtime: 'text-amber-700', sent: 'text-emerald-700', failed: 'text-red-700',
};

const PAGE_SIZE = 50;

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function relativeTime(iso: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return t('logs.secondsAgo', { count: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t('logs.minutesAgo', { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('logs.hoursAgo', { count: h });
  return t('logs.daysAgo', { count: Math.floor(h / 24) });
}

function DetailPanel({ log }: { log: SystemLogEntry }) {
  const { t } = useTranslation('logs');
  const hasDetail = log.detail && Object.keys(log.detail).some(k => log.detail![k] != null);
  if (!hasDetail) return <p className="text-xs text-slate-400 py-2 px-6">{t('logs.noDetails')}</p>;
  return (
    <div className="px-6 pb-5 pt-3 bg-slate-50 border-t border-slate-100">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">{t('logs.details')}</p>
      <pre className="text-[11px] text-slate-600 bg-white border border-slate-200 rounded-lg p-3 overflow-auto max-h-72 whitespace-pre-wrap break-words">
        {JSON.stringify(log.detail, null, 2)}
      </pre>
    </div>
  );
}

export default function LogsModule({ onHome }: Props) {
  const { t } = useTranslation('logs');
  const { can } = usePermissions();
  const canView = can('logs', 'entries', 'view');

  const [logs, setLogs]           = useState<SystemLogEntry[]>([]);
  const [users, setUsers]         = useState<ErpUser[]>([]);
  const [loading, setLoading]     = useState(false);
  const [offset, setOffset]       = useState(0);
  const [hasMore, setHasMore]     = useState(true);
  const [expanded, setExpanded]   = useState<Set<string>>(new Set());
  const [moduleFilter, setModuleFilter] = useState('');
  const [actorFilter, setActorFilter]   = useState('');
  const [fromDate, setFromDate]   = useState('');
  const [toDate, setToDate]       = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch]       = useState('');
  const debounceRef               = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { getUsers().then(setUsers).catch(() => {}); }, []);

  function handleSearchChange(val: string) {
    setSearchInput(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(val.trim()), 350);
  }

  const load = useCallback(async (reset = false) => {
    setLoading(true);
    const off = reset ? 0 : offset;
    try {
      const rows = await getSystemLog({
        module:        moduleFilter || undefined,
        actor_auth_id: actorFilter || undefined,
        from:          fromDate ? `${fromDate}T00:00:00` : undefined,
        to:            toDate ? `${toDate}T23:59:59.999` : undefined,
        search:        search || undefined,
        limit:         PAGE_SIZE,
        offset:        off,
      });
      setLogs(prev => reset ? rows : [...prev, ...rows]);
      setHasMore(rows.length === PAGE_SIZE);
      setOffset(reset ? PAGE_SIZE : off + PAGE_SIZE);
    } catch { /* show empty */ }
    setLoading(false);
  }, [moduleFilter, actorFilter, fromDate, toDate, search, offset]);

  useEffect(() => {
    setOffset(0);
    setLogs([]);
    setExpanded(new Set());
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleFilter, actorFilter, fromDate, toDate, search]);

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const hasFilters = moduleFilter !== '' || actorFilter !== '' || fromDate !== '' || toDate !== '' || search !== '';

  return (
    <div className="min-h-screen bg-[#faf8f5] flex flex-col">
      {/* Top bar */}
      <div className="h-12 bg-white border-b border-slate-200 flex items-center px-5 gap-3 shrink-0">
        <button onClick={onHome} className="text-slate-500 hover:text-slate-900 text-xs font-bold transition-colors flex items-center gap-1.5">
          <ArrowLeft size={14} /> {t('logs.allModules')}
        </button>
        <div className="w-px h-5 bg-slate-200" />
        <span className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
          <ScrollText size={14} /> {t('logs.title')}
        </span>
      </div>

      {!canView ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-400">
          <ShieldOff size={36} strokeWidth={1.5} />
          <p className="font-bold text-sm">{t('logs.noPermission')}</p>
          <p className="text-xs">{t('logs.askAdminPrefix')}<code className="bg-slate-100 px-1 rounded">logs › entries › view</code>{t('logs.askAdminSuffix')}</p>
        </div>
      ) : (
        <main className="flex-1 overflow-y-auto px-10 py-7 space-y-5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{t('logs.administration')}</p>
              <h1 className="text-2xl font-bold text-slate-900">{t('logs.pageTitle')}</h1>
              <p className="text-xs text-slate-500 mt-1">{t('logs.subtitle')}</p>
            </div>
            <button
              onClick={() => load(true)}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-600 text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> {t('logs.refresh')}
            </button>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <Filter size={14} className="text-slate-400 shrink-0" />
            <select
              value={actorFilter}
              onChange={e => setActorFilter(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 max-w-[14rem]"
            >
              <option value="">{t('logs.allUsers')}</option>
              {users.filter(u => u.auth_user_id).map(u => (
                <option key={u.id} value={u.auth_user_id!}>{u.full_name}</option>
              ))}
            </select>
            <select
              value={moduleFilter}
              onChange={e => setModuleFilter(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700"
            >
              <option value="">{t('logs.allModules2')}</option>
              {MODULE_OPTIONS.map(m => (
                <option key={m} value={m}>{t(`logs.module.${m}`)}</option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              {t('logs.from')}
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                     className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700" />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              {t('logs.to')}
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                     className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700" />
            </label>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={searchInput}
                onChange={e => handleSearchChange(e.target.value)}
                placeholder={t('logs.searchPlaceholder')}
                className="text-sm border border-slate-200 rounded-lg pl-8 pr-8 py-2 w-64 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 placeholder:text-slate-400"
              />
              {searchInput && (
                <button onClick={() => { setSearchInput(''); setSearch(''); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X size={12} />
                </button>
              )}
            </div>
            {hasFilters && (
              <button
                type="button"
                onClick={() => { setModuleFilter(''); setActorFilter(''); setFromDate(''); setToDate(''); setSearchInput(''); setSearch(''); }}
                className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-700 px-2 py-1.5"
              >
                <X size={12} /> {t('logs.clearFilters')}
              </button>
            )}
          </div>

          {/* Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {['time', 'actor', 'module', 'action', 'entity', 'summary', 'expand'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      {h === 'expand' ? '' : t(`logs.col.${h}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.length === 0 && !loading && (
                  <tr><td colSpan={7} className="px-4 py-16 text-center text-slate-400 text-sm">{t('logs.empty')}</td></tr>
                )}
                {logs.map(log => {
                  const isOpen = expanded.has(log.id);
                  return (
                    <React.Fragment key={log.id}>
                      <tr onClick={() => toggle(log.id)} className="hover:bg-slate-50 cursor-pointer transition-colors">
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="text-xs text-slate-700 font-medium">{relativeTime(log.ts, t)}</div>
                          <div className="text-[10px] text-slate-400">{fmtTime(log.ts)}</div>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700 whitespace-nowrap font-medium">{log.actor_name ?? '—'}</td>
                        <td className="px-4 py-3">
                          <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap', MODULE_BADGE[log.module] ?? 'bg-slate-100 text-slate-600')}>
                            {t(`logs.module.${log.module}`, log.module)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn('text-xs font-bold', ACTION_CLS[log.action] ?? 'text-slate-600')}>{log.action}</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                          {log.entity_type ? <span className="text-slate-400">{log.entity_type}</span> : null}
                          {log.entity_id ? <span className="font-mono ml-1">{log.entity_id}</span> : null}
                          {!log.entity_type && !log.entity_id ? '—' : null}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500 max-w-sm truncate">{log.summary ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-400">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                      </tr>
                      {isOpen && (
                        <tr><td colSpan={7} className="p-0"><DetailPanel log={log} /></td></tr>
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
                  : <button onClick={() => load(false)} className="text-xs font-bold text-blue-600 hover:text-blue-700">{t('logs.loadMore')}</button>}
              </div>
            )}
          </div>
        </main>
      )}
    </div>
  );
}

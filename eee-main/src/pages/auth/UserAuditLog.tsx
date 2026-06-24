import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronRight, ChevronDown, Loader2, ShieldOff, RefreshCw, Filter, Search, X,
} from 'lucide-react';
import { getAuthAuditLog, getUsers, type AuthAuditLogEntry } from '../../services/authApi';
import type { ErpUser } from '../../types/auth';
import { usePermissions } from '../../contexts/PermissionContext';
import { cn } from '../../lib/utils';

const ACTION_META: Record<string, { cls: string }> = {
  login_success:    { cls: 'bg-emerald-100 text-emerald-700' },
  logout:           { cls: 'bg-slate-100   text-slate-600'   },
  create:           { cls: 'bg-blue-100    text-blue-700'    },
  edit_profile:     { cls: 'bg-amber-100   text-amber-700'   },
  activate:         { cls: 'bg-emerald-100 text-emerald-700' },
  deactivate:       { cls: 'bg-red-100     text-red-700'     },
  reset_password:   { cls: 'bg-violet-100  text-violet-700'  },
  edit_permissions: { cls: 'bg-indigo-100  text-indigo-700'  },
};

const ACTION_OPTION_VALUES = [
  '', 'login_success', 'logout', 'create', 'edit_profile',
  'activate', 'deactivate', 'reset_password', 'edit_permissions',
];

const PAGE_SIZE = 50;

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function relativeTime(iso: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return t('userAuditLog.secondsAgo', { count: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t('userAuditLog.minutesAgo', { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('userAuditLog.hoursAgo', { count: h });
  return t('userAuditLog.daysAgo', { count: Math.floor(h / 24) });
}

function DetailPanel({ log }: { log: AuthAuditLogEntry }) {
  const { t } = useTranslation('auth');
  const { diff, before_snapshot: before, after_snapshot: after } = log;
  const hasDiff = diff && Object.keys(diff).length > 0;
  if (!hasDiff && !before && !after) {
    return <p className="text-xs text-slate-400 py-2 px-6">{t('userAuditLog.noDetails')}</p>;
  }
  return (
    <div className="px-6 pb-5 pt-3 bg-slate-50 border-t border-slate-100">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">{t('userAuditLog.details')}</p>
      <pre className="text-[11px] text-slate-600 bg-white border border-slate-200 rounded-lg p-3 overflow-auto max-h-72 whitespace-pre-wrap break-words">
        {JSON.stringify(diff ?? after ?? before, null, 2)}
      </pre>
    </div>
  );
}

export default function UserAuditLog() {
  const { t } = useTranslation('auth');
  const { can } = usePermissions();
  const canView = can('auth', 'audit_log', 'view');

  const [logs, setLogs]               = useState<AuthAuditLogEntry[]>([]);
  const [users, setUsers]             = useState<ErpUser[]>([]);
  const [loading, setLoading]         = useState(false);
  const [offset, setOffset]           = useState(0);
  const [hasMore, setHasMore]         = useState(true);
  const [expanded, setExpanded]       = useState<Set<number>>(new Set());
  const [userFilter, setUserFilter]   = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch]           = useState('');
  const debounceRef                   = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      const rows = await getAuthAuditLog({
        target_user_id: userFilter || undefined,
        action:         actionFilter || undefined,
        search:         search || undefined,
        limit:          PAGE_SIZE,
        offset:         off,
      });
      setLogs(prev => reset ? rows : [...prev, ...rows]);
      setHasMore(rows.length === PAGE_SIZE);
      setOffset(reset ? PAGE_SIZE : off + PAGE_SIZE);
    } catch { /* show empty */ }
    setLoading(false);
  }, [userFilter, actionFilter, search, offset]);

  useEffect(() => {
    setOffset(0);
    setLogs([]);
    setExpanded(new Set());
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userFilter, actionFilter, search]);

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
        <p className="font-bold text-sm">{t('userAuditLog.noPermission')}</p>
        <p className="text-xs">{t('userAuditLog.askAdminPrefix')}<code className="bg-slate-100 px-1 rounded">auth › audit_log › view</code>{t('userAuditLog.askAdminSuffix')}</p>
      </div>
    );
  }

  return (
    <main className="flex-1 overflow-y-auto px-10 py-7 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{t('userAuditLog.module')}</p>
          <h1 className="text-xl font-bold text-slate-900">{t('userAuditLog.title')}</h1>
          <p className="text-xs text-slate-500 mt-1">{t('userAuditLog.retentionNote')}</p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-600 text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          {t('userAuditLog.refresh')}
        </button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Filter size={13} className="text-slate-400 shrink-0" />
        <select
          value={userFilter}
          onChange={e => setUserFilter(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 max-w-[16rem]"
        >
          <option value="">{t('userAuditLog.allUsers')}</option>
          {users.map(u => (
            <option key={u.id} value={u.id}>{u.full_name}{u.is_active ? '' : ` (${t('userAuditLog.inactive')})`}</option>
          ))}
        </select>
        <select
          value={actionFilter}
          onChange={e => setActionFilter(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700"
        >
          {ACTION_OPTION_VALUES.map(v => (
            <option key={v} value={v}>{v ? t(`userAuditLog.action.${v}`) : t('userAuditLog.allActions')}</option>
          ))}
        </select>
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchInput}
            onChange={e => handleSearchChange(e.target.value)}
            placeholder={t('userAuditLog.searchPlaceholder')}
            className="text-xs border border-slate-200 rounded-lg pl-8 pr-8 py-1.5 w-72 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 placeholder:text-slate-400"
          />
          {searchInput && (
            <button onClick={() => { setSearchInput(''); setSearch(''); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {['time', 'actor', 'action', 'target', 'summary', 'expand'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  {h === 'expand' ? '' : t(`userAuditLog.col.${h}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {logs.length === 0 && !loading && (
              <tr><td colSpan={6} className="px-4 py-16 text-center text-slate-400 text-sm">{t('userAuditLog.empty')}</td></tr>
            )}
            {logs.map(log => {
              const isOpen = expanded.has(log.id);
              const meta = ACTION_META[log.action] ?? { cls: 'bg-slate-100 text-slate-600' };
              const actionLabel = ACTION_META[log.action] ? t(`userAuditLog.action.${log.action}`) : log.action;
              return (
                <React.Fragment key={log.id}>
                  <tr onClick={() => toggle(log.id)} className="hover:bg-slate-50 cursor-pointer transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-xs text-slate-700 font-medium">{relativeTime(log.changed_at, t)}</div>
                      <div className="text-[10px] text-slate-400">{fmtTime(log.changed_at)}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700 whitespace-nowrap font-medium">{log.actor_name}</td>
                    <td className="px-4 py-3">
                      <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap', meta.cls)}>{actionLabel}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {log.target_name && <div className="text-xs text-slate-700">{log.target_name}</div>}
                      {log.target_email && <div className="text-[10px] text-slate-400">{log.target_email}</div>}
                      {!log.target_name && !log.target_email && <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 max-w-xs truncate">{log.description ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-400">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                  </tr>
                  {isOpen && (
                    <tr><td colSpan={6} className="p-0"><DetailPanel log={log} /></td></tr>
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
              : <button onClick={() => load(false)} className="text-xs font-bold text-blue-600 hover:text-blue-700">{t('userAuditLog.loadMore')}</button>}
          </div>
        )}
      </div>
    </main>
  );
}

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { getHrAuditLog } from '../../../services/hrApi';
import type { HrAuditLog } from '../../../services/hrApi';
import { usePermissions } from '../../../contexts/PermissionContext';

const ACTION_COLORS: Record<string, string> = {
  created: 'bg-emerald-100 text-emerald-700',
  updated: 'bg-blue-100 text-blue-700',
  approved: 'bg-teal-100 text-teal-700',
  rejected: 'bg-red-100 text-red-600',
  cancelled: 'bg-slate-100 text-slate-500',
  paid: 'bg-purple-100 text-purple-700',
  calculated: 'bg-amber-100 text-amber-700',
  deleted: 'bg-red-100 text-red-700',
};

const ENTITY_LABELS: Record<string, string> = {
  employee: 'Employee',
  department: 'Department',
  leave_request: 'Leave Request',
  pay_run: 'Pay Run',
  pay_slip: 'Pay Slip',
  bonus_run: 'Bonus Run',
  salary_record: 'Salary Record',
  overtime_request: 'Overtime',
  interview: 'Interview',
  candidate: 'Candidate',
  review: 'Review',
  goal: 'Goal',
  training_enrollment: 'Training',
  benefit_enrollment: 'Benefit',
};

function DiffViewer({ before, after }: { before: any; after: any }) {
  const { t } = useTranslation('hr');
  const keys = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]));
  const changed = keys.filter(k => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]));
  if (changed.length === 0) return <p className="text-xs text-slate-400">{t('hRAuditLog.noFieldChanges')}</p>;
  return (
    <div className="space-y-1">
      {changed.map(k => (
        <div key={k} className="grid grid-cols-3 gap-2 text-xs">
          <span className="font-mono text-slate-500">{k}</span>
          <span className="font-mono text-red-500 bg-red-50 px-1.5 py-0.5 rounded truncate">{String(before?.[k] ?? '—')}</span>
          <span className="font-mono text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded truncate">{String(after?.[k] ?? '—')}</span>
        </div>
      ))}
    </div>
  );
}

export default function HRAuditLog() {
  const { t } = useTranslation('hr');
  const { can } = usePermissions();
  const canView = can('hr', 'audit_log', 'view');

  const [logs, setLogs] = useState<HrAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [entityFilter, setEntityFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  useEffect(() => {
    if (!canView) { setLoading(false); return; }
    getHrAuditLog({ limit: PAGE_SIZE, offset: page * PAGE_SIZE }).then(({ logs: l }) => { setLogs(l); setLoading(false); });
  }, [page]);

  if (!canView) {
    return (
      <div className="min-h-screen bg-[#faf8f5] flex items-center justify-center">
        <p className="text-slate-400 text-sm">{t('hRAuditLog.noPermission')}</p>
      </div>
    );
  }

  const filtered = logs.filter(l =>
    (entityFilter ? l.entity_type === entityFilter : true) &&
    (actionFilter ? l.action === actionFilter : true)
  );

  const entityTypes = Array.from(new Set(logs.map(l => l.entity_type)));
  const actions = Array.from(new Set(logs.map(l => l.action)));

  return (
    <div className="min-h-screen bg-[#faf8f5] flex flex-col">
      <div className="px-10 pt-8 pb-5 border-b border-slate-200 bg-white">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{t('hRAuditLog.breadcrumb')}</p>
        <h1 className="text-2xl font-bold text-slate-900">{t('hRAuditLog.title')}</h1>
      </div>

      <main className="flex-1 overflow-y-auto px-10 py-7">
        <div className="flex gap-3 mb-5">
          <select value={entityFilter} onChange={e => setEntityFilter(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
            <option value="">{t('hRAuditLog.allEntities')}</option>
            {entityTypes.map(e => <option key={e} value={e}>{ENTITY_LABELS[e] ?? e}</option>)}
          </select>
          <select value={actionFilter} onChange={e => setActionFilter(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
            <option value="">{t('hRAuditLog.allActions')}</option>
            {actions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <span className="ml-auto text-xs text-slate-400 self-center">{t('hRAuditLog.entriesCount', { count: filtered.length })}</span>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 py-16 justify-center"><Loader2 size={18} className="animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-400 text-sm">{t('hRAuditLog.noEntries')}</div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {filtered.map(log => (
              <div key={log.id} className="border-b border-slate-100 last:border-b-0">
                <button className="w-full text-left px-5 py-3.5 hover:bg-slate-50 transition-colors"
                  onClick={() => setExpanded(expanded === log.id ? null : log.id)}>
                  <div className="flex items-center gap-3">
                    {expanded === log.id ? <ChevronDown size={14} className="text-slate-400 flex-shrink-0" /> : <ChevronRight size={14} className="text-slate-400 flex-shrink-0" />}
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0 ${ACTION_COLORS[log.action] ?? 'bg-slate-100 text-slate-600'}`}>{log.action}</span>
                    <span className="text-xs font-bold text-slate-500 flex-shrink-0">{ENTITY_LABELS[log.entity_type] ?? log.entity_type}</span>
                    {log.entity_id && <span className="text-xs text-slate-400 font-mono flex-shrink-0">#{log.entity_id}</span>}
                    <span className="text-sm text-slate-700 flex-1 truncate">{log.description ?? `${log.action} ${log.entity_type}`}</span>
                    <span className="text-xs text-slate-400 flex-shrink-0">{log.actor_name ?? t('hRAuditLog.system')}</span>
                    <span className="text-xs text-slate-300 flex-shrink-0">{new Date(log.changed_at).toLocaleString()}</span>
                  </div>
                </button>

                {expanded === log.id && (
                  <div className="px-12 pb-4 space-y-3">
                    {log.before_snapshot || log.after_snapshot ? (
                      <>
                        <div className="grid grid-cols-3 gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest pb-1 border-b border-slate-100">
                          <span>{t('hRAuditLog.field')}</span><span>{t('hRAuditLog.before')}</span><span>{t('hRAuditLog.after')}</span>
                        </div>
                        <DiffViewer before={log.before_snapshot} after={log.after_snapshot} />
                      </>
                    ) : (
                      <p className="text-xs text-slate-400">{t('hRAuditLog.noSnapshot')}</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between mt-5">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            className="px-4 py-2 text-sm text-slate-600 hover:bg-white border border-slate-200 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed">
            {t('hRAuditLog.previous')}
          </button>
          <span className="text-xs text-slate-400">{t('hRAuditLog.page', { page: page + 1 })}</span>
          <button onClick={() => setPage(p => p + 1)} disabled={logs.length < PAGE_SIZE}
            className="px-4 py-2 text-sm text-slate-600 hover:bg-white border border-slate-200 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed">
            {t('hRAuditLog.next')}
          </button>
        </div>
      </main>
    </div>
  );
}

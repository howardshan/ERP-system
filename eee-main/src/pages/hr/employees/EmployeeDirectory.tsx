import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Search, Users } from 'lucide-react';
import { getUsers } from '../../../services/authApi';
import type { ErpUser } from '../../../types/auth';
import { usePermissions } from '../../../contexts/PermissionContext';

const STATUS_COLORS: Record<string, string> = {
  Active:      'bg-emerald-100 text-emerald-700',
  'On Leave':  'bg-amber-100 text-amber-700',
  Terminated:  'bg-red-100 text-red-700',
  Probation:   'bg-blue-100 text-blue-700',
};

function employeeStatus(u: ErpUser & { employment_type?: string; end_date?: string }) {
  if (u.end_date) return 'Terminated';
  if (!u.is_active) return 'Terminated';
  return 'Active';
}

interface Props {
  onSelectEmployee: (id: string) => void;
}

export default function EmployeeDirectory({ onSelectEmployee }: Props) {
  const { t } = useTranslation('hr');
  const { can } = usePermissions();
  const canExport = can('hr', 'employees', 'export');
  const [users, setUsers]   = useState<ErpUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [deptFilter, setDeptFilter] = useState('');

  useEffect(() => {
    getUsers().then(u => { setUsers(u); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const departments = Array.from(new Set(users.map(u => u.department).filter(Boolean))) as string[];

  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    const matchSearch = !q || u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || ((u as any).employee_id ?? '').toLowerCase().includes(q);
    const matchDept = !deptFilter || u.department === deptFilter;
    return matchSearch && matchDept;
  });

  function exportCSV() {
    const header = 'Employee ID,Name,Role,Department,Manager,Email,Status';
    const rows = filtered.map(u => [
      (u as any).employee_id ?? '',
      u.full_name,
      u.role ?? '',
      u.department ?? '',
      (u.manager as any)?.full_name ?? '',
      u.email,
      employeeStatus(u as any),
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const csv = [header, ...rows].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `employees-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  return (
    <div className="min-h-screen bg-[#faf8f5] flex flex-col">
      <div className="px-10 pt-8 pb-5 border-b border-slate-200 bg-white">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{t('employeeDirectory.breadcrumb')}</p>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">{t('employeeDirectory.title')}</h1>
          {canExport && (
            <button onClick={exportCSV} className="px-3 py-1.5 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors">
              {t('employeeDirectory.exportCsv')}
            </button>
          )}
        </div>
      </div>

      <main className="flex-1 overflow-y-auto px-10 py-7">
        <div className="flex gap-3 mb-5">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('employeeDirectory.searchPlaceholder')}
              className="w-full pl-8 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <select
            value={deptFilter}
            onChange={e => setDeptFilter(e.target.value)}
            className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            <option value="">{t('employeeDirectory.allDepartments')}</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 py-16 justify-center">
            <Loader2 size={18} className="animate-spin" /> {t('employeeDirectory.loading')}
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                <Users size={32} className="opacity-40" />
                <p className="text-sm">{t('employeeDirectory.noEmployees')}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    {['id','name','role','department','manager','email','status'].map(h => (
                      <th key={h} className="px-5 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">{t(`employeeDirectory.col.${h}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(u => {
                    const status = employeeStatus(u as any);
                    return (
                      <tr key={u.id} onClick={() => onSelectEmployee(u.id)} className="hover:bg-teal-50 cursor-pointer transition-colors">
                        <td className="px-5 py-3.5 text-slate-500 text-xs font-mono">{(u as any).employee_id ?? '—'}</td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full bg-teal-600 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                              {u.full_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                            </div>
                            <span className="font-semibold text-slate-900 text-sm">{u.full_name}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-slate-500 text-sm">{u.role ?? '—'}</td>
                        <td className="px-5 py-3.5 text-slate-500 text-sm">{u.department ?? '—'}</td>
                        <td className="px-5 py-3.5 text-slate-500 text-sm">{(u.manager as any)?.full_name ?? '—'}</td>
                        <td className="px-5 py-3.5 text-slate-500 text-sm">{u.email}</td>
                        <td className="px-5 py-3.5">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLORS[status] ?? 'bg-slate-100 text-slate-600'}`}>{status}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            )}
          </div>
        )}
        <p className="text-xs text-slate-400 mt-3">{t('employeeDirectory.count', { count: filtered.length })}</p>
      </main>
    </div>
  );
}

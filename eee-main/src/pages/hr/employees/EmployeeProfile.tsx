import React, { useEffect, useState } from 'react';
import { ArrowLeft, Save, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { getUser, getUsers, updateUser } from '../../../services/authApi';
import { getSalaryHistory, getLeaveBalances } from '../../../services/hrApi';
import type { ErpUser } from '../../../types/auth';
import type { SalaryRecord, LeaveBalance } from '../../../services/hrApi';
import { usePermissions } from '../../../contexts/PermissionContext';

const TABS = ['Profile', 'Employment', 'Compensation', 'Leave Balances'] as const;
type Tab = typeof TABS[number];

interface Props {
  employeeId: string;
  onBack: () => void;
}

export default function EmployeeProfile({ employeeId, onBack }: Props) {
  const { can } = usePermissions();
  const canEdit = can('hr', 'employees', 'edit');

  const [user, setUser]     = useState<ErpUser | null>(null);
  const [allUsers, setAllUsers] = useState<ErpUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [tab, setTab]         = useState<Tab>('Profile');

  const [salaryHistory, setSalaryHistory] = useState<SalaryRecord[]>([]);
  const [leaveBalances, setLeaveBalances] = useState<LeaveBalance[]>([]);

  const [edits, setEdits] = useState({
    full_name: '', role: '', department: '', manager_id: '',
    employment_type: '', start_date: '', end_date: '', work_location: '',
  });

  useEffect(() => {
    Promise.all([getUser(employeeId), getUsers()]).then(([u, all]) => {
      setUser(u);
      setAllUsers(all.filter(x => x.id !== employeeId));
      setEdits({
        full_name: u.full_name ?? '',
        role: u.role ?? '',
        department: u.department ?? '',
        manager_id: u.manager_id ?? '',
        employment_type: (u as any).employment_type ?? '',
        start_date: (u as any).start_date ?? '',
        end_date: (u as any).end_date ?? '',
        work_location: (u as any).work_location ?? '',
      });
      setLoading(false);
    });
    getSalaryHistory(employeeId).then(setSalaryHistory).catch(() => {});
    getLeaveBalances(employeeId, new Date().getFullYear()).then(setLeaveBalances).catch(() => {});
  }, [employeeId]);

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      await updateUser(employeeId, {
        full_name: edits.full_name || undefined,
        role: edits.role || null,
        department: edits.department || null,
        manager_id: edits.manager_id || null,
        ...(edits.employment_type && { employment_type: edits.employment_type }),
        ...(edits.start_date && { start_date: edits.start_date }),
        ...(edits.end_date && { end_date: edits.end_date }),
        ...(edits.work_location && { work_location: edits.work_location }),
      });
      const u = await getUser(employeeId);
      setUser(u);
      setSaveMsg({ type: 'ok', text: 'Saved' });
      setTimeout(() => setSaveMsg(null), 2500);
    } catch (e: any) {
      setSaveMsg({ type: 'err', text: e?.message ?? 'Error' });
    }
    setSaving(false);
  }

  if (loading || !user) {
    return <div className="min-h-screen bg-[#faf8f5] flex items-center justify-center"><Loader2 size={20} className="animate-spin text-slate-400" /></div>;
  }

  const currentSalary = salaryHistory[0] ?? null;

  return (
    <div className="min-h-screen bg-[#faf8f5] flex flex-col">
      <div className="px-8 py-4 bg-white border-b border-slate-200 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="flex items-center gap-1.5 text-slate-500 hover:text-slate-900 text-xs font-bold transition-colors">
            <ArrowLeft size={14} /> All Employees
          </button>
          <div className="w-px h-5 bg-slate-200" />
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-teal-600 flex items-center justify-center text-white text-xs font-bold">
              {user.full_name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">{user.full_name}</h2>
              <p className="text-[11px] text-slate-400">{user.email} · {(user as any).employee_id ?? '—'}</p>
            </div>
            {user.role && <span className="px-2 py-0.5 bg-teal-100 text-teal-700 text-[10px] font-bold rounded-full">{user.role}</span>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {saveMsg && (
            <span className={`flex items-center gap-1.5 text-xs font-bold ${saveMsg.type === 'ok' ? 'text-emerald-600' : 'text-red-500'}`}>
              {saveMsg.type === 'ok' ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
              {saveMsg.text}
            </span>
          )}
          {canEdit && (
            <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors">
              <Save size={13} /> {saving ? 'Saving…' : 'Save Changes'}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-slate-200 px-8 flex gap-0">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${tab === t ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          >
            {t}
          </button>
        ))}
      </div>

      <main className="flex-1 overflow-y-auto p-10">
        {tab === 'Profile' && (
          <div className="max-w-lg">
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <h3 className="text-sm font-bold text-slate-900 mb-2">Profile Information</h3>
              {[
                { label: 'Full Name', key: 'full_name', placeholder: 'Full name' },
                { label: 'Role / Job Title', key: 'role', placeholder: 'e.g. Financial Controller' },
                { label: 'Department', key: 'department', placeholder: 'e.g. Finance' },
                { label: 'Work Location', key: 'work_location', placeholder: 'e.g. Shanghai HQ' },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{f.label}</label>
                  <input
                    value={(edits as any)[f.key]}
                    onChange={e => setEdits(p => ({ ...p, [f.key]: e.target.value }))}
                    disabled={!canEdit}
                    placeholder={f.placeholder}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>
              ))}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Email</label>
                <input value={user.email} disabled className="w-full bg-slate-100 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm text-slate-400 cursor-not-allowed" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Manager</label>
                <select value={edits.manager_id} onChange={e => setEdits(p => ({ ...p, manager_id: e.target.value }))} disabled={!canEdit}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-60 disabled:cursor-not-allowed">
                  <option value="">No manager</option>
                  {allUsers.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </select>
              </div>
            </div>
          </div>
        )}

        {tab === 'Employment' && (
          <div className="max-w-lg">
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <h3 className="text-sm font-bold text-slate-900 mb-2">Employment Details</h3>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Employment Type</label>
                <select value={edits.employment_type} onChange={e => setEdits(p => ({ ...p, employment_type: e.target.value }))} disabled={!canEdit}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-60 disabled:cursor-not-allowed">
                  <option value="">Select type</option>
                  <option value="full_time">Full-time</option>
                  <option value="part_time">Part-time</option>
                  <option value="contractor">Contractor</option>
                  <option value="intern">Intern</option>
                </select>
              </div>
              {[
                { label: 'Start Date', key: 'start_date', type: 'date' },
                { label: 'End Date (if terminated)', key: 'end_date', type: 'date' },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{f.label}</label>
                  <input type={f.type} value={(edits as any)[f.key]} onChange={e => setEdits(p => ({ ...p, [f.key]: e.target.value }))} disabled={!canEdit}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-60 disabled:cursor-not-allowed" />
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'Compensation' && (
          <div className="max-w-2xl space-y-6">
            {currentSalary ? (
              <div className="bg-white border border-slate-200 rounded-xl p-6">
                <h3 className="text-sm font-bold text-slate-900 mb-4">Current Salary</h3>
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { label: 'Salary', value: `${currentSalary.currency} ${currentSalary.salary.toLocaleString()}` },
                    { label: 'Frequency', value: currentSalary.pay_frequency },
                    { label: 'Pay Grade', value: currentSalary.pay_grade ?? '—' },
                    { label: 'Effective Date', value: currentSalary.effective_date },
                    { label: 'Reason', value: currentSalary.reason ?? '—' },
                  ].map(i => (
                    <div key={i.label}>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{i.label}</p>
                      <p className="text-sm font-semibold text-slate-900 mt-0.5">{i.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl p-6 text-center text-slate-400 text-sm">No salary records yet</div>
            )}
            {salaryHistory.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200">
                  <h3 className="text-sm font-bold text-slate-900">Salary History</h3>
                </div>
                <table className="w-full">
                  <thead><tr className="bg-slate-50 border-b border-slate-200">
                    {['Effective Date','Salary','Frequency','Grade','Reason'].map(h => <th key={h} className="px-5 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">{h}</th>)}
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {salaryHistory.map(s => (
                      <tr key={s.id} className="text-sm">
                        <td className="px-5 py-3 text-slate-600">{s.effective_date}</td>
                        <td className="px-5 py-3 font-semibold text-slate-900">{s.currency} {s.salary.toLocaleString()}</td>
                        <td className="px-5 py-3 text-slate-500">{s.pay_frequency}</td>
                        <td className="px-5 py-3 text-slate-500">{s.pay_grade ?? '—'}</td>
                        <td className="px-5 py-3 text-slate-500">{s.reason ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'Leave Balances' && (
          <div className="max-w-2xl">
            <div className="grid grid-cols-2 gap-4">
              {leaveBalances.map(b => (
                <div key={b.id} className="bg-white border border-slate-200 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-bold text-slate-900">{b.leave_type_name}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 bg-teal-100 text-teal-700 rounded-full">{b.leave_type_code}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    {[
                      { label: 'Accrued',    value: b.accrued,    color: 'text-emerald-700' },
                      { label: 'Available',  value: b.available,  color: 'text-teal-700 font-bold text-sm' },
                      { label: 'Used',       value: b.used,       color: 'text-slate-600' },
                      { label: 'Pending',    value: b.pending,    color: 'text-amber-600' },
                      { label: 'Carry Over', value: b.carry_over, color: 'text-blue-600' },
                      { label: 'Adjusted',   value: b.adjusted,   color: 'text-purple-600' },
                    ].map(i => (
                      <div key={i.label}>
                        <p className="text-slate-400 text-[10px] uppercase tracking-widest font-bold">{i.label}</p>
                        <p className={`mt-0.5 ${i.color}`}>{i.value} day{i.value !== 1 ? 's' : ''}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {leaveBalances.length === 0 && (
                <div className="col-span-2 bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400 text-sm">
                  No leave balances found for {new Date().getFullYear()}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

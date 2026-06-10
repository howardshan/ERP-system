import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Plus, CalendarDays } from 'lucide-react';
import { getLeaveBalances, getLeaveRequests, getLeaveTypes, submitLeaveRequest, cancelLeaveRequest } from '../../../services/hrApi';
import type { LeaveBalance, LeaveRequest, LeaveType } from '../../../services/hrApi';
import { supabase } from '../../../lib/supabase';

const STATUS_COLORS: Record<string, string> = {
  pending:  'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-600',
  cancelled:'bg-slate-100 text-slate-500',
  recalled: 'bg-blue-100 text-blue-700',
};

export default function MyLeave() {
  const { t } = useTranslation('hr');
  const [employeeId, setEmployeeId] = useState('');
  const [balances, setBalances]   = useState<LeaveBalance[]>([]);
  const [requests, setRequests]   = useState<LeaveRequest[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading]     = useState(true);
  const [modal, setModal]         = useState(false);
  const [form, setForm]           = useState({ leave_type_id: 0, start_date: '', end_date: '', reason: '', half_day: false, half_day_period: 'morning' });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: eu } = await supabase.from('erp_user').select('id').eq('auth_user_id', user.id).single();
      if (eu) {
        setEmployeeId(eu.id);
        const year = new Date().getFullYear();
        const [b, r, lt] = await Promise.all([
          getLeaveBalances(eu.id, year).catch(() => []),
          getLeaveRequests({ employeeId: eu.id }).catch(() => []),
          getLeaveTypes().catch(() => []),
        ]);
        setBalances(b); setRequests(r); setLeaveTypes(lt);
      }
      setLoading(false);
    })();
  }, []);

  async function load() {
    if (!employeeId) return;
    const year = new Date().getFullYear();
    const [b, r] = await Promise.all([getLeaveBalances(employeeId, year), getLeaveRequests({ employeeId })]);
    setBalances(b); setRequests(r);
  }

  async function submit() {
    if (!form.leave_type_id || !form.start_date || !form.end_date) { setErr(t('myLeave.errRequired')); return; }
    setSubmitting(true); setErr('');
    try {
      await submitLeaveRequest({ employee_id: employeeId, ...form });
      setModal(false); load();
    } catch (e: any) { setErr(e?.message ?? t('myLeave.errSubmit')); }
    setSubmitting(false);
  }

  async function cancel(id: number) {
    await cancelLeaveRequest(id); load();
  }

  if (loading) {
    return <div className="min-h-screen bg-[#faf8f5] flex items-center justify-center"><Loader2 size={20} className="animate-spin text-slate-400" /></div>;
  }

  return (
    <div className="min-h-screen bg-[#faf8f5] flex flex-col">
      <div className="px-10 pt-8 pb-5 border-b border-slate-200 bg-white">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{t('myLeave.breadcrumb')}</p>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">{t('myLeave.title')}</h1>
          <button onClick={() => { setModal(true); setErr(''); setForm({ leave_type_id: 0, start_date: '', end_date: '', reason: '', half_day: false, half_day_period: 'morning' }); }}
            className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold rounded-lg transition-colors">
            <Plus size={14} /> {t('myLeave.applyForLeave')}
          </button>
        </div>
      </div>

      <main className="flex-1 overflow-y-auto px-10 py-7 space-y-7">
        {/* Balance cards */}
        <div>
          <h2 className="text-sm font-bold text-slate-700 mb-3">{t('myLeave.leaveBalances', { year: new Date().getFullYear() })}</h2>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {balances.map(b => (
              <div key={b.id} className="bg-white border border-slate-200 rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-bold text-slate-900">{b.leave_type_name}</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 bg-teal-100 text-teal-700 rounded-full">{b.leave_type_code}</span>
                </div>
                <div className="text-2xl font-bold text-teal-700 mb-1">{b.available} <span className="text-sm font-normal text-slate-500">{t('myLeave.daysAvailable')}</span></div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs mt-2">
                  <span className="text-slate-400">{t('myLeave.accrued')}: <b className="text-slate-700">{b.accrued}</b></span>
                  <span className="text-slate-400">{t('myLeave.used')}: <b className="text-slate-700">{b.used}</b></span>
                  <span className="text-slate-400">{t('myLeave.pending')}: <b className="text-amber-600">{b.pending}</b></span>
                  <span className="text-slate-400">{t('myLeave.carryOver')}: <b className="text-blue-600">{b.carry_over}</b></span>
                </div>
              </div>
            ))}
            {balances.length === 0 && (
              <div className="col-span-3 bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400 text-sm">{t('myLeave.noBalances')}</div>
            )}
          </div>
        </div>

        {/* Request history */}
        <div>
          <h2 className="text-sm font-bold text-slate-700 mb-3">{t('myLeave.leaveHistory')}</h2>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {requests.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-400">
                <CalendarDays size={28} className="opacity-40" />
                <p className="text-sm">{t('myLeave.noRequests')}</p>
              </div>
            ) : (
              <table className="w-full">
                <thead><tr className="bg-slate-50 border-b border-slate-200">
                  {[['type',t('myLeave.colType')],['period',t('myLeave.colPeriod')],['days',t('myLeave.colDays')],['reason',t('myLeave.colReason')],['status',t('myLeave.colStatus')],['approver',t('myLeave.colApprover')],['actions','']].map(([k,h]) => <th key={k} className="px-5 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">{h}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {requests.map(r => (
                    <tr key={r.id} className="text-sm">
                      <td className="px-5 py-3.5 font-semibold text-slate-900">{r.leave_type_name}</td>
                      <td className="px-5 py-3.5 text-slate-500">{r.start_date} → {r.end_date}</td>
                      <td className="px-5 py-3.5 text-slate-500">{r.days_requested}</td>
                      <td className="px-5 py-3.5 text-slate-500 max-w-xs truncate">{r.reason ?? '—'}</td>
                      <td className="px-5 py-3.5">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLORS[r.status]}`}>{r.status}</span>
                        {r.rejection_reason && <p className="text-[10px] text-red-500 mt-0.5">{r.rejection_reason}</p>}
                      </td>
                      <td className="px-5 py-3.5 text-slate-400">{r.approver_name ?? '—'}</td>
                      <td className="px-5 py-3.5">
                        {r.status === 'pending' && (
                          <button onClick={() => cancel(r.id)} className="text-xs text-red-500 hover:underline font-semibold">{t('myLeave.cancel')}</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>

      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-slate-900 mb-5">{t('myLeave.applyForLeave')}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('myLeave.leaveTypeLabel')}</label>
                <select value={form.leave_type_id} onChange={e => setForm(p => ({ ...p, leave_type_id: Number(e.target.value) }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                  <option value={0}>{t('myLeave.selectType')}</option>
                  {leaveTypes.map(lt => <option key={lt.id} value={lt.id}>{lt.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('myLeave.startDate')}</label>
                  <input type="date" value={form.start_date} onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('myLeave.endDate')}</label>
                  <input type="date" value={form.end_date} onChange={e => setForm(p => ({ ...p, end_date: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.half_day} onChange={e => setForm(p => ({ ...p, half_day: e.target.checked }))} className="rounded" />
                <span className="text-sm text-slate-700">{t('myLeave.halfDay')}</span>
                {form.half_day && (
                  <select value={form.half_day_period} onChange={e => setForm(p => ({ ...p, half_day_period: e.target.value }))} className="ml-2 text-sm border border-slate-200 rounded px-2 py-1">
                    <option value="morning">{t('myLeave.morning')}</option>
                    <option value="afternoon">{t('myLeave.afternoon')}</option>
                  </select>
                )}
              </label>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('myLeave.reason')}</label>
                <textarea rows={3} value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
              </div>
            </div>
            {err && <p className="mt-3 text-xs text-red-500">{err}</p>}
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setModal(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">{t('myLeave.cancel')}</button>
              <button onClick={submit} disabled={submitting}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg">
                {submitting ? t('myLeave.submitting') : t('myLeave.submitRequest')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

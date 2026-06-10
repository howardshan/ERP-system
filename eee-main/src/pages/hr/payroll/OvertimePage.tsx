import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Plus, CheckCircle2, XCircle } from 'lucide-react';
import { getOvertimeRequests, submitOvertime, approveOvertime, rejectOvertime } from '../../../services/hrApi';
import type { OvertimeRequest } from '../../../services/hrApi';
import { getUsers } from '../../../services/authApi';
import type { ErpUser } from '../../../types/auth';
import { usePermissions } from '../../../contexts/PermissionContext';
import { supabase } from '../../../lib/supabase';

const STATUS_COLORS: Record<string, string> = {
  pending:  'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-600',
  paid:     'bg-blue-100 text-blue-700',
};
const TYPE_RATE: Record<string, string> = { weekday: '1.5×', weekend: '2×', holiday: '3×' };

export default function OvertimePage() {
  const { t } = useTranslation('hr');
  const { can } = usePermissions();
  const canApprove = can('hr', 'payroll', 'approve');
  const canCreate  = can('hr', 'payroll', 'create');

  const [requests, setRequests] = useState<OvertimeRequest[]>([]);
  const [employees, setEmployees] = useState<ErpUser[]>([]);
  const [loading, setLoading]   = useState(true);
  const [processing, setProcessing] = useState<number | null>(null);
  const [modal, setModal]       = useState(false);
  const [form, setForm]         = useState({ employee_id: '', date: '', hours: '', type: 'weekday', reason: '', project_code: '' });
  const [saving, setSaving]     = useState(false);
  const [currentErpId, setCurrentErpId] = useState('');

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: eu } = await supabase.from('erp_user').select('id').eq('auth_user_id', user.id).single();
        if (eu) setCurrentErpId(eu.id);
      }
    })();
    Promise.all([getOvertimeRequests(), getUsers().catch(() => [])]).then(([r, e]) => { setRequests(r); setEmployees(e); setLoading(false); });
  }, []);

  async function load() { setRequests(await getOvertimeRequests()); }

  async function submit() {
    if (!form.employee_id || !form.date || !form.hours) return;
    setSaving(true);
    await submitOvertime({ employee_id: form.employee_id, date: form.date, hours: Number(form.hours), type: form.type as any, reason: form.reason || undefined, project_code: form.project_code || undefined });
    setModal(false); load();
    setSaving(false);
  }

  async function approve(id: number) {
    setProcessing(id);
    await approveOvertime(id, currentErpId);
    load(); setProcessing(null);
  }

  async function reject(id: number) {
    setProcessing(id);
    await rejectOvertime(id, currentErpId);
    load(); setProcessing(null);
  }

  return (
    <div className="min-h-screen bg-[#faf8f5] flex flex-col">
      <div className="px-10 pt-8 pb-5 border-b border-slate-200 bg-white">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{t('overtimePage.breadcrumb')}</p>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">{t('overtimePage.title')}</h1>
          {canCreate && (
            <button onClick={() => { setModal(true); setForm({ employee_id: currentErpId, date: '', hours: '', type: 'weekday', reason: '', project_code: '' }); }}
              className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold rounded-lg transition-colors">
              <Plus size={14} /> {t('overtimePage.logOvertime')}
            </button>
          )}
        </div>
      </div>

      <main className="flex-1 overflow-y-auto px-10 py-7">
        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 py-16 justify-center"><Loader2 size={18} className="animate-spin" /></div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead><tr className="bg-slate-50 border-b border-slate-200">
                {[['employee', t('overtimePage.colEmployee')], ['date', t('overtimePage.colDate')], ['hours', t('overtimePage.colHours')], ['type', t('overtimePage.colType')], ['rate', t('overtimePage.colRate')], ['reason', t('overtimePage.colReason')], ['status', t('overtimePage.colStatus')], ['actions', '']].map(([k, h]) => <th key={k} className="px-5 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {requests.length === 0 ? (
                  <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-slate-400">{t('overtimePage.empty')}</td></tr>
                ) : requests.map(r => (
                  <tr key={r.id} className="text-sm hover:bg-slate-50">
                    <td className="px-5 py-3.5 font-semibold text-slate-900">{r.employee_name ?? r.employee_id}</td>
                    <td className="px-5 py-3.5 text-slate-500">{r.date}</td>
                    <td className="px-5 py-3.5 text-slate-900 font-semibold">{r.hours}h</td>
                    <td className="px-5 py-3.5 text-slate-500 capitalize">{r.type}</td>
                    <td className="px-5 py-3.5 text-teal-600 font-bold">{TYPE_RATE[r.type]}</td>
                    <td className="px-5 py-3.5 text-slate-500 max-w-xs truncate">{r.reason ?? '—'}</td>
                    <td className="px-5 py-3.5"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLORS[r.status]}`}>{r.status}</span></td>
                    <td className="px-5 py-3.5">
                      {canApprove && r.status === 'pending' && (
                        <div className="flex gap-1">
                          <button onClick={() => approve(r.id)} disabled={processing === r.id} className="p-1.5 rounded hover:bg-emerald-50 text-emerald-600 transition-colors"><CheckCircle2 size={15} /></button>
                          <button onClick={() => reject(r.id)}  disabled={processing === r.id} className="p-1.5 rounded hover:bg-red-50 text-red-500 transition-colors"><XCircle size={15} /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-slate-900 mb-5">{t('overtimePage.logOvertime')}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('overtimePage.colEmployee')}</label>
                <select value={form.employee_id} onChange={e => setForm(p => ({ ...p, employee_id: e.target.value }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                  <option value="">{t('overtimePage.selectEmployee')}</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('overtimePage.colDate')}</label>
                  <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('overtimePage.colHours')}</label>
                  <input type="number" min={0.5} step={0.5} value={form.hours} onChange={e => setForm(p => ({ ...p, hours: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('overtimePage.colType')}</label>
                  <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                    <option value="weekday">{t('overtimePage.typeWeekday')}</option>
                    <option value="weekend">{t('overtimePage.typeWeekend')}</option>
                    <option value="holiday">{t('overtimePage.typeHoliday')}</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('overtimePage.colReason')}</label>
                  <input value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))} placeholder={t('overtimePage.reasonPlaceholder')}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('overtimePage.projectCode')}</label>
                  <input value={form.project_code} onChange={e => setForm(p => ({ ...p, project_code: e.target.value }))} placeholder={t('overtimePage.projectCodePlaceholder')}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setModal(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">{t('overtimePage.cancel')}</button>
              <button onClick={submit} disabled={saving || !form.employee_id || !form.date || !form.hours}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg">
                {saving ? t('overtimePage.submitting') : t('overtimePage.submit')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

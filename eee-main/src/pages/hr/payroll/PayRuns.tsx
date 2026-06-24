import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Plus, Play, CheckCircle2 } from 'lucide-react';
import { getPayRuns, createPayRun, calculatePayRun, approvePayRun, getPaySlips } from '../../../services/hrApi';
import type { PayRun, PaySlip } from '../../../services/hrApi';
import { usePermissions } from '../../../contexts/PermissionContext';
import { supabase } from '../../../lib/supabase';

const STATUS_COLORS: Record<string, string> = {
  draft:      'bg-slate-100 text-slate-600',
  processing: 'bg-blue-100 text-blue-700',
  review:     'bg-amber-100 text-amber-700',
  approved:   'bg-emerald-100 text-emerald-700',
  paid:       'bg-teal-100 text-teal-700',
  cancelled:  'bg-red-100 text-red-600',
};

export default function PayRuns() {
  const { t } = useTranslation('hr');
  const { can } = usePermissions();
  const canCreate  = can('hr', 'payroll', 'create');
  const canApprove = can('hr', 'payroll', 'approve');
  const canManage  = can('hr', 'payroll', 'manage');

  const [runs, setRuns]         = useState<PayRun[]>([]);
  const [slips, setSlips]       = useState<PaySlip[]>([]);
  const [selectedRun, setSelectedRun] = useState<PayRun | null>(null);
  const [loading, setLoading]   = useState(true);
  const [modal, setModal]       = useState(false);
  const [form, setForm]         = useState({ name: '', period_start: '', period_end: '', pay_date: '' });
  const [saving, setSaving]     = useState(false);
  const [processing, setProcessing] = useState<number | null>(null);
  const [currentErpId, setCurrentErpId] = useState('');

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: eu } = await supabase.from('erp_user').select('id').eq('auth_user_id', user.id).single();
        if (eu) setCurrentErpId(eu.id);
      }
    })();
    load();
  }, []);

  async function load() { setLoading(true); setRuns(await getPayRuns()); setLoading(false); }

  async function selectRun(run: PayRun) {
    setSelectedRun(run);
    setSlips(await getPaySlips(run.id));
  }

  async function create() {
    if (!form.name || !form.period_start || !form.period_end || !form.pay_date) return;
    setSaving(true);
    await createPayRun(form);
    setModal(false); load();
    setSaving(false);
  }

  async function calc(runId: number) {
    setProcessing(runId);
    await calculatePayRun(runId); load();
    if (selectedRun?.id === runId) setSlips(await getPaySlips(runId));
    setProcessing(null);
  }

  async function approve(runId: number) {
    await approvePayRun(runId, currentErpId); load();
  }

  return (
    <div className="min-h-screen bg-[#faf8f5] flex flex-col">
      <div className="px-10 pt-8 pb-5 border-b border-slate-200 bg-white">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{t('payRuns.breadcrumb')}</p>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">{t('payRuns.title')}</h1>
          {canCreate && (
            <button onClick={() => setModal(true)} className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold rounded-lg">
              <Plus size={14} /> {t('payRuns.newPayRun')}
            </button>
          )}
        </div>
      </div>

      <main className="flex-1 overflow-y-auto px-10 py-7">
        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 py-16 justify-center"><Loader2 size={18} className="animate-spin" /></div>
        ) : (
          <div className="flex gap-6">
            <div className="flex-1">
              <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
                <table className="w-full">
                  <thead><tr className="bg-slate-50 border-b border-slate-200">
                    {[t('payRuns.colName'),t('payRuns.colPeriod'),t('payRuns.colPayDate'),t('payRuns.colGross'),t('payRuns.colNet'),t('payRuns.colStatus'),''].map((h, i) => <th key={i} className="px-5 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">{h}</th>)}
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {runs.length === 0 ? (
                      <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-400">{t('payRuns.empty')}</td></tr>
                    ) : runs.map(r => (
                      <tr key={r.id} onClick={() => selectRun(r)} className="text-sm hover:bg-teal-50 cursor-pointer">
                        <td className="px-5 py-3 font-semibold text-slate-900">{r.name}</td>
                        <td className="px-5 py-3 text-slate-500">{r.period_start} → {r.period_end}</td>
                        <td className="px-5 py-3 text-slate-500">{r.pay_date}</td>
                        <td className="px-5 py-3 text-slate-900">{r.total_gross != null ? r.total_gross.toLocaleString() : '—'}</td>
                        <td className="px-5 py-3 font-bold text-teal-700">{r.total_net != null ? r.total_net.toLocaleString() : '—'}</td>
                        <td className="px-5 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLORS[r.status]}`}>{r.status}</span></td>
                        <td className="px-5 py-3 flex gap-1">
                          {canManage && r.status === 'draft' && (
                            <button onClick={e => { e.stopPropagation(); calc(r.id); }} disabled={processing === r.id}
                              className="p-1.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-600 disabled:opacity-50" title={t('payRuns.calculate')}>
                              {processing === r.id ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                            </button>
                          )}
                          {canApprove && r.status === 'review' && (
                            <button onClick={e => { e.stopPropagation(); approve(r.id); }}
                              className="p-1.5 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-600" title={t('payRuns.approve')}>
                              <CheckCircle2 size={12} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {selectedRun && slips.length > 0 && (
              <div className="w-[420px] bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col max-h-[600px]">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h3 className="text-sm font-bold text-slate-900">{t('payRuns.paySlipsTitle', { name: selectedRun.name })}</h3>
                  <p className="text-xs text-slate-400">{t('payRuns.employeeCount', { count: slips.length })}</p>
                </div>
                <div className="overflow-y-auto flex-1">
                  {slips.map(s => (
                    <div key={s.id} className="px-5 py-3 border-b border-slate-50">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-semibold text-slate-900">{s.employee_name}</span>
                        <span className="text-sm font-bold text-teal-700">{s.net_pay.toLocaleString()}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-1 text-[10px] text-slate-400">
                        <span>{t('payRuns.base')}: {s.base_salary.toLocaleString()}</span>
                        <span>{t('payRuns.ot')}: {s.overtime_amount.toLocaleString()}</span>
                        <span>{t('payRuns.gross')}: {s.gross_pay.toLocaleString()}</span>
                        <span>{t('payRuns.tax')}: {s.income_tax.toLocaleString()}</span>
                        <span>{t('payRuns.si')}: {s.social_insurance.toLocaleString()}</span>
                        <span>{t('payRuns.hf')}: {s.housing_fund.toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="px-5 py-3 border-t border-slate-200 bg-slate-50">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">{t('payRuns.totalNetPay')}</span>
                    <span className="font-bold text-teal-700">{slips.reduce((s, p) => s + p.net_pay, 0).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-slate-900 mb-5">{t('payRuns.newPayRun')}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('payRuns.nameLabel')}</label>
                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder={t('payRuns.namePlaceholder')}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('payRuns.periodStart')}</label>
                  <input type="date" value={form.period_start} onChange={e => setForm(p => ({ ...p, period_start: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('payRuns.periodEnd')}</label>
                  <input type="date" value={form.period_end} onChange={e => setForm(p => ({ ...p, period_end: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('payRuns.payDate')}</label>
                <input type="date" value={form.pay_date} onChange={e => setForm(p => ({ ...p, pay_date: e.target.value }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setModal(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">{t('payRuns.cancel')}</button>
              <button onClick={create} disabled={saving}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg">
                {saving ? t('payRuns.creating') : t('payRuns.create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

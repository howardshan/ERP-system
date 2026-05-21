import React, { useEffect, useState } from 'react';
import { Loader2, Plus, DollarSign } from 'lucide-react';
import { getSalaryHistory, setSalary, getCurrentSalary } from '../../../services/hrApi';
import type { SalaryRecord } from '../../../services/hrApi';
import { getUsers } from '../../../services/authApi';
import type { ErpUser } from '../../../types/auth';
import { usePermissions } from '../../../contexts/PermissionContext';

export default function SalaryRecords() {
  const { can } = usePermissions();
  const canManage = can('hr', 'payroll', 'manage');

  const [employees, setEmployees] = useState<ErpUser[]>([]);
  const [selectedEmp, setSelectedEmp] = useState('');
  const [history, setHistory]     = useState<SalaryRecord[]>([]);
  const [loading, setLoading]     = useState(false);
  const [modal, setModal]         = useState(false);
  const [form, setForm]           = useState({ effective_date: new Date().toISOString().slice(0, 10), salary: '', pay_frequency: 'monthly', currency: 'CNY', pay_grade: '', reason: '' });
  const [saving, setSaving]       = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { getUsers().then(setEmployees).catch(() => {}); }, []);

  async function loadHistory(empId: string) {
    if (!empId) { setHistory([]); return; }
    setLoading(true);
    setHistory(await getSalaryHistory(empId).catch(() => []));
    setLoading(false);
  }

  useEffect(() => { loadHistory(selectedEmp); }, [selectedEmp]);

  async function save() {
    if (!selectedEmp || !form.salary || !form.effective_date) { setErr('Employee, salary and effective date are required'); return; }
    setSaving(true); setErr('');
    try {
      await setSalary(selectedEmp, { ...form, salary: Number(form.salary), pay_frequency: form.pay_frequency as 'monthly' | 'bi_weekly' | 'weekly' });
      setModal(false); loadHistory(selectedEmp);
    } catch (e: any) { setErr(e?.message ?? 'Error'); }
    setSaving(false);
  }

  const currentSalary = history[0] ?? null;

  return (
    <div className="min-h-screen bg-[#faf8f5] flex flex-col">
      <div className="px-10 pt-8 pb-5 border-b border-slate-200 bg-white">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">HR / Payroll</p>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">Salary Records</h1>
          {canManage && selectedEmp && (
            <button onClick={() => { setModal(true); setErr(''); }} className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold rounded-lg transition-colors">
              <Plus size={14} /> Add Salary Record
            </button>
          )}
        </div>
      </div>

      <main className="flex-1 overflow-y-auto px-10 py-7">
        <div className="mb-6 max-w-xs">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Select Employee</label>
          <select value={selectedEmp} onChange={e => setSelectedEmp(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
            <option value="">Select an employee</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </select>
        </div>

        {!selectedEmp ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
            <DollarSign size={40} className="opacity-40" />
            <p className="text-sm">Select an employee to view salary history</p>
          </div>
        ) : loading ? (
          <div className="flex items-center gap-2 text-slate-400 py-16 justify-center"><Loader2 size={18} className="animate-spin" /></div>
        ) : (
          <div className="space-y-5">
            {currentSalary && (
              <div className="bg-white border border-slate-200 rounded-xl p-6">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Current Salary</h3>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-teal-700">{currentSalary.currency} {currentSalary.salary.toLocaleString()}</span>
                  <span className="text-sm text-slate-500">/ {currentSalary.pay_frequency}</span>
                </div>
                <p className="text-xs text-slate-400 mt-1">Effective: {currentSalary.effective_date}{currentSalary.reason ? ` · ${currentSalary.reason}` : ''}</p>
              </div>
            )}

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200">
                <h3 className="text-sm font-bold text-slate-900">Salary History</h3>
              </div>
              {history.length === 0 ? (
                <p className="text-sm text-slate-400 px-6 py-8 text-center">No salary records yet</p>
              ) : (
                <table className="w-full">
                  <thead><tr className="bg-slate-50 border-b border-slate-200">
                    {['Effective Date','Salary','Frequency','Currency','Grade','Reason'].map(h => <th key={h} className="px-5 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">{h}</th>)}
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {history.map((s, i) => (
                      <tr key={s.id} className={`text-sm ${i === 0 ? 'bg-teal-50/30' : ''}`}>
                        <td className="px-5 py-3 text-slate-600 font-mono">{s.effective_date}</td>
                        <td className="px-5 py-3 font-bold text-slate-900">{s.salary.toLocaleString()}</td>
                        <td className="px-5 py-3 text-slate-500">{s.pay_frequency}</td>
                        <td className="px-5 py-3 text-slate-500">{s.currency}</td>
                        <td className="px-5 py-3 text-slate-500">{s.pay_grade ?? '—'}</td>
                        <td className="px-5 py-3 text-slate-500">{s.reason ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </main>

      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-slate-900 mb-5">Add Salary Record</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Effective Date *</label>
                  <input type="date" value={form.effective_date} onChange={e => setForm(p => ({ ...p, effective_date: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Salary *</label>
                  <input type="number" min={0} value={form.salary} onChange={e => setForm(p => ({ ...p, salary: e.target.value }))} placeholder="e.g. 15000"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Frequency</label>
                  <select value={form.pay_frequency} onChange={e => setForm(p => ({ ...p, pay_frequency: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                    <option value="monthly">Monthly</option>
                    <option value="bi_weekly">Bi-weekly</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Currency</label>
                  <input value={form.currency} onChange={e => setForm(p => ({ ...p, currency: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Pay Grade</label>
                  <input value={form.pay_grade} onChange={e => setForm(p => ({ ...p, pay_grade: e.target.value }))} placeholder="e.g. P4"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Reason</label>
                <input value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))} placeholder="e.g. Annual review, Promotion"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
            </div>
            {err && <p className="mt-3 text-xs text-red-500">{err}</p>}
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setModal(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
              <button onClick={save} disabled={saving}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

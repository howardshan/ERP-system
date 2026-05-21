import React, { useEffect, useState } from 'react';
import { Loader2, Plus, Play, CheckCircle2, Pencil } from 'lucide-react';
import { getBonusTemplates, createBonusTemplate, updateBonusTemplate, getBonusRuns, createBonusRun, calculateBonusRun, approveBonusRun, getBonusLines, updateBonusLine } from '../../../services/hrApi';
import { getDepartments } from '../../../services/hrApi';
import type { BonusTemplate, BonusRun, BonusLine, HrDepartment } from '../../../services/hrApi';
import { usePermissions } from '../../../contexts/PermissionContext';
import { supabase } from '../../../lib/supabase';

const STATUS_COLORS: Record<string, string> = {
  draft:       'bg-slate-100 text-slate-600',
  calculating: 'bg-blue-100 text-blue-700',
  review:      'bg-amber-100 text-amber-700',
  approved:    'bg-emerald-100 text-emerald-700',
  paid:        'bg-teal-100 text-teal-700',
  cancelled:   'bg-red-100 text-red-600',
};

export default function BonusRules() {
  const { can } = usePermissions();
  const canManage  = can('hr', 'payroll', 'manage');
  const canApprove = can('hr', 'payroll', 'approve');

  const [templates, setTemplates] = useState<BonusTemplate[]>([]);
  const [runs, setRuns]           = useState<BonusRun[]>([]);
  const [depts, setDepts]         = useState<HrDepartment[]>([]);
  const [loading, setLoading]     = useState(true);
  const [view, setView]           = useState<'templates' | 'runs'>('templates');
  const [selectedRun, setSelectedRun] = useState<BonusRun | null>(null);
  const [lines, setLines]         = useState<BonusLine[]>([]);
  const [currentErpId, setCurrentErpId] = useState('');

  const [tmplModal, setTmplModal] = useState(false);
  const [runModal, setRunModal]   = useState(false);
  const [tmplForm, setTmplForm]   = useState<Partial<BonusTemplate>>({ name: '', formula_type: 'multiplier', base: 'monthly_salary', multiplier: 1, min_tenure_months: 0, performance_weight: 0, is_active: true });
  const [runForm, setRunForm]     = useState({ name: '', template_id: 0, period_start: '', period_end: '' });
  const [saving, setSaving]       = useState(false);

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

  async function load() {
    setLoading(true);
    const [t, r, d] = await Promise.all([getBonusTemplates(), getBonusRuns(), getDepartments().catch(() => [])]);
    setTemplates(t); setRuns(r); setDepts(d); setLoading(false);
  }

  async function selectRun(run: BonusRun) {
    setSelectedRun(run);
    setLines(await getBonusLines(run.id));
  }

  async function saveTmpl() {
    if (!tmplForm.name) return;
    setSaving(true);
    if ((tmplForm as any).id) await updateBonusTemplate((tmplForm as any).id, tmplForm);
    else await createBonusTemplate(tmplForm);
    setTmplModal(false); load();
    setSaving(false);
  }

  async function saveRun() {
    if (!runForm.name || !runForm.template_id || !runForm.period_start || !runForm.period_end) return;
    setSaving(true);
    const run = await createBonusRun({ ...runForm, template_id: runForm.template_id });
    setRunModal(false); load();
    setSaving(false);
  }

  async function calc(runId: number) {
    await calculateBonusRun(runId); load();
    if (selectedRun?.id === runId) setLines(await getBonusLines(runId));
  }

  async function approve(runId: number) {
    await approveBonusRun(runId, currentErpId); load();
  }

  async function overrideLine(lineId: number, override: string) {
    await updateBonusLine(lineId, override ? Number(override) : null);
    if (selectedRun) setLines(await getBonusLines(selectedRun.id));
  }

  return (
    <div className="min-h-screen bg-[#faf8f5] flex flex-col">
      <div className="px-10 pt-8 pb-5 border-b border-slate-200 bg-white">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">HR / Payroll</p>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">Bonus Rules</h1>
          <div className="flex gap-2">
            {view === 'templates' && canManage && (
              <button onClick={() => { setTmplForm({ name: '', formula_type: 'multiplier', base: 'monthly_salary', multiplier: 1, min_tenure_months: 0, performance_weight: 0, is_active: true }); setTmplModal(true); }}
                className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold rounded-lg">
                <Plus size={14} /> New Template
              </button>
            )}
            {view === 'runs' && canManage && (
              <button onClick={() => setRunModal(true)} className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold rounded-lg">
                <Plus size={14} /> New Bonus Run
              </button>
            )}
          </div>
        </div>
        <div className="flex gap-4 mt-4">
          {['templates','runs'].map(v => (
            <button key={v} onClick={() => { setView(v as any); setSelectedRun(null); }}
              className={`text-sm font-semibold pb-1 border-b-2 transition-colors ${view === v ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
              {v === 'templates' ? 'Bonus Templates' : 'Bonus Runs'}
            </button>
          ))}
        </div>
      </div>

      <main className="flex-1 overflow-y-auto px-10 py-7">
        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 py-16 justify-center"><Loader2 size={18} className="animate-spin" /></div>
        ) : view === 'templates' ? (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead><tr className="bg-slate-50 border-b border-slate-200">
                {['Name','Dept','Formula','Base','Multiplier/Tiers','Min Tenure','Perf Weight','Status',''].map(h => <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {templates.length === 0 ? (
                  <tr><td colSpan={9} className="px-5 py-10 text-center text-sm text-slate-400">No bonus templates yet</td></tr>
                ) : templates.map(t => (
                  <tr key={t.id} className="text-sm hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-slate-900">{t.name}</td>
                    <td className="px-4 py-3 text-slate-500">{t.department_name ?? 'All'}</td>
                    <td className="px-4 py-3 text-slate-500 capitalize">{t.formula_type.replace('_',' ')}</td>
                    <td className="px-4 py-3 text-slate-500">{t.base.replace('_',' ')}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {t.formula_type === 'multiplier' ? `${t.multiplier}×` : t.formula_type === 'fixed' ? `Fixed: ${t.fixed_amount}` : t.tiers ? `${(t.tiers as any[]).length} tiers` : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{t.min_tenure_months}m</td>
                    <td className="px-4 py-3 text-slate-500">{(t.performance_weight * 100).toFixed(0)}%</td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${t.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{t.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td className="px-4 py-3">
                      {canManage && <button onClick={() => { setTmplForm({ ...t }); setTmplModal(true); }} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-teal-600"><Pencil size={13} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex gap-6">
            <div className="flex-1">
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full">
                  <thead><tr className="bg-slate-50 border-b border-slate-200">
                    {['Name','Template','Period','Total','Status',''].map(h => <th key={h} className="px-5 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">{h}</th>)}
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {runs.length === 0 ? (
                      <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-400">No bonus runs yet</td></tr>
                    ) : runs.map(r => (
                      <tr key={r.id} onClick={() => selectRun(r)} className="text-sm hover:bg-teal-50 cursor-pointer">
                        <td className="px-5 py-3 font-semibold text-slate-900">{r.name}</td>
                        <td className="px-5 py-3 text-slate-500">{r.template_name}</td>
                        <td className="px-5 py-3 text-slate-500">{r.period_start} → {r.period_end}</td>
                        <td className="px-5 py-3 font-semibold text-slate-900">{r.total_amount != null ? r.total_amount.toLocaleString() : '—'}</td>
                        <td className="px-5 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLORS[r.status]}`}>{r.status}</span></td>
                        <td className="px-5 py-3 flex gap-1.5">
                          {canManage && (r.status === 'draft') && <button onClick={e => { e.stopPropagation(); calc(r.id); }} className="p-1.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-600" title="Calculate"><Play size={12} /></button>}
                          {canApprove && r.status === 'review' && <button onClick={e => { e.stopPropagation(); approve(r.id); }} className="p-1.5 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-600" title="Approve"><CheckCircle2 size={12} /></button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {selectedRun && lines.length > 0 && (
              <div className="w-96 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col max-h-[600px]">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h3 className="text-sm font-bold text-slate-900">{selectedRun.name}</h3>
                  <p className="text-xs text-slate-400">{lines.length} employees · Total: {lines.reduce((s, l) => s + l.final_amount, 0).toLocaleString()}</p>
                </div>
                <div className="overflow-y-auto flex-1">
                  {lines.map(l => (
                    <div key={l.id} className="px-5 py-3 border-b border-slate-50 flex items-center gap-3">
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-slate-900">{l.employee_name}</p>
                        <p className="text-[10px] text-slate-400">{l.department} · Base: {l.base_amount.toLocaleString()}</p>
                      </div>
                      <div className="text-right">
                        {canManage && selectedRun.status === 'review' ? (
                          <input type="number" defaultValue={l.final_amount} onBlur={e => overrideLine(l.id, e.target.value)}
                            className="w-24 text-right text-sm font-bold text-teal-700 border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-500" />
                        ) : (
                          <span className="text-sm font-bold text-teal-700">{l.final_amount.toLocaleString()}</span>
                        )}
                        {l.manual_override != null && <span className="text-[9px] text-amber-500 block">overridden</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Template modal */}
      {tmplModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-slate-900 mb-5">{(tmplForm as any).id ? 'Edit' : 'New'} Bonus Template</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Template Name *</label>
                <input value={tmplForm.name ?? ''} onChange={e => setTmplForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Year-End Bonus"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Department (optional)</label>
                  <select value={tmplForm.department_id ?? ''} onChange={e => setTmplForm(p => ({ ...p, department_id: e.target.value ? Number(e.target.value) : null }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                    <option value="">All departments</option>
                    {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Formula Type</label>
                  <select value={tmplForm.formula_type ?? 'multiplier'} onChange={e => setTmplForm(p => ({ ...p, formula_type: e.target.value as any }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                    <option value="multiplier">Multiplier (n × salary)</option>
                    <option value="fixed">Fixed Amount</option>
                    <option value="tiered">Tiered (salary brackets)</option>
                    <option value="performance_based">Performance-based</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Base</label>
                  <select value={tmplForm.base ?? 'monthly_salary'} onChange={e => setTmplForm(p => ({ ...p, base: e.target.value as any }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                    <option value="monthly_salary">Monthly Salary</option>
                    <option value="annual_salary">Annual Salary</option>
                    <option value="fixed_amount">Fixed Amount</option>
                  </select>
                </div>
                {tmplForm.formula_type === 'multiplier' || tmplForm.formula_type === 'performance_based' ? (
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Multiplier</label>
                    <input type="number" min={0} step={0.1} value={tmplForm.multiplier ?? 1} onChange={e => setTmplForm(p => ({ ...p, multiplier: Number(e.target.value) }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                  </div>
                ) : tmplForm.formula_type === 'fixed' ? (
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Fixed Amount (CNY)</label>
                    <input type="number" min={0} value={tmplForm.fixed_amount ?? ''} onChange={e => setTmplForm(p => ({ ...p, fixed_amount: Number(e.target.value) }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                  </div>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Min Tenure (months)</label>
                  <input type="number" min={0} value={tmplForm.min_tenure_months ?? 0} onChange={e => setTmplForm(p => ({ ...p, min_tenure_months: Number(e.target.value) }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Performance Weight (0–1)</label>
                  <input type="number" min={0} max={1} step={0.1} value={tmplForm.performance_weight ?? 0} onChange={e => setTmplForm(p => ({ ...p, performance_weight: Number(e.target.value) }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={tmplForm.is_active ?? true} onChange={e => setTmplForm(p => ({ ...p, is_active: e.target.checked }))} className="rounded" />
                <span className="text-sm text-slate-700">Active</span>
              </label>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setTmplModal(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
              <button onClick={saveTmpl} disabled={saving} className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Run modal */}
      {runModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-slate-900 mb-5">New Bonus Run</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Run Name *</label>
                <input value={runForm.name} onChange={e => setRunForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. 2026 Year-End Bonus"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Template *</label>
                <select value={runForm.template_id} onChange={e => setRunForm(p => ({ ...p, template_id: Number(e.target.value) }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                  <option value={0}>Select template</option>
                  {templates.filter(t => t.is_active).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Period Start</label>
                  <input type="date" value={runForm.period_start} onChange={e => setRunForm(p => ({ ...p, period_start: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Period End</label>
                  <input type="date" value={runForm.period_end} onChange={e => setRunForm(p => ({ ...p, period_end: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setRunModal(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
              <button onClick={saveRun} disabled={saving} className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg">{saving ? 'Creating…' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

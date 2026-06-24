import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Plus, Shield } from 'lucide-react';
import { getBenefitPlans, createBenefitPlan, getEmployeeBenefits, enrollBenefit } from '../../../services/hrApi';
import type { BenefitPlan, EmployeeBenefit } from '../../../services/hrApi';
import { getUsers } from '../../../services/authApi';
import type { ErpUser } from '../../../types/auth';
import { usePermissions } from '../../../contexts/PermissionContext';

const TYPE_LABELS: Record<string, string> = {
  social_insurance: 'Social Insurance',
  housing_fund: 'Housing Fund',
  commercial_insurance: 'Commercial Insurance',
  meal_allowance: 'Meal Allowance',
  transport_allowance: 'Transport Allowance',
  other: 'Other',
};
const TYPE_COLORS: Record<string, string> = {
  social_insurance: 'bg-blue-100 text-blue-700',
  housing_fund: 'bg-purple-100 text-purple-700',
  commercial_insurance: 'bg-emerald-100 text-emerald-700',
  meal_allowance: 'bg-amber-100 text-amber-700',
  transport_allowance: 'bg-orange-100 text-orange-700',
  other: 'bg-slate-100 text-slate-600',
};

export default function BenefitsPlans() {
  const { t } = useTranslation('hr');
  const { can } = usePermissions();
  const canManage = can('hr', 'benefits', 'manage');
  const typeLabel = (type: string) => t(`benefitsPlans.type_${type}`, { defaultValue: TYPE_LABELS[type] });

  const [plans, setPlans] = useState<BenefitPlan[]>([]);
  const [employees, setEmployees] = useState<ErpUser[]>([]);
  const [enrollments, setEnrollments] = useState<EmployeeBenefit[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'plans' | 'enrollments'>('plans');
  const [selectedEmp, setSelectedEmp] = useState('');
  const [planModal, setPlanModal] = useState(false);
  const [enrollModal, setEnrollModal] = useState(false);
  const [enrollPlanId, setEnrollPlanId] = useState<number | null>(null);
  const [form, setForm] = useState({
    name: '', type: 'social_insurance', provider: '',
    employee_contribution_rate: '', employer_contribution_rate: '',
    employee_fixed: '', employer_fixed: '', applies_to: 'all',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([getBenefitPlans(), getUsers().catch(() => [])]).then(([p, e]) => {
      setPlans(p); setEmployees(e); setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (selectedEmp) getEmployeeBenefits(selectedEmp).then(setEnrollments).catch(() => setEnrollments([]));
    else setEnrollments([]);
  }, [selectedEmp]);

  async function savePlan() {
    setSaving(true);
    await createBenefitPlan({
      ...form,
      applies_to: form.applies_to as 'all' | 'full_time' | 'management',
      employee_contribution_rate: form.employee_contribution_rate ? Number(form.employee_contribution_rate) : undefined,
      employer_contribution_rate: form.employer_contribution_rate ? Number(form.employer_contribution_rate) : undefined,
      employee_fixed: form.employee_fixed ? Number(form.employee_fixed) : undefined,
      employer_fixed: form.employer_fixed ? Number(form.employer_fixed) : undefined,
    });
    setPlanModal(false);
    getBenefitPlans().then(setPlans);
    setSaving(false);
  }

  async function enroll() {
    if (!selectedEmp || !enrollPlanId) return;
    setSaving(true);
    await enrollBenefit(selectedEmp, enrollPlanId);
    setEnrollModal(false);
    getEmployeeBenefits(selectedEmp).then(setEnrollments);
    setSaving(false);
  }

  const enrolledPlanIds = new Set(enrollments.map(e => e.benefit_plan_id));

  return (
    <div className="min-h-screen bg-[#faf8f5] flex flex-col">
      <div className="px-10 pt-8 pb-5 border-b border-slate-200 bg-white">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{t('benefitsPlans.breadcrumb')}</p>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">{t('benefitsPlans.title')}</h1>
          {canManage && tab === 'plans' && (
            <button onClick={() => { setPlanModal(true); setForm({ name: '', type: 'social_insurance', provider: '', employee_contribution_rate: '', employer_contribution_rate: '', employee_fixed: '', employer_fixed: '', applies_to: 'all' }); }}
              className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold rounded-lg">
              <Plus size={14} /> {t('benefitsPlans.newPlan')}
            </button>
          )}
        </div>
        <div className="flex gap-1 mt-4">
          {(['plans', 'enrollments'] as const).map(tabKey => (
            <button key={tabKey} onClick={() => setTab(tabKey)}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${tab === tabKey ? 'bg-teal-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
              {tabKey === 'plans' ? t('benefitsPlans.tabPlans') : t('benefitsPlans.tabEnrollments')}
            </button>
          ))}
        </div>
      </div>

      <main className="flex-1 overflow-y-auto px-10 py-7">
        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 py-16 justify-center"><Loader2 size={18} className="animate-spin" /></div>
        ) : tab === 'plans' ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {plans.length === 0 && (
              <div className="col-span-3 bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-400 text-sm">{t('benefitsPlans.emptyPlans')}</div>
            )}
            {plans.map(p => (
              <div key={p.id} className="bg-white border border-slate-200 rounded-xl p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">{p.name}</h3>
                    {p.provider && <p className="text-xs text-slate-400 mt-0.5">{p.provider}</p>}
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${TYPE_COLORS[p.type]}`}>{typeLabel(p.type)}</span>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="text-[10px] text-slate-400 uppercase font-bold mb-1">{t('benefitsPlans.employee')}</p>
                    {p.employee_contribution_rate != null
                      ? <p className="text-sm font-bold text-slate-900">{(p.employee_contribution_rate * 100).toFixed(1)}%</p>
                      : p.employee_fixed != null
                      ? <p className="text-sm font-bold text-slate-900">¥{p.employee_fixed.toLocaleString()}</p>
                      : <p className="text-sm text-slate-400">—</p>}
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="text-[10px] text-slate-400 uppercase font-bold mb-1">{t('benefitsPlans.employer')}</p>
                    {p.employer_contribution_rate != null
                      ? <p className="text-sm font-bold text-teal-700">{(p.employer_contribution_rate * 100).toFixed(1)}%</p>
                      : p.employer_fixed != null
                      ? <p className="text-sm font-bold text-teal-700">¥{p.employer_fixed.toLocaleString()}</p>
                      : <p className="text-sm text-slate-400">—</p>}
                  </div>
                </div>
                <p className="text-[10px] text-slate-400 mt-3 capitalize">{t('benefitsPlans.appliesToLabel')} {p.applies_to?.replace('_', ' ') ?? 'all'}</p>
              </div>
            ))}
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-4 mb-6">
              <div className="max-w-xs flex-1">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('benefitsPlans.selectEmployee')}</label>
                <select value={selectedEmp} onChange={e => setSelectedEmp(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                  <option value="">{t('benefitsPlans.selectEmployeePlaceholder')}</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                </select>
              </div>
              {selectedEmp && canManage && (
                <button onClick={() => { setEnrollModal(true); setEnrollPlanId(null); }}
                  className="mt-5 flex items-center gap-1.5 px-4 py-2.5 bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold rounded-lg">
                  <Plus size={14} /> {t('benefitsPlans.enrollInPlan')}
                </button>
              )}
            </div>

            {!selectedEmp ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
                <Shield size={40} className="opacity-30" />
                <p className="text-sm">{t('benefitsPlans.selectEmployeeHint')}</p>
              </div>
            ) : enrollments.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-400 text-sm">{t('benefitsPlans.emptyEnrollments')}</div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
                <table className="w-full">
                  <thead><tr className="bg-slate-50 border-b border-slate-200">
                    {[
                      { key: 'plan', label: t('benefitsPlans.colPlan') },
                      { key: 'type', label: t('benefitsPlans.colType') },
                      { key: 'employeeContribution', label: t('benefitsPlans.colEmployeeContribution') },
                      { key: 'employerContribution', label: t('benefitsPlans.colEmployerContribution') },
                      { key: 'enrolledDate', label: t('benefitsPlans.colEnrolledDate') },
                      { key: 'status', label: t('benefitsPlans.colStatus') },
                    ].map(h =>
                      <th key={h.key} className="px-5 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">{h.label}</th>)}
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {enrollments.map(e => {
                      const plan = plans.find(p => p.id === e.benefit_plan_id);
                      return (
                        <tr key={e.id} className="text-sm">
                          <td className="px-5 py-3.5 font-semibold text-slate-900">{plan?.name ?? t('benefitsPlans.planFallback', { id: e.benefit_plan_id })}</td>
                          <td className="px-5 py-3.5">
                            {plan && <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${TYPE_COLORS[plan.type]}`}>{typeLabel(plan.type)}</span>}
                          </td>
                          <td className="px-5 py-3.5 text-slate-700 font-mono">{e.employee_contribution != null ? `¥${e.employee_contribution.toLocaleString()}` : '—'}</td>
                          <td className="px-5 py-3.5 text-teal-700 font-mono">{e.employer_contribution != null ? `¥${e.employer_contribution.toLocaleString()}` : '—'}</td>
                          <td className="px-5 py-3.5 text-slate-500">{e.enrolled_at}</td>
                          <td className="px-5 py-3.5">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${e.ended_at ? 'bg-slate-100 text-slate-500' : 'bg-emerald-100 text-emerald-700'}`}>
                              {e.ended_at ? t('benefitsPlans.statusEnded') : t('benefitsPlans.statusActive')}
                            </span>
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
      </main>

      {planModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6">
            <h2 className="text-lg font-bold text-slate-900 mb-5">{t('benefitsPlans.newPlanTitle')}</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('benefitsPlans.nameLabel')}</label>
                  <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder={t('benefitsPlans.namePlaceholder')}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('benefitsPlans.typeLabel')}</label>
                  <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                    {Object.keys(TYPE_LABELS).map(v => <option key={v} value={v}>{typeLabel(v)}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('benefitsPlans.providerLabel')}</label>
                  <input value={form.provider} onChange={e => setForm(p => ({ ...p, provider: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('benefitsPlans.appliesToFieldLabel')}</label>
                  <select value={form.applies_to} onChange={e => setForm(p => ({ ...p, applies_to: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                    <option value="all">{t('benefitsPlans.appliesAll')}</option>
                    <option value="full_time">{t('benefitsPlans.appliesFullTime')}</option>
                    <option value="management">{t('benefitsPlans.appliesManagement')}</option>
                  </select>
                </div>
              </div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t('benefitsPlans.contributionHint')}</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('benefitsPlans.employeeRate')}</label>
                  <input type="number" step="0.001" value={form.employee_contribution_rate} onChange={e => setForm(p => ({ ...p, employee_contribution_rate: e.target.value }))}
                    placeholder="0.105" className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('benefitsPlans.employerRate')}</label>
                  <input type="number" step="0.001" value={form.employer_contribution_rate} onChange={e => setForm(p => ({ ...p, employer_contribution_rate: e.target.value }))}
                    placeholder="0.16" className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setPlanModal(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">{t('benefitsPlans.cancel')}</button>
              <button onClick={savePlan} disabled={saving || !form.name}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg">
                {saving ? t('benefitsPlans.saving') : t('benefitsPlans.createPlan')}
              </button>
            </div>
          </div>
        </div>
      )}

      {enrollModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h2 className="text-lg font-bold text-slate-900 mb-5">{t('benefitsPlans.enrollTitle')}</h2>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('benefitsPlans.selectPlan')}</label>
              <select value={enrollPlanId ?? ''} onChange={e => setEnrollPlanId(Number(e.target.value))}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                <option value="">{t('benefitsPlans.choosePlan')}</option>
                {plans.filter(p => !enrolledPlanIds.has(p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setEnrollModal(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">{t('benefitsPlans.cancel')}</button>
              <button onClick={enroll} disabled={saving || !enrollPlanId}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg">
                {saving ? t('benefitsPlans.enrolling') : t('benefitsPlans.enroll')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Search, Loader2, Briefcase } from 'lucide-react';
import { getRequisitions, createRequisition, updateRequisition, getDepartments } from '../../../services/hrApi';
import type { JobRequisition, HrDepartment } from '../../../services/hrApi';
import { getUsers } from '../../../services/authApi';
import type { ErpUser } from '../../../types/auth';
import { usePermissions } from '../../../contexts/PermissionContext';
import { supabase } from '../../../lib/supabase';

const STATUS_COLORS: Record<string, string> = {
  draft:     'bg-slate-100 text-slate-600',
  open:      'bg-emerald-100 text-emerald-700',
  on_hold:   'bg-amber-100 text-amber-700',
  filled:    'bg-blue-100 text-blue-700',
  cancelled: 'bg-red-100 text-red-600',
};

interface Props { onSelectRequisition: (id: number) => void; }

export default function JobRequisitions({ onSelectRequisition }: Props) {
  const { t } = useTranslation('hr');
  const { can } = usePermissions();
  const canCreate = can('hr', 'recruitment', 'create');
  const canEdit   = can('hr', 'recruitment', 'edit');

  const [reqs, setReqs]       = useState<JobRequisition[]>([]);
  const [depts, setDepts]     = useState<HrDepartment[]>([]);
  const [employees, setEmployees] = useState<ErpUser[]>([]);
  const [currentErpId, setCurrentErpId] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [modal, setModal]     = useState<{ open: boolean; req: Partial<JobRequisition> | null }>({ open: false, req: null });
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState('');

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
    const [r, d, e] = await Promise.all([
      getRequisitions(),
      getDepartments().catch(() => []),
      getUsers().catch(() => []),
    ]);
    setReqs(r); setDepts(d); setEmployees(e); setLoading(false);
  }

  const filtered = reqs.filter(r => !search || r.title.toLowerCase().includes(search.toLowerCase()));

  function openCreate() {
    setModal({ open: true, req: { title: '', status: 'draft', headcount: 1, hiring_manager: currentErpId || null } });
    setErr('');
  }
  function openEdit(r: JobRequisition) { setModal({ open: true, req: { ...r } }); setErr(''); }

  async function save() {
    if (!modal.req?.title) { setErr(t('jobRequisitions.errTitleRequired')); return; }
    setSaving(true); setErr('');
    try {
      if (modal.req.id) await updateRequisition(modal.req.id, modal.req);
      else await createRequisition(modal.req);
      setModal({ open: false, req: null }); load();
    } catch (e: any) { setErr(e?.message ?? t('jobRequisitions.errGeneric')); }
    setSaving(false);
  }

  return (
    <div className="min-h-screen bg-[#faf8f5] flex flex-col">
      <div className="px-10 pt-8 pb-5 border-b border-slate-200 bg-white">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{t('jobRequisitions.breadcrumb')}</p>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">{t('jobRequisitions.heading')}</h1>
          {canCreate && (
            <button onClick={openCreate} className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold rounded-lg transition-colors">
              <Plus size={14} /> {t('jobRequisitions.newRequisition')}
            </button>
          )}
        </div>
      </div>

      <main className="flex-1 overflow-y-auto px-10 py-7">
        <div className="relative max-w-xs mb-5">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('jobRequisitions.searchPlaceholder')}
            className="w-full pl-8 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" />
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 py-16 justify-center"><Loader2 size={18} className="animate-spin" /></div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                <Briefcase size={32} className="opacity-40" />
                <p className="text-sm">{t('jobRequisitions.empty')}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="bg-slate-50 border-b border-slate-200">
                  {[
                    { k: 'title', label: t('jobRequisitions.colTitle') },
                    { k: 'department', label: t('jobRequisitions.colDepartment') },
                    { k: 'hiringManager', label: t('jobRequisitions.colHiringManager') },
                    { k: 'status', label: t('jobRequisitions.colStatus') },
                    { k: 'headcount', label: t('jobRequisitions.colHeadcount') },
                    { k: 'targetDate', label: t('jobRequisitions.colTargetDate') },
                    { k: 'actions', label: '' },
                  ].map(h =>
                    <th key={h.k} className="px-5 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">{h.label}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(r => (
                    <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3.5 font-semibold text-slate-900 text-sm cursor-pointer hover:text-teal-600" onClick={() => onSelectRequisition(r.id)}>{r.title}</td>
                      <td className="px-5 py-3.5 text-slate-500 text-sm">{r.department_name ?? '—'}</td>
                      <td className="px-5 py-3.5 text-slate-500 text-sm">{r.hiring_manager_name ?? '—'}</td>
                      <td className="px-5 py-3.5">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLORS[r.status]}`}>{r.status.replace('_', ' ')}</span>
                      </td>
                      <td className="px-5 py-3.5 text-slate-500 text-sm">{r.headcount}</td>
                      <td className="px-5 py-3.5 text-slate-500 text-sm">{r.target_fill_date ?? '—'}</td>
                      <td className="px-5 py-3.5 flex gap-2">
                        <button onClick={() => onSelectRequisition(r.id)} className="text-xs text-teal-600 hover:underline font-semibold">{t('jobRequisitions.candidates')}</button>
                        {canEdit && <button onClick={() => openEdit(r)} className="text-xs text-slate-400 hover:text-slate-700">{t('jobRequisitions.edit')}</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>
        )}
      </main>

      {modal.open && modal.req && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-slate-900 mb-5">{modal.req.id ? t('jobRequisitions.modalTitleEdit') : t('jobRequisitions.modalTitleNew')}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('jobRequisitions.fieldJobTitle')}</label>
                <input value={modal.req.title ?? ''} onChange={e => setModal(p => ({ ...p, req: { ...p.req!, title: e.target.value } }))}
                  placeholder={t('jobRequisitions.jobTitlePlaceholder')}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('jobRequisitions.fieldDepartment')}</label>
                  <select value={modal.req.department_id ?? ''} onChange={e => setModal(p => ({ ...p, req: { ...p.req!, department_id: e.target.value ? Number(e.target.value) : null } }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                    <option value="">{t('jobRequisitions.noDepartment')}</option>
                    {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('jobRequisitions.fieldStatus')}</label>
                  <select value={modal.req.status ?? 'draft'} onChange={e => setModal(p => ({ ...p, req: { ...p.req!, status: e.target.value as any } }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                    {['draft','open','on_hold','filled','cancelled'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('jobRequisitions.fieldHiringManager')}</label>
                <select value={modal.req.hiring_manager ?? ''} onChange={e => setModal(p => ({ ...p, req: { ...p.req!, hiring_manager: e.target.value || null } }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                  <option value="">{t('jobRequisitions.unassigned')}</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('jobRequisitions.fieldHeadcount')}</label>
                  <input type="number" min={1} value={modal.req.headcount ?? 1} onChange={e => setModal(p => ({ ...p, req: { ...p.req!, headcount: Number(e.target.value) } }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('jobRequisitions.fieldSalaryMin')}</label>
                  <input type="number" value={modal.req.salary_min ?? ''} onChange={e => setModal(p => ({ ...p, req: { ...p.req!, salary_min: e.target.value ? Number(e.target.value) : null } }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('jobRequisitions.fieldSalaryMax')}</label>
                  <input type="number" value={modal.req.salary_max ?? ''} onChange={e => setModal(p => ({ ...p, req: { ...p.req!, salary_max: e.target.value ? Number(e.target.value) : null } }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('jobRequisitions.fieldTargetFillDate')}</label>
                <input type="date" value={modal.req.target_fill_date ?? ''} onChange={e => setModal(p => ({ ...p, req: { ...p.req!, target_fill_date: e.target.value || null } }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('jobRequisitions.fieldJobDescription')}</label>
                <textarea rows={4} value={modal.req.job_description ?? ''} onChange={e => setModal(p => ({ ...p, req: { ...p.req!, job_description: e.target.value } }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
              </div>
            </div>
            {err && <p className="mt-3 text-xs text-red-500">{err}</p>}
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setModal({ open: false, req: null })} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">{t('jobRequisitions.cancel')}</button>
              <button onClick={save} disabled={saving} className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg">
                {saving ? t('jobRequisitions.saving') : t('jobRequisitions.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

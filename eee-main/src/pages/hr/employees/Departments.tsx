import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Loader2, Building2 } from 'lucide-react';
import { getDepartments, createDepartment, updateDepartment } from '../../../services/hrApi';
import type { HrDepartment } from '../../../services/hrApi';
import { usePermissions } from '../../../contexts/PermissionContext';

export default function Departments() {
  const { can } = usePermissions();
  const canCreate = can('hr', 'departments', 'create');
  const canEdit   = can('hr', 'departments', 'edit');

  const [depts, setDepts]   = useState<HrDepartment[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ open: boolean; dept: Partial<HrDepartment> | null }>({ open: false, dept: null });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function load() { setLoading(true); setDepts(await getDepartments().catch(() => [])); setLoading(false); }
  useEffect(() => { load(); }, []);

  function openCreate() { setModal({ open: true, dept: { name: '', code: '', is_active: true } }); setErr(''); }
  function openEdit(d: HrDepartment) { setModal({ open: true, dept: { ...d } }); setErr(''); }

  async function save() {
    if (!modal.dept) return;
    if (!modal.dept.name || !modal.dept.code) { setErr('Name and code are required'); return; }
    setSaving(true);
    setErr('');
    try {
      if (modal.dept.id) { await updateDepartment(modal.dept.id, modal.dept); }
      else { await createDepartment(modal.dept); }
      setModal({ open: false, dept: null });
      load();
    } catch (e: any) { setErr(e?.message ?? 'Error'); }
    setSaving(false);
  }

  return (
    <div className="min-h-screen bg-[#faf8f5] flex flex-col">
      <div className="px-10 pt-8 pb-5 border-b border-slate-200 bg-white">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">HR / People</p>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">Departments</h1>
          {canCreate && (
            <button onClick={openCreate} className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold rounded-lg transition-colors">
              <Plus size={14} /> New Department
            </button>
          )}
        </div>
      </div>

      <main className="flex-1 overflow-y-auto px-10 py-7">
        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 py-16 justify-center"><Loader2 size={18} className="animate-spin" /> Loading…</div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {depts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                <Building2 size={32} className="opacity-40" />
                <p className="text-sm">No departments yet</p>
              </div>
            ) : (
              <table className="w-full">
                <thead><tr className="bg-slate-50 border-b border-slate-200">
                  {['Name','Code','Head','Cost Center','Headcount','Status',''].map(h => <th key={h} className="px-5 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">{h}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {depts.map(d => (
                    <tr key={d.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3.5 font-semibold text-slate-900 text-sm">{d.name}</td>
                      <td className="px-5 py-3.5 text-slate-500 text-sm font-mono">{d.code}</td>
                      <td className="px-5 py-3.5 text-slate-500 text-sm">{d.head_name ?? '—'}</td>
                      <td className="px-5 py-3.5 text-slate-500 text-sm">{d.cost_center ?? '—'}</td>
                      <td className="px-5 py-3.5 text-slate-500 text-sm">{d.headcount ?? 0}</td>
                      <td className="px-5 py-3.5">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${d.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {d.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        {canEdit && (
                          <button onClick={() => openEdit(d)} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-teal-600 transition-colors">
                            <Pencil size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </main>

      {modal.open && modal.dept && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-slate-900 mb-5">{modal.dept.id ? 'Edit' : 'New'} Department</h2>
            <div className="space-y-4">
              {[
                { label: 'Department Name', key: 'name', placeholder: 'e.g. Engineering' },
                { label: 'Code', key: 'code', placeholder: 'e.g. ENG' },
                { label: 'Cost Center', key: 'cost_center', placeholder: 'e.g. 6100' },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{f.label}</label>
                  <input value={(modal.dept as any)[f.key] ?? ''} onChange={e => setModal(p => ({ ...p, dept: { ...p.dept!, [f.key]: e.target.value } }))}
                    placeholder={f.placeholder}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              ))}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={modal.dept.is_active ?? true} onChange={e => setModal(p => ({ ...p, dept: { ...p.dept!, is_active: e.target.checked } }))} className="rounded" />
                <span className="text-sm text-slate-700">Active</span>
              </label>
            </div>
            {err && <p className="mt-3 text-xs text-red-500">{err}</p>}
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setModal({ open: false, dept: null })} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
              <button onClick={save} disabled={saving} className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg transition-colors">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

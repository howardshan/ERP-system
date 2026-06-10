import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, ClipboardList, CheckCircle2, Circle, Clock } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { getUsers } from '../../../services/authApi';
import type { ErpUser } from '../../../types/auth';

interface ChecklistItem {
  id: number;
  checklist_id: number;
  task_name: string;
  description: string | null;
  due_date: string | null;
  assigned_to: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  completed_at: string | null;
}

interface Checklist {
  id: number;
  employee_id: string;
  employee_name?: string;
  created_at: string;
  tasks: ChecklistItem[];
}

async function getChecklists(): Promise<Checklist[]> {
  const { data, error } = await supabase
    .from('hr_onboarding_checklist')
    .select(`*, employee:erp_user!employee_id(full_name), tasks:hr_onboarding_task(*)`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((c: any) => ({ ...c, employee_name: c.employee?.full_name ?? null, tasks: c.tasks ?? [] }));
}

async function updateTaskStatus(taskId: number, status: ChecklistItem['status']): Promise<void> {
  await supabase.from('hr_onboarding_task').update({ status, completed_at: status === 'completed' ? new Date().toISOString() : null }).eq('id', taskId);
}

async function createChecklist(employeeId: string, templateId: number): Promise<void> {
  const { data: tmpl } = await supabase.from('hr_onboarding_template').select(`*, tasks:hr_onboarding_template_task(*)`).eq('id', templateId).single();
  if (!tmpl) throw new Error('Template not found');

  const { data: emp } = await supabase.from('erp_user').select('start_date').eq('id', employeeId).single();
  const startDate = emp?.start_date ? new Date(emp.start_date) : new Date();

  const { data: cl } = await supabase.from('hr_onboarding_checklist').insert({ employee_id: employeeId, template_id: templateId }).select().single();
  if (!cl) return;

  const tasks = (tmpl.tasks ?? []).map((t: any) => {
    const due = new Date(startDate);
    due.setDate(due.getDate() + t.due_offset_days);
    return { checklist_id: cl.id, task_name: t.task_name, description: t.description, due_date: due.toISOString().slice(0, 10), status: 'pending', sort_order: t.sort_order };
  });
  if (tasks.length > 0) await supabase.from('hr_onboarding_task').insert(tasks);
}

const ROLE_COLORS: Record<string, string> = {
  hr: 'bg-teal-100 text-teal-700', it: 'bg-blue-100 text-blue-700',
  manager: 'bg-purple-100 text-purple-700', employee: 'bg-amber-100 text-amber-700',
};

export default function OnboardingDashboard() {
  const { t } = useTranslation('hr');
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [templates, setTemplates]   = useState<any[]>([]);
  const [employees, setEmployees]   = useState<ErpUser[]>([]);
  const [loading, setLoading]       = useState(true);
  const [expanded, setExpanded]     = useState<Set<number>>(new Set());
  const [modal, setModal]           = useState(false);
  const [form, setForm]             = useState({ employee_id: '', template_id: 0 });
  const [saving, setSaving]         = useState(false);

  async function load() {
    setLoading(true);
    const [cl, tmpl, emp] = await Promise.all([
      getChecklists().catch(() => []),
      supabase.from('hr_onboarding_template').select('*').then(r => r.data ?? []),
      getUsers().catch(() => []),
    ]);
    setChecklists(cl); setTemplates(tmpl); setEmployees(emp); setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function toggleTask(taskId: number, current: ChecklistItem['status']) {
    const next = current === 'completed' ? 'pending' : 'completed';
    await updateTaskStatus(taskId, next);
    load();
  }

  async function startChecklist() {
    if (!form.employee_id || !form.template_id) return;
    setSaving(true);
    await createChecklist(form.employee_id, form.template_id);
    setModal(false); load();
    setSaving(false);
  }

  return (
    <div className="min-h-screen bg-[#faf8f5] flex flex-col">
      <div className="px-10 pt-8 pb-5 border-b border-slate-200 bg-white">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{t('onboardingDashboard.breadcrumb')}</p>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">{t('onboardingDashboard.title')}</h1>
          <button onClick={() => setModal(true)} className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold rounded-lg transition-colors">
            {t('onboardingDashboard.startOnboarding')}
          </button>
        </div>
      </div>

      <main className="flex-1 overflow-y-auto px-10 py-7">
        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 py-16 justify-center"><Loader2 size={18} className="animate-spin" /></div>
        ) : checklists.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
            <ClipboardList size={40} className="opacity-40" />
            <p className="text-sm">{t('onboardingDashboard.empty')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {checklists.map(cl => {
              const completed = cl.tasks.filter(t => t.status === 'completed').length;
              const pct = cl.tasks.length > 0 ? Math.round((completed / cl.tasks.length) * 100) : 0;
              const isExpanded = expanded.has(cl.id);
              return (
                <div key={cl.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-6 py-4 flex items-center gap-4 cursor-pointer hover:bg-slate-50" onClick={() => setExpanded(p => { const n = new Set(p); n.has(cl.id) ? n.delete(cl.id) : n.add(cl.id); return n; })}>
                    <div className="flex-1">
                      <p className="font-semibold text-slate-900">{cl.employee_name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{t('onboardingDashboard.started', { date: new Date(cl.created_at).toLocaleDateString() })}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-32 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-teal-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-bold text-slate-600">{completed}/{cl.tasks.length}</span>
                      <span className={`text-xs font-bold ${pct === 100 ? 'text-emerald-600' : 'text-slate-500'}`}>{pct}%</span>
                    </div>
                    <span className="text-slate-400 text-xs">{isExpanded ? '▲' : '▼'}</span>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-slate-100 divide-y divide-slate-50">
                      {cl.tasks.sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? '')).map(task => (
                        <div key={task.id} className="px-6 py-3 flex items-start gap-3">
                          <button onClick={() => toggleTask(task.id, task.status)} className="mt-0.5 shrink-0">
                            {task.status === 'completed' ? <CheckCircle2 size={16} className="text-emerald-500" /> : task.status === 'in_progress' ? <Clock size={16} className="text-amber-500" /> : <Circle size={16} className="text-slate-300" />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-semibold ${task.status === 'completed' ? 'line-through text-slate-400' : 'text-slate-900'}`}>{task.task_name}</p>
                            {task.description && <p className="text-xs text-slate-400 mt-0.5">{task.description}</p>}
                            {task.due_date && <p className="text-[10px] text-slate-400 mt-1">{t('onboardingDashboard.due', { date: task.due_date })}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-slate-900 mb-5">{t('onboardingDashboard.modalTitle')}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('onboardingDashboard.employee')}</label>
                <select value={form.employee_id} onChange={e => setForm(p => ({ ...p, employee_id: e.target.value }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                  <option value="">{t('onboardingDashboard.selectEmployee')}</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('onboardingDashboard.template')}</label>
                <select value={form.template_id} onChange={e => setForm(p => ({ ...p, template_id: Number(e.target.value) }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                  <option value={0}>{t('onboardingDashboard.selectTemplate')}</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setModal(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">{t('onboardingDashboard.cancel')}</button>
              <button onClick={startChecklist} disabled={saving || !form.employee_id || !form.template_id}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg">
                {saving ? t('onboardingDashboard.starting') : t('onboardingDashboard.startOnboarding')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

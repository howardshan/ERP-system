import React, { useEffect, useState } from 'react';
import { Loader2, Plus, Target, TrendingUp } from 'lucide-react';
import { getGoals, createGoal, updateGoalProgress, getReviewCycles } from '../../../services/hrApi';
import type { Goal, ReviewCycle } from '../../../services/hrApi';
import { getUsers } from '../../../services/authApi';
import type { ErpUser } from '../../../types/auth';
import { usePermissions } from '../../../contexts/PermissionContext';
import { supabase } from '../../../lib/supabase';

const STATUS_COLORS: Record<string, string> = {
  on_track: 'bg-emerald-100 text-emerald-700',
  at_risk: 'bg-amber-100 text-amber-700',
  completed: 'bg-teal-100 text-teal-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

export default function Goals() {
  const { can } = usePermissions();
  const canManage = can('hr', 'performance', 'manage');

  const [goals, setGoals] = useState<Goal[]>([]);
  const [cycles, setCycles] = useState<ReviewCycle[]>([]);
  const [employees, setEmployees] = useState<ErpUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentErpId, setCurrentErpId] = useState('');
  const [selectedEmp, setSelectedEmp] = useState('');
  const [selectedCycle, setSelectedCycle] = useState('');
  const [modal, setModal] = useState(false);
  const [progressModal, setProgressModal] = useState<Goal | null>(null);
  const [progress, setProgress] = useState(0);
  const [form, setForm] = useState({ title: '', description: '', target: '', due_date: '', status: 'on_track' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: eu } = await supabase.from('erp_user').select('id').eq('auth_user_id', user.id).single();
        if (eu) { setCurrentErpId(eu.id); setSelectedEmp(eu.id); }
      }
    })();
    Promise.all([getReviewCycles(), getUsers().catch(() => [])]).then(([c, e]) => {
      setCycles(c); setEmployees(e); setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (selectedEmp) {
      getGoals(selectedEmp, selectedCycle ? Number(selectedCycle) : undefined).then(setGoals).catch(() => setGoals([]));
    }
  }, [selectedEmp, selectedCycle]);

  async function saveGoal() {
    if (!form.title || !selectedEmp) return;
    setSaving(true);
    await createGoal({ employee_id: selectedEmp, review_cycle_id: selectedCycle ? Number(selectedCycle) : undefined, ...form, status: form.status as Goal['status'] });
    setModal(false);
    getGoals(selectedEmp, selectedCycle ? Number(selectedCycle) : undefined).then(setGoals);
    setSaving(false);
  }

  async function saveProgress() {
    if (!progressModal) return;
    setSaving(true);
    await updateGoalProgress(progressModal.id, progress);
    setProgressModal(null);
    getGoals(selectedEmp, selectedCycle ? Number(selectedCycle) : undefined).then(setGoals);
    setSaving(false);
  }

  const byStatus = (status: string) => goals.filter(g => g.status === status);
  const completedPct = goals.length ? Math.round(byStatus('completed').length / goals.length * 100) : 0;

  return (
    <div className="min-h-screen bg-[#faf8f5] flex flex-col">
      <div className="px-10 pt-8 pb-5 border-b border-slate-200 bg-white">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">HR / Performance</p>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">Goals & OKRs</h1>
          {selectedEmp && (
            <button onClick={() => { setModal(true); setForm({ title: '', description: '', target: '', due_date: '', status: 'on_track' }); }}
              className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold rounded-lg">
              <Plus size={14} /> New Goal
            </button>
          )}
        </div>
      </div>

      <main className="flex-1 overflow-y-auto px-10 py-7">
        <div className="flex gap-4 mb-6">
          {canManage && (
            <div className="max-w-xs flex-1">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Employee</label>
              <select value={selectedEmp} onChange={e => setSelectedEmp(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                <option value="">Select employee</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
            </div>
          )}
          <div className="max-w-xs flex-1">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Review Cycle</label>
            <select value={selectedCycle} onChange={e => setSelectedCycle(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
              <option value="">All cycles</option>
              {cycles.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 py-16 justify-center"><Loader2 size={18} className="animate-spin" /></div>
        ) : !selectedEmp ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
            <Target size={40} className="opacity-30" />
            <p className="text-sm">Select an employee to view their goals</p>
          </div>
        ) : goals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
            <Target size={40} className="opacity-30" />
            <p className="text-sm">No goals set for this period</p>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-slate-900">Progress Overview</h3>
                <span className="text-sm font-bold text-teal-700">{completedPct}% completed</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2.5">
                <div className="bg-teal-500 h-2.5 rounded-full transition-all" style={{ width: `${completedPct}%` }} />
              </div>
              <div className="flex gap-4 mt-3 text-xs text-slate-400">
                <span>On Track: <b className="text-emerald-600">{byStatus('on_track').length}</b></span>
                <span>At Risk: <b className="text-amber-600">{byStatus('at_risk').length}</b></span>
                <span>Completed: <b className="text-teal-600">{byStatus('completed').length}</b></span>
                <span>Total: <b className="text-slate-700">{goals.length}</b></span>
              </div>
            </div>

            <div className="space-y-3">
              {goals.map(g => (
                <div key={g.id} className="bg-white border border-slate-200 rounded-xl p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLORS[g.status]}`}>{g.status.replace('_', ' ')}</span>
                        {g.due_date && <span className="text-[10px] text-slate-400">Due: {g.due_date}</span>}
                      </div>
                      <h4 className="text-sm font-bold text-slate-900">{g.title}</h4>
                      {g.description && <p className="text-xs text-slate-500 mt-0.5">{g.description}</p>}
                      {g.target && <p className="text-xs text-slate-400 mt-1">Target: <span className="text-slate-600 font-medium">{g.target}</span></p>}
                    </div>
                    <button onClick={() => { setProgressModal(g); setProgress(g.progress); }}
                      className="ml-4 flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-teal-600 bg-teal-50 hover:bg-teal-100 rounded-lg transition-colors">
                      <TrendingUp size={12} /> Update
                    </button>
                  </div>
                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-slate-400 uppercase font-bold">Progress</span>
                      <span className="text-xs font-bold text-slate-700">{g.progress}%</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full transition-all ${g.status === 'completed' ? 'bg-teal-500' : g.status === 'at_risk' ? 'bg-amber-400' : 'bg-blue-500'}`}
                        style={{ width: `${g.progress}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6">
            <h2 className="text-lg font-bold text-slate-900 mb-5">New Goal</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Title *</label>
                <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="e.g. Increase customer retention by 15%"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Measurable Target</label>
                <input value={form.target} onChange={e => setForm(p => ({ ...p, target: e.target.value }))} placeholder="e.g. NPS score ≥ 70, Churn rate < 5%"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Description</label>
                <textarea rows={2} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Due Date</label>
                  <input type="date" value={form.due_date} onChange={e => setForm(p => ({ ...p, due_date: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Status</label>
                  <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                    <option value="on_track">On Track</option>
                    <option value="at_risk">At Risk</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setModal(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
              <button onClick={saveGoal} disabled={saving || !form.title}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg">
                {saving ? 'Saving…' : 'Create Goal'}
              </button>
            </div>
          </div>
        </div>
      )}

      {progressModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h2 className="text-lg font-bold text-slate-900 mb-1">Update Progress</h2>
            <p className="text-xs text-slate-400 mb-5">{progressModal.title}</p>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Progress: {progress}%</label>
              <input type="range" min={0} max={100} step={5} value={progress} onChange={e => setProgress(Number(e.target.value))}
                className="w-full accent-teal-500" />
              <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                <span>0%</span><span>50%</span><span>100%</span>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setProgressModal(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
              <button onClick={saveProgress} disabled={saving}
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

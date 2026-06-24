import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Plus, ChevronRight, Star } from 'lucide-react';
import { getReviewCycles, createReviewCycle, getReviews, submitSelfReview, submitManagerReview } from '../../../services/hrApi';
import type { ReviewCycle, Review } from '../../../services/hrApi';
import { usePermissions } from '../../../contexts/PermissionContext';
import { supabase } from '../../../lib/supabase';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  active: 'bg-blue-100 text-blue-700',
  self_review: 'bg-amber-100 text-amber-700',
  manager_review: 'bg-purple-100 text-purple-700',
  calibration: 'bg-orange-100 text-orange-700',
  completed: 'bg-emerald-100 text-emerald-700',
};

const REVIEW_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-500',
  self_complete: 'bg-amber-100 text-amber-700',
  manager_complete: 'bg-blue-100 text-blue-700',
  calibrated: 'bg-emerald-100 text-emerald-700',
};

function StarRating({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <button key={i} type="button" onClick={() => onChange?.(i)} disabled={!onChange}
          className={`${i <= value ? 'text-amber-400' : 'text-slate-200'} ${onChange ? 'hover:text-amber-300 cursor-pointer' : 'cursor-default'}`}>
          <Star size={16} fill={i <= value ? 'currentColor' : 'none'} />
        </button>
      ))}
    </div>
  );
}

export default function ReviewCycles() {
  const { t } = useTranslation('hr');
  const { can } = usePermissions();
  const canManage = can('hr', 'performance', 'manage');

  const [cycles, setCycles] = useState<ReviewCycle[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [selectedCycle, setSelectedCycle] = useState<ReviewCycle | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentErpId, setCurrentErpId] = useState('');
  const [cycleModal, setCycleModal] = useState(false);
  const [reviewPanel, setReviewPanel] = useState<Review | null>(null);
  const [reviewForm, setReviewForm] = useState({ rating: 0, summary: '', goals_met: '' });
  const [mgrForm, setMgrForm] = useState({ rating: 0, summary: '', strengths: '', improvements: '' });
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', period_start: '', period_end: '' });

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: eu } = await supabase.from('erp_user').select('id').eq('auth_user_id', user.id).single();
        if (eu) setCurrentErpId(eu.id);
      }
    })();
    getReviewCycles().then(c => { setCycles(c); setLoading(false); });
  }, []);

  async function selectCycle(cycle: ReviewCycle) {
    setSelectedCycle(cycle);
    setReviews(await getReviews(cycle.id));
  }

  async function saveCycle() {
    if (!form.name || !form.period_start || !form.period_end) return;
    setSaving(true);
    await createReviewCycle(form);
    setCycleModal(false);
    getReviewCycles().then(setCycles);
    setSaving(false);
  }

  async function saveSelfReview() {
    if (!reviewPanel) return;
    setSaving(true);
    await submitSelfReview(reviewPanel.id, { self_rating: reviewForm.rating, self_summary: reviewForm.summary, self_goals_met: reviewForm.goals_met });
    setReviewPanel(null);
    if (selectedCycle) setReviews(await getReviews(selectedCycle.id));
    setSaving(false);
  }

  async function saveMgrReview() {
    if (!reviewPanel) return;
    setSaving(true);
    await submitManagerReview(reviewPanel.id, { manager_rating: mgrForm.rating, manager_summary: mgrForm.summary, final_rating: mgrForm.rating, strengths: mgrForm.strengths, improvements: mgrForm.improvements });
    setReviewPanel(null);
    if (selectedCycle) setReviews(await getReviews(selectedCycle.id));
    setSaving(false);
  }

  const myReviews = reviews.filter(r => r.employee_id === currentErpId);
  const managerReviews = reviews.filter(r => r.reviewer_id === currentErpId);

  return (
    <div className="min-h-screen bg-[#faf8f5] flex flex-col">
      <div className="px-10 pt-8 pb-5 border-b border-slate-200 bg-white">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{t('reviewCycles.breadcrumb')}</p>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">{t('reviewCycles.title')}</h1>
          {canManage && (
            <button onClick={() => { setCycleModal(true); setForm({ name: '', period_start: '', period_end: '' }); }}
              className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold rounded-lg">
              <Plus size={14} /> {t('reviewCycles.newCycle')}
            </button>
          )}
        </div>
      </div>

      <main className="flex-1 overflow-y-auto px-10 py-7">
        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 py-16 justify-center"><Loader2 size={18} className="animate-spin" /></div>
        ) : (
          <div className="flex gap-6">
            <div className="w-72 flex-shrink-0 space-y-2">
              {cycles.length === 0 && (
                <div className="bg-white border border-slate-200 rounded-xl p-6 text-center text-slate-400 text-sm">{t('reviewCycles.empty')}</div>
              )}
              {cycles.map(c => (
                <button key={c.id} onClick={() => selectCycle(c)}
                  className={`w-full text-left bg-white border rounded-xl p-4 transition-colors ${selectedCycle?.id === c.id ? 'border-teal-400 ring-1 ring-teal-400' : 'border-slate-200 hover:border-slate-300'}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-bold text-slate-900">{c.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{c.period_start} → {c.period_end}</p>
                    </div>
                    <ChevronRight size={14} className="text-slate-400 mt-0.5" />
                  </div>
                  <span className={`mt-2 inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLORS[c.status]}`}>{c.status.replace('_', ' ')}</span>
                </button>
              ))}
            </div>

            {selectedCycle && (
              <div className="flex-1 space-y-5">
                {myReviews.length > 0 && (
                  <div>
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">{t('reviewCycles.myReviews')}</h3>
                    <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
                      <table className="w-full">
                        <thead><tr className="bg-slate-50 border-b border-slate-200">
                          {[t('reviewCycles.colReviewer'),t('reviewCycles.colSelfRating'),t('reviewCycles.colManagerRating'),t('reviewCycles.colFinal'),t('reviewCycles.colStatus'),''].map((h, i) =>
                            <th key={i} className="px-5 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">{h}</th>)}
                        </tr></thead>
                        <tbody className="divide-y divide-slate-100">
                          {myReviews.map(r => (
                            <tr key={r.id} className="text-sm">
                              <td className="px-5 py-3.5 text-slate-700">{r.reviewer_name ?? r.reviewer_id}</td>
                              <td className="px-5 py-3.5">{r.self_rating ? <StarRating value={r.self_rating} /> : <span className="text-slate-400 text-xs">—</span>}</td>
                              <td className="px-5 py-3.5">{r.manager_rating ? <StarRating value={r.manager_rating} /> : <span className="text-slate-400 text-xs">—</span>}</td>
                              <td className="px-5 py-3.5">{r.final_rating ? <StarRating value={r.final_rating} /> : <span className="text-slate-400 text-xs">—</span>}</td>
                              <td className="px-5 py-3.5"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${REVIEW_STATUS_COLORS[r.status]}`}>{r.status.replace('_', ' ')}</span></td>
                              <td className="px-5 py-3.5">
                                {r.status === 'pending' && r.employee_id === currentErpId && (
                                  <button onClick={() => { setReviewPanel(r); setReviewForm({ rating: 0, summary: '', goals_met: '' }); }}
                                    className="text-xs font-bold text-teal-600 hover:underline">{t('reviewCycles.selfReview')}</button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {managerReviews.length > 0 && (
                  <div>
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">{t('reviewCycles.reviewsToComplete')}</h3>
                    <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
                      <table className="w-full">
                        <thead><tr className="bg-slate-50 border-b border-slate-200">
                          {[t('reviewCycles.colEmployee'),t('reviewCycles.colSelfRating'),t('reviewCycles.colManagerRating'),t('reviewCycles.colStatus'),''].map((h, i) =>
                            <th key={i} className="px-5 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">{h}</th>)}
                        </tr></thead>
                        <tbody className="divide-y divide-slate-100">
                          {managerReviews.map(r => (
                            <tr key={r.id} className="text-sm">
                              <td className="px-5 py-3.5 font-semibold text-slate-900">{r.employee_name ?? r.employee_id}</td>
                              <td className="px-5 py-3.5">{r.self_rating ? <StarRating value={r.self_rating} /> : <span className="text-slate-400 text-xs">{t('reviewCycles.pendingSelfReview')}</span>}</td>
                              <td className="px-5 py-3.5">{r.manager_rating ? <StarRating value={r.manager_rating} /> : <span className="text-slate-400 text-xs">—</span>}</td>
                              <td className="px-5 py-3.5"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${REVIEW_STATUS_COLORS[r.status]}`}>{r.status.replace('_', ' ')}</span></td>
                              <td className="px-5 py-3.5">
                                {r.status === 'self_complete' && (
                                  <button onClick={() => { setReviewPanel(r); setMgrForm({ rating: 0, summary: '', strengths: '', improvements: '' }); }}
                                    className="text-xs font-bold text-teal-600 hover:underline">{t('reviewCycles.submitReview')}</button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {canManage && (
                  <div>
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">{t('reviewCycles.allReviews', { count: reviews.length })}</h3>
                    <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
                      <table className="w-full">
                        <thead><tr className="bg-slate-50 border-b border-slate-200">
                          {[t('reviewCycles.colEmployee'),t('reviewCycles.colReviewer'),t('reviewCycles.colSelf'),t('reviewCycles.colManager'),t('reviewCycles.colFinal'),t('reviewCycles.colStatus')].map((h, i) =>
                            <th key={i} className="px-5 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">{h}</th>)}
                        </tr></thead>
                        <tbody className="divide-y divide-slate-100">
                          {reviews.map(r => (
                            <tr key={r.id} className="text-sm">
                              <td className="px-5 py-3.5 font-semibold text-slate-900">{r.employee_name ?? r.employee_id}</td>
                              <td className="px-5 py-3.5 text-slate-500">{r.reviewer_name ?? r.reviewer_id}</td>
                              <td className="px-5 py-3.5">{r.self_rating ?? '—'}</td>
                              <td className="px-5 py-3.5">{r.manager_rating ?? '—'}</td>
                              <td className="px-5 py-3.5 font-bold text-teal-700">{r.final_rating ?? '—'}</td>
                              <td className="px-5 py-3.5"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${REVIEW_STATUS_COLORS[r.status]}`}>{r.status.replace('_', ' ')}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {cycleModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-slate-900 mb-5">{t('reviewCycles.newCycleTitle')}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('reviewCycles.nameLabel')}</label>
                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder={t('reviewCycles.namePlaceholder')}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('reviewCycles.periodStart')}</label>
                  <input type="date" value={form.period_start} onChange={e => setForm(p => ({ ...p, period_start: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('reviewCycles.periodEnd')}</label>
                  <input type="date" value={form.period_end} onChange={e => setForm(p => ({ ...p, period_end: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setCycleModal(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">{t('reviewCycles.cancel')}</button>
              <button onClick={saveCycle} disabled={saving || !form.name}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg">
                {saving ? t('reviewCycles.creating') : t('reviewCycles.create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {reviewPanel && reviewPanel.employee_id === currentErpId && reviewPanel.status === 'pending' && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6">
            <h2 className="text-lg font-bold text-slate-900 mb-1">{t('reviewCycles.selfReviewTitle')}</h2>
            <p className="text-xs text-slate-400 mb-5">{selectedCycle?.name}</p>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">{t('reviewCycles.overallRating')}</label>
                <StarRating value={reviewForm.rating} onChange={v => setReviewForm(p => ({ ...p, rating: v }))} />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('reviewCycles.summary')}</label>
                <textarea rows={3} value={reviewForm.summary} onChange={e => setReviewForm(p => ({ ...p, summary: e.target.value }))}
                  placeholder={t('reviewCycles.summaryPlaceholder')}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('reviewCycles.goalsMet')}</label>
                <textarea rows={2} value={reviewForm.goals_met} onChange={e => setReviewForm(p => ({ ...p, goals_met: e.target.value }))}
                  placeholder={t('reviewCycles.goalsMetPlaceholder')}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setReviewPanel(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">{t('reviewCycles.cancel')}</button>
              <button onClick={saveSelfReview} disabled={saving || !reviewForm.rating}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg">
                {saving ? t('reviewCycles.submitting') : t('reviewCycles.submitSelfReview')}
              </button>
            </div>
          </div>
        </div>
      )}

      {reviewPanel && reviewPanel.reviewer_id === currentErpId && reviewPanel.status === 'self_complete' && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6">
            <h2 className="text-lg font-bold text-slate-900 mb-1">{t('reviewCycles.managerReviewTitle')}</h2>
            <p className="text-xs text-slate-400 mb-5">{reviewPanel.employee_name} — {selectedCycle?.name}</p>
            {reviewPanel.self_summary && (
              <div className="bg-slate-50 rounded-lg p-4 mb-4">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{t('reviewCycles.employeeSelfSummary')}</p>
                <p className="text-sm text-slate-700">{reviewPanel.self_summary}</p>
              </div>
            )}
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">{t('reviewCycles.overallRating')}</label>
                <StarRating value={mgrForm.rating} onChange={v => setMgrForm(p => ({ ...p, rating: v }))} />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('reviewCycles.summary')}</label>
                <textarea rows={3} value={mgrForm.summary} onChange={e => setMgrForm(p => ({ ...p, summary: e.target.value }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('reviewCycles.strengths')}</label>
                  <textarea rows={3} value={mgrForm.strengths} onChange={e => setMgrForm(p => ({ ...p, strengths: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('reviewCycles.areasToImprove')}</label>
                  <textarea rows={3} value={mgrForm.improvements} onChange={e => setMgrForm(p => ({ ...p, improvements: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setReviewPanel(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">{t('reviewCycles.cancel')}</button>
              <button onClick={saveMgrReview} disabled={saving || !mgrForm.rating}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg">
                {saving ? t('reviewCycles.submitting') : t('reviewCycles.submitReview')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

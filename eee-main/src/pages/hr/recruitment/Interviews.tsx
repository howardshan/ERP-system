import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Loader2, Star, CheckCircle2, XCircle, AlertCircle, ExternalLink, FileText, Calendar } from 'lucide-react';
import {
  getInterviews, scheduleInterviewWithPanelists, updateInterview,
  getInterviewPanelists, addPanelist, getScorecards, submitScorecard,
  getCandidates, getRequisitions, getTeamAvailability, respondToCalendarEvent,
  getMyPendingInterviewEvents,
} from '../../../services/hrApi';
import type { Interview, InterviewScorecard, Candidate, JobRequisition, CalendarEvent } from '../../../services/hrApi';
import { getUsers } from '../../../services/authApi';
import type { ErpUser } from '../../../types/auth';
import { usePermissions } from '../../../contexts/PermissionContext';
import { supabase } from '../../../lib/supabase';
import InterviewCalendar from './InterviewCalendar';

const TYPE_LABELS: Record<string, string> = {
  phone_screen: 'Phone Screen', technical: 'Technical', behavioral: 'Behavioral',
  culture_fit: 'Culture Fit', panel: 'Panel', final: 'Final',
};
const STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-700', completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-500', no_show: 'bg-red-100 text-red-600',
};
const EVENT_STATUS_COLORS: Record<string, string> = {
  tentative: 'bg-amber-100 text-amber-700',
  confirmed: 'bg-emerald-100 text-emerald-700',
  declined:  'bg-red-100 text-red-600',
  cancelled: 'bg-slate-100 text-slate-500',
};
const REC_COLORS: Record<string, string> = {
  strong_hire: 'text-emerald-700', hire: 'text-teal-600', neutral: 'text-slate-500',
  no_hire: 'text-orange-600', strong_no_hire: 'text-red-600',
};

function Stars({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {[1,2,3,4,5].map(n => (
        <Star key={n} size={14}
          className={`${n <= value ? 'fill-amber-400 text-amber-400' : 'text-slate-300'} ${onChange ? 'cursor-pointer' : ''}`}
          onClick={() => onChange?.(n)} />
      ))}
    </div>
  );
}

interface PanelistRow { user: ErpUser; role: 'lead' | 'support' | 'observer'; availability?: 'free' | 'tentative' | 'busy'; }

export default function Interviews() {
  const { t } = useTranslation('hr');
  const { can } = usePermissions();
  const canCreate = can('hr', 'recruitment', 'create');
  const typeLabel = (k: string) => t(`interviews.type.${k}`, { defaultValue: TYPE_LABELS[k] ?? k });

  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [allUsers, setAllUsers]     = useState<ErpUser[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [reqs, setReqs]             = useState<JobRequisition[]>([]);
  const [loading, setLoading]       = useState(true);
  const [selected, setSelected]     = useState<Interview | null>(null);
  const [panelists, setPanelists]   = useState<any[]>([]);
  const [scorecards, setScorecards] = useState<InterviewScorecard[]>([]);
  const [panelistEvents, setPanelistEvents] = useState<Record<string, CalendarEvent>>({});
  const [myPendingEvents, setMyPendingEvents] = useState<Record<number, CalendarEvent>>({});
  const [modal, setModal]           = useState(false);
  const [saving, setSaving]         = useState(false);
  const [scorecardForm, setScorecardForm] = useState<Partial<InterviewScorecard> | null>(null);
  const [jdPopup, setJdPopup]       = useState<string | null>(null);
  const [currentErpId, setCurrentErpId] = useState('');

  // New interview form state
  const [form, setForm] = useState({
    candidate_id: 0,
    requisition_id: 0,
    round: 1,
    interview_type: 'technical',
    scheduled_at: '',
    duration_mins: 60,
    location: '',
  });
  const [formPanelists, setFormPanelists] = useState<PanelistRow[]>([]);
  const [addingPanelist, setAddingPanelist] = useState('');
  const [availLoading, setAvailLoading] = useState(false);

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
    const [iv, users, cands, rList] = await Promise.all([
      getInterviews(),
      getUsers().catch(() => []),
      getCandidates().catch(() => []),
      getRequisitions().catch(() => []),
    ]);
    setInterviews(iv);
    setAllUsers(users);
    setCandidates(cands);
    setReqs(rList);
    setLoading(false);
  }

  // Reload pending calendar events for the current user to show badges
  const loadPendingEvents = useCallback(async (erpId: string) => {
    if (!erpId) return;
    const evs = await getMyPendingInterviewEvents(erpId).catch(() => []);
    const map: Record<number, CalendarEvent> = {};
    for (const ev of evs) if (ev.interview_id) map[ev.interview_id] = ev;
    setMyPendingEvents(map);
  }, []);

  useEffect(() => { if (currentErpId) loadPendingEvents(currentErpId); }, [currentErpId]);

  async function selectInterview(iv: Interview) {
    setSelected(iv);
    const [p, s] = await Promise.all([getInterviewPanelists(iv.id), getScorecards(iv.id)]);
    setPanelists(p);
    setScorecards(s);
    // load calendar events for each panelist on this interview
    if (p.length > 0) {
      const { data: evs } = await supabase
        .from('hr_calendar_event')
        .select('*')
        .eq('interview_id', iv.id)
        .in('owner_id', p.map((x: any) => x.interviewer_id));
      const evMap: Record<string, CalendarEvent> = {};
      for (const ev of (evs ?? [])) evMap[ev.owner_id] = ev;
      setPanelistEvents(evMap);
    } else {
      setPanelistEvents({});
    }
  }

  // Check availability when time/panelists change
  async function checkAvailability() {
    if (!form.scheduled_at || !form.duration_mins || formPanelists.length === 0) return;
    setAvailLoading(true);
    const start = new Date(form.scheduled_at).toISOString();
    const end = new Date(new Date(form.scheduled_at).getTime() + form.duration_mins * 60000).toISOString();
    const avail = await getTeamAvailability(formPanelists.map(p => p.user.id), start, end);
    setFormPanelists(prev => prev.map(p => {
      const conflicts = avail[p.user.id] ?? [];
      return { ...p, availability: conflicts.length === 0 ? 'free' : conflicts.some(e => e.status === 'confirmed') ? 'busy' : 'tentative' };
    }));
    setAvailLoading(false);
  }

  useEffect(() => { checkAvailability(); }, [form.scheduled_at, form.duration_mins, formPanelists.length]);

  function addPanelistToForm() {
    if (!addingPanelist) return;
    const user = allUsers.find(u => u.id === addingPanelist);
    if (!user || formPanelists.some(p => p.user.id === addingPanelist)) return;
    setFormPanelists(prev => [...prev, { user, role: 'support' }]);
    setAddingPanelist('');
  }

  async function saveInterview() {
    if (!form.candidate_id) return;
    setSaving(true);
    await scheduleInterviewWithPanelists(
      { ...form, requisition_id: form.requisition_id || null } as any,
      formPanelists.map(p => ({ id: p.user.id, role: p.role }))
    );
    setModal(false);
    setForm({ candidate_id: 0, requisition_id: 0, round: 1, interview_type: 'technical', scheduled_at: '', duration_mins: 60, location: '' });
    setFormPanelists([]);
    load();
    if (currentErpId) loadPendingEvents(currentErpId);
    setSaving(false);
  }

  async function saveScorecard() {
    if (!selected || !scorecardForm) return;
    await submitScorecard({ ...scorecardForm, interview_id: selected.id });
    const s = await getScorecards(selected.id);
    setScorecards(s);
    setScorecardForm(null);
  }

  async function respond(eventId: number, status: 'confirmed' | 'declined') {
    await respondToCalendarEvent(eventId, status);
    if (selected) selectInterview(selected);
    if (currentErpId) loadPendingEvents(currentErpId);
  }

  const avgScore = (field: keyof InterviewScorecard) => {
    const vals = scorecards.map(s => s[field] as number).filter(v => v != null);
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : '—';
  };

  const selectedReq = reqs.find(r => r.id === form.requisition_id);

  return (
    <div className="min-h-screen bg-[#faf8f5] flex flex-col">
      <div className="px-10 pt-8 pb-5 border-b border-slate-200 bg-white">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{t('interviews.breadcrumb')}</p>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">{t('interviews.title')}</h1>
          {canCreate && view === 'list' && (
            <button onClick={() => setModal(true)} className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold rounded-lg transition-colors">
              <Plus size={14} /> {t('interviews.scheduleInterview')}
            </button>
          )}
        </div>
        <div className="flex gap-1 mt-4">
          {(['list', 'calendar'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${view === v ? 'bg-teal-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
              {v === 'list' ? <><FileText size={12} /> {t('interviews.viewList')}</> : <><Calendar size={12} /> {t('interviews.viewCalendar')}</>}
            </button>
          ))}
        </div>
      </div>

      <main className="flex-1 overflow-y-auto px-10 py-7">
        {view === 'calendar' ? (
          <InterviewCalendar currentErpId={currentErpId} onRespond={async (id, status) => { await respondToCalendarEvent(id, status); }} />
        ) : loading ? (
          <div className="flex items-center gap-2 text-slate-400 py-16 justify-center"><Loader2 size={18} className="animate-spin" /></div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full">
              <thead><tr className="bg-slate-50 border-b border-slate-200">
                {[['candidate', t('interviews.col.candidate')],['round', t('interviews.col.round')],['type', t('interviews.col.type')],['scheduled', t('interviews.col.scheduled')],['duration', t('interviews.col.duration')],['status', t('interviews.col.status')],['actions','']].map(([k, h]) =>
                  <th key={k} className="px-5 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {interviews.length === 0 ? (
                  <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-400">{t('interviews.empty')}</td></tr>
                ) : interviews.map(iv => {
                  const pendingEvent = myPendingEvents[iv.id];
                  return (
                    <tr key={iv.id} onClick={() => selectInterview(iv)} className="hover:bg-teal-50 cursor-pointer transition-colors">
                      <td className="px-5 py-3.5 font-semibold text-slate-900 text-sm">{iv.candidate_name ?? t('interviews.candidateFallback', { id: iv.candidate_id })}</td>
                      <td className="px-5 py-3.5 text-slate-500 text-sm">{t('interviews.roundLabel', { round: iv.round })}</td>
                      <td className="px-5 py-3.5 text-slate-500 text-sm">{typeLabel(iv.interview_type)}</td>
                      <td className="px-5 py-3.5 text-slate-500 text-sm">{iv.scheduled_at ? new Date(iv.scheduled_at).toLocaleString() : '—'}</td>
                      <td className="px-5 py-3.5 text-slate-500 text-sm">{t('interviews.minutes', { count: iv.duration_mins })}</td>
                      <td className="px-5 py-3.5"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLORS[iv.status]}`}>{t(`interviews.status.${iv.status}`, { defaultValue: iv.status.replace('_', ' ') })}</span></td>
                      <td className="px-5 py-3.5">
                        {pendingEvent && (
                          <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[10px] font-bold">
                            <AlertCircle size={10} /> {t('interviews.pending')}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* Interview detail panel */}
      {selected && (
        <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setSelected(null)}>
          <div className="absolute right-0 top-0 bottom-0 w-[500px] bg-white shadow-2xl overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-200">
              <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-700 text-xs mb-3">✕ {t('interviews.close')}</button>
              <h3 className="text-lg font-bold text-slate-900">{typeLabel(selected.interview_type)} — {t('interviews.roundLabel', { round: selected.round })}</h3>
              <p className="text-sm text-slate-500 mt-0.5">{selected.candidate_name}</p>
              {selected.scheduled_at && <p className="text-sm text-slate-500 mt-1">{new Date(selected.scheduled_at).toLocaleString()} · {t('interviews.minutes', { count: selected.duration_mins })}</p>}
              {selected.location && <p className="text-sm text-slate-500">{selected.location}</p>}

              {/* Resume & JD links */}
              <div className="flex gap-3 mt-3">
                {(() => {
                  const cand = candidates.find(c => c.id === selected.candidate_id);
                  return cand?.resume_url ? (
                    <a href={cand.resume_url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs font-bold text-teal-600 hover:underline">
                      <ExternalLink size={12} /> {t('interviews.viewResume')}
                    </a>
                  ) : null;
                })()}
                {(() => {
                  const req = reqs.find(r => r.id === (selected as any).requisition_id);
                  return req?.job_description ? (
                    <button onClick={() => setJdPopup(req.job_description!)}
                      className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-700">
                      <FileText size={12} /> {t('interviews.viewJd')}
                    </button>
                  ) : null;
                })()}
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Panelists */}
              <div>
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">{t('interviews.panelistsCount', { count: panelists.length })}</h4>
                {panelists.length === 0 ? <p className="text-sm text-slate-400">{t('interviews.noPanelists')}</p> : (
                  <div className="space-y-2">
                    {panelists.map((p: any) => {
                      const ev = panelistEvents[p.interviewer_id];
                      const isMe = p.interviewer_id === currentErpId;
                      return (
                        <div key={p.interviewer_id} className="bg-slate-50 rounded-lg px-3 py-2.5">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm text-slate-700 font-medium">{p.interviewer_name ?? p.interviewer_id}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold text-teal-600 capitalize">{t(`interviews.role.${p.role}`, { defaultValue: p.role })}</span>
                              {ev && <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${EVENT_STATUS_COLORS[ev.status]}`}>{t(`interviews.eventStatus.${ev.status}`, { defaultValue: ev.status })}</span>}
                            </div>
                          </div>
                          {isMe && ev && ev.status === 'tentative' && (
                            <div className="flex gap-2 mt-1">
                              <button onClick={() => respond(ev.id, 'confirmed')}
                                className="flex items-center gap-1 px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded text-xs font-bold transition-colors">
                                <CheckCircle2 size={12} /> {t('interviews.accept')}
                              </button>
                              <button onClick={() => respond(ev.id, 'declined')}
                                className="flex items-center gap-1 px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded text-xs font-bold transition-colors">
                                <XCircle size={12} /> {t('interviews.decline')}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Scorecards */}
              <div>
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">{t('interviews.scorecardsCount', { count: scorecards.length, total: panelists.length })}</h4>
                {scorecards.length === 0 ? <p className="text-sm text-slate-400">{t('interviews.noScorecards')}</p> : (
                  <div className="space-y-3">
                    {['technical_score','communication_score','problem_solving_score','culture_fit_score','leadership_score'].map(field => (
                      <div key={field} className="flex items-center justify-between">
                        <span className="text-xs text-slate-600 capitalize">{t(`interviews.scoreField.${field}`, { defaultValue: field.replace('_score','').replace(/_/g,' ') })}</span>
                        <div className="flex items-center gap-2">
                          <Stars value={Number(avgScore(field as any)) || 0} />
                          <span className="text-xs font-bold text-slate-700 w-6">{avgScore(field as any)}</span>
                        </div>
                      </div>
                    ))}
                    <div className="pt-2 border-t border-slate-200">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-700">{t('interviews.overallAverage')}</span>
                        <Stars value={Number(avgScore('overall_rating')) || 0} />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-2">
                      {scorecards.map(s => s.recommendation).filter(Boolean).map((r, i) => (
                        <span key={i} className={`text-xs font-bold ${REC_COLORS[r!] ?? 'text-slate-600'}`}>{t(`interviews.recommendation.${r}`, { defaultValue: r?.replace(/_/g,' ') })}</span>
                      ))}
                    </div>
                  </div>
                )}
                <button onClick={() => setScorecardForm({ interview_id: selected.id, overall_rating: 3 })}
                  className="mt-3 text-xs text-teal-600 hover:underline font-semibold">
                  {t('interviews.submitMyScorecard')}
                </button>
              </div>

              {/* Status */}
              <div>
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">{t('interviews.updateStatus')}</h4>
                <div className="flex gap-2 flex-wrap">
                  {['completed','cancelled','no_show'].map(s => (
                    <button key={s} onClick={() => { updateInterview(selected.id, { status: s as any }); setSelected(null); load(); }}
                      className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${STATUS_COLORS[s]} hover:opacity-80`}>{t(`interviews.status.${s}`, { defaultValue: s.replace('_',' ') })}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Job Description popup */}
      {jdPopup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-900">{t('interviews.jobDescription')}</h2>
              <button onClick={() => setJdPopup(null)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>
            <div className="overflow-y-auto flex-1 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{jdPopup}</div>
          </div>
        </div>
      )}

      {/* Scorecard form */}
      {scorecardForm && selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-slate-900 mb-5">{t('interviews.submitScorecard')}</h2>
            <div className="space-y-4">
              {[
                { label: t('interviews.field.overallRating'), key: 'overall_rating' },
                { label: t('interviews.field.technical'), key: 'technical_score' },
                { label: t('interviews.field.communication'), key: 'communication_score' },
                { label: t('interviews.field.problemSolving'), key: 'problem_solving_score' },
                { label: t('interviews.field.cultureFit'), key: 'culture_fit_score' },
                { label: t('interviews.field.leadership'), key: 'leadership_score' },
              ].map(f => (
                <div key={f.key} className="flex items-center justify-between">
                  <label className="text-sm text-slate-700">{f.label}</label>
                  <Stars value={(scorecardForm as any)[f.key] ?? 0} onChange={v => setScorecardForm(p => ({ ...p!, [f.key]: v }))} />
                </div>
              ))}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('interviews.recommendationLabel')}</label>
                <select value={scorecardForm.recommendation ?? 'neutral'} onChange={e => setScorecardForm(p => ({ ...p!, recommendation: e.target.value as any }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                  {['strong_hire','hire','neutral','no_hire','strong_no_hire'].map(r => <option key={r} value={r}>{t(`interviews.recommendation.${r}`, { defaultValue: r.replace(/_/g,' ') })}</option>)}
                </select>
              </div>
              {[{label:t('interviews.field.strengths'),key:'strengths'},{label:t('interviews.field.weaknesses'),key:'weaknesses'},{label:t('interviews.field.notes'),key:'notes'}].map(f => (
                <div key={f.key}>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{f.label}</label>
                  <textarea rows={2} value={(scorecardForm as any)[f.key] ?? ''} onChange={e => setScorecardForm(p => ({ ...p!, [f.key]: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setScorecardForm(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">{t('interviews.cancel')}</button>
              <button onClick={saveScorecard} className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white text-sm font-bold rounded-lg">{t('interviews.submit')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule interview modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-slate-900 mb-5">{t('interviews.scheduleInterview')}</h2>
            <div className="space-y-4">

              {/* Candidate */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('interviews.candidateRequired')}</label>
                <select value={form.candidate_id} onChange={e => setForm(p => ({ ...p, candidate_id: Number(e.target.value) }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                  <option value={0}>{t('interviews.selectCandidate')}</option>
                  {candidates.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                </select>
                {form.candidate_id > 0 && (() => {
                  const cand = candidates.find(c => c.id === form.candidate_id);
                  return cand?.resume_url ? (
                    <a href={cand.resume_url} target="_blank" rel="noopener noreferrer"
                      className="mt-1 flex items-center gap-1 text-xs text-teal-600 hover:underline font-semibold">
                      <ExternalLink size={11} /> {t('interviews.viewResume')}
                    </a>
                  ) : null;
                })()}
              </div>

              {/* Requisition */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('interviews.jobRequisition')}</label>
                <div className="flex gap-2">
                  <select value={form.requisition_id} onChange={e => setForm(p => ({ ...p, requisition_id: Number(e.target.value) }))}
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                    <option value={0}>{t('interviews.none')}</option>
                    {reqs.filter(r => r.status === 'open').map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
                  </select>
                  {selectedReq?.job_description && (
                    <button onClick={() => setJdPopup(selectedReq.job_description!)}
                      className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold rounded-lg flex items-center gap-1">
                      <FileText size={12} /> {t('interviews.jd')}
                    </button>
                  )}
                </div>
              </div>

              {/* Interview details */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('interviews.typeLabel')}</label>
                  <select value={form.interview_type} onChange={e => setForm(p => ({ ...p, interview_type: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                    {Object.keys(TYPE_LABELS).map(v => <option key={v} value={v}>{typeLabel(v)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('interviews.roundFieldLabel')}</label>
                  <input type="number" min={1} value={form.round} onChange={e => setForm(p => ({ ...p, round: Number(e.target.value) }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('interviews.dateTime')}</label>
                <input type="datetime-local" value={form.scheduled_at} onChange={e => setForm(p => ({ ...p, scheduled_at: e.target.value }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('interviews.durationMin')}</label>
                  <input type="number" min={15} step={15} value={form.duration_mins} onChange={e => setForm(p => ({ ...p, duration_mins: Number(e.target.value) }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('interviews.location')}</label>
                  <input value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} placeholder={t('interviews.locationPlaceholder')}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              </div>

              {/* Panelists */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('interviews.panelists')}</label>
                <div className="flex gap-2">
                  <select value={addingPanelist} onChange={e => setAddingPanelist(e.target.value)}
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                    <option value="">{t('interviews.addPanelist')}</option>
                    {allUsers.filter(u => !formPanelists.some(p => p.user.id === u.id)).map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                  </select>
                  <button onClick={addPanelistToForm} disabled={!addingPanelist}
                    className="px-3 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg">{t('interviews.add')}</button>
                </div>

                {formPanelists.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {formPanelists.map(p => (
                      <div key={p.user.id} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2">
                        <span className="text-sm text-slate-700 flex-1">{p.user.full_name}</span>
                        <select value={p.role} onChange={e => setFormPanelists(prev => prev.map(x => x.user.id === p.user.id ? { ...x, role: e.target.value as any } : x))}
                          className="text-xs bg-white border border-slate-200 rounded px-2 py-1">
                          <option value="lead">{t('interviews.role.lead')}</option>
                          <option value="support">{t('interviews.role.support')}</option>
                          <option value="observer">{t('interviews.role.observer')}</option>
                        </select>
                        {availLoading ? (
                          <Loader2 size={12} className="animate-spin text-slate-400" />
                        ) : p.availability ? (
                          <span className={`text-[10px] font-bold ${p.availability === 'free' ? 'text-emerald-600' : p.availability === 'tentative' ? 'text-amber-600' : 'text-red-600'}`}>
                            {p.availability === 'free' ? t('interviews.avail.free') : p.availability === 'tentative' ? t('interviews.avail.tentative') : t('interviews.avail.busy')}
                          </span>
                        ) : form.scheduled_at ? null : (
                          <span className="text-[10px] text-slate-400">—</span>
                        )}
                        <button onClick={() => setFormPanelists(prev => prev.filter(x => x.user.id !== p.user.id))}
                          className="text-slate-400 hover:text-red-500 text-xs">✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => { setModal(false); setFormPanelists([]); }} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">{t('interviews.cancel')}</button>
              <button onClick={saveInterview} disabled={saving || !form.candidate_id}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg">
                {saving ? t('interviews.scheduling') : t('interviews.schedule')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

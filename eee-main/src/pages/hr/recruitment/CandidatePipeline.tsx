import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Plus, Loader2 } from 'lucide-react';
import { getCandidates, createCandidate, updateCandidateStatus } from '../../../services/hrApi';
import type { Candidate } from '../../../services/hrApi';
import { usePermissions } from '../../../contexts/PermissionContext';

const STAGES: Candidate['status'][] = ['new', 'screening', 'interview', 'offer', 'hired', 'rejected', 'withdrawn'];
const STAGE_COLORS: Record<string, string> = {
  new:       'bg-slate-100 text-slate-700',
  screening: 'bg-blue-100 text-blue-700',
  interview: 'bg-amber-100 text-amber-700',
  offer:     'bg-purple-100 text-purple-700',
  hired:     'bg-emerald-100 text-emerald-700',
  rejected:  'bg-red-100 text-red-600',
  withdrawn: 'bg-slate-100 text-slate-500',
};

interface Props { requisitionId: number; onBack: () => void; }

export default function CandidatePipeline({ requisitionId, onBack }: Props) {
  const { t } = useTranslation('hr');
  const { can } = usePermissions();
  const canCreate = can('hr', 'recruitment', 'create');
  const canEdit   = can('hr', 'recruitment', 'edit');

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [modal, setModal] = useState(false);
  const [newCand, setNewCand] = useState({ full_name: '', email: '', phone: '', source: 'direct' as string });
  const [saving, setSaving] = useState(false);

  async function load() { setLoading(true); setCandidates(await getCandidates(requisitionId).catch(() => [])); setLoading(false); }
  useEffect(() => { load(); }, [requisitionId]);

  async function addCandidate() {
    if (!newCand.full_name) return;
    setSaving(true);
    await createCandidate({ ...newCand, requisition_id: requisitionId });
    setModal(false);
    setNewCand({ full_name: '', email: '', phone: '', source: 'direct' });
    load();
    setSaving(false);
  }

  async function moveCandidate(c: Candidate, newStatus: Candidate['status']) {
    await updateCandidateStatus(c.id, newStatus);
    load();
  }

  const byStage = (stage: Candidate['status']) => candidates.filter(c => c.status === stage);

  return (
    <div className="min-h-screen bg-[#faf8f5] flex flex-col">
      <div className="px-10 pt-8 pb-5 border-b border-slate-200 bg-white">
        <button onClick={onBack} className="flex items-center gap-1.5 text-slate-500 hover:text-slate-900 text-xs font-bold mb-3 transition-colors">
          <ArrowLeft size={14} /> {t('candidatePipeline.allRequisitions')}
        </button>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{t('candidatePipeline.breadcrumb')}</p>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">{t('candidatePipeline.title')}</h1>
          {canCreate && (
            <button onClick={() => setModal(true)} className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold rounded-lg transition-colors">
              <Plus size={14} /> {t('candidatePipeline.addCandidate')}
            </button>
          )}
        </div>
      </div>

      <main className="flex-1 overflow-x-auto px-10 py-7">
        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 py-16 justify-center"><Loader2 size={18} className="animate-spin" /> {t('candidatePipeline.loading')}</div>
        ) : (
          <div className="flex gap-4 min-w-max">
            {STAGES.filter(s => s !== 'rejected' && s !== 'withdrawn').map(stage => (
              <div key={stage} className="w-56 flex flex-col">
                <div className={`px-3 py-2 rounded-t-lg font-bold text-[11px] uppercase tracking-wider ${STAGE_COLORS[stage]}`}>
                  {t(`candidatePipeline.stage.${stage}`)} <span className="ml-1 opacity-60">({byStage(stage).length})</span>
                </div>
                <div className="flex-1 bg-slate-100 rounded-b-lg p-2 space-y-2 min-h-[200px]">
                  {byStage(stage).map(c => (
                    <div
                      key={c.id}
                      onClick={() => setSelected(c)}
                      className="bg-white rounded-lg p-3 shadow-sm cursor-pointer hover:shadow-md transition-shadow border border-slate-100"
                    >
                      <p className="text-sm font-semibold text-slate-900 leading-tight">{c.full_name}</p>
                      {c.email && <p className="text-[11px] text-slate-400 mt-0.5">{c.email}</p>}
                      {c.source && <span className="text-[10px] text-teal-600 font-bold">{c.source}</span>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Candidate detail panel */}
      {selected && (
        <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setSelected(null)}>
          <div className="absolute right-0 top-0 bottom-0 w-96 bg-white shadow-2xl overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-200">
              <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-700 text-xs mb-3">✕ {t('candidatePipeline.close')}</button>
              <h3 className="text-lg font-bold text-slate-900">{selected.full_name}</h3>
              <p className="text-sm text-slate-500">{selected.email}</p>
              <span className={`inline-block mt-2 px-2 py-0.5 rounded-full text-[10px] font-bold ${STAGE_COLORS[selected.status]}`}>{t(`candidatePipeline.stage.${selected.status}`)}</span>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-xs">
                {[
                  { label: t('candidatePipeline.phone'), value: selected.phone ?? '—' },
                  { label: t('candidatePipeline.source'), value: selected.source ?? '—' },
                  { label: t('candidatePipeline.applied'), value: new Date(selected.applied_at).toLocaleDateString() },
                ].map(i => (
                  <div key={i.label}>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{i.label}</p>
                    <p className="text-slate-700 mt-0.5">{i.value}</p>
                  </div>
                ))}
              </div>
              {selected.notes && (
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{t('candidatePipeline.notes')}</p>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{selected.notes}</p>
                </div>
              )}
              {canEdit && (
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">{t('candidatePipeline.moveToStage')}</p>
                  <div className="flex flex-wrap gap-2">
                    {STAGES.filter(s => s !== selected.status).map(s => (
                      <button key={s} onClick={() => { moveCandidate(selected, s); setSelected(null); }}
                        className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${STAGE_COLORS[s]} hover:opacity-80 transition-opacity`}>
                        {t(`candidatePipeline.stage.${s}`)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-slate-900 mb-5">{t('candidatePipeline.addCandidate')}</h2>
            <div className="space-y-4">
              {[
                { label: t('candidatePipeline.fullNameRequired'), key: 'full_name', placeholder: t('candidatePipeline.candidateNamePlaceholder') },
                { label: t('candidatePipeline.email'), key: 'email', placeholder: 'email@example.com' },
                { label: t('candidatePipeline.phone'), key: 'phone', placeholder: '+86 130 0000 0000' },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{f.label}</label>
                  <input value={(newCand as any)[f.key] ?? ''} onChange={e => setNewCand(p => ({ ...p, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              ))}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('candidatePipeline.source')}</label>
                <select value={newCand.source} onChange={e => setNewCand(p => ({ ...p, source: e.target.value }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                  {['direct','linkedin','referral','agency','job_board','other'].map(s => <option key={s} value={s}>{t(`candidatePipeline.sourceOption.${s}`)}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setModal(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">{t('candidatePipeline.cancel')}</button>
              <button onClick={addCandidate} disabled={saving || !newCand.full_name}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg">
                {saving ? t('candidatePipeline.adding') : t('candidatePipeline.addCandidate')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

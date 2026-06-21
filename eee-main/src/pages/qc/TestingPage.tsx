import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { CheckCircle2, XCircle, FlaskConical, History, RotateCcw, Hourglass, Users, LayoutDashboard, ListChecks, ChevronDown, ChevronRight, Check } from 'lucide-react';
import TestingDashboard from './TestingDashboard';
import {
  listPendingInspections,
  inspectionTemplatesForSubLot,
  takeSample,
  submitInspectionMulti,
  listSamplesForSubLot,
  getGroupMembers,
  formatQcDateTime,
  Sample,
  SubLot,
  TestTemplateLimits,
} from '../../services/qcApi';
import { usePermissions } from '../../contexts/PermissionContext';
import { NumericKeypad } from './components/NumericKeypad';
import { cn } from '../../lib/utils';
import { PermissionDenied } from './components/PermissionDenied';

interface Props {
  onOpenHistory: (subLotId: string) => void;
}

type Phase = 'idle' | 'sample' | 'measure' | 'done';

export default function TestingPage({ onOpenHistory }: Props) {
  const { t } = useTranslation('qc');
  const { can } = usePermissions();
  const canView = can('qc', 'testing', 'view_status');
  const canViewDashboard = can('qc', 'testing', 'view_dashboard');
  const canSample = can('qc', 'testing', 'take_sample');
  const canSubmit = can('qc', 'testing', 'submit_inspection');
  // M-118: supervisor-only override of the auto-suggested verdict. Required
  // for any decision when the reading sits inside the soft band but outside
  // the hard band, and for flipping the verdict inside the hard band.
  const canSupervise = can('qc', 'testing', 'supervisor_judge');

  const [activeTab, setActiveTab] = useState<'queue' | 'dashboard'>('queue');
  const [pending, setPending] = useState<SubLot[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = () => listPendingInspections().then(setPending).catch(e => setError(e.message));
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  const selected = useMemo(() => pending.find(s => s.id === selectedId) ?? null, [pending, selectedId]);

  if (!canView) {
    return <PermissionDenied permission="qc.testing.view_status" feature={t('testingPage.featureTesting')} />;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">{t('testingPage.title')}</h1>
      <p className="text-xs text-slate-500 mb-4">
        {t('testingPage.subtitle')}
      </p>

      {/* Tab toggle — Dashboard tab only shown when user has view_dashboard. */}
      {canViewDashboard && (
        <div className="flex gap-1 mb-5 bg-slate-100 rounded-lg p-1 w-fit">
          <button
            type="button"
            onClick={() => setActiveTab('queue')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-colors',
              activeTab === 'queue' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
            )}
          >
            <ListChecks size={12} /> {t('testingPage.tabQueue')}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-colors',
              activeTab === 'dashboard' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
            )}
          >
            <LayoutDashboard size={12} /> {t('testingPage.tabDashboard')}
          </button>
        </div>
      )}

      {activeTab === 'dashboard' && canViewDashboard && <TestingDashboard />}

      {/* Show the queue whenever dashboard isn't being shown — protects the
          edge case where activeTab='dashboard' but the user lacks view_dashboard
          (e.g. permission revoked mid-session). */}
      {(activeTab === 'queue' || !canViewDashboard) && <>
      {msg && <p className="text-emerald-700 bg-emerald-50 p-2 rounded-lg mb-3 text-sm flex items-center gap-2">
        <CheckCircle2 size={14} /> {msg}
      </p>}
      {error && <p className="text-red-600 bg-red-50 p-2 rounded-lg mb-3 text-sm">{error}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5">
        {/* ── Left: pending queue ─────────────────────────────────────── */}
        <aside className="bg-white border rounded-xl p-3">
          <h2 className="font-semibold text-slate-900 text-sm mb-2 px-1">
            {t('testingPage.pendingSubLots')} <span className="text-slate-400 font-normal">({pending.length})</span>
          </h2>
          {pending.length === 0 ? (
            <p className="text-xs text-slate-500 px-1">{t('testingPage.nothingToTest')}</p>
          ) : (
            <ul className="space-y-1.5 max-h-[700px] overflow-auto">
              {pending.map(s => {
                const isSelected = selectedId === s.id;
                const overdue = (s.wait_minutes ?? 0) > 120;
                const awaitingSample = !s.has_pending_sample;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(isSelected ? null : s.id)}
                      className={cn(
                        'w-full text-left rounded-lg px-3 py-2 border-2 text-sm transition-colors',
                        isSelected ? 'border-blue-500 bg-blue-50'
                          : overdue ? 'border-amber-300 bg-amber-50/40 hover:border-amber-400'
                          : 'border-slate-200 hover:border-blue-300 bg-white',
                      )}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-mono font-bold text-slate-900 flex items-center gap-1.5">
                            {s.sub_lot_code}
                            {s.is_test_champion && s.test_group_member_count && s.test_group_member_count > 1 && (
                              <span
                                className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 border border-purple-200"
                                title={t('testingPage.championSiblingsWaiting', { count: s.test_group_member_count - 1 })}
                              >
                                <Users size={8} /> ×{s.test_group_member_count}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            {s.sku_name ?? '—'} · {t('testingPage.checkedOut', { time: formatQcDateTime(s.out_time) })}
                          </div>
                          {!awaitingSample && s.latest_pending_sample_id && (
                            <div className="text-[10px] text-blue-700 font-mono mt-0.5">
                              {t('testingPage.sampleAwaitingWa', { id: s.latest_pending_sample_id })}
                            </div>
                          )}
                          {s.wait_minutes != null && (
                            <div className={cn('text-[10px] mt-0.5', overdue ? 'text-amber-700 font-bold' : 'text-slate-500')}>
                              {t('testingPage.waitingMinutes', { minutes: s.wait_minutes })}
                            </div>
                          )}
                        </div>
                        {/* Sub-state badge replaces the generic "Pending" badge */}
                        <span className={cn(
                          'shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border',
                          awaitingSample
                            ? 'bg-slate-100 text-slate-600 border-slate-300'
                            : 'bg-blue-100 text-blue-800 border-blue-300',
                        )}>
                          {awaitingSample
                            ? <span className="flex items-center gap-1"><Hourglass size={9} /> {t('testingPage.badgeNoSample')}</span>
                            : <span className="flex items-center gap-1"><FlaskConical size={9} /> {t('testingPage.badgeAwaitingWa')}</span>
                          }
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* ── Right: test workflow for selected ───────────────────────── */}
        <section>
          {!selected ? (
            <div className="bg-white border rounded-xl p-10 text-center text-sm text-slate-500">
              {t('testingPage.selectSubLotPrompt')}
            </div>
          ) : (
            <TestWorkflow
              key={selected.id}
              subLot={selected}
              canSample={canSample}
              canSubmit={canSubmit}
              canSupervise={canSupervise}
              onOpenHistory={() => onOpenHistory(selected.id)}
              onSampleTaken={load}
              onDone={() => { setMsg(t('testingPage.testCompleted')); setSelectedId(null); load(); }}
              onError={(m) => setError(m)}
            />
          )}
        </section>
      </div>
      </>}
    </div>
  );
}

// ─── Per-sub-lot workflow ──────────────────────────────────────────────────

function TestWorkflow({
  subLot, canSample, canSubmit, canSupervise, onOpenHistory, onSampleTaken, onDone, onError,
}: {
  subLot: SubLot;
  canSample: boolean;
  canSubmit: boolean;
  canSupervise: boolean;
  onOpenHistory: () => void;
  onSampleTaken: () => void;
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const { t } = useTranslation('qc');
  const [phase, setPhase] = useState<Phase>('idle');
  const [activeSample, setActiveSample] = useState<Sample | null>(null);
  const [allSamples, setAllSamples] = useState<Sample[]>([]);
  // M-138: a SKU can have several tests (e.g. Aw + MC%). Load them all; the
  // operator enters a reading per test (any order, collapsible cards) and may
  // only pick PASS/FAIL once every test has a reading.
  const [templates, setTemplates] = useState<TestTemplateLimits[]>([]);
  const [readings, setReadings] = useState<Record<string, string>>({});  // template id → raw input
  const [expandedId, setExpandedId] = useState<string | null>(null);     // open card (default all collapsed)
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState<'pass' | 'fail' | null>(null); // operator's final call (overall)
  const [remark, setRemark] = useState('');
  const [finalResult, setFinalResult] = useState<'pass' | 'fail' | null>(null);
  const [groupMembers, setGroupMembers] = useState<Array<{ id: string; sub_lot_code: string; is_test_champion: boolean; status: string }>>([]);

  // Load group members when this cart belongs to a test group
  useEffect(() => {
    if (subLot.test_group_id) {
      getGroupMembers(subLot.test_group_id).then(setGroupMembers).catch(() => {});
    } else {
      setGroupMembers([]);
    }
  }, [subLot.test_group_id]);

  // Load templates + existing samples
  useEffect(() => {
    inspectionTemplatesForSubLot(subLot.id)
      .then(d => setTemplates(d.templates))
      .catch(e => onError(e.message));
    listSamplesForSubLot(subLot.id)
      .then(rows => {
        setAllSamples(rows);
        const stillPending = rows.find(r => r.status === 'pending');
        if (stillPending) {
          setActiveSample(stillPending);
          setPhase('measure');
        } else {
          setPhase('sample');
        }
      })
      .catch(e => onError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subLot.id]);

  // M-138: per-test band + overall verdict across all tests.
  const bandOf = (raw: string | undefined, tmpl: TestTemplateLimits): 'hard' | 'soft' | 'out' | null => {
    if (raw == null || raw === '') return null;
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) return null;
    if (v >= tmpl.lower_limit && v <= tmpl.upper_limit) return 'hard';
    if (v >= tmpl.soft_lower_limit && v <= tmpl.soft_upper_limit) return 'soft';
    return 'out';
  };

  const { allEntered, overallBand } = useMemo(() => {
    if (templates.length === 0) return { allEntered: false, overallBand: null as 'hard' | 'soft' | 'out' | null };
    const bands = templates.map(t => bandOf(readings[t.id], t));
    const entered = bands.every(b => b !== null);
    let ob: 'hard' | 'soft' | 'out' | null = null;
    if (entered) ob = bands.includes('out') ? 'out' : bands.includes('soft') ? 'soft' : 'hard';
    return { allEntered: entered, overallBand: ob };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, readings]);

  const judged: 'pass' | 'fail' | null = overallBand ? (overallBand === 'hard' ? 'pass' : 'fail') : null;

  // Default decision once every test has a reading: hard → pass, out → forced
  // fail, soft → unset (supervisor consciously decides).
  useEffect(() => {
    if (phase !== 'measure') return;
    if (!allEntered) { setDecision(null); return; }
    if (overallBand === 'hard') setDecision('pass');
    else if (overallBand === 'out') setDecision('fail');
    else setDecision(null);
  }, [allEntered, overallBand, phase]);

  const handleTakeSample = async () => {
    setBusy(true);
    try {
      // M-119: omit sample_id → server auto-generates from sub_lot_code
      // (+ "R" / "R2" / ... for retests).
      const s = await takeSample({ sub_lot_id: subLot.id });
      setActiveSample(s);
      setPhase('measure');
      const rows = await listSamplesForSubLot(subLot.id);
      setAllSamples(rows);
      // Immediately refresh the sidebar list so the badge updates without waiting for the poll interval
      onSampleTaken();
    } catch (e) {
      onError(e instanceof Error ? e.message : t('testingPage.takeSampleFailed'));
    }
    setBusy(false);
  };

  const handleRedo = () => {
    // Clear all readings so the operator can re-enter without losing the sample.
    setReadings({});
    setDecision(null);
    setExpandedId(templates[0]?.id ?? null);
  };

  const handleConfirm = async () => {
    if (!activeSample || !allEntered || !decision) return;
    setBusy(true);
    try {
      const values: Record<string, number> = {};
      for (const tmpl of templates) values[tmpl.id] = parseFloat(readings[tmpl.id]);
      const res = await submitInspectionMulti(subLot.id, values, activeSample.id, decision, remark.trim() || null);
      setFinalResult(res.result as 'pass' | 'fail');
      setPhase('done');
    } catch (e) {
      onError(e instanceof Error ? e.message : t('testingPage.confirmFailed'));
    }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white border rounded-xl p-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{t('testingPage.headerTesting')}</p>
          <h2 className="text-xl font-mono font-bold text-slate-900">{subLot.sub_lot_code}</h2>
          <p className="text-xs text-slate-500 mt-0.5">{subLot.sku_name ?? ''}</p>
          {(subLot.produced_at || subLot.out_time) && (
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5 text-[11px] text-slate-500">
              {subLot.produced_at && (
                <span>{t('testingPage.producedLabel')} <span className="font-medium text-slate-700">{formatQcDateTime(subLot.produced_at)}</span></span>
              )}
              {subLot.out_time && (
                <span>{t('testingPage.dryingDoneLabel')} <span className="font-medium text-slate-700">{formatQcDateTime(subLot.out_time)}</span></span>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onOpenHistory}
          className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200 hover:border-blue-400 hover:text-blue-700 text-slate-700"
        >
          <History size={12} /> {t('testingPage.fullHistory')}
        </button>
      </div>

      {/* Champion banner — only shown for multi-cart sampling groups */}
      {subLot.is_test_champion && subLot.test_group_member_count && subLot.test_group_member_count > 1 && (
        <div className="bg-purple-50 border-2 border-purple-200 rounded-xl p-3 space-y-2">
          <div className="flex items-start gap-2.5">
            <Users size={18} className="text-purple-700 shrink-0 mt-0.5" />
            <div className="text-xs">
              <p className="font-bold text-purple-900">
                {t('testingPage.samplingGroupHeader', {
                  seq: subLot.test_group_sequence ?? '—',
                  count: subLot.test_group_member_count,
                })}
              </p>
              <p className="text-purple-700 mt-0.5">
                <Trans
                  i18nKey="testingPage.championBanner"
                  t={t}
                  values={{ count: subLot.test_group_member_count }}
                  components={{ strong: <strong />, em: <em /> }}
                />
              </p>
            </div>
          </div>
          {groupMembers.length > 0 && (
            <div className="pl-7 flex flex-wrap gap-1.5">
              {groupMembers.map(m => (
                <span
                  key={m.id}
                  className={cn(
                    'font-mono text-[11px] px-2 py-0.5 rounded-full border font-semibold',
                    m.id === subLot.id
                      ? 'bg-purple-700 text-white border-purple-700'          // this cart (champion)
                      : 'bg-white text-purple-800 border-purple-300',          // sibling carts
                  )}
                  title={m.is_test_champion ? t('testingPage.championTitle') : t('testingPage.statusTitle', { status: m.status })}
                >
                  {m.sub_lot_code}
                  {m.is_test_champion && ' ★'}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step 1: take sample — M-119: sample ID auto-derived from cart code.
          Initial test reuses the cart code verbatim; subsequent samples (i.e.
          retests after a fail+retest disposition) get "R", "R2", "R3", ... */}
      {phase === 'sample' && (() => {
        const priorCount = allSamples.length;
        const isRetest = priorCount > 0;
        const previewId = priorCount === 0
          ? subLot.sub_lot_code
          : priorCount === 1
            ? `${subLot.sub_lot_code}R`
            : `${subLot.sub_lot_code}R${priorCount}`;
        return (
          <Step number={1} title={isRetest ? t('testingPage.takeRetestSample', { count: priorCount }) : t('testingPage.takeSample')}>
            <p className="text-xs text-slate-500 mb-3">
              {isRetest ? t('testingPage.sampleIdAutoGenRetest') : t('testingPage.sampleIdAutoGen')}
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-[200px] rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{t('testingPage.sampleId')}</p>
                <code className="text-base font-mono font-bold text-slate-900">{previewId}</code>
                {isRetest && (
                  <span className="ml-2 text-[10px] uppercase tracking-wider bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-bold">
                    {t('testingPage.retestBadge', { count: priorCount })}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={handleTakeSample}
                disabled={busy || !canSample}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-bold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
              >
                <FlaskConical size={13} /> {t('testingPage.takeSampleBtn')}
              </button>
            </div>
          </Step>
        );
      })()}

      {/* Step 2: enter reading → system suggests → operator decides + remark */}
      {phase === 'measure' && activeSample && (() => {
        const doneCount = templates.filter(t => bandOf(readings[t.id], t) !== null).length;
        const hasTmpl = templates.length > 0;
        const passDisabled = !allEntered || (hasTmpl && (overallBand === 'out' || (overallBand === 'soft' && !canSupervise)));
        const failDisabled = !allEntered || (hasTmpl && !canSupervise && overallBand !== 'out');
        return (
        <Step number={2} title={t('testingPage.measureMultiTitle')} active>
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <span className="text-[11px] text-slate-500">{t('testingPage.sample')}</span>
            <code className="text-xs font-mono font-bold text-slate-900">{activeSample.sample_id}</code>
            <span className="text-[11px] text-slate-400">·</span>
            <span className={cn('text-[11px] font-bold', allEntered ? 'text-emerald-700' : 'text-slate-500')}>
              {t('testingPage.testsProgress', { done: doneCount, total: templates.length })}
            </span>
          </div>

          {/* One collapsible card per test (default collapsed). Enter readings in
              any order; PASS/FAIL only unlocks once every test has a reading. */}
          <div className="space-y-2">
            {templates.map(tmpl => {
              const b = bandOf(readings[tmpl.id], tmpl);
              const open = expandedId === tmpl.id;
              const raw = readings[tmpl.id] ?? '';
              const hasSoft = tmpl.soft_lower_limit < tmpl.lower_limit || tmpl.soft_upper_limit > tmpl.upper_limit;
              const valColor = b === 'hard' ? 'text-emerald-700' : b === 'soft' ? 'text-amber-700' : b === 'out' ? 'text-red-700' : 'text-slate-400';
              return (
                <div key={tmpl.id} className={cn('border-2 rounded-xl overflow-hidden', open ? 'border-blue-300' : 'border-slate-200')}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(open ? null : tmpl.id)}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-50"
                  >
                    {open ? <ChevronDown size={15} className="text-slate-400 shrink-0" /> : <ChevronRight size={15} className="text-slate-400 shrink-0" />}
                    <span className={cn('flex items-center justify-center w-5 h-5 rounded-full shrink-0',
                      b ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-300')}>
                      {b ? <Check size={12} /> : <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />}
                    </span>
                    <span className="font-bold text-sm text-slate-900 flex-1 min-w-0 truncate">
                      {tmpl.item_name}{tmpl.unit ? ` (${tmpl.unit})` : ''}
                    </span>
                    <span className={cn('font-mono text-sm tabular-nums', valColor)}>{raw || '—'}</span>
                    {b && (
                      <span className={cn('text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded shrink-0',
                        b === 'hard' ? 'bg-emerald-100 text-emerald-700' : b === 'soft' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700')}>
                        {b === 'hard' ? t('testingPage.bandInHardRange') : b === 'soft' ? t('testingPage.bandSoftSupervisor') : t('testingPage.bandOutsideTolerance')}
                      </span>
                    )}
                  </button>
                  {open && (
                    <div className="px-3 pb-3 pt-1 border-t border-slate-100">
                      <div className="flex items-center gap-3 mb-2 flex-wrap text-[11px] text-slate-500">
                        <span>{t('testingPage.hard')} <code className="font-mono text-emerald-700">[{tmpl.lower_limit}, {tmpl.upper_limit}]</code></span>
                        {hasSoft && <span>{t('testingPage.soft')} <code className="font-mono text-amber-700">[{tmpl.soft_lower_limit}, {tmpl.soft_upper_limit}]</code></span>}
                      </div>
                      <div className={cn('rounded-2xl border-2 p-4 text-center mb-3',
                        b === 'hard' ? 'border-emerald-300 bg-emerald-50' : b === 'soft' ? 'border-amber-300 bg-amber-50' : b === 'out' ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white')}>
                        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{tmpl.item_name}</p>
                        <p className={cn('text-4xl font-bold tabular-nums my-1', valColor)}>{raw || '—'}</p>
                      </div>
                      <NumericKeypad value={raw} onChange={v => setReadings(r => ({ ...r, [tmpl.id]: v }))} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Operator's final judgment — only after every test has a reading. */}
          <div className="mt-4">
            <p className="text-xs font-bold text-slate-700 mb-1.5">{t('testingPage.finalJudgment')}</p>
            {allEntered && judged && (
              <p className="text-[11px] text-slate-500 mb-1.5">
                {t('testingPage.systemSuggests')}{' '}
                <span className={cn('font-bold', judged === 'pass' ? 'text-emerald-700' : 'text-red-700')}>
                  {judged === 'pass' ? t('testingPage.pass') : t('testingPage.fail')}
                </span>
                {decision && decision !== judged && <span className="text-amber-600 font-medium"> {t('testingPage.overridden')}</span>}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDecision('pass')}
                disabled={passDisabled}
                title={!allEntered ? t('testingPage.completeAllTests')
                  : overallBand === 'out' ? t('testingPage.titleMustFail')
                  : overallBand === 'soft' && !canSupervise ? t('testingPage.titleSupervisorRequired')
                  : undefined}
                className={cn(
                  'px-4 py-3 rounded-lg text-sm font-bold border-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                  decision === 'pass' ? 'border-emerald-500 bg-emerald-600 text-white' : 'border-slate-200 text-slate-700 hover:border-emerald-400',
                )}
              >
                {t('testingPage.passBtn')}
              </button>
              <button
                type="button"
                onClick={() => setDecision('fail')}
                disabled={failDisabled}
                title={!allEntered ? t('testingPage.completeAllTests')
                  : overallBand !== 'out' && !canSupervise ? t('testingPage.titleSupervisorRequiredFail') : undefined}
                className={cn(
                  'px-4 py-3 rounded-lg text-sm font-bold border-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                  decision === 'fail' ? 'border-red-500 bg-red-600 text-white' : 'border-slate-200 text-slate-700 hover:border-red-400',
                )}
              >
                {t('testingPage.failBtn')}
              </button>
            </div>
            {!allEntered && (
              <p className="mt-1.5 text-[11px] text-slate-500">{t('testingPage.completeAllTests')}</p>
            )}
            {allEntered && overallBand === 'soft' && !canSupervise && (
              <p className="mt-1.5 text-[11px] text-amber-700">{t('testingPage.softBandHint')}</p>
            )}
            {allEntered && overallBand === 'out' && (
              <p className="mt-1.5 text-[11px] text-red-700">{t('testingPage.outBandHint')}</p>
            )}
          </div>

          {/* Remark (optional) */}
          <div className="mt-3">
            <p className="text-xs font-bold text-slate-700 mb-1.5">
              {t('testingPage.remark')} <span className="font-normal text-slate-400">{t('testingPage.optional')}</span>
            </p>
            <textarea
              value={remark}
              onChange={e => setRemark(e.target.value)}
              placeholder={t('testingPage.remarkPlaceholder')}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[56px] focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="mt-4 grid grid-cols-[140px_1fr] gap-2">
            <button
              type="button"
              onClick={handleRedo}
              disabled={doneCount === 0 || busy}
              className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-lg text-sm font-bold border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <RotateCcw size={13} /> {t('testingPage.redoTest')}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={busy || !canSubmit || !decision || !allEntered}
              className={cn(
                'px-4 py-3 rounded-lg text-sm font-bold text-white disabled:opacity-50 transition-colors',
                decision === 'pass'
                  ? 'bg-emerald-600 hover:bg-emerald-500'
                  : decision === 'fail'
                    ? 'bg-red-600 hover:bg-red-500'
                    : 'bg-slate-300 cursor-not-allowed',
              )}
            >
              {busy
                ? t('testingPage.submitting')
                : !allEntered
                  ? t('testingPage.completeAllTests')
                  : decision
                    ? t('testingPage.confirmPersist', { verdict: decision === 'pass' ? t('testingPage.pass') : t('testingPage.fail') })
                    : t('testingPage.choosePassOrFail')}
            </button>
          </div>
        </Step>
        );
      })()}

      {/* Step 3: result screen */}
      {phase === 'done' && finalResult === 'pass' && (
        <Step number={3} title={t('testingPage.passedTitle')}>
          <div className="rounded-2xl bg-emerald-50 border-2 border-emerald-300 p-6 text-center">
            <CheckCircle2 size={32} className="text-emerald-600 mx-auto mb-2" />
            <p className="text-2xl font-bold text-emerald-800">{t('testingPage.passReleased')}</p>
            <p className="text-xs text-emerald-700 mt-1">{t('testingPage.passStatusNote')}</p>
          </div>
          <button
            type="button"
            onClick={onDone}
            className="mt-3 w-full bg-slate-800 hover:bg-slate-700 text-white py-2.5 rounded-lg text-sm font-bold"
          >
            {t('testingPage.done')}
          </button>
        </Step>
      )}

      {phase === 'done' && finalResult === 'fail' && (
        <Step number={3} title={t('testingPage.failedTitle')}>
          <div className="rounded-2xl bg-red-50 border-2 border-red-300 p-6 text-center">
            <XCircle size={32} className="text-red-600 mx-auto mb-2" />
            <p className="text-2xl font-bold text-red-800">{t('testingPage.failedOnHold')}</p>
            <p className="text-xs text-red-700 mt-1">
              <Trans i18nKey="testingPage.failedNote" t={t} components={{ strong: <strong /> }} />
            </p>
          </div>
          <button
            type="button"
            onClick={onDone}
            className="mt-3 w-full bg-slate-800 hover:bg-slate-700 text-white py-2.5 rounded-lg text-sm font-bold"
          >
            {t('testingPage.done')}
          </button>
        </Step>
      )}

      {/* Sample history for this sub-lot */}
      {allSamples.length > 0 && (
        <section className="bg-white border rounded-xl p-3">
          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 px-1">
            {t('testingPage.samplesHeading')}
          </h3>
          <ul className="space-y-1">
            {allSamples.map(sa => (
              <li key={sa.id} className="flex items-center gap-2 text-xs border-b last:border-b-0 border-slate-100 py-1.5 px-1">
                <button
                  type="button"
                  onClick={onOpenHistory}
                  className="font-mono font-bold text-blue-700 hover:underline"
                  title={t('testingPage.viewFullHistoryTitle')}
                >
                  {sa.sample_id}
                </button>
                <span className="text-slate-400">·</span>
                <span className="text-slate-500">{formatQcDateTime(sa.taken_at)}</span>
                <span className="flex-1" />
                {sa.aw != null && <span className="font-mono text-slate-700">{t('testingPage.awValue', { value: sa.aw })}</span>}
                <SampleResultBadge status={sa.status} result={sa.result ?? null} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Step({ number, title, active, children }: { number: number; title: string; active?: boolean; children: React.ReactNode }) {
  return (
    <section className={cn(
      'rounded-xl border-2 p-4',
      active ? 'bg-white border-blue-300' : 'bg-white border-slate-200',
    )}>
      <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
        <span className={cn(
          'w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-bold',
          active ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600',
        )}>{number}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function SampleResultBadge({ status, result }: { status: string; result: 'pass' | 'fail' | null }) {
  const { t } = useTranslation('qc');
  if (status === 'voided') return <span className="text-[10px] font-bold text-slate-500">{t('testingPage.statusVoided')}</span>;
  if (status === 'pending') return <span className="text-[10px] font-bold text-amber-700">{t('testingPage.statusPending')}</span>;
  if (result === 'pass') return <span className="text-[10px] font-bold text-emerald-700">{t('testingPage.statusPass')}</span>;
  if (result === 'fail') return <span className="text-[10px] font-bold text-red-700">{t('testingPage.statusFail')}</span>;
  return null;
}


import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, XCircle, FlaskConical, History, RotateCcw, Hourglass, Users, LayoutDashboard, ListChecks } from 'lucide-react';
import TestingDashboard from './TestingDashboard';
import {
  listPendingInspections,
  inspectionTemplateForSubLot,
  takeSample,
  submitInspection,
  listSamplesForSubLot,
  getGroupMembers,
  formatQcDateTime,
  Sample,
  SubLot,
} from '../../services/qcApi';
import { usePermissions } from '../../contexts/PermissionContext';
import { NumericKeypad } from './components/NumericKeypad';
import { cn } from '../../lib/utils';

interface Props {
  onOpenHistory: (subLotId: string) => void;
}

type Phase = 'idle' | 'sample' | 'measure' | 'done';

export default function TestingPage({ onOpenHistory }: Props) {
  const { can } = usePermissions();
  const canSample = can('qc', 'testing', 'take_sample');
  const canSubmit = can('qc', 'testing', 'submit_inspection');

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

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Testing</h1>
      <p className="text-xs text-slate-500 mb-4">
        Sub-lots checked out of the dryer · take a sample → enter WA → confirm Pass/Fail · auto-judged by SKU template (BR-Q1)
      </p>

      {/* Tab toggle */}
      <div className="flex gap-1 mb-5 bg-slate-100 rounded-lg p-1 w-fit">
        <button
          type="button"
          onClick={() => setActiveTab('queue')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-colors',
            activeTab === 'queue' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
          )}
        >
          <ListChecks size={12} /> Queue
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('dashboard')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-colors',
            activeTab === 'dashboard' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
          )}
        >
          <LayoutDashboard size={12} /> Dashboard
        </button>
      </div>

      {activeTab === 'dashboard' && <TestingDashboard />}

      {activeTab === 'queue' && <>
      {msg && <p className="text-emerald-700 bg-emerald-50 p-2 rounded-lg mb-3 text-sm flex items-center gap-2">
        <CheckCircle2 size={14} /> {msg}
      </p>}
      {error && <p className="text-red-600 bg-red-50 p-2 rounded-lg mb-3 text-sm">{error}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5">
        {/* ── Left: pending queue ─────────────────────────────────────── */}
        <aside className="bg-white border rounded-xl p-3">
          <h2 className="font-semibold text-slate-900 text-sm mb-2 px-1">
            Pending sub-lots <span className="text-slate-400 font-normal">({pending.length})</span>
          </h2>
          {pending.length === 0 ? (
            <p className="text-xs text-slate-500 px-1">Nothing to test. Check carts out of the dryer first.</p>
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
                                title={`Champion · ${s.test_group_member_count - 1} sibling(s) waiting`}
                              >
                                <Users size={8} /> ×{s.test_group_member_count}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            {s.sku_name ?? '—'} · checked out {formatQcDateTime(s.out_time)}
                          </div>
                          {!awaitingSample && s.latest_pending_sample_id && (
                            <div className="text-[10px] text-blue-700 font-mono mt-0.5">
                              Sample {s.latest_pending_sample_id} · awaiting WA
                            </div>
                          )}
                          {s.wait_minutes != null && (
                            <div className={cn('text-[10px] mt-0.5', overdue ? 'text-amber-700 font-bold' : 'text-slate-500')}>
                              Waiting {s.wait_minutes}m
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
                            ? <span className="flex items-center gap-1"><Hourglass size={9} /> No sample</span>
                            : <span className="flex items-center gap-1"><FlaskConical size={9} /> Awaiting WA</span>
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
              Select a sub-lot from the left to begin testing.
            </div>
          ) : (
            <TestWorkflow
              key={selected.id}
              subLot={selected}
              canSample={canSample}
              canSubmit={canSubmit}
              onOpenHistory={() => onOpenHistory(selected.id)}
              onSampleTaken={load}
              onDone={() => { setMsg('Test completed'); setSelectedId(null); load(); }}
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
  subLot, canSample, canSubmit, onOpenHistory, onSampleTaken, onDone, onError,
}: {
  subLot: SubLot;
  canSample: boolean;
  canSubmit: boolean;
  onOpenHistory: () => void;
  onSampleTaken: () => void;
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [sampleIdInput, setSampleIdInput] = useState('');
  const [activeSample, setActiveSample] = useState<Sample | null>(null);
  const [allSamples, setAllSamples] = useState<Sample[]>([]);
  const [limits, setLimits] = useState<{ item_name: string; lower_limit: number; upper_limit: number } | null>(null);
  const [aw, setAw] = useState('');
  const [busy, setBusy] = useState(false);
  const [judged, setJudged] = useState<'pass' | 'fail' | null>(null);
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

  // Load template + existing samples
  useEffect(() => {
    inspectionTemplateForSubLot(subLot.id)
      .then(d => setLimits(d.template))
      .catch(e => onError(e.message));
    listSamplesForSubLot(subLot.id)
      .then(rows => {
        setAllSamples(rows);
        const stillPending = rows.find(r => r.status === 'pending');
        if (stillPending) {
          setActiveSample(stillPending);
          setSampleIdInput(stillPending.sample_id);
          setPhase('measure');
        } else {
          setPhase('sample');
        }
      })
      .catch(e => onError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subLot.id]);

  // Auto-judge live as aw input changes
  useEffect(() => {
    if (phase !== 'measure') return;
    if (!aw || !limits) { setJudged(null); return; }
    const v = parseFloat(aw);
    if (!Number.isFinite(v)) { setJudged(null); return; }
    setJudged(v >= limits.lower_limit && v <= limits.upper_limit ? 'pass' : 'fail');
  }, [aw, limits, phase]);

  const handleTakeSample = async () => {
    if (!sampleIdInput.trim()) { onError('Enter a sample ID first'); return; }
    setBusy(true);
    try {
      const s = await takeSample({ sub_lot_id: subLot.id, sample_id: sampleIdInput.trim() });
      setActiveSample(s);
      setPhase('measure');
      const rows = await listSamplesForSubLot(subLot.id);
      setAllSamples(rows);
      // Immediately refresh the sidebar list so the badge updates without waiting for the poll interval
      onSampleTaken();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Take sample failed');
    }
    setBusy(false);
  };

  const handleRedo = () => {
    // Clear the WA reading so the operator can re-enter without losing the sample.
    setAw('');
    setJudged(null);
  };

  const handleConfirm = async () => {
    if (!activeSample || !aw) return;
    setBusy(true);
    try {
      const v = parseFloat(aw);
      const res = await submitInspection(subLot.id, v, activeSample.id);
      setFinalResult(res.result as 'pass' | 'fail');
      setPhase('done');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Confirm failed');
    }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white border rounded-xl p-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Testing</p>
          <h2 className="text-xl font-mono font-bold text-slate-900">{subLot.sub_lot_code}</h2>
          <p className="text-xs text-slate-500 mt-0.5">{subLot.sku_name ?? ''}</p>
        </div>
        <button
          type="button"
          onClick={onOpenHistory}
          className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200 hover:border-blue-400 hover:text-blue-700 text-slate-700"
        >
          <History size={12} /> Full history
        </button>
      </div>

      {/* Champion banner — only shown for multi-cart sampling groups */}
      {subLot.is_test_champion && subLot.test_group_member_count && subLot.test_group_member_count > 1 && (
        <div className="bg-purple-50 border-2 border-purple-200 rounded-xl p-3 space-y-2">
          <div className="flex items-start gap-2.5">
            <Users size={18} className="text-purple-700 shrink-0 mt-0.5" />
            <div className="text-xs">
              <p className="font-bold text-purple-900">
                Sampling group #{subLot.test_group_sequence ?? '—'} · {subLot.test_group_member_count} cart{subLot.test_group_member_count === 1 ? '' : 's'}
              </p>
              <p className="text-purple-700 mt-0.5">
                This cart is the <strong>random champion</strong>. PASS releases all {subLot.test_group_member_count} cart{subLot.test_group_member_count === 1 ? '' : 's'}; FAIL puts all {subLot.test_group_member_count} carts on hold. Choosing <em>Retest</em> on a fail re-rolls a new champion within the same group.
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
                  title={m.is_test_champion ? 'Champion' : `Status: ${m.status}`}
                >
                  {m.sub_lot_code}
                  {m.is_test_champion && ' ★'}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step 1: take sample */}
      {phase === 'sample' && (
        <Step number={1} title="Take sample">
          <p className="text-xs text-slate-500 mb-3">
            Enter a sample ID (your numbering), then click Take sample. This locks the sample to this sub-lot.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={sampleIdInput}
              onChange={(e) => setSampleIdInput(e.target.value)}
              placeholder="e.g. S-2026-0521-001"
              className="flex-1 border rounded-lg px-3 py-2 text-sm font-mono"
            />
            <button
              type="button"
              onClick={handleTakeSample}
              disabled={busy || !canSample || !sampleIdInput.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
            >
              <FlaskConical size={13} /> Take sample
            </button>
          </div>
        </Step>
      )}

      {/* Step 2: measure WA — auto-judged live; bottom is Redo / Confirm */}
      {phase === 'measure' && activeSample && limits && (
        <Step number={2} title={`Measure ${limits.item_name}`} active>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-[11px] text-slate-500">Sample</span>
            <code className="text-xs font-mono font-bold text-slate-900">{activeSample.sample_id}</code>
            <span className="text-[11px] text-slate-400">·</span>
            <span className="text-[11px] text-slate-500">
              Spec range: <code className="font-mono text-slate-700">[{limits.lower_limit}, {limits.upper_limit}]</code>
            </span>
          </div>
          <div className={cn(
            'rounded-2xl border-2 p-5 text-center mb-3 transition-colors',
            judged === 'pass' ? 'border-emerald-400 bg-emerald-50'
              : judged === 'fail' ? 'border-red-400 bg-red-50'
              : 'border-slate-200 bg-white',
          )}>
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{limits.item_name}</p>
            <p className={cn(
              'text-5xl font-bold tabular-nums my-2',
              judged === 'pass' ? 'text-emerald-700' : judged === 'fail' ? 'text-red-700' : 'text-slate-900',
            )}>
              {aw || '—'}
            </p>
            {judged && (
              <p className={cn('text-sm font-bold', judged === 'pass' ? 'text-emerald-700' : 'text-red-700')}>
                {judged === 'pass' ? '✓ Within spec — Pass' : '✗ Out of spec — Fail'}
              </p>
            )}
          </div>
          <NumericKeypad value={aw} onChange={setAw} />

          <div className="mt-4 grid grid-cols-[140px_1fr] gap-2">
            <button
              type="button"
              onClick={handleRedo}
              disabled={!aw || busy}
              className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-lg text-sm font-bold border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <RotateCcw size={13} /> Redo test
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={busy || !canSubmit || !judged}
              className={cn(
                'px-4 py-3 rounded-lg text-sm font-bold text-white disabled:opacity-50 transition-colors',
                judged === 'pass'
                  ? 'bg-emerald-600 hover:bg-emerald-500'
                  : judged === 'fail'
                    ? 'bg-red-600 hover:bg-red-500'
                    : 'bg-slate-300 cursor-not-allowed',
              )}
            >
              {busy
                ? 'Submitting…'
                : judged
                  ? `Confirm ${judged === 'pass' ? 'PASS' : 'FAIL'} & persist`
                  : 'Enter a reading first'}
            </button>
          </div>
        </Step>
      )}

      {/* Step 3: result screen */}
      {phase === 'done' && finalResult === 'pass' && (
        <Step number={3} title="Passed">
          <div className="rounded-2xl bg-emerald-50 border-2 border-emerald-300 p-6 text-center">
            <CheckCircle2 size={32} className="text-emerald-600 mx-auto mb-2" />
            <p className="text-2xl font-bold text-emerald-800">Pass — released</p>
            <p className="text-xs text-emerald-700 mt-1">Sub-lot status: passed · history preserved</p>
          </div>
          <button
            type="button"
            onClick={onDone}
            className="mt-3 w-full bg-slate-800 hover:bg-slate-700 text-white py-2.5 rounded-lg text-sm font-bold"
          >
            Done
          </button>
        </Step>
      )}

      {phase === 'done' && finalResult === 'fail' && (
        <Step number={3} title="Failed">
          <div className="rounded-2xl bg-red-50 border-2 border-red-300 p-6 text-center">
            <XCircle size={32} className="text-red-600 mx-auto mb-2" />
            <p className="text-2xl font-bold text-red-800">Failed — on hold</p>
            <p className="text-xs text-red-700 mt-1">
              Sub-lot is now <strong>on hold</strong>. Go to <strong>QC Home</strong> to choose the next action (re-dry, room temp, retest, or scrap).
            </p>
          </div>
          <button
            type="button"
            onClick={onDone}
            className="mt-3 w-full bg-slate-800 hover:bg-slate-700 text-white py-2.5 rounded-lg text-sm font-bold"
          >
            Done
          </button>
        </Step>
      )}

      {/* Sample history for this sub-lot */}
      {allSamples.length > 0 && (
        <section className="bg-white border rounded-xl p-3">
          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 px-1">
            Samples for this sub-lot · click any sample_id to view full timeline
          </h3>
          <ul className="space-y-1">
            {allSamples.map(sa => (
              <li key={sa.id} className="flex items-center gap-2 text-xs border-b last:border-b-0 border-slate-100 py-1.5 px-1">
                <button
                  type="button"
                  onClick={onOpenHistory}
                  className="font-mono font-bold text-blue-700 hover:underline"
                  title="View full sub-lot history"
                >
                  {sa.sample_id}
                </button>
                <span className="text-slate-400">·</span>
                <span className="text-slate-500">{formatQcDateTime(sa.taken_at)}</span>
                <span className="flex-1" />
                {sa.aw != null && <span className="font-mono text-slate-700">Aw {sa.aw}</span>}
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
  if (status === 'voided') return <span className="text-[10px] font-bold text-slate-500">VOIDED</span>;
  if (status === 'pending') return <span className="text-[10px] font-bold text-amber-700">PENDING</span>;
  if (result === 'pass') return <span className="text-[10px] font-bold text-emerald-700">PASS</span>;
  if (result === 'fail') return <span className="text-[10px] font-bold text-red-700">FAIL</span>;
  return null;
}


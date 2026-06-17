import React, { useEffect, useMemo, useState } from 'react';
import {
  Tablet, LogOut, UserPlus, LogIn, Clock, Users, Factory, PauseOctagon, Play, Plus, Check,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { Combobox, type ComboOption } from '../../components/ui/Combobox';
import {
  tabletLogin, listOnShift, clockIn, clockOut,
  submitTabletRun, listTabletRuns,
  getOpenDowntime, listDowntimeToday, startDowntime, endDowntime, addDowntime,
  type TabletSession, type AttendanceRow, type Shift, type DowntimeEventRow,
} from '../../services/productionTabletApi';
import {
  listOperators, listDowntimeReasons,
  type OperatorOption, type DowntimeReasonOption, type DailyReportRow,
} from '../../services/productionRunApi';
import { findWorkOrderByNo, getCarryOverCart, type WorkOrderLookup } from '../../services/productionWorkOrderApi';

const SESSION_KEY = 'erp_tablet_device';
const SHIFTS: Shift[] = ['1st', '2nd', '3rd'];

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function defaultShift(): Shift {
  const h = new Date().getHours();
  if (h >= 6 && h < 14) return '1st';
  if (h >= 14 && h < 22) return '2nd';
  return '3rd';
}
function durationLabel(fromISO: string, nowMs: number): string {
  const mins = Math.max(0, Math.round((nowMs - new Date(fromISO).getTime()) / 60000));
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h}h ${mins % 60}m` : `${mins}m`;
}
const numOrNull = (s: string): number | null => {
  const t = s.trim(); if (t === '') return null;
  const n = Number(t); return Number.isFinite(n) ? n : null;
};
const intOrNull = (s: string): number | null => {
  const n = numOrNull(s); return n == null ? null : Math.trunc(n);
};
const fmt = (n: number | null | undefined, dp = 2): string =>
  n == null || !Number.isFinite(n) ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: dp });

const bigInput = 'w-full border border-slate-300 rounded-xl px-4 h-14 text-base focus:outline-none focus:ring-2 focus:ring-indigo-200';

export default function TabletApp() {
  const [session, setSession] = useState<TabletSession | null>(() => {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as TabletSession) : null;
  });
  if (!session) {
    return <TabletLogin onSuccess={(s) => { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); setSession(s); }} />;
  }
  return <TabletWorkspace session={session} onLogout={() => { sessionStorage.removeItem(SESSION_KEY); setSession(null); }} />;
}

// ── Device login ─────────────────────────────────────────────────────────────

function TabletLogin({ onSuccess }: { onSuccess: (s: TabletSession) => void }) {
  const { t } = useTranslation('production');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { onSuccess(await tabletLogin(code, pin)); }
    catch { setError(t('tablet.loginError')); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6 gap-2">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg">
            <Tablet size={26} className="text-white" />
          </div>
          <h1 className="text-xl font-bold text-white">{t('tablet.loginTitle')}</h1>
          <p className="text-[11px] text-slate-400 uppercase tracking-widest font-bold">{t('tablet.loginSubtitle')}</p>
        </div>
        <form onSubmit={submit} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-3">
          <input value={code} onChange={(e) => setCode(e.target.value)}
            placeholder={t('tablet.deviceCode')} autoFocus autoComplete="off"
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-base text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)}
            placeholder={t('tablet.pin')} autoComplete="off"
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-base text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          {error && <p className="text-sm text-rose-400 bg-rose-950/50 border border-rose-900 rounded px-3 py-2">{error}</p>}
          <button type="submit" disabled={busy}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-base font-bold rounded-xl transition-colors flex items-center justify-center gap-2">
            <LogIn size={18} /> {busy ? t('tablet.loggingIn') : t('tablet.login')}
          </button>
        </form>
        <p className="text-center text-[11px] text-slate-600 mt-4">/tablet · {t('tablet.feature')}</p>
      </div>
    </div>
  );
}

// ── Workspace shell (top bar + tabs) ─────────────────────────────────────────

type Tab = 'attendance' | 'production' | 'downtime';

function TabletWorkspace({ session, onLogout }: { session: TabletSession; onLogout: () => void }) {
  const { t } = useTranslation('production');
  const date = todayISO();
  const [shift, setShift] = useState<Shift>(defaultShift());
  const [tab, setTab] = useState<Tab>('attendance');

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'attendance', label: t('tablet.tabAttendance'), icon: Users },
    { id: 'production', label: t('tablet.tabProduction'), icon: Factory },
    { id: 'downtime', label: t('tablet.tabDowntime'), icon: PauseOctagon },
  ];

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      <header className="bg-[#0a0f1d] text-white px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center"><Tablet size={20} /></div>
          <div>
            <p className="text-lg font-bold leading-none">{session.machine_code}</p>
            <p className="text-[11px] text-slate-400 mt-1">{session.name ?? session.code} · {date}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-xl border border-white/15 overflow-hidden">
            {SHIFTS.map((s) => (
              <button key={s} onClick={() => setShift(s)}
                className={cn('px-5 py-2.5 text-base font-bold', shift === s ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-white/5')}>
                {s}
              </button>
            ))}
          </div>
          <button onClick={onLogout} className="ml-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-sm font-semibold flex items-center gap-2">
            <LogOut size={16} /> {t('tablet.logout')}
          </button>
        </div>
      </header>

      <nav className="bg-white border-b border-slate-200 px-4 flex gap-1 shrink-0">
        {TABS.map((x) => (
          <button key={x.id} onClick={() => setTab(x.id)}
            className={cn('px-5 py-3 text-base font-bold flex items-center gap-2 border-b-2 -mb-px',
              tab === x.id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800')}>
            <x.icon size={18} /> {x.label}
          </button>
        ))}
      </nav>

      <main className="flex-1 p-6 max-w-4xl w-full mx-auto">
        {tab === 'attendance' && <AttendancePanel session={session} date={date} shift={shift} />}
        {tab === 'production' && <ProductionPanel session={session} date={date} shift={shift} />}
        {tab === 'downtime' && <DowntimePanel session={session} date={date} shift={shift} />}
      </main>
    </div>
  );
}

interface PanelProps { session: TabletSession; date: string; shift: Shift }

// ── Attendance panel (M1.2a) ─────────────────────────────────────────────────

function AttendancePanel({ session, date, shift }: PanelProps) {
  const { t } = useTranslation('production');
  const [onShift, setOnShift] = useState<AttendanceRow[]>([]);
  const [operators, setOperators] = useState<OperatorOption[]>([]);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => { listOperators().then(setOperators).catch((e) => setError(e.message)); }, []);
  const load = () => { listOnShift(session.machine_id, date, shift).then(setOnShift).catch((e) => setError(e.message)); };
  useEffect(() => {
    load();
    const poll = setInterval(load, 10_000);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => { clearInterval(poll); clearInterval(tick); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift]);

  const onShiftIds = useMemo(() => new Set(onShift.map((a) => a.operator_id)), [onShift]);
  const operatorOpts = useMemo<ComboOption[]>(
    () => operators.filter((o) => !onShiftIds.has(o.id)).map((o) => ({ value: o.id, label: `${o.badge_no} · ${o.name}` })),
    [operators, onShiftIds]);

  const doIn = async () => {
    if (!pick) return;
    setBusy(true); setError('');
    try { await clockIn(pick, session.machine_id, date, shift, session.device_id); setPick(''); load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const doOut = async (id: string) => {
    setBusy(true); setError('');
    try { await clockOut(id); load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <>
      {error && <p className="text-red-600 bg-red-50 p-3 rounded-xl mb-4 text-sm">{error}</p>}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-5">
        <h2 className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-3">{t('tablet.clockInTitle')}</h2>
        <div className="flex items-stretch gap-3">
          <div className="flex-1">
            <Combobox value={pick} onChange={setPick} options={operatorOpts} placeholder={t('tablet.pickOperator')} className={bigInput} />
          </div>
          <button onClick={doIn} disabled={!pick || busy}
            className="px-6 h-14 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-base font-bold flex items-center gap-2 shrink-0">
            <UserPlus size={20} /> {t('tablet.clockIn')}
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-widest">{t('tablet.onShiftTitle')}</h2>
          <span className="text-sm text-slate-400">{t('tablet.onShiftCount', { count: onShift.length })}</span>
        </div>
        {onShift.length === 0 ? (
          <p className="px-5 py-12 text-center text-slate-400">{t('tablet.noneOnShift')}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {onShift.map((a) => (
              <li key={a.id} className="px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-slate-400 font-mono text-sm w-12">{a.badge_no}</span>
                  <span className="text-lg font-semibold text-slate-800">{a.operator_name}</span>
                  <span className="ml-2 inline-flex items-center gap-1 text-xs text-slate-400"><Clock size={13} /> {durationLabel(a.check_in_at, now)}</span>
                </div>
                <button onClick={() => doOut(a.id)} disabled={busy}
                  className="px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold disabled:opacity-40 flex items-center gap-2">
                  <LogOut size={16} /> {t('tablet.clockOut')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

// ── Production panel (M1.2b) ─────────────────────────────────────────────────

function ProductionPanel({ session, date, shift }: PanelProps) {
  const { t } = useTranslation('production');
  const [wo, setWo] = useState('');
  const [woStatus, setWoStatus] = useState<'idle' | 'matched' | 'notfound'>('idle');
  const [lookup, setLookup] = useState<WorkOrderLookup | null>(null);
  const [cartFrom, setCartFrom] = useState('');
  const [cartTo, setCartTo] = useState('');
  const [output, setOutput] = useState('');
  const [defect, setDefect] = useState('');
  const [note, setNote] = useState('');
  const [finalComplete, setFinalComplete] = useState(true);
  const [continuesPrev, setContinuesPrev] = useState(false);
  const [carry, setCarry] = useState<number | null>(null);
  const [runs, setRuns] = useState<DailyReportRow[]>([]);
  const [onShiftCount, setOnShiftCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => {
    listTabletRuns(session.machine_id, date, shift).then(setRuns).catch((e) => setError(e.message));
    listOnShift(session.machine_id, date, shift).then((a) => setOnShiftCount(a.length)).catch(() => {});
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [shift]);

  const reset = () => {
    setWo(''); setWoStatus('idle'); setLookup(null); setCartFrom(''); setCartTo('');
    setOutput(''); setDefect(''); setNote(''); setFinalComplete(true); setContinuesPrev(false); setCarry(null);
  };

  const resolveWO = async () => {
    const no = wo.trim();
    if (!no) { setLookup(null); setWoStatus('idle'); setCarry(null); return; }
    try {
      const m = await findWorkOrderByNo(no);
      if (m) {
        setLookup(m); setWoStatus('matched');
        const c = await getCarryOverCart(m.work_order_id);
        if (c) { setCarry(c.continueCart); setCartFrom(String(c.continueCart)); setContinuesPrev(true); }
        else { setCarry(null); setContinuesPrev(false); }
      } else { setLookup(null); setWoStatus('notfound'); setCarry(null); }
    } catch { setWoStatus('notfound'); }
  };

  const out = numOrNull(output) ?? 0;
  const cf = intOrNull(cartFrom) ?? 0;
  const ct = intOrNull(cartTo) ?? 0;
  const totalCarts = ct - cf + 1;
  const lbsGood = (lookup?.bone_avg ?? 0) * out;

  const submit = async () => {
    setBusy(true); setError(''); setMsg('');
    try {
      await submitTabletRun({
        report_date: date, shift, machine_id: session.machine_id, device_id: session.device_id,
        work_order_id: lookup?.work_order_id ?? null,
        product_id: lookup?.product_id ?? null,
        cart_from: intOrNull(cartFrom), cart_to: intOrNull(cartTo),
        output_qty: numOrNull(output) ?? 0,
        defect_waste_lbs: numOrNull(defect),
        note: note.trim() || null,
        final_cart_complete: finalComplete,
        continues_prev: continuesPrev,
      });
      setMsg(t('tablet.runSaved'));
      reset();
      load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <>
      {msg && <p className="text-emerald-700 bg-emerald-50 p-3 rounded-xl mb-4 text-sm">{msg}</p>}
      {error && <p className="text-red-600 bg-red-50 p-3 rounded-xl mb-4 text-sm">{error}</p>}
      {onShiftCount === 0 && (
        <p className="text-amber-700 bg-amber-50 border border-amber-200 p-3 rounded-xl mb-4 text-sm">{t('tablet.noAttendanceWarn')}</p>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-5 space-y-4">
        <div>
          <label className="text-sm font-bold text-slate-500 uppercase tracking-widest">{t('dailyReport.colWorkOrder')}</label>
          <input value={wo} placeholder={t('dailyReport.woScanPlaceholder')}
            onChange={(e) => { setWoStatus('idle'); setWo(e.target.value); setLookup(null); setCarry(null); }}
            onBlur={resolveWO}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); resolveWO(); } }}
            className={cn(bigInput, 'mt-1')} />
          {woStatus === 'matched' && lookup && (
            <p className="text-sm text-emerald-600 mt-1">✓ {lookup.item_number} · {lookup.description}</p>
          )}
          {woStatus === 'notfound' && <p className="text-sm text-amber-600 mt-1">{t('dailyReport.woNotFound')}</p>}
          {carry != null && (
            <p className="text-sm text-indigo-700 bg-indigo-50 rounded-lg px-3 py-2 mt-2">{t('tablet.carryOver', { cart: carry })}</p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label={t('dailyReport.colCartFrom')}>
            <input inputMode="numeric" value={cartFrom} onChange={(e) => setCartFrom(e.target.value)} className={bigInput} />
          </Field>
          <Field label={t('dailyReport.colCartTo')}>
            <input inputMode="numeric" value={cartTo} onChange={(e) => setCartTo(e.target.value)} className={bigInput} />
          </Field>
          <Field label={t('dailyReport.colTotalCarts')}>
            <div className={cn(bigInput, 'flex items-center bg-slate-50 text-slate-700 tabular-nums')}>{fmt(totalCarts, 0)}</div>
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label={t('dailyReport.colOutput')}>
            <input inputMode="decimal" value={output} onChange={(e) => setOutput(e.target.value)} className={bigInput} />
          </Field>
          <Field label={t('dailyReport.colDefect')}>
            <input inputMode="decimal" value={defect} onChange={(e) => setDefect(e.target.value)} className={bigInput} />
          </Field>
          <Field label={t('dailyReport.colLbsGood')}>
            <div className={cn(bigInput, 'flex items-center bg-slate-50 text-slate-700 tabular-nums')}>{fmt(lbsGood)}</div>
          </Field>
        </div>

        <Field label={t('dailyReport.colNote')}>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={bigInput} />
        </Field>

        <label className="flex items-center gap-2">
          <input type="checkbox" checked={finalComplete} onChange={(e) => setFinalComplete(e.target.checked)} className="w-5 h-5" />
          <span className="text-base text-slate-700">{t('tablet.finalCartComplete')}</span>
        </label>

        <button onClick={submit} disabled={busy || out <= 0}
          className="w-full h-14 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-base font-bold flex items-center justify-center gap-2">
          <Check size={20} /> {busy ? t('tablet.saving') : t('tablet.submitRun')}
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200">
          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-widest">{t('tablet.shiftOutputTitle')}</h2>
        </div>
        {runs.length === 0 ? (
          <p className="px-5 py-10 text-center text-slate-400">{t('tablet.noRuns')}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {runs.map((r) => (
              <li key={r.id} className="px-5 py-3 flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span className="font-mono text-slate-400">{r.item_number ?? '—'}</span>
                  <span className="text-slate-700">{r.item_description ?? ''}</span>
                  {r.source === 'tablet' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 font-bold">TABLET</span>}
                </span>
                <span className="tabular-nums text-slate-600">{fmt(r.output_qty, 0)} · {fmt(r.total_carts, 0)} {t('tablet.cartsShort')}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

// ── Downtime panel (M1.2b) ───────────────────────────────────────────────────

function DowntimePanel({ session, date, shift }: PanelProps) {
  const { t } = useTranslation('production');
  const [reasons, setReasons] = useState<DowntimeReasonOption[]>([]);
  const [open, setOpen] = useState<DowntimeEventRow | null>(null);
  const [events, setEvents] = useState<DowntimeEventRow[]>([]);
  const [reasonId, setReasonId] = useState('');
  const [addMinutes, setAddMinutes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => { listDowntimeReasons().then(setReasons).catch((e) => setError(e.message)); }, []);
  const load = () => {
    getOpenDowntime(session.machine_id, date, shift).then(setOpen).catch((e) => setError(e.message));
    listDowntimeToday(session.machine_id, date, shift).then(setEvents).catch((e) => setError(e.message));
  };
  useEffect(() => {
    load();
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift]);

  const reasonOpts = useMemo<ComboOption[]>(() => reasons.map((r) => ({ value: r.id, label: r.label })), [reasons]);

  const start = async () => {
    if (!reasonId) return;
    setBusy(true); setError('');
    try { await startDowntime(session.machine_id, date, shift, reasonId, session.device_id); setReasonId(''); load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const end = async () => {
    if (!open?.start_at) return;
    setBusy(true); setError('');
    try { await endDowntime(open.id, open.start_at); load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const addPast = async () => {
    const m = numOrNull(addMinutes);
    if (!reasonId || m == null || m <= 0) return;
    setBusy(true); setError('');
    try { await addDowntime(session.machine_id, date, shift, reasonId, m, session.device_id); setReasonId(''); setAddMinutes(''); load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <>
      {error && <p className="text-red-600 bg-red-50 p-3 rounded-xl mb-4 text-sm">{error}</p>}

      {open ? (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-5 mb-5 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-rose-500 uppercase tracking-widest">{t('tablet.downtimeOngoing')}</p>
            <p className="text-lg font-bold text-rose-900 mt-1">{open.reason_label}</p>
            <p className="text-sm text-rose-600 mt-0.5 inline-flex items-center gap-1">
              <Clock size={14} /> {open.start_at ? durationLabel(open.start_at, now) : '—'}
            </p>
          </div>
          <button onClick={end} disabled={busy}
            className="px-6 h-14 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white text-base font-bold flex items-center gap-2">
            <Play size={20} /> {t('tablet.endDowntime')}
          </button>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-5">
          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-3">{t('tablet.startDowntimeTitle')}</h2>
          <div className="flex items-stretch gap-3">
            <div className="flex-1">
              <Combobox value={reasonId} onChange={setReasonId} options={reasonOpts} placeholder={t('tablet.pickReason')} className={bigInput} />
            </div>
            <button onClick={start} disabled={!reasonId || busy}
              className="px-6 h-14 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white text-base font-bold flex items-center gap-2 shrink-0">
              <PauseOctagon size={20} /> {t('tablet.startDowntime')}
            </button>
          </div>
          {/* add past */}
          <div className="mt-4 pt-4 border-t border-slate-100">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">{t('tablet.addPastTitle')}</p>
            <div className="flex items-stretch gap-3">
              <input inputMode="numeric" value={addMinutes} onChange={(e) => setAddMinutes(e.target.value)}
                placeholder={t('tablet.minutes')} className={cn(bigInput, 'w-40')} />
              <button onClick={addPast} disabled={!reasonId || !addMinutes || busy}
                className="px-5 h-14 rounded-xl bg-slate-200 hover:bg-slate-300 disabled:opacity-40 text-slate-700 text-base font-bold flex items-center gap-2 shrink-0">
                <Plus size={18} /> {t('tablet.addPast')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200">
          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-widest">{t('tablet.shiftDowntimeTitle')}</h2>
        </div>
        {events.length === 0 ? (
          <p className="px-5 py-10 text-center text-slate-400">{t('tablet.noDowntime')}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {events.map((e) => (
              <li key={e.id} className="px-5 py-3 flex items-center justify-between text-sm">
                <span className="text-slate-700">{e.reason_label}</span>
                <span className="tabular-nums text-slate-600">
                  {e.end_at == null && e.start_at != null
                    ? <span className="text-rose-600 font-bold">{t('tablet.ongoing')}</span>
                    : `${fmt(e.down_minutes, 0)} ${t('tablet.minShort')}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

// shared small field wrapper (module scope — stable identity, no remount/focus loss)
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { Tablet, LogOut, UserPlus, LogIn, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { Combobox, type ComboOption } from '../../components/ui/Combobox';
import {
  tabletLogin, listOnShift, clockIn, clockOut,
  type TabletSession, type AttendanceRow, type Shift,
} from '../../services/productionTabletApi';
import { listOperators, type OperatorOption } from '../../services/productionRunApi';

const SESSION_KEY = 'erp_tablet_device';
const SHIFTS: Shift[] = ['1st', '2nd', '3rd'];

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Best-effort default shift from the wall clock (1st 06–14, 2nd 14–22, 3rd 22–06). */
function defaultShift(): Shift {
  const h = new Date().getHours();
  if (h >= 6 && h < 14) return '1st';
  if (h >= 14 && h < 22) return '2nd';
  return '3rd';
}

function durationLabel(fromISO: string, nowMs: number): string {
  const mins = Math.max(0, Math.round((nowMs - new Date(fromISO).getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function TabletApp() {
  const [session, setSession] = useState<TabletSession | null>(() => {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as TabletSession) : null;
  });

  if (!session) {
    return (
      <TabletLogin
        onSuccess={(s) => { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); setSession(s); }}
      />
    );
  }
  return (
    <AttendanceWorkstation
      session={session}
      onLogout={() => { sessionStorage.removeItem(SESSION_KEY); setSession(null); }}
    />
  );
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
    try {
      const s = await tabletLogin(code, pin);
      onSuccess(s);
    } catch {
      setError(t('tablet.loginError'));
    } finally {
      setBusy(false);
    }
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
          <input
            value={code} onChange={(e) => setCode(e.target.value)}
            placeholder={t('tablet.deviceCode')} autoFocus autoComplete="off"
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-base text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <input
            type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)}
            placeholder={t('tablet.pin')} autoComplete="off"
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-base text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
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

// ── Attendance workstation ───────────────────────────────────────────────────

function AttendanceWorkstation({ session, onLogout }: { session: TabletSession; onLogout: () => void }) {
  const { t } = useTranslation('production');
  const date = todayISO();
  const [shift, setShift] = useState<Shift>(defaultShift());
  const [onShift, setOnShift] = useState<AttendanceRow[]>([]);
  const [operators, setOperators] = useState<OperatorOption[]>([]);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    listOperators().then(setOperators).catch((e) => setError(e.message));
  }, []);

  const load = () => {
    listOnShift(session.machine_id, date, shift)
      .then(setOnShift)
      .catch((e) => setError(e.message));
  };
  useEffect(() => {
    load();
    const poll = setInterval(load, 10_000);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => { clearInterval(poll); clearInterval(tick); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift]);

  const onShiftIds = useMemo(() => new Set(onShift.map((a) => a.operator_id)), [onShift]);
  const operatorOpts = useMemo<ComboOption[]>(
    () => operators
      .filter((o) => !onShiftIds.has(o.id))
      .map((o) => ({ value: o.id, label: `${o.badge_no} · ${o.name}` })),
    [operators, onShiftIds],
  );

  const doClockIn = async () => {
    if (!pick) return;
    setBusy(true); setError('');
    try {
      await clockIn(pick, session.machine_id, date, shift, session.device_id);
      setPick('');
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doClockOut = async (id: string) => {
    setBusy(true); setError('');
    try {
      await clockOut(id);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      {/* top bar */}
      <header className="bg-[#0a0f1d] text-white px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center">
            <Tablet size={20} />
          </div>
          <div>
            <p className="text-lg font-bold leading-none">{session.machine_code}</p>
            <p className="text-[11px] text-slate-400 mt-1">{session.name ?? session.code} · {date}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-xl border border-white/15 overflow-hidden">
            {SHIFTS.map((s) => (
              <button key={s} onClick={() => setShift(s)}
                className={cn('px-5 py-2.5 text-base font-bold',
                  shift === s ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-white/5')}>
                {s}
              </button>
            ))}
          </div>
          <button onClick={onLogout}
            className="ml-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-sm font-semibold flex items-center gap-2">
            <LogOut size={16} /> {t('tablet.logout')}
          </button>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-4xl w-full mx-auto">
        {error && <p className="text-red-600 bg-red-50 p-3 rounded-xl mb-4 text-sm">{error}</p>}

        {/* clock-in */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-5">
          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-3">{t('tablet.clockInTitle')}</h2>
          <div className="flex items-stretch gap-3">
            <div className="flex-1">
              <Combobox value={pick} onChange={setPick} options={operatorOpts}
                placeholder={t('tablet.pickOperator')}
                className="w-full border border-slate-300 rounded-xl px-4 h-14 text-base focus:outline-none focus:ring-2 focus:ring-indigo-200" />
            </div>
            <button onClick={doClockIn} disabled={!pick || busy}
              className="px-6 h-14 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-base font-bold flex items-center gap-2 shrink-0">
              <UserPlus size={20} /> {t('tablet.clockIn')}
            </button>
          </div>
        </div>

        {/* on-shift list */}
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
                    <span className="ml-2 inline-flex items-center gap-1 text-xs text-slate-400">
                      <Clock size={13} /> {durationLabel(a.check_in_at, now)}
                    </span>
                  </div>
                  <button onClick={() => doClockOut(a.id)} disabled={busy}
                    className="px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold disabled:opacity-40 flex items-center gap-2">
                    <LogOut size={16} /> {t('tablet.clockOut')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import {
  Flame, Hourglass, FlaskConical, ListChecks,
  CheckCircle2, XCircle, Thermometer, Clock,
  ChevronRight, RefreshCw,
} from 'lucide-react';
import {
  getQcOverview,
  releasePassedSubLot,
  formatQcDateTime,
  QcOverview,
  NeedsAttentionItem,
} from '../../services/qcApi';
import { usePermissions } from '../../contexts/PermissionContext';
import { cn } from '../../lib/utils';

interface Props {
  onNavigate: (screen: string) => void;
  onOpenSubLot?: (subLotId: string) => void;        // for Fail → open Testing + select
  onOpenHistory?: (subLotId: string) => void;
}

export default function QcHome({ onNavigate, onOpenSubLot, onOpenHistory }: Props) {
  const { can } = usePermissions();
  const canRelease = can('qc', 'dashboard', 'release_pass');
  const canDisposeAny =
    can('qc', 'testing', 'dispose_redry') ||
    can('qc', 'testing', 'dispose_room_temp') ||
    can('qc', 'testing', 'dispose_scrap_concession');

  const [overview, setOverview] = useState<QcOverview | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    try {
      const d = await getQcOverview();
      setOverview(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    }
    setRefreshing(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  const handleRelease = async (item: NeedsAttentionItem) => {
    if (!canRelease) return;
    setBusyId(item.drying_sub_lot_id);
    setError('');
    try {
      await releasePassedSubLot(item.drying_sub_lot_id);
      setMsg(`${item.sub_lot_code} released to next process`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Release failed');
    }
    setBusyId(null);
  };

  const handleDispose = (item: NeedsAttentionItem) => {
    // Navigate to Testing and pre-select this sub-lot — the disposition picker
    // lives on the workflow there. (TestingPage will auto-pop the picker since
    // the sub-lot is in 'hold' status.)
    if (onOpenSubLot) onOpenSubLot(item.drying_sub_lot_id);
    else onNavigate('testing');
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-end justify-between mb-1">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Quality Control</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Today {overview?.today ?? '—'} · live dashboard, auto-refresh every 15s
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={refreshing}
          className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded border border-slate-200 hover:border-blue-400 hover:text-blue-700 text-slate-700 disabled:opacity-50"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {msg && <p className="text-emerald-700 bg-emerald-50 p-2 rounded-lg mt-3 text-sm flex items-center gap-2">
        <CheckCircle2 size={14} /> {msg}
      </p>}
      {error && <p className="text-red-600 bg-red-50 p-2 rounded-lg mt-3 text-sm">{error}</p>}

      {/* ── Stat cards ───────────────────────────────────────────────── */}
      {overview && (
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-5">
          <StatCard
            label="Expected finish today" value={overview.stats.expected_finish_today}
            icon={Clock} accent="slate"
          />
          <StatCard
            label="Currently drying" value={overview.stats.currently_drying}
            icon={Flame} accent="amber"
            onClick={() => onNavigate('dry-rooms')}
          />
          <StatCard
            label="Room temp drying" value={overview.stats.room_temp_drying}
            icon={Thermometer} accent="orange"
            onClick={() => onNavigate('room-temp')}
          />
          <StatCard
            label="Awaiting sample" value={overview.stats.awaiting_sample}
            icon={Hourglass} accent="slate"
            onClick={() => onNavigate('testing')}
          />
          <StatCard
            label="Awaiting WA result" value={overview.stats.awaiting_wa_result}
            icon={FlaskConical} accent="blue"
            onClick={() => onNavigate('testing')}
          />
          <StatCard
            label={`Passed / Failed today (${overview.stats.pass_rate_pct ?? '—'}%)`}
            value={`${overview.stats.passed_today} / ${overview.stats.failed_today}`}
            icon={ListChecks} accent="emerald"
          />
        </section>
      )}

      {/* ── Needs attention list ─────────────────────────────────────── */}
      {overview && (
        <section className="mt-6">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-sm font-bold text-slate-900">
              Needs attention <span className="text-slate-400 font-normal">(last 24h test results)</span>
            </h2>
            <span className="text-[10px] uppercase tracking-widest font-bold text-slate-400">
              {overview.needs_attention.length} entries
            </span>
          </div>

          {overview.needs_attention.length === 0 ? (
            <div className="bg-white border rounded-xl p-8 text-center text-sm text-slate-500">
              No new pass or fail results yet today.
            </div>
          ) : (
            <ul className="space-y-2">
              {overview.needs_attention.map(item => (
                <NeedsAttentionRow
                  key={item.inspection_id}
                  item={item}
                  busy={busyId === item.drying_sub_lot_id}
                  canRelease={canRelease}
                  canDispose={canDisposeAny}
                  onRelease={() => handleRelease(item)}
                  onDispose={() => handleDispose(item)}
                  onOpenHistory={onOpenHistory ? () => onOpenHistory(item.drying_sub_lot_id) : undefined}
                />
              ))}
            </ul>
          )}
        </section>
      )}

    </div>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────────

function StatCard({
  label, value, icon: Icon, accent, onClick,
}: {
  label: string; value: number | string; icon: React.ElementType;
  accent: 'amber' | 'orange' | 'slate' | 'blue' | 'emerald' | 'red';
  onClick?: () => void;
}) {
  const colors: Record<string, string> = {
    amber:   'bg-amber-50 border-amber-200 text-amber-900',
    orange:  'bg-orange-50 border-orange-200 text-orange-900',
    slate:   'bg-slate-50 border-slate-200 text-slate-800',
    blue:    'bg-blue-50 border-blue-200 text-blue-900',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    red:     'bg-red-50 border-red-200 text-red-900',
  };
  const ButtonEl: React.ElementType = onClick ? 'button' : 'div';
  return (
    <ButtonEl
      onClick={onClick}
      className={cn(
        'rounded-xl border-2 p-3 text-left transition-all',
        colors[accent],
        onClick ? 'cursor-pointer hover:shadow-md hover:scale-[1.02]' : '',
      )}
    >
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-bold opacity-80">
        <Icon size={12} />
        <span className="leading-none">{label}</span>
      </div>
      <p className="text-2xl font-bold tabular-nums mt-1.5">{value}</p>
    </ButtonEl>
  );
}

function NeedsAttentionRow({
  item, busy, canRelease, canDispose, onRelease, onDispose, onOpenHistory,
}: {
  item: NeedsAttentionItem;
  busy: boolean;
  canRelease: boolean;
  canDispose: boolean;
  onRelease: () => void;
  onDispose: () => void;
  onOpenHistory?: () => void;
}) {
  const isPass = item.result === 'pass';
  const isReleased = item.current_status === 'closed';
  const isDisposed = item.current_status !== 'hold' && item.current_status !== 'passed';

  return (
    <li className={cn(
      'flex items-center gap-3 border-2 rounded-xl p-3',
      isPass ? 'border-emerald-200 bg-emerald-50/30' : 'border-red-200 bg-red-50/30',
    )}>
      {isPass
        ? <CheckCircle2 size={20} className="text-emerald-600 shrink-0" />
        : <XCircle size={20} className="text-red-600 shrink-0" />
      }
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={onOpenHistory}
            disabled={!onOpenHistory}
            className={cn(
              'font-mono font-bold text-sm',
              onOpenHistory ? 'text-blue-700 hover:underline' : 'text-slate-900',
            )}
          >
            {item.sub_lot_code}
          </button>
          <span className={cn(
            'text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded',
            isPass ? 'bg-emerald-200 text-emerald-900' : 'bg-red-200 text-red-900',
          )}>
            {item.result}
          </span>
          {item.sample_id && (
            <span className="text-[11px] text-slate-500">
              sample <code className="font-mono font-bold">{item.sample_id}</code>
            </span>
          )}
          {item.aw != null && (
            <span className="text-[11px] text-slate-500">Aw <span className="font-mono font-bold">{item.aw}</span></span>
          )}
        </div>
        <p className="text-[11px] text-slate-500 mt-0.5">
          {item.sku_name ?? '—'}{item.lot_number ? ` · ${item.lot_number}` : ''} · {formatQcDateTime(item.submitted_at)}
        </p>
      </div>

      {/* Right side action */}
      {isPass && !isReleased && (
        <button
          type="button"
          onClick={onRelease}
          disabled={!canRelease || busy}
          title={canRelease ? 'Release to next process (status: passed → closed)' : 'Missing qc.dashboard.release_pass permission'}
          className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          {busy ? 'Releasing…' : 'Release'} <ChevronRight size={11} />
        </button>
      )}
      {isPass && isReleased && (
        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 px-2">Released</span>
      )}
      {!isPass && !isDisposed && (
        <button
          type="button"
          onClick={onDispose}
          disabled={!canDispose}
          title={canDispose ? 'Open Testing → choose disposition' : 'Missing qc.testing.dispose_* permission'}
          className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-bold bg-red-600 hover:bg-red-500 text-white disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          Dispose <ChevronRight size={11} />
        </button>
      )}
      {!isPass && isDisposed && (
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-2">
          {item.current_status}
        </span>
      )}
    </li>
  );
}


import React, { useEffect, useState } from 'react';
import {
  Flame, Hourglass, FlaskConical, ListChecks,
  CheckCircle2, XCircle, Thermometer, Clock,
  ChevronRight, ChevronDown, RefreshCw, TrendingUp, X, Package,
} from 'lucide-react';
import {
  getQcOverview,
  dashboardPassRateForecast,
  getRecentFailedInspections,
  getRecentPassedInspections,
  formatQcDateTime,
  QcOverview,
  NeedsAttentionItem,
  PassRateForecastItem,
  RecentFailItem,
  FailOutcome,
  RecentPassItem,
  PassOutcome,
} from '../../services/qcApi';
import { getInventorySummary, getAvailableCarts, PkgInventorySku, PkgCart } from '../../services/pkgApi';
import { usePermissions } from '../../contexts/PermissionContext';
import { cn, dallasToday, dallasDaysAgo } from '../../lib/utils';
import { HelpPopover } from '../../components/ui/HelpPopover';
import { DisposeDialog } from './components/DisposeDialog';
import { ReleaseDialog } from './components/ReleaseDialog';
import { PermissionDenied } from './components/PermissionDenied';

interface Props {
  onNavigate: (screen: string) => void;
  onOpenSubLot?: (subLotId: string) => void;        // for Fail → open Testing + select
  onOpenHistory?: (subLotId: string) => void;
}

export default function QcHome({ onNavigate, onOpenSubLot, onOpenHistory }: Props) {
  const { can } = usePermissions();
  const canView = can('qc', 'dashboard', 'view');
  const canRelease = can('qc', 'dashboard', 'release_pass');
  const dispositionPerms = {
    redry: can('qc', 'testing', 'dispose_redry'),
    room_temp: can('qc', 'testing', 'dispose_room_temp'),
    retest: can('qc', 'testing', 'dispose_retest'),
    scrap: can('qc', 'testing', 'dispose_scrap_concession'),
  };
  const canDisposeAny =
    dispositionPerms.redry || dispositionPerms.room_temp ||
    dispositionPerms.retest || dispositionPerms.scrap;

  const [overview, setOverview] = useState<QcOverview | null>(null);
  const [forecast, setForecast] = useState<PassRateForecastItem[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [disposeTarget, setDisposeTarget] = useState<NeedsAttentionItem | null>(null);
  const [releaseTarget, setReleaseTarget] = useState<NeedsAttentionItem | null>(null);
  const [showFailPanel, setShowFailPanel] = useState(false);
  const [recentFails, setRecentFails] = useState<RecentFailItem[]>([]);
  const [failsLoading, setFailsLoading] = useState(false);
  const [showPassPanel, setShowPassPanel] = useState(false);
  const [recentPasses, setRecentPasses] = useState<RecentPassItem[]>([]);
  const [passesLoading, setPassesLoading] = useState(false);
  const [inventory, setInventory] = useState<PkgInventorySku[]>([]);
  const [expandedSkus, setExpandedSkus] = useState<Set<string>>(new Set());
  const [bucketDetail, setBucketDetail] = useState<{
    sku_code: string; sku_name: string; days: number; carts: PkgCart[];
  } | null>(null);

  const load = async () => {
    setRefreshing(true);
    try {
      const [d, fc, inv] = await Promise.all([
        getQcOverview(),
        dashboardPassRateForecast().catch(() => [] as PassRateForecastItem[]),
        getInventorySummary().catch(() => [] as PkgInventorySku[]),
      ]);
      setOverview(d);
      setForecast(fc);
      setInventory(inv);
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

  /** Immediately remove an item from needs_attention, then refresh in background. */
  const removeAttentionItem = (inspectionId: string) => {
    setOverview(prev => prev ? {
      ...prev,
      needs_attention: prev.needs_attention.filter(i => i.inspection_id !== inspectionId),
    } : prev);
    load();
  };

  const handleRelease = (item: NeedsAttentionItem) => {
    if (!canRelease) return;
    setError('');
    setReleaseTarget(item);
  };

  const onReleased = () => {
    const item = releaseTarget;
    if (!item) return;
    const label = item.group_size > 1 ? `${item.group_size} carts` : item.sub_lot_code;
    setMsg(`${label} released to next process`);
    setReleaseTarget(null);
    removeAttentionItem(item.inspection_id);
    // Reload so the Released Inventory section picks up the cart immediately,
    // not after the next 15s auto-refresh tick.
    load();
  };

  const handleDispose = (item: NeedsAttentionItem) => {
    setDisposeTarget(item);
  };

  const onDisposed = () => {
    const label = disposeTarget
      ? disposeTarget.group_size > 1 ? `${disposeTarget.group_size} carts` : disposeTarget.sub_lot_code
      : '—';
    setMsg(`${label} disposed`);
    const id = disposeTarget?.inspection_id;
    setDisposeTarget(null);
    if (id) removeAttentionItem(id);
    else load();
  };

  if (!canView) {
    return <PermissionDenied permission="qc.dashboard.view" feature="QC Home" />;
  }

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

      {/* ── Stat cards (grouped: Drying floor + Testing pipeline) ────── */}
      {overview && (
        <>
          {/* Drying floor */}
          <section className="mt-5">
            <SectionHeader
              title="Drying floor"
              help={{
                title: 'Drying floor',
                content: 'How many carts are in or moving through the dryers right now.',
              }}
            />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <StatCard
                label="Currently drying" value={overview.stats.currently_drying}
                icon={Flame} accent="amber"
                onClick={() => onNavigate('dry-rooms')}
                help={{
                  content: 'Carts inside a dryer at this moment — checked in but not yet checked out. Click to see them dryer by dryer.',
                }}
              />
              <StatCard
                label="Expected finish today" value={overview.stats.expected_finish_today}
                icon={Clock} accent="slate"
                help={{
                  content: 'Of the carts currently in dryers, how many are expected to come out before the end of today. Based on each cart\'s check-in time plus the drying time you set for it.',
                }}
              />
              <StatCard
                label="Room temp drying" value={overview.stats.room_temp_drying}
                icon={Thermometer} accent="orange"
                onClick={() => onNavigate('room-temp')}
                help={{
                  content: 'Carts sitting on the room-temperature rack right now. Carts land here when a batch fails inspection and the operator picks "Room temp dry" as the next step. Click to see them.',
                }}
              />
            </div>
          </section>

          {/* Testing pipeline */}
          <section className="mt-4">
            <SectionHeader
              title="Testing pipeline"
              help={{
                title: 'Testing pipeline',
                content: 'What\'s happening on the testing bench. The first two are queues waiting for you to do something; the last two are today\'s results so far.',
              }}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard
                label="Awaiting sample" value={overview.stats.awaiting_sample}
                icon={Hourglass} accent="slate"
                onClick={() => onNavigate('testing')}
                help={{
                  content: 'Carts that have come out of the dryer but no one has taken a sample yet. Click to open Testing and start sampling.',
                }}
              />
              <StatCard
                label="Awaiting WA result" value={overview.stats.awaiting_wa_result}
                icon={FlaskConical} accent="blue"
                onClick={() => onNavigate('testing')}
                help={{
                  content: 'Carts whose sample has already been taken, but the water-activity reading hasn\'t been entered yet. Click to open Testing and finish them off.',
                }}
              />
              <StatCard
                label={`Passed today (${overview.stats.pass_rate_pct ?? '—'}%)`}
                value={overview.stats.passed_today}
                icon={CheckCircle2} accent="emerald"
                onClick={() => {
                  setShowPassPanel(v => !v);
                  if (!showPassPanel) {
                    setPassesLoading(true);
                    getRecentPassedInspections(2)
                      .then(setRecentPasses)
                      .catch(() => {})
                      .finally(() => setPassesLoading(false));
                  }
                }}
                help={{
                  title: 'Passed today',
                  content: 'How many carts have passed inspection since this morning. The percentage in parentheses is today\'s overall pass rate — passes divided by total tests done today. Click the card to see what passed in the last two days, with each row tagged "Released" or "Awaiting release".',
                }}
              />
              <StatCard
                label="Failed today"
                value={overview.stats.failed_today}
                icon={XCircle} accent="red"
                onClick={() => {
                  setShowFailPanel(v => !v);
                  if (!showFailPanel) {
                    setFailsLoading(true);
                    getRecentFailedInspections(2)
                      .then(setRecentFails)
                      .catch(() => {})
                      .finally(() => setFailsLoading(false));
                  }
                }}
                subline={(() => {
                  const total = overview.stats.failed_today;
                  const open = overview.stats.failed_today_open;
                  if (total === 0 || open == null) return null;
                  const resolved = Math.max(0, total - open);
                  return (
                    <>
                      <span className="font-bold">{open}</span> still open · {resolved} resolved
                    </>
                  );
                })()}
                help={{
                  content: 'How many carts have failed inspection since this morning — the big number is the running total today (it does NOT shrink when a retest passes). The smaller "X still open · Y resolved" line breaks that down: "open" = no retest pass yet AND not scrapped/discarded yet; "resolved" = already retested to pass or sent to scrap / grind / concession / rework. Click the card to see what failed in the last two days, with each row tagged by outcome.',
                }}
              />
            </div>
          </section>
        </>
      )}

      {/* ── Fail detail panel ────────────────────────────────────────── */}
      {showFailPanel && (
        <FailDetailPanel
          items={recentFails}
          loading={failsLoading}
          onClose={() => setShowFailPanel(false)}
          onOpenHistory={onOpenHistory}
        />
      )}

      {/* ── Pass detail panel ────────────────────────────────────────── */}
      {showPassPanel && (
        <PassDetailPanel
          items={recentPasses}
          loading={passesLoading}
          onClose={() => setShowPassPanel(false)}
          onOpenHistory={onOpenHistory}
        />
      )}

      {/* ── Pass-rate forecast per SKU (M-050) ───────────────────────── */}
      {forecast.length > 0 && (
        <section className="mt-6">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <TrendingUp size={14} className="text-emerald-600" />
              Predicted passes (in-flight × today's pass rate)
              <HelpPopover
                size={13}
                triggerClass="text-emerald-700"
                content={
                  <>
                    A rough estimate of how many more carts will pass by the end of today, broken out per product.
                    <br /><br />
                    We count every cart that doesn&apos;t have a final result yet — anything still drying, waiting to be tested, mid-inspection, on the room-temp rack, or being re-dried — and multiply by today&apos;s pass rate so far.
                    <br /><br />
                    If nothing has been tested yet today, we assume 100% to stay optimistic.
                  </>
                }
              />
            </h2>
            <span className="text-[10px] uppercase tracking-widest font-bold text-slate-400">
              per product
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {forecast.map(f => {
              const rate = f.today_pass_rate;
              const ratePct = rate != null ? Math.round(rate * 100) : null;
              return (
                <div key={f.sku_id} className="bg-white border-2 border-slate-200 rounded-xl p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold font-mono">
                        {f.sku_code}
                      </p>
                      <p className="text-sm font-bold text-slate-900 truncate">{f.sku_name}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-3xl font-bold tabular-nums text-emerald-700">
                        {f.forecast_passes}
                      </p>
                      <p className="text-[10px] text-slate-400">est. passes</p>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-600">
                    <span className="font-mono">{f.in_progress}</span>
                    <span className="text-slate-400">in flight ·</span>
                    {ratePct != null ? (
                      <span className="font-mono">{ratePct}% today</span>
                    ) : (
                      <span className="text-slate-400">no tests today (assumes 100%)</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Needs attention list ─────────────────────────────────────── */}
      {overview && (
        <section className="mt-6">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              Needs attention <span className="text-slate-400 font-normal">(today's test results)</span>
              <HelpPopover
                size={13}
                content={
                  <>
                    Test results from today that still need your action. Each sampling group shows up as <strong>one row</strong> — even if you re-tested it a few times, only the latest result appears here.
                    <br /><br />
                    A green <strong>PASS</strong> row means the whole group is ready to release to packaging. A red <strong>FAIL</strong> row means the whole group needs a disposition (re-test, re-dry, room-temp dry, or scrap).
                    <br /><br />
                    Inside a row, the cart highlighted in <strong>green</strong> is the one that was physically sampled — the others share its result because they&apos;re in the same sampling group.
                  </>
                }
              />
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
                  busy={false}
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

      {/* ── Released Inventory (packaging queue) ─────────────────────── */}
      <section className="mt-6">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
            <Package size={14} className="text-orange-600" />
            Released Inventory
          </h2>
          <span className="text-[10px] uppercase tracking-widest font-bold text-slate-400">
            awaiting packaging dispatch
          </span>
        </div>

        {inventory.length === 0 ? (
          <p className="text-xs text-slate-400 py-2">No released carts in packaging.</p>
        ) : (
          <ul className="space-y-2">
            {inventory.map(item => (
              <InventoryRow
                key={item.sku_id}
                item={item}
                isExpanded={expandedSkus.has(item.sku_id)}
                onToggle={() => setExpandedSkus(prev => {
                  const next = new Set(prev);
                  if (next.has(item.sku_id)) next.delete(item.sku_id);
                  else next.add(item.sku_id);
                  return next;
                })}
                onBarClick={(days, carts) => setBucketDetail({
                  sku_code: item.sku_code,
                  sku_name: item.sku_name,
                  days,
                  carts,
                })}
              />
            ))}
          </ul>
        )}
      </section>

      <CartBucketModal bucket={bucketDetail} onClose={() => setBucketDetail(null)} />

      <DisposeDialog
        open={disposeTarget !== null}
        subLot={disposeTarget ? {
          id: disposeTarget.drying_sub_lot_id,
          sub_lot_code: disposeTarget.sub_lot_code,
          sku_name: disposeTarget.sku_name,
          expected_dry_minutes: null,
          hold_reason: null,
        } : null}
        subLotIds={disposeTarget?.group_sub_lot_ids}
        subLotCodes={disposeTarget?.group_sub_lot_codes}
        championSubLotId={disposeTarget?.drying_sub_lot_id}
        permissions={dispositionPerms}
        onClose={() => setDisposeTarget(null)}
        onDisposed={onDisposed}
      />

      <ReleaseDialog
        open={releaseTarget !== null}
        subLotIds={releaseTarget?.group_sub_lot_ids ?? []}
        subLotCodes={releaseTarget?.group_sub_lot_codes ?? []}
        skuName={releaseTarget?.sku_name}
        lotNumber={releaseTarget?.lot_number}
        onClose={() => setReleaseTarget(null)}
        onReleased={onReleased}
      />
    </div>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────────

/** Small group header above each row of stat cards. */
function SectionHeader({
  title,
  help,
}: {
  title: string;
  help?: { title?: string; content: React.ReactNode };
}) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <h3 className="text-[10px] uppercase tracking-widest font-bold text-slate-500">{title}</h3>
      {help && (
        <HelpPopover
          title={help.title ?? title}
          content={help.content}
          size={11}
          triggerClass="text-slate-400"
          align="left"
        />
      )}
    </div>
  );
}

function StatCard({
  label, value, icon: Icon, accent, onClick, help, subline,
}: {
  label: string; value: number | string; icon: React.ElementType;
  accent: 'amber' | 'orange' | 'slate' | 'blue' | 'emerald' | 'red';
  onClick?: () => void;
  help?: { title?: string; content: React.ReactNode };
  /** Optional small text shown directly below the big number. */
  subline?: React.ReactNode;
}) {
  const colors: Record<string, string> = {
    amber:   'bg-amber-50 border-amber-200 text-amber-900',
    orange:  'bg-orange-50 border-orange-200 text-orange-900',
    slate:   'bg-slate-50 border-slate-200 text-slate-800',
    blue:    'bg-blue-50 border-blue-200 text-blue-900',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    red:     'bg-red-50 border-red-200 text-red-900',
  };
  const triggerHints: Record<string, string> = {
    amber:   'text-amber-700',
    orange:  'text-orange-700',
    slate:   'text-slate-500',
    blue:    'text-blue-700',
    emerald: 'text-emerald-700',
    red:     'text-red-700',
  };
  const ButtonEl: React.ElementType = onClick ? 'button' : 'div';
  return (
    // Outer wrapper provides the positioning context for the help popover
    // so the popover button is NOT a descendant of the card button (HTML
    // forbids nested <button>s and React warns about it).
    <div className="relative">
      <ButtonEl
        onClick={onClick}
        className={cn(
          'block w-full rounded-xl border-2 p-3 text-left transition-all',
          colors[accent],
          onClick ? 'cursor-pointer hover:shadow-md hover:scale-[1.02]' : '',
        )}
      >
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-bold opacity-80 pr-5">
          <Icon size={12} />
          <span className="leading-none">{label}</span>
        </div>
        <p className="text-2xl font-bold tabular-nums mt-1.5">{value}</p>
        {subline && (
          <p className="text-[11px] font-medium opacity-80 mt-0.5 leading-snug">{subline}</p>
        )}
      </ButtonEl>
      {help && (
        <HelpPopover
          title={help.title ?? label}
          content={help.content}
          className="absolute top-2 right-2 z-10"
          triggerClass={triggerHints[accent]}
        />
      )}
    </div>
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
  const [expanded, setExpanded] = useState(false);
  const isPass    = item.result === 'pass';
  // If a PASS item is in needs_attention, it is ALWAYS still actionable
  // (M-066 filter guarantees at least one group member is still 'passed').
  // isReleased is no longer used to gate the Release button — the item
  // disappears once all members are released.
  const isDisposed = item.current_status !== 'hold' && item.current_status !== 'passed'
                     && item.current_status !== 'awaiting_group_result';
  const isGroup   = item.group_size > 1;

  return (
    <li className={cn(
      'border-2 rounded-xl overflow-hidden',
      isPass ? 'border-emerald-200 bg-emerald-50/30' : 'border-red-200 bg-red-50/30',
    )}>
      {/* Main row */}
      <div className="flex items-start gap-3 p-3">
        {isPass
          ? <CheckCircle2 size={20} className="text-emerald-600 shrink-0 mt-0.5" />
          : <XCircle     size={20} className="text-red-600 shrink-0 mt-0.5" />
        }

        <div className="flex-1 min-w-0">
          {/* Sample ID + result badge + Aw */}
          <div className="flex items-center gap-2 flex-wrap">
            {item.sample_id ? (
              <button
                type="button"
                onClick={onOpenHistory}
                disabled={!onOpenHistory}
                className={cn(
                  'font-mono font-bold text-sm',
                  onOpenHistory ? 'text-blue-700 hover:underline' : 'text-slate-900',
                )}
              >
                {item.sample_id}
              </button>
            ) : (
              <span className="font-mono font-bold text-sm text-slate-900">{item.sub_lot_code}</span>
            )}
            <span className={cn(
              'text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded',
              isPass ? 'bg-emerald-200 text-emerald-900' : 'bg-red-200 text-red-900',
            )}>
              {item.result}
            </span>
            {item.aw != null && (
              <span className="text-[11px] text-slate-500">
                Aw <span className="font-mono font-bold">{item.aw}</span>
              </span>
            )}
          </div>

          {/* Cart badges */}
          <div className="flex flex-wrap gap-1 mt-1.5">
            {item.group_sub_lot_codes.map(code => (
              <span
                key={code}
                className={cn(
                  'font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border',
                  code === item.sub_lot_code
                    ? isPass ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                               : 'bg-red-100 text-red-800 border-red-300'
                    : 'bg-white text-slate-600 border-slate-300',
                )}
                title={code === item.sub_lot_code ? 'tested cart' : 'group member'}
              >
                {code}
              </span>
            ))}
          </div>

          {/* Sub-line: SKU · lot · time */}
          <p className="text-[11px] text-slate-500 mt-1">
            {item.sku_name ?? '—'}
            {item.work_order_barcode ? ` · ${item.work_order_barcode}` : item.lot_number ? ` · ${item.lot_number}` : ''}
            {' · '}{formatQcDateTime(item.submitted_at)}
            {isGroup && (
              <button
                type="button"
                onClick={() => setExpanded(v => !v)}
                className="ml-2 text-blue-600 hover:underline inline-flex items-center gap-0.5"
              >
                {expanded ? 'hide details' : `see ${item.group_size} carts`}
                {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              </button>
            )}
          </p>
        </div>

        {/* Right-side action */}
        <div className="shrink-0 flex items-center gap-2 ml-1">
          {isPass && (
            <button
              type="button"
              onClick={onRelease}
              disabled={!canRelease || busy}
              title={canRelease ? `Release ${isGroup ? `all ${item.group_size} carts` : 'cart'} (passed → closed)` : 'Missing qc.testing.release_pass permission'}
              className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? 'Releasing…' : isGroup ? `Release all ${item.group_size}` : 'Release'}
              <ChevronRight size={11} />
            </button>
          )}
          {!isPass && !isDisposed && (
            <button
              type="button"
              onClick={onDispose}
              disabled={!canDispose}
              className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-bold bg-red-600 hover:bg-red-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isGroup ? `Dispose all ${item.group_size}` : 'Dispose'}
              <ChevronRight size={11} />
            </button>
          )}
          {!isPass && isDisposed && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              {item.current_status}
            </span>
          )}
        </div>
      </div>

      {/* Expandable group detail */}
      {expanded && isGroup && (
        <div className="border-t border-red-100 bg-white/60 px-4 py-3">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2">
            Carts in this group
          </p>
          <div className="flex flex-wrap gap-2">
            {item.group_sub_lot_codes.map(code => (
              <span
                key={code}
                className={cn(
                  'font-mono text-xs font-semibold px-2 py-1 rounded border',
                  code === item.sub_lot_code
                    ? 'bg-red-100 text-red-800 border-red-300'
                    : 'bg-slate-50 text-slate-700 border-slate-200',
                )}
              >
                {code}
                {code === item.sub_lot_code && (
                  <span className="ml-1 text-[9px] text-red-600 font-bold">tested</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}

// ── Fail detail panel ──────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  passed:                { label: 'Pass',                 cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  closed:                { label: 'Closed',                cls: 'bg-slate-100 text-slate-600 border-slate-300' },
  dispatched:            { label: 'Packaged',              cls: 'bg-teal-100 text-teal-800 border-teal-300' },
  hold:                  { label: 'On hold',               cls: 'bg-red-100 text-red-800 border-red-300' },
  awaiting_group_result: { label: 'Awaiting group result', cls: 'bg-slate-100 text-slate-600 border-slate-300' },
  drying:                { label: 'Re-drying',             cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  room_temp_drying:      { label: 'Room temp dry',         cls: 'bg-orange-100 text-orange-800 border-orange-300' },
  pending:               { label: 'Pending',               cls: 'bg-slate-100 text-slate-700 border-slate-300' },
  inspecting:            { label: 'Inspecting',            cls: 'bg-blue-100 text-blue-800 border-blue-300' },
  awaiting_recheck:      { label: 'Awaiting recheck',      cls: 'bg-purple-100 text-purple-800 border-purple-300' },
  disposing:             { label: 'Disposing',             cls: 'bg-slate-200 text-slate-700 border-slate-300' },
};

function statusBadge(status: string) {
  const s = STATUS_LABEL[status] ?? { label: status, cls: 'bg-slate-100 text-slate-600 border-slate-200' };
  return (
    <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded border font-mono', s.cls)}>
      {s.label}
    </span>
  );
}

/** Group label for a UTC ISO string using Dallas local date. */
function dayLabel(isoStr: string): string {
  const dallasDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(isoStr));
  if (dallasDate === dallasToday()) return 'Today';
  if (dallasDate === dallasDaysAgo(1)) return 'Yesterday';
  // Format as "May 25"
  const [, mon, day] = dallasDate.split('-');
  const label = new Date(`${dallasDate}T12:00:00`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  });
  return label || `${mon}/${day}`;
}

/**
 * Tiny chip showing what happened to a failed inspection after the fact.
 * Renders nothing for legacy rows that don't carry an outcome (in case the
 * frontend ships before the M-120 migration is applied).
 */
function FailOutcomeBadge({ outcome }: { outcome: FailOutcome | undefined }) {
  if (!outcome) return null;
  const styles: Record<FailOutcome, { cls: string; label: string }> = {
    retest_passed: { cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', label: 'Retested → passed' },
    disposed:      { cls: 'bg-slate-100  text-slate-600  border-slate-200',    label: 'Disposed' },
    open:          { cls: 'bg-orange-100 text-orange-700 border-orange-200',   label: 'Still open' },
  };
  const s = styles[outcome];
  return (
    <span className={cn(
      'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border',
      s.cls,
    )}>
      {s.label}
    </span>
  );
}

function FailDetailPanel({ items, loading, onClose, onOpenHistory }: {
  items: RecentFailItem[];
  loading: boolean;
  onClose: () => void;
  onOpenHistory?: (subLotId: string) => void;
}) {
  // Group by day label, preserving chronological order within each group
  const groups = React.useMemo(() => {
    const map = new Map<string, RecentFailItem[]>();
    for (const item of items) {
      const key = dayLabel(item.submitted_at);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries());
  }, [items]);

  return (
    <div className="mt-3 bg-white border-2 border-red-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-red-50 border-b border-red-200">
        <h3 className="text-sm font-bold text-red-900 flex items-center gap-1.5">
          <XCircle size={14} className="text-red-600" /> Failed inspections (last 2 days)
        </h3>
        <button type="button" onClick={onClose} className="p-1 rounded hover:bg-red-100">
          <X size={14} className="text-red-600" />
        </button>
      </div>

      {loading && (
        <p className="text-xs text-slate-400 p-4 animate-pulse">Loading…</p>
      )}
      {!loading && items.length === 0 && (
        <p className="text-xs text-slate-500 p-4">No failed inspections in the last 2 days.</p>
      )}
      {!loading && groups.map(([day, dayItems]) => (
        <div key={day}>
          <div className="px-4 py-1.5 bg-slate-50 border-b border-slate-100">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{day}</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {dayItems.map(item => (
              <li key={item.inspection_id} className="px-4 py-3">
                {/* Row header: sample ID + Aw + outcome badge + time */}
                <div className="flex items-baseline gap-2 mb-2 flex-wrap">
                  <span className="font-mono font-bold text-sm text-red-700">
                    {item.sample_id ?? item.champion_code}
                  </span>
                  {item.aw != null && (
                    <span className="text-xs text-slate-500">
                      Aw <span className="font-mono font-bold text-slate-800">{item.aw}</span>
                    </span>
                  )}
                  <FailOutcomeBadge outcome={item.outcome} />
                  <span className="text-[11px] text-slate-400 ml-auto">
                    {formatQcDateTime(item.submitted_at)}
                  </span>
                </div>
                {/* Sub-line */}
                <p className="text-[11px] text-slate-500 mb-2">
                  {item.sku_name ?? '—'}
                  {item.work_order_barcode ? ` · ${item.work_order_barcode}` : item.lot_number ? ` · ${item.lot_number}` : ''}
                </p>
                {/* Cart list — one row per cart, clickable to open history */}
                <ul className="mt-1 divide-y divide-slate-100 rounded-lg border border-slate-200 overflow-hidden">
                  {item.group_members.map(m => (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => onOpenHistory?.(m.id)}
                        disabled={!onOpenHistory}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-2 text-left transition-colors',
                          onOpenHistory ? 'hover:bg-slate-50 cursor-pointer' : 'cursor-default',
                          m.is_champion ? 'bg-red-50' : 'bg-white',
                        )}
                      >
                        {/* Champion marker */}
                        {m.is_champion && (
                          <span className="text-[9px] font-bold uppercase tracking-wider text-red-500 shrink-0">
                            Sample
                          </span>
                        )}
                        {/* Cart code */}
                        <span className={cn(
                          'font-mono text-xs font-semibold flex-1 text-left',
                          m.is_champion ? 'text-red-800' : 'text-slate-700',
                        )}>
                          {m.sub_lot_code}
                        </span>
                        {/* Status badge */}
                        {statusBadge(m.status)}
                        {/* Chevron */}
                        {onOpenHistory && (
                          <ChevronRight size={12} className="text-slate-400 shrink-0" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * M-121: tiny chip for a passed inspection's downstream state.
 * Renders nothing for legacy rows that don't carry an outcome (frontend can
 * ship before the M-121 migration is applied).
 */
function PassOutcomeBadge({ outcome }: { outcome: PassOutcome | undefined }) {
  if (!outcome) return null;
  const styles: Record<PassOutcome, { cls: string; label: string }> = {
    released:         { cls: 'bg-slate-100  text-slate-600  border-slate-200',     label: 'Released' },
    awaiting_release: { cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', label: 'Awaiting release' },
  };
  const s = styles[outcome];
  return (
    <span className={cn(
      'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border',
      s.cls,
    )}>
      {s.label}
    </span>
  );
}

/**
 * Mirror of FailDetailPanel for passed inspections — same shape, emerald
 * accent, "Released" / "Awaiting release" badges instead of fail outcomes.
 */
function PassDetailPanel({ items, loading, onClose, onOpenHistory }: {
  items: RecentPassItem[];
  loading: boolean;
  onClose: () => void;
  onOpenHistory?: (subLotId: string) => void;
}) {
  const groups = React.useMemo(() => {
    const map = new Map<string, RecentPassItem[]>();
    for (const item of items) {
      const key = dayLabel(item.submitted_at);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries());
  }, [items]);

  return (
    <div className="mt-3 bg-white border-2 border-emerald-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-emerald-50 border-b border-emerald-200">
        <h3 className="text-sm font-bold text-emerald-900 flex items-center gap-1.5">
          <CheckCircle2 size={14} className="text-emerald-600" /> Passed inspections (last 2 days)
        </h3>
        <button type="button" onClick={onClose} className="p-1 rounded hover:bg-emerald-100">
          <X size={14} className="text-emerald-700" />
        </button>
      </div>

      {loading && (
        <p className="text-xs text-slate-400 p-4 animate-pulse">Loading…</p>
      )}
      {!loading && items.length === 0 && (
        <p className="text-xs text-slate-500 p-4">No passed inspections in the last 2 days.</p>
      )}
      {!loading && groups.map(([day, dayItems]) => (
        <div key={day}>
          <div className="px-4 py-1.5 bg-slate-50 border-b border-slate-100">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{day}</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {dayItems.map(item => (
              <li key={item.inspection_id} className="px-4 py-3">
                <div className="flex items-baseline gap-2 mb-2 flex-wrap">
                  <span className="font-mono font-bold text-sm text-emerald-700">
                    {item.sample_id ?? item.champion_code}
                  </span>
                  {item.aw != null && (
                    <span className="text-xs text-slate-500">
                      Aw <span className="font-mono font-bold text-slate-800">{item.aw}</span>
                    </span>
                  )}
                  <PassOutcomeBadge outcome={item.outcome} />
                  <span className="text-[11px] text-slate-400 ml-auto">
                    {formatQcDateTime(item.submitted_at)}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mb-2">
                  {item.sku_name ?? '—'}
                  {item.work_order_barcode ? ` · ${item.work_order_barcode}` : item.lot_number ? ` · ${item.lot_number}` : ''}
                </p>
                <ul className="mt-1 divide-y divide-slate-100 rounded-lg border border-slate-200 overflow-hidden">
                  {item.group_members.map(m => (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => onOpenHistory?.(m.id)}
                        disabled={!onOpenHistory}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-2 text-left transition-colors',
                          onOpenHistory ? 'hover:bg-slate-50 cursor-pointer' : 'cursor-default',
                          m.is_champion ? 'bg-emerald-50' : 'bg-white',
                        )}
                      >
                        {m.is_champion && (
                          <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-600 shrink-0">
                            Sample
                          </span>
                        )}
                        <span className={cn(
                          'font-mono text-xs font-semibold flex-1 text-left',
                          m.is_champion ? 'text-emerald-800' : 'text-slate-700',
                        )}>
                          {m.sub_lot_code}
                        </span>
                        {statusBadge(m.status)}
                        {onOpenHistory && (
                          <ChevronRight size={12} className="text-slate-400 shrink-0" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ─── Released-inventory row ────────────────────────────────────────────────
// Collapsed: SKU + name + total count. Expanded: bar chart of carts grouped
// by days-since-release. Each bar is clickable and bubbles its bucket up so
// QcHome can show a detail modal.
function InventoryRow({ item, isExpanded, onToggle, onBarClick }: {
  item: PkgInventorySku;
  isExpanded: boolean;
  onToggle: () => void;
  onBarClick: (days: number, carts: PkgCart[]) => void;
}) {
  const [carts, setCarts] = useState<PkgCart[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isExpanded) return;
    if (carts) return;  // cached
    setLoading(true);
    getAvailableCarts(item.sku_id)
      .then(setCarts)
      .catch(() => setCarts([]))
      .finally(() => setLoading(false));
  }, [isExpanded, item.sku_id, carts]);

  // Group carts by integer days-in-stock and sort ascending.
  const buckets = React.useMemo(() => {
    if (!carts) return [] as Array<{ days: number; carts: PkgCart[] }>;
    const map = new Map<number, PkgCart[]>();
    for (const c of carts) {
      const k = c.days_in_stock ?? 0;
      const list = map.get(k);
      if (list) list.push(c);
      else map.set(k, [c]);
    }
    return Array.from(map.entries())
      .map(([days, list]) => ({ days, carts: list }))
      .sort((a, b) => a.days - b.days);
  }, [carts]);

  const maxCount = Math.max(1, ...buckets.map(b => b.carts.length));

  const barColor = (days: number) =>
    days < 10 ? 'bg-emerald-500 hover:bg-emerald-600'
    : days <= 14 ? 'bg-amber-400 hover:bg-amber-500'
    : 'bg-red-500 hover:bg-red-600';

  return (
    <li className="bg-white border-2 border-slate-200 rounded-xl">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-50 rounded-xl"
      >
        {isExpanded
          ? <ChevronDown size={16} className="text-slate-400 shrink-0" />
          : <ChevronRight size={16} className="text-slate-400 shrink-0" />}
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold font-mono">
            {item.sku_code}
          </p>
          <p className="text-sm font-bold text-slate-900 truncate">{item.sku_name}</p>
        </div>
        <p className="text-2xl font-bold tabular-nums text-orange-700 shrink-0">{item.total}</p>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 border-t border-slate-100 pt-3">
          {loading ? (
            <p className="text-xs text-slate-400 italic text-center py-4">Loading carts…</p>
          ) : buckets.length === 0 ? (
            <p className="text-xs text-slate-400 italic text-center py-4">No carts available.</p>
          ) : (
            <>
              <div className="flex items-end gap-2 h-32 px-1">
                {buckets.map(b => {
                  const heightPct = Math.max(8, Math.round((b.carts.length / maxCount) * 100));
                  return (
                    <button
                      key={b.days}
                      type="button"
                      onClick={() => onBarClick(b.days, b.carts)}
                      className="flex-1 h-full flex flex-col items-center gap-1 group min-w-[28px]"
                      title={`${b.carts.length} cart${b.carts.length === 1 ? '' : 's'} at ${b.days} day(s) — click for details`}
                    >
                      <span className="text-[10px] font-bold tabular-nums text-slate-700">
                        {b.carts.length}
                      </span>
                      <div className="w-full flex-1 min-h-0 flex items-end">
                        <div
                          className={cn('w-full rounded-t transition-colors cursor-pointer', barColor(b.days))}
                          style={{ height: `${heightPct}%`, minHeight: '6px' }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-slate-500 group-hover:text-slate-900">
                        {b.days}d
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-slate-400 mt-3 text-center">
                Days since release · click a bar for cart-level detail
              </p>
            </>
          )}
        </div>
      )}
    </li>
  );
}

// ─── Modal: list of carts in a single days-since-release bucket ────────────
function CartBucketModal({ bucket, onClose }: {
  bucket: { sku_code: string; sku_name: string; days: number; carts: PkgCart[] } | null;
  onClose: () => void;
}) {
  if (!bucket) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-label="Close"
      />
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl max-h-[80vh] flex flex-col">
        <header className="px-5 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-orange-100 text-orange-700 flex items-center justify-center shrink-0">
              <Package size={18} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold font-mono">
                {bucket.sku_code} · {bucket.days} day{bucket.days === 1 ? '' : 's'} in stock
              </p>
              <h2 className="text-base font-bold text-slate-900 truncate">{bucket.sku_name}</h2>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 shrink-0" aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="px-5 py-3 overflow-auto">
          <p className="text-xs text-slate-500 mb-2">
            {bucket.carts.length} cart{bucket.carts.length === 1 ? '' : 's'}
          </p>
          <ul className="divide-y divide-slate-100">
            {bucket.carts.map(c => (
              <li key={c.id} className="py-2 flex items-center gap-3 text-xs">
                <span className="font-mono font-bold text-slate-900">{c.sub_lot_code}</span>
                <span className="text-slate-400">·</span>
                <span className="font-mono text-slate-600">{c.work_order_barcode ?? c.lot_number ?? '—'}</span>
                <span className="flex-1" />
                <span className="text-slate-500">released</span>
                <span className="font-mono text-slate-700">{formatQcDateTime(c.released_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

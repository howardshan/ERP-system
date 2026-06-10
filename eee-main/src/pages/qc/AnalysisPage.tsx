import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, ChevronRight, Filter, RefreshCw, X } from 'lucide-react';
import {
  listProducts,
  listProductionLots,
  analysisMetrics,
  analysisRecoveryDetail,
  analysisAvgDryTimeDaily,
  analysisAvgDryTimeByWorkOrder,
  analysisOutcomesDaily,
  analysisOutcomesByWorkOrder,
  AnalysisMetrics,
  RecoveryDetailItem,
  AvgDryTimeDaily,
  AvgDryTimeByWorkOrder,
  OutcomesDaily,
  OutcomesByWorkOrder,
  Product,
  ProductionLot,
} from '../../services/qcApi';
import { fmtDays, cn, dallasToday, dallasDaysAgo, fmtDallasTime } from '../../lib/utils';
import { usePermissions } from '../../contexts/PermissionContext';
import { PermissionDenied } from './components/PermissionDenied';

type OutcomeMetric = 'pass' | 'fail' | 'pass_rate';
type MetricKey = 'avg_dry' | 'pass' | 'fail' | 'pass_rate';

type RangePreset = 'all' | 'day' | 'week' | 'month' | 'custom';
type RecoveryType = 'retest' | 'redry_dryer' | 'room_temp_dry';

interface ActiveFilters {
  sku_id: string | null;
  from_date: string | null;
  to_date: string | null;
  dryer_number: number | null;
  production_lot_id: string | null;
}

// Date helpers scoped to Dallas/Texas time (America/Chicago).
// QC operations run in Dallas; all "today" / "N days ago" comparisons use
// Dallas local midnight, not UTC or the browser machine's local timezone.
function today(): string {
  return dallasToday();
}

function isoDaysAgo(days: number): string {
  return dallasDaysAgo(days);
}

function fmtDateTime(iso: string): string {
  // Display timestamps in Dallas local time (America/Chicago)
  return fmtDallasTime(iso);
}

const PRESETS: Array<{ key: RangePreset; labelKey: string }> = [
  { key: 'month',  labelKey: 'presetMonth' },
  { key: 'week',   labelKey: 'presetWeek' },
  { key: 'day',    labelKey: 'presetDay' },
  { key: 'all',    labelKey: 'presetAll' },
  { key: 'custom', labelKey: 'presetCustom' },
];

const RECOVERY_LABEL_KEYS: Record<RecoveryType, string> = {
  retest:        'recoveryRetest',
  redry_dryer:   'recoveryRedry',
  room_temp_dry: 'recoveryRoomTemp',
};

export default function AnalysisPage() {
  const { t } = useTranslation('qc');
  const { can } = usePermissions();
  // Analysis is also accessible to anyone who can view the dashboard
  // (read-only reporting) — see QualityControlModule's canViewAnalysis.
  const canView = can('qc', 'analysis', 'view') || can('qc', 'dashboard', 'view');

  const [products, setProducts] = useState<Product[]>([]);
  const [lots, setLots] = useState<ProductionLot[]>([]);

  const [skuId, setSkuId] = useState<string>('');
  const [dryer, setDryer] = useState<string>('');
  const [lotId, setLotId] = useState<string>('');
  const [preset, setPreset] = useState<RangePreset>('month');
  const [customFrom, setCustomFrom] = useState<string>(isoDaysAgo(7));
  const [customTo, setCustomTo] = useState<string>(today());

  const [metrics, setMetrics] = useState<AnalysisMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Recovery detail panel state
  const [detailType, setDetailType] = useState<RecoveryType | null>(null);
  const [detailItems, setDetailItems] = useState<RecoveryDetailItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Unified combined-chart state. Any subset of the 4 metrics can be toggled
  // on; when at least one is on, a single chart with 2 y-axes renders all
  // enabled metrics.
  const [enabledMetrics, setEnabledMetrics] = useState<Set<MetricKey>>(new Set());
  const [drySeries, setDrySeries] = useState<AvgDryTimeDaily[]>([]);
  const [drySeriesPrev, setDrySeriesPrev] = useState<AvgDryTimeDaily[]>([]);
  const [outcomesSeries, setOutcomesSeries] = useState<OutcomesDaily[]>([]);
  const [outcomesSeriesPrev, setOutcomesSeriesPrev] = useState<OutcomesDaily[]>([]);
  const [seriesLoading, setSeriesLoading] = useState(false);
  // One combined day-detail panel covering both dry-time and outcomes data for the clicked day.
  const [combinedDayDetail, setCombinedDayDetail] = useState<{
    day: string;
    dryItems: AvgDryTimeByWorkOrder[];
    outcomeItems: OutcomesByWorkOrder[];
  } | null>(null);
  const [combinedDayDetailLoading, setCombinedDayDetailLoading] = useState(false);

  useEffect(() => {
    Promise.all([listProducts(), listProductionLots()])
      .then(([ps, ls]) => { setProducts(ps); setLots(ls); })
      .catch(e => setError(e.message));
  }, []);

  const visibleLots = useMemo(() => {
    if (!skuId) return lots;
    return lots.filter(l => l.sku_id === skuId);
  }, [lots, skuId]);

  useEffect(() => {
    if (!lotId) return;
    if (!visibleLots.find(l => l.id === lotId)) setLotId('');
  }, [skuId, visibleLots, lotId]);

  const rangeBounds = (): { from: string | null; to: string | null } => {
    if (preset === 'all') return { from: null, to: null };
    if (preset === 'custom') return { from: customFrom || null, to: customTo || null };
    const t = today();
    if (preset === 'day') return { from: t, to: t };
    if (preset === 'week') return { from: isoDaysAgo(7), to: t };
    return { from: isoDaysAgo(30), to: t };
  };

  const currentFilters = (): ActiveFilters => {
    const { from, to } = rangeBounds();
    return {
      sku_id: skuId || null,
      from_date: from,
      to_date: to,
      dryer_number: dryer ? Number(dryer) : null,
      production_lot_id: lotId || null,
    };
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const f = currentFilters();
      const result = await analysisMetrics({
        sku_id: f.sku_id,
        from_date: f.from_date,
        to_date: f.to_date,
        dryer_number: f.dryer_number,
        production_lot_id: f.production_lot_id,
      });
      setMetrics(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('analysisPage.loadFailed'));
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [skuId, dryer, lotId, preset, customFrom, customTo]);

  // When filters change while panel is open, re-fetch detail data
  useEffect(() => {
    if (!detailType) return;
    openDetail(detailType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skuId, dryer, lotId, preset, customFrom, customTo]);

  const openDetail = async (type: RecoveryType) => {
    setDetailType(type);
    setDetailLoading(true);
    try {
      const f = currentFilters();
      const items = await analysisRecoveryDetail({
        type,
        sku_id: f.sku_id,
        from_date: f.from_date,
        to_date: f.to_date,
        dryer_number: f.dryer_number,
        production_lot_id: f.production_lot_id,
      });
      setDetailItems(items);
    } catch {
      setDetailItems([]);
    }
    setDetailLoading(false);
  };

  const closeDetail = () => {
    setDetailType(null);
    setDetailItems([]);
  };

  /** Compute the equivalent prior period (same length, shifted back). */
  const priorRange = (from: string | null, to: string | null): { from: string | null; to: string | null } => {
    if (!from || !to) return { from: null, to: null };
    const fromD = new Date(from + 'T00:00:00');
    const toD   = new Date(to   + 'T00:00:00');
    const days  = Math.max(1, Math.round((toD.getTime() - fromD.getTime()) / 86400000) + 1);
    const prevTo   = new Date(fromD); prevTo.setDate(prevTo.getDate() - 1);
    const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - (days - 1));
    return { from: prevFrom.toISOString().slice(0, 10), to: prevTo.toISOString().slice(0, 10) };
  };

  /** Fetch BOTH series (dry-time + outcomes) for current + prior period. */
  const loadSeries = async () => {
    setSeriesLoading(true);
    const f = currentFilters();
    const prevR = priorRange(f.from_date, f.to_date);
    try {
      const [curDry, prevDry, curOut, prevOut] = await Promise.all([
        analysisAvgDryTimeDaily({
          sku_id: f.sku_id, from_date: f.from_date, to_date: f.to_date,
          dryer_number: f.dryer_number, production_lot_id: f.production_lot_id,
        }),
        prevR.from && prevR.to
          ? analysisAvgDryTimeDaily({
              sku_id: f.sku_id, from_date: prevR.from, to_date: prevR.to,
              dryer_number: f.dryer_number, production_lot_id: f.production_lot_id,
            })
          : Promise.resolve([] as AvgDryTimeDaily[]),
        analysisOutcomesDaily({
          sku_id: f.sku_id, from_date: f.from_date, to_date: f.to_date,
          dryer_number: f.dryer_number, production_lot_id: f.production_lot_id,
        }),
        prevR.from && prevR.to
          ? analysisOutcomesDaily({
              sku_id: f.sku_id, from_date: prevR.from, to_date: prevR.to,
              dryer_number: f.dryer_number, production_lot_id: f.production_lot_id,
            })
          : Promise.resolve([] as OutcomesDaily[]),
      ]);
      setDrySeries(curDry); setDrySeriesPrev(prevDry);
      setOutcomesSeries(curOut); setOutcomesSeriesPrev(prevOut);
    } catch {
      setDrySeries([]); setDrySeriesPrev([]);
      setOutcomesSeries([]); setOutcomesSeriesPrev([]);
    }
    setSeriesLoading(false);
  };

  const openCombinedDayDetail = async (day: string) => {
    setCombinedDayDetailLoading(true);
    setCombinedDayDetail({ day, dryItems: [], outcomeItems: [] });
    const f = currentFilters();
    try {
      const [dryItems, outcomeItems] = await Promise.all([
        analysisAvgDryTimeByWorkOrder({
          day, sku_id: f.sku_id, dryer_number: f.dryer_number, production_lot_id: f.production_lot_id,
        }),
        analysisOutcomesByWorkOrder({
          day, sku_id: f.sku_id, dryer_number: f.dryer_number, production_lot_id: f.production_lot_id,
        }),
      ]);
      setCombinedDayDetail({ day, dryItems, outcomeItems });
    } catch {
      setCombinedDayDetail({ day, dryItems: [], outcomeItems: [] });
    }
    setCombinedDayDetailLoading(false);
  };

  const toggleMetric = (metric: MetricKey) => {
    setEnabledMetrics(prev => {
      const next = new Set(prev);
      if (next.has(metric)) next.delete(metric);
      else next.add(metric);
      return next;
    });
  };

  // Fetch series whenever any metric is enabled or filters change
  useEffect(() => {
    if (enabledMetrics.size > 0) {
      loadSeries();
      setCombinedDayDetail(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skuId, dryer, lotId, preset, customFrom, customTo, enabledMetrics.size > 0]);

  const fmtPct = (v: number | null) => v == null ? '—' : `${v.toFixed(1)}%`;
  const fmtMin = (v: number | null) => v == null ? '—' : fmtDays(v);

  if (!canView) {
    return <PermissionDenied permission="qc.analysis.view" feature={t('analysisPage.featureName')} />;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-end justify-between mb-3 flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <BarChart3 size={22} className="text-blue-600" /> {t('analysisPage.title')}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {t('analysisPage.subtitle')}
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded border border-slate-200 hover:border-blue-400 hover:text-blue-700 text-slate-700 disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> {t('analysisPage.refresh')}
        </button>
      </div>

      {error && <p className="text-red-600 bg-red-50 p-2 rounded-lg mb-3 text-sm">{error}</p>}

      {/* Filter bar */}
      <section className="bg-white border rounded-xl p-4 mb-5">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={14} className="text-slate-400" />
          <h2 className="text-xs font-bold text-slate-600 uppercase tracking-widest">{t('analysisPage.filters')}</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="block">
            <span className="text-[11px] font-medium text-slate-600">{t('analysisPage.productSku')}</span>
            <select
              value={skuId}
              onChange={(e) => setSkuId(e.target.value)}
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">{t('analysisPage.allProducts')}</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-slate-600">{t('analysisPage.dryRoom')}</span>
            <select
              value={dryer}
              onChange={(e) => setDryer(e.target.value)}
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">{t('analysisPage.allDryers')}</option>
              {[1, 2, 3, 4, 5].map(d => (
                <option key={d} value={d}>{t('analysisPage.dryer', { n: d })}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-slate-600">{t('analysisPage.workOrder')}</span>
            <select
              value={lotId}
              onChange={(e) => setLotId(e.target.value)}
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">{t('analysisPage.allWorkOrders')}</option>
              {visibleLots.map(l => (
                <option key={l.id} value={l.id}>{l.lot_number}</option>
              ))}
            </select>
          </label>
          <div className="block">
            <span className="text-[11px] font-medium text-slate-600 block mb-1">{t('analysisPage.dateRange')}</span>
            <div className="flex flex-wrap gap-1">
              {PRESETS.map(p => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setPreset(p.key)}
                  className={cn(
                    'px-2 py-1.5 rounded text-[11px] font-bold border transition-colors whitespace-nowrap',
                    preset === p.key
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white border-slate-200 text-slate-700 hover:border-blue-300',
                  )}
                >
                  {t(`analysisPage.${p.labelKey}`)}
                </button>
              ))}
            </div>
            {preset === 'custom' && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <label className="block">
                  <span className="text-[10px] font-medium text-slate-500">{t('analysisPage.from')}</span>
                  <input
                    type="date"
                    value={customFrom}
                    max={customTo || undefined}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="mt-0.5 w-full border rounded-lg px-2 h-9 text-xs"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-medium text-slate-500">{t('analysisPage.to')}</span>
                  <input
                    type="date"
                    value={customTo}
                    min={customFrom || undefined}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="mt-0.5 w-full border rounded-lg px-2 h-9 text-xs"
                  />
                </label>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Metrics */}
      {loading && !metrics ? (
        <p className="text-sm text-slate-400 italic py-10 text-center">{t('analysisPage.loadingMetrics')}</p>
      ) : metrics ? (
        <div className="space-y-5">
          {/* Top-line */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Metric label={t('analysisPage.subLotsInScope')} value={String(metrics.total_sub_lots)} />
            <Metric
              label={t('analysisPage.avgDryTime')}
              value={fmtMin(metrics.avg_dry_minutes)}
              onClick={() => toggleMetric('avg_dry')}
              active={enabledMetrics.has('avg_dry')}
            />
            <FirstTimeTestTile
              total={metrics.first_inspection_count}
              pass={metrics.first_pass_count}
              fail={metrics.first_fail_count}
              passActive={enabledMetrics.has('pass')}
              failActive={enabledMetrics.has('fail')}
              onPassClick={() => toggleMetric('pass')}
              onFailClick={() => toggleMetric('fail')}
            />
            <Metric
              label={t('analysisPage.passRateFirstTry')}
              value={fmtPct(metrics.pass_rate)}
              accent="emerald"
              onClick={() => toggleMetric('pass_rate')}
              active={enabledMetrics.has('pass_rate')}
            />
          </section>

          {/* Single combined chart — visible whenever at least one metric is on */}
          {enabledMetrics.size > 0 && (
            <CombinedMetricsChart
              enabled={enabledMetrics}
              dry={drySeries}
              dryPrev={drySeriesPrev}
              outcomes={outcomesSeries}
              outcomesPrev={outcomesSeriesPrev}
              loading={seriesLoading}
              dayDetail={combinedDayDetail}
              dayDetailLoading={combinedDayDetailLoading}
              onPickDay={openCombinedDayDetail}
              onClose={() => { setEnabledMetrics(new Set()); setCombinedDayDetail(null); }}
              onToggleMetric={toggleMetric}
            />
          )}

          {/* Recovery paths */}
          <section className="bg-white border rounded-xl p-4">
            <h3 className="text-xs font-bold text-slate-600 uppercase tracking-widest mb-3">
              {t('analysisPage.recoveryPaths')}
            </h3>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {(
                [
                  { type: 'retest' as RecoveryType, label: t('analysisPage.recoveryRetest'), count: metrics.retest_count, avgMinutes: null, passRate: metrics.retest_pass_rate, tone: 'blue' as const },
                  { type: 'redry_dryer' as RecoveryType, label: t('analysisPage.recoveryRedry'), count: metrics.redry_count, avgMinutes: metrics.redry_avg_minutes, passRate: metrics.redry_pass_rate, tone: 'amber' as const },
                  { type: 'room_temp_dry' as RecoveryType, label: t('analysisPage.recoveryRoomTemp'), count: metrics.room_temp_count, avgMinutes: metrics.room_temp_avg_minutes, passRate: metrics.room_temp_pass_rate, tone: 'orange' as const },
                ]
              ).map(tile => (
                <RecoveryTile
                  key={tile.type}
                  label={tile.label}
                  count={tile.count}
                  avgMinutes={tile.avgMinutes}
                  passRate={tile.passRate}
                  tone={tile.tone}
                  active={detailType === tile.type}
                  onClick={() => detailType === tile.type ? closeDetail() : openDetail(tile.type)}
                />
              ))}
            </div>

            {/* Detail panel — inline below tiles */}
            {detailType && (
              <RecoveryDetailPanel
                label={t(`analysisPage.${RECOVERY_LABEL_KEYS[detailType]}`)}
                items={detailItems}
                loading={detailLoading}
                onClose={closeDetail}
              />
            )}
          </section>
        </div>
      ) : (
        <p className="text-sm text-slate-500 italic py-6 text-center">{t('analysisPage.noDataAvailable')}</p>
      )}
    </div>
  );
}

function Metric({ label, value, accent = 'slate', onClick, active }: {
  label: string;
  value: string;
  accent?: 'slate' | 'emerald';
  onClick?: () => void;
  active?: boolean;
}) {
  const className = cn(
    'bg-white border rounded-xl p-3 text-left w-full transition-colors',
    onClick && 'cursor-pointer hover:border-blue-300',
    active && 'border-2 border-blue-500 ring-2 ring-blue-200',
  );
  const content = (
    <>
      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{label}</p>
      <p className={cn(
        'text-2xl font-bold tabular-nums mt-1',
        accent === 'emerald' ? 'text-emerald-700' : 'text-slate-900',
      )}>{value}</p>
    </>
  );
  return onClick
    ? <button type="button" onClick={onClick} className={className}>{content}</button>
    : <div className={className}>{content}</div>;
}

function FirstTimeTestTile({
  total, pass, fail, passActive, failActive, onPassClick, onFailClick,
}: {
  total: number; pass: number; fail: number;
  passActive?: boolean; failActive?: boolean;
  onPassClick?: () => void; onFailClick?: () => void;
}) {
  const { t } = useTranslation('qc');
  return (
    <div className="bg-white border rounded-xl p-3">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
          {t('analysisPage.firstTimeTest')}
        </p>
        <p className="text-[11px] font-bold text-slate-400 tabular-nums">{t('analysisPage.total', { count: total })}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onPassClick}
          disabled={!onPassClick}
          className={cn(
            'rounded-lg bg-emerald-50 border border-emerald-200 py-2 text-center transition-colors',
            onPassClick && 'cursor-pointer hover:bg-emerald-100',
            passActive && 'border-2 border-emerald-600 ring-2 ring-emerald-200',
          )}
        >
          <p className="text-[10px] uppercase tracking-wider font-bold text-emerald-700">{t('analysisPage.pass')}</p>
          <p className="text-2xl font-bold tabular-nums text-emerald-800 leading-none mt-1">{pass}</p>
        </button>
        <button
          type="button"
          onClick={onFailClick}
          disabled={!onFailClick}
          className={cn(
            'rounded-lg bg-red-50 border border-red-200 py-2 text-center transition-colors',
            onFailClick && 'cursor-pointer hover:bg-red-100',
            failActive && 'border-2 border-red-600 ring-2 ring-red-200',
          )}
        >
          <p className="text-[10px] uppercase tracking-wider font-bold text-red-700">{t('analysisPage.fail')}</p>
          <p className="text-2xl font-bold tabular-nums text-red-800 leading-none mt-1">{fail}</p>
        </button>
      </div>
    </div>
  );
}

function RecoveryTile({
  label, count, avgMinutes, passRate, tone, active, onClick,
}: {
  label: string;
  count: number;
  avgMinutes: number | null;
  passRate: number | null;
  tone: 'blue' | 'amber' | 'orange';
  active: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation('qc');
  const borderTone = tone === 'blue'
    ? active ? 'border-blue-500' : 'border-blue-200'
    : tone === 'amber'
    ? active ? 'border-amber-500' : 'border-amber-200'
    : active ? 'border-orange-500' : 'border-orange-200';
  const bgTone = tone === 'blue'
    ? active ? 'bg-blue-50' : 'bg-blue-50/50'
    : tone === 'amber'
    ? active ? 'bg-amber-50' : 'bg-amber-50/50'
    : active ? 'bg-orange-50' : 'bg-orange-50/50';
  const textTone = tone === 'blue' ? 'text-blue-700' : tone === 'amber' ? 'text-amber-700' : 'text-orange-700';
  const chevronTone = tone === 'blue' ? 'text-blue-400' : tone === 'amber' ? 'text-amber-400' : 'text-orange-400';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={count === 0}
      className={cn(
        'border-2 rounded-lg p-3 text-left w-full transition-all group',
        borderTone, bgTone,
        count > 0 ? 'cursor-pointer hover:shadow-sm' : 'cursor-default opacity-80',
      )}
    >
      <div className="flex items-center justify-between">
        <p className={cn('text-[10px] uppercase tracking-wider font-bold', textTone)}>{label}</p>
        {count > 0 && (
          <ChevronRight
            size={14}
            className={cn(
              chevronTone,
              'transition-transform',
              active ? 'rotate-90' : 'group-hover:translate-x-0.5',
            )}
          />
        )}
      </div>
      <p className="text-2xl font-bold tabular-nums text-slate-900 mt-1">{count}</p>
      <dl className="mt-2 text-[11px] grid grid-cols-2 gap-1">
        <dt className="text-slate-500">{t('analysisPage.avgDwell')}</dt>
        <dd className="font-mono text-slate-800 text-right">{avgMinutes != null ? fmtDays(avgMinutes) : '—'}</dd>
        <dt className="text-slate-500">{t('analysisPage.passRate')}</dt>
        <dd className="font-mono text-slate-800 text-right">{passRate != null ? `${passRate.toFixed(1)}%` : '—'}</dd>
      </dl>
      {count > 0 && (
        <p className={cn('text-[10px] mt-2 font-medium', textTone)}>
          {active ? t('analysisPage.clickToCollapse') : t('analysisPage.clickToSeeDetails')}
        </p>
      )}
    </button>
  );
}

function RecoveryDetailPanel({
  label, items, loading, onClose,
}: {
  label: string;
  items: RecoveryDetailItem[];
  loading: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation('qc');
  return (
    <div className="mt-4 border rounded-xl overflow-hidden bg-white animate-in slide-in-from-top-2 duration-150">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b">
        <div>
          <h4 className="text-sm font-bold text-slate-900">{t('analysisPage.detailTitle', { label })}</h4>
          {!loading && (
            <p className="text-[11px] text-slate-500 mt-0.5">{t('analysisPage.recordCount', { count: items.length })}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded hover:bg-slate-200 text-slate-500"
        >
          <X size={14} />
        </button>
      </div>

      {loading ? (
        <div className="p-6 text-center text-sm text-slate-400 animate-pulse">{t('analysisPage.loading')}</div>
      ) : items.length === 0 ? (
        <div className="p-6 text-center text-sm text-slate-400">{t('analysisPage.noRecordsFound')}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50">
                <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider font-bold text-slate-500">{t('analysisPage.colCart')}</th>
                <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider font-bold text-slate-500">{t('analysisPage.colSku')}</th>
                <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider font-bold text-slate-500">{t('analysisPage.colWorkOrder')}</th>
                <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider font-bold text-slate-500">{t('analysisPage.colSentForRecovery')}</th>
                <th className="px-4 py-2 text-right text-[10px] uppercase tracking-wider font-bold text-slate-500">{t('analysisPage.colDwell')}</th>
                <th className="px-4 py-2 text-center text-[10px] uppercase tracking-wider font-bold text-slate-500">{t('analysisPage.colRetestResult')}</th>
                <th className="px-4 py-2 text-right text-[10px] uppercase tracking-wider font-bold text-slate-500">{t('analysisPage.colAw')}</th>
                <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider font-bold text-slate-500">{t('analysisPage.colRemark')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map(item => (
                <tr key={item.disposition_id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <span className="font-mono font-bold text-slate-800 text-xs">{item.sub_lot_code}</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-700 max-w-[140px] truncate">
                    {item.sku_name ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-xs font-mono text-slate-600">
                    {item.work_order_barcode ?? item.lot_number ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                    {fmtDateTime(item.disposition_at)}
                  </td>
                  <td className="px-4 py-2.5 text-xs font-mono text-slate-700 text-right whitespace-nowrap">
                    {item.dwell_minutes != null ? fmtDays(item.dwell_minutes) : <span className="text-slate-400">{t('analysisPage.inProgress')}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {item.next_result == null ? (
                      <span className="text-[10px] text-slate-400">{t('analysisPage.pending')}</span>
                    ) : item.next_result === 'pass' ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                        {t('analysisPage.passBadge')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800 border border-red-300">
                        {t('analysisPage.failBadge')}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs font-mono text-right text-slate-700">
                    {item.next_aw != null ? item.next_aw.toFixed(3) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500 max-w-[160px] truncate">
                    {item.remark ?? <span className="text-slate-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


// ─── Combined metrics chart (2 y-axes, multi-line, toggleable) ─────────────
// Left  Y-axis : avg dry time (days)            — blue line
// Right Y-axis : counts + pass-rate %           — emerald (pass), red (fail), indigo (pass_rate)

const METRIC_META: Record<MetricKey, {
  label: string;
  shortLabel: string;
  axis: 'left' | 'right';
  color: string;     // hex / tailwind class for inline styles
  stroke: string;    // tailwind stroke class
  fill: string;      // tailwind fill class
  textBg: string;    // tile bg
  textColor: string; // tile text
}> = {
  avg_dry:   { label: 'Avg dry time', shortLabel: 'Dry time', axis: 'left',  color: '#2563eb', stroke: 'stroke-blue-500',    fill: 'fill-blue-500',    textBg: 'bg-blue-50 border-blue-300',         textColor: 'text-blue-800' },
  pass:      { label: 'Pass count',   shortLabel: 'Pass',     axis: 'right', color: '#059669', stroke: 'stroke-emerald-500', fill: 'fill-emerald-500', textBg: 'bg-emerald-50 border-emerald-300',   textColor: 'text-emerald-800' },
  fail:      { label: 'Fail count',   shortLabel: 'Fail',     axis: 'right', color: '#dc2626', stroke: 'stroke-red-500',     fill: 'fill-red-500',     textBg: 'bg-red-50 border-red-300',           textColor: 'text-red-800' },
  pass_rate: { label: 'Pass rate',    shortLabel: 'Pass rate',axis: 'right', color: '#6366f1', stroke: 'stroke-indigo-500',  fill: 'fill-indigo-500',  textBg: 'bg-indigo-50 border-indigo-300',     textColor: 'text-indigo-800' },
};

interface UnifiedPoint {
  date: string;
  values: Partial<Record<MetricKey, number>>;     // raw numeric value per metric
  labels: Partial<Record<MetricKey, string>>;     // display label override (e.g. "1/4")
}

function CombinedMetricsChart({
  enabled, dry, dryPrev, outcomes, outcomesPrev,
  loading, dayDetail, dayDetailLoading,
  onPickDay, onClose, onToggleMetric,
}: {
  enabled: Set<MetricKey>;
  dry: AvgDryTimeDaily[];
  dryPrev: AvgDryTimeDaily[];
  outcomes: OutcomesDaily[];
  outcomesPrev: OutcomesDaily[];
  loading: boolean;
  dayDetail: { day: string; dryItems: AvgDryTimeByWorkOrder[]; outcomeItems: OutcomesByWorkOrder[] } | null;
  dayDetailLoading: boolean;
  onPickDay: (day: string) => void;
  onClose: () => void;
  onToggleMetric: (m: MetricKey) => void;
}) {
  // ── Build unified per-day rows from both series ───────────────────────
  const build = (dryRows: AvgDryTimeDaily[], outRows: OutcomesDaily[]): UnifiedPoint[] => {
    const byDate = new Map<string, UnifiedPoint>();
    const ensure = (d: string) => {
      if (!byDate.has(d)) byDate.set(d, { date: d, values: {}, labels: {} });
      return byDate.get(d)!;
    };
    for (const r of dryRows) {
      const p = ensure(r.date);
      if (r.avg_dry_minutes != null) {
        p.values.avg_dry = r.avg_dry_minutes / 1440;  // express as days
        p.labels.avg_dry = fmtDays(r.avg_dry_minutes);
      }
    }
    for (const r of outRows) {
      const p = ensure(r.date);
      p.values.pass = r.pass_count;
      p.values.fail = r.fail_count;
      p.labels.pass = String(r.pass_count);
      p.labels.fail = String(r.fail_count);
      if (r.pass_rate != null) {
        p.values.pass_rate = r.pass_rate;
        p.labels.pass_rate = `${r.pass_count}/${r.sub_lot_count}`;
      }
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  };

  const current  = build(dry, outcomes);
  const previous = build(dryPrev, outcomesPrev);

  // ── Compute axis maxima from enabled metrics only ─────────────────────
  const valuesOnAxis = (rows: UnifiedPoint[], axis: 'left' | 'right'): number[] =>
    rows.flatMap(r =>
      Object.entries(r.values).flatMap(([k, v]) =>
        v != null && enabled.has(k as MetricKey) && METRIC_META[k as MetricKey].axis === axis ? [v] : []
      )
    );
  const allLeftVals  = [...valuesOnAxis(current, 'left'),  ...valuesOnAxis(previous, 'left')];
  const allRightVals = [...valuesOnAxis(current, 'right'), ...valuesOnAxis(previous, 'right')];
  const maxLeft  = Math.max(1, ...allLeftVals)  * 1.15;
  const maxRight = Math.max(1, ...allRightVals) * 1.15;

  // ── SVG geometry ─────────────────────────────────────────────────────
  const n = Math.max(current.length, previous.length, 1);
  const W = 300, H = 100;
  const PAD = { l: 30, r: 30, t: 14, b: 22 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const xAt = (i: number) => PAD.l + (n <= 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const yAt = (v: number, axis: 'left' | 'right') => {
    const max = axis === 'left' ? maxLeft : maxRight;
    return PAD.t + innerH - (innerH * v) / max;
  };

  const polyline = (pts: UnifiedPoint[], metric: MetricKey) => pts
    .map((p, i) => {
      const v = p.values[metric];
      if (v == null) return null;
      return `${xAt(i)},${yAt(v, METRIC_META[metric].axis)}`;
    })
    .filter(Boolean)
    .join(' ');

  const fmtLeftAxisValue  = (v: number) => fmtDays(v * 1440);
  const fmtRightAxisValue = (v: number) => Number.isInteger(v) ? String(v) : v.toFixed(0);

  // ── Combined day detail: merge dry + outcomes by production_lot_id ────
  type Row = {
    production_lot_id: string;
    lot_number: string;
    sku_name: string;
    sub_lot_count: number;
    min_dry_minutes?: number;
    max_dry_minutes?: number;
    avg_dry_minutes?: number;
    median_dry_minutes?: number;
    pass_count?: number;
    fail_count?: number;
    pass_rate?: number | null;
  };
  const mergedDetail = (): Row[] => {
    if (!dayDetail) return [];
    const m = new Map<string, Row>();
    for (const it of dayDetail.dryItems) {
      m.set(it.production_lot_id, {
        production_lot_id: it.production_lot_id,
        lot_number: it.lot_number,
        sku_name: it.sku_name,
        sub_lot_count: it.sub_lot_count,
        min_dry_minutes: it.min_dry_minutes,
        max_dry_minutes: it.max_dry_minutes,
        avg_dry_minutes: it.avg_dry_minutes,
        median_dry_minutes: it.median_dry_minutes,
      });
    }
    for (const it of dayDetail.outcomeItems) {
      const existing = m.get(it.production_lot_id);
      if (existing) {
        existing.pass_count = it.pass_count;
        existing.fail_count = it.fail_count;
        existing.pass_rate = it.pass_rate;
      } else {
        m.set(it.production_lot_id, {
          production_lot_id: it.production_lot_id,
          lot_number: it.lot_number,
          sku_name: it.sku_name,
          sub_lot_count: it.sub_lot_count,
          pass_count: it.pass_count,
          fail_count: it.fail_count,
          pass_rate: it.pass_rate,
        });
      }
    }
    return Array.from(m.values()).sort((a, b) => a.lot_number.localeCompare(b.lot_number));
  };
  const detailRows = mergedDetail();

  const allMetrics: MetricKey[] = ['avg_dry', 'pass', 'fail', 'pass_rate'];

  return (
    <section className="bg-white border-2 border-blue-300 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-3 gap-2 flex-wrap">
        <h3 className="text-sm font-bold text-slate-900">Daily trend</h3>
        <div className="flex items-center gap-1.5 flex-wrap">
          {allMetrics.map(m => {
            const on = enabled.has(m);
            const meta = METRIC_META[m];
            return (
              <button
                key={m}
                type="button"
                onClick={() => onToggleMetric(m)}
                className={cn(
                  'px-2 py-1 rounded text-[10px] font-bold border transition-colors flex items-center gap-1',
                  on
                    ? `${meta.textBg} ${meta.textColor} border-current`
                    : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300',
                )}
              >
                <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: on ? meta.color : '#cbd5e1' }} />
                {meta.shortLabel}
              </button>
            );
          })}
          <button
            type="button"
            onClick={onClose}
            className="ml-2 text-[10px] uppercase tracking-widest font-bold text-slate-400 hover:text-slate-700"
          >
            Close ×
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 italic text-center py-10">Loading…</p>
      ) : current.length === 0 ? (
        <p className="text-sm text-slate-400 italic text-center py-10">No data in range.</p>
      ) : (
        <>
          <div className="relative w-full">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-64 block" preserveAspectRatio="xMidYMid meet">
              {/* Gridlines + dual axis tick labels */}
              {[0, 0.5, 1].map(frac => {
                const y = PAD.t + innerH - innerH * frac;
                const showLeft  = allLeftVals.length > 0;
                const showRight = allRightVals.length > 0;
                return (
                  <g key={frac}>
                    <line x1={PAD.l} y1={y} x2={W - PAD.r} y2={y}
                          className="stroke-slate-200" strokeWidth={0.4}
                          strokeDasharray={frac === 0 ? undefined : '2 2'} />
                    {showLeft && (
                      <text x={PAD.l - 3} y={y + 1.3} textAnchor="end" fontSize="3.2"
                            className="fill-blue-600 font-mono">
                        {fmtLeftAxisValue((maxLeft / 1.15) * frac)}
                      </text>
                    )}
                    {showRight && (
                      <text x={W - PAD.r + 3} y={y + 1.3} textAnchor="start" fontSize="3.2"
                            className="fill-slate-500 font-mono">
                        {fmtRightAxisValue((maxRight / 1.15) * frac)}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Axis title hints */}
              {allLeftVals.length > 0 && (
                <text x={PAD.l - 3} y={PAD.t - 4} textAnchor="end" fontSize="3"
                      className="fill-blue-500 font-mono">days</text>
              )}
              {allRightVals.length > 0 && (
                <text x={W - PAD.r + 3} y={PAD.t - 4} textAnchor="start" fontSize="3"
                      className="fill-slate-400 font-mono">carts / %</text>
              )}

              {/* Previous period lines (dashed) for each enabled metric */}
              {allMetrics.filter(m => enabled.has(m)).map(m => previous.length > 0 && (
                <polyline
                  key={`prev-${m}`}
                  points={polyline(previous, m)}
                  className={cn(METRIC_META[m].stroke, 'fill-none opacity-40')}
                  strokeWidth={0.6}
                  strokeDasharray="2 1.5"
                />
              ))}

              {/* Current period lines */}
              {allMetrics.filter(m => enabled.has(m)).map(m => (
                <polyline
                  key={`cur-${m}`}
                  points={polyline(current, m)}
                  className={cn(METRIC_META[m].stroke, 'fill-none')}
                  strokeWidth={1.2}
                />
              ))}

              {/* Current period points + value labels per metric */}
              {allMetrics.filter(m => enabled.has(m)).map(m => current.map((p, i) => {
                const v = p.values[m];
                if (v == null) return null;
                const y = yAt(v, METRIC_META[m].axis);
                const selected = dayDetail?.day === p.date;
                return (
                  <g key={`pt-${m}-${p.date}`}>
                    <text x={xAt(i)} y={y - 2.5} textAnchor="middle" fontSize="3"
                          className={cn(METRIC_META[m].fill.replace('fill-', 'fill-'), 'font-bold')}
                          style={{ fill: METRIC_META[m].color }}>
                      {p.labels[m] ?? String(v)}
                    </text>
                    <circle
                      cx={xAt(i)} cy={y}
                      r={selected ? 2.2 : 1.6}
                      className={cn(METRIC_META[m].fill, 'cursor-pointer hover:opacity-80', selected && 'stroke-white')}
                      strokeWidth={selected ? 0.7 : 0}
                      onClick={() => onPickDay(p.date)}
                    >
                      <title>{p.date} · {METRIC_META[m].shortLabel}: {p.labels[m] ?? String(v)}</title>
                    </circle>
                  </g>
                );
              }))}

              {/* X-axis date labels */}
              {current.map((p, i) => {
                const showAlways = i === 0 || i === current.length - 1;
                const showMid = current.length > 4 && i === Math.floor(current.length / 2);
                if (!(showAlways || showMid)) return null;
                return (
                  <text key={`x-${p.date}`} x={xAt(i)} y={H - 6} textAnchor="middle"
                        className="fill-slate-500 font-mono" fontSize="3">
                    {p.date.slice(5)}
                  </text>
                );
              })}
            </svg>
          </div>

          <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-500 flex-wrap">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-0.5 bg-slate-400" /> Current
            </span>
            {previous.length > 0 && (
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 border-t border-dashed border-slate-400" /> Previous period
              </span>
            )}
            <span className="ml-auto">Click any point for per-work-order breakdown</span>
          </div>
        </>
      )}

      {dayDetail && (
        <div className="mt-4 border-t pt-3">
          <p className="text-xs font-bold text-slate-700 mb-2">
            Per work order — {dayDetail.day}
          </p>
          {dayDetailLoading ? (
            <p className="text-xs text-slate-400 italic">Loading…</p>
          ) : detailRows.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No work orders.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-slate-500 font-bold border-b border-slate-200">
                    <th className="text-left py-1.5 pr-3">Work order</th>
                    <th className="text-left py-1.5 pr-3">SKU</th>
                    <th className="text-right py-1.5 pr-3">Carts</th>
                    <th className="text-right py-1.5 pr-3 text-blue-700">Min</th>
                    <th className="text-right py-1.5 pr-3 text-blue-700">Avg</th>
                    <th className="text-right py-1.5 pr-3 text-blue-700">Median</th>
                    <th className="text-right py-1.5 pr-3 text-blue-700">Max</th>
                    <th className="text-right py-1.5 pr-3 text-emerald-700">Pass</th>
                    <th className="text-right py-1.5 pr-3 text-red-700">Fail</th>
                    <th className="text-right py-1.5 text-indigo-700">Pass rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {detailRows.map(r => (
                    <tr key={r.production_lot_id}>
                      <td className="py-1.5 pr-3 font-mono font-bold text-slate-800">{r.lot_number}</td>
                      <td className="py-1.5 pr-3 text-slate-500">{r.sku_name}</td>
                      <td className="py-1.5 pr-3 text-right text-slate-500 tabular-nums">{r.sub_lot_count}</td>
                      <td className="py-1.5 pr-3 text-right font-mono text-slate-700 tabular-nums">{r.min_dry_minutes != null ? fmtDays(r.min_dry_minutes) : '—'}</td>
                      <td className="py-1.5 pr-3 text-right font-mono font-bold text-blue-700 tabular-nums">{r.avg_dry_minutes != null ? fmtDays(r.avg_dry_minutes) : '—'}</td>
                      <td className="py-1.5 pr-3 text-right font-mono text-slate-700 tabular-nums">{r.median_dry_minutes != null ? fmtDays(r.median_dry_minutes) : '—'}</td>
                      <td className="py-1.5 pr-3 text-right font-mono text-slate-700 tabular-nums">{r.max_dry_minutes != null ? fmtDays(r.max_dry_minutes) : '—'}</td>
                      <td className="py-1.5 pr-3 text-right font-mono font-bold text-emerald-700 tabular-nums">{r.pass_count ?? '—'}</td>
                      <td className="py-1.5 pr-3 text-right font-mono font-bold text-red-700 tabular-nums">{r.fail_count ?? '—'}</td>
                      <td className="py-1.5 text-right font-mono font-bold text-indigo-700 tabular-nums">
                        {r.pass_count != null && r.fail_count != null
                          ? `${r.pass_count}/${(r.pass_count + r.fail_count) || r.sub_lot_count}`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

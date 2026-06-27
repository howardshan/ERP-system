import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RefreshCw, ChevronRight, ChevronDown,
  Flame, FlaskConical, TestTube, CheckCircle2, RotateCcw, Send, Truck,
} from 'lucide-react';
import {
  dashboardWorkOrderPipeline, ProductPipelineGroup, WorkOrderPipelineRow, WorkOrderPipelineTotals,
} from '../../services/qcApi';
import { cn } from '../../lib/utils';

/**
 * Dashboard → Work-order pipeline.  Per-product (SKU) groups that expand to one
 * row per work order, with a column for every stage a cart passes through.
 * Data: qc_dashboard_work_order_pipeline() (M-157).
 *
 * Stage → status mapping (see migration header). Carts in status='created'
 * (not yet in a dryer) are intentionally NOT shown.
 *   Dry Room         — drying / room_temp_drying / awaiting_recheck
 *   Waiting Sampling — pending, not yet sampled
 *   Sampled          — pending+sample / inspecting / awaiting_group_result
 *   Passed           — passed   (= waiting release; same carts)
 *   Retest           — hold / disposing
 *   Released         — closed   (released, waiting packing)
 *   Dispatched       — dispatched
 */

type StageKey = keyof WorkOrderPipelineTotals;

const STAGES: { key: Exclude<StageKey, 'total'>; icon: React.ElementType; color: BucketColor }[] = [
  { key: 'dry_room',     icon: Flame,         color: 'amber' },
  { key: 'waiting_test', icon: FlaskConical,  color: 'sky' },
  { key: 'sampled',      icon: TestTube,      color: 'indigo' },
  { key: 'passed',       icon: CheckCircle2,  color: 'emerald' },
  { key: 'retest',       icon: RotateCcw,     color: 'rose' },
  { key: 'released',     icon: Send,          color: 'teal' },
  { key: 'dispatched',   icon: Truck,         color: 'orange' },
];

export default function WorkOrderPipelinePage() {
  const { t } = useTranslation('dashboard');
  const [groups, setGroups] = useState<ProductPipelineGroup[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setRefreshing(true);
    try {
      setGroups(await dashboardWorkOrderPipeline());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('pipeline.loadFailed'));
    }
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (skuId: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(skuId) ? next.delete(skuId) : next.add(skuId);
      return next;
    });

  const grandTotals = useMemo<WorkOrderPipelineTotals>(() => {
    const acc: WorkOrderPipelineTotals = {
      dry_room: 0, waiting_test: 0, sampled: 0,
      passed: 0, retest: 0, released: 0, dispatched: 0, total: 0,
    };
    for (const g of groups) {
      acc.dry_room += g.totals.dry_room;
      acc.waiting_test += g.totals.waiting_test;
      acc.sampled += g.totals.sampled;
      acc.passed += g.totals.passed;
      acc.retest += g.totals.retest;
      acc.released += g.totals.released;
      acc.dispatched += g.totals.dispatched;
      acc.total += g.totals.total;
    }
    return acc;
  }, [groups]);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between mb-1">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('pipeline.title')}</h1>
          <p className="text-xs text-slate-500 mt-0.5">{t('pipeline.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={refreshing}
          className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded border border-slate-200 hover:border-indigo-400 hover:text-indigo-700 text-slate-700 disabled:opacity-50"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          {t('pipeline.refresh')}
        </button>
      </div>

      {error && <p className="text-red-600 bg-red-50 p-2 rounded-lg mt-3 text-sm">{error}</p>}

      {loading ? (
        <p className="text-slate-400 text-sm mt-6">{t('pipeline.loading')}</p>
      ) : groups.length === 0 ? (
        <div className="bg-white border rounded-xl p-8 text-center text-sm text-slate-500 mt-6">
          {t('pipeline.empty')}
        </div>
      ) : (
        <div className="mt-5 bg-white border-2 border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[1000px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase tracking-wider font-bold text-slate-500">
                <th className="px-4 py-2.5 text-left">{t('pipeline.product')}</th>
                {STAGES.map(s => (
                  <ColHeader key={s.key} icon={s.icon} label={t(`stage.${s.key}`)} />
                ))}
                <th className="px-4 py-2.5 text-right">{t('pipeline.total')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {groups.map(g => {
                const isOpen = expanded.has(g.sku_id);
                return (
                  <React.Fragment key={g.sku_id}>
                    <tr
                      className="hover:bg-slate-50 cursor-pointer"
                      onClick={() => toggle(g.sku_id)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {isOpen
                            ? <ChevronDown size={14} className="text-slate-400 shrink-0" />
                            : <ChevronRight size={14} className="text-slate-400 shrink-0" />}
                          <span className="font-mono text-[10px] text-slate-400 uppercase tracking-wider">{g.sku_code}</span>
                          <span className="font-bold text-slate-900">{g.sku_name}</span>
                          <span className="text-[10px] text-slate-400">
                            ({g.work_orders.length} {t('pipeline.workOrdersShort')})
                          </span>
                        </div>
                      </td>
                      {STAGES.map(s => (
                        <BucketCell key={s.key} value={g.totals[s.key]} color={s.color} bold />
                      ))}
                      <td className="px-4 py-3 text-right font-bold text-slate-900 tabular-nums">{g.totals.total}</td>
                    </tr>
                    {isOpen && g.work_orders.map((wo: WorkOrderPipelineRow) => (
                      <tr key={g.sku_id + wo.work_order_no} className="bg-slate-50/40 hover:bg-slate-100/60">
                        <td className="px-4 py-2 pl-11">
                          <span className="font-mono text-xs text-slate-600">{wo.work_order_no}</span>
                        </td>
                        {STAGES.map(s => (
                          <BucketCell key={s.key} value={wo[s.key]} color={s.color} />
                        ))}
                        <td className="px-4 py-2 text-right font-semibold text-slate-700 tabular-nums">{wo.total}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
              <tr className="bg-slate-50 font-bold text-slate-700 border-t-2 border-slate-200">
                <td className="px-4 py-2.5 text-right">{t('pipeline.total')}</td>
                {STAGES.map(s => (
                  <td key={s.key} className="px-4 py-2.5 text-right tabular-nums">{grandTotals[s.key]}</td>
                ))}
                <td className="px-4 py-2.5 text-right tabular-nums">{grandTotals.total}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[10px] text-slate-400 mt-3 leading-relaxed">
        {t('pipeline.passedNote')}
      </p>
    </div>
  );
}

function ColHeader({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <th className="px-4 py-2.5 text-right">
      <div className="inline-flex items-center gap-1 text-slate-500 whitespace-nowrap">
        <Icon size={11} /> {label}
      </div>
    </th>
  );
}

type BucketColor = 'slate' | 'amber' | 'sky' | 'indigo' | 'emerald' | 'rose' | 'teal' | 'orange';

function BucketCell({ value, color, bold }: { value: number; color: BucketColor; bold?: boolean }) {
  const palette: Record<BucketColor, string> = {
    slate:   'text-slate-500',
    amber:   'text-amber-700',
    sky:     'text-sky-700',
    indigo:  'text-indigo-700',
    emerald: 'text-emerald-700',
    rose:    'text-rose-700',
    teal:    'text-teal-700',
    orange:  'text-orange-700',
  };
  return (
    <td className={cn('px-4 text-right', bold ? 'py-3' : 'py-2')}>
      <span className={cn(
        'tabular-nums',
        bold ? 'font-bold' : 'font-semibold',
        value === 0 ? 'text-slate-300' : palette[color],
      )}>
        {value}
      </span>
    </td>
  );
}

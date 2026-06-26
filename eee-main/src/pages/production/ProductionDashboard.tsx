import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Factory, Flame, FlaskConical, CheckCircle2, Package } from 'lucide-react';
import { productionPipelineSummary, ProductionPipelineItem } from '../../services/qcApi';
import { cn } from '../../lib/utils';

/**
 * Production Dashboard — per-SKU view of where carts currently sit in the
 * production → packaging pipeline.  Data comes from
 * qc_production_pipeline_summary() (M-093).
 *
 * Columns (one per pipeline stage):
 *   Production        — status='created'
 *   Dry Room          — drying + awaiting_recheck + room_temp_drying
 *   Testing / waiting — pending + inspecting + awaiting_group_result + hold + passed
 *   Released          — status='closed' (released, not yet dispatched)
 *   Packaged          — status='dispatched'
 */
export default function ProductionDashboard() {
  const { t } = useTranslation('production');
  const [rows, setRows] = useState<ProductionPipelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setRefreshing(true);
    try {
      setRows(await productionPipelineSummary());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('productionDashboard.loadFailed'));
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

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-end justify-between mb-1">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('productionDashboard.title')}</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {t('productionDashboard.subtitle')}
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={refreshing}
          className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded border border-slate-200 hover:border-blue-400 hover:text-blue-700 text-slate-700 disabled:opacity-50"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          {t('productionDashboard.refresh')}
        </button>
      </div>

      {error && <p className="text-red-600 bg-red-50 p-2 rounded-lg mt-3 text-sm">{error}</p>}

      {loading ? (
        <p className="text-slate-400 text-sm mt-6">{t('productionDashboard.loading')}</p>
      ) : rows.length === 0 ? (
        <div className="bg-white border rounded-xl p-8 text-center text-sm text-slate-500 mt-6">
          {t('productionDashboard.empty')}
        </div>
      ) : (
        <div className="mt-5 bg-white border-2 border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase tracking-wider font-bold text-slate-500">
                <th className="px-4 py-2.5 text-left">{t('productionDashboard.sku')}</th>
                <ColHeader icon={Factory}      label={t('productionDashboard.colProduction')} />
                <ColHeader icon={Flame}        label={t('productionDashboard.colDryRoom')} />
                <ColHeader icon={FlaskConical} label={t('productionDashboard.colTesting')} />
                <ColHeader icon={CheckCircle2} label={t('productionDashboard.colReleased')} />
                <ColHeader icon={Package}      label={t('productionDashboard.colPackaged')} />
                <th className="px-4 py-2.5 text-right">{t('productionDashboard.total')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => (
                <tr key={r.sku_id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[10px] text-slate-400 uppercase tracking-wider">{r.sku_code}</span>
                      <span className="font-bold text-slate-900">{r.sku_name}</span>
                    </div>
                  </td>
                  <BucketCell value={r.production_count} color="slate" />
                  <BucketCell value={r.dry_room_count}   color="amber" />
                  <BucketCell value={r.testing_count}    color="blue" />
                  <BucketCell value={r.released_count}   color="emerald" />
                  <BucketCell value={r.packaged_count}   color="orange" />
                  <td className="px-4 py-3 text-right font-bold text-slate-900 tabular-nums">
                    {r.total}
                  </td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-bold text-slate-700">
                <td className="px-4 py-2.5 text-right">{t('productionDashboard.total')}</td>
                <SumCell rows={rows} field="production_count" />
                <SumCell rows={rows} field="dry_room_count" />
                <SumCell rows={rows} field="testing_count" />
                <SumCell rows={rows} field="released_count" />
                <SumCell rows={rows} field="packaged_count" />
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {rows.reduce((s, r) => s + r.total, 0)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[10px] text-slate-400 mt-3">
        {t('productionDashboard.statusMapping')} &mdash; {t('productionDashboard.colProduction')}: <code className="font-mono">created</code> &middot;
        {t('productionDashboard.colDryRoom')}: <code className="font-mono">drying / awaiting_recheck / room_temp_drying</code> &middot;
        {t('productionDashboard.colTesting')}: <code className="font-mono">pending / inspecting / awaiting_group_result / hold / passed</code> &middot;
        {t('productionDashboard.colReleased')}: <code className="font-mono">closed</code> &middot;
        {t('productionDashboard.colPackaged')}: <code className="font-mono">dispatched</code>
      </p>
    </div>
  );
}

function ColHeader({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <th className="px-4 py-2.5 text-right">
      <div className="inline-flex items-center gap-1 text-slate-500">
        <Icon size={11} /> {label}
      </div>
    </th>
  );
}

function BucketCell({ value, color }: {
  value: number;
  color: 'slate' | 'amber' | 'blue' | 'emerald' | 'orange';
}) {
  const palette: Record<string, string> = {
    slate:   'text-slate-500',
    amber:   'text-amber-700',
    blue:    'text-blue-700',
    emerald: 'text-emerald-700',
    orange:  'text-orange-700',
  };
  return (
    <td className="px-4 py-3 text-right">
      <span className={cn(
        'font-bold tabular-nums',
        value === 0 ? 'text-slate-300' : palette[color],
      )}>
        {value}
      </span>
    </td>
  );
}

function SumCell({ rows, field }: {
  rows: ProductionPipelineItem[];
  field: keyof Pick<ProductionPipelineItem, 'production_count'|'dry_room_count'|'testing_count'|'released_count'|'packaged_count'>;
}) {
  const total = rows.reduce((s, r) => s + (r[field] ?? 0), 0);
  return <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{total}</td>;
}

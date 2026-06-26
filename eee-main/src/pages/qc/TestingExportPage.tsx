import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Download, FileSpreadsheet, Filter } from 'lucide-react';
import {
  listProducts, listProductionLots, getTestingExportRows, formatQcDateTime,
  Product, ProductionLot, TestingExportRow,
} from '../../services/qcApi';
import { usePermissions } from '../../contexts/PermissionContext';
import { PermissionDenied } from './components/PermissionDenied';
import { exportTestingXlsx } from './testingExportXlsx';

/** YYYY-MM-DD in the app's display timezone (America/Chicago). */
function dallasDateStr(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export default function TestingExportPage({ onBack }: { onBack?: () => void }) {
  const { t } = useTranslation('qc');
  const { can } = usePermissions();
  const canView = can('qc', 'testing', 'view_status');

  const today = useMemo(() => dallasDateStr(new Date()), []);
  const weekAgo = useMemo(() => dallasDateStr(new Date(Date.now() - 6 * 86400000)), []);

  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(today);
  const [skuId, setSkuId] = useState<string>('');
  const [lotId, setLotId] = useState<string>('');

  const [products, setProducts] = useState<Product[]>([]);
  const [lots, setLots] = useState<ProductionLot[]>([]);
  const [rows, setRows] = useState<TestingExportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    listProducts().then(setProducts).catch(e => setError(e.message));
    listProductionLots().then(setLots).catch(e => setError(e.message));
  }, []);

  // Work-order dropdown narrows to the selected product when one is chosen.
  const visibleLots = useMemo(
    () => (skuId ? lots.filter(l => l.sku_id === skuId) : lots),
    [lots, skuId],
  );

  const load = () => {
    setLoading(true);
    setError('');
    getTestingExportRows({
      sku_id: skuId || null,
      from_date: from || null,
      to_date: to || null,
      production_lot_id: lotId || null,
    })
      .then(setRows)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  // Auto-load on filter change.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, skuId, lotId]);

  const handleExport = () => {
    const fname = `WA_MC_${from}_${to}.xlsx`;
    exportTestingXlsx(rows, fname);
  };

  if (!canView) {
    return <PermissionDenied permission="qc.testing.view_status" feature={t('testingExport.title')} />;
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 mb-3"
        >
          <ArrowLeft size={14} /> {t('testingExport.backToTesting')}
        </button>
      )}
      <h1 className="text-2xl font-bold text-slate-900 mb-1">{t('testingExport.title')}</h1>
      <p className="text-xs text-slate-500 mb-4">{t('testingExport.subtitle')}</p>

      {error && <p className="text-red-600 bg-red-50 p-2 rounded-lg mb-3 text-sm">{error}</p>}

      {/* Filters */}
      <div className="bg-white border rounded-xl p-4 mb-4 flex flex-wrap items-end gap-4">
        <div className="flex items-center gap-1.5 text-slate-500 text-xs font-bold uppercase tracking-wider">
          <Filter size={13} /> {t('testingExport.filters')}
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">{t('testingExport.from')}</label>
          <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">{t('testingExport.to')}</label>
          <input type="date" value={to} min={from} max={today} onChange={e => setTo(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">{t('testingExport.product')}</label>
          <select value={skuId} onChange={e => { setSkuId(e.target.value); setLotId(''); }}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm min-w-[200px] focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="">{t('testingExport.allProducts')}</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">{t('testingExport.workOrder')}</label>
          <select value={lotId} onChange={e => setLotId(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm min-w-[200px] focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="">{t('testingExport.allWorkOrders')}</option>
            {visibleLots.map(l => (
              <option key={l.id} value={l.id}>{l.work_order_barcode || l.lot_barcode}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={rows.length === 0}
          className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
        >
          <Download size={14} /> {t('testingExport.exportBtn')}
        </button>
      </div>

      {/* Preview table (template layout) */}
      <div className="bg-white border rounded-xl overflow-auto">
        <div className="px-3 py-2 border-b flex items-center gap-2 text-xs font-bold text-slate-600">
          <FileSpreadsheet size={13} /> {t('testingExport.rowCount', { count: rows.length })}
        </div>
        <table className="w-full text-xs whitespace-nowrap">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="text-left px-2 py-2 font-bold">{t('testingExport.colProduct')}</th>
              <th className="text-left px-2 py-2 font-bold">{t('testingExport.colDate')}</th>
              <th className="text-left px-2 py-2 font-bold">{t('testingExport.colItem')}</th>
              <th className="text-left px-2 py-2 font-bold">{t('testingExport.colWo')}</th>
              <th className="text-left px-2 py-2 font-bold">{t('testingExport.colSample')}</th>
              <th className="text-left px-2 py-2 font-bold">Mc%</th>
              <th className="text-left px-2 py-2 font-bold">Aw</th>
              <th className="text-left px-2 py-2 font-bold">{t('testingExport.colTemp')}</th>
              <th className="text-left px-2 py-2 font-bold">{t('testingExport.colHumidity')}</th>
              <th className="text-left px-2 py-2 font-bold">{t('testingExport.colRoomTemp')}</th>
              <th className="text-left px-2 py-2 font-bold">{t('testingExport.colInspector')}</th>
              <th className="text-left px-2 py-2 font-bold">{t('testingExport.colResult')}</th>
              <th className="text-left px-2 py-2 font-bold">{t('testingExport.colMcStd')}</th>
              <th className="text-left px-2 py-2 font-bold">{t('testingExport.colAwStd')}</th>
              <th className="text-left px-2 py-2 font-bold">{t('testingExport.colRetestAccept')}</th>
              <th className="text-left px-2 py-2 font-bold">{t('testingExport.colNote')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={16} className="px-3 py-6 text-center text-slate-400">{t('testingExport.loading')}</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={16} className="px-3 py-6 text-center text-slate-400">{t('testingExport.noRows')}</td></tr>
            ) : rows.map((r, i) => (
              <tr key={r.inspection_id} className={i % 2 ? 'bg-slate-50/40' : ''}>
                <td className="px-2 py-1.5 text-slate-700">{r.product_name ?? '—'}</td>
                <td className="px-2 py-1.5 text-slate-500">{formatQcDateTime(r.test_date)}</td>
                <td className="px-2 py-1.5 font-mono text-slate-700">{r.item_no ?? '—'}</td>
                <td className="px-2 py-1.5 font-mono text-slate-700">{r.wo_lot ?? '—'}</td>
                <td className="px-2 py-1.5 font-mono font-bold text-slate-900">{r.sample_id ?? '—'}</td>
                <td className="px-2 py-1.5 tabular-nums">{r.mc_value ?? '—'}</td>
                <td className="px-2 py-1.5 tabular-nums">{r.aw_value ?? '—'}</td>
                <td className="px-2 py-1.5 tabular-nums">{r.testing_temp ?? '—'}</td>
                <td className="px-2 py-1.5 tabular-nums">{r.humidity ?? '—'}</td>
                <td className="px-2 py-1.5 tabular-nums">{r.room_temp ?? '—'}</td>
                <td className="px-2 py-1.5 text-slate-600">{r.inspector ?? '—'}</td>
                <td className="px-2 py-1.5">
                  <span className={r.result === 'pass' ? 'text-emerald-700 font-bold' : 'text-red-700 font-bold'}>
                    {r.result === 'pass' ? 'Pass' : 'Fail'}
                  </span>
                </td>
                <td className="px-2 py-1.5 tabular-nums text-slate-500">
                  {r.mc_min ?? '—'}–{r.mc_max ?? '—'}
                </td>
                <td className="px-2 py-1.5 tabular-nums text-slate-500">
                  {r.aw_min ?? '—'}–{r.aw_max ?? '—'}
                </td>
                <td className="px-2 py-1.5 text-slate-600">{r.retest_accept || '—'}</td>
                <td className="px-2 py-1.5 text-slate-500">{r.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

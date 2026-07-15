import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Maximize2, Minimize2, ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { getDryRoomBoard, DryRoomBoardProduct } from '../../services/qcApi';
import { usePermissions } from '../../contexts/PermissionContext';
import { cn } from '../../lib/utils';
import { PermissionDenied } from './components/PermissionDenied';

const REFRESH_MS = 30_000;   // data reload
const FLIP_MS = 10_000;      // page auto-advance

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

export default function DryRoomBoard() {
  const { t } = useTranslation('qc');
  const { can } = usePermissions();
  const canView = can('qc', 'dashboard', 'view');

  const [products, setProducts] = useState<DryRoomBoardProduct[]>([]);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const [paused, setPaused] = useState(false);
  const [isFs, setIsFs] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(() => {
    getDryRoomBoard()
      .then(data => {
        setProducts(data);
        setIndex(i => (data.length === 0 ? 0 : i % data.length));
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  // Auto-advance one page every FLIP_MS (unless paused or single page).
  useEffect(() => {
    if (paused || products.length <= 1) return;
    const t = setInterval(() => setIndex(i => (i + 1) % products.length), FLIP_MS);
    return () => clearInterval(t);
  }, [paused, products.length]);

  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggleFs = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else rootRef.current?.requestFullscreen().catch(() => {});
  };

  const go = (delta: number) => {
    if (products.length === 0) return;
    setIndex(i => (i + delta + products.length) % products.length);
  };

  if (!canView) {
    return <PermissionDenied permission="qc.dashboard.view" feature={t('dryRoomBoard.title')} />;
  }

  const product = products[index] ?? null;

  return (
    <div ref={rootRef} className="min-h-full bg-white flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-slate-200 shrink-0">
        <h1 className="text-lg font-bold text-slate-900">{t('dryRoomBoard.title')}</h1>
        <span className="text-xs text-slate-400">
          {products.length > 0 ? t('dryRoomBoard.pageOf', { n: index + 1, total: products.length }) : ''}
        </span>
        <span className="flex-1" />
        <button type="button" onClick={() => go(-1)} disabled={products.length <= 1}
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 disabled:opacity-30" aria-label="prev">
          <ChevronLeft size={18} />
        </button>
        <button type="button" onClick={() => setPaused(p => !p)}
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600" aria-label="pause">
          {paused ? <Play size={16} /> : <Pause size={16} />}
        </button>
        <button type="button" onClick={() => go(1)} disabled={products.length <= 1}
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 disabled:opacity-30" aria-label="next">
          <ChevronRight size={18} />
        </button>
        <button type="button" onClick={toggleFs}
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600" aria-label="fullscreen">
          {isFs ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </div>

      {error && <p className="text-red-600 bg-red-50 p-2 m-4 rounded-lg text-sm">{error}</p>}

      {/* Slide */}
      <div className="flex-1 flex flex-col justify-center px-8 py-6">
        {!product ? (
          <div className="text-center text-slate-400 text-lg">{t('dryRoomBoard.empty')}</div>
        ) : (
          <div className="max-w-6xl w-full mx-auto">
            {/* Header */}
            <div className="flex items-center flex-wrap gap-x-6 gap-y-2 mb-6">
              <div className="text-2xl md:text-3xl font-bold text-slate-900">
                {t('dryRoomBoard.productName')}: {product.sku_name}
              </div>
              <div className="text-xl md:text-2xl font-mono text-slate-500">{product.sku_code}</div>
              <span className="flex-1" />
              <span className="text-sm font-bold text-white bg-emerald-600 px-3 py-1 rounded">{t('dryRoomBoard.today')}</span>
              <span className="text-sm font-bold text-white bg-orange-700 px-3 py-1 rounded">{t('dryRoomBoard.tomorrow')}</span>
            </div>

            {/* Table */}
            <table className="w-full border-collapse text-lg md:text-xl">
              <thead>
                <tr className="text-slate-600">
                  <th className="text-left font-semibold px-4 py-2">{t('dryRoomBoard.workOrder')}</th>
                  <th className="text-left font-semibold px-4 py-2">{t('dryRoomBoard.outDate')}</th>
                  <th className="text-center font-semibold px-4 py-2">{t('dryRoomBoard.dryRoom')}</th>
                  <th className="text-center font-semibold px-4 py-2">{t('dryRoomBoard.waiting')}</th>
                  <th className="text-center font-semibold px-4 py-2">{t('dryRoomBoard.pass')}</th>
                  <th className="text-center font-semibold px-4 py-2">{t('dryRoomBoard.fail')}</th>
                </tr>
              </thead>
              <tbody>
                {product.rows.map((r, i) => {
                  const tone = r.is_today ? 'today' : r.is_tomorrow ? 'tomorrow' : 'future';
                  return (
                    <tr key={`${r.work_order_barcode}-${r.date}-${i}`} className={cn(
                      'font-bold',
                      tone === 'today' ? 'bg-emerald-600 text-white'
                        : tone === 'tomorrow' ? 'bg-orange-700 text-white'
                        : 'text-slate-900',
                    )}>
                      <td className="px-4 py-3">{r.work_order_barcode}</td>
                      <td className="px-4 py-3">{fmtDate(r.date)}</td>
                      <td className="px-4 py-3 text-center tabular-nums">{r.dry_room}</td>
                      <td className="px-4 py-3 text-center tabular-nums">{r.is_today ? r.waiting : ''}</td>
                      <td className="px-4 py-3 text-center tabular-nums">{r.is_today ? r.pass : ''}</td>
                      <td className="px-4 py-3 text-center tabular-nums">{r.is_today ? r.fail : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Page dots */}
      {products.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 pb-4 shrink-0">
          {products.map((p, i) => (
            <button
              key={p.sku_id}
              type="button"
              onClick={() => setIndex(i)}
              className={cn('h-2 rounded-full transition-all', i === index ? 'w-6 bg-emerald-600' : 'w-2 bg-slate-300 hover:bg-slate-400')}
              aria-label={p.sku_code}
            />
          ))}
        </div>
      )}
    </div>
  );
}

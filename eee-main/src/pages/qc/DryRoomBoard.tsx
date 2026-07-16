import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Maximize2, Minimize2, ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { getDryRoomBoard, DryRoomBoardPage } from '../../services/qcApi';
import { usePermissions } from '../../contexts/PermissionContext';
import { cn } from '../../lib/utils';
import { PermissionDenied } from './components/PermissionDenied';

const REFRESH_MS = 30_000;   // data reload
const FLIP_MS = 10_000;      // page auto-advance
const ROWS_PER_PAGE = 12;    // max table rows per slide; overflow → extra page

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

function fmtTime(d: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(d);
}

type Slide = { day: DryRoomBoardPage; rows: DryRoomBoardPage['rows']; page: number; pageCount: number };

export default function DryRoomBoard() {
  const { t } = useTranslation('qc');
  const { can } = usePermissions();
  const canView = can('qc', 'dashboard', 'view');

  const [days, setDays] = useState<DryRoomBoardPage[]>([]);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const [paused, setPaused] = useState(false);
  const [isFs, setIsFs] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(() => {
    getDryRoomBoard()
      .then(data => { setDays(data); setLastUpdated(new Date()); })
      .catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  // Split each day's rows into row-limited pages → a flat list of slides.
  const slides = useMemo<Slide[]>(() => {
    const out: Slide[] = [];
    for (const d of days) {
      const pageCount = Math.max(1, Math.ceil(d.rows.length / ROWS_PER_PAGE));
      for (let i = 0; i < pageCount; i++) {
        out.push({ day: d, rows: d.rows.slice(i * ROWS_PER_PAGE, (i + 1) * ROWS_PER_PAGE), page: i + 1, pageCount });
      }
    }
    return out;
  }, [days]);

  useEffect(() => {
    setIndex(i => (slides.length === 0 ? 0 : Math.min(i, slides.length - 1)));
  }, [slides.length]);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (paused || slides.length <= 1) return;
    const t = setInterval(() => setIndex(i => (i + 1) % slides.length), FLIP_MS);
    return () => clearInterval(t);
  }, [paused, slides.length]);

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
    if (slides.length === 0) return;
    setIndex(i => (i + delta + slides.length) % slides.length);
  };

  if (!canView) {
    return <PermissionDenied permission="qc.dashboard.view" feature={t('dryRoomBoard.title')} />;
  }

  const slide = slides[index] ?? null;
  const day = slide?.day ?? null;
  const tone = day?.is_today ? 'today' : day?.is_tomorrow ? 'tomorrow' : 'future';

  const countHeader = (key: string) => `${t(key)} (${t('dryRoomBoard.qty')})`;

  return (
    <div ref={rootRef} className="min-h-full bg-white flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-slate-200 shrink-0">
        <h1 className="text-lg font-bold text-slate-900">{t('dryRoomBoard.title')}</h1>
        <span className="text-xs text-slate-400">
          {slides.length > 0 ? t('dryRoomBoard.pageOf', { n: index + 1, total: slides.length }) : ''}
        </span>
        <span className="flex-1" />
        <button type="button" onClick={() => go(-1)} disabled={slides.length <= 1}
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 disabled:opacity-30" aria-label="prev">
          <ChevronLeft size={18} />
        </button>
        <button type="button" onClick={() => setPaused(p => !p)}
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600" aria-label="pause">
          {paused ? <Play size={16} /> : <Pause size={16} />}
        </button>
        <button type="button" onClick={() => go(1)} disabled={slides.length <= 1}
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 disabled:opacity-30" aria-label="next">
          <ChevronRight size={18} />
        </button>
        <button type="button" onClick={toggleFs}
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600" aria-label="fullscreen">
          {isFs ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </div>

      {error && <p className="text-red-600 bg-red-50 p-2 m-4 rounded-lg text-sm">{error}</p>}

      {/* Slide — top-aligned, one day per page */}
      <div className="flex-1 flex flex-col px-8 pt-6 pb-2 min-h-0">
        {!day || !slide ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-lg">{t('dryRoomBoard.empty')}</div>
        ) : (
          <div className="max-w-6xl w-full mx-auto">
            {/* Day header */}
            <div className="flex items-center flex-wrap gap-x-4 gap-y-2 mb-5">
              <span className={cn(
                'text-2xl md:text-3xl font-bold text-white px-4 py-1.5 rounded-lg',
                tone === 'today' ? 'bg-emerald-600' : tone === 'tomorrow' ? 'bg-orange-700' : 'bg-slate-700',
              )}>
                {fmtDate(day.page_date)}
              </span>
              <span className="text-lg font-bold text-slate-500">
                {tone === 'today' ? t('dryRoomBoard.today') : tone === 'tomorrow' ? t('dryRoomBoard.tomorrow') : ''}
              </span>
              {slide.pageCount > 1 && (
                <span className="text-sm font-bold text-slate-400">{t('dryRoomBoard.subPage', { page: slide.page, total: slide.pageCount })}</span>
              )}
            </div>

            {/* Table */}
            <table className="w-full border-collapse text-base md:text-lg">
              <thead>
                <tr className="text-slate-600 border-b-2 border-slate-200">
                  <th className="text-left font-semibold px-3 py-2">{t('dryRoomBoard.productName')}</th>
                  <th className="text-left font-semibold px-3 py-2">{t('dryRoomBoard.sku')}</th>
                  <th className="text-left font-semibold px-3 py-2">{t('dryRoomBoard.workOrder')}</th>
                  <th className="text-left font-semibold px-3 py-2">{t('dryRoomBoard.outDate')}</th>
                  <th className="text-center font-semibold px-3 py-2">{t('dryRoomBoard.dryRoomNo')}</th>
                  <th className="text-center font-semibold px-3 py-2">{countHeader('dryRoomBoard.dryRoom')}</th>
                  <th className="text-center font-semibold px-3 py-2">{countHeader('dryRoomBoard.waiting')}</th>
                  <th className="text-center font-semibold px-3 py-2">{countHeader('dryRoomBoard.pass')}</th>
                  <th className="text-center font-semibold px-3 py-2">{countHeader('dryRoomBoard.fail')}</th>
                </tr>
              </thead>
              <tbody>
                {slide.rows.map((r, i) => (
                  <tr key={i} className={cn('border-b border-slate-100', i % 2 ? 'bg-slate-50/50' : '')}>
                    <td className="px-3 py-2.5 font-bold text-slate-900">{r.product_name ?? '—'}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-600">{r.sku_code ?? '—'}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-700">{r.work_order ?? '—'}</td>
                    <td className="px-3 py-2.5 text-slate-700">{fmtDate(r.out_date)}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums text-slate-600">{r.dryer_number ?? ''}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums font-bold">{r.dry_room || ''}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums font-bold">{r.waiting || ''}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums font-bold text-emerald-700">{r.pass || ''}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums font-bold text-red-700">{r.fail || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer: page dots + last-update */}
      <div className="relative flex items-center justify-center gap-1.5 px-6 pb-3 pt-1 shrink-0">
        {slides.length > 1 && slides.map((s, i) => (
          <button
            key={`${s.day.page_date}-${s.page}`}
            type="button"
            onClick={() => setIndex(i)}
            className={cn('h-2 rounded-full transition-all', i === index ? 'w-6 bg-emerald-600' : 'w-2 bg-slate-300 hover:bg-slate-400')}
            aria-label={`${s.day.page_date} ${s.page}`}
          />
        ))}
        {lastUpdated && (
          <span className="absolute right-6 bottom-3 text-[11px] text-slate-400 tabular-nums">
            {t('dryRoomBoard.lastUpdate', { time: fmtTime(lastUpdated) })}
          </span>
        )}
      </div>
    </div>
  );
}

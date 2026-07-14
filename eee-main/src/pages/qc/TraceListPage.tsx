import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react';
import { listProductionLots, ProductionLot } from '../../services/qcApi';
import { usePermissions } from '../../contexts/PermissionContext';
import { PermissionDenied } from './components/PermissionDenied';
import DateRangeCalendar from './components/DateRangeCalendar';

interface Props { onSelectLot: (id: string) => void; }

// Fuzzy match a lot against the query. Covers product name / code, work-order
// barcode, and lot number. Sub-lot codes are `<work_order>-NNN` (M-053), so
// stripping a trailing "-NNN" off the query lets a full sub-lot number match its
// parent work order without loading every cart into the list.
function matchesQuery(lot: ProductionLot, q: string): boolean {
  if (!q) return true;
  const hay = [lot.sku_name, lot.sku_code, lot.work_order_barcode, lot.lot_number]
    .filter(Boolean).join(' ').toLowerCase();
  if (hay.includes(q)) return true;
  const base = q.replace(/-\d+$/, '');
  return base.length > 0 && base !== q && hay.includes(base);
}

// created_at (a full timestamp) falls within the picked day range [start 00:00,
// end 23:59]. end defaults to start for a single-day filter.
function inDateRange(lot: ProductionLot, start: Date | null, end: Date | null): boolean {
  if (!start) return true;
  const d = new Date(lot.created_at);
  const lo = new Date(start); lo.setHours(0, 0, 0, 0);
  const hi = new Date(end ?? start); hi.setHours(23, 59, 59, 999);
  return d >= lo && d <= hi;
}

export default function TraceListPage({ onSelectLot }: Props) {
  const { t, i18n } = useTranslation('qc');
  const { can } = usePermissions();
  const canView = can('production', 'trace', 'view');
  const [lots, setLots] = useState<ProductionLot[]>([]);
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [rangeStart, setRangeStart] = useState<Date | null>(null);
  const [rangeEnd, setRangeEnd] = useState<Date | null>(null);

  useEffect(() => {
    listProductionLots().then(lots => {
      // Sort by created_at DESCENDING — newest work orders first within each
      // SKU group, so the most recently produced lots appear at the top.
      setLots([...lots].sort((a, b) => b.created_at.localeCompare(a.created_at)));
    }).catch(e => setError(e.message));
  }, []);

  const hasFilters = query.trim() !== '' || rangeStart !== null;

  // Apply search + date filters before grouping.
  const filteredLots = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lots.filter(l => matchesQuery(l, q) && inDateRange(l, rangeStart, rangeEnd));
  }, [lots, query, rangeStart, rangeEnd]);

  // Group by sku_id
  const groups = React.useMemo(() => {
    const map = new Map<string, { skuId: string; skuName: string; skuCode: string | null; lots: ProductionLot[] }>();
    for (const lot of filteredLots) {
      const key = lot.sku_id;
      if (!map.has(key)) {
        map.set(key, { skuId: key, skuName: lot.sku_name ?? lot.sku_code ?? lot.sku_id, skuCode: lot.sku_code ?? null, lots: [] });
      }
      map.get(key)!.lots.push(lot);
    }
    return Array.from(map.values()).sort((a, b) => a.skuName.localeCompare(b.skuName));
  }, [filteredLots]);

  const toggle = (skuId: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(skuId)) next.delete(skuId);
      else next.add(skuId);
      return next;
    });
  };

  if (!canView) {
    return <PermissionDenied permission="production.trace.view" feature={t('traceListPage.feature')} />;
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">{t('traceListPage.title')}</h1>
      <p className="text-sm text-slate-500 mb-5">{t('traceListPage.subtitle')}</p>

      {/* Search + date-range filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('traceListPage.searchPlaceholder')}
            className="w-full h-9 pl-9 pr-8 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-blue-400"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X size={15} />
            </button>
          )}
        </div>
        <DateRangeCalendar
          start={rangeStart}
          end={rangeEnd}
          onChange={(s, e) => { setRangeStart(s); setRangeEnd(e); }}
          locale={i18n.language}
          labels={{ placeholder: t('traceListPage.filterByDate'), clear: t('traceListPage.clearDates') }}
        />
        {hasFilters && (
          <span className="text-xs text-slate-400 font-medium ml-auto">
            {t('traceListPage.orderCount', { count: filteredLots.length })}
          </span>
        )}
      </div>

      {error && <p className="text-red-600 mb-3 text-sm">{error}</p>}
      {groups.length === 0 && !error && (
        <p className="text-slate-400 text-sm">
          {hasFilters ? t('traceListPage.noMatch') : t('traceListPage.empty')}
        </p>
      )}

      <div className="space-y-3">
        {groups.map(g => {
          const isOpen = !collapsed.has(g.skuId);
          return (
            <div key={g.skuId} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              {/* SKU header */}
              <button
                type="button"
                onClick={() => toggle(g.skuId)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {isOpen ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                  <div className="text-left">
                    {g.skuCode && <span className="font-mono text-xs font-bold text-slate-400 mr-2">{g.skuCode}</span>}
                    <span className="font-bold text-slate-900 text-sm">{g.skuName}</span>
                  </div>
                </div>
                <span className="text-xs text-slate-400 font-medium">{t('traceListPage.orderCount', { count: g.lots.length })}</span>
              </button>

              {/* Working orders list */}
              {isOpen && (
                <div className="border-t border-slate-100 divide-y divide-slate-100">
                  {g.lots.map(lot => {
                    // M-099: scanned/total badge. scanned_count = carts brought
                    // to the dryer (scanned_for_check_in_at stamped); total =
                    // every cart created for this WO.  Highlight in amber when
                    // there are still unscanned carts so ops notice unfinished
                    // production-floor work; muted slate when all scanned.
                    const scanned = lot.scanned_count ?? 0;
                    const total = lot.total_count ?? 0;
                    const allScanned = total > 0 && scanned >= total;
                    return (
                      <button
                        key={lot.id}
                        type="button"
                        onClick={() => onSelectLot(lot.id)}
                        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-blue-50/40 text-left transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <p className="text-sm font-semibold text-blue-700">{lot.work_order_barcode}</p>
                          <span
                            className={
                              'text-[10px] font-bold font-mono px-1.5 py-0.5 rounded ' +
                              (allScanned
                                ? 'bg-slate-100 text-slate-500'
                                : 'bg-amber-100 text-amber-800')
                            }
                            title={allScanned ? t('traceListPage.allScanned') : t('traceListPage.cartsNotScanned', { count: total - scanned })}
                          >
                            {scanned}/{total}
                          </span>
                          <p className="text-xs text-slate-400 truncate">
                            {lot.lot_number !== lot.work_order_barcode ? `· ${lot.lot_number} ` : ''}
                            · {new Date(lot.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <ChevronRight size={14} className="text-slate-300 shrink-0" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

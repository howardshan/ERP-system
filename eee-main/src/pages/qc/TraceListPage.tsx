import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { listProductionLots, ProductionLot } from '../../services/qcApi';
import { usePermissions } from '../../contexts/PermissionContext';
import { PermissionDenied } from './components/PermissionDenied';

interface Props { onSelectLot: (id: string) => void; }

export default function TraceListPage({ onSelectLot }: Props) {
  const { t } = useTranslation('qc');
  const { can } = usePermissions();
  const canView = can('production', 'trace', 'view');
  const [lots, setLots] = useState<ProductionLot[]>([]);
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    listProductionLots().then(lots => {
      // Sort by created_at DESCENDING — newest work orders first within each
      // SKU group, so the most recently produced lots appear at the top.
      setLots([...lots].sort((a, b) => b.created_at.localeCompare(a.created_at)));
    }).catch(e => setError(e.message));
  }, []);

  // Group by sku_id
  const groups = React.useMemo(() => {
    const map = new Map<string, { skuId: string; skuName: string; skuCode: string | null; lots: ProductionLot[] }>();
    for (const lot of lots) {
      const key = lot.sku_id;
      if (!map.has(key)) {
        map.set(key, { skuId: key, skuName: lot.sku_name ?? lot.sku_code ?? lot.sku_id, skuCode: lot.sku_code ?? null, lots: [] });
      }
      map.get(key)!.lots.push(lot);
    }
    return Array.from(map.values()).sort((a, b) => a.skuName.localeCompare(b.skuName));
  }, [lots]);

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
      {error && <p className="text-red-600 mb-3 text-sm">{error}</p>}
      {groups.length === 0 && !error && <p className="text-slate-400 text-sm">{t('traceListPage.empty')}</p>}

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

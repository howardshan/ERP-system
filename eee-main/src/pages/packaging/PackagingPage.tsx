import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckSquare,
  Square,
  RefreshCw,
  Package,
  ScanLine,
  AlertCircle,
  CheckCircle2,
  Loader2,
  SendHorizonal,
} from 'lucide-react';
import {
  getSkusWithStock,
  getAvailableCarts,
  dispatchCarts,
  PkgCart,
  PkgSku,
} from '../../services/pkgApi';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { usePermissions } from '../../contexts/PermissionContext';
import { PermissionDenied } from '../qc/components/PermissionDenied';

function DaysInStockBadge({ days }: { days: number }) {
  if (days < 10) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
        {days}d
      </span>
    );
  }
  if (days <= 14) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
        {days}d
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800 border border-red-300">
      {days}d
    </span>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function PackagingPage() {
  const { t } = useTranslation('packaging');
  const { can } = usePermissions();
  const canView = can('packaging', 'outbound', 'view');
  const canDispatch = can('packaging', 'outbound', 'dispatch');
  const [skus, setSkus] = useState<PkgSku[]>([]);
  const [skusLoading, setSkusLoading] = useState(true);
  const [selectedSkuId, setSelectedSkuId] = useState<string | null>(null);

  const [carts, setCarts] = useState<PkgCart[]>([]);
  const [cartsLoading, setCartsLoading] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [dispatching, setDispatching] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const [scanInput, setScanInput] = useState('');
  const [scanError, setScanError] = useState('');
  const scanRef = useRef<HTMLInputElement>(null);

  const loadSkus = async () => {
    setSkusLoading(true);
    try {
      const data = await getSkusWithStock();
      setSkus(data);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : t('packagingPage.errLoadSkus'));
    }
    setSkusLoading(false);
  };

  const loadCarts = async (skuId: string) => {
    setCartsLoading(true);
    setSelectedIds(new Set());
    setScanError('');
    try {
      const data = await getAvailableCarts(skuId);
      setCarts(data);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : t('packagingPage.errLoadCarts'));
    }
    setCartsLoading(false);
  };

  useEffect(() => {
    loadSkus();
  }, []);

  useEffect(() => {
    if (selectedSkuId) {
      loadCarts(selectedSkuId);
    } else {
      setCarts([]);
      setSelectedIds(new Set());
    }
  }, [selectedSkuId]);

  const handleSkuSelect = (skuId: string) => {
    setSelectedSkuId(skuId);
    setSuccessMsg('');
    setErrorMsg('');
    setScanError('');
    setTimeout(() => scanRef.current?.focus(), 100);
  };

  const toggleCart = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === carts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(carts.map(c => c.id)));
    }
  };

  const handleScanKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const code = scanInput.trim();
    setScanInput('');
    if (!code) return;

    const cart = carts.find(c => c.sub_lot_code === code);
    if (!cart) {
      setScanError(t('packagingPage.scanNotFound', { code }));
      return;
    }
    setScanError('');
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.add(cart.id);
      return next;
    });
  };

  const handleDispatch = async () => {
    if (selectedIds.size === 0) return;
    setDispatching(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const result = await dispatchCarts(Array.from(selectedIds), note || undefined);
      setSuccessMsg(
        t('packagingPage.dispatchSuccess', { count: result.cart_count, outboundId: result.outbound_id })
      );
      setNote('');
      setSelectedIds(new Set());
      await Promise.all([loadSkus(), selectedSkuId ? loadCarts(selectedSkuId) : Promise.resolve()]);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : t('packagingPage.errDispatch'));
    }
    setDispatching(false);
  };

  // Group carts by work_order_barcode so the table can show one row per
  // work order with the assigned packaging label, instead of a flat list.
  // M-092 attaches packaging_name/sku to every cart row.
  const groupedByWorkOrder = useMemo(() => {
    type Group = {
      key: string;                  // work_order_barcode or lot_number fallback
      workOrder: string | null;
      packagingName: string | null;
      packagingSku: string | null;
      carts: PkgCart[];
    };
    const map = new Map<string, Group>();
    for (const c of carts) {
      const key = c.work_order_barcode ?? c.lot_number ?? c.id;
      if (!map.has(key)) {
        map.set(key, {
          key,
          workOrder: c.work_order_barcode,
          packagingName: c.packaging_name,
          packagingSku: c.packaging_sku,
          carts: [],
        });
      }
      map.get(key)!.carts.push(c);
    }
    return Array.from(map.values()).sort((a, b) =>
      (a.workOrder ?? '').localeCompare(b.workOrder ?? ''),
    );
  }, [carts]);

  const toggleGroup = (cartIds: string[]) => {
    const allSel = cartIds.every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSel) cartIds.forEach(id => next.delete(id));
      else cartIds.forEach(id => next.add(id));
      return next;
    });
  };

  const allSelected = carts.length > 0 && selectedIds.size === carts.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < carts.length;

  if (!canView) {
    return <PermissionDenied permission="packaging.outbound.view" feature={t('packagingPage.feature')} />;
  }

  return (
    <div className="flex h-full min-h-0" style={{ minHeight: 'calc(100vh - 56px)' }}>
      {/* Left panel — SKU list */}
      <aside className="w-80 shrink-0 border-r border-slate-200 bg-white flex flex-col">
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center justify-between mb-0.5">
            <h2 className="text-sm font-bold text-slate-900">{t('packagingPage.productsInStock')}</h2>
            <button
              onClick={loadSkus}
              disabled={skusLoading}
              className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-40 transition-colors"
            >
              <RefreshCw size={13} className={skusLoading ? 'animate-spin' : ''} />
            </button>
          </div>
          <p className="text-[11px] text-slate-400">{t('packagingPage.selectProductHint')}</p>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {skusLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="animate-spin text-slate-400" />
            </div>
          )}
          {!skusLoading && skus.length === 0 && (
            <div className="text-center py-10">
              <Package size={28} className="text-slate-300 mx-auto mb-2" />
              <p className="text-xs text-slate-500">{t('packagingPage.noReleasedCarts')}</p>
            </div>
          )}
          {skus.map(sku => {
            const isSelected = selectedSkuId === sku.sku_id;
            return (
              <button
                key={sku.sku_id}
                onClick={() => handleSkuSelect(sku.sku_id)}
                className={cn(
                  'w-full text-left rounded-xl border-2 p-3 transition-all',
                  isSelected
                    ? 'border-orange-400 bg-orange-50'
                    : 'border-slate-200 bg-white hover:border-orange-200 hover:bg-orange-50/40',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                      {sku.sku_code}
                    </p>
                    <p className="text-sm font-bold text-slate-900 truncate mt-0.5">{sku.sku_name}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={cn(
                      'text-2xl font-bold tabular-nums',
                      isSelected ? 'text-orange-700' : 'text-slate-700',
                    )}>
                      {sku.cart_count}
                    </p>
                    <p className="text-[10px] text-slate-400">{t('packagingPage.cartsLabel')}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Right panel — Cart table */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#faf8f5]">
        {/* Scan input bar */}
        <div className="px-6 pt-5 pb-3">
          {selectedSkuId ? (
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-sm">
                <ScanLine size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  ref={scanRef}
                  type="text"
                  value={scanInput}
                  onChange={e => { setScanInput(e.target.value); setScanError(''); }}
                  onKeyDown={handleScanKeyDown}
                  placeholder={t('packagingPage.scanPlaceholder')}
                  className="w-full pl-9 pr-4 py-2 text-sm border-2 border-slate-200 rounded-xl focus:outline-none focus:border-orange-400 bg-white"
                />
              </div>
              {scanError && (
                <p className="flex items-center gap-1.5 text-xs font-bold text-red-600">
                  <AlertCircle size={13} />
                  {scanError}
                </p>
              )}
            </div>
          ) : (
            <div className="h-9 flex items-center">
              <p className="text-sm text-slate-400">{t('packagingPage.selectToBegin')}</p>
            </div>
          )}
        </div>

        {/* Toast messages */}
        <div className="px-6">
          {successMsg && (
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 text-sm text-emerald-800 font-medium mb-3">
              <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
              {successMsg}
            </div>
          )}
          {errorMsg && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-sm text-red-700 font-medium mb-3">
              <AlertCircle size={15} className="text-red-500 shrink-0" />
              {errorMsg}
            </div>
          )}
        </div>

        {/* Cart table */}
        <div className="flex-1 px-6 overflow-auto">
          {!selectedSkuId && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Package size={40} className="text-slate-300 mb-3" />
              <p className="text-slate-500 font-medium">{t('packagingPage.noProductSelected')}</p>
              <p className="text-xs text-slate-400 mt-1">{t('packagingPage.chooseProductHint')}</p>
            </div>
          )}

          {selectedSkuId && cartsLoading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="animate-spin text-slate-400" />
            </div>
          )}

          {selectedSkuId && !cartsLoading && carts.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Package size={36} className="text-slate-300 mb-3" />
              <p className="text-slate-500 font-medium">{t('packagingPage.noCartsAvailable')}</p>
              <p className="text-xs text-slate-400 mt-1">
                {t('packagingPage.noCartsAvailableHint')}
              </p>
            </div>
          )}

          {selectedSkuId && !cartsLoading && carts.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              {/* Master select-all bar */}
              <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
                <button onClick={toggleAll} className="text-slate-500 hover:text-slate-800 transition-colors">
                  {allSelected ? (
                    <CheckSquare size={16} className="text-orange-600" />
                  ) : someSelected ? (
                    <CheckSquare size={16} className="text-orange-400" />
                  ) : (
                    <Square size={16} />
                  )}
                </button>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  {t('packagingPage.summaryCount', { woCount: groupedByWorkOrder.length, cartCount: carts.length })}
                </span>
              </div>

              {/* One block per work order */}
              <div className="divide-y divide-slate-200">
                {groupedByWorkOrder.map(group => {
                  const groupIds = group.carts.map(c => c.id);
                  const groupSelectedCount = groupIds.filter(id => selectedIds.has(id)).length;
                  const groupAllSel = groupSelectedCount === groupIds.length;
                  const groupSomeSel = groupSelectedCount > 0 && !groupAllSel;
                  return (
                    <section key={group.key}>
                      {/* Group header: WO + packaging label */}
                      <div
                        className="px-4 py-2.5 bg-slate-50/60 flex items-center gap-3 cursor-pointer hover:bg-slate-100/60"
                        onClick={() => toggleGroup(groupIds)}
                      >
                        {groupAllSel ? (
                          <CheckSquare size={16} className="text-orange-600 shrink-0" />
                        ) : groupSomeSel ? (
                          <CheckSquare size={16} className="text-orange-400 shrink-0" />
                        ) : (
                          <Square size={16} className="text-slate-300 shrink-0" />
                        )}
                        <div className="font-mono font-bold text-sm text-slate-900">
                          {group.workOrder ?? t('packagingPage.noWorkOrder')}
                        </div>
                        <Package size={12} className="text-slate-400 shrink-0 ml-2" />
                        <span
                          className={cn(
                            'text-xs font-semibold',
                            group.packagingName ? 'text-slate-700' : 'text-slate-400 italic',
                          )}
                        >
                          {group.packagingName ?? t('packagingPage.noPackagingAssigned')}
                        </span>
                        {group.packagingSku && (
                          <span className="text-[10px] font-mono text-slate-400">{group.packagingSku}</span>
                        )}
                        <span className="flex-1" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          {t('packagingPage.cartCount', { count: group.carts.length })}
                        </span>
                      </div>

                      {/* Cart rows under this work order */}
                      <table className="w-full text-sm">
                        <tbody className="divide-y divide-slate-100">
                          {group.carts.map(cart => {
                            const checked = selectedIds.has(cart.id);
                            return (
                              <tr
                                key={cart.id}
                                onClick={() => toggleCart(cart.id)}
                                className={cn(
                                  'cursor-pointer transition-colors',
                                  checked ? 'bg-orange-50' : 'hover:bg-slate-50',
                                )}
                              >
                                <td className="w-10 px-4 py-2">
                                  {checked ? (
                                    <CheckSquare size={16} className="text-orange-600" />
                                  ) : (
                                    <Square size={16} className="text-slate-300" />
                                  )}
                                </td>
                                <td className="px-4 py-2">
                                  <span className="font-mono font-bold text-slate-900">{cart.sub_lot_code}</span>
                                </td>
                                <td className="px-4 py-2 text-slate-500 text-xs">
                                  {formatDate(cart.released_at)}
                                </td>
                                <td className="px-4 py-2">
                                  <DaysInStockBadge days={cart.days_in_stock} />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </section>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Action bar */}
        {selectedSkuId && !cartsLoading && carts.length > 0 && (
          <div className="px-6 py-4 border-t border-slate-200 bg-white flex items-center gap-4">
            <p className="text-sm font-bold text-slate-700 shrink-0">
              {t('packagingPage.cartsSelected', { count: selectedIds.size })}
            </p>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder={t('packagingPage.notePlaceholder')}
              className="flex-1 px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-orange-400"
            />
            <button
              onClick={handleDispatch}
              disabled={selectedIds.size === 0 || dispatching || !canDispatch}
              title={canDispatch ? undefined : t('packagingPage.dispatchPermissionTitle')}
              className="flex items-center gap-2 px-5 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl transition-colors shrink-0"
            >
              {dispatching ? (
                <><Loader2 size={14} className="animate-spin" /> {t('packagingPage.dispatching')}</>
              ) : (
                <><SendHorizonal size={14} /> {t('packagingPage.dispatch')}</>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

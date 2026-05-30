import React, { FormEvent, useEffect, useState } from 'react';
import { X, PackageCheck, AlertTriangle } from 'lucide-react';
import {
  releasePassedSubLotsGroup,
  PackagingRequiredError,
  NoPackagingLinkedError,
  getProductionLotSku,
  listProductItemLinks,
} from '../../../services/qcApi';
import { setLotPackagingItem, listItems, WarehouseItem } from '../../../services/warehouseApi';

interface Props {
  open: boolean;
  /** All sub-lot IDs to release (group or solo). */
  subLotIds: string[];
  /** Human-readable codes shown in the dialog. */
  subLotCodes: string[];
  skuName?: string | null;
  lotNumber?: string | null;
  onClose: () => void;
  onReleased: () => void;
}

type Phase = 'yield' | 'pick_packaging' | 'no_packaging';

// S4 release dialog. Collects yield → calls release → if back-end raises
// PACKAGING_REQUIRED for one of the production_lots, switches to a picker
// that fills packaging_item_id, then retries release. NO_PACKAGING_LINKED
// is a hard fail (operator must configure links in ProductManagement).
export function ReleaseDialog({
  open,
  subLotIds,
  subLotCodes,
  skuName,
  lotNumber,
  onClose,
  onReleased,
}: Props) {
  const [phase, setPhase] = useState<Phase>('yield');
  const [yieldQty, setYieldQty] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Set by a PACKAGING_REQUIRED error: which production_lot to fix.
  const [pendingProductionLotId, setPendingProductionLotId] = useState<string | null>(null);
  const [pendingSkuCode, setPendingSkuCode] = useState<string | null>(null);
  const [pendingItemChoices, setPendingItemChoices] = useState<WarehouseItem[]>([]);
  const [chosenItemId, setChosenItemId] = useState<number | null>(null);
  const [missingSkuId, setMissingSkuId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPhase('yield');
      setYieldQty('');
      setBusy(false);
      setError('');
      setPendingProductionLotId(null);
      setPendingSkuCode(null);
      setPendingItemChoices([]);
      setChosenItemId(null);
      setMissingSkuId(null);
    }
  }, [open]);

  if (!open) return null;

  const totalCarts = subLotIds.length;
  const codeSummary =
    subLotCodes.length === 0 ? '—'
    : subLotCodes.length === 1 ? subLotCodes[0]
    : `${subLotCodes[0]} 等 ${subLotCodes.length} 车`;

  // ── Phase: collect yield + submit release ────────────────────────────────
  const doRelease = async (qty: number) => {
    setBusy(true);
    setError('');
    try {
      await releasePassedSubLotsGroup(subLotIds, qty);
      onReleased();
    } catch (e) {
      if (e instanceof PackagingRequiredError) {
        await loadPickerFor(e.productionLotId, qty);
      } else if (e instanceof NoPackagingLinkedError) {
        setMissingSkuId(e.skuId);
        setPhase('no_packaging');
      } else {
        setError(e instanceof Error ? e.message : 'Release failed');
      }
    } finally {
      setBusy(false);
    }
  };

  const onYieldSubmit = (ev: FormEvent) => {
    ev.preventDefault();
    const n = Number(yieldQty);
    if (!Number.isFinite(n) || n <= 0) {
      setError('请输入大于 0 的产出数量');
      return;
    }
    void doRelease(n);
  };

  // ── Phase: load picker for the production_lot that needs packaging_item ──
  const loadPickerFor = async (productionLotId: string, _yieldForRetry: number) => {
    setError('');
    try {
      const pl = await getProductionLotSku(productionLotId);
      if (!pl.sku_id) {
        setError('找不到该生产卡片的 SKU,无法继续');
        return;
      }
      const linksMap = await listProductItemLinks();
      const itemIds = linksMap[pl.sku_id] ?? [];
      if (itemIds.length === 0) {
        setMissingSkuId(pl.sku_id);
        setPhase('no_packaging');
        return;
      }
      const allItems = await listItems();
      const choices = allItems.filter(it => itemIds.includes(it.id) && it.status === 'active');
      setPendingProductionLotId(productionLotId);
      setPendingSkuCode(pl.sku_code);
      setPendingItemChoices(choices);
      setChosenItemId(choices[0]?.id ?? null);
      setPhase('pick_packaging');
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载包装选项失败');
    }
  };

  // ── Phase: confirm picked packaging → setLotPackagingItem → retry release ──
  const onPickerSubmit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!pendingProductionLotId || !chosenItemId) {
      setError('请选择包装规格');
      return;
    }
    const qty = Number(yieldQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('产出数量无效,请返回上一步重填');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await setLotPackagingItem({
        productionLotId: pendingProductionLotId,
        itemId: chosenItemId,
      });
      setPendingProductionLotId(null);
      setPendingItemChoices([]);
      setChosenItemId(null);
      // Retry release with the same yield. If ANOTHER production_lot in the
      // group also lacks a packaging_item_id, doRelease will catch a fresh
      // PackagingRequiredError and flip us back to pick_packaging for that one.
      await doRelease(qty);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存包装失败');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <PackageCheck size={18} className="text-emerald-600" />
            放行到库存
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-slate-400 hover:text-slate-700 disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-1">
            <div><span className="text-slate-500">车次:</span> <span className="font-medium">{codeSummary}</span></div>
            {skuName && <div><span className="text-slate-500">产品:</span> <span className="font-medium">{skuName}</span></div>}
            {lotNumber && <div><span className="text-slate-500">批号:</span> <span className="font-medium">{lotNumber}</span></div>}
            <div><span className="text-slate-500">车数:</span> <span className="font-medium">{totalCarts}</span></div>
          </div>

          {error && (
            <p className="text-rose-700 bg-rose-50 border border-rose-200 p-2 rounded-lg text-sm flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {error}
            </p>
          )}

          {phase === 'yield' && (
            <form onSubmit={onYieldSubmit} className="space-y-3">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">
                  每车实际产出 <span className="text-rose-600">*</span>
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={yieldQty}
                  onChange={(e) => setYieldQty(e.target.value)}
                  autoFocus
                  disabled={busy}
                  className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-slate-100"
                  placeholder="例如 50"
                />
                <span className="text-xs text-slate-500 mt-1 block">
                  按物料基础单位录入。{totalCarts > 1 && `每车同样数量 × ${totalCarts} 车。`}
                </span>
              </label>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="flex-1 px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 font-medium"
                >
                  {busy ? '放行中…' : '放行'}
                </button>
              </div>
            </form>
          )}

          {phase === 'pick_packaging' && (
            <form onSubmit={onPickerSubmit} className="space-y-3">
              <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 p-2 rounded-lg">
                历史车次缺少包装规格。请为 SKU <span className="font-medium">{pendingSkuCode ?? '?'}</span> 选择本次放行对应的包装。
              </div>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">
                  包装规格 <span className="text-rose-600">*</span>
                </span>
                <select
                  value={chosenItemId ?? ''}
                  onChange={(e) => setChosenItemId(e.target.value ? Number(e.target.value) : null)}
                  disabled={busy}
                  className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-slate-100"
                >
                  <option value="">— 选择包装 —</option>
                  {pendingItemChoices.map(it => (
                    <option key={it.id} value={it.id}>{it.sku} — {it.name}</option>
                  ))}
                </select>
              </label>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setPhase('yield')}
                  disabled={busy}
                  className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  返回
                </button>
                <button
                  type="submit"
                  disabled={busy || !chosenItemId}
                  className="flex-1 px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 font-medium"
                >
                  {busy ? '保存并放行…' : '保存并放行'}
                </button>
              </div>
            </form>
          )}

          {phase === 'no_packaging' && (
            <div className="space-y-3">
              <p className="text-sm text-rose-800 bg-rose-50 border border-rose-200 p-3 rounded-lg">
                此 SKU 尚未配置任何包装规格,无法放行到库存。请到 <span className="font-medium">产品管理</span> 为 SKU
                <span className="font-mono"> {missingSkuId} </span> 配置至少一项关联的成品/包装,然后重试。
              </p>
              <button
                type="button"
                onClick={onClose}
                className="w-full px-3 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-800"
              >
                关闭
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

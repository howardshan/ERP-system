import React, { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

type Phase = 'confirm' | 'pick_packaging' | 'no_packaging';

// Release dialog. M-139: no yield input — confirm releases directly. If the
// back-end raises PACKAGING_REQUIRED for one of the production_lots, switches to
// a picker that fills packaging_item_id, then retries release. NO_PACKAGING_LINKED
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
  const { t } = useTranslation('qc');
  const [phase, setPhase] = useState<Phase>('confirm');
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
      setPhase('confirm');
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
    : t('releaseDialog.codeSummaryMulti', { code: subLotCodes[0], count: subLotCodes.length });

  // ── Submit release (no yield — M-139) ────────────────────────────────────
  const doRelease = async () => {
    setBusy(true);
    setError('');
    try {
      await releasePassedSubLotsGroup(subLotIds);
      onReleased();
    } catch (e) {
      if (e instanceof PackagingRequiredError) {
        await loadPickerFor(e.productionLotId);
      } else if (e instanceof NoPackagingLinkedError) {
        setMissingSkuId(e.skuId);
        setPhase('no_packaging');
      } else {
        setError(e instanceof Error ? e.message : t('releaseDialog.errorReleaseFailed'));
      }
    } finally {
      setBusy(false);
    }
  };

  // ── Phase: load picker for the production_lot that needs packaging_item ──
  const loadPickerFor = async (productionLotId: string) => {
    setError('');
    try {
      const pl = await getProductionLotSku(productionLotId);
      if (!pl.sku_id) {
        setError(t('releaseDialog.errorSkuNotFound'));
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
      setError(e instanceof Error ? e.message : t('releaseDialog.errorLoadPackagingFailed'));
    }
  };

  // ── Phase: confirm picked packaging → setLotPackagingItem → retry release ──
  const onPickerSubmit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!pendingProductionLotId || !chosenItemId) {
      setError(t('releaseDialog.errorSelectPackaging'));
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
      // Retry release. If ANOTHER production_lot in the group also lacks a
      // packaging_item_id, doRelease will catch a fresh PackagingRequiredError
      // and flip us back to pick_packaging for that one.
      await doRelease();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('releaseDialog.errorSavePackagingFailed'));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <PackageCheck size={18} className="text-emerald-600" />
            {t('releaseDialog.title')}
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
            <div><span className="text-slate-500">{t('releaseDialog.labelCarts')}</span> <span className="font-medium">{codeSummary}</span></div>
            {skuName && <div><span className="text-slate-500">{t('releaseDialog.labelProduct')}</span> <span className="font-medium">{skuName}</span></div>}
            {lotNumber && <div><span className="text-slate-500">{t('releaseDialog.labelLot')}</span> <span className="font-medium">{lotNumber}</span></div>}
            <div><span className="text-slate-500">{t('releaseDialog.labelCartCount')}</span> <span className="font-medium">{totalCarts}</span></div>
          </div>

          {error && (
            <p className="text-rose-700 bg-rose-50 border border-rose-200 p-2 rounded-lg text-sm flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {error}
            </p>
          )}

          {phase === 'confirm' && (
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {t('releaseDialog.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void doRelease()}
                disabled={busy}
                className="flex-1 px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 font-medium"
              >
                {busy ? t('releaseDialog.releasing') : t('releaseDialog.release')}
              </button>
            </div>
          )}

          {phase === 'pick_packaging' && (
            <form onSubmit={onPickerSubmit} className="space-y-3">
              <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 p-2 rounded-lg">
                {t('releaseDialog.pickPackagingNoticePrefix')} <span className="font-medium">{pendingSkuCode ?? '?'}</span> {t('releaseDialog.pickPackagingNoticeSuffix')}
              </div>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">
                  {t('releaseDialog.packagingSpecLabel')} <span className="text-rose-600">*</span>
                </span>
                <select
                  value={chosenItemId ?? ''}
                  onChange={(e) => setChosenItemId(e.target.value ? Number(e.target.value) : null)}
                  disabled={busy}
                  className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-slate-100"
                >
                  <option value="">{t('releaseDialog.selectPackagingOption')}</option>
                  {pendingItemChoices.map(it => (
                    <option key={it.id} value={it.id}>{it.sku} — {it.name}</option>
                  ))}
                </select>
              </label>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setPhase('confirm')}
                  disabled={busy}
                  className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {t('releaseDialog.back')}
                </button>
                <button
                  type="submit"
                  disabled={busy || !chosenItemId}
                  className="flex-1 px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 font-medium"
                >
                  {busy ? t('releaseDialog.savingAndReleasing') : t('releaseDialog.saveAndRelease')}
                </button>
              </div>
            </form>
          )}

          {phase === 'no_packaging' && (
            <div className="space-y-3">
              <p className="text-sm text-rose-800 bg-rose-50 border border-rose-200 p-3 rounded-lg">
                {t('releaseDialog.noPackagingPrefix')} <span className="font-medium">{t('releaseDialog.productManagement')}</span> {t('releaseDialog.noPackagingMiddle')}
                <span className="font-mono"> {missingSkuId} </span> {t('releaseDialog.noPackagingSuffix')}
              </p>
              <button
                type="button"
                onClick={onClose}
                className="w-full px-3 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-800"
              >
                {t('releaseDialog.close')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  listProducts,
  createProductionBatch,
  findLotsByWorkOrder,
  listSubLotsForLot,
  addSubLotsToLot,
  listProductItemLinks,
  Product,
  ProductionBatchInput,
  ProductionLot,
  SubLot,
} from '../../services/qcApi';
import { listItems, WarehouseItem } from '../../services/warehouseApi';
import { usePermissions } from '../../contexts/PermissionContext';
import { cn, daysToMinutes, minutesToDays } from '../../lib/utils';
import { CartStickerSheet } from './components/CartStickerSheet';

interface Props {
  onCreated?: (lotId: string) => void;
}

/** Parse the 3-digit trailing sequence from a sub_lot_code, e.g. "WO-123-007" → 7 */
function parseSeq(code: string): number {
  const m = code.match(/(\d{3})$/);
  return m ? parseInt(m[1], 10) : 0;
}

export default function Production({ onCreated }: Props) {
  const { t } = useTranslation('qc');
  const { can } = usePermissions();
  const canCreateBatch = can('production', 'work_orders', 'create');
  const disabled = !canCreateBatch;

  const [skus, setSkus] = useState<Product[]>([]);
  const [skuId, setSkuId] = useState('');
  const [workOrder, setWorkOrder] = useState('');
  const [expectedDryDays, setExpectedDryDays] = useState<string>('1');

  const [subLotMin, setSubLotMin] = useState<string>('1');
  const [subLotMax, setSubLotMax] = useState<string>('10');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  // Work order lookup
  const [existingLots, setExistingLots] = useState<ProductionLot[]>([]);
  const [existingSubLots, setExistingSubLots] = useState<SubLot[]>([]);
  const [lookingUp, setLookingUp] = useState(false);
  const lastAutoAdvancedFor = useRef<string>('');

  // Printable carts after a successful create / add-carts.  Holds the
  // sub-set the user just produced, plus the SKU + work-order context the
  // sticker needs.  Null while the form is being filled out; populated after
  // a successful submit so the "Print stickers" button in the success banner
  // has something to open.  `printOpen` controls the modal independently so
  // closing the modal doesn't lose the data.
  const [printable, setPrintable] = useState<{
    carts: SubLot[];
    workOrderBarcode: string;
    skuCode: string | null;
    skuName: string;
  } | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  // The lot id of the most recent successful submit; used by the
  // "Continue to Dry Rooms" button so navigation is now manual instead of
  // happening automatically on submit (which would unmount this component
  // before the user could see the Print button).
  const [lastCreatedLotId, setLastCreatedLotId] = useState<string | null>(null);

  // Final-product picker (M-095) — the work order's chosen packaging item.
  // List of items this SKU is allowed to be packed into is configured in
  // ProductManagement → "Final products" (qc_sku_item junction).  The form
  // shows a dropdown filtered to that list and forces a pick if the list
  // is non-empty.
  const [allItems, setAllItems] = useState<WarehouseItem[]>([]);
  const [skuItemLinks, setSkuItemLinks] = useState<Record<string, number[]>>({});
  const [packagingItemId, setPackagingItemId] = useState<string>('');  // '' = none picked

  useEffect(() => {
    listProducts().then(setSkus).catch(e => setError(e.message));
    listItems().then(setAllItems).catch(() => {});
    listProductItemLinks().then(setSkuItemLinks).catch(() => {});
  }, []);

  const linkedItemIds = skuId ? (skuItemLinks[skuId] ?? []) : [];
  const linkedItems = linkedItemIds
    .map(id => allItems.find(it => it.id === id))
    .filter(Boolean) as WarehouseItem[];

  // Reset packaging pick whenever SKU changes (the old choice may not be in
  // the new SKU's allowed list).
  useEffect(() => {
    setPackagingItemId('');
  }, [skuId]);

  const currentSku = skus.find(s => s.id === skuId);

  // Auto-fill expected dry time from SKU standard
  useEffect(() => {
    if (currentSku?.standard_drying_minutes != null) {
      const d = minutesToDays(currentSku.standard_drying_minutes);
      if (d != null) setExpectedDryDays(d % 1 === 0 ? String(d) : d.toFixed(2));
    }
  }, [currentSku?.standard_drying_minutes]);

  // Debounced work order lookup
  useEffect(() => {
    const trimmed = workOrder.trim();
    if (trimmed.length < 3) {
      setExistingLots([]);
      setExistingSubLots([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLookingUp(true);
      try {
        const found = await findLotsByWorkOrder(trimmed);
        setExistingLots(found);
        if (found.length > 0) {
          const subs = await listSubLotsForLot(found[0].id);
          setExistingSubLots(subs);
        } else {
          setExistingSubLots([]);
        }
      } catch {
        // ignore lookup errors silently
      }
      setLookingUp(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [workOrder]);

  // When an existing lot is found for the first time, advance the range past the existing max
  useEffect(() => {
    if (existingLots.length > 0 && existingSubLots.length > 0) {
      const key = existingLots[0].id;
      if (lastAutoAdvancedFor.current !== key) {
        lastAutoAdvancedFor.current = key;
        const maxSeq = Math.max(...existingSubLots.map(s => parseSeq(s.sub_lot_code)));
        setSubLotMin(String(maxSeq + 1));
        setSubLotMax(String(maxSeq + 10));
      }
    }
    if (existingLots.length === 0) {
      lastAutoAdvancedFor.current = '';
    }
  }, [existingLots, existingSubLots]);

  const minN = Math.max(1, parseInt(subLotMin, 10) || 0);
  const maxN = Math.max(minN, parseInt(subLotMax, 10) || 0);
  const subLotCount = Math.max(0, maxN - minN + 1);

  const existingSeqs = new Set(existingSubLots.map(s => parseSeq(s.sub_lot_code)));
  const conflictingSeqs = Array.from(
    { length: maxN - minN + 1 },
    (_, i) => minN + i,
  ).filter(n => existingSeqs.has(n));
  const hasConflict = conflictingSeqs.length > 0;

  const isAddMode = existingLots.length > 0;
  const existingLot = existingLots[0] ?? null;

  // SKU mismatch: user selected a different SKU than what the existing work order uses
  const skuMismatch =
    isAddMode &&
    !!skuId &&
    existingLot != null &&
    existingLot.sku_id !== skuId;

  const fillDemo = () => {
    if (skus[0]) setSkuId(skus[0].id);
    setWorkOrder('WO-DEMO-' + Math.floor(Math.random() * 900 + 100));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');
    if (disabled) {
      setError(t('production.errNoPermission'));
      return;
    }
    if (hasConflict) {
      setError(
        t('production.errCartsExist', {
          count: conflictingSeqs.length,
          carts: conflictingSeqs.map(n => String(n).padStart(3, '0')).join(', '),
        }),
      );
      return;
    }
    if (skuMismatch) {
      setError(t('production.errSkuMismatch'));
      return;
    }
    if (subLotCount === 0 || maxN < minN) {
      setError(t('production.errLastCart'));
      return;
    }

    if (isAddMode) {
      // ── Add carts to an existing work order ─────────────────────
      setBusy(true);
      try {
        const res = await addSubLotsToLot({
          production_lot_id: existingLot.id,
          start_seq: minN,
          end_seq: maxN,
        });
        setMsg(t('production.addedCarts', {
          count: res.added_count,
          lot: existingLot.lot_number,
          start: res.start_seq,
          end: res.end_seq,
        }));
        setLastCreatedLotId(existingLot.id);
        const subs = await listSubLotsForLot(existingLot.id);
        setExistingSubLots(subs);
        const newCarts = subs.filter(s => {
          const n = parseSeq(s.sub_lot_code);
          return n >= res.start_seq && n <= res.end_seq;
        });
        if (newCarts.length > 0) {
          setPrintable({
            carts: newCarts,
            workOrderBarcode: existingLot.work_order_barcode,
            skuCode: existingLot.sku_code ?? null,
            skuName: existingLot.sku_name ?? '',
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('production.errAddFailed'));
      }
      setBusy(false);
      return;
    }

    // ── Create a brand-new work order ────────────────────────────
    const dryDays = parseFloat(expectedDryDays);
    if (!dryDays || dryDays <= 0) {
      setError(t('production.errDryRequired'));
      return;
    }
    const dryMin = daysToMinutes(dryDays);
    if (!dryMin || dryMin <= 0) {
      setError(t('production.errDryPositive'));
      return;
    }
    // "Pack into" (final product) is OPTIONAL for now — the packing logic is not
    // finalized yet. Re-add the requirement here once it's decided.
    setBusy(true);
    try {
      const wo = workOrder.trim();
      const payload: ProductionBatchInput = {
        production_date: new Date().toISOString().slice(0, 10),
        shift: 'other',
        // Cart codes = work_order_barcode-001 … work_order_barcode-NNN
        production_code: wo,        // lot_number = lot_barcode = work order barcode
        work_order_barcode: wo,     // sub_lot prefix
        sku_id: skuId,
        expected_dry_minutes: dryMin,
        sub_lot_start_seq: minN,
        sub_lot_end_seq: maxN,
        packaging_item_id: packagingItemId ? Number(packagingItemId) : null,
      };
      const res = await createProductionBatch(payload);
      setMsg(t('production.createdWorkOrder', {
        count: res.sub_lot_count,
        lot: res.lot_number,
        first: `${wo}-${String(minN).padStart(3,'0')}`,
        last: `${wo}-${String(maxN).padStart(3,'0')}`,
      }));
      setLastCreatedLotId(res.lot_id);
      // Fetch the freshly-created sub_lots so the sticker print button has
      // their codes.  Wrap separately so a list failure doesn't mask the
      // successful create.
      try {
        const subs = await listSubLotsForLot(res.lot_id);
        if (subs.length > 0 && currentSku) {
          setPrintable({
            carts: subs,
            workOrderBarcode: wo,
            skuCode: currentSku.code,
            skuName: currentSku.name,
          });
        }
      } catch { /* non-fatal — user can re-load to print later */ }
      // Navigation to Dry Rooms is now triggered by the success-banner button
      // so the user has a chance to print stickers first.
    } catch (err) {
      setError(err instanceof Error ? err.message : t('production.errCreateFailed'));
    }
    setBusy(false);
  };

  // Preview prefix = work order barcode in all modes
  const wo = workOrder.trim();
  const codePrefix = wo || '<work_order>';

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">{t('production.title')}</h1>
      <p className="text-slate-600 mb-4 text-sm">
        {t('production.subtitle')}
      </p>

      {msg && (
        <div className="bg-emerald-50 border border-emerald-200 p-2 rounded-lg mb-3 text-sm flex items-center justify-between gap-3 flex-wrap">
          <p className="text-emerald-700">{msg}</p>
          <div className="flex items-center gap-2">
            {printable && (
              <button
                type="button"
                onClick={() => setPrintOpen(true)}
                className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white"
              >
                {t('production.printStickers', { count: printable.carts.length })}
              </button>
            )}
            {lastCreatedLotId && onCreated && (
              <button
                type="button"
                onClick={() => onCreated(lastCreatedLotId)}
                className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white"
              >
                {t('production.continueToDryRooms')}
              </button>
            )}
          </div>
        </div>
      )}
      {error && <p className="text-red-600 bg-red-50 p-2 rounded-lg mb-3 text-sm">{error}</p>}

      {disabled && (
        <p className="text-amber-700 bg-amber-50 border border-amber-200 p-3 rounded-lg mb-4 text-sm">
          {t('production.needPermPrefix')} <code className="font-mono">qc.production.create_batch</code> {t('production.needPermSuffix')}
        </p>
      )}

      <form onSubmit={submit} className="space-y-6">
        {/* ── Production-level fields ────────────────────────────────── */}
        <section className="bg-white border rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900 text-sm">{t('production.productionHeader')}</h2>
            <button type="button" onClick={fillDemo}
                    className="text-xs text-blue-600 underline">
              {t('production.fillDemo')}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-slate-700">{t('production.workOrderNumber')}</span>
              <div className="relative mt-1">
                <input
                  type="text"
                  value={workOrder}
                  onChange={(e) => { setWorkOrder(e.target.value); setMsg(''); setError(''); }}
                  placeholder={t('production.workOrderPlaceholder')}
                  className={cn(
                    'w-full border rounded-lg px-3 h-10 text-sm font-mono',
                    isAddMode ? 'border-amber-400 bg-amber-50 font-bold' : '',
                  )}
                  required
                />
                {lookingUp && (
                  <span className="absolute right-3 top-2.5 text-[10px] text-slate-400 animate-pulse">
                    {t('production.checking')}
                  </span>
                )}
              </div>
              {wo && !isAddMode && (
                <p className="text-[11px] text-slate-400 mt-1">
                  {t('production.cartCodesWillBe')}{' '}
                  <code className="font-mono text-slate-600">{wo}-001</code>,{' '}
                  <code className="font-mono text-slate-600">{wo}-002</code>, …
                </p>
              )}
            </label>

            <label className="block">
              <span className="text-xs font-medium text-slate-700">{t('production.productSku')}</span>
              <select
                value={skuId}
                onChange={(e) => setSkuId(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 h-10 text-sm"
                required={!isAddMode}
              >
                <option value="">{t('production.selectSku')}</option>
                {skus.map(s => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
              </select>
            </label>

            {/* Only show dry time when creating NEW work order */}
            {!isAddMode && (
              <label className="block">
                <span className="text-xs font-medium text-slate-700">
                  {t('production.expectedDryingTime')} <span className="text-slate-400">{t('production.expectedDryingTimeHint')}</span>
                </span>
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={expectedDryDays}
                  onChange={(e) => setExpectedDryDays(e.target.value)}
                  className="mt-1 w-full border rounded-lg px-3 h-10 text-sm"
                  placeholder={t('production.dryingTimePlaceholder')}
                  required
                />
                {currentSku?.standard_drying_minutes != null && (
                  <p className="text-[11px] text-slate-400 mt-1">
                    {t('production.skuSopDefault', { days: minutesToDays(currentSku.standard_drying_minutes)?.toFixed(2) })}
                  </p>
                )}
              </label>
            )}
          </div>
        </section>

        {/* ── Existing work order banner ─────────────────────────────── */}
        {isAddMode && existingLot && (
          <div className={cn(
            'border-2 rounded-xl p-4 space-y-2',
            skuMismatch
              ? 'bg-red-50 border-red-400'
              : 'bg-amber-50 border-amber-300',
          )}>
            <div className="flex items-center gap-2">
              <span className={skuMismatch ? 'text-red-500 text-base' : 'text-amber-500 text-base'}>
                {skuMismatch ? '✗' : '⚠'}
              </span>
              <p className={cn('text-sm font-bold', skuMismatch ? 'text-red-900' : 'text-amber-900')}>
                {skuMismatch
                  ? t('production.skuMismatchTitle')
                  : t('production.workOrderExistsTitle')}
              </p>
            </div>
            <div className={cn('flex flex-wrap gap-x-6 gap-y-1 text-xs', skuMismatch ? 'text-red-800' : 'text-amber-800')}>
              <span>Work order: <span className="font-mono font-bold">{existingLot.lot_number}</span></span>
              <span>Existing SKU: <span className="font-semibold">{existingLot.sku_name ?? existingLot.sku_code ?? '—'}</span></span>
            </div>
            {skuMismatch && (
              <p className="text-xs text-red-700 font-medium">
                This work order was created for a different SKU. Please select the correct SKU or use a different work order number.
              </p>
            )}
            {!skuMismatch && existingSubLots.length > 0 && (
              <div className="pt-1">
                <p className="text-[11px] font-semibold text-amber-700 mb-1">
                  Existing carts ({existingSubLots.length}):
                </p>
                <div className="flex flex-wrap gap-1">
                  {existingSubLots.map(s => (
                    <span
                      key={s.id}
                      className="inline-block bg-amber-200 text-amber-900 font-mono text-[10px] px-1.5 py-0.5 rounded"
                    >
                      {s.sub_lot_code}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Cart range ──────────────────────────────────────────────── */}
        <section className="bg-white border rounded-xl p-5 space-y-3">
          <h2 className="font-semibold text-slate-900 text-sm">
            {isAddMode ? 'New cart range' : 'Cart range'}
          </h2>
          <p className="text-[11px] text-slate-500">
            Cart codes are generated as{' '}
            <code className="font-mono">{codePrefix}-001</code>,{' '}
            <code className="font-mono">{codePrefix}-002</code>, etc.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-700">First cart number</span>
              <input
                type="number"
                min={1}
                step={1}
                value={subLotMin}
                onChange={(e) => setSubLotMin(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 h-10 text-sm font-mono"
                required
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700">Last cart number</span>
              <input
                type="number"
                min={minN}
                step={1}
                value={subLotMax}
                onChange={(e) => setSubLotMax(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 h-10 text-sm font-mono"
                required
              />
            </label>
          </div>
          {subLotCount > 0 && (
            <p className={cn('text-[11px]', hasConflict ? 'text-red-600' : 'text-slate-600')}>
              <strong>{subLotCount}</strong> cart(s):{' '}
              <code className="font-mono">{`${codePrefix}-${String(minN).padStart(3, '0')}`}</code>
              {' … '}
              <code className="font-mono">{`${codePrefix}-${String(maxN).padStart(3, '0')}`}</code>
            </p>
          )}
          {hasConflict && (
            <p className="text-[11px] text-red-600 font-semibold">
              ✗ Cart{conflictingSeqs.length > 1 ? 's' : ''}{' '}
              {conflictingSeqs.map(n => String(n).padStart(3, '0')).join(', ')}{' '}
              already exist — choose a different range.
            </p>
          )}
        </section>

        {/* ── Final product picker (M-095) ──────────────────────────── */}
        {skuId && !isAddMode && (
          <section className="bg-white border rounded-xl p-5 space-y-3">
            <h2 className="font-semibold text-slate-900 text-sm">
              Final product
              <span className="ml-2 text-xs font-normal text-slate-400">
                · {currentSku?.name}
              </span>
            </h2>

            {linkedItems.length === 0 ? (
              <p className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded p-2">
                This SKU has no final-product options configured. Go to{' '}
                <strong>Production → Products</strong> and add at least one item under{' '}
                <strong>Final products</strong>, then come back.
              </p>
            ) : (
              <>
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Pack into <span className="text-slate-400 normal-case font-normal">(optional)</span>
                  </span>
                  <select
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white"
                    value={packagingItemId}
                    onChange={e => setPackagingItemId(e.target.value)}
                  >
                    <option value="">— Choose a final product —</option>
                    {linkedItems.map(it => (
                      <option key={it.id} value={it.id}>
                        {it.sku} · {it.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-[10px] text-slate-400">
                  Only the items linked to this SKU under <em>Products → Final products</em>{' '}
                  are listed. Edit the SKU there to add more options.
                </p>
              </>
            )}
          </section>
        )}

        {!msg && <button
          type="submit"
          disabled={busy || disabled || subLotCount === 0 || hasConflict || skuMismatch}
          className={cn(
            'w-full py-3 rounded-xl text-sm font-bold transition-colors',
            disabled || hasConflict || skuMismatch
              ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
              : isAddMode
                ? 'bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50',
          )}
        >
          {busy
            ? (isAddMode ? 'Adding…' : 'Creating…')
            : isAddMode
              ? `Add ${subLotCount} cart(s) to existing order`
              : `Create work order with ${subLotCount} cart(s)`
          }
        </button>}
      </form>

      {printOpen && printable && (
        <CartStickerSheet
          carts={printable.carts}
          workOrderBarcode={printable.workOrderBarcode}
          skuCode={printable.skuCode}
          skuName={printable.skuName}
          onClose={() => setPrintOpen(false)}
        />
      )}
    </div>
  );
}

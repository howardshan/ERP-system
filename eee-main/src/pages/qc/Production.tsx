import React, { FormEvent, useEffect, useRef, useState } from 'react';
import {
  listProducts,
  createProductionBatch,
  findLotsByWorkOrder,
  listSubLotsForLot,
  addSubLotsToLot,
  Product,
  ProductionBatchInput,
  ProductionLot,
  SubLot,
} from '../../services/qcApi';
import { usePermissions } from '../../contexts/PermissionContext';
import { cn, daysToMinutes, minutesToDays } from '../../lib/utils';

interface Props {
  onCreated?: (lotId: string) => void;
}

/** Parse the 3-digit trailing sequence from a sub_lot_code, e.g. "WO-123-007" → 7 */
function parseSeq(code: string): number {
  const m = code.match(/(\d{3})$/);
  return m ? parseInt(m[1], 10) : 0;
}

export default function Production({ onCreated }: Props) {
  const { can } = usePermissions();
  const canCreateBatch = can('qc', 'production', 'create_batch');
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

  useEffect(() => {
    listProducts().then(setSkus).catch(e => setError(e.message));
  }, []);

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

  const fillDemo = () => {
    if (skus[0]) setSkuId(skus[0].id);
    setWorkOrder('WO-DEMO-' + Math.floor(Math.random() * 900 + 100));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');
    if (disabled) {
      setError('You lack permission to create production lots and sub-lots');
      return;
    }
    if (hasConflict) {
      setError(
        `Cart number${conflictingSeqs.length > 1 ? 's' : ''} ${conflictingSeqs.map(n => String(n).padStart(3, '0')).join(', ')} already exist in this work order.`,
      );
      return;
    }
    if (subLotCount === 0 || maxN < minN) {
      setError('Last cart number must be >= first cart number');
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
        setMsg(`Added ${res.added_count} cart(s) to ${existingLot.lot_number} (carts ${res.start_seq}–${res.end_seq}).`);
        const subs = await listSubLotsForLot(existingLot.id);
        setExistingSubLots(subs);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Add failed');
      }
      setBusy(false);
      return;
    }

    // ── Create a brand-new work order ────────────────────────────
    const dryDays = parseFloat(expectedDryDays);
    if (!dryDays || dryDays <= 0) {
      setError('Expected dry time is required (BR-Q29).');
      return;
    }
    const dryMin = daysToMinutes(dryDays);
    if (!dryMin || dryMin <= 0) {
      setError('Expected dry time must be > 0');
      return;
    }
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
      };
      const res = await createProductionBatch(payload);
      setMsg(`Created work order ${res.lot_number} with ${res.sub_lot_count} cart(s): ${wo}-${String(minN).padStart(3,'0')} … ${wo}-${String(maxN).padStart(3,'0')}.`);
      if (onCreated) onCreated(res.lot_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
    setBusy(false);
  };

  // Preview prefix = work order barcode in all modes
  const wo = workOrder.trim();
  const codePrefix = wo || '<work_order>';

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Production</h1>
      <p className="text-slate-600 mb-4 text-sm">
        Create a new work order or add carts to an existing one.
      </p>

      {msg && <p className="text-emerald-700 bg-emerald-50 p-2 rounded-lg mb-3 text-sm">{msg}</p>}
      {error && <p className="text-red-600 bg-red-50 p-2 rounded-lg mb-3 text-sm">{error}</p>}

      {disabled && (
        <p className="text-amber-700 bg-amber-50 border border-amber-200 p-3 rounded-lg mb-4 text-sm">
          You need <code className="font-mono">qc.production.create_batch</code> permission to use this page.
        </p>
      )}

      <form onSubmit={submit} className="space-y-6">
        {/* ── Production-level fields ────────────────────────────────── */}
        <section className="bg-white border rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900 text-sm">Production header</h2>
            <button type="button" onClick={fillDemo}
                    className="text-xs text-blue-600 underline">
              Fill demo values
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-slate-700">Work order number</span>
              <div className="relative mt-1">
                <input
                  type="text"
                  value={workOrder}
                  onChange={(e) => { setWorkOrder(e.target.value); setMsg(''); setError(''); }}
                  placeholder="e.g. WO-2026-001"
                  className={cn(
                    'w-full border rounded-lg px-3 h-10 text-sm font-mono',
                    isAddMode ? 'border-amber-400 bg-amber-50 font-bold' : '',
                  )}
                  required
                />
                {lookingUp && (
                  <span className="absolute right-3 top-2.5 text-[10px] text-slate-400 animate-pulse">
                    checking…
                  </span>
                )}
              </div>
              {wo && !isAddMode && (
                <p className="text-[11px] text-slate-400 mt-1">
                  Cart codes will be{' '}
                  <code className="font-mono text-slate-600">{wo}-001</code>,{' '}
                  <code className="font-mono text-slate-600">{wo}-002</code>, …
                </p>
              )}
            </label>

            <label className="block">
              <span className="text-xs font-medium text-slate-700">Product SKU</span>
              <select
                value={skuId}
                onChange={(e) => setSkuId(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 h-10 text-sm"
                required={!isAddMode}
              >
                <option value="">— Select SKU —</option>
                {skus.map(s => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
              </select>
            </label>

            {/* Only show dry time when creating NEW work order */}
            {!isAddMode && (
              <label className="block">
                <span className="text-xs font-medium text-slate-700">
                  Expected drying time <span className="text-slate-400">(days — BR-Q29)</span>
                </span>
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={expectedDryDays}
                  onChange={(e) => setExpectedDryDays(e.target.value)}
                  className="mt-1 w-full border rounded-lg px-3 h-10 text-sm"
                  placeholder="e.g. 1.5"
                  required
                />
                {currentSku?.standard_drying_minutes != null && (
                  <p className="text-[11px] text-slate-400 mt-1">
                    SKU SOP default: {minutesToDays(currentSku.standard_drying_minutes)?.toFixed(2)}d
                  </p>
                )}
              </label>
            )}
          </div>
        </section>

        {/* ── Existing work order banner ─────────────────────────────── */}
        {isAddMode && existingLot && (
          <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-amber-500 text-base">⚠</span>
              <p className="text-sm font-bold text-amber-900">Work order already exists — adding carts</p>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-amber-800">
              <span>Work order: <span className="font-mono font-bold">{existingLot.lot_number}</span></span>
              <span>SKU: <span className="font-semibold">{existingLot.sku_name ?? existingLot.sku_code ?? '—'}</span></span>
            </div>
            {existingSubLots.length > 0 && (
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

        <button
          type="submit"
          disabled={busy || disabled || subLotCount === 0 || hasConflict}
          className={cn(
            'w-full py-3 rounded-xl text-sm font-bold transition-colors',
            disabled || hasConflict
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
        </button>
      </form>
    </div>
  );
}

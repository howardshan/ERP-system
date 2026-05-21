import React, { FormEvent, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  listProducts,
  createProductionBatch,
  Product,
  ProductionBatchInput,
} from '../../services/qcApi';
import { usePermissions } from '../../contexts/PermissionContext';
import { cn } from '../../lib/utils';

interface Props {
  onCreated?: (lotId: string) => void;
}

type SubLotDraft = {
  sub_lot_code: string;
};

const SHIFTS = [
  { value: 'early',  label: 'Early Shift' },
  { value: 'late',   label: 'Late Shift' },
  { value: 'night',  label: 'Night Shift' },
  { value: 'other',  label: 'Other' },
];

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function autoCode(date: string, shift: string, skuCode: string | undefined): string {
  const d = date.replace(/-/g, '');
  const s = shift ? shift.toUpperCase().slice(0, 3) : '---';
  const sku = (skuCode ?? 'SKU').replace(/[^A-Z0-9]/gi, '').slice(0, 6).toUpperCase();
  return `P-${d}-${s}-${sku}`;
}

export default function Production({ onCreated }: Props) {
  const { can } = usePermissions();
  const canCreateBatch = can('qc', 'production', 'create_batch');
  const disabled = !canCreateBatch;

  const [skus, setSkus] = useState<Product[]>([]);

  const [productionDate, setProductionDate] = useState(todayDate());
  const [shift, setShift] = useState('early');
  const [skuId, setSkuId] = useState('');
  const [productionCode, setProductionCode] = useState('');
  const [workOrder, setWorkOrder] = useState('');
  const [autoCodeEnabled, setAutoCodeEnabled] = useState(true);
  const [expectedDryMinutes, setExpectedDryMinutes] = useState<string>('240');

  const [subLots, setSubLots] = useState<SubLotDraft[]>([{ sub_lot_code: '' }]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    listProducts().then(setSkus).catch(e => setError(e.message));
  }, []);

  const currentSku = skus.find(s => s.id === skuId);

  // Auto-regenerate code when its inputs change (unless user disabled auto)
  useEffect(() => {
    if (autoCodeEnabled) {
      setProductionCode(autoCode(productionDate, shift, currentSku?.code));
    }
  }, [productionDate, shift, currentSku?.code, autoCodeEnabled]);

  // When SKU changes, pre-fill expected dry minutes from SKU's standard_drying_minutes
  useEffect(() => {
    if (currentSku?.standard_drying_minutes != null) {
      setExpectedDryMinutes(String(currentSku.standard_drying_minutes));
    }
  }, [currentSku?.standard_drying_minutes]);

  const updateSubLot = (idx: number, patch: Partial<SubLotDraft>) => {
    setSubLots(prev => prev.map((sl, i) => i === idx ? { ...sl, ...patch } : sl));
  };
  const addSubLot = () => {
    setSubLots(prev => [...prev, { sub_lot_code: '' }]);
  };
  const removeSubLot = (idx: number) => {
    setSubLots(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);
  };

  const fillDemo = () => {
    setProductionDate(todayDate());
    setShift('early');
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
    setBusy(true);
    try {
      const dryMin = expectedDryMinutes ? parseInt(expectedDryMinutes, 10) : null;
      const payload: ProductionBatchInput = {
        production_date: productionDate,
        shift,
        production_code: productionCode,
        work_order_barcode: workOrder,
        sku_id: skuId,
        expected_dry_minutes: dryMin && dryMin > 0 ? dryMin : null,
        sub_lots: subLots.map(sl => ({
          sub_lot_code: sl.sub_lot_code || null,
        })),
      };
      const res = await createProductionBatch(payload);
      setMsg(`Created production ${res.lot.lot_number} with ${res.sub_lots.length} sub-lot(s)`);
      // Reset sub-lots, keep production-level fields so user can quickly create another
      setSubLots([{ sub_lot_code: '' }]);
      if (onCreated) onCreated(res.lot.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
    setBusy(false);
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Production</h1>
      <p className="text-slate-600 mb-4 text-sm">
        Create one Dry Room (production lot) and any number of sub-lots in a single submission.
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
            <label className="block">
              <span className="text-xs font-medium text-slate-700">Production date</span>
              <input
                type="date"
                value={productionDate}
                onChange={(e) => setProductionDate(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                required
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700">Shift</span>
              <select
                value={shift}
                onChange={(e) => setShift(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              >
                {SHIFTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700">Product SKU</span>
              <select
                value={skuId}
                onChange={(e) => setSkuId(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                required
              >
                <option value="">— Select SKU —</option>
                {skus.map(s => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700">Work order barcode</span>
              <input
                type="text"
                value={workOrder}
                onChange={(e) => setWorkOrder(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                required
              />
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-slate-700">
              Expected drying time <span className="text-slate-400">(minutes, applied to every sub-lot)</span>
            </span>
            <input
              type="number"
              min={1}
              value={expectedDryMinutes}
              onChange={(e) => setExpectedDryMinutes(e.target.value)}
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="e.g. 240"
            />
            {currentSku?.standard_drying_minutes != null && (
              <p className="text-[11px] text-slate-400 mt-1">
                SKU SOP default: {currentSku.standard_drying_minutes} min
              </p>
            )}
          </label>

          <label className="block">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-700">Production code / barcode</span>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <input
                  type="checkbox"
                  checked={autoCodeEnabled}
                  onChange={(e) => setAutoCodeEnabled(e.target.checked)}
                  className="w-3 h-3 rounded accent-blue-600"
                />
                Auto-generate
              </label>
            </div>
            <input
              type="text"
              value={productionCode}
              onChange={(e) => { setAutoCodeEnabled(false); setProductionCode(e.target.value); }}
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-mono"
              required
            />
          </label>
        </section>

        {/* ── Sub-lots ─────────────────────────────────────────────────── */}
        <section className="bg-white border rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900 text-sm">Sub-lots ({subLots.length})</h2>
            <button
              type="button"
              onClick={addSubLot}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white"
            >
              <Plus size={12} /> Add sub-lot
            </button>
          </div>

          <ul className="space-y-2">
            {subLots.map((sl, idx) => (
              <li key={idx} className="border rounded-lg p-3 bg-slate-50/50 flex items-center gap-3">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide w-20 shrink-0">
                  Sub-lot {idx + 1}
                </span>
                <input
                  type="text"
                  placeholder="Sub-lot code (leave blank for auto)"
                  value={sl.sub_lot_code}
                  onChange={(e) => updateSubLot(idx, { sub_lot_code: e.target.value })}
                  className="flex-1 border rounded-lg px-3 py-2 text-sm font-mono"
                />
                {subLots.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeSubLot(idx)}
                    className="text-red-600 hover:text-red-700 p-1 shrink-0"
                    aria-label="Remove sub-lot"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-slate-400 mt-1">
            Leave the code blank to auto-generate as <code>{'<production_code>-D##'}</code>. Dryer
            location and check-in time are recorded later when the cart actually goes into the dryer.
          </p>
        </section>

        <button
          type="submit"
          disabled={busy || disabled}
          className={cn(
            'w-full py-3 rounded-xl text-sm font-bold transition-colors',
            disabled
              ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50',
          )}
        >
          {busy ? 'Creating…' : `Create production with ${subLots.length} sub-lot(s)`}
        </button>
      </form>
    </div>
  );
}

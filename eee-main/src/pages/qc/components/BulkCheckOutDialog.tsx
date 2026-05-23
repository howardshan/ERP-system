import React, { useMemo, useState } from 'react';
import { X, AlertTriangle, CheckCircle2, LogOut, FlaskConical, RefreshCw } from 'lucide-react';
import { checkOutSubLotsBulk, SubLot, BulkCheckOutResult } from '../../../services/qcApi';
import { cn } from '../../../lib/utils';

interface Props {
  open: boolean;
  selectedSubLots: SubLot[];       // eligible drying carts the user picked
  ineligibleSubLots?: SubLot[];    // carts that failed scan/eligibility checks
  onClose: () => void;
  onSuccess: (result: BulkCheckOutResult) => void;
}

interface SamplingPreview {
  key: string;                    // productLotId or productLotId+groupId for redry
  productLotLabel: string;
  skuName: string;
  cartCount: number;
  sampleEveryN: number;
  groupsExpected: number;
  isRedry: boolean;
  originalGroupLabel?: string;    // for redry rows
}

export function BulkCheckOutDialog({
  open, selectedSubLots, ineligibleSubLots = [], onClose, onSuccess,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Classify carts
  const freshCarts  = useMemo(() => selectedSubLots.filter(s => !s.test_group_id), [selectedSubLots]);
  const redryCarts  = useMemo(() => selectedSubLots.filter(s => !!s.test_group_id), [selectedSubLots]);
  const hasMix      = freshCarts.length > 0 && redryCarts.length > 0;
  const hasRedry    = redryCarts.length > 0;

  // Build sampling preview:
  //   • Fresh carts: one row per production_lot
  //   • Redry carts: one row per (production_lot × original_test_group_id)
  const preview = useMemo<SamplingPreview[]>(() => {
    const rows = new Map<string, SamplingPreview>();

    // Fresh
    for (const s of freshCarts) {
      const key = `fresh:${s.production_lot_id}`;
      const existing = rows.get(key);
      const sampleN = Math.max(1, s.sample_every_n_carts ?? 1);
      if (existing) {
        existing.cartCount += 1;
      } else {
        rows.set(key, {
          key,
          productLotLabel: s.lot_number ?? s.lot_barcode ?? '—',
          skuName: s.sku_name ?? '—',
          cartCount: 1,
          sampleEveryN: sampleN,
          groupsExpected: 0,
          isRedry: false,
        });
      }
    }

    // Redry — group by original test_group_id
    for (const s of redryCarts) {
      const key = `redry:${s.production_lot_id}:${s.test_group_id}`;
      const existing = rows.get(key);
      const sampleN = Math.max(1, s.sample_every_n_carts ?? 1);
      if (existing) {
        existing.cartCount += 1;
      } else {
        rows.set(key, {
          key,
          productLotLabel: s.lot_number ?? s.lot_barcode ?? '—',
          skuName: s.sku_name ?? '—',
          cartCount: 1,
          sampleEveryN: sampleN,
          groupsExpected: 0,
          isRedry: true,
          originalGroupLabel: `Group #${s.test_group_sequence ?? '?'}`,
        });
      }
    }

    // Compute groupsExpected = ceil(cartCount / sampleN)
    for (const g of rows.values()) {
      g.groupsExpected = Math.ceil(g.cartCount / g.sampleEveryN);
    }

    return Array.from(rows.values()).sort((a, b) => {
      // Fresh first, then redry; within each, by label
      if (a.isRedry !== b.isRedry) return a.isRedry ? 1 : -1;
      return a.productLotLabel.localeCompare(b.productLotLabel);
    });
  }, [freshCarts, redryCarts]);

  if (!open) return null;

  const total = selectedSubLots.length;
  const brokenCount = ineligibleSubLots.length;
  const totalChampions = preview.reduce((s, p) => s + p.groupsExpected, 0);

  const confirm = async () => {
    if (busy || total === 0) return;
    setBusy(true);
    setError('');
    try {
      const result = await checkOutSubLotsBulk({
        sub_lot_ids: selectedSubLots.map(s => s.id),
      });
      onSuccess(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bulk check-out failed');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-label="Close"
      />
      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl">
        <header className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <LogOut size={18} />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Confirm bulk check-out</p>
              <h2 className="text-base font-bold text-slate-900">{total} cart(s) → Testing queue</h2>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100" aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="px-5 py-4 space-y-3">

          {/* ── Mixed fresh + redry warning ───────────────────────────────── */}
          {hasMix && (
            <div className="rounded-xl p-3 border-2 border-amber-400 bg-amber-50 flex gap-2">
              <AlertTriangle size={18} className="text-amber-700 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-bold text-amber-900">Mixed selection</p>
                <p className="text-amber-800 text-[12px] mt-0.5">
                  <strong>{freshCarts.length}</strong> new cart{freshCarts.length !== 1 ? 's' : ''} and{' '}
                  <strong>{redryCarts.length}</strong> re-dried cart{redryCarts.length !== 1 ? 's' : ''} are selected together.
                  They will be checked out and grouped <strong>separately</strong> — re-dried carts
                  form their own sampling group(s) with a fresh champion.
                </p>
              </div>
            </div>
          )}

          {/* ── Redry-only notice ─────────────────────────────────────────── */}
          {!hasMix && hasRedry && (
            <div className="rounded-xl p-3 border-2 border-blue-300 bg-blue-50 flex gap-2">
              <RefreshCw size={16} className="text-blue-600 shrink-0 mt-0.5" />
              <p className="text-[12px] text-blue-900">
                <strong>Re-dried carts.</strong> These carts have been through at least one
                drying cycle already. A new random champion will be selected within each group.
              </p>
            </div>
          )}

          {/* ── Totals card ───────────────────────────────────────────────── */}
          <div className={cn(
            'rounded-xl p-4 border-2',
            total === 0 ? 'border-slate-200 bg-slate-50' : 'border-emerald-300 bg-emerald-50',
          )}>
            <div className="flex items-baseline justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-wider font-bold text-emerald-700">Total carts</p>
                <p className="text-3xl font-bold tabular-nums text-slate-900 mt-1">{total}</p>
                {hasRedry && (
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {freshCarts.length} new · <span className="text-blue-600">{redryCarts.length} re-dry</span>
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wider font-bold text-emerald-700 flex items-center gap-1">
                  <FlaskConical size={11} /> Samples to test
                </p>
                <p className="text-3xl font-bold tabular-nums text-slate-900 mt-1">{totalChampions}</p>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Carts group automatically by SKU sampling rate. One random cart per group becomes the
              test champion; siblings wait in <code className="font-mono">awaiting_group_result</code>.
            </p>
          </div>

          {/* ── Ineligible carts warning ──────────────────────────────────── */}
          {brokenCount > 0 && (
            <div className="rounded-xl p-3 border-2 border-amber-300 bg-amber-50 flex gap-2">
              <AlertTriangle size={18} className="text-amber-700 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-amber-900">
                  {brokenCount} cart(s) skipped — please verify
                </p>
                <ul className="mt-1 space-y-0.5 max-h-32 overflow-auto text-[11px] font-mono">
                  {ineligibleSubLots.map(s => (
                    <li key={s.id} className="text-amber-900">
                      {s.sub_lot_code} <span className="text-amber-600">({s.status})</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* ── Sampling preview ──────────────────────────────────────────── */}
          {preview.length > 0 && (
            <section className="border border-slate-200 rounded-lg p-3">
              <h3 className="text-[10px] uppercase tracking-wider font-bold text-slate-600 mb-2">
                Sampling preview
              </h3>
              <ul className="space-y-0.5 text-xs">
                {preview.map(p => (
                  <li key={p.key} className={cn(
                    'flex items-center gap-2 py-1.5 px-2 rounded-md',
                    p.isRedry ? 'bg-blue-50' : 'bg-slate-50',
                  )}>
                    {p.isRedry
                      ? <RefreshCw size={11} className="text-blue-500 shrink-0" />
                      : <FlaskConical size={11} className="text-emerald-600 shrink-0" />
                    }
                    <span className="font-mono font-bold text-slate-800 truncate flex-1">{p.productLotLabel}</span>
                    {p.isRedry && p.originalGroupLabel && (
                      <span className="text-[10px] text-blue-600 font-mono">{p.originalGroupLabel} re-dry</span>
                    )}
                    <span className="text-slate-500">{p.skuName}</span>
                    <span className="text-slate-700 font-mono">
                      {p.cartCount} cart{p.cartCount === 1 ? '' : 's'}
                    </span>
                    <span className="text-slate-400">→</span>
                    <span className={cn(
                      'font-mono font-bold',
                      p.isRedry ? 'text-blue-700' : 'text-emerald-700',
                    )}>
                      {p.groupsExpected} sample{p.groupsExpected === 1 ? '' : 's'}
                    </span>
                    <span className="text-[10px] text-slate-400">(1 per {p.sampleEveryN})</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {error && (
            <p className="text-xs bg-red-50 border border-red-100 text-red-700 rounded p-2">{error}</p>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2 bg-slate-50 rounded-b-2xl">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-bold border border-slate-300 text-slate-700 hover:bg-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy || total === 0}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <CheckCircle2 size={13} />
            {busy ? 'Checking out…' : `Confirm — check out ${total}`}
          </button>
        </footer>
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { X, AlertTriangle, CheckCircle2, Boxes } from 'lucide-react';
import { registerSubLotsBulk, SubLot, BulkCheckInResult } from '../../../services/qcApi';
import { cn } from '../../../lib/utils';

interface Props {
  open: boolean;
  dryerNumber: number;
  selectedSubLots: SubLot[];   // candidate sub-lots (already filtered to eligible status by caller)
  ineligibleSubLots?: SubLot[]; // optional — sub-lots the caller wants to display as broken-code warnings
  onClose: () => void;
  onSuccess: (result: BulkCheckInResult) => void;
}

export function BulkCheckInDialog({
  open, dryerNumber, selectedSubLots, ineligibleSubLots = [], onClose, onSuccess,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const total = selectedSubLots.length;
  // Treat already-drying carts as "already checked in", not as broken codes —
  // we silence the warning for them (operator confirmed via DB lookup that
  // the code is in fact already in a dryer).
  const realIneligible = ineligibleSubLots.filter(s => s.status !== 'drying');
  const brokenCount = realIneligible.length;

  const confirm = async () => {
    if (busy || total === 0) return;
    setBusy(true);
    setError('');
    try {
      const result = await registerSubLotsBulk({
        sub_lot_ids: selectedSubLots.map(s => s.id),
        dryer_number: dryerNumber,
      });
      onSuccess(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bulk check-in failed');
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
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl">
        <header className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
              <Boxes size={18} />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Confirm check-in</p>
              <h2 className="text-base font-bold text-slate-900">Dryer {dryerNumber}</h2>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100" aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="px-5 py-4">
          {/* Headline count */}
          <div className={cn(
            'rounded-xl p-4 border-2 mb-3',
            total === 0 ? 'border-slate-200 bg-slate-50'
              : 'border-emerald-300 bg-emerald-50',
          )}>
            <p className="text-[10px] uppercase tracking-wider font-bold text-emerald-700">Carts to check in</p>
            <p className="text-3xl font-bold tabular-nums text-slate-900 mt-1">{total}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Each cart will occupy 1 of the 100 slots in Dryer {dryerNumber}.
            </p>
          </div>

          {/* Broken-code warning */}
          {brokenCount > 0 && (
            <div className="rounded-xl p-3 border-2 border-amber-300 bg-amber-50 mb-3 flex gap-2">
              <AlertTriangle size={18} className="text-amber-700 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-amber-900">
                  {brokenCount} sub-lot(s) skipped — please verify
                </p>
                <p className="text-[11px] text-amber-800 mt-1">
                  These weren't eligible for check-in (wrong status or barcode error). Common reasons: already in a dryer, already inspected, or scanner returned a code that doesn't match any sub-lot.
                </p>
                <ul className="mt-2 space-y-0.5 max-h-32 overflow-auto text-[11px] font-mono">
                  {realIneligible.map(s => (
                    <li key={s.id} className="text-amber-900">
                      {s.sub_lot_code} <span className="text-amber-600">({s.status})</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Eligible sub-lots list */}
          {selectedSubLots.length > 0 && (
            <details className="mb-3" open={selectedSubLots.length <= 5}>
              <summary className="text-xs font-bold text-slate-600 cursor-pointer hover:text-slate-900">
                Show eligible sub-lots ({selectedSubLots.length})
              </summary>
              <ul className="mt-2 space-y-1 max-h-48 overflow-auto text-[11px] font-mono pl-2">
                {selectedSubLots.map(s => (
                  <li key={s.id} className="flex justify-between gap-2 text-slate-700 border-b border-slate-100 py-1">
                    <span>{s.sub_lot_code}</span>
                    <span className="text-slate-400">{s.sku_name ?? '—'}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {error && (
            <p className="text-xs bg-red-50 border border-red-100 text-red-700 rounded p-2 mb-3">{error}</p>
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
            {busy ? 'Checking in…' : `Confirm — check in ${total}`}
          </button>
        </footer>
      </div>
    </div>
  );
}

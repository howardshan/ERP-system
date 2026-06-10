import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { QrCode, X } from 'lucide-react';
import { findSubLotByCode, SubLot } from '../../../services/qcApi';
import { cn } from '../../../lib/utils';

interface Props {
  open: boolean;
  /** Optional context — when the scan happens inside a specific dryer detail,
   *  the dialog can show a hint like "Looking up in Dryer 1 …" */
  dryerNumber?: number;
  /** If true, after a successful scan the dialog clears its input and stays
   *  open so the operator can keep scanning carts.  Parent closes the dialog
   *  explicitly via its Cancel/X buttons or after they're done.  Defaults to
   *  false (legacy single-scan behaviour). */
  keepOpen?: boolean;
  /** Optional label rendered in the dialog footer to give live feedback,
   *  e.g. "Selected 3 carts so far".  Only shown when `keepOpen` is true. */
  runningSummary?: string;
  /** Bump this value (e.g. increment a counter) to re-focus the scan input —
   *  used after the parent dismisses a blocking error popup so the operator can
   *  keep scanning without clicking back into the field. */
  focusSignal?: number;
  onClose: () => void;
  onFound: (subLot: SubLot) => void;
}

/**
 * Modal for QR / barcode lookup of a sub-lot.
 *
 * Industrial USB barcode scanners act as keyboard input + Enter, so a plain
 * <input autoFocus> with submit-on-Enter is enough — no camera library
 * required. The dialog ALSO accepts manual typing for fallback.
 */
export function ScanQrDialog({
  open, dryerNumber, keepOpen = false, runningSummary, focusSignal, onClose, onFound,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Last successfully-scanned code, shown briefly so the operator gets
  // feedback that the previous scan registered before they fire the next one.
  const [lastOk, setLastOk] = useState('');

  useEffect(() => {
    if (open) {
      setValue('');
      setError('');
      setLastOk('');
      // Autofocus after the dialog mounts
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Re-focus the input when the parent asks (e.g. after dismissing an error
  // popup), so the operator can keep scanning without clicking back in.
  useEffect(() => {
    if (open && focusSignal != null) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [focusSignal, open]);

  if (!open) return null;

  /** Single entry point for both form-submit (Enter key via browser) and
   *  the explicit input-keydown handler below.  Idempotent — bails when
   *  busy or value empty. */
  const runScan = async () => {
    const code = value.trim();
    if (!code || busy) return;
    setBusy(true);
    setError('');
    try {
      const sl = await findSubLotByCode(code);
      if (!sl) {
        setError(`No sub-lot found for "${code}"`);
        setBusy(false);
        inputRef.current?.select();
        return;
      }
      onFound(sl);
      if (keepOpen) {
        // Continuous-scan mode: clear input + refocus + show that the scan
        // landed.  Parent owns the actual accumulation logic via onFound.
        setLastOk(code);
        setValue('');
        // rAF waits for React to commit the busy=false / value='' updates;
        // setTimeout(0) fires before the commit so the focus() call lands on
        // a still-disabled input and silently no-ops.  Double rAF survives
        // React 18 concurrent rendering.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            inputRef.current?.focus();
          });
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed');
    }
    setBusy(false);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void runScan();
  };

  // Defensive: some browsers / scanners / focus states cause the form's
  // Enter→onSubmit pathway to not fire.  Catch Enter on the input directly
  // and trigger runScan() ourselves, then preventDefault so the form-submit
  // doesn't also fire (handler is idempotent on busy, so double-fire is
  // safe — this just prevents wasted work).
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void runScan();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-label="Close"
      />
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl p-5">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 p-1 rounded hover:bg-slate-100"
          aria-label="Close"
        >
          <X size={16} />
        </button>

        <div className="flex items-center gap-2 mb-3">
          <div className="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center">
            <QrCode size={18} />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Scan sub-lot QR</h2>
            <p className="text-[11px] text-slate-500">
              {dryerNumber != null ? `Dryer ${dryerNumber} context · ` : ''}
              {keepOpen
                ? 'Keep scanning carts; press Done when finished.'
                : 'Scan a barcode or type a sub-lot code, then press Enter.'}
            </p>
          </div>
        </div>

        <form onSubmit={submit}>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Scan or type sub-lot code (e.g. LOT-DEMO-001-D01)"
            className={cn(
              'w-full border-2 rounded-lg px-3 py-3 text-base font-mono',
              error ? 'border-red-300' : 'border-slate-200 focus:border-blue-400 outline-none',
              busy ? 'opacity-70' : '',
            )}
            // In keepOpen mode never actually disable — a barcode scanner's
            // next keystrokes arrive within a few ms of submit; if the input
            // is disabled at that moment they go to document.body and are
            // lost.  Visually dim while busy via opacity instead.
            disabled={keepOpen ? false : busy}
            autoComplete="off"
          />

          {error && (
            <p className="text-red-600 text-xs mt-2 bg-red-50 px-2 py-1.5 rounded">
              {error}
            </p>
          )}

          {keepOpen && lastOk && !error && (
            <p className="text-emerald-700 text-xs mt-2 bg-emerald-50 px-2 py-1.5 rounded font-mono">
              ✓ Added <strong>{lastOk}</strong>
            </p>
          )}

          {keepOpen && runningSummary && (
            <p className="text-[11px] text-slate-600 mt-2 bg-slate-50 px-2 py-1.5 rounded">
              {runningSummary}
            </p>
          )}

          <div className="flex items-center justify-between mt-3">
            <p className="text-[10px] text-slate-400">
              USB scanners type the code and press Enter automatically.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-bold',
                  keepOpen
                    ? 'bg-slate-900 hover:bg-slate-700 text-white'
                    : 'border border-slate-300 text-slate-700 hover:bg-slate-50',
                )}
              >
                {keepOpen ? 'Done' : 'Cancel'}
              </button>
              <button
                type="submit"
                // IMPORTANT: only check value, NOT busy.  A disabled submit
                // button silently swallows form-Enter in all browsers, which
                // means the scanner's Enter terminator is lost while the
                // previous scan is still in-flight (busy=true).  Re-entry is
                // already guarded inside `submit()` via `if (busy) return`.
                disabled={!value.trim()}
                className="px-4 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
              >
                {busy ? 'Looking up…' : keepOpen ? 'Add cart' : 'Find cart'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { QrCode, X } from 'lucide-react';
import { findSubLotByCode, SubLot } from '../../../services/qcApi';
import { cn } from '../../../lib/utils';

interface Props {
  open: boolean;
  /** Optional context — when the scan happens inside a specific dryer detail,
   *  the dialog can show a hint like "Looking up in Dryer 1 …" */
  dryerNumber?: number;
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
export function ScanQrDialog({ open, dryerNumber, onClose, onFound }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setValue('');
      setError('');
      // Autofocus after the dialog mounts
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const sl = await findSubLotByCode(value);
      if (!sl) {
        setError(`No sub-lot found for "${value.trim()}"`);
        setBusy(false);
        inputRef.current?.select();
        return;
      }
      onFound(sl);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lookup failed');
    }
    setBusy(false);
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
              Scan a barcode or type a sub-lot code, then press Enter.
            </p>
          </div>
        </div>

        <form onSubmit={submit}>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Scan or type sub-lot code (e.g. LOT-DEMO-001-D01)"
            className={cn(
              'w-full border-2 rounded-lg px-3 py-3 text-base font-mono',
              error ? 'border-red-300' : 'border-slate-200 focus:border-blue-400 outline-none',
            )}
            disabled={busy}
            autoComplete="off"
          />

          {error && (
            <p className="text-red-600 text-xs mt-2 bg-red-50 px-2 py-1.5 rounded">
              {error}
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
                className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !value.trim()}
                className="px-4 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
              >
                {busy ? 'Looking up…' : 'Find cart'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

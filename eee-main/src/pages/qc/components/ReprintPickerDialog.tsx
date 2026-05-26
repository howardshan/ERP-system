import React, { useEffect, useState } from 'react';
import { Printer, X } from 'lucide-react';
import { SubLot } from '../../../services/qcApi';
import { SelectAllCheckbox } from './SelectAllCheckbox';
import { cn } from '../../../lib/utils';

interface Props {
  open: boolean;
  subLots: SubLot[];
  /** Called with the selected sub_lots when the user confirms.  Parent
   *  is responsible for opening the CartStickerSheet with them. */
  onConfirm: (selected: SubLot[]) => void;
  onClose: () => void;
}

/**
 * Multi-select picker used by the TracePage "Reprint sticker" button.
 * Shows every cart in the work order; the operator ticks one or more and
 * the parent feeds the selection into <CartStickerSheet/> for printing.
 */
export function ReprintPickerDialog({ open, subLots, onConfirm, onClose }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) setSelected(new Set());
  }, [open]);

  if (!open) return null;

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === subLots.length) setSelected(new Set());
    else setSelected(new Set(subLots.map(s => s.id)));
  };

  const confirm = () => {
    const picked = subLots.filter(s => selected.has(s.id));
    if (picked.length === 0) return;
    onConfirm(picked);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-label="Close"
      />
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl max-h-[80vh] flex flex-col">
        <header className="px-5 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
              <Printer size={18} />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Reprint stickers</p>
              <h2 className="text-base font-bold text-slate-900">Pick carts</h2>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100" aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="px-5 py-3 border-b border-slate-100 shrink-0 flex items-center gap-3">
          <SelectAllCheckbox
            total={subLots.length}
            selected={selected.size}
            onToggleAll={toggleAll}
          />
          <span className="text-xs text-slate-500">
            {selected.size} of {subLots.length} selected
          </span>
        </div>

        <ul className="overflow-y-auto divide-y divide-slate-100 flex-1 min-h-0">
          {subLots.map(s => {
            const isSel = selected.has(s.id);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => toggle(s.id)}
                  className={cn(
                    'w-full text-left px-5 py-2.5 flex items-center gap-3 hover:bg-slate-50',
                    isSel && 'bg-blue-50',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={isSel}
                    readOnly
                    className="w-4 h-4 accent-blue-600"
                  />
                  <span className="font-mono text-sm font-bold text-slate-900">{s.sub_lot_code}</span>
                  <span className="text-xs text-slate-400 ml-auto">{s.status}</span>
                </button>
              </li>
            );
          })}
          {subLots.length === 0 && (
            <li className="px-5 py-6 text-center text-sm text-slate-400">No carts in this work order.</li>
          )}
        </ul>

        <footer className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2 bg-slate-50 rounded-b-2xl shrink-0">
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
            disabled={selected.size === 0}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Printer size={13} />
            Print {selected.size > 0 ? `${selected.size} sticker${selected.size === 1 ? '' : 's'}` : ''}
          </button>
        </footer>
      </div>
    </div>
  );
}

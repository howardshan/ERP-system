import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, Search, Undo2, AlertTriangle } from 'lucide-react';
import {
  listAwaitingCheckIn, withdrawAwaitingCheckIn, WithdrawReason, SubLot,
} from '../../../services/qcApi';
import { cn } from '../../../lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

const REASONS: { value: WithdrawReason; labelKey: string }[] = [
  { value: 'shift_change', labelKey: 'withdrawCheckIn.reasonShiftChange' },
  { value: 'scan_error',   labelKey: 'withdrawCheckIn.reasonScanError' },
  { value: 'other',        labelKey: 'withdrawCheckIn.reasonOther' },
];

export function WithdrawCheckInDialog({ open, onClose, onSuccess }: Props) {
  const { t } = useTranslation('qc');
  const [carts, setCarts] = useState<SubLot[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState<WithdrawReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Tauri-safe inline confirm: first click arms, second (within 3s) commits.
  const [armed, setArmed] = useState(false);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = () => {
    setLoading(true);
    listAwaitingCheckIn()
      .then(setCarts)
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!open) return;
    setSearch(''); setSelected(new Set()); setReason(null); setNote('');
    setBusy(false); setError(''); setArmed(false);
    load();
    return () => { if (armTimer.current) clearTimeout(armTimer.current); };
  }, [open]);

  const woOf = (s: SubLot) => s.work_order_barcode || s.lot_barcode || s.lot_number || '';

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return carts;
    return carts.filter(s =>
      woOf(s).toLowerCase().includes(q) || s.sub_lot_code.toLowerCase().includes(q));
  }, [carts, search]);

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAllFiltered = () => {
    const ids = filtered.map(s => s.id);
    const allOn = ids.length > 0 && ids.every(id => selected.has(id));
    setSelected(prev => {
      const next = new Set(prev);
      if (allOn) ids.forEach(id => next.delete(id));
      else ids.forEach(id => next.add(id));
      return next;
    });
  };

  const noteRequired = reason === 'other';
  const canSubmit = selected.size > 0 && reason != null && (!noteRequired || note.trim().length > 0) && !busy;

  const disarm = () => { setArmed(false); if (armTimer.current) clearTimeout(armTimer.current); };

  const handleWithdraw = async () => {
    if (!canSubmit || reason == null) return;
    if (!armed) {
      setArmed(true);
      armTimer.current = setTimeout(() => setArmed(false), 3000);
      return;
    }
    disarm();
    setBusy(true);
    setError('');
    try {
      const ids = Array.from(selected);
      const res = await withdrawAwaitingCheckIn(ids, reason, noteRequired ? note.trim() : null);
      const ok = res.succeeded.length;
      const failed = res.failed.length;
      onSuccess(failed > 0
        ? t('withdrawCheckIn.doneSomeSkipped', { count: ok, failed })
        : t('withdrawCheckIn.done', { count: ok }));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('withdrawCheckIn.failed'));
    }
    setBusy(false);
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-6">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label={t('withdrawCheckIn.close')} />
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">
        <header className="px-5 py-4 border-b border-slate-200 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
            <Undo2 size={18} />
          </div>
          <div className="flex-1">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{t('withdrawCheckIn.eyebrow')}</p>
            <h2 className="text-base font-bold text-slate-900">{t('withdrawCheckIn.title')}</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 text-slate-500" aria-label={t('withdrawCheckIn.close')}>
            <X size={16} />
          </button>
        </header>

        <div className="p-5 overflow-y-auto space-y-4">
          {error && <p className="text-red-600 bg-red-50 p-2 rounded-lg text-sm">{error}</p>}

          {/* WO search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('withdrawCheckIn.searchPlaceholder')}
              className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Cart list */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-bold text-slate-700">
                {t('withdrawCheckIn.awaitingCount', { count: filtered.length })}
                {selected.size > 0 && <span className="text-blue-600"> · {t('withdrawCheckIn.selectedCount', { count: selected.size })}</span>}
              </span>
              {filtered.length > 0 && (
                <button type="button" onClick={toggleAllFiltered} className="text-[11px] font-bold text-blue-600 hover:underline">
                  {t('withdrawCheckIn.selectAll')}
                </button>
              )}
            </div>
            {loading ? (
              <p className="text-xs text-slate-400 py-4 text-center">{t('withdrawCheckIn.loading')}</p>
            ) : filtered.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">{t('withdrawCheckIn.noneAwaiting')}</p>
            ) : (
              <ul className="space-y-1 max-h-[220px] overflow-auto border border-slate-100 rounded-lg p-1.5">
                {filtered.map(s => {
                  const on = selected.has(s.id);
                  return (
                    <li key={s.id}>
                      <label className={cn(
                        'flex items-center gap-2 rounded-lg px-2 py-1.5 border-2 text-xs cursor-pointer transition-colors',
                        on ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-blue-300',
                      )}>
                        <input type="checkbox" checked={on} onChange={() => toggle(s.id)} className="accent-blue-600" />
                        <span className="font-mono font-bold text-slate-900">{s.sub_lot_code}</span>
                        <span className="text-slate-400">·</span>
                        <span className="text-slate-500 truncate">{t('withdrawCheckIn.woLabel', { wo: woOf(s) || '—' })}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Reason */}
          <div>
            <p className="text-xs font-bold text-slate-700 mb-1.5">
              {t('withdrawCheckIn.reasonTitle')} <span className="text-red-600">*</span>
            </p>
            <div className="space-y-1.5">
              {REASONS.map(r => (
                <label key={r.value} className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-2 border-2 text-sm cursor-pointer transition-colors',
                  reason === r.value ? 'border-amber-500 bg-amber-50' : 'border-slate-200 hover:border-amber-300',
                )}>
                  <input type="radio" name="withdraw-reason" checked={reason === r.value} onChange={() => setReason(r.value)} className="accent-amber-600" />
                  <span className="font-medium text-slate-800">{t(r.labelKey)}</span>
                </label>
              ))}
            </div>
            {noteRequired && (
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder={t('withdrawCheckIn.notePlaceholder')}
                className="mt-2 w-full border border-amber-300 bg-amber-50/40 rounded-lg px-3 py-2 text-sm min-h-[54px] focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            )}
          </div>
        </div>

        <footer className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2 bg-slate-50 rounded-b-2xl">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-100">
            {t('withdrawCheckIn.cancel')}
          </button>
          <button
            type="button"
            onClick={handleWithdraw}
            disabled={!canSubmit}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors',
              armed ? 'bg-red-600 hover:bg-red-500' : 'bg-amber-600 hover:bg-amber-500',
            )}
          >
            {armed ? <AlertTriangle size={13} /> : <Undo2 size={13} />}
            {busy
              ? t('withdrawCheckIn.withdrawing')
              : armed
                ? t('withdrawCheckIn.confirmWithdraw', { count: selected.size })
                : t('withdrawCheckIn.withdrawBtn', { count: selected.size })}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

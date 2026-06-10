import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ArrowRightLeft, AlertTriangle } from 'lucide-react';
import { moveSubLotsDryer, MoveDryerResult, SubLot } from '../../../services/qcApi';

interface Props {
  open: boolean;
  selectedSubLots: SubLot[];   // must all be in 'drying'
  currentDryer: number;
  onClose: () => void;
  onSuccess: (result: MoveDryerResult) => void;
}

/** All dryers 1..5 except the current one. */
const ALL_DRYERS = [1, 2, 3, 4, 5];

export function MoveDryerDialog({
  open, selectedSubLots, currentDryer, onClose, onSuccess,
}: Props) {
  const { t } = useTranslation('qc');
  const otherDryers = ALL_DRYERS.filter(d => d !== currentDryer);
  const [target, setTarget] = useState<number | null>(otherDryers[0] ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setTarget(otherDryers[0] ?? null);
      setError('');
    }
  }, [open, currentDryer]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const count = selectedSubLots.length;

  const confirm = async () => {
    if (target == null || count === 0 || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await moveSubLotsDryer({
        sub_lot_ids: selectedSubLots.map(s => s.id),
        new_dryer_number: target,
      });
      setBusy(false);
      onSuccess(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('moveDryerDialog.moveFailed'));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-label={t('moveDryerDialog.close')}
      />
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl">
        <header className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center">
              <ArrowRightLeft size={18} />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{t('moveDryerDialog.title')}</p>
              <h2 className="text-base font-bold text-slate-900">{t('moveDryerDialog.subtitle', { count, dryer: currentDryer })}</h2>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100" aria-label={t('moveDryerDialog.close')}>
            <X size={16} />
          </button>
        </header>

        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-slate-500">
            {t('moveDryerDialog.descriptionBefore')}<code className="font-mono">drying</code>{t('moveDryerDialog.descriptionAfter')}
          </p>
          <div className="grid grid-cols-4 gap-2">
            {otherDryers.map(d => (
              <button
                key={d}
                type="button"
                onClick={() => setTarget(d)}
                className={
                  target === d
                    ? 'rounded-lg border-2 border-indigo-500 bg-indigo-50 px-3 py-3 text-sm font-bold text-indigo-900'
                    : 'rounded-lg border-2 border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-700 hover:border-indigo-300'
                }
              >
                {t('moveDryerDialog.dryerOption', { n: d })}
              </button>
            ))}
          </div>

          {error && (
            <p className="text-xs bg-red-50 border border-red-100 text-red-700 rounded p-2 flex gap-1.5 items-start">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {error}
            </p>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2 bg-slate-50 rounded-b-2xl">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-bold border border-slate-300 text-slate-700 hover:bg-white"
          >
            {t('moveDryerDialog.cancel')}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy || count === 0 || target == null}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ArrowRightLeft size={13} />
            {busy ? t('moveDryerDialog.moving') : t('moveDryerDialog.moveTo', { n: target ?? '?' })}
          </button>
        </footer>
      </div>
    </div>
  );
}

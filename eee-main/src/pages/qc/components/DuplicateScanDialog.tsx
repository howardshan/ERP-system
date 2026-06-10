import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, X } from 'lucide-react';
import { warnBeep } from '../../../lib/audio';

interface Props {
  open: boolean;
  subLotCode: string;
  /** Where the user is on the screen — "selection list" / "in dryer" / etc.
   *  Just a friendly hint for the operator. */
  contextLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Shown when the same sub-lot code is scanned twice in the current check-in
 * session (BR-Q34). Plays an audible double-beep on mount and requires the
 * operator to either dismiss or explicitly confirm before continuing.
 */
export function DuplicateScanDialog({
  open, subLotCode, contextLabel, onConfirm, onCancel,
}: Props) {
  const { t } = useTranslation('qc');
  useEffect(() => {
    if (open) warnBeep();
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        onClick={onCancel}
        aria-label={t('duplicateScanDialog.close')}
      />
      <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl border-2 border-amber-300">
        <header className="px-5 py-4 border-b border-amber-200 flex items-center justify-between bg-amber-50 rounded-t-2xl">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-amber-200 text-amber-800 flex items-center justify-center">
              <AlertTriangle size={18} />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-amber-700 font-bold">
                {t('duplicateScanDialog.eyebrow')}
              </p>
              <h2 className="text-base font-bold text-amber-900">{t('duplicateScanDialog.title')}</h2>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-1 rounded hover:bg-amber-100"
            aria-label={t('duplicateScanDialog.dismiss')}
          >
            <X size={16} />
          </button>
        </header>

        <div className="px-5 py-4 space-y-2">
          <p className="text-sm text-slate-700">
            {t('duplicateScanDialog.alreadyScanned')}{contextLabel ? ` (${contextLabel})` : ''}:
          </p>
          <p className="text-center font-mono font-bold text-lg text-slate-900 bg-slate-50 border border-slate-200 rounded-lg py-2">
            {subLotCode}
          </p>
          <p className="text-xs text-slate-500">
            {t('duplicateScanDialog.helpText')}
          </p>
        </div>

        <footer className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2 bg-slate-50 rounded-b-2xl">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-xs font-bold border border-slate-300 text-slate-700 hover:bg-white"
          >
            {t('duplicateScanDialog.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white"
            autoFocus
          >
            {t('duplicateScanDialog.confirm')}
          </button>
        </footer>
      </div>
    </div>
  );
}

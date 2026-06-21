import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';

interface Props {
  open: boolean;
  message: string;
  title?: string;
  onClose: () => void;
}

/**
 * Standalone error popup. Sits above the standard z-50 dialogs (z-[60]) so it can
 * surface a blocking error (e.g. over-capacity) on top of the dialog that raised
 * it, leaving that dialog open underneath for the operator to re-select.
 */
export function ErrorDialog({ open, message, title, onClose }: Props) {
  const { t } = useTranslation('qc');
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-label={t('errorDialog.ok')}
      />
      <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl">
        <header className="px-5 py-4 flex items-center gap-2.5 border-b border-slate-200">
          <div className="w-9 h-9 rounded-lg bg-red-100 text-red-600 flex items-center justify-center shrink-0">
            <AlertTriangle size={18} />
          </div>
          <h2 className="text-base font-bold text-slate-900">{title ?? t('errorDialog.title')}</h2>
        </header>
        <div className="px-5 py-4">
          <p className="text-sm text-slate-700 leading-relaxed">{message}</p>
        </div>
        <footer className="px-5 py-3 border-t border-slate-200 flex justify-end bg-slate-50 rounded-b-2xl">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-lg text-xs font-bold bg-red-600 hover:bg-red-500 text-white"
          >
            {t('errorDialog.ok')}
          </button>
        </footer>
      </div>
    </div>
  );
}

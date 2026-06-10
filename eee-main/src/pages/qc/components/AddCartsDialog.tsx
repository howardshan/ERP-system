import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Plus, CheckCircle2 } from 'lucide-react';
import { addSubLotsToLot, AddSubLotsResult } from '../../../services/qcApi';

interface Props {
  open: boolean;
  lotId: string;
  lotBarcode: string;
  existingMaxSeq: number;        // highest -NNN suffix already present in this lot
  onClose: () => void;
  onSuccess: (result: AddSubLotsResult) => void;
}

export function AddCartsDialog({
  open, lotId, lotBarcode, existingMaxSeq, onClose, onSuccess,
}: Props) {
  const { t } = useTranslation('qc');
  const defaultStart = (existingMaxSeq || 0) + 1;
  const [startSeq, setStartSeq] = useState<string>(String(defaultStart));
  const [endSeq, setEndSeq] = useState<string>(String(defaultStart));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setStartSeq(String(defaultStart));
      setEndSeq(String(defaultStart));
      setError('');
    }
  }, [open, defaultStart]);

  const startN = Math.max(1, parseInt(startSeq, 10) || 0);
  const endN = Math.max(startN, parseInt(endSeq, 10) || 0);
  const count = useMemo(() => Math.max(0, endN - startN + 1), [startN, endN]);

  if (!open) return null;

  const confirm = async () => {
    if (busy || count === 0) return;
    setBusy(true);
    setError('');
    try {
      const result = await addSubLotsToLot({
        production_lot_id: lotId,
        start_seq: startN,
        end_seq: endN,
      });
      onSuccess(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('addCartsDialog.addFailed'));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-label={t('addCartsDialog.close')}
      />
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl">
        <header className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
              <Plus size={18} />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{t('addCartsDialog.addCarts')}</p>
              <h2 className="text-base font-bold text-slate-900 font-mono">{lotBarcode}</h2>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100" aria-label={t('addCartsDialog.close')}>
            <X size={16} />
          </button>
        </header>

        <div className="px-5 py-4 space-y-4">
          <p className="text-xs text-slate-500">
            {t('addCartsDialog.continueSequence')}{' '}
            <code className="font-mono">{`${lotBarcode}-NNN`}</code>. {t('addCartsDialog.highestExisting')}{' '}
            <strong>{existingMaxSeq > 0 ? String(existingMaxSeq).padStart(3, '0') : '—'}</strong>
          </p>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-700">{t('addCartsDialog.firstCartNumber')}</span>
              <input
                type="number"
                min={1}
                step={1}
                value={startSeq}
                onChange={(e) => setStartSeq(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-mono"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700">{t('addCartsDialog.lastCartNumber')}</span>
              <input
                type="number"
                min={startN}
                step={1}
                value={endSeq}
                onChange={(e) => setEndSeq(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-mono"
              />
            </label>
          </div>

          {count > 0 && (
            <div className="text-xs bg-blue-50 border border-blue-100 text-blue-900 rounded p-2">
              {t('addCartsDialog.willCreate')} <strong>{count}</strong> {t('addCartsDialog.cartsColon')}{' '}
              <code className="font-mono">{`${lotBarcode}-${String(startN).padStart(3, '0')}`}</code>
              {' … '}
              <code className="font-mono">{`${lotBarcode}-${String(endN).padStart(3, '0')}`}</code>
            </div>
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
            {t('addCartsDialog.cancel')}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy || count === 0}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <CheckCircle2 size={13} />
            {busy ? t('addCartsDialog.adding') : t('addCartsDialog.addCount', { count })}
          </button>
        </footer>
      </div>
    </div>
  );
}

import React, { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, AlertTriangle, Boxes, Thermometer, RotateCcw } from 'lucide-react';
import { createDispositionGroup, DispositionType } from '../../../services/qcApi';
import { cn } from '../../../lib/utils';

interface Props {
  open: boolean;
  subLot: {
    id: string;
    sub_lot_code: string;
    sku_name?: string | null;
    expected_dry_minutes?: number | null;
    hold_reason?: string | null;
  } | null;
  /** All sub-lot IDs to dispose (group or solo). If omitted, falls back to [subLot.id]. */
  subLotIds?: string[];
  /** Human-readable codes shown in the dialog. If omitted, falls back to [subLot.sub_lot_code]. */
  subLotCodes?: string[];
  /**
   * The cart that drove the group's current result (the existing champion).
   * When provided, "Retest" is dispatched on this cart so M-106's normalisation
   * keeps the original champion in place — otherwise it would shift to the
   * lowest-numbered cart in the group. Omitted for solo carts.
   */
  championSubLotId?: string;
  permissions: {
    redry: boolean;
    room_temp: boolean;
    retest: boolean;
    scrap: boolean;
  };
  onClose: () => void;
  onDisposed: () => void;
}

interface OptionDef {
  value: DispositionType;
  labelKey: string;
  descKey: string;
  icon: React.ElementType;
  accent: string;       // tailwind color name fragment
  permKey: keyof Props['permissions'];
}

const OPTIONS: OptionDef[] = [
  {
    value: 'redry_dryer',
    labelKey: 'disposeDialog.option.redry.label',
    descKey: 'disposeDialog.option.redry.description',
    icon: Boxes,
    accent: 'amber',
    permKey: 'redry',
  },
  {
    value: 'room_temp_dry',
    labelKey: 'disposeDialog.option.roomTemp.label',
    descKey: 'disposeDialog.option.roomTemp.description',
    icon: Thermometer,
    accent: 'orange',
    permKey: 'room_temp',
  },
  {
    value: 'retest',
    labelKey: 'disposeDialog.option.retest.label',
    descKey: 'disposeDialog.option.retest.description',
    icon: RotateCcw,
    accent: 'blue',
    permKey: 'retest',
  },
  // 'scrap' option removed per operator request (the option key + i18n strings
  // are retained server-side and in the translation files in case it needs to
  // be re-enabled later).
];

export function DisposeDialog({ open, subLot, subLotIds, subLotCodes, championSubLotId, permissions, onClose, onDisposed }: Props) {
  const { t } = useTranslation('qc');
  const effectiveIds   = subLotIds   ?? (subLot ? [subLot.id] : []);
  const effectiveCodes = subLotCodes ?? (subLot ? [subLot.sub_lot_code] : []);
  const [type, setType] = useState<DispositionType>('retest');
  const [remark, setRemark] = useState('');
  // UI uses hours; we convert to minutes when submitting
  const [redryHours, setRedryHours] = useState<string>(
    String(Math.round((subLot?.expected_dry_minutes ?? 240) / 60 * 10) / 10),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Reset when sub-lot changes / dialog re-opens
  React.useEffect(() => {
    if (open) {
      setError('');
      setRemark('');
      setRedryHours(String(Math.round((subLot?.expected_dry_minutes ?? 240) / 60 * 10) / 10));
      // Default to Retest when allowed; else the first option the user can use.
      const preferred = OPTIONS.find(o => o.value === 'retest' && permissions[o.permKey])
        ?? OPTIONS.find(o => permissions[o.permKey]);
      if (preferred) setType(preferred.value);
    }
  }, [open, subLot, permissions]);

  if (!open || !subLot) return null;

  const allowedOptions = OPTIONS.filter(o => permissions[o.permKey]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const hours = type === 'redry_dryer' ? parseFloat(redryHours) : null;
      if (type === 'redry_dryer' && (!hours || hours <= 0)) {
        throw new Error(t('disposeDialog.errors.positiveDryTime'));
      }
      const minutes = hours != null ? Math.round(hours * 60) : null;
      await createDispositionGroup({
        sub_lot_ids: effectiveIds,
        champion_sub_lot_id: championSubLotId,
        type,
        remark: remark || null,
        redry_expected_dry_minutes: minutes,
      });
      onDisposed();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('disposeDialog.errors.disposeFailed'));
    }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-label={t('disposeDialog.close')}
      />
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl">
        <header className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle size={18} className="text-red-600 shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                {t('disposeDialog.headerCount', { count: effectiveCodes.length })}
              </p>
              {effectiveCodes.length === 1 ? (
                <h2 className="text-base font-mono font-bold text-slate-900 truncate">{effectiveCodes[0]}</h2>
              ) : (
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {effectiveCodes.map(c => (
                    <span key={c} className="font-mono text-[11px] font-bold bg-red-100 text-red-800 px-1.5 py-0.5 rounded">
                      {c}
                    </span>
                  ))}
                </div>
              )}
              {subLot.sku_name && (
                <p className="text-[11px] text-slate-500 truncate mt-0.5">{subLot.sku_name}</p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100" aria-label={t('disposeDialog.close')}>
            <X size={16} />
          </button>
        </header>

        <form onSubmit={submit} className="px-5 py-4">
          {subLot.hold_reason && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg p-2 mb-3">
              {subLot.hold_reason}
            </p>
          )}

          <p className="text-xs text-slate-600 mb-2">
            {effectiveCodes.length > 1
              ? t('disposeDialog.pickHandleMany', { count: effectiveCodes.length })
              : t('disposeDialog.pickHandleOne')}
          </p>

          <ul className="space-y-2 mb-3">
            {allowedOptions.map(o => {
              const selected = type === o.value;
              const Icon = o.icon;
              const accentClass: Record<string, string> = {
                amber: 'border-amber-400 bg-amber-50 text-amber-700',
                orange: 'border-orange-400 bg-orange-50 text-orange-700',
                blue: 'border-blue-400 bg-blue-50 text-blue-700',
                red: 'border-red-400 bg-red-50 text-red-700',
              };
              return (
                <li key={o.value}>
                  <label className={cn(
                    'flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors',
                    selected ? accentClass[o.accent] : 'border-slate-200 hover:border-slate-300',
                  )}>
                    <input
                      type="radio"
                      checked={selected}
                      onChange={() => setType(o.value)}
                      className="mt-1 accent-blue-600"
                    />
                    <Icon size={16} className={cn(
                      'mt-0.5 shrink-0',
                      selected ? '' : 'text-slate-400',
                    )} />
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-900">{t(o.labelKey)}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{t(o.descKey)}</div>
                    </div>
                  </label>
                </li>
              );
            })}
            {allowedOptions.length === 0 && (
              <li className="text-xs italic text-slate-500 bg-slate-50 p-3 rounded">
                {t('disposeDialog.noPermission')}
              </li>
            )}
          </ul>

          {type === 'redry_dryer' && (
            <label className="block mb-3">
              <span className="text-xs font-medium text-slate-700">{t('disposeDialog.redryTimeLabel')}</span>
              <div className="relative mt-1">
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={redryHours}
                  onChange={(e) => setRedryHours(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm pr-14"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">{t('disposeDialog.hrsSuffix')}</span>
              </div>
              {parseFloat(redryHours) > 0 && (
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {t('disposeDialog.minutesHint', { minutes: Math.round(parseFloat(redryHours) * 60) })}
                </p>
              )}
            </label>
          )}

          <label className="block mb-3">
            <span className="text-xs font-medium text-slate-700">{t('disposeDialog.remarkLabel')}</span>
            <textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm min-h-[56px]"
              placeholder={t('disposeDialog.remarkPlaceholder')}
            />
          </label>

          {error && (
            <p className="text-red-600 text-xs bg-red-50 border border-red-100 rounded p-2 mb-3">{error}</p>
          )}

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-bold border border-slate-300 text-slate-700 hover:bg-slate-50"
            >
              {t('disposeDialog.cancel')}
            </button>
            <button
              type="submit"
              disabled={busy || allowedOptions.length === 0}
              className="px-4 py-2 rounded-lg text-xs font-bold bg-red-600 hover:bg-red-500 text-white disabled:opacity-50"
            >
              {busy ? t('disposeDialog.submitting') : t('disposeDialog.confirm')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

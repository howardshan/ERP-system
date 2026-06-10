import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Plus } from 'lucide-react';
import {
  productionLotDetail,
  listLocations,
  checkInSubLot,
  checkOutSubLot,
  checkOutSubLotsBulk,
  formatQcDateTime,
  toLocalInputValue,
  ProductionLotDetail,
  DryingLocation,
  SubLot,
} from '../../services/qcApi';
import { usePermissions } from '../../contexts/PermissionContext';
import { QcStatusBadge } from './components/QcStatusBadge';
import { SelectAllCheckbox } from './components/SelectAllCheckbox';
import { AddCartsDialog } from './components/AddCartsDialog';
import { cn, fmtDays } from '../../lib/utils';

interface Props {
  lotId: string;
  onBack: () => void;
  onInspectSubLot: (subLotId: string) => void;
}

export default function LotDetail({ lotId, onBack, onInspectSubLot }: Props) {
  const { t } = useTranslation('qc');
  const { can } = usePermissions();
  const canCheckIn = can('qc', 'dry_rooms', 'check_in');
  const canCheckOut = can('qc', 'dry_rooms', 'check_out');
  const canInspect = can('qc', 'testing', 'submit_inspection');

  const [detail, setDetail] = useState<ProductionLotDetail | null>(null);
  const [locations, setLocations] = useState<DryingLocation[]>([]);
  const [locationId, setLocationId] = useState('');
  const [inTimeLocal, setInTimeLocal] = useState(toLocalInputValue());
  const [outTimeLocal, setOutTimeLocal] = useState(toLocalInputValue());
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [addCartsOpen, setAddCartsOpen] = useState(false);
  const canCreateBatch = can('production', 'work_orders', 'create');

  const load = () =>
    productionLotDetail(lotId)
      .then(setDetail)
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
    listLocations().then((locs) => {
      setLocations(locs);
      if (locs[0]) setLocationId(locs[0].id);
    });
  }, [lotId]);

  const checkIn = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await checkInSubLot({
        production_lot_id: lotId,
        location_id: locationId || null,
        in_time: new Date(inTimeLocal).toISOString(),
      });
      setMsg(t('lotDetail.checkedInMsg'));
      setInTimeLocal(toLocalInputValue());
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('lotDetail.checkInFailed'));
    }
  };

  const checkOut = async (sub: SubLot) => {
    setError('');
    try {
      await checkOutSubLot(sub.id, new Date(outTimeLocal).toISOString());
      setMsg(t('lotDetail.checkedOutMsg', { code: sub.sub_lot_code }));
      setOutTimeLocal(toLocalInputValue());
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('lotDetail.checkOutFailed'));
    }
  };

  const dryingSubLots = (detail?.sub_lots ?? []).filter(s => s.status === 'drying');

  // Highest 3-digit suffix in existing sub-lot codes — defaults Add-carts dialog
  // start_seq to existingMax + 1 so users continue the sequence (BR-Q30).
  const existingMaxSeq = useMemo(() => {
    const re = /-(\d{3})$/;
    let max = 0;
    for (const s of detail?.sub_lots ?? []) {
      const m = s.sub_lot_code.match(re);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
    return max;
  }, [detail?.sub_lots]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (selected.size === dryingSubLots.length) setSelected(new Set());
    else setSelected(new Set(dryingSubLots.map(s => s.id)));
  };
  const bulkCheckOut = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    setError('');
    try {
      const result = await checkOutSubLotsBulk({
        sub_lot_ids: [...selected],
        out_time: new Date(outTimeLocal).toISOString(),
      });
      const groupCount = result.groups?.length ?? 0;
      setMsg(t('lotDetail.bulkCheckedOutMsg', { count: result.succeeded?.length ?? selected.size, groups: groupCount }));
      setSelected(new Set());
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('lotDetail.bulkCheckOutFailed'));
    }
    setBusy(false);
  };

  if (!detail) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <button onClick={onBack} className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-900 mb-4">
          <ArrowLeft size={14} /> {t('lotDetail.backToDryRooms')}
        </button>
        {error ? <p className="text-red-600 text-sm">{error}</p> : <p className="text-slate-400 text-sm">{t('lotDetail.loading')}</p>}
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <button onClick={onBack} className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-900 mb-4">
        <ArrowLeft size={14} /> {t('lotDetail.backToLots')}
      </button>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{detail.lot.lot_number}</h1>
          <p className="text-slate-600 mt-1 text-sm">
            {detail.lot.sku_name} · {detail.lot.lot_barcode}
            {' · '}
            <span className="font-mono">{t('lotDetail.expectedDry')} {fmtDays(detail.lot.expected_dry_minutes)}</span>
          </p>
        </div>
        {canCreateBatch && (
          <button
            type="button"
            onClick={() => setAddCartsOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white"
          >
            <Plus size={12} /> {t('lotDetail.addCarts')}
          </button>
        )}
      </div>

      {msg && <p className="text-emerald-700 bg-emerald-50 p-2 rounded-lg my-3 text-sm">{msg}</p>}
      {error && <p className="text-red-600 my-3 text-sm">{error}</p>}

      {canCheckIn && (
        <form onSubmit={checkIn} className="bg-white rounded-xl border p-4 mb-6 mt-4 space-y-3">
          <h2 className="font-semibold text-slate-900 text-sm">{t('lotDetail.checkInTitle')}</h2>
          <label className="block">
            <span className="text-xs font-medium text-slate-700">{t('lotDetail.dryerLocation')}</span>
            <select
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">{t('lotDetail.none')}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.display_name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-700">{t('lotDetail.checkInTime')}</span>
            <input
              type="datetime-local"
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              value={inTimeLocal}
              onChange={(e) => setInTimeLocal(e.target.value)}
            />
          </label>
          <button type="submit" className="w-full bg-sky-600 hover:bg-sky-500 text-white py-2 rounded-lg text-sm font-medium">
            {t('lotDetail.confirmCheckIn')}
          </button>
        </form>
      )}

      <h2 className="font-semibold mb-2 text-slate-900 text-sm">{t('lotDetail.dryingSubLots')}</h2>

      {dryingSubLots.length > 0 && canCheckOut && (
        <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-3">
          <SelectAllCheckbox
            total={dryingSubLots.length}
            selected={selected.size}
            onToggleAll={toggleSelectAll}
            label={t('lotDetail.selectAllDrying')}
          />
          {selected.size > 0 && (
            <div className="flex items-center gap-2">
              <input
                type="datetime-local"
                className="border rounded-lg px-2 py-1 text-xs"
                value={outTimeLocal}
                onChange={(e) => setOutTimeLocal(e.target.value)}
              />
              <button
                type="button"
                onClick={bulkCheckOut}
                disabled={busy}
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50"
              >
                {t('lotDetail.checkOutCount', { count: selected.size })}
              </button>
            </div>
          )}
        </div>
      )}

      <ul className="space-y-3">
        {detail.sub_lots.map((s) => {
          const isDrying = s.status === 'drying';
          const isPendingOrInspecting = s.status === 'pending' || s.status === 'inspecting';
          const checked = selected.has(s.id);
          return (
            <li key={s.id} className={cn('bg-white rounded-xl border p-4 space-y-2', checked && 'border-blue-400 bg-blue-50/40')}>
              <div className="flex justify-between items-start gap-2">
                <div className="flex items-center gap-3">
                  {isDrying && canCheckOut && (
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelect(s.id)}
                      className="w-4 h-4 rounded accent-blue-600"
                    />
                  )}
                  <div className="font-medium text-base text-slate-900">{s.sub_lot_code}</div>
                </div>
                <QcStatusBadge status={s.status} />
              </div>
              <div className="text-xs text-slate-600 grid sm:grid-cols-2 gap-1">
                <p>{t('lotDetail.location')}: {s.location_name || '—'}</p>
                <p>{t('lotDetail.in')}: {formatQcDateTime(s.in_time)}</p>
                <p>{t('lotDetail.out')}: {formatQcDateTime(s.out_time)}</p>
                {s.wait_minutes != null && <p className="text-amber-800">{t('lotDetail.wait')}: {fmtDays(s.wait_minutes)}</p>}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {isDrying && canCheckOut && (
                  <div className="w-full space-y-2 pt-1 border-t border-slate-100">
                    <label className="block text-xs">
                      <span className="font-medium text-slate-700">{t('lotDetail.checkOutTime')}</span>
                      <input
                        type="datetime-local"
                        className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                        value={outTimeLocal}
                        onChange={(e) => setOutTimeLocal(e.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => checkOut(s)}
                      className="w-full bg-amber-600 hover:bg-amber-500 text-white py-2 rounded-lg text-sm font-medium"
                    >
                      {t('lotDetail.checkOutToPending')}
                    </button>
                  </div>
                )}
                {isPendingOrInspecting && canInspect && (
                  <button
                    type="button"
                    onClick={() => onInspectSubLot(s.id)}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg text-sm font-medium"
                  >
                    {t('lotDetail.inspect')}
                  </button>
                )}
              </div>
            </li>
          );
        })}
        {detail.sub_lots.length === 0 && <p className="text-slate-500 text-sm">{t('lotDetail.noSubLots')}</p>}
      </ul>

      <AddCartsDialog
        open={addCartsOpen}
        lotId={detail.lot.id}
        lotBarcode={detail.lot.lot_barcode}
        existingMaxSeq={existingMaxSeq}
        onClose={() => setAddCartsOpen(false)}
        onSuccess={(result) => {
          setAddCartsOpen(false);
          setMsg(t('lotDetail.addedCartsMsg', { count: result.added_count, start: result.start_seq, end: result.end_seq }));
          load();
        }}
      />
    </div>
  );
}

import React, { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, CheckCircle2, Clock, LogOut, Move, X, AlertTriangle, RotateCcw, QrCode } from 'lucide-react';
import {
  listAwaitingCheckIn,
  listAwaitingRecheck,
  listLocations,
  listSubLotsByDryer,
  registerInDryer,
  checkOutSubLot,
  moveSubLot,
  formatQcDateTime,
  scanCartForCheckIn,
  SubLot,
  DryingLocation,
} from '../../services/qcApi';
import { usePermissions } from '../../contexts/PermissionContext';
import { QcStatusBadge } from './components/QcStatusBadge';
import { ScanQrDialog } from './components/ScanQrDialog';
import { DryRoomListMode } from './components/DryRoomListMode';
import { useQcSpotSelectionEnabled } from './hooks/useQcSpotSelectionEnabled';
import { PermissionDenied } from './components/PermissionDenied';
import { cn } from '../../lib/utils';

interface Props {
  dryerNumber: number;
  onBack: () => void;
  onCheckedOut?: (subLotId: string) => void;
  onOpenHistory?: (subLotId: string) => void;
}

function fmtMin(mins: number | null): string {
  if (mins == null) return '—';
  const sign = mins < 0 ? '-' : '';
  const abs = Math.abs(Math.round(mins));
  if (abs < 60) return `${sign}${abs}m`;
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m === 0 ? `${sign}${h}h` : `${sign}${h}h ${m}m`;
}

// Source of truth for remaining minutes (uses backend-derived value, updated on tick)
function liveRemaining(s: SubLot): number | null {
  if (s.status !== 'drying') return s.remaining_minutes;
  if (s.expected_finish_at) {
    return (new Date(s.expected_finish_at).getTime() - Date.now()) / 60_000;
  }
  return s.remaining_minutes;
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'place'; subLotId: string; source: 'created' | 'recheck' }
  | { kind: 'move'; subLotId: string; fromCell: number };

export default function DryRoomDetail({ dryerNumber, onBack, onCheckedOut, onOpenHistory }: Props) {
  const { t } = useTranslation('qc');
  const { can } = usePermissions();
  const canView = can('qc', 'dry_rooms', 'view_status');
  const canCheckIn = can('qc', 'dry_rooms', 'check_in');
  const canCheckOut = can('qc', 'dry_rooms', 'check_out');
  const canMove = can('qc', 'dry_rooms', 'move');
  const { enabled: spotSelectionEnabled } = useQcSpotSelectionEnabled();

  const [, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const [awaiting, setAwaiting] = useState<SubLot[]>([]);
  const [awaitingRecheck, setAwaitingRecheck] = useState<SubLot[]>([]);
  const [inDryer, setInDryer] = useState<SubLot[]>([]);
  const [locations, setLocations] = useState<DryingLocation[]>([]);
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [openCell, setOpenCell] = useState<number | null>(null);   // cell whose detail panel is open
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [pendingDisplace, setPendingDisplace] = useState<null | { targetCell: number; targetLoc: DryingLocation; occupant: SubLot }>(null);
  const [scanOpen, setScanOpen] = useState(false);
  // After scanning a drying cart in THIS dryer, prompt the operator to
  // check it out immediately instead of just popping the cell-detail card.
  const [scanCheckOutConfirm, setScanCheckOutConfirm] = useState<SubLot | null>(null);

  const load = async () => {
    try {
      const [aw, awR, drying, locs] = await Promise.all([
        listAwaitingCheckIn(),
        listAwaitingRecheck(),
        listSubLotsByDryer(dryerNumber),
        listLocations(),
      ]);
      setAwaiting(aw);
      setAwaitingRecheck(awR);
      setInDryer(drying);
      setLocations(locs);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dryRoomDetail.loadFailed'));
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dryerNumber]);

  const cellSubLot = useMemo(() => {
    const m = new Map<number, SubLot>();
    for (const s of inDryer) if (s.cell_number != null) m.set(s.cell_number, s);
    return m;
  }, [inDryer]);

  const cellLocation = useMemo(() => {
    const m = new Map<number, DryingLocation>();
    for (const loc of locations) {
      if (loc.dryer_number === dryerNumber && loc.cell_number != null) m.set(loc.cell_number, loc);
    }
    return m;
  }, [locations, dryerNumber]);

  const openSubLot = openCell != null ? cellSubLot.get(openCell) ?? null : null;

  // ── Cell click dispatch ─────────────────────────────────────────────────
  const handleCellClick = async (cell: number) => {
    const occupant = cellSubLot.get(cell);
    const loc = cellLocation.get(cell);
    if (!loc) return;
    setError('');

    // PLACE MODE: register awaiting/recheck cart at empty cell
    if (mode.kind === 'place') {
      if (occupant) {
        setError(t('dryRoomDetail.cellOccupied'));
        return;
      }
      setBusy(true);
      try {
        await registerInDryer({ sub_lot_id: mode.subLotId, location_id: loc.id });
        setMsg(t('dryRoomDetail.placedAtCell', { cell: String(cell).padStart(2, '0') }));
        setMode({ kind: 'idle' });
        load();
      } catch (e) {
        setError(e instanceof Error ? e.message : t('dryRoomDetail.placementFailed'));
      }
      setBusy(false);
      return;
    }

    // MOVE MODE: move a drying cart to this cell
    if (mode.kind === 'move') {
      if (cell === mode.fromCell) {
        setMode({ kind: 'idle' });
        return;
      }
      if (occupant) {
        // confirm displace
        setPendingDisplace({ targetCell: cell, targetLoc: loc, occupant });
        return;
      }
      await doMove(mode.subLotId, loc.id, cell);
      return;
    }

    // IDLE MODE: clicking occupied cell opens detail panel
    if (occupant) {
      setOpenCell(openCell === cell ? null : cell);
    }
  };

  const doMove = async (subLotId: string, newLocationId: string, newCell: number) => {
    setBusy(true);
    setError('');
    try {
      await moveSubLot({ sub_lot_id: subLotId, new_location_id: newLocationId });
      setMsg(t('dryRoomDetail.movedToCell', { cell: String(newCell).padStart(2, '0') }));
      setMode({ kind: 'idle' });
      setOpenCell(null);
      setPendingDisplace(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dryRoomDetail.moveFailed'));
    }
    setBusy(false);
  };

  const handleCheckOut = async (s: SubLot) => {
    setBusy(true);
    setError('');
    try {
      await checkOutSubLot(s.id);
      setMsg(t('dryRoomDetail.checkedOut', { code: s.sub_lot_code }));
      setOpenCell(null);
      if (onCheckedOut) onCheckedOut(s.id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dryRoomDetail.checkOutFailed'));
    }
    setBusy(false);
  };

  const startPlaceFromAwaiting = (subLotId: string) => {
    setMode({ kind: 'place', subLotId, source: 'created' });
    setOpenCell(null);
  };
  const startPlaceFromRecheck = (subLotId: string) => {
    setMode({ kind: 'place', subLotId, source: 'recheck' });
    setOpenCell(null);
  };
  const startMove = (s: SubLot) => {
    if (s.cell_number == null) return;
    setMode({ kind: 'move', subLotId: s.id, fromCell: s.cell_number });
    setOpenCell(null);
  };

  // QR scan → decide what to do based on the scanned sub-lot's status & location.
  // M-098: for a freshly-created cart, also stamp scanned_for_check_in_at so
  // it shows up in the side panel's Awaiting list.  Idempotent.
  const handleScanned = async (sl: SubLot) => {
    setScanOpen(false);
    setError('');
    // (a) Not in any dryer yet → enter place mode
    if (sl.status === 'created' || sl.status === 'awaiting_recheck') {
      if (sl.status === 'created') {
        try {
          await scanCartForCheckIn(sl.id);
        } catch (e) {
          setError(e instanceof Error ? e.message : t('dryRoomDetail.registerFailed', { code: sl.sub_lot_code }));
          return;
        }
      }
      setMode({
        kind: 'place',
        subLotId: sl.id,
        source: sl.status === 'awaiting_recheck' ? 'recheck' : 'created',
      });
      setMsg(t('dryRoomDetail.readyToPlace', { code: sl.sub_lot_code }));
      load();
      return;
    }
    // (b) Already in this dryer → ask "Check out now?".  Falls back to the
    //     cell-detail card if the operator dismisses the prompt.
    if (sl.status === 'drying' && sl.dryer_number === dryerNumber && sl.cell_number != null) {
      if (canCheckOut) {
        setScanCheckOutConfirm(sl);
        return;
      }
      setOpenCell(sl.cell_number);
      setMsg(t('dryRoomDetail.showingCell', { cell: String(sl.cell_number).padStart(2, '0'), code: sl.sub_lot_code }));
      return;
    }
    // (c) In a different dryer
    if (sl.status === 'drying' && sl.dryer_number != null && sl.dryer_number !== dryerNumber) {
      setError(t('dryRoomDetail.inOtherDryer', { code: sl.sub_lot_code, dryer: sl.dryer_number, cell: String(sl.cell_number ?? '').padStart(2, '0') }));
      return;
    }
    // (d) Other status (pending / inspecting / passed / hold / room_temp / closed)
    setError(t('dryRoomDetail.noActionForStatus', { code: sl.sub_lot_code, status: sl.status }));
  };

  if (!canView) {
    return <PermissionDenied permission="qc.dry_rooms.view_status" feature={t('dryRoomDetail.feature')} />;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-900 mb-3"
      >
        <ArrowLeft size={14} /> {t('dryRoomDetail.allDryRooms')}
      </button>

      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold text-slate-900">{t('dryRoomDetail.dryerTitle', { number: dryerNumber })}</h1>
          <span className="text-sm text-slate-500">
            {spotSelectionEnabled
              ? t('dryRoomDetail.occupiedCells', { count: inDryer.length })
              : t('dryRoomDetail.occupiedSlots', { count: inDryer.length })}
          </span>
        </div>
        {spotSelectionEnabled && (
          <button
            type="button"
            onClick={() => setScanOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 hover:bg-slate-700 text-white"
            title={t('dryRoomDetail.scanQrTitle')}
          >
            <QrCode size={13} /> {t('dryRoomDetail.scanQr')}
          </button>
        )}
      </div>

      {/* List mode (spot selection disabled) — separate UI; rest below is grid mode */}
      {!spotSelectionEnabled && (
        <DryRoomListMode dryerNumber={dryerNumber} onOpenHistory={onOpenHistory} />
      )}

      {!spotSelectionEnabled ? null : <>
      {msg && (
        <p className="text-emerald-700 bg-emerald-50 p-2 rounded-lg mb-3 text-sm flex items-center gap-2">
          <CheckCircle2 size={14} /> {msg}
        </p>
      )}
      {error && (
        <p className="text-red-600 bg-red-50 p-2 rounded-lg mb-3 text-sm">{error}</p>
      )}

      {/* Mode banner */}
      {mode.kind !== 'idle' && (
        <ModeBanner
          mode={mode}
          subLot={
            mode.kind === 'place'
              ? (mode.source === 'recheck' ? awaitingRecheck : awaiting).find(s => s.id === mode.subLotId) ?? null
              : inDryer.find(s => s.id === mode.subLotId) ?? null
          }
          onCancel={() => setMode({ kind: 'idle' })}
        />
      )}

      <ScanQrDialog
        open={scanOpen}
        dryerNumber={dryerNumber}
        onClose={() => setScanOpen(false)}
        onFound={handleScanned}
      />

      {scanCheckOutConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            onClick={() => setScanCheckOutConfirm(null)}
            aria-label={t('dryRoomDetail.cancel')}
          />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl">
            <header className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
                <QrCode size={18} />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{t('dryRoomDetail.scanCheckOut')}</p>
                <h2 className="text-base font-bold text-slate-900 font-mono">{scanCheckOutConfirm.sub_lot_code}</h2>
              </div>
            </header>
            <div className="px-5 py-4 text-sm text-slate-700">
              {t('dryRoomDetail.currentlyIn')} <strong>{t('dryRoomDetail.dryerLabel', { number: scanCheckOutConfirm.dryer_number })}</strong>
              {scanCheckOutConfirm.cell_number != null && (
                <> · {t('dryRoomDetail.cellLabel')} <strong>{String(scanCheckOutConfirm.cell_number).padStart(2, '0')}</strong></>
              )}
              .  {t('dryRoomDetail.checkOutNowPrompt')}
            </div>
            <footer className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2 bg-slate-50 rounded-b-2xl">
              <button
                type="button"
                onClick={() => {
                  if (scanCheckOutConfirm.cell_number != null) setOpenCell(scanCheckOutConfirm.cell_number);
                  setScanCheckOutConfirm(null);
                }}
                className="px-4 py-2 rounded-lg text-xs font-bold border border-slate-300 text-slate-700 hover:bg-white"
              >
                {t('dryRoomDetail.justShowCell')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  const target = scanCheckOutConfirm;
                  setScanCheckOutConfirm(null);
                  await handleCheckOut(target);
                }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40"
              >
                {t('dryRoomDetail.checkOut')}
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* Confirm-displace dialog */}
      {pendingDisplace && mode.kind === 'move' && (
        <DisplaceConfirmCard
          target={pendingDisplace}
          mover={inDryer.find(s => s.id === mode.subLotId) ?? null}
          onCancel={() => setPendingDisplace(null)}
          onConfirm={() => doMove(mode.subLotId, pendingDisplace.targetLoc.id, pendingDisplace.targetCell)}
          busy={busy}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5">
        {/* ── Left: grid ─────────────────────────────────────────────── */}
        <section className="bg-white border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-slate-900 text-sm">{t('dryRoomDetail.occupancyGrid')}</h2>
            <Legend />
          </div>
          <div className="grid grid-cols-10 gap-1 max-w-[640px] mx-auto">
            {Array.from({ length: 100 }).map((_, cell) => {
              const occupant = cellSubLot.get(cell);
              const loc = cellLocation.get(cell);
              const remaining = occupant ? liveRemaining(occupant) : null;
              const overdue = remaining != null && remaining < 0;
              const cellLabel = String(cell).padStart(2, '0');
              const isOpen = openCell === cell;
              const isMoveSource = mode.kind === 'move' && mode.fromCell === cell;

              const cls = !loc
                ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                : isMoveSource
                  ? 'bg-blue-200 text-blue-900 border-blue-500 ring-2 ring-blue-400 animate-pulse cursor-pointer'
                  : occupant
                    ? isOpen
                      ? 'bg-amber-200 text-amber-900 border-amber-500 ring-2 ring-amber-400 cursor-pointer'
                      : overdue
                        ? 'bg-red-200 text-red-900 border-red-400 cursor-pointer hover:ring-2 hover:ring-red-300'
                        : 'bg-amber-100 text-amber-900 border-amber-300 cursor-pointer hover:ring-2 hover:ring-amber-300'
                    : mode.kind === 'place' || mode.kind === 'move'
                      ? 'bg-emerald-50 hover:bg-emerald-200 text-emerald-900 border-emerald-200 cursor-pointer'
                      : 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed';

              return (
                <button
                  key={cell}
                  type="button"
                  disabled={!loc || busy || (mode.kind === 'idle' && !occupant)}
                  onClick={() => handleCellClick(cell)}
                  title={occupant
                    ? `${occupant.sub_lot_code} · ${occupant.sku_name ?? ''} · in ${formatQcDateTime(occupant.in_time)}`
                    : loc?.code}
                  className={cn(
                    'aspect-square rounded text-[9px] font-mono font-bold flex flex-col items-center justify-center transition-colors border relative',
                    cls,
                  )}
                >
                  <span className="leading-none">{cellLabel}</span>
                  {occupant && (
                    <span className="leading-none mt-0.5 text-[8px] font-normal opacity-80">
                      {fmtMin(remaining)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* ── Right column ────────────────────────────────────────────── */}
        <aside className="space-y-3">
          {/* Open cell detail (priority panel) */}
          {openSubLot && (
            <CellDetailCard
              s={openSubLot}
              onClose={() => setOpenCell(null)}
              onMove={() => startMove(openSubLot)}
              onCheckOut={() => handleCheckOut(openSubLot)}
              onOpenHistory={onOpenHistory ? () => onOpenHistory(openSubLot.id) : undefined}
              canMove={canMove}
              canCheckOut={canCheckOut}
              busy={busy}
            />
          )}

          {/* Awaiting recheck (displaced, paused) */}
          {awaitingRecheck.length > 0 && (
            <section className="bg-white border-2 border-amber-300 rounded-xl p-3">
              <h2 className="font-semibold text-amber-800 text-sm mb-2 px-1 flex items-center gap-1.5">
                <AlertTriangle size={13} /> {t('dryRoomDetail.awaitingReplacement')}
                <span className="ml-1 text-amber-600 font-normal">({awaitingRecheck.length})</span>
              </h2>
              <ul className="space-y-1.5 max-h-[160px] overflow-auto">
                {awaitingRecheck.map(s => {
                  const selected = mode.kind === 'place' && mode.subLotId === s.id;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => startPlaceFromRecheck(s.id)}
                        disabled={!canCheckIn}
                        className={cn(
                          'w-full text-left rounded-lg px-2.5 py-1.5 border-2 text-xs transition-colors',
                          selected ? 'border-blue-500 bg-blue-50' : 'border-amber-200 hover:border-amber-400 bg-amber-50/30',
                          !canCheckIn && 'opacity-50 cursor-not-allowed',
                        )}
                      >
                        <div className="font-mono font-bold text-slate-900">{s.sub_lot_code}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          {t('dryRoomDetail.driedPaused', { dried: fmtMin(s.total_dried_minutes) })}
                          {s.expected_dry_minutes ? t('dryRoomDetail.targetSuffix', { minutes: s.expected_dry_minutes }) : ''}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Awaiting check-in (new from Production) */}
          <section className="bg-white border rounded-xl p-3">
            <h2 className="font-semibold text-slate-900 text-sm mb-2 px-1">
              {t('dryRoomDetail.awaitingCheckIn')}
              <span className="ml-1 text-slate-400 font-normal">({awaiting.length})</span>
            </h2>
            {awaiting.length === 0 ? (
              <p className="text-xs text-slate-500 px-1">{t('dryRoomDetail.noAwaitingPlacement')}</p>
            ) : (
              <ul className="space-y-1.5 max-h-[160px] overflow-auto">
                {awaiting.map(s => {
                  const selected = mode.kind === 'place' && mode.subLotId === s.id;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => startPlaceFromAwaiting(s.id)}
                        disabled={!canCheckIn}
                        className={cn(
                          'w-full text-left rounded-lg px-2.5 py-1.5 border-2 text-xs transition-colors',
                          selected ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-blue-300 bg-white',
                          !canCheckIn && 'opacity-50 cursor-not-allowed',
                        )}
                      >
                        <div className="font-mono font-bold text-slate-900">{s.sub_lot_code}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          {s.sku_name ?? '—'}
                          {s.expected_dry_minutes ? t('dryRoomDetail.targetSuffixShort', { minutes: s.expected_dry_minutes }) : ''}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Sub-lots in this dryer (sorted) */}
          <section className="bg-white border rounded-xl p-3">
            <h2 className="font-semibold text-slate-900 text-sm mb-2 px-1">
              {t('dryRoomDetail.inThisDryer')}
              <span className="ml-1 text-slate-400 font-normal">({inDryer.length})</span>
            </h2>
            {inDryer.length === 0 ? (
              <p className="text-xs text-slate-500 px-1">{t('dryRoomDetail.empty')}</p>
            ) : (
              <ul className="space-y-2 max-h-[420px] overflow-auto">
                {inDryer.map(s => {
                  const remaining = liveRemaining(s);
                  const overdue = remaining != null && remaining < 0;
                  const ready = s.status === 'drying' && remaining != null && remaining <= 0;
                  return (
                    <li key={s.id} className="border rounded-lg p-2.5 bg-slate-50/40">
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <button
                          type="button"
                          onClick={() => setOpenCell(s.cell_number ?? null)}
                          className="min-w-0 text-left hover:underline"
                        >
                          <div className="font-mono font-bold text-sm text-slate-900">{s.sub_lot_code}</div>
                          <div className="text-[10px] text-slate-500">
                            {t('dryRoomDetail.cellLabel')} {String(s.cell_number ?? '—').padStart(2, '0')} · {s.sku_name ?? ''}
                          </div>
                        </button>
                        <QcStatusBadge status={s.status} />
                      </div>
                      <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] mb-2">
                        <dt className="text-slate-500">{t('dryRoomDetail.checkInLabel')}</dt>
                        <dd className="text-slate-800 font-mono">{formatQcDateTime(s.in_time)}</dd>
                        <dt className="text-slate-500">{t('dryRoomDetail.driedLabel')}</dt>
                        <dd className="text-slate-800 font-mono">{fmtMin(s.total_dried_minutes)}</dd>
                        <dt className="text-slate-500 flex items-center gap-1"><Clock size={9} /> {t('dryRoomDetail.remainingLabel')}</dt>
                        <dd className={cn('font-mono', overdue ? 'text-red-700 font-bold' : 'text-slate-800')}>
                          {fmtMin(remaining)}
                        </dd>
                      </dl>
                      {s.status === 'drying' && canCheckOut && (
                        <button
                          type="button"
                          onClick={() => handleCheckOut(s)}
                          disabled={busy}
                          className={cn(
                            'w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[11px] font-bold transition-colors',
                            ready
                              ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                              : 'bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-300',
                          )}
                        >
                          <LogOut size={11} />
                          {ready ? t('dryRoomDetail.checkOutReady') : t('dryRoomDetail.checkOutEarly')}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>
      </div>
      </>}
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

function ModeBanner({ mode, subLot, onCancel }: { mode: Mode; subLot: SubLot | null; onCancel: () => void }) {
  const { t } = useTranslation('qc');
  if (mode.kind === 'idle') return null;
  const isMove = mode.kind === 'move';
  return (
    <div className={cn(
      'flex items-center gap-3 px-4 py-2 rounded-lg mb-3 text-sm border-2',
      isMove ? 'bg-blue-50 border-blue-300 text-blue-900' : 'bg-emerald-50 border-emerald-300 text-emerald-900',
    )}>
      {isMove ? <Move size={15} /> : <CheckCircle2 size={15} />}
      <span className="flex-1">
        {isMove
          ? <>{t('dryRoomDetail.movingPrefix')} <code className="font-mono font-bold">{subLot?.sub_lot_code ?? '…'}</code> {t('dryRoomDetail.movingSuffix')}</>
          : <>{t('dryRoomDetail.placingPrefix')} <code className="font-mono font-bold">{subLot?.sub_lot_code ?? '…'}</code> {t('dryRoomDetail.placingSuffix')}</>}
      </span>
      <button type="button" onClick={onCancel} className="text-xs font-bold underline">{t('dryRoomDetail.cancel')}</button>
    </div>
  );
}

function CellDetailCard({
  s, onClose, onMove, onCheckOut, onOpenHistory, canMove, canCheckOut, busy,
}: {
  s: SubLot;
  onClose: () => void;
  onMove: () => void;
  onCheckOut: () => void;
  onOpenHistory?: () => void;
  canMove: boolean;
  canCheckOut: boolean;
  busy: boolean;
}) {
  const { t } = useTranslation('qc');
  const remaining = liveRemaining(s);
  const overdue = remaining != null && remaining < 0;
  return (
    <section className="bg-white border-2 border-amber-400 rounded-xl p-4 shadow-md">
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-amber-700 font-bold">{t('dryRoomDetail.cellLabel')} {String(s.cell_number ?? '—').padStart(2, '0')}</p>
          <h2 className="font-mono font-bold text-base text-slate-900">{s.sub_lot_code}</h2>
        </div>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1" aria-label={t('dryRoomDetail.close')}>
          <X size={14} />
        </button>
      </div>

      <dl className="grid grid-cols-[80px_1fr] gap-y-1 text-xs mb-3">
        <dt className="text-slate-500">SKU</dt>
        <dd className="text-slate-900">{s.sku_name ?? '—'}</dd>
        <dt className="text-slate-500">Batch</dt>
        <dd className="text-slate-900 font-mono">{s.lot_number ?? s.lot_barcode ?? '—'}</dd>
        <dt className="text-slate-500">Check-in</dt>
        <dd className="text-slate-900 font-mono">{formatQcDateTime(s.in_time)}</dd>
        <dt className="text-slate-500">Dried</dt>
        <dd className="text-slate-900 font-mono">{fmtMin(s.total_dried_minutes)}</dd>
        <dt className="text-slate-500 flex items-center gap-1"><Clock size={10} /> Remaining</dt>
        <dd className={cn('font-mono font-bold', overdue ? 'text-red-700' : 'text-slate-900')}>{fmtMin(remaining)}</dd>
      </dl>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={!canMove || busy}
          onClick={onMove}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Move size={12} /> Move to other spot
        </button>
        <button
          type="button"
          disabled={!canCheckOut || busy}
          onClick={onCheckOut}
          className={cn(
            'flex items-center justify-center gap-1.5 px-3 py-2 rounded text-xs font-bold transition-colors',
            overdue
              ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
              : 'bg-amber-500 hover:bg-amber-400 text-white',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
        >
          <LogOut size={12} /> Check out
        </button>
      </div>
      {onOpenHistory && (
        <button
          type="button"
          onClick={onOpenHistory}
          className="mt-2 w-full text-[11px] font-bold text-slate-500 hover:text-blue-700 underline"
        >
          View full history
        </button>
      )}
    </section>
  );
}

function DisplaceConfirmCard({
  target, mover, onCancel, onConfirm, busy,
}: {
  target: { targetCell: number; targetLoc: DryingLocation; occupant: SubLot };
  mover: SubLot | null;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  return (
    <div className="bg-amber-50 border-2 border-amber-400 rounded-xl p-4 mb-3">
      <div className="flex items-start gap-2">
        <RotateCcw size={16} className="text-amber-700 mt-0.5 shrink-0" />
        <div className="flex-1 text-sm">
          <p className="font-bold text-amber-900">Cell {String(target.targetCell).padStart(2, '0')} is occupied</p>
          <p className="text-amber-800 mt-1">
            Moving <code className="font-mono font-bold">{mover?.sub_lot_code ?? '…'}</code> here will displace{' '}
            <code className="font-mono font-bold">{target.occupant.sub_lot_code}</code> to the Awaiting re-placement queue.
            Its dried time so far ({fmtMin(target.occupant.total_dried_minutes)}) is preserved, but the countdown pauses
            until someone places it again.
          </p>
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className="px-3 py-1.5 rounded text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-40"
            >
              Yes, displace and move
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 rounded text-xs font-bold text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Legend() {
  const items: Array<{ cls: string; label: string }> = [
    { cls: 'bg-slate-100 border-slate-200', label: 'Empty' },
    { cls: 'bg-emerald-50 border-emerald-200', label: 'Available' },
    { cls: 'bg-amber-100 border-amber-300', label: 'Drying' },
    { cls: 'bg-red-200 border-red-400', label: 'Overdue' },
    { cls: 'bg-amber-200 border-amber-500', label: 'Open' },
    { cls: 'bg-blue-200 border-blue-500', label: 'Moving from' },
  ];
  return (
    <div className="flex items-center gap-2 text-[9px] text-slate-600 flex-wrap">
      {items.map(it => (
        <span key={it.label} className="inline-flex items-center gap-1">
          <span className={cn('w-2.5 h-2.5 rounded-sm border', it.cls)} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Clock, LogOut, Package, QrCode, CheckSquare, ArrowRightLeft, AlertCircle, X } from 'lucide-react';
import {
  listAwaitingCheckIn,
  listAwaitingRecheck,
  listSubLotsByDryer,
  formatQcDateTime,
  SubLot,
  BulkCheckInResult,
  BulkCheckOutResult,
  MoveDryerResult,
} from '../../../services/qcApi';
import { usePermissions } from '../../../contexts/PermissionContext';
import { QcStatusBadge } from './QcStatusBadge';
import { SelectAllCheckbox } from './SelectAllCheckbox';
import { ScanQrDialog } from './ScanQrDialog';
import { BulkCheckInDialog } from './BulkCheckInDialog';
import { BulkCheckOutDialog } from './BulkCheckOutDialog';
import { DuplicateScanDialog } from './DuplicateScanDialog';
import { MoveDryerDialog } from './MoveDryerDialog';
import { cn } from '../../../lib/utils';

interface Props {
  dryerNumber: number;
  onOpenHistory?: (subLotId: string) => void;
}

function fmtMin(mins: number | null | undefined): string {
  if (mins == null) return '—';
  const sign = mins < 0 ? '-' : '';
  const abs = Math.abs(Math.round(mins));
  if (abs < 60) return `${sign}${abs}m`;
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m === 0 ? `${sign}${h}h` : `${sign}${h}h ${m}m`;
}

function liveRemaining(s: SubLot): number | null {
  if (s.status !== 'drying') return s.remaining_minutes;
  if (s.expected_finish_at) {
    return (new Date(s.expected_finish_at).getTime() - Date.now()) / 60_000;
  }
  return s.remaining_minutes;
}

export function DryRoomListMode({ dryerNumber, onOpenHistory }: Props) {
  const { can } = usePermissions();
  const canCheckIn  = can('qc', 'dry_rooms', 'check_in');
  const canCheckOut = can('qc', 'dry_rooms', 'check_out');

  // Live tick for countdowns
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const [awaiting, setAwaiting] = useState<SubLot[]>([]);
  const [awaitingRecheck, setAwaitingRecheck] = useState<SubLot[]>([]);
  const [inDryer, setInDryer] = useState<SubLot[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedOut, setSelectedOut] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const [scanOutOpen, setScanOutOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmCheckOutOpen, setConfirmCheckOutOpen] = useState(false);
  const [moveDryerOpen, setMoveDryerOpen] = useState(false);
  const canMove = canCheckIn;  // moving a cart is conceptually a check-in into another dryer
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Session memory of scanned codes per side (in / out) — clears on full bulk action.
  const [scannedIn, setScannedIn] = useState<Set<string>>(new Set());
  const [scannedOut, setScannedOut] = useState<Set<string>>(new Set());
  const [dupScan, setDupScan] = useState<{ sl: SubLot; side: 'in' | 'out' } | null>(null);

  const load = async () => {
    try {
      const [aw, awR, drying] = await Promise.all([
        listAwaitingCheckIn(),
        listAwaitingRecheck(),
        listSubLotsByDryer(dryerNumber),
      ]);
      setAwaiting(aw);
      setAwaitingRecheck(awR);
      setInDryer(drying);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dryerNumber]);

  // Sort the awaiting list by the trailing 3-digit cart number so 001 comes
  // before 002, 010, etc., regardless of how the RPC ordered them.
  const eligible = useMemo(() => {
    const seqOf = (code: string): number => {
      const m = code.match(/-(\d{3})$/);
      return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
    };
    return [...awaiting, ...awaitingRecheck].sort((a, b) => {
      const sa = seqOf(a.sub_lot_code);
      const sb = seqOf(b.sub_lot_code);
      if (sa !== sb) return sa - sb;
      return a.sub_lot_code.localeCompare(b.sub_lot_code);
    });
  }, [awaiting, awaitingRecheck]);
  const dryingCarts = useMemo(() => inDryer.filter(s => s.status === 'drying'), [inDryer]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    if (selected.size === eligible.length) setSelected(new Set());
    else setSelected(new Set(eligible.map(s => s.id)));
  };

  const toggleOut = (id: string) => {
    setSelectedOut(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAllOut = () => {
    if (selectedOut.size === dryingCarts.length) setSelectedOut(new Set());
    else setSelectedOut(new Set(dryingCarts.map(s => s.id)));
  };

  // Adds the sub-lot to selection AND records the scan in session memory so
  // a second scan of the same code triggers the duplicate-scan dialog (BR-Q34).
  const acceptScannedForIn = (sl: SubLot) => {
    setSelected(prev => new Set(prev).add(sl.id));
    setScannedIn(prev => new Set(prev).add(sl.sub_lot_code));
    if (!eligible.find(s => s.id === sl.id)) load();
    setMsg(`Selected ${sl.sub_lot_code}`);
  };

  const acceptScannedForOut = (sl: SubLot) => {
    setSelectedOut(prev => new Set(prev).add(sl.id));
    setScannedOut(prev => new Set(prev).add(sl.sub_lot_code));
    setMsg(`Selected ${sl.sub_lot_code} for check-out`);
  };

  // Dialog stays open after each scan (keepOpen mode); operator clicks Done
  // to close.  Each handler only updates internal state — no setScanOpen(false).
  const handleScanned = (sl: SubLot) => {
    setError('');
    if (sl.status === 'created' || sl.status === 'awaiting_recheck') {
      if (scannedIn.has(sl.sub_lot_code)) {
        setDupScan({ sl, side: 'in' });
        return;
      }
      acceptScannedForIn(sl);
    } else if (sl.status === 'drying') {
      // Cart is already in a dryer — friendly notice, not an error/broken-code warning.
      const where = sl.dryer_number === dryerNumber
        ? 'this dryer'
        : sl.dryer_number != null ? `Dryer ${sl.dryer_number}` : 'a dryer';
      setMsg(`${sl.sub_lot_code} is already in ${where}.`);
    } else {
      setError(`${sl.sub_lot_code} has status "${sl.status}" — not eligible for check-in.`);
    }
  };

  const handleScannedForOut = (sl: SubLot) => {
    setError('');
    if (sl.status === 'drying' && sl.dryer_number === dryerNumber) {
      if (scannedOut.has(sl.sub_lot_code)) {
        setDupScan({ sl, side: 'out' });
        return;
      }
      acceptScannedForOut(sl);
    } else if (sl.dryer_number !== dryerNumber) {
      setError(`${sl.sub_lot_code} is not in this dryer.`);
    } else {
      setError(`${sl.sub_lot_code} has status "${sl.status}" — not currently drying.`);
    }
  };

  const onBulkSuccess = (result: BulkCheckInResult) => {
    setConfirmOpen(false);
    setSelected(new Set());
    setScannedIn(new Set());
    // Filter out "already in a dryer" rejections — those aren't broken codes, the cart's
    // simply checked in already. Only real ineligibles count as "skipped" (BR-Q34 / scan UX).
    const realFailed = (result.failed ?? []).filter(f => f.status !== 'drying');
    const failedCount = realFailed.length;
    setMsg(failedCount > 0
      ? `Checked in ${result.succeeded.length}; ${failedCount} skipped.`
      : `Checked in ${result.succeeded.length} cart(s) into Dryer ${dryerNumber}.`);
    load();
  };

  const onBulkCheckOutSuccess = (result: BulkCheckOutResult) => {
    setConfirmCheckOutOpen(false);
    setSelectedOut(new Set());
    setScannedOut(new Set());
    const groupCount = result.groups?.length ?? 0;
    const okCount = result.succeeded?.length ?? 0;
    const failedCount = result.failed?.length ?? 0;
    setMsg(failedCount > 0
      ? `Checked out ${okCount} cart(s) → ${groupCount} sampling group(s). ${failedCount} skipped.`
      : `Checked out ${okCount} cart(s) → ${groupCount} sampling group(s) formed.`);
    load();
  };

  // Group `inDryer` by SKU → production_lot (work order) for List view.
  type ProductGroup = {
    skuId: string;
    skuName: string;
    lots: Array<{
      lotId: string;
      lotNumber: string;
      lotBarcode: string;
      subLots: SubLot[];      // sorted by remaining time
      earliestFinishAt: number; // ms
    }>;
    earliestFinishAt: number;
  };

  const productGroups = useMemo<ProductGroup[]>(() => {
    const groupMap = new Map<string, ProductGroup>();
    for (const s of inDryer) {
      const skuKey = s.sku_id ?? 'unknown';
      const skuName = s.sku_name ?? 'Unknown SKU';
      let pg = groupMap.get(skuKey);
      if (!pg) {
        pg = { skuId: skuKey, skuName, lots: [], earliestFinishAt: Infinity };
        groupMap.set(skuKey, pg);
      }
      let lot = pg.lots.find(l => l.lotId === s.production_lot_id);
      if (!lot) {
        lot = {
          lotId: s.production_lot_id,
          lotNumber: s.lot_number ?? s.lot_barcode ?? '—',
          lotBarcode: s.lot_barcode ?? '—',
          subLots: [],
          earliestFinishAt: Infinity,
        };
        pg.lots.push(lot);
      }
      lot.subLots.push(s);
      const eta = s.expected_finish_at ? new Date(s.expected_finish_at).getTime() : Infinity;
      lot.earliestFinishAt = Math.min(lot.earliestFinishAt, eta);
      pg.earliestFinishAt = Math.min(pg.earliestFinishAt, eta);
    }
    // sort sub-lots within each work order by remaining (earliest first)
    for (const pg of groupMap.values()) {
      for (const lot of pg.lots) {
        lot.subLots.sort((a, b) => {
          const ea = a.expected_finish_at ? new Date(a.expected_finish_at).getTime() : Infinity;
          const eb = b.expected_finish_at ? new Date(b.expected_finish_at).getTime() : Infinity;
          return ea - eb;
        });
      }
      pg.lots.sort((a, b) => a.earliestFinishAt - b.earliestFinishAt);
    }
    return Array.from(groupMap.values()).sort((a, b) => a.earliestFinishAt - b.earliestFinishAt);
  }, [inDryer]);

  // Group "next-finish events" per work-order — distinct finish minute buckets.
  function finishBuckets(subLots: SubLot[]): Array<{ when: string; count: number }> {
    const buckets = new Map<string, number>();
    for (const s of subLots) {
      if (!s.expected_finish_at) continue;
      // Bucket to the nearest minute for display
      const key = new Date(s.expected_finish_at).toISOString().slice(0, 16);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    return Array.from(buckets.entries())
      .map(([when, count]) => ({ when, count }))
      .sort((a, b) => a.when.localeCompare(b.when));
  }

  return (
    <>
      {msg && (
        <p className="text-emerald-700 bg-emerald-50 p-2 rounded-lg mb-3 text-sm">{msg}</p>
      )}

      {/* Errors render as a center popup with a close button — clearer than
          an inline banner that the operator might miss while scanning. */}
      {error && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            onClick={() => setError('')}
            aria-label="Dismiss"
          />
          <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border-2 border-red-200">
            <header className="px-5 py-4 border-b border-slate-200 flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-red-100 text-red-700 flex items-center justify-center shrink-0">
                <AlertCircle size={18} />
              </div>
              <div className="flex-1">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Cannot proceed</p>
                <h2 className="text-base font-bold text-slate-900 mt-0.5">Scan / action failed</h2>
              </div>
              <button
                onClick={() => setError('')}
                className="p-1 rounded hover:bg-slate-100 text-slate-500"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </header>
            <div className="px-5 py-4 text-sm text-slate-800">
              {error}
            </div>
            <footer className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2 bg-slate-50 rounded-b-2xl">
              <button
                type="button"
                onClick={() => setError('')}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-slate-900 hover:bg-slate-700 text-white"
              >
                OK
              </button>
            </footer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-5">
        {/* ── Left: awaiting + bulk action panel ───────────────────────── */}
        <aside className="space-y-3">
          <section className="bg-white border rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-slate-900 text-sm">
                Awaiting check-in
                <span className="ml-1 text-slate-400 font-normal">({eligible.length})</span>
              </h2>
              <button
                type="button"
                onClick={() => setScanOpen(true)}
                title="Use a barcode scanner (or type) to add carts to the check-in selection"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 hover:bg-slate-700 text-white shadow-sm"
              >
                <QrCode size={13} /> Scan to check in
              </button>
            </div>

            {eligible.length > 0 && (
              <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded px-2 py-1.5 mb-2">
                <SelectAllCheckbox
                  total={eligible.length}
                  selected={selected.size}
                  onToggleAll={toggleAll}
                />
              </div>
            )}

            {eligible.length === 0 ? (
              <p className="text-xs text-slate-500 px-1">No sub-lots awaiting check-in.</p>
            ) : (
              <ul className="space-y-1.5 max-h-[380px] overflow-auto">
                {eligible.map(s => {
                  const isSelected = selected.has(s.id);
                  const recheck = s.status === 'awaiting_recheck';
                  return (
                    <li key={s.id}>
                      <label className={cn(
                        'flex items-start gap-2 rounded-lg px-2 py-1.5 border-2 text-xs cursor-pointer transition-colors',
                        isSelected ? 'border-blue-500 bg-blue-50'
                          : recheck ? 'border-amber-200 hover:border-amber-400 bg-amber-50/30'
                          : 'border-slate-200 hover:border-blue-300',
                      )}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggle(s.id)}
                          disabled={!canCheckIn}
                          className="mt-0.5 accent-blue-600"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="font-mono font-bold text-slate-900">{s.sub_lot_code}</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            {s.sku_name ?? '—'}
                            {recheck && <span className="ml-1 text-amber-700">· re-place</span>}
                            {s.expected_dry_minutes ? ` · target ${s.expected_dry_minutes}m` : ''}
                          </div>
                        </div>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}

            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={!canCheckIn || selected.size === 0}
              className="mt-3 w-full px-3 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              <CheckSquare size={13} />
              Check in to Dryer {dryerNumber} ({selected.size})
            </button>
          </section>
        </aside>

        {/* ── Right: in-dryer list, grouped by Product/SKU → Work Order ─── */}
        <section className="bg-white border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <h2 className="font-semibold text-slate-900 text-sm">
              In this dryer — grouped by product
              <span className="ml-1 text-slate-400 font-normal">({inDryer.length})</span>
            </h2>
            <span className="text-[10px] text-slate-400 uppercase tracking-wider">
              sorted by earliest finish
            </span>
          </div>

          {(canCheckOut || canMove) && dryingCarts.length > 0 && (
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded px-2 py-1.5 mb-3 flex-wrap">
              <SelectAllCheckbox
                total={dryingCarts.length}
                selected={selectedOut.size}
                onToggleAll={toggleAllOut}
              />
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => setScanOutOpen(true)}
                title="Use a barcode scanner (or type) to add carts to the check-out selection"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 hover:bg-slate-700 text-white shadow-sm"
              >
                <QrCode size={13} /> Scan to check out
              </button>
              {canMove && (
                <button
                  type="button"
                  onClick={() => setMoveDryerOpen(true)}
                  disabled={selectedOut.size === 0}
                  className="flex items-center gap-1 px-3 py-1 rounded text-[11px] font-bold bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ArrowRightLeft size={11} /> Move ({selectedOut.size})
                </button>
              )}
              {canCheckOut && (
                <button
                  type="button"
                  onClick={() => setConfirmCheckOutOpen(true)}
                  disabled={selectedOut.size === 0}
                  className="flex items-center gap-1 px-3 py-1 rounded text-[11px] font-bold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <LogOut size={11} /> Check out ({selectedOut.size})
                </button>
              )}
            </div>
          )}

          {productGroups.length === 0 ? (
            <p className="text-sm text-slate-400 italic py-8 text-center">
              Empty. Select sub-lots from the left to check in.
            </p>
          ) : (
            <ul className="space-y-2">
              {productGroups.map(pg => {
                const expandedKey = `product:${pg.skuId}`;
                const isExpanded = expanded[expandedKey] !== false;  // default open
                const totalCarts = pg.lots.reduce((s, l) => s + l.subLots.length, 0);
                return (
                  <li key={pg.skuId} className="border border-slate-200 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setExpanded(e => ({ ...e, [expandedKey]: !isExpanded }))}
                      className="w-full px-3 py-2 flex items-center gap-2 hover:bg-slate-50"
                    >
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <Package size={14} className="text-slate-400" />
                      <span className="font-bold text-sm text-slate-900">{pg.skuName}</span>
                      <span className="text-[10px] text-slate-500 ml-1">
                        ({totalCarts} cart{totalCarts === 1 ? '' : 's'} · {pg.lots.length} work order{pg.lots.length === 1 ? '' : 's'})
                      </span>
                      <span className="flex-1" />
                      {Number.isFinite(pg.earliestFinishAt) && (
                        <span className="text-[10px] text-slate-500 font-mono">
                          first finish {formatQcDateTime(new Date(pg.earliestFinishAt).toISOString())}
                        </span>
                      )}
                    </button>

                    {isExpanded && (
                      <ul className="pl-7 pr-3 pb-3 space-y-2 border-t border-slate-100">
                        {pg.lots.map(lot => {
                          const lotKey = `lot:${lot.lotId}`;
                          const lotExpanded = expanded[lotKey] !== false;
                          const buckets = finishBuckets(lot.subLots);
                          // Group-level select-all: only drying carts in this lot are eligible.
                          const lotDryingCarts = lot.subLots.filter(s => s.status === 'drying');
                          const lotSelectedCount = lotDryingCarts.filter(s => selectedOut.has(s.id)).length;
                          const allLotSelected = lotDryingCarts.length > 0 && lotSelectedCount === lotDryingCarts.length;
                          const someLotSelected = lotSelectedCount > 0 && !allLotSelected;
                          const toggleLotAll = () => {
                            setSelectedOut(prev => {
                              const next = new Set(prev);
                              if (allLotSelected) {
                                for (const s of lotDryingCarts) next.delete(s.id);
                              } else {
                                for (const s of lotDryingCarts) next.add(s.id);
                              }
                              return next;
                            });
                          };
                          return (
                            <li key={lot.lotId} className="bg-slate-50 rounded p-2">
                              <div className="flex items-center gap-2 text-[11px]">
                                {canCheckOut && lotDryingCarts.length > 0 && (
                                  <input
                                    type="checkbox"
                                    checked={allLotSelected}
                                    ref={el => { if (el) el.indeterminate = someLotSelected; }}
                                    onChange={toggleLotAll}
                                    onClick={(e) => e.stopPropagation()}
                                    className="accent-emerald-600 shrink-0"
                                    aria-label={allLotSelected ? `Deselect all carts in ${lot.lotNumber}` : `Select all carts in ${lot.lotNumber}`}
                                    title={allLotSelected ? 'Deselect all' : 'Select all'}
                                  />
                                )}
                                <button
                                  type="button"
                                  onClick={() => setExpanded(e => ({ ...e, [lotKey]: !lotExpanded }))}
                                  className="flex-1 flex items-center gap-2"
                                >
                                  {lotExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                                  <span className="font-mono font-bold text-slate-800">{lot.lotNumber}</span>
                                  <span className="text-slate-500">
                                    · {lot.subLots.length} cart{lot.subLots.length === 1 ? '' : 's'}
                                  </span>
                                  <span className="flex-1" />
                                  {buckets.slice(0, 2).map(b => (
                                    <span key={b.when} className="text-[10px] text-slate-500 font-mono">
                                      {b.when.slice(11)}
                                    </span>
                                  ))}
                                  {buckets.length > 2 && (
                                    <span className="text-[10px] text-slate-400">+{buckets.length - 2}</span>
                                  )}
                                </button>
                              </div>

                              {lotExpanded && (
                                <ul className="mt-2 space-y-1">
                                  {lot.subLots.map(s => {
                                    const remaining = liveRemaining(s);
                                    const overdue = remaining != null && remaining < 0;
                                    const ready = s.status === 'drying' && remaining != null && remaining <= 0;
                                    return (
                                      <li key={s.id} className="bg-white rounded p-2 flex items-center gap-3 text-[11px]">
                                        {s.status === 'drying' && canCheckOut ? (
                                          <input
                                            type="checkbox"
                                            checked={selectedOut.has(s.id)}
                                            onChange={() => toggleOut(s.id)}
                                            className="accent-emerald-600"
                                            aria-label={`Select ${s.sub_lot_code} for check-out`}
                                          />
                                        ) : (
                                          <span className="w-3" />
                                        )}
                                        <button
                                          type="button"
                                          onClick={() => onOpenHistory?.(s.id)}
                                          className="font-mono font-bold text-blue-700 hover:underline"
                                        >
                                          {s.sub_lot_code}
                                        </button>
                                        <QcStatusBadge status={s.status} />
                                        <span className="text-slate-500">
                                          in {formatQcDateTime(s.in_time)}
                                        </span>
                                        <span className="text-slate-400">·</span>
                                        <span className="text-slate-700">
                                          dried {fmtMin(s.total_dried_minutes)}
                                        </span>
                                        <span className="text-slate-400">·</span>
                                        <span className={cn(
                                          'font-mono inline-flex items-center gap-1',
                                          overdue ? 'text-red-700 font-bold' : 'text-slate-800',
                                        )}>
                                          <Clock size={10} /> {fmtMin(remaining)}
                                        </span>
                                        <span className="flex-1" />
                                        {s.status === 'drying' && ready && (
                                          <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">
                                            ready
                                          </span>
                                        )}
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <ScanQrDialog
        open={scanOpen}
        dryerNumber={dryerNumber}
        keepOpen
        runningSummary={`${selected.size} cart${selected.size === 1 ? '' : 's'} queued for check-in`}
        onClose={() => setScanOpen(false)}
        onFound={handleScanned}
      />

      <BulkCheckInDialog
        open={confirmOpen}
        dryerNumber={dryerNumber}
        selectedSubLots={eligible.filter(s => selected.has(s.id))}
        onClose={() => setConfirmOpen(false)}
        onSuccess={onBulkSuccess}
      />

      <ScanQrDialog
        open={scanOutOpen}
        dryerNumber={dryerNumber}
        keepOpen
        runningSummary={`${selectedOut.size} cart${selectedOut.size === 1 ? '' : 's'} queued for check-out`}
        onClose={() => setScanOutOpen(false)}
        onFound={handleScannedForOut}
      />

      <BulkCheckOutDialog
        open={confirmCheckOutOpen}
        selectedSubLots={dryingCarts.filter(s => selectedOut.has(s.id))}
        onClose={() => setConfirmCheckOutOpen(false)}
        onSuccess={onBulkCheckOutSuccess}
      />

      <DuplicateScanDialog
        open={dupScan != null}
        subLotCode={dupScan?.sl.sub_lot_code ?? ''}
        contextLabel={dupScan?.side === 'in' ? 'already in selection for check-in' : 'already in selection for check-out'}
        onCancel={() => setDupScan(null)}
        onConfirm={() => {
          if (!dupScan) return;
          // Already in selection, but operator confirms — keep it; just close.
          if (dupScan.side === 'in') {
            acceptScannedForIn(dupScan.sl);
          } else {
            acceptScannedForOut(dupScan.sl);
          }
          setDupScan(null);
        }}
      />

      <MoveDryerDialog
        open={moveDryerOpen}
        selectedSubLots={dryingCarts.filter(s => selectedOut.has(s.id))}
        currentDryer={dryerNumber}
        onClose={() => setMoveDryerOpen(false)}
        onSuccess={(result: MoveDryerResult) => {
          setMoveDryerOpen(false);
          setSelectedOut(new Set());
          const ok = result.succeeded?.length ?? 0;
          const failedCount = result.failed?.length ?? 0;
          setMsg(failedCount > 0
            ? `Moved ${ok} cart(s); ${failedCount} skipped.`
            : `Moved ${ok} cart(s) to Dryer ${result.succeeded[0]?.new_dryer}.`);
          load();
        }}
      />
    </>
  );
}

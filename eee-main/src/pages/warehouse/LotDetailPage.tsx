import React, { FormEvent, useEffect, useState } from 'react';
import { ArrowLeft, ArrowLeftRight, SlidersHorizontal, CheckCircle2, XCircle } from 'lucide-react';
import {
  getLot,
  listBalance,
  listTransactions,
  listLocations,
  postTransfer,
  postAdjustment,
  releaseLot,
  rejectLot,
  listLotCoa,
  LotHeader,
  WarehouseBalance,
  WarehouseTransaction,
  WarehouseLocation,
  Coa,
} from '../../services/warehouseApi';
import { usePermissions } from '../../contexts/PermissionContext';
import { cn } from '../../lib/utils';
import { useTranslation } from 'react-i18next';

const LOT_STATUS_BADGE: Record<string, string> = {
  available: 'bg-emerald-100 text-emerald-700',
  quarantine: 'bg-amber-100 text-amber-700',
  on_hold: 'bg-rose-100 text-rose-700',
  rejected: 'bg-rose-100 text-rose-700',
  expired: 'bg-slate-200 text-slate-600',
  consumed: 'bg-slate-100 text-slate-500',
};

export default function LotDetailPage({ lotId, onBack }: { lotId: number; onBack: () => void }) {
  const { t } = useTranslation('warehouse');
  const { can } = usePermissions();
  const canTransfer = can('warehouse', 'inventory', 'transfer');
  const canAdjust = can('warehouse', 'inventory', 'adjust');
  const canRelease = can('warehouse', 'lots', 'release');
  const canReject = can('warehouse', 'lots', 'reject');

  const [lot, setLot] = useState<LotHeader | null>(null);
  const [balances, setBalances] = useState<WarehouseBalance[]>([]);
  const [txns, setTxns] = useState<WarehouseTransaction[]>([]);
  const [locations, setLocations] = useState<WarehouseLocation[]>([]);
  const [mode, setMode] = useState<'none' | 'transfer' | 'adjust' | 'release' | 'reject'>('none');
  const [coaHistory, setCoaHistory] = useState<Coa[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  // transfer form
  const [fromLoc, setFromLoc] = useState<number | ''>('');
  const [toLoc, setToLoc] = useState<number | ''>('');
  const [qty, setQty] = useState('');
  // adjust form
  const [adjLoc, setAdjLoc] = useState<number | ''>('');
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  // release / reject forms (shared fields)
  const [testDate, setTestDate] = useState('');
  const [testedBy, setTestedBy] = useState('');
  const [documentRef, setDocumentRef] = useState('');
  const [releaseNotes, setReleaseNotes] = useState('');
  const [rejectReason, setRejectReason] = useState('');

  const load = async () => {
    setError('');
    try {
      const l = await getLot(lotId);
      setLot(l);
      const [bal, tx, coas] = await Promise.all([
        listBalance({ itemId: l.item_id }),
        listTransactions({ lotId }),
        listLotCoa(lotId),
      ]);
      setBalances(bal.filter((b) => b.lot_id === lotId));
      setTxns(tx);
      setCoaHistory(coas);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('lotDetailPage.loadFailed'));
    }
  };

  useEffect(() => {
    load();
    listLocations().then(setLocations).catch(() => {});
    // eslint-disable-next-line
  }, [lotId]);

  const baseUom = balances[0]?.base_uom ?? '';
  const closeForms = () => {
    setMode('none');
    setFromLoc(''); setToLoc(''); setQty('');
    setAdjLoc(''); setDelta(''); setReason('');
    setTestDate(''); setTestedBy(''); setDocumentRef('');
    setReleaseNotes(''); setRejectReason('');
  };

  const submitTransfer = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!lot || lot.base_uom_id == null) { setError(t('lotDetailPage.errMissingBaseUom')); return; }
    if (fromLoc === '' || toLoc === '' || !qty) { setError(t('lotDetailPage.errTransferRequired')); return; }
    setBusy(true);
    try {
      await postTransfer({
        itemId: lot.item_id, lotId, fromLocationId: Number(fromLoc), toLocationId: Number(toLoc),
        quantity: Number(qty), uomId: lot.base_uom_id,
      });
      setMsg(t('lotDetailPage.transferPosted'));
      closeForms();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('lotDetailPage.transferFailed'));
    }
    setBusy(false);
  };

  const submitAdjust = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!lot || lot.base_uom_id == null) { setError(t('lotDetailPage.errMissingBaseUom')); return; }
    if (adjLoc === '' || !delta || !reason.trim()) { setError(t('lotDetailPage.errAdjustRequired')); return; }
    if (Number(delta) === 0) { setError(t('lotDetailPage.errDeltaZero')); return; }
    setBusy(true);
    try {
      await postAdjustment({
        itemId: lot.item_id, lotId, locationId: Number(adjLoc),
        quantityDelta: Number(delta), uomId: lot.base_uom_id, reason: reason.trim(),
      });
      setMsg(t('lotDetailPage.adjustPosted'));
      closeForms();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('lotDetailPage.adjustFailed'));
    }
    setBusy(false);
  };

  const submitRelease = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await releaseLot({
        lotId,
        testDate: testDate || null,
        testedBy: testedBy.trim() || null,
        documentRef: documentRef.trim() || null,
        notes: releaseNotes.trim() || null,
      });
      setMsg(t('lotDetailPage.releasedMsg', { coa: res.coa_number }));
      closeForms();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('lotDetailPage.releaseFailed'));
    }
    setBusy(false);
  };

  const submitReject = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!rejectReason.trim()) { setError(t('lotDetailPage.errRejectReasonRequired')); return; }
    setBusy(true);
    try {
      const res = await rejectLot({
        lotId,
        reason: rejectReason.trim(),
        testDate: testDate || null,
        testedBy: testedBy.trim() || null,
        documentRef: documentRef.trim() || null,
      });
      setMsg(t('lotDetailPage.rejectedMsg', { coa: res.coa_number }));
      closeForms();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('lotDetailPage.rejectFailed'));
    }
    setBusy(false);
  };

  const stockedLocs = balances.filter((b) => b.quantity_on_hand > 0);

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <button onClick={onBack} className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 mb-3">
        <ArrowLeft size={14} /> {t('lotDetailPage.backToLots')}
      </button>

      {error && <p className="text-red-600 mb-3 text-sm">{error}</p>}
      {msg && <p className="text-emerald-700 bg-emerald-50 p-2 rounded-lg mb-3 text-sm">{msg}</p>}

      {lot && (
        <>
          <div className="flex items-start justify-between gap-3 mb-5">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-slate-900 font-mono">{lot.lot_number}</h1>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${LOT_STATUS_BADGE[lot.status] ?? 'bg-slate-100 text-slate-600'}`}>
                  {lot.status}
                </span>
              </div>
              <p className="text-sm text-slate-600 mt-1">
                {lot.item_sku} · {lot.item_name} · {t('lotDetailPage.source')} {lot.source_type}
                {lot.expiry_date ? ` · ${t('lotDetailPage.expiresAt')} ${lot.expiry_date}` : ''}
              </p>
            </div>
            <div className="flex gap-2 shrink-0 flex-wrap justify-end">
              {canRelease && lot.status === 'quarantine' && (
                <button onClick={() => { closeForms(); setMode('release'); }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white">
                  <CheckCircle2 size={13} /> {t('lotDetailPage.release')}
                </button>
              )}
              {canReject && (lot.status === 'quarantine' || lot.status === 'available') && (
                <button onClick={() => { closeForms(); setMode('reject'); }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white">
                  <XCircle size={13} /> {t('lotDetailPage.reject')}
                </button>
              )}
              {canTransfer && (
                <button onClick={() => { closeForms(); setMode('transfer'); }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white">
                  <ArrowLeftRight size={13} /> {t('lotDetailPage.transfer')}
                </button>
              )}
              {canAdjust && (
                <button onClick={() => { closeForms(); setMode('adjust'); }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-slate-700 hover:bg-slate-600 text-white">
                  <SlidersHorizontal size={13} /> {t('lotDetailPage.adjust')}
                </button>
              )}
            </div>
          </div>

          {mode === 'transfer' && (
            <form onSubmit={submitTransfer} className="bg-white border-2 border-emerald-400 rounded-xl p-4 mb-5 space-y-3">
              <h2 className="font-semibold text-emerald-800 text-sm">{t('lotDetailPage.transferTitle', { uom: baseUom || t('lotDetailPage.baseUom') })}</h2>
              <div className="grid sm:grid-cols-3 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">{t('lotDetailPage.fromLocation')}</span>
                  <select className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm bg-white" value={fromLoc}
                    onChange={(e) => setFromLoc(e.target.value ? Number(e.target.value) : '')} required>
                    <option value="" disabled>{t('lotDetailPage.selectPlaceholder')}</option>
                    {stockedLocs.map((b) => <option key={b.location_id} value={b.location_id}>{t('lotDetailPage.locOnHandOption', { code: b.location_code, qty: b.quantity_on_hand })}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">{t('lotDetailPage.toLocation')}</span>
                  <select className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm bg-white" value={toLoc}
                    onChange={(e) => setToLoc(e.target.value ? Number(e.target.value) : '')} required>
                    <option value="" disabled>{t('lotDetailPage.selectPlaceholder')}</option>
                    {locations.filter((l) => l.id !== fromLoc).map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">{t('lotDetailPage.quantity')}</span>
                  <input type="number" min={0} step="0.0001" className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm"
                    value={qty} onChange={(e) => setQty(e.target.value)} required />
                </label>
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium disabled:opacity-50">{busy ? t('lotDetailPage.posting') : t('lotDetailPage.postTransfer')}</button>
                <button type="button" onClick={closeForms} className="px-4 py-2 rounded-lg border text-sm">{t('lotDetailPage.cancel')}</button>
              </div>
            </form>
          )}

          {mode === 'adjust' && (
            <form onSubmit={submitAdjust} className="bg-white border-2 border-slate-400 rounded-xl p-4 mb-5 space-y-3">
              <h2 className="font-semibold text-slate-800 text-sm">{t('lotDetailPage.adjustTitle', { uom: baseUom || t('lotDetailPage.baseUom') })}</h2>
              <div className="grid sm:grid-cols-3 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">{t('lotDetailPage.location')}</span>
                  <select className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm bg-white" value={adjLoc}
                    onChange={(e) => setAdjLoc(e.target.value ? Number(e.target.value) : '')} required>
                    <option value="" disabled>{t('lotDetailPage.selectPlaceholder')}</option>
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">{t('lotDetailPage.delta')}</span>
                  <input type="number" step="0.0001" className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm"
                    value={delta} onChange={(e) => setDelta(e.target.value)} required />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">{t('lotDetailPage.reason')}</span>
                  <input className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm" placeholder={t('lotDetailPage.reasonPlaceholder')}
                    value={reason} onChange={(e) => setReason(e.target.value)} required />
                </label>
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium disabled:opacity-50">{busy ? t('lotDetailPage.posting') : t('lotDetailPage.postAdjust')}</button>
                <button type="button" onClick={closeForms} className="px-4 py-2 rounded-lg border text-sm">{t('lotDetailPage.cancel')}</button>
              </div>
            </form>
          )}

          {mode === 'release' && (
            <form onSubmit={submitRelease} className="bg-white border-2 border-emerald-400 rounded-xl p-4 mb-5 space-y-3">
              <h2 className="font-semibold text-emerald-800 text-sm">{t('lotDetailPage.releaseTitle')}</h2>
              <div className="grid sm:grid-cols-4 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">{t('lotDetailPage.testDate')}</span>
                  <input type="date" className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm"
                    value={testDate} onChange={(e) => setTestDate(e.target.value)} />
                  <span className="text-[10px] text-slate-500">{t('lotDetailPage.blankIsToday')}</span>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">{t('lotDetailPage.testedByOptional')}</span>
                  <input className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm"
                    value={testedBy} onChange={(e) => setTestedBy(e.target.value)} />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">{t('lotDetailPage.documentRefOptional')}</span>
                  <input className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm"
                    placeholder={t('lotDetailPage.documentRefPlaceholder')} value={documentRef} onChange={(e) => setDocumentRef(e.target.value)} />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">{t('lotDetailPage.notesOptional')}</span>
                  <input className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm"
                    value={releaseNotes} onChange={(e) => setReleaseNotes(e.target.value)} />
                </label>
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium disabled:opacity-50">{busy ? t('lotDetailPage.submitting') : t('lotDetailPage.confirmRelease')}</button>
                <button type="button" onClick={closeForms} className="px-4 py-2 rounded-lg border text-sm">{t('lotDetailPage.cancel')}</button>
              </div>
            </form>
          )}

          {mode === 'reject' && (
            <form onSubmit={submitReject} className="bg-white border-2 border-rose-400 rounded-xl p-4 mb-5 space-y-3">
              <h2 className="font-semibold text-rose-800 text-sm">{t('lotDetailPage.rejectTitle')}</h2>
              <div className="grid sm:grid-cols-4 gap-3">
                <label className="block sm:col-span-2">
                  <span className="text-xs font-medium text-slate-700">{t('lotDetailPage.rejectReasonRequired')}</span>
                  <input className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm"
                    placeholder={t('lotDetailPage.rejectReasonPlaceholder')}
                    value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} required />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">{t('lotDetailPage.testDate')}</span>
                  <input type="date" className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm"
                    value={testDate} onChange={(e) => setTestDate(e.target.value)} />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">{t('lotDetailPage.testedByOptional')}</span>
                  <input className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm"
                    value={testedBy} onChange={(e) => setTestedBy(e.target.value)} />
                </label>
              </div>
              <p className="text-[10px] text-slate-500">{t('lotDetailPage.rejectNote')}</p>
              <div className="flex gap-2">
                <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium disabled:opacity-50">{busy ? t('lotDetailPage.submitting') : t('lotDetailPage.confirmReject')}</button>
                <button type="button" onClick={closeForms} className="px-4 py-2 rounded-lg border text-sm">{t('lotDetailPage.cancel')}</button>
              </div>
            </form>
          )}

          {/* current balances by location */}
          <h2 className="text-sm font-bold text-slate-700 mb-2">{t('lotDetailPage.currentStockByLocation')}</h2>
          <div className="overflow-hidden rounded-xl border bg-white mb-6">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-semibold px-4 py-2.5">{t('lotDetailPage.location')}</th>
                  <th className="text-right font-semibold px-4 py-2.5">{t('lotDetailPage.onHand')}</th>
                  <th className="text-left font-semibold px-4 py-2.5 pl-3">{t('lotDetailPage.unit')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {balances.map((b) => (
                  <tr key={b.location_id}>
                    <td className="px-4 py-2.5 font-mono text-slate-700">{b.location_code}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{b.quantity_on_hand}</td>
                    <td className="px-4 py-2.5 pl-3 text-slate-600">{b.base_uom}</td>
                  </tr>
                ))}
                {balances.length === 0 && (
                  <tr><td colSpan={3} className="px-4 py-4 text-center text-slate-500">{t('lotDetailPage.noStock')}</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* timeline */}
          <h2 className="text-sm font-bold text-slate-700 mb-2">{t('lotDetailPage.transactionTimeline')}</h2>
          <div className="overflow-hidden rounded-xl border bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-semibold px-4 py-2.5">{t('lotDetailPage.time')}</th>
                  <th className="text-left font-semibold px-4 py-2.5">{t('lotDetailPage.type')}</th>
                  <th className="text-left font-semibold px-4 py-2.5">{t('lotDetailPage.location')}</th>
                  <th className="text-right font-semibold px-4 py-2.5">{t('lotDetailPage.quantity')}</th>
                  <th className="text-left font-semibold px-4 py-2.5 pl-3">{t('lotDetailPage.notes')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {txns.map((t) => (
                  <tr key={t.id}>
                    <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{new Date(t.transaction_date).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-slate-700">{t.transaction_type}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-700">{t.location_code}</td>
                    <td className={cn('px-4 py-2.5 text-right tabular-nums font-medium', t.quantity < 0 ? 'text-rose-600' : 'text-emerald-700')}>
                      {t.quantity > 0 ? '+' : ''}{t.quantity}
                    </td>
                    <td className="px-4 py-2.5 pl-3 text-slate-500">{t.notes ?? '—'}</td>
                  </tr>
                ))}
                {txns.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-4 text-center text-slate-500">{t('lotDetailPage.noTransactions')}</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* COA history (release/reject records for this lot) */}
          {coaHistory.length > 0 && (
            <>
              <h2 className="text-sm font-bold text-slate-700 mb-2 mt-6">{t('lotDetailPage.coaHistory')}</h2>
              <div className="overflow-hidden rounded-xl border bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                    <tr>
                      <th className="text-left font-semibold px-4 py-2.5">{t('lotDetailPage.coaNumber')}</th>
                      <th className="text-left font-semibold px-4 py-2.5">{t('lotDetailPage.date')}</th>
                      <th className="text-left font-semibold px-4 py-2.5">{t('lotDetailPage.result')}</th>
                      <th className="text-left font-semibold px-4 py-2.5">{t('lotDetailPage.testedBy')}</th>
                      <th className="text-left font-semibold px-4 py-2.5">{t('lotDetailPage.document')}</th>
                      <th className="text-left font-semibold px-4 py-2.5">{t('lotDetailPage.notes')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {coaHistory.map((c) => (
                      <tr key={c.id}>
                        <td className="px-4 py-2 font-mono text-slate-800">{c.coa_number}</td>
                        <td className="px-4 py-2 text-slate-700">{c.test_date}</td>
                        <td className="px-4 py-2">
                          <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded',
                            c.result === 'pass' ? 'bg-emerald-100 text-emerald-700'
                            : c.result === 'fail' ? 'bg-rose-100 text-rose-700'
                            : 'bg-slate-100 text-slate-600')}>
                            {c.result}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-slate-700">{c.tested_by ?? '—'}</td>
                        <td className="px-4 py-2 text-slate-500 text-xs">{c.document_ref ?? '—'}</td>
                        <td className="px-4 py-2 text-slate-500">{c.notes ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

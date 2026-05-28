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

const LOT_STATUS_BADGE: Record<string, string> = {
  available: 'bg-emerald-100 text-emerald-700',
  quarantine: 'bg-amber-100 text-amber-700',
  on_hold: 'bg-rose-100 text-rose-700',
  rejected: 'bg-rose-100 text-rose-700',
  expired: 'bg-slate-200 text-slate-600',
  consumed: 'bg-slate-100 text-slate-500',
};

export default function LotDetailPage({ lotId, onBack }: { lotId: number; onBack: () => void }) {
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
      setError(e instanceof Error ? e.message : '加载失败');
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
    if (!lot || lot.base_uom_id == null) { setError('批次缺少基础单位'); return; }
    if (fromLoc === '' || toLoc === '' || !qty) { setError('源库位、目标库位、数量必填'); return; }
    setBusy(true);
    try {
      await postTransfer({
        itemId: lot.item_id, lotId, fromLocationId: Number(fromLoc), toLocationId: Number(toLoc),
        quantity: Number(qty), uomId: lot.base_uom_id,
      });
      setMsg('调拨已过账');
      closeForms();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '调拨失败');
    }
    setBusy(false);
  };

  const submitAdjust = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!lot || lot.base_uom_id == null) { setError('批次缺少基础单位'); return; }
    if (adjLoc === '' || !delta || !reason.trim()) { setError('库位、增减量、原因必填'); return; }
    if (Number(delta) === 0) { setError('增减量不能为 0'); return; }
    setBusy(true);
    try {
      await postAdjustment({
        itemId: lot.item_id, lotId, locationId: Number(adjLoc),
        quantityDelta: Number(delta), uomId: lot.base_uom_id, reason: reason.trim(),
      });
      setMsg('调整已过账');
      closeForms();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '调整失败');
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
      setMsg(`已放行（COA ${res.coa_number}），状态 → available`);
      closeForms();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '放行失败');
    }
    setBusy(false);
  };

  const submitReject = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!rejectReason.trim()) { setError('拒收原因必填'); return; }
    setBusy(true);
    try {
      const res = await rejectLot({
        lotId,
        reason: rejectReason.trim(),
        testDate: testDate || null,
        testedBy: testedBy.trim() || null,
        documentRef: documentRef.trim() || null,
      });
      setMsg(`已拒收（COA ${res.coa_number}），状态 → rejected`);
      closeForms();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '拒收失败');
    }
    setBusy(false);
  };

  const stockedLocs = balances.filter((b) => b.quantity_on_hand > 0);

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <button onClick={onBack} className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 mb-3">
        <ArrowLeft size={14} /> 返回批次列表
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
                {lot.item_sku} · {lot.item_name} · 来源 {lot.source_type}
                {lot.expiry_date ? ` · 保质期至 ${lot.expiry_date}` : ''}
              </p>
            </div>
            <div className="flex gap-2 shrink-0 flex-wrap justify-end">
              {canRelease && lot.status === 'quarantine' && (
                <button onClick={() => { closeForms(); setMode('release'); }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white">
                  <CheckCircle2 size={13} /> 放行
                </button>
              )}
              {canReject && (lot.status === 'quarantine' || lot.status === 'available') && (
                <button onClick={() => { closeForms(); setMode('reject'); }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white">
                  <XCircle size={13} /> 拒收
                </button>
              )}
              {canTransfer && (
                <button onClick={() => { closeForms(); setMode('transfer'); }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white">
                  <ArrowLeftRight size={13} /> 调拨
                </button>
              )}
              {canAdjust && (
                <button onClick={() => { closeForms(); setMode('adjust'); }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-slate-700 hover:bg-slate-600 text-white">
                  <SlidersHorizontal size={13} /> 调整
                </button>
              )}
            </div>
          </div>

          {mode === 'transfer' && (
            <form onSubmit={submitTransfer} className="bg-white border-2 border-emerald-400 rounded-xl p-4 mb-5 space-y-3">
              <h2 className="font-semibold text-emerald-800 text-sm">调拨（数量单位：{baseUom || '基础单位'}）</h2>
              <div className="grid sm:grid-cols-3 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">源库位（在库）</span>
                  <select className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm bg-white" value={fromLoc}
                    onChange={(e) => setFromLoc(e.target.value ? Number(e.target.value) : '')} required>
                    <option value="" disabled>选择…</option>
                    {stockedLocs.map((b) => <option key={b.location_id} value={b.location_id}>{b.location_code}（在库 {b.quantity_on_hand}）</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">目标库位</span>
                  <select className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm bg-white" value={toLoc}
                    onChange={(e) => setToLoc(e.target.value ? Number(e.target.value) : '')} required>
                    <option value="" disabled>选择…</option>
                    {locations.filter((l) => l.id !== fromLoc).map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">数量</span>
                  <input type="number" min={0} step="0.0001" className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm"
                    value={qty} onChange={(e) => setQty(e.target.value)} required />
                </label>
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium disabled:opacity-50">{busy ? '过账中…' : '过账调拨'}</button>
                <button type="button" onClick={closeForms} className="px-4 py-2 rounded-lg border text-sm">取消</button>
              </div>
            </form>
          )}

          {mode === 'adjust' && (
            <form onSubmit={submitAdjust} className="bg-white border-2 border-slate-400 rounded-xl p-4 mb-5 space-y-3">
              <h2 className="font-semibold text-slate-800 text-sm">库存调整（增减量单位：{baseUom || '基础单位'}；负数=减少，不可调到负库存）</h2>
              <div className="grid sm:grid-cols-3 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">库位</span>
                  <select className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm bg-white" value={adjLoc}
                    onChange={(e) => setAdjLoc(e.target.value ? Number(e.target.value) : '')} required>
                    <option value="" disabled>选择…</option>
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">增减量（+/-）</span>
                  <input type="number" step="0.0001" className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm"
                    value={delta} onChange={(e) => setDelta(e.target.value)} required />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">原因</span>
                  <input className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="如：盘盈/损耗"
                    value={reason} onChange={(e) => setReason(e.target.value)} required />
                </label>
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium disabled:opacity-50">{busy ? '过账中…' : '过账调整'}</button>
                <button type="button" onClick={closeForms} className="px-4 py-2 rounded-lg border text-sm">取消</button>
              </div>
            </form>
          )}

          {mode === 'release' && (
            <form onSubmit={submitRelease} className="bg-white border-2 border-emerald-400 rounded-xl p-4 mb-5 space-y-3">
              <h2 className="font-semibold text-emerald-800 text-sm">放行（COA result=pass，状态 quarantine → available）</h2>
              <div className="grid sm:grid-cols-4 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">检测日期</span>
                  <input type="date" className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm"
                    value={testDate} onChange={(e) => setTestDate(e.target.value)} />
                  <span className="text-[10px] text-slate-500">留空=今天</span>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">检测员（可空）</span>
                  <input className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm"
                    value={testedBy} onChange={(e) => setTestedBy(e.target.value)} />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">单据号（可空）</span>
                  <input className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm"
                    placeholder="如检测报告 PDF 文件名" value={documentRef} onChange={(e) => setDocumentRef(e.target.value)} />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">备注（可空）</span>
                  <input className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm"
                    value={releaseNotes} onChange={(e) => setReleaseNotes(e.target.value)} />
                </label>
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium disabled:opacity-50">{busy ? '提交中…' : '确认放行'}</button>
                <button type="button" onClick={closeForms} className="px-4 py-2 rounded-lg border text-sm">取消</button>
              </div>
            </form>
          )}

          {mode === 'reject' && (
            <form onSubmit={submitReject} className="bg-white border-2 border-rose-400 rounded-xl p-4 mb-5 space-y-3">
              <h2 className="font-semibold text-rose-800 text-sm">拒收（COA result=fail，状态 → rejected；后续 issue/ship/consume 将被 BR-W4 拦截）</h2>
              <div className="grid sm:grid-cols-4 gap-3">
                <label className="block sm:col-span-2">
                  <span className="text-xs font-medium text-slate-700">拒收原因 *</span>
                  <input className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm"
                    placeholder="如：密封破损 / 含菌超标"
                    value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} required />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">检测日期</span>
                  <input type="date" className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm"
                    value={testDate} onChange={(e) => setTestDate(e.target.value)} />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">检测员（可空）</span>
                  <input className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm"
                    value={testedBy} onChange={(e) => setTestedBy(e.target.value)} />
                </label>
              </div>
              <p className="text-[10px] text-slate-500">注：物理库存留在原位置，需手动调拨到 LOC-NG。</p>
              <div className="flex gap-2">
                <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium disabled:opacity-50">{busy ? '提交中…' : '确认拒收'}</button>
                <button type="button" onClick={closeForms} className="px-4 py-2 rounded-lg border text-sm">取消</button>
              </div>
            </form>
          )}

          {/* current balances by location */}
          <h2 className="text-sm font-bold text-slate-700 mb-2">当前库存（按库位）</h2>
          <div className="overflow-hidden rounded-xl border bg-white mb-6">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-semibold px-4 py-2.5">库位</th>
                  <th className="text-right font-semibold px-4 py-2.5">在库</th>
                  <th className="text-left font-semibold px-4 py-2.5 pl-3">单位</th>
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
                  <tr><td colSpan={3} className="px-4 py-4 text-center text-slate-500">该批次当前无在库</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* timeline */}
          <h2 className="text-sm font-bold text-slate-700 mb-2">流水时间线</h2>
          <div className="overflow-hidden rounded-xl border bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-semibold px-4 py-2.5">时间</th>
                  <th className="text-left font-semibold px-4 py-2.5">类型</th>
                  <th className="text-left font-semibold px-4 py-2.5">库位</th>
                  <th className="text-right font-semibold px-4 py-2.5">数量</th>
                  <th className="text-left font-semibold px-4 py-2.5 pl-3">备注</th>
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
                  <tr><td colSpan={5} className="px-4 py-4 text-center text-slate-500">暂无流水</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* COA history (release/reject records for this lot) */}
          {coaHistory.length > 0 && (
            <>
              <h2 className="text-sm font-bold text-slate-700 mb-2 mt-6">质检记录（COA）</h2>
              <div className="overflow-hidden rounded-xl border bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                    <tr>
                      <th className="text-left font-semibold px-4 py-2.5">COA 号</th>
                      <th className="text-left font-semibold px-4 py-2.5">日期</th>
                      <th className="text-left font-semibold px-4 py-2.5">结果</th>
                      <th className="text-left font-semibold px-4 py-2.5">检测员</th>
                      <th className="text-left font-semibold px-4 py-2.5">单据</th>
                      <th className="text-left font-semibold px-4 py-2.5">备注</th>
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

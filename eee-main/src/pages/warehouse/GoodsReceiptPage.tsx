import React, { FormEvent, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  listGoodsReceipts,
  listItems,
  listUoms,
  listLocations,
  postReceipt,
  GoodsReceiptRow,
  WarehouseItem,
  Uom,
  WarehouseLocation,
  ReceiptLineInput,
  LotStatus,
} from '../../services/warehouseApi';
import { usePermissions } from '../../contexts/PermissionContext';
import { cn } from '../../lib/utils';

interface FormLine {
  item_id: number | '';
  quantity: string;
  uom_id: number | '';
  location_id: number | '';
  lot_status: LotStatus;
  lot_number: string;
  expiry_date: string;
  unit_cost: string;
}

const emptyLine = (): FormLine => ({
  item_id: '', quantity: '', uom_id: '', location_id: '',
  lot_status: 'available', lot_number: '', expiry_date: '', unit_cost: '',
});

export default function GoodsReceiptPage() {
  const { can } = usePermissions();
  const canCreate = can('warehouse', 'goods_receipt', 'create');

  const [receipts, setReceipts] = useState<GoodsReceiptRow[]>([]);
  const [items, setItems] = useState<WarehouseItem[]>([]);
  const [uoms, setUoms] = useState<Uom[]>([]);
  const [locations, setLocations] = useState<WarehouseLocation[]>([]);
  const [creating, setCreating] = useState(false);
  const [lines, setLines] = useState<FormLine[]>([emptyLine()]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => listGoodsReceipts().then(setReceipts).catch((e) => setError(e.message));

  useEffect(() => {
    load();
    listItems().then((all) => setItems(all.filter((i) => i.status === 'active'))).catch(() => {});
    listUoms().then(setUoms).catch(() => {});
    listLocations().then(setLocations).catch(() => {});
  }, []);

  const defaultLocationId = () => locations.find((l) => l.code === 'LOC-RM')?.id ?? locations[0]?.id ?? '';

  const startCreate = () => {
    const l = emptyLine();
    l.location_id = defaultLocationId();
    setLines([l]);
    setCreating(true);
    setMsg(''); setError('');
  };
  const cancel = () => { setCreating(false); setLines([emptyLine()]); };

  const setLine = (idx: number, patch: Partial<FormLine>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  const onPickItem = (idx: number, itemId: number) => {
    const it = items.find((x) => x.id === itemId);
    setLine(idx, { item_id: itemId, uom_id: it ? it.base_uom_id : '' });
  };
  const addLine = () => setLines((prev) => [...prev, { ...emptyLine(), location_id: defaultLocationId() }]);
  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const payload: ReceiptLineInput[] = [];
    for (const [i, l] of lines.entries()) {
      if (l.item_id === '' || l.uom_id === '' || l.location_id === '' || !l.quantity) {
        setError(`第 ${i + 1} 行：物料、数量、单位、库位为必填`); return;
      }
      if (Number(l.quantity) <= 0) { setError(`第 ${i + 1} 行：数量必须为正`); return; }
      payload.push({
        item_id: Number(l.item_id),
        quantity: Number(l.quantity),
        uom_id: Number(l.uom_id),
        location_id: Number(l.location_id),
        lot_status: l.lot_status,
        lot_number: l.lot_number.trim() || null,
        expiry_date: l.expiry_date || null,
        unit_cost: l.unit_cost ? Number(l.unit_cost) : null,
      });
    }
    setBusy(true);
    try {
      const res = await postReceipt({ lines: payload });
      setMsg(`收货单 ${res.grn_number} 已过账（${res.line_count} 行）`);
      cancel();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '过账失败');
    }
    setBusy(false);
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Goods Receipt</h1>
      <p className="text-slate-600 mb-4 text-sm">无 PO 直接收货（direct）。过账即写入只增流水并更新余额。</p>

      {msg && <p className="text-emerald-700 bg-emerald-50 p-2 rounded-lg mb-3 text-sm">{msg}</p>}
      {error && <p className="text-red-600 mb-3 text-sm">{error}</p>}

      {canCreate && (
        <div className="mb-4">
          <button
            type="button"
            onClick={creating ? cancel : startCreate}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold',
              creating ? 'bg-slate-200 text-slate-700' : 'bg-emerald-600 hover:bg-emerald-500 text-white',
            )}
          >
            <Plus size={13} /> {creating ? '取消' : '新建收货单'}
          </button>
        </div>
      )}

      {creating && (
        <form onSubmit={submit} className="bg-white border-2 border-emerald-400 rounded-xl p-4 mb-6 space-y-3 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-emerald-800 text-sm">新建直接收货单</h2>
            <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-amber-100 text-amber-700">DIRECT · 无 PO</span>
          </div>

          {lines.map((l, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-end border-b border-slate-100 pb-3">
              <label className="col-span-3 block">
                <span className="text-[11px] font-medium text-slate-600">物料</span>
                <select
                  className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm bg-white"
                  value={l.item_id}
                  onChange={(e) => onPickItem(idx, Number(e.target.value))}
                  required
                >
                  <option value="" disabled>选择…</option>
                  {items.map((it) => <option key={it.id} value={it.id}>{it.sku} · {it.name}</option>)}
                </select>
              </label>
              <label className="col-span-1 block">
                <span className="text-[11px] font-medium text-slate-600">数量</span>
                <input type="number" min={0} step="0.0001" className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm"
                  value={l.quantity} onChange={(e) => setLine(idx, { quantity: e.target.value })} required />
              </label>
              <label className="col-span-2 block">
                <span className="text-[11px] font-medium text-slate-600">单位</span>
                <select className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm bg-white"
                  value={l.uom_id} onChange={(e) => setLine(idx, { uom_id: Number(e.target.value) })} required>
                  <option value="" disabled>—</option>
                  {uoms.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
                </select>
              </label>
              <label className="col-span-2 block">
                <span className="text-[11px] font-medium text-slate-600">库位</span>
                <select className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm bg-white"
                  value={l.location_id} onChange={(e) => setLine(idx, { location_id: Number(e.target.value) })} required>
                  <option value="" disabled>—</option>
                  {locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.code}</option>)}
                </select>
              </label>
              <label className="col-span-2 block">
                <span className="text-[11px] font-medium text-slate-600">批次状态</span>
                <select className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm bg-white"
                  value={l.lot_status} onChange={(e) => setLine(idx, { lot_status: e.target.value as LotStatus })}>
                  <option value="available">available</option>
                  <option value="quarantine">quarantine</option>
                </select>
              </label>
              <div className="col-span-2 flex items-center gap-1">
                <label className="block flex-1">
                  <span className="text-[11px] font-medium text-slate-600">保质期(可空)</span>
                  <input type="date" className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm"
                    value={l.expiry_date} onChange={(e) => setLine(idx, { expiry_date: e.target.value })} />
                </label>
                {lines.length > 1 && (
                  <button type="button" onClick={() => removeLine(idx)} className="text-red-500 hover:text-red-600 mb-1.5" title="删除行">
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between pt-1">
            <button type="button" onClick={addLine} className="text-emerald-700 hover:text-emerald-800 text-xs font-bold flex items-center gap-1">
              <Plus size={12} /> 添加行
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={cancel} className="px-4 py-2 rounded-lg border text-sm">取消</button>
              <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium disabled:opacity-50">
                {busy ? '过账中…' : '过账收货'}
              </button>
            </div>
          </div>
          <p className="text-[10px] text-slate-500">提示：批次号留空将自动生成（RM-日期-序号）；单位默认物料基础单位，非基础单位需已配置换算。</p>
        </form>
      )}

      <div className="overflow-hidden rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left font-semibold px-4 py-2.5">收货单号</th>
              <th className="text-left font-semibold px-4 py-2.5">类型</th>
              <th className="text-left font-semibold px-4 py-2.5">日期</th>
              <th className="text-left font-semibold px-4 py-2.5">状态</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {receipts.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2.5 font-mono text-slate-800">{r.grn_number}</td>
                <td className="px-4 py-2.5">
                  {r.receipt_type === 'direct' ? (
                    <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">DIRECT</span>
                  ) : (
                    <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">PO</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-slate-700">{r.receipt_date}</td>
                <td className="px-4 py-2.5 text-slate-600">{r.status}</td>
              </tr>
            ))}
            {receipts.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-500">暂无收货单</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

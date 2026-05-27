import React, { useEffect, useState } from 'react';
import { listBalance, listLocations, WarehouseBalance, WarehouseLocation } from '../../services/warehouseApi';

const LOT_STATUS_BADGE: Record<string, string> = {
  available: 'bg-emerald-100 text-emerald-700',
  quarantine: 'bg-amber-100 text-amber-700',
  on_hold: 'bg-rose-100 text-rose-700',
  rejected: 'bg-rose-100 text-rose-700',
  expired: 'bg-slate-200 text-slate-600',
  consumed: 'bg-slate-100 text-slate-500',
};

export default function BalancePage({ onOpenLot }: { onOpenLot?: (lotId: number) => void }) {
  const [rows, setRows] = useState<WarehouseBalance[]>([]);
  const [locations, setLocations] = useState<WarehouseLocation[]>([]);
  const [locationId, setLocationId] = useState<number | ''>('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    listBalance(locationId ? { locationId: Number(locationId) } : {})
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    listLocations().then(setLocations).catch(() => {});
  }, []);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [locationId]);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Inventory Balance</h1>
      <p className="text-slate-600 mb-4 text-sm">按物料 / 批次 / 库位的实时余额（派生自只增流水）。</p>

      {error && <p className="text-red-600 mb-3 text-sm">{error}</p>}

      <div className="flex items-center gap-2 mb-4">
        <label className="text-xs font-medium text-slate-700">库区筛选</label>
        <select
          className="border rounded-lg px-3 py-1.5 text-sm bg-white"
          value={locationId}
          onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : '')}
        >
          <option value="">全部库区</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.code} · {l.name}</option>)}
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left font-semibold px-4 py-2.5">物料</th>
              <th className="text-left font-semibold px-4 py-2.5">批次</th>
              <th className="text-left font-semibold px-4 py-2.5">库位</th>
              <th className="text-right font-semibold px-4 py-2.5">在库</th>
              <th className="text-right font-semibold px-4 py-2.5">可用</th>
              <th className="text-left font-semibold px-4 py-2.5 pl-3">单位</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={`${r.item_id}-${r.lot_id}-${r.location_id}`}>
                <td className="px-4 py-2.5">
                  <div className="text-slate-800">{r.item_name}</div>
                  <div className="text-xs text-slate-500 font-mono">{r.item_sku}</div>
                </td>
                <td className="px-4 py-2.5">
                  {r.lot_id != null && onOpenLot ? (
                    <button
                      type="button"
                      onClick={() => onOpenLot(r.lot_id as number)}
                      className="font-mono text-emerald-700 hover:text-emerald-800 hover:underline"
                    >
                      {r.lot_number ?? '—'}
                    </button>
                  ) : (
                    <span className="font-mono text-slate-800">{r.lot_number ?? '—'}</span>
                  )}
                  {r.lot_status && (
                    <span className={`ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded ${LOT_STATUS_BADGE[r.lot_status] ?? 'bg-slate-100 text-slate-600'}`}>
                      {r.lot_status}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 font-mono text-slate-700">{r.location_code}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-900">{r.quantity_on_hand}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-900">{r.quantity_available}</td>
                <td className="px-4 py-2.5 pl-3 text-slate-600">{r.base_uom}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">暂无库存</td></tr>
            )}
            {loading && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">加载中…</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, Search } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  listBalance,
  listLocations,
  listItems,
  WarehouseBalance,
  WarehouseLocation,
  WarehouseItem,
} from '../../services/warehouseApi';

const LOT_STATUS_BADGE: Record<string, string> = {
  available: 'bg-emerald-100 text-emerald-700',
  quarantine: 'bg-amber-100 text-amber-700',
  on_hold: 'bg-rose-100 text-rose-700',
  rejected: 'bg-rose-100 text-rose-700',
  expired: 'bg-slate-200 text-slate-600',
  consumed: 'bg-slate-100 text-slate-500',
};

interface ItemGroup {
  itemId: number;
  itemSku: string;
  itemName: string;
  baseUom: string;
  rows: WarehouseBalance[];
  totalOnHand: number;
  totalAvailable: number;
  lotCount: number;
  locationCount: number;
}

export default function BalancePage({ onOpenLot }: { onOpenLot?: (lotId: number) => void }) {
  const [rows, setRows] = useState<WarehouseBalance[]>([]);
  const [locations, setLocations] = useState<WarehouseLocation[]>([]);
  const [items, setItems] = useState<WarehouseItem[]>([]);
  const [locationId, setLocationId] = useState<number | ''>('');
  const [itemId, setItemId] = useState<number | ''>('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const load = () => {
    setLoading(true);
    const filters: { locationId?: number; itemId?: number } = {};
    if (locationId) filters.locationId = Number(locationId);
    if (itemId) filters.itemId = Number(itemId);
    listBalance(filters)
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    listLocations().then(setLocations).catch(() => {});
    listItems().then((all) => setItems(all.filter((i) => i.status === 'active'))).catch(() => {});
  }, []);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [locationId, itemId]);

  // Group rows by item_id, preserving server order; compute per-item totals.
  const groups = useMemo<ItemGroup[]>(() => {
    const map = new Map<number, ItemGroup & { _lots: Set<number>; _locs: Set<number> }>();
    for (const r of rows) {
      let g = map.get(r.item_id);
      if (!g) {
        g = {
          itemId: r.item_id,
          itemSku: r.item_sku,
          itemName: r.item_name,
          baseUom: r.base_uom,
          rows: [],
          totalOnHand: 0,
          totalAvailable: 0,
          lotCount: 0,
          locationCount: 0,
          _lots: new Set<number>(),
          _locs: new Set<number>(),
        };
        map.set(r.item_id, g);
      }
      g.rows.push(r);
      g.totalOnHand += Number(r.quantity_on_hand);
      g.totalAvailable += Number(r.quantity_available);
      if (r.lot_id != null) g._lots.add(r.lot_id);
      g._locs.add(r.location_id);
    }
    return Array.from(map.values()).map((g) => ({
      ...g,
      lotCount: g._lots.size,
      locationCount: g._locs.size,
    }));
  }, [rows]);

  // Client-side text filter on the rollup (useful when 20+ items).
  const filteredGroups = useMemo<ItemGroup[]>(() => {
    if (!search.trim()) return groups;
    const q = search.toLowerCase();
    return groups.filter(
      (g) => g.itemSku.toLowerCase().includes(q) || g.itemName.toLowerCase().includes(q),
    );
  }, [groups, search]);

  // Auto-expand the single visible group (when API or search filter narrows to one item).
  useEffect(() => {
    if (filteredGroups.length === 1) {
      setExpanded(new Set([filteredGroups[0].itemId]));
    }
  }, [filteredGroups]);

  const expandAll = () => setExpanded(new Set(filteredGroups.map((g) => g.itemId)));
  const collapseAll = () => setExpanded(new Set());
  const allExpanded = filteredGroups.length > 0 && filteredGroups.every((g) => expanded.has(g.itemId));

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Inventory Balance</h1>
      <p className="text-slate-600 mb-4 text-sm">按物料 / 批次 / 库位的实时余额（派生自只增流水）。</p>

      {error && <p className="text-red-600 mb-3 text-sm">{error}</p>}

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-slate-700">物料筛选</label>
          <select
            className="border rounded-lg px-3 py-1.5 text-sm bg-white"
            value={itemId}
            onChange={(e) => setItemId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">全部物料</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.sku} · {i.name}</option>)}
          </select>
        </div>
        {(itemId || locationId) && (
          <button
            type="button"
            onClick={() => { setItemId(''); setLocationId(''); }}
            className="text-xs text-slate-500 hover:text-slate-800 underline"
          >
            清除筛选
          </button>
        )}
      </div>

      {/* Search + expand/collapse all */}
      <div className="flex items-center gap-3 mb-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="搜索物料（SKU 或名称）…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border rounded-lg pl-8 pr-3 py-1.5 text-sm"
          />
        </div>
        {filteredGroups.length > 0 && (
          <button
            type="button"
            onClick={allExpanded ? collapseAll : expandAll}
            className="text-xs text-slate-600 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-100"
          >
            {allExpanded ? '全部收起' : '全部展开'}
          </button>
        )}
        <span className="text-xs text-slate-500">
          {filteredGroups.length} 物料 · {rows.length} 明细行
        </span>
      </div>

      <div className="flex gap-4 items-start">
        <div className="flex-1 overflow-hidden rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left font-semibold px-4 py-2.5 w-[40%]">物料 / 批次</th>
              <th className="text-left font-semibold px-4 py-2.5">库位</th>
              <th className="text-right font-semibold px-4 py-2.5">在库</th>
              <th className="text-right font-semibold px-4 py-2.5">可用</th>
              <th className="text-left font-semibold px-4 py-2.5 pl-3">单位</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredGroups.map((g) => {
              const isOpen = expanded.has(g.itemId);
              return (
                <React.Fragment key={g.itemId}>
                  {/* Item rollup row (one row per item — always visible) */}
                  <tr
                    onClick={() => toggleExpand(g.itemId)}
                    className="bg-slate-50/50 hover:bg-emerald-50/40 cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {isOpen ? <ChevronDown size={14} className="text-slate-500 shrink-0" />
                                : <ChevronRight size={14} className="text-slate-500 shrink-0" />}
                        <div>
                          <div className="font-semibold text-slate-900">{g.itemName}</div>
                          <div className="text-xs text-slate-500 font-mono">{g.itemSku}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {g.lotCount} 批次 · {g.locationCount} 库位
                      {g.totalOnHand > g.totalAvailable && (
                        <span className="ml-1 text-amber-700 font-semibold">
                          · 冻结 {g.totalOnHand - g.totalAvailable}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-bold text-emerald-700">{g.totalOnHand}</td>
                    <td className={cn(
                      'px-4 py-3 text-right tabular-nums font-semibold',
                      g.totalAvailable < g.totalOnHand ? 'text-amber-700' : 'text-emerald-700',
                    )}>{g.totalAvailable}</td>
                    <td className="px-4 py-3 pl-3 text-slate-600">{g.baseUom}</td>
                  </tr>

                  {/* Expanded detail rows (per batch × location) */}
                  {isOpen && g.rows.map((r) => (
                    <tr key={`${r.item_id}-${r.lot_id}-${r.location_id}`} className="bg-white">
                      <td className="px-4 py-2 pl-12">
                        {r.lot_id != null && onOpenLot ? (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onOpenLot(r.lot_id as number); }}
                            className="font-mono text-emerald-700 hover:text-emerald-800 hover:underline text-xs"
                          >
                            {r.lot_number ?? '—'}
                          </button>
                        ) : (
                          <span className="font-mono text-slate-700 text-xs">{r.lot_number ?? '—'}</span>
                        )}
                        {r.lot_status && (
                          <span className={`ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded ${LOT_STATUS_BADGE[r.lot_status] ?? 'bg-slate-100 text-slate-600'}`}>
                            {r.lot_status}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 font-mono text-slate-700 text-xs">{r.location_code}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-800">{r.quantity_on_hand}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-800">{r.quantity_available}</td>
                      <td className="px-4 py-2 pl-3 text-slate-500 text-xs">{r.base_uom}</td>
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}
            {!loading && filteredGroups.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                {search ? '无匹配物料' : '暂无库存'}
              </td></tr>
            )}
            {loading && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">加载中…</td></tr>
            )}
          </tbody>
        </table>
        </div>

        {/* Location tabs (replaces the dropdown filter) */}
        <aside className="w-44 shrink-0 sticky top-4">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 px-1">库位</div>
          <div className="rounded-xl border bg-white overflow-hidden">
            <LocationTab label="全部" isActive={locationId === ''} onClick={() => setLocationId('')} />
            <div className="h-px bg-slate-100" />
            {locations.map((l) => (
              <LocationTab
                key={l.id}
                code={l.code}
                name={l.name ?? ''}
                type={l.location_type}
                isActive={locationId === l.id}
                onClick={() => setLocationId(l.id)}
              />
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

const TYPE_DOT: Record<string, string> = {
  storage: 'bg-emerald-400',
  production: 'bg-amber-400',
  quarantine: 'bg-rose-400',
  receiving: 'bg-sky-400',
  shipping: 'bg-violet-400',
};

function LocationTab({
  code, name, type, label, isActive, onClick,
}: {
  code?: string;
  name?: string;
  type?: string;
  label?: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left px-3 py-2 text-sm transition-colors relative block',
        isActive
          ? 'bg-emerald-50 text-emerald-900 font-semibold'
          : 'text-slate-700 hover:bg-slate-50',
      )}
    >
      {isActive && <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500" />}
      {label ? (
        <span>{label}</span>
      ) : (
        <div className="flex items-center gap-2">
          {type && <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', TYPE_DOT[type] ?? 'bg-slate-300')} />}
          <div className="min-w-0 flex-1">
            <div className="font-mono text-xs">{code}</div>
            {name && <div className="text-[10px] text-slate-500 truncate">{name}</div>}
          </div>
        </div>
      )}
    </button>
  );
}

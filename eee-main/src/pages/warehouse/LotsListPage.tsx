import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listLots, listItems, WarehouseLot, WarehouseItem } from '../../services/warehouseApi';

const LOT_STATUS_BADGE: Record<string, string> = {
  available: 'bg-emerald-100 text-emerald-700',
  quarantine: 'bg-amber-100 text-amber-700',
  on_hold: 'bg-rose-100 text-rose-700',
  rejected: 'bg-rose-100 text-rose-700',
  expired: 'bg-slate-200 text-slate-600',
  consumed: 'bg-slate-100 text-slate-500',
};

export default function LotsListPage({ onOpenLot }: { onOpenLot: (lotId: number) => void }) {
  const { t } = useTranslation('warehouse');
  const [lots, setLots] = useState<WarehouseLot[]>([]);
  const [itemMap, setItemMap] = useState<Record<number, WarehouseItem>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    listLots().then(setLots).catch((e) => setError(e.message));
    listItems().then((all) => {
      const m: Record<number, WarehouseItem> = {};
      all.forEach((i) => { m[i.id] = i; });
      setItemMap(m);
    }).catch(() => {});
  }, []);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">{t('lotsListPage.title')}</h1>
      <p className="text-slate-600 mb-4 text-sm">{t('lotsListPage.subtitle')}</p>

      {error && <p className="text-red-600 mb-3 text-sm">{error}</p>}

      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left font-semibold px-4 py-2.5">{t('lotsListPage.colLotNumber')}</th>
              <th className="text-left font-semibold px-4 py-2.5">{t('lotsListPage.colItem')}</th>
              <th className="text-left font-semibold px-4 py-2.5">{t('lotsListPage.colSource')}</th>
              <th className="text-left font-semibold px-4 py-2.5">{t('lotsListPage.colStatus')}</th>
              <th className="text-left font-semibold px-4 py-2.5">{t('lotsListPage.colExpiry')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lots.map((l) => {
              const it = itemMap[l.item_id];
              return (
                <tr key={l.id}>
                  <td className="px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => onOpenLot(l.id)}
                      className="font-mono text-emerald-700 hover:text-emerald-800 hover:underline"
                    >
                      {l.lot_number}
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    {it ? <span className="text-slate-800">{it.sku} · {it.name}</span> : <span className="text-slate-500">#{l.item_id}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{l.source_type}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${LOT_STATUS_BADGE[l.status] ?? 'bg-slate-100 text-slate-600'}`}>
                      {l.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{l.expiry_date ?? '—'}</td>
                </tr>
              );
            })}
            {lots.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">{t('lotsListPage.empty')}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

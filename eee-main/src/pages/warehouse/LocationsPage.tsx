import React, { useEffect, useState } from 'react';
import { listLocations, WarehouseLocation } from '../../services/warehouseApi';

const TYPE_LABEL: Record<string, string> = {
  storage: '存储',
  receiving: '收货',
  shipping: '发货',
  production: '生产',
  quarantine: '隔离/待检',
};

const TYPE_BADGE: Record<string, string> = {
  storage: 'bg-emerald-100 text-emerald-700',
  production: 'bg-amber-100 text-amber-700',
  quarantine: 'bg-rose-100 text-rose-700',
  receiving: 'bg-sky-100 text-sky-700',
  shipping: 'bg-violet-100 text-violet-700',
};

export default function LocationsPage() {
  const [locations, setLocations] = useState<WarehouseLocation[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    listLocations().then(setLocations).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Locations</h1>
      <p className="text-slate-600 mb-4 text-sm">
        主工厂的逻辑库区（只读）。维护功能将在后续 Sprint 开放。
      </p>

      {error && <p className="text-red-600 mb-3 text-sm">{error}</p>}

      <div className="overflow-hidden rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left font-semibold px-4 py-2.5">代码</th>
              <th className="text-left font-semibold px-4 py-2.5">名称</th>
              <th className="text-left font-semibold px-4 py-2.5">类型</th>
              <th className="text-left font-semibold px-4 py-2.5">状态</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {locations.map((loc) => (
              <tr key={loc.id}>
                <td className="px-4 py-2.5 font-mono text-slate-800">{loc.code}</td>
                <td className="px-4 py-2.5 text-slate-800">{loc.name ?? '—'}</td>
                <td className="px-4 py-2.5">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${TYPE_BADGE[loc.location_type] ?? 'bg-slate-100 text-slate-600'}`}>
                    {TYPE_LABEL[loc.location_type] ?? loc.location_type}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-slate-600">{loc.is_active ? '启用' : '停用'}</td>
              </tr>
            ))}
            {locations.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-500">暂无库区</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

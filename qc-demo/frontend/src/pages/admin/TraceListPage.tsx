import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ProductionLot } from '../../api/client';
import { AppShell } from '../../components/AppShell';

export function TraceListPage() {
  const [lots, setLots] = useState<ProductionLot[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.productionLots().then(setLots).catch((e) => setError(e.message));
  }, []);

  return (
    <AppShell variant="admin" title="批次追溯">
      <p className="text-sm text-slate-600 mb-4">选择生产批查看烘干子批与质量事件时间线。</p>
      {error && <p className="text-red-600 mb-4">{error}</p>}
      <ul className="space-y-3">
        {lots.map((lot) => (
          <li key={lot.id}>
            <Link
              to={`/admin/trace/${lot.id}`}
              className="block bg-white rounded-xl border p-4 hover:border-blue-400 min-h-[44px]"
            >
              <div className="font-semibold">{lot.lot_number}</div>
              <p className="text-sm text-slate-600 mt-1">
                {lot.sku_name} · {lot.lot_barcode}
              </p>
            </Link>
          </li>
        ))}
        {lots.length === 0 && <p className="text-slate-500">暂无生产批</p>}
      </ul>
    </AppShell>
  );
}

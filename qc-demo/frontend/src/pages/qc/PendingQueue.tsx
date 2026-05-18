import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, SubLot } from '../../api/client';
import { Layout } from '../../components/Layout';
import { StatusBadge } from '../../components/StatusBadge';
import { cn } from '../../lib/utils';

export function PendingQueue() {
  const [items, setItems] = useState<SubLot[]>([]);
  const [error, setError] = useState('');

  const load = () => api.pending().then(setItems).catch((e) => setError(e.message));

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <Layout nav={[{ to: '/qc', label: '首页' }, { to: '/qc/lots', label: '生产批' }]}>
      <h1 className="text-2xl font-bold mb-4">待检队列</h1>
      {error && <p className="text-red-600">{error}</p>}
      <ul className="space-y-3">
        {items.map((s) => (
          <li key={s.id}>
            <Link
              to={`/qc/inspect/${s.id}`}
              className={cn(
                'block bg-white rounded-xl border-2 p-4 min-h-[44px]',
                (s.wait_minutes ?? 0) > 120 ? 'border-amber-500 bg-amber-50' : 'border-slate-200'
              )}
            >
              <div className="flex justify-between items-start gap-2">
                <div>
                  <div className="font-semibold text-lg">{s.sub_lot_code}</div>
                  <p className="text-sm text-slate-600">{s.sku_name} · {s.location_name}</p>
                </div>
                <StatusBadge status={s.status} />
              </div>
              {s.wait_minutes != null && (
                <p className="text-sm mt-2 text-amber-800">已等待 {s.wait_minutes} 分钟</p>
              )}
            </Link>
          </li>
        ))}
        {items.length === 0 && <p className="text-slate-500">暂无待检子批</p>}
      </ul>
    </Layout>
  );
}

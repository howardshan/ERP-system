import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, SubLot } from '../../api/client';
import { AppShell } from '../../components/AppShell';
import { StatusBadge } from '../../components/StatusBadge';
import { cn, formatDateTime } from '../../lib/utils';

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
    <AppShell variant="qc" title="Pending Queue">
      <p className="text-sm text-slate-500 mb-4">Sorted by check-out time · refreshes every 5s</p>
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
                  <p className="text-sm text-slate-600">
                    {s.sku_name} · {s.location_name}
                  </p>
                </div>
                <StatusBadge status={s.status} />
              </div>
              <div className="text-sm mt-2 text-slate-600 space-y-0.5">
                <p>In: {formatDateTime(s.in_time)}</p>
                <p>Out: {formatDateTime(s.out_time)}</p>
                {s.wait_minutes != null && (
                  <p className="text-amber-800 font-medium">Waiting {s.wait_minutes} min</p>
                )}
              </div>
            </Link>
          </li>
        ))}
        {items.length === 0 && <p className="text-slate-500">No pending sub-lots</p>}
      </ul>
    </AppShell>
  );
}

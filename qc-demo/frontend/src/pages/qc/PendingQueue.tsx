import { useEffect, useState } from 'react';
import { ChevronRight, ClipboardCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, SubLot } from '../../api/client';
import { AppShell } from '../../components/AppShell';
import { StatusBadge } from '../../components/StatusBadge';
import { Alert, Card, EmptyState, PageHeader } from '../../components/ui';
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
    <AppShell variant="qc">
      <PageHeader
        title="Pending Queue"
        description="Sorted by check-out time · refreshes every 5s"
      />
      {error && (
        <div className="mb-4">
          <Alert variant="error">{error}</Alert>
        </div>
      )}
      <ul className="space-y-3">
        {items.map((s) => {
          const urgent = (s.wait_minutes ?? 0) > 120;
          return (
            <li key={s.id}>
              <Link to={`/qc/inspect/${s.id}`} className="block group">
                <Card
                  variant="interactive"
                  className={cn(
                    'p-4 min-h-[44px] border-l-4',
                    urgent ? 'border-l-amber-500 bg-amber-50/50 ring-amber-200' : 'border-l-teal-500'
                  )}
                >
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-lg text-slate-900 group-hover:text-teal-800 font-mono">
                        {s.sub_lot_code}
                      </div>
                      <p className="text-sm text-slate-600">
                        {s.sku_name} · {s.location_name}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <StatusBadge status={s.status} />
                      <ChevronRight className="h-5 w-5 text-slate-300 group-hover:text-teal-600" />
                    </div>
                  </div>
                  <div className="text-sm mt-2 text-slate-600 space-y-0.5">
                    <p>In: {formatDateTime(s.in_time)}</p>
                    <p>Out: {formatDateTime(s.out_time)}</p>
                    {s.wait_minutes != null && (
                      <p
                        className={cn(
                          'font-medium inline-flex items-center gap-1.5 mt-1',
                          urgent ? 'text-amber-900' : 'text-slate-700'
                        )}
                      >
                        {urgent && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-200 text-amber-900">
                            Urgent
                          </span>
                        )}
                        Waiting {s.wait_minutes} min
                      </p>
                    )}
                  </div>
                </Card>
              </Link>
            </li>
          );
        })}
        {items.length === 0 && (
          <EmptyState
            icon={ClipboardCheck}
            title="No pending sub-lots"
            description="Sub-lots will appear here after check-out from drying."
          />
        )}
      </ul>
    </AppShell>
  );
}

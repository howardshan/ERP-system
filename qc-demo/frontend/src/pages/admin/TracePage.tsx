import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { AppShell } from '../../components/AppShell';
import { StatusBadge } from '../../components/StatusBadge';
import { cn, formatDateTime } from '../../lib/utils';

const FAIL_EVENTS = new Set(['inspection_failed_hold']);

export function TracePage() {
  const { lotId } = useParams<{ lotId: string }>();
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof api.productionLotDetail>> | null>(null);

  useEffect(() => {
    if (lotId) api.productionLotDetail(lotId).then(setDetail);
  }, [lotId]);

  if (!detail) return <AppShell variant="admin">Loading…</AppShell>;

  return (
    <AppShell variant="admin" title={`Trace · ${detail.lot.lot_number}`}>
      <p className="text-slate-600 mb-4">{detail.lot.sku_name}</p>

      <h2 className="font-semibold mb-2">Drying sub-lots</h2>
      <ul className="space-y-2 mb-6">
        {detail.sub_lots.map((s) => (
          <li key={s.id} className="bg-white border rounded-xl p-3">
            <div className="flex justify-between items-center mb-1">
              <span className="font-medium">{s.sub_lot_code}</span>
              <StatusBadge status={s.status} />
            </div>
            <p className="text-sm text-slate-600">
              In {formatDateTime(s.in_time)} · Out {formatDateTime(s.out_time)}
            </p>
          </li>
        ))}
      </ul>

      <h2 className="font-semibold mb-2">Quality events</h2>
      <ul className="space-y-2 text-sm">
        {detail.events.map((ev) => (
          <li
            key={ev.id}
            className={cn(
              'rounded-xl border p-3',
              FAIL_EVENTS.has(ev.event_type)
                ? 'bg-red-50 border-red-200'
                : 'bg-slate-50 border-slate-200'
            )}
          >
            <p
              className={cn(
                'font-medium leading-snug',
                FAIL_EVENTS.has(ev.event_type) ? 'text-red-900' : 'text-slate-800'
              )}
            >
              {ev.summary}
            </p>
            <p className="text-xs text-slate-500 mt-1.5">{formatDateTime(ev.created_at)}</p>
          </li>
        ))}
        {detail.events.length === 0 && <p className="text-slate-500">No events</p>}
      </ul>

      <Link to="/admin/trace" className="inline-block mt-6 text-blue-600 min-h-[44px] flex items-center">
        Back to batch list
      </Link>
    </AppShell>
  );
}

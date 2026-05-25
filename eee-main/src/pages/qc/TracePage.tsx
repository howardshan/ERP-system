import React, { useEffect, useState } from 'react';
import { ArrowLeft, History } from 'lucide-react';
import { productionLotDetail, ProductionLotDetail, formatQcDateTime } from '../../services/qcApi';
import { QcStatusBadge } from './components/QcStatusBadge';
import { PermissionDenied } from './components/PermissionDenied';
import { cn } from '../../lib/utils';
import { usePermissions } from '../../contexts/PermissionContext';

const FAIL_EVENTS = new Set(['inspection_failed_hold', 'displaced']);

interface Props {
  lotId: string;
  onBack: () => void;
  onOpenHistory?: (subLotId: string) => void;
}

export default function TracePage({ lotId, onBack, onOpenHistory }: Props) {
  const { can } = usePermissions();
  const canView = can('qc', 'trace', 'view');
  const [detail, setDetail] = useState<ProductionLotDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (lotId) {
      productionLotDetail(lotId)
        .then(setDetail)
        .catch((e) => setError(e.message));
    }
  }, [lotId]);

  if (!canView) {
    return <PermissionDenied permission="qc.trace.view" feature="Batch Trace" />;
  }

  if (!detail) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <button onClick={onBack} className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-900 mb-4">
          <ArrowLeft size={14} /> Back to trace list
        </button>
        {error ? <p className="text-red-600 text-sm">{error}</p> : <p className="text-slate-400 text-sm">Loading…</p>}
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <button onClick={onBack} className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-900 mb-4">
        <ArrowLeft size={14} /> Back to trace list
      </button>

      <h1 className="text-2xl font-bold text-slate-900">Trace · {detail.lot.lot_number}</h1>
      <p className="text-slate-600 mt-1 mb-4 text-sm">{detail.lot.sku_name}</p>

      <h2 className="font-semibold mb-2 text-slate-900 text-sm">Drying sub-lots</h2>
      <ul className="space-y-2 mb-6">
        {detail.sub_lots.map((s) => (
          <li key={s.id} className="bg-white border rounded-xl p-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => onOpenHistory?.(s.id)}
              disabled={!onOpenHistory}
              className="flex-1 text-left min-w-0 group"
            >
              <div className="flex justify-between items-center mb-1">
                <span className={cn('font-mono font-medium', onOpenHistory ? 'text-blue-700 group-hover:underline' : 'text-slate-900')}>
                  {s.sub_lot_code}
                </span>
                <QcStatusBadge status={s.status} />
              </div>
              <p className="text-xs text-slate-600">
                In {formatQcDateTime(s.in_time)} · Out {formatQcDateTime(s.out_time)}
              </p>
            </button>
            {onOpenHistory && (
              <button
                type="button"
                onClick={() => onOpenHistory(s.id)}
                title="View full history"
                className="text-[10px] font-bold px-2 py-1 rounded border border-slate-200 hover:border-blue-400 hover:text-blue-700 text-slate-500 flex items-center gap-1 shrink-0"
              >
                <History size={10} /> History
              </button>
            )}
          </li>
        ))}
      </ul>

      <h2 className="font-semibold mb-2 text-slate-900 text-sm">Quality events</h2>
      <ul className="space-y-2">
        {detail.events.map((ev) => (
          <li
            key={ev.id}
            className={cn(
              'rounded-xl border p-3',
              FAIL_EVENTS.has(ev.event_type) ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200',
            )}
          >
            <p className={cn(
              'font-medium leading-snug text-sm',
              FAIL_EVENTS.has(ev.event_type) ? 'text-red-900' : 'text-slate-800',
            )}>
              {ev.summary}
            </p>
            <p className="text-[11px] text-slate-500 mt-1.5">{formatQcDateTime(ev.created_at)}</p>
          </li>
        ))}
        {detail.events.length === 0 && <p className="text-slate-500 text-sm">No events</p>}
      </ul>
    </div>
  );
}

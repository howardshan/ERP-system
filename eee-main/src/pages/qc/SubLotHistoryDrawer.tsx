import React, { useEffect, useState, useMemo } from 'react';
import { X, MapPin, FlaskConical, ClipboardCheck, Thermometer, Activity } from 'lucide-react';
import { subLotFullHistory, formatQcDateTime, SubLotFullHistory } from '../../services/qcApi';
import { QcStatusBadge } from './components/QcStatusBadge';
import { cn } from '../../lib/utils';
import { usePermissions } from '../../contexts/PermissionContext';
import { PermissionDenied } from './components/PermissionDenied';

interface Props {
  subLotId: string;
  onClose: () => void;
}

type TimelineItem = {
  ts: string;
  kind: 'spot' | 'sample' | 'inspection' | 'disposition' | 'room_temp' | 'event';
  title: string;
  description?: string;
  payload?: Record<string, unknown>;
  closed_at?: string | null;
  duration_minutes?: number | null;
};

function fmtMin(m: number | null | undefined): string {
  if (m == null) return '—';
  const v = Math.round(m);
  if (v < 60) return `${v}m`;
  const h = Math.floor(v / 60);
  const r = v % 60;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

export default function SubLotHistoryDrawer({ subLotId, onClose }: Props) {
  const { can } = usePermissions();
  const canView = can('qc', 'sub_lots', 'view_history');
  const [data, setData] = useState<SubLotFullHistory | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    subLotFullHistory(subLotId).then(setData).catch(e => setError(e.message));
  }, [subLotId]);

  const timeline = useMemo<TimelineItem[]>(() => {
    if (!data) return [];
    const items: TimelineItem[] = [];

    for (const h of data.spot_history) {
      items.push({
        ts: h.started_at,
        kind: 'spot',
        title: `Placed in Dryer ${h.dryer_number ?? '—'} cell ${String(h.cell_number ?? 0).padStart(2, '0')}`,
        description: h.ended_at
          ? `Held ${fmtMin(h.duration_minutes)} · ended by ${h.end_reason}`
          : 'Currently here',
        closed_at: h.ended_at,
        duration_minutes: h.duration_minutes,
      });
    }
    for (const s of data.samples) {
      items.push({
        ts: s.taken_at,
        kind: 'sample',
        title: `Sample taken — ${s.sample_id}`,
        description: s.status === 'voided' ? 'Voided' : s.result ? `Result: ${s.result.toUpperCase()} (Aw ${s.aw ?? '—'})` : 'Pending result',
      });
    }
    for (const ir of data.inspections) {
      items.push({
        ts: ir.submitted_at,
        kind: 'inspection',
        title: `Inspection ${ir.result.toUpperCase()} · Aw ${ir.aw ?? '—'}`,
        description: ir.sample_id ? `Sample ${ir.sample_id}` : undefined,
      });
    }
    for (const d of data.dispositions) {
      const label = d.type === 'redry_dryer'
        ? `Disposition: Re-dry in dryer (${d.redry_expected_dry_minutes ?? '?'} min)`
        : `Disposition: ${d.type}`;
      items.push({
        ts: d.created_at,
        kind: 'disposition',
        title: label,
        description: d.remark ?? undefined,
      });
    }
    for (const sess of data.room_temp_sessions) {
      items.push({
        ts: sess.started_at,
        kind: 'room_temp',
        title: 'Room temp dry started',
        description: sess.ended_at
          ? `Stopped after ${fmtMin(sess.duration_minutes)}`
          : 'Still running',
        closed_at: sess.ended_at,
      });
    }
    // Events table covers create/move/displaced/check-in/check-out etc.; include for full picture
    for (const ev of data.events) {
      items.push({
        ts: ev.created_at,
        kind: 'event',
        title: ev.summary || ev.event_type,
      });
    }

    items.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    return items;
  }, [data]);

  if (!canView) {
    return (
      <div className="fixed inset-0 z-50 flex justify-end">
        <button
          type="button"
          className="absolute inset-0 bg-black/40"
          onClick={onClose}
          aria-label="Close drawer"
        />
        <aside className="relative w-full max-w-xl h-full bg-white shadow-2xl flex flex-col">
          <header className="px-5 py-3 border-b border-slate-200 flex items-center justify-between shrink-0">
            <p className="text-sm font-bold text-slate-900">Sub-lot history</p>
            <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded">
              <X size={16} />
            </button>
          </header>
          <PermissionDenied permission="qc.sub_lots.view_history" feature="Sub-lot history" />
        </aside>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-label="Close drawer"
      />
      <aside className="relative w-full max-w-xl h-full bg-white shadow-2xl flex flex-col">
        <header className="px-5 py-3 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Sub-lot history</p>
            <h2 className="text-base font-mono font-bold text-slate-900">
              {data?.sub_lot.sub_lot_code ?? '…'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded">
            <X size={16} />
          </button>
        </header>

        {error && <p className="text-red-600 bg-red-50 m-3 p-2 rounded text-sm">{error}</p>}

        {data && (
          <>
            <div className="px-5 py-3 border-b border-slate-200 bg-slate-50">
              <dl className="grid grid-cols-2 gap-y-1 text-xs">
                <dt className="text-slate-500">Status</dt>
                <dd><QcStatusBadge status={data.sub_lot.status} /></dd>
                <dt className="text-slate-500">SKU</dt>
                <dd className="text-slate-900">{data.sub_lot.sku_name ?? '—'}</dd>
                <dt className="text-slate-500">Batch</dt>
                <dd className="font-mono text-slate-900">{data.sub_lot.lot_number ?? data.sub_lot.lot_barcode ?? '—'}</dd>
                <dt className="text-slate-500">Target dry</dt>
                <dd className="text-slate-900">{data.sub_lot.expected_dry_minutes ?? '—'} min</dd>
                <dt className="text-slate-500">Total dried</dt>
                <dd className="text-slate-900">{fmtMin(data.sub_lot.total_dried_minutes)}</dd>
              </dl>
            </div>

            <div className="flex-1 overflow-auto px-5 py-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Timeline</h3>
              {timeline.length === 0 ? (
                <p className="text-sm text-slate-500">No events yet.</p>
              ) : (
                <ol className="relative border-l-2 border-slate-200 ml-2 space-y-3">
                  {timeline.map((it, i) => (
                    <li key={i} className="ml-4">
                      <span className={cn(
                        'absolute -left-[9px] flex items-center justify-center w-4 h-4 rounded-full',
                        kindColor(it.kind),
                      )}>
                        {kindIcon(it.kind)}
                      </span>
                      <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                        {formatQcDateTime(it.ts)}
                      </p>
                      <p className="text-sm font-bold text-slate-900 leading-snug">{it.title}</p>
                      {it.description && (
                        <p className="text-xs text-slate-500 mt-0.5">{it.description}</p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function kindColor(k: TimelineItem['kind']): string {
  switch (k) {
    case 'spot':        return 'bg-amber-100 text-amber-700 border-2 border-white';
    case 'sample':      return 'bg-blue-100 text-blue-700 border-2 border-white';
    case 'inspection':  return 'bg-emerald-100 text-emerald-700 border-2 border-white';
    case 'disposition': return 'bg-red-100 text-red-700 border-2 border-white';
    case 'room_temp':   return 'bg-orange-100 text-orange-700 border-2 border-white';
    default:            return 'bg-slate-100 text-slate-600 border-2 border-white';
  }
}
function kindIcon(k: TimelineItem['kind']) {
  const s = 9;
  switch (k) {
    case 'spot':        return <MapPin size={s} />;
    case 'sample':      return <FlaskConical size={s} />;
    case 'inspection':  return <ClipboardCheck size={s} />;
    case 'disposition': return <Activity size={s} />;
    case 'room_temp':   return <Thermometer size={s} />;
    default:            return <Activity size={s} />;
  }
}

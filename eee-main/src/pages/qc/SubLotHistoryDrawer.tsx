import React, { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { X, MapPin, FlaskConical, ClipboardCheck, Thermometer, Activity } from 'lucide-react';
import { subLotFullHistory, formatQcDateTime, SubLotFullHistory, InspectionReading } from '../../services/qcApi';
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
  actor?: string | null;   // M-149: account that performed the action
};

function fmtMin(m: number | null | undefined): string {
  if (m == null) return '—';
  const v = Math.round(m);
  if (v < 60) return `${v}m`;
  const h = Math.floor(v / 60);
  const r = v % 60;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

/**
 * M-146: turn a multi-test `readings` array into a single human-readable line.
 * Single-reading rows fall back to the compact `<unit> <value>` form (e.g.
 * "Aw 0.6") so legacy inspections look the same as before. Multi-reading rows
 * use `<item_name>: <value> <unit>` per entry, joined by ", ".
 * Returns null when there are no readings — caller can fall back to plain Aw.
 */
function formatReadings(readings: InspectionReading[] | undefined): string | null {
  if (!readings || readings.length === 0) return null;
  const piece = (r: InspectionReading, multi: boolean) => {
    const v = r.value ?? '—';
    if (!multi && r.unit) return `${r.unit} ${v}`;       // compact: "Aw 0.6"
    if (r.unit === '%') return `${r.item_name}: ${v}%`;  // suffix-style for %
    if (r.unit) return `${r.item_name}: ${v} ${r.unit}`; // "Water Activity: 0.6 Aw"
    return `${r.item_name}: ${v}`;
  };
  return readings.map(r => piece(r, readings.length > 1)).join(', ');
}

export default function SubLotHistoryDrawer({ subLotId, onClose }: Props) {
  const { t } = useTranslation('qc');
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
        title: t('subLotHistoryDrawer.placedInDryer', { dryer: h.dryer_number ?? '—', cell: String(h.cell_number ?? 0).padStart(2, '0') }),
        description: h.ended_at
          ? t('subLotHistoryDrawer.heldEndedBy', { duration: fmtMin(h.duration_minutes), reason: h.end_reason })
          : t('subLotHistoryDrawer.currentlyHere'),
        closed_at: h.ended_at,
        duration_minutes: h.duration_minutes,
      });
    }
    for (const s of data.samples) {
      const readings = formatReadings(s.readings);
      const resultLine = s.status === 'voided'
        ? t('subLotHistoryDrawer.voided')
        : s.result
          ? readings
            ? t('subLotHistoryDrawer.resultReadings', { result: s.result.toUpperCase(), readings })
            : t('subLotHistoryDrawer.resultAw', { result: s.result.toUpperCase(), aw: s.aw ?? '—' })
          : t('subLotHistoryDrawer.pendingResult');
      items.push({
        ts: s.taken_at,
        kind: 'sample',
        title: t('subLotHistoryDrawer.sampleTaken', { sampleId: s.sample_id }),
        description: resultLine,
        actor: s.taken_by,
      });
    }
    for (const ir of data.inspections) {
      const readings = formatReadings(ir.readings);
      items.push({
        ts: ir.submitted_at,
        kind: 'inspection',
        title: readings
          ? t('subLotHistoryDrawer.inspectionResultReadings', { result: ir.result.toUpperCase(), readings })
          : t('subLotHistoryDrawer.inspectionResult', { result: ir.result.toUpperCase(), aw: ir.aw ?? '—' }),
        description: [ir.sample_id ? t('subLotHistoryDrawer.sampleLabel', { sampleId: ir.sample_id }) : null, ir.remark ? t('subLotHistoryDrawer.remarkLabel', { remark: ir.remark }) : null]
          .filter(Boolean).join(' · ') || undefined,
        actor: ir.inspector,
      });
    }
    for (const d of data.dispositions) {
      const label = d.type === 'redry_dryer'
        ? t('subLotHistoryDrawer.dispositionRedryDryer', { minutes: d.redry_expected_dry_minutes ?? '?' })
        : t('subLotHistoryDrawer.dispositionType', { type: d.type });
      items.push({
        ts: d.created_at,
        kind: 'disposition',
        title: label,
        description: d.remark ?? undefined,
        actor: d.operator,
      });
    }
    for (const sess of data.room_temp_sessions) {
      items.push({
        ts: sess.started_at,
        kind: 'room_temp',
        title: t('subLotHistoryDrawer.roomTempStarted'),
        description: sess.ended_at
          ? t('subLotHistoryDrawer.stoppedAfter', { duration: fmtMin(sess.duration_minutes) })
          : t('subLotHistoryDrawer.stillRunning'),
        closed_at: sess.ended_at,
        actor: sess.ended_by ?? sess.started_by,
      });
    }
    // Events table covers create/move/displaced/check-in/check-out etc.; include for full picture
    for (const ev of data.events) {
      items.push({
        ts: ev.created_at,
        kind: 'event',
        title: ev.summary || ev.event_type,
        actor: ev.actor,
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
          aria-label={t('subLotHistoryDrawer.closeDrawer')}
        />
        <aside className="relative w-full max-w-xl h-full bg-white shadow-2xl flex flex-col">
          <header className="px-5 py-3 border-b border-slate-200 flex items-center justify-between shrink-0">
            <p className="text-sm font-bold text-slate-900">{t('subLotHistoryDrawer.title')}</p>
            <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded">
              <X size={16} />
            </button>
          </header>
          <PermissionDenied permission="qc.sub_lots.view_history" feature={t('subLotHistoryDrawer.title')} />
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
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{t('subLotHistoryDrawer.title')}</p>
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
                <dt className="text-slate-500">{t('subLotHistoryDrawer.status')}</dt>
                <dd><QcStatusBadge status={data.sub_lot.status} /></dd>
                <dt className="text-slate-500">{t('subLotHistoryDrawer.sku')}</dt>
                <dd className="text-slate-900">{data.sub_lot.sku_name ?? '—'}</dd>
                <dt className="text-slate-500">{t('subLotHistoryDrawer.batch')}</dt>
                <dd className="font-mono text-slate-900">{data.sub_lot.lot_number ?? data.sub_lot.lot_barcode ?? '—'}</dd>
                <dt className="text-slate-500">{t('subLotHistoryDrawer.targetDry')}</dt>
                <dd className="text-slate-900">{data.sub_lot.expected_dry_minutes ?? '—'} {t('subLotHistoryDrawer.min')}</dd>
                <dt className="text-slate-500">{t('subLotHistoryDrawer.totalDried')}</dt>
                <dd className="text-slate-900">{fmtMin(data.sub_lot.total_dried_minutes)}</dd>
              </dl>
            </div>

            <div className="flex-1 overflow-auto px-5 py-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">{t('subLotHistoryDrawer.timeline')}</h3>
              {timeline.length === 0 ? (
                <p className="text-sm text-slate-500">{t('subLotHistoryDrawer.noEvents')}</p>
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
                        {it.actor && <span className="text-slate-500 normal-case"> · {it.actor}</span>}
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

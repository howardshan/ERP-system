import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Thermometer, StopCircle, History, ArrowLeft } from 'lucide-react';
import {
  listRoomTempDrying,
  stopRoomTempDry,
  formatQcDateTime,
  RoomTempDryingSubLot,
} from '../../services/qcApi';
import { usePermissions } from '../../contexts/PermissionContext';
import { cn } from '../../lib/utils';
import { PermissionDenied } from './components/PermissionDenied';

interface Props {
  onOpenHistory: (subLotId: string) => void;
  onBack?: () => void;
}

function fmtElapsed(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

export default function RoomTempDryPage({ onOpenHistory, onBack }: Props) {
  const { t } = useTranslation('qc');
  const { can } = usePermissions();
  const canView = can('qc', 'testing', 'view_status');
  const canStop = can('qc', 'testing', 'stop_room_temp');

  const [rows, setRows] = useState<RoomTempDryingSubLot[]>([]);
  const [, setNow] = useState(Date.now());
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => listRoomTempDrying().then(setRows).catch(e => setError(e.message));
  useEffect(() => {
    load();
    const tLoad = setInterval(load, 10_000);
    const tTick = setInterval(() => setNow(Date.now()), 30_000);
    return () => { clearInterval(tLoad); clearInterval(tTick); };
  }, []);

  const handleStop = async (id: string, code: string) => {
    setBusy(id);
    setError('');
    try {
      await stopRoomTempDry(id);
      setMsg(t('roomTempDryPage.stoppedMsg', { code }));
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('roomTempDryPage.stopFailed'));
    }
    setBusy(null);
  };

  const liveElapsedMin = (startedAt: string): number =>
    Math.max(0, (Date.now() - new Date(startedAt).getTime()) / 60_000);

  if (!canView) {
    return <PermissionDenied permission="qc.testing.view_status" feature={t('roomTempDryPage.featureName')} />;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {onBack && (
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-900 mb-3"
        >
          <ArrowLeft size={14} /> {t('roomTempDryPage.allDryRooms')}
        </button>
      )}
      <h1 className="text-2xl font-bold text-slate-900 mb-1 flex items-center gap-2">
        <Thermometer size={20} className="text-orange-600" /> {t('roomTempDryPage.title')}
      </h1>
      <p className="text-xs text-slate-500 mb-4">
        {t('roomTempDryPage.subtitle')}
      </p>

      {msg && <p className="text-emerald-700 bg-emerald-50 p-2 rounded-lg mb-3 text-sm">{msg}</p>}
      {error && <p className="text-red-600 bg-red-50 p-2 rounded-lg mb-3 text-sm">{error}</p>}

      {rows.length === 0 ? (
        <div className="bg-white border rounded-xl p-10 text-center text-sm text-slate-500">
          {t('roomTempDryPage.emptyState')}
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map(s => {
            const live = liveElapsedMin(s.room_temp_started_at);
            return (
              <li key={s.id} className="bg-white border-2 border-orange-300 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-mono font-bold text-slate-900">{s.sub_lot_code}</h2>
                      <button
                        type="button"
                        onClick={() => onOpenHistory(s.id)}
                        className="text-[10px] font-bold px-2 py-0.5 rounded border border-slate-200 hover:border-blue-400 hover:text-blue-700 text-slate-500 flex items-center gap-1"
                      >
                        <History size={10} /> {t('roomTempDryPage.history')}
                      </button>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {s.sku_name ?? '—'} · {t('roomTempDryPage.startedLabel')} {formatQcDateTime(s.room_temp_started_at)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wider text-orange-700 font-bold">{t('roomTempDryPage.elapsed')}</p>
                    <p className="text-3xl font-bold tabular-nums text-orange-700">{fmtElapsed(live)}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-slate-500">
                    {t('roomTempDryPage.stopHint')}
                  </p>
                  <button
                    type="button"
                    onClick={() => handleStop(s.id, s.sub_lot_code)}
                    disabled={busy === s.id || !canStop}
                    className={cn(
                      'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold text-white transition-colors',
                      'bg-orange-600 hover:bg-orange-500 disabled:opacity-50',
                    )}
                  >
                    <StopCircle size={14} />
                    {busy === s.id ? t('roomTempDryPage.stopping') : t('roomTempDryPage.stopBackToTesting')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

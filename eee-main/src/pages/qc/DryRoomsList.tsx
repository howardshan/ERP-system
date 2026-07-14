import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Grid3X3, Clock, Boxes, Thermometer, ArrowRight, Undo2 } from 'lucide-react';
import {
  listDryRoomSummary,
  listRoomTempDrying,
  DryRoomSummary,
  RoomTempDryingSubLot,
  formatQcDateTime,
} from '../../services/qcApi';
import { cn } from '../../lib/utils';
import { usePermissions } from '../../contexts/PermissionContext';
import { PermissionDenied } from './components/PermissionDenied';
import { WithdrawCheckInDialog } from './components/WithdrawCheckInDialog';

interface Props {
  onSelectDryer: (dryerNumber: number) => void;
  onSelectRoomTempDry: () => void;
}

function fmtRemaining(eta: string | null, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (!eta) return '—';
  const ms = new Date(eta).getTime() - Date.now();
  if (ms <= 0) return t('dryRoomsList.readyNow');
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return t('dryRoomsList.inMin', { mins });
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? t('dryRoomsList.inHr', { hrs }) : t('dryRoomsList.inHrMin', { hrs, rem });
}

export default function DryRoomsList({ onSelectDryer, onSelectRoomTempDry }: Props) {
  const { t } = useTranslation('qc');
  const { can } = usePermissions();
  const canView = can('qc', 'dry_rooms', 'view_status');
  const canWithdraw = can('qc', 'dry_rooms', 'check_in');
  const [dryers, setDryers] = useState<DryRoomSummary[]>([]);
  const [roomTemp, setRoomTemp] = useState<RoomTempDryingSubLot[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const load = () => {
    listDryRoomSummary().then(setDryers).catch(e => setError(e.message));
    listRoomTempDrying().then(setRoomTemp).catch(() => { /* room temp is supplementary */ });
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  const longestRoomTempMin = roomTemp.reduce(
    (m, r) => Math.max(m, r.room_temp_elapsed_minutes ?? 0), 0,
  );

  if (!canView) {
    return <PermissionDenied permission="qc.dry_rooms.view_status" feature={t('dryRoomsList.dryRooms')} />;
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1">{t('dryRoomsList.dryRooms')}</h1>
          <p className="text-slate-600 text-sm">{t('dryRoomsList.subtitle')}</p>
        </div>
        {canWithdraw && (
          <button
            type="button"
            onClick={() => setWithdrawOpen(true)}
            className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-slate-200 text-slate-700 hover:border-amber-400 hover:text-amber-700 transition-colors bg-white"
          >
            <Undo2 size={13} /> {t('withdrawCheckIn.openBtn')}
          </button>
        )}
      </div>

      {msg && <p className="text-emerald-700 bg-emerald-50 p-2 rounded-lg mb-3 text-sm">{msg}</p>}
      {error && <p className="text-red-600 bg-red-50 p-2 rounded-lg mb-3 text-sm">{error}</p>}

      <WithdrawCheckInDialog
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        onSuccess={(m) => { setMsg(m); setWithdrawOpen(false); load(); }}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Room Temp Dry card (managed alongside the 5 physical dryers) */}
        <button
          type="button"
          onClick={onSelectRoomTempDry}
          className="text-left bg-white border-2 border-orange-200 rounded-xl p-5 hover:border-orange-400 hover:shadow-md transition-all"
        >
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-lg bg-orange-600 text-white flex items-center justify-center">
                <Thermometer size={18} />
              </div>
              <div>
                <h2 className="font-bold text-slate-900">{t('dryRoomsList.roomTempDry')}</h2>
                <p className="text-[11px] text-slate-500">{t('dryRoomsList.countUpOnly')}</p>
              </div>
            </div>
            <span className={cn(
              'text-[10px] font-bold px-2 py-0.5 rounded-full border',
              roomTemp.length === 0
                ? 'bg-slate-100 text-slate-500 border-slate-200'
                : 'bg-orange-100 text-orange-700 border-orange-200',
            )}>
              {t('dryRoomsList.activeCount', { count: roomTemp.length })}
            </span>
          </div>

          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500 flex items-center gap-1.5"><Boxes size={13} /> {t('dryRoomsList.cartsDrying')}</dt>
              <dd className="font-mono font-bold text-slate-900">{roomTemp.length}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 flex items-center gap-1.5"><Clock size={13} /> {t('dryRoomsList.longestElapsed')}</dt>
              <dd className="font-mono font-bold text-orange-700">
                {longestRoomTempMin > 0 ? fmtElapsed(longestRoomTempMin) : '—'}
              </dd>
            </div>
          </dl>

          <p className="mt-4 text-[11px] text-orange-700 font-bold flex items-center gap-1">
            {t('dryRoomsList.manageRoomTempDry')} <ArrowRight size={11} />
          </p>
        </button>

        {dryers.map((d) => {
          const occRate = d.occupied_count / d.total_cells;
          return (
            <button
              key={d.dryer_number}
              type="button"
              onClick={() => onSelectDryer(d.dryer_number)}
              className="text-left bg-white border-2 border-slate-200 rounded-xl p-5 hover:border-blue-400 hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold">
                    {d.dryer_number}
                  </div>
                  <div>
                    <h2 className="font-bold text-slate-900">{t('dryRoomsList.dryer', { number: d.dryer_number })}</h2>
                    <p className="text-[11px] text-slate-500">{t('dryRoomsList.cellGrid')}</p>
                  </div>
                </div>
                <OccupancyPill rate={occRate} />
              </div>

              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-500 flex items-center gap-1.5"><Boxes size={13} /> {t('dryRoomsList.occupied')}</dt>
                  <dd className="font-mono font-bold text-slate-900">
                    {d.occupied_count}<span className="text-slate-400 font-normal">/{d.total_cells}</span>
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500 flex items-center gap-1.5"><Grid3X3 size={13} /> {t('dryRoomsList.available')}</dt>
                  <dd className="font-mono font-bold text-emerald-700">{d.available_count}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500 flex items-center gap-1.5"><Clock size={13} /> {t('dryRoomsList.nextFinish')}</dt>
                  <dd className="text-xs text-slate-700">
                    {d.next_finish_at ? (
                      <span>
                        <span className="font-mono">{formatQcDateTime(d.next_finish_at)}</span>
                        <span className="text-amber-700 ml-1">({fmtRemaining(d.next_finish_at, t)})</span>
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </dd>
                </div>
              </dl>

              {/* Mini occupancy bar */}
              <div className="mt-4">
                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full transition-all',
                      occRate >= 0.9 ? 'bg-red-500' : occRate >= 0.5 ? 'bg-amber-500' : 'bg-emerald-500',
                    )}
                    style={{ width: `${occRate * 100}%` }}
                  />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function fmtElapsed(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

function OccupancyPill({ rate }: { rate: number }) {
  const { t } = useTranslation('qc');
  const pct = Math.round(rate * 100);
  const cls = rate >= 0.9 ? 'bg-red-100 text-red-700 border-red-200'
    : rate >= 0.5 ? 'bg-amber-100 text-amber-700 border-amber-200'
    : 'bg-emerald-100 text-emerald-700 border-emerald-200';
  return (
    <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border', cls)}>
      {t('dryRoomsList.percentFull', { pct })}
    </span>
  );
}

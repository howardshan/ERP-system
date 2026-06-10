import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Zap } from 'lucide-react';
import { listExpiring, expireLots, ExpiringLot } from '../../services/warehouseApi';
import { usePermissions } from '../../contexts/PermissionContext';

const LOT_STATUS_BADGE: Record<string, string> = {
  available: 'bg-emerald-100 text-emerald-700',
  quarantine: 'bg-amber-100 text-amber-700',
  on_hold: 'bg-rose-100 text-rose-700',
  rejected: 'bg-rose-100 text-rose-700',
  expired: 'bg-slate-300 text-slate-700',
  consumed: 'bg-slate-100 text-slate-500',
};

const THRESHOLDS = [7, 30, 60, 90];

function rowStyle(days: number, status: string): string {
  if (status === 'expired') return 'bg-slate-100/60';
  if (days < 0) return 'bg-rose-50/70';
  if (days <= 7) return 'bg-amber-50/70';
  return '';
}

type DayLabel = { key: string; n: number; color: string };

function dayLabel(days: number): DayLabel {
  if (days < 0) return { key: 'expiringPage.dayLabel.overdue', n: -days, color: 'text-rose-700 font-semibold' };
  if (days === 0) return { key: 'expiringPage.dayLabel.today', n: 0, color: 'text-rose-700 font-semibold' };
  if (days <= 7) return { key: 'expiringPage.dayLabel.soon', n: days, color: 'text-amber-700 font-semibold' };
  return { key: 'expiringPage.dayLabel.days', n: days, color: 'text-slate-700' };
}

export default function ExpiringPage({ onOpenLot }: { onOpenLot?: (lotId: number) => void }) {
  const { t } = useTranslation('warehouse');
  const { can } = usePermissions();
  const canExpire = can('warehouse', 'lots', 'reject'); // sweep = destructive admin op, gate on reject

  const [threshold, setThreshold] = useState(30);
  const [rows, setRows] = useState<ExpiringLot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    listExpiring(threshold).then(setRows).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [threshold]);

  const overdueCount = rows.filter((r) => r.days_until_expiry < 0 && r.lot_status !== 'expired').length;

  const doExpireAll = async () => {
    if (overdueCount === 0) {
      if (!confirm(t('expiringPage.confirmNoOverdue'))) return;
    } else if (!confirm(t('expiringPage.confirmExpireAll', { count: overdueCount }))) {
      return;
    }
    setBusy(true);
    setError(''); setMsg('');
    try {
      const res = await expireLots();
      setMsg(t('expiringPage.expiredResult', { count: res.expired_count }));
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('expiringPage.expireFailed'));
    }
    setBusy(false);
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <AlertTriangle size={20} className="text-amber-600" />
        <h1 className="text-2xl font-bold text-slate-900">{t('expiringPage.title')}</h1>
      </div>
      <p className="text-slate-600 mb-4 text-sm">
        {t('expiringPage.descBefore')} <code className="text-xs">expired</code>{t('expiringPage.descAfter')}
      </p>

      {error && <p className="text-red-600 mb-3 text-sm">{error}</p>}
      {msg && <p className="text-emerald-700 bg-emerald-50 p-2 rounded-lg mb-3 text-sm">{msg}</p>}

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <label className="text-xs font-medium text-slate-700">{t('expiringPage.showNext')}</label>
        <div className="flex gap-1">
          {THRESHOLDS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setThreshold(d)}
              className={
                'px-3 py-1 text-xs rounded-lg border ' +
                (threshold === d
                  ? 'bg-emerald-600 border-emerald-600 text-white font-semibold'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50')
              }
            >
              {t('expiringPage.daysUnit', { n: d })}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-500">
          {t('expiringPage.lotCount', { count: rows.length })} · {t('expiringPage.ofWhich')} <span className="text-rose-600 font-semibold">{overdueCount}</span> {t('expiringPage.overdueUnmarked')}
        </span>
        {canExpire && (
          <button
            type="button"
            onClick={doExpireAll}
            disabled={busy}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50"
          >
            <Zap size={12} /> {busy ? t('expiringPage.marking') : t('expiringPage.expireAllBtn')}
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left font-semibold px-4 py-2.5">{t('expiringPage.colLot')}</th>
              <th className="text-left font-semibold px-4 py-2.5">{t('expiringPage.colItem')}</th>
              <th className="text-right font-semibold px-4 py-2.5">{t('expiringPage.colOnHand')}</th>
              <th className="text-left font-semibold px-4 py-2.5 pl-3">{t('expiringPage.colUom')}</th>
              <th className="text-left font-semibold px-4 py-2.5">{t('expiringPage.colExpiry')}</th>
              <th className="text-left font-semibold px-4 py-2.5">{t('expiringPage.colRemaining')}</th>
              <th className="text-left font-semibold px-4 py-2.5">{t('expiringPage.colStatus')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const dl = dayLabel(r.days_until_expiry);
              return (
                <tr key={r.lot_id} className={rowStyle(r.days_until_expiry, r.lot_status)}>
                  <td className="px-4 py-2.5">
                    {onOpenLot ? (
                      <button onClick={() => onOpenLot(r.lot_id)}
                        className="font-mono text-emerald-700 hover:text-emerald-800 hover:underline">
                        {r.lot_number}
                      </button>
                    ) : (
                      <span className="font-mono text-slate-800">{r.lot_number}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="text-slate-800">{r.item_name}</div>
                    <div className="text-xs text-slate-500 font-mono">{r.item_sku}</div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-900">{r.total_on_hand}</td>
                  <td className="px-4 py-2.5 pl-3 text-slate-600">{r.base_uom}</td>
                  <td className="px-4 py-2.5 text-slate-700">{r.expiry_date}</td>
                  <td className={`px-4 py-2.5 ${dl.color}`}>{t(dl.key, { n: dl.n })}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${LOT_STATUS_BADGE[r.lot_status] ?? 'bg-slate-100 text-slate-600'}`}>
                      {r.lot_status}
                    </span>
                  </td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                {t('expiringPage.empty', { n: threshold })}
              </td></tr>
            )}
            {loading && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">{t('expiringPage.loading')}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

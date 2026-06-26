import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Flame, CalendarClock, AlertTriangle, HelpCircle } from 'lucide-react';
import { dashboardDryingExitForecast, DryingExitBucket } from '../../services/qcApi';
import { cn } from '../../lib/utils';

/**
 * Dashboard → Drying-room exit forecast.  Carts still drying, bucketed by the
 * day they are expected to leave the dryer (ETA = now + remaining dry minutes).
 * Data: qc_dashboard_drying_exit_forecast() (M-157).
 */
const FORECAST_DAYS = 7;

export default function DryingExitForecastPage() {
  const { t } = useTranslation('dashboard');
  const [buckets, setBuckets] = useState<DryingExitBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setRefreshing(true);
    try {
      setBuckets(await dashboardDryingExitForecast(FORECAST_DAYS));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('forecast.loadFailed'));
    }
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalDrying = buckets.reduce((s, b) => s + b.cart_count, 0);

  return (
    <div className="p-6 max-w-[1100px] mx-auto">
      <div className="flex items-end justify-between mb-1">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('forecast.title')}</h1>
          <p className="text-xs text-slate-500 mt-0.5">{t('forecast.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={refreshing}
          className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded border border-slate-200 hover:border-indigo-400 hover:text-indigo-700 text-slate-700 disabled:opacity-50"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          {t('forecast.refresh')}
        </button>
      </div>

      {error && <p className="text-red-600 bg-red-50 p-2 rounded-lg mt-3 text-sm">{error}</p>}

      {loading ? (
        <p className="text-slate-400 text-sm mt-6">{t('forecast.loading')}</p>
      ) : totalDrying === 0 ? (
        <div className="bg-white border rounded-xl p-8 text-center text-sm text-slate-500 mt-6">
          {t('forecast.empty')}
        </div>
      ) : (
        <>
          <p className="text-xs text-slate-500 mt-4 mb-3">
            <Flame size={12} className="inline text-amber-600 -mt-0.5" />{' '}
            {t('forecast.totalDrying', { count: totalDrying })}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {buckets.map((b, i) => <BucketCard key={i} bucket={b} />)}
          </div>
        </>
      )}
    </div>
  );
}

function BucketCard({ bucket }: { bucket: DryingExitBucket }) {
  const { t } = useTranslation('dashboard');

  const label = (() => {
    if (bucket.grp === 'overdue') return t('forecast.overdue');
    if (bucket.grp === 'later')   return t('forecast.later', { days: FORECAST_DAYS });
    if (bucket.grp === 'unknown') return t('forecast.unknown');
    if (bucket.days_from_today === 0) return t('forecast.today');
    if (bucket.days_from_today === 1) return t('forecast.tomorrow');
    return t('forecast.inDays', { days: bucket.days_from_today });
  })();

  const style = {
    overdue: { ring: 'border-rose-200 bg-rose-50',    icon: AlertTriangle, fg: 'text-rose-600',  num: 'text-rose-700' },
    day:     { ring: 'border-slate-200 bg-white',     icon: CalendarClock, fg: 'text-indigo-600', num: 'text-slate-900' },
    later:   { ring: 'border-slate-200 bg-slate-50',  icon: CalendarClock, fg: 'text-slate-400',  num: 'text-slate-600' },
    unknown: { ring: 'border-amber-200 bg-amber-50',  icon: HelpCircle,    fg: 'text-amber-600',  num: 'text-amber-700' },
  }[bucket.grp];
  const Icon = style.icon;

  return (
    <div className={cn('border rounded-xl p-4 flex items-start justify-between', style.ring)}>
      <div>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">{label}</p>
        {bucket.bucket_date && (
          <p className="text-[10px] text-slate-400 mb-1.5 font-mono">{bucket.bucket_date}</p>
        )}
        <h4 className={cn('text-2xl font-bold tabular-nums', style.num)}>{bucket.cart_count}</h4>
        <p className="text-[10px] text-slate-400 mt-0.5">{t('forecast.cartsUnit')}</p>
      </div>
      <div className={cn('p-2 rounded-lg', style.fg)}>
        <Icon size={18} />
      </div>
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, FlaskConical, CheckCircle2, Hourglass, Calendar } from 'lucide-react';
import { getTestingDashboard, TestingDashboardData } from '../../services/qcApi';

export default function TestingDashboard() {
  const { t } = useTranslation('qc');
  const [data, setData] = useState<TestingDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      setData(await getTestingDashboard());
    } catch (e) {
      setError(e instanceof Error ? e.message : t('testingDashboard.loadFailed'));
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="p-8 text-slate-400 text-sm">{t('testingDashboard.loading')}</div>;
  if (error) return <div className="p-8 text-red-600 text-sm">{error}</div>;
  if (!data) return null;

  const { forecast, today_summary } = data;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">{t('testingDashboard.title')}</h2>
        <button onClick={load} className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded border border-slate-200 hover:border-blue-400 hover:text-blue-700 text-slate-700">
          <RefreshCw size={12} /> {t('testingDashboard.refresh')}
        </button>
      </div>

      {/* Today's summary */}
      <section>
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">{t('testingDashboard.todaysProgress')}</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryCard icon={Hourglass} label={t('testingDashboard.awaitingSample')} value={today_summary.awaiting_sample} color="amber" />
          <SummaryCard icon={FlaskConical} label={t('testingDashboard.sampleTaken')} value={today_summary.sample_taken} color="blue" />
          <SummaryCard icon={RefreshCw} label={t('testingDashboard.awaitingResult')} value={today_summary.awaiting_result} color="orange" />
          <SummaryCard icon={CheckCircle2} label={t('testingDashboard.completedToday')} value={today_summary.completed_today} color="emerald" />
        </div>
      </section>

      {/* 3-day forecast */}
      <section>
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
          <Calendar size={12} /> {t('testingDashboard.upcomingTests')}
        </h3>
        <div className="space-y-3">
          {forecast.map(day => (
            <div key={day.date} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
                <div>
                  <span className="font-bold text-slate-900 text-sm">{day.label}</span>
                  <span className="ml-2 text-xs text-slate-400">{day.date}</span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-bold text-slate-700">{t('testingDashboard.samplesCount', { count: day.total_samples ?? day.total })}</span>
                  <span className="ml-1.5 text-xs text-slate-400">{t('testingDashboard.cartsParen', { count: day.total })}</span>
                </div>
              </div>
              {day.products.length === 0 ? (
                <p className="px-4 py-3 text-xs text-slate-400">{t('testingDashboard.noCarts')}</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {day.products.map(p => (
                      <tr key={p.sku_name} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5">
                          {p.sku_code && <span className="font-mono text-xs text-slate-400 mr-2">{p.sku_code}</span>}
                          <span className="font-medium text-slate-800">{p.sku_name}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <span className="font-bold text-slate-900">{t('testingDashboard.samplesCount', { count: p.samples_needed ?? p.count })}</span>
                          <span className="ml-1.5 text-xs text-slate-400">{t('testingDashboard.cartsSlash', { count: p.count })}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, color }: {
  icon: React.ElementType; label: string; value: number;
  color: 'amber' | 'blue' | 'orange' | 'emerald';
}) {
  const colors = {
    amber:   'bg-amber-50 border-amber-200 text-amber-900',
    blue:    'bg-blue-50 border-blue-200 text-blue-900',
    orange:  'bg-orange-50 border-orange-200 text-orange-900',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-900',
  };
  return (
    <div className={`rounded-xl border-2 p-3 ${colors[color]}`}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-bold opacity-80 mb-1.5">
        <Icon size={12} /> {label}
      </div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

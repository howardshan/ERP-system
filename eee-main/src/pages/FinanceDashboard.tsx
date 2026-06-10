import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, TrendingUp, TrendingDown, DollarSign, History, ChevronRight, Loader2 } from 'lucide-react';
import { MetricCard, Card, Badge } from '../components/ui/Cards';
import { formatCurrency } from '../lib/utils';
import { DashboardStats } from '../types';
import { getDashboardStats } from '../services/api';

const statusColor: Record<string, 'positive' | 'neutral' | 'negative'> = {
  posted: 'positive',
  draft: 'neutral',
  reversed: 'negative',
};

export default function FinanceDashboard({ onNavigate }: { onNavigate?: (screen: string) => void }) {
  const { t } = useTranslation('finance');
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    getDashboardStats()
      .then(setStats)
      .finally(() => setLoading(false));
  }, [refreshKey]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 gap-3 text-slate-400">
        <Loader2 size={24} className="animate-spin" />
        <span>{t('financeDashboard.loading')}</span>
      </div>
    );
  }

  const s = stats ?? { totalAssets: 0, totalLiabilities: 0, totalEquity: 0, netIncome: 0, draftEntryCount: 0, recentEntries: [] };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">{t('financeDashboard.title')}</h2>
          <p className="text-xs text-slate-500 mt-1 uppercase font-bold tracking-wider">{t('financeDashboard.subtitle')}</p>
        </div>
        <button onClick={() => setRefreshKey(k => k + 1)} className="px-4 py-2 text-xs font-bold bg-blue-600 text-white rounded shadow hover:bg-blue-700 uppercase tracking-wide">
          {t('financeDashboard.refresh')}
        </button>
      </div>

      <div className="grid grid-cols-4 gap-6">
        <MetricCard
          label={t('financeDashboard.totalAssets')}
          value={formatCurrency(s.totalAssets)}
          icon={TrendingUp}
        />
        <MetricCard
          label={t('financeDashboard.totalLiabilities')}
          value={formatCurrency(s.totalLiabilities)}
          icon={TrendingDown}
        />
        <MetricCard
          label={t('financeDashboard.totalEquity')}
          value={formatCurrency(s.totalEquity)}
          icon={DollarSign}
        />
        <MetricCard
          label={t('financeDashboard.netIncome')}
          value={formatCurrency(s.netIncome)}
          icon={BarChart3}
          className={s.netIncome >= 0 ? 'bg-blue-600 text-white' : 'bg-rose-600 text-white'}
        />
      </div>

      <div className="grid grid-cols-3 gap-6">
        <Card className="col-span-2" title={t('financeDashboard.equationCheck')}>
          <div className="mt-4 space-y-4">
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
              <div className="text-center">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">{t('financeDashboard.assets')}</p>
                <p className="text-2xl font-mono font-bold text-slate-900">{formatCurrency(s.totalAssets)}</p>
              </div>
              <span className="text-2xl font-bold text-slate-300">=</span>
              <div className="text-center">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">{t('financeDashboard.liabilities')}</p>
                <p className="text-2xl font-mono font-bold text-slate-900">{formatCurrency(s.totalLiabilities)}</p>
              </div>
              <span className="text-2xl font-bold text-slate-300">+</span>
              <div className="text-center">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">{t('financeDashboard.equity')}</p>
                <p className="text-2xl font-mono font-bold text-slate-900">{formatCurrency(s.totalEquity)}</p>
              </div>
            </div>
            {s.totalAssets > 0 && (
              <p className={`text-xs font-bold text-center ${
                Math.abs(s.totalAssets - s.totalLiabilities - s.totalEquity) < 1
                  ? 'text-emerald-600' : 'text-rose-600'
              }`}>
                {Math.abs(s.totalAssets - s.totalLiabilities - s.totalEquity) < 1
                  ? t('financeDashboard.equationBalances')
                  : t('financeDashboard.difference', { amount: formatCurrency(Math.abs(s.totalAssets - s.totalLiabilities - s.totalEquity)) })}
              </p>
            )}
          </div>
        </Card>

        <Card title={t('financeDashboard.quickActions')}>
          <div className="mt-4 space-y-2">
            {[
              { label: t('financeDashboard.newJournalEntry'), screen: 'je-create', color: 'bg-blue-600 text-white hover:bg-blue-700' },
              { label: t('financeDashboard.viewAllEntries'), screen: 'je-list', color: 'bg-slate-100 text-slate-700 hover:bg-slate-200' },
              { label: t('financeDashboard.chartOfAccounts'), screen: 'coa', color: 'bg-slate-100 text-slate-700 hover:bg-slate-200' },
              { label: t('financeDashboard.trialBalance'), screen: 'trial-balance', color: 'bg-slate-100 text-slate-700 hover:bg-slate-200' },
              { label: t('financeDashboard.accountingPeriods'), screen: 'periods', color: 'bg-slate-100 text-slate-700 hover:bg-slate-200' },
            ].map(a => (
              <button
                key={a.screen}
                onClick={() => onNavigate?.(a.screen)}
                className={`w-full text-left px-4 py-2.5 rounded text-sm font-bold transition-colors ${a.color}`}
              >
                {a.label}
              </button>
            ))}
          </div>
        </Card>
      </div>

      <Card title={t('financeDashboard.recentActivity')}>
        {s.recentEntries.length === 0 ? (
          <p className="text-sm text-slate-400 mt-4">{t('financeDashboard.noEntries')}</p>
        ) : (
          <div className="space-y-3 mt-4">
            {s.recentEntries.map(entry => (
              <div
                key={entry.id}
                className="flex items-center justify-between py-3 border-b border-slate-50 last:border-0 hover:bg-slate-50/50 px-2 rounded -mx-2 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-slate-100 rounded text-slate-500">
                    <History size={16} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900 font-mono">{entry.entry_number}</span>
                      <Badge type={statusColor[entry.status] ?? 'neutral'}>{entry.status}</Badge>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{entry.description || '—'}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-mono font-bold text-slate-900">{formatCurrency(entry.total_debit ?? 0)}</p>
                  <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">{entry.entry_date}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        {onNavigate && s.recentEntries.length > 0 && (
          <button
            onClick={() => onNavigate('je-list')}
            className="w-full mt-4 text-xs font-bold text-blue-600 hover:text-blue-700 uppercase tracking-widest flex items-center justify-center gap-1 group"
          >
            {t('financeDashboard.viewAllTransactions')}
            <ChevronRight size={14} className="group-hover:translate-x-1 transition-transform" />
          </button>
        )}
      </Card>
    </div>
  );
}

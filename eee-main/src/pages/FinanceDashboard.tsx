import React, { useState, useEffect } from 'react';
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
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDashboardStats()
      .then(setStats)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 gap-3 text-slate-400">
        <Loader2 size={24} className="animate-spin" />
        <span>Loading dashboard...</span>
      </div>
    );
  }

  const s = stats ?? { totalAssets: 0, totalLiabilities: 0, totalEquity: 0, netIncome: 0, draftEntryCount: 0, recentEntries: [] };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Financial Overview</h2>
          <p className="text-xs text-slate-500 mt-1 uppercase font-bold tracking-wider">From posted general ledger entries</p>
        </div>
        <button onClick={() => window.location.reload()} className="px-4 py-2 text-xs font-bold bg-blue-600 text-white rounded shadow hover:bg-blue-700 uppercase tracking-wide">
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-4 gap-6">
        <MetricCard
          label="Total Assets"
          value={formatCurrency(s.totalAssets)}
          icon={TrendingUp}
        />
        <MetricCard
          label="Total Liabilities"
          value={formatCurrency(s.totalLiabilities)}
          icon={TrendingDown}
        />
        <MetricCard
          label="Total Equity"
          value={formatCurrency(s.totalEquity)}
          icon={DollarSign}
        />
        <MetricCard
          label="Net Income"
          value={formatCurrency(s.netIncome)}
          icon={BarChart3}
          className={s.netIncome >= 0 ? 'bg-blue-600 text-white' : 'bg-rose-600 text-white'}
        />
      </div>

      <div className="grid grid-cols-3 gap-6">
        <Card className="col-span-2" title="Accounting Equation Check">
          <div className="mt-4 space-y-4">
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
              <div className="text-center">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Assets</p>
                <p className="text-2xl font-mono font-bold text-slate-900">{formatCurrency(s.totalAssets)}</p>
              </div>
              <span className="text-2xl font-bold text-slate-300">=</span>
              <div className="text-center">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Liabilities</p>
                <p className="text-2xl font-mono font-bold text-slate-900">{formatCurrency(s.totalLiabilities)}</p>
              </div>
              <span className="text-2xl font-bold text-slate-300">+</span>
              <div className="text-center">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Equity</p>
                <p className="text-2xl font-mono font-bold text-slate-900">{formatCurrency(s.totalEquity)}</p>
              </div>
            </div>
            {s.totalAssets > 0 && (
              <p className={`text-xs font-bold text-center ${
                Math.abs(s.totalAssets - s.totalLiabilities - s.totalEquity) < 1
                  ? 'text-emerald-600' : 'text-rose-600'
              }`}>
                {Math.abs(s.totalAssets - s.totalLiabilities - s.totalEquity) < 1
                  ? 'Equation balances ✓'
                  : `Difference: ${formatCurrency(Math.abs(s.totalAssets - s.totalLiabilities - s.totalEquity))}`}
              </p>
            )}
          </div>
        </Card>

        <Card title="Quick Actions">
          <div className="mt-4 space-y-2">
            {[
              { label: 'New Journal Entry', screen: 'je-create', color: 'bg-blue-600 text-white hover:bg-blue-700' },
              { label: 'View All Entries', screen: 'je-list', color: 'bg-slate-100 text-slate-700 hover:bg-slate-200' },
              { label: 'Chart of Accounts', screen: 'coa', color: 'bg-slate-100 text-slate-700 hover:bg-slate-200' },
              { label: 'Trial Balance', screen: 'trial-balance', color: 'bg-slate-100 text-slate-700 hover:bg-slate-200' },
              { label: 'Accounting Periods', screen: 'periods', color: 'bg-slate-100 text-slate-700 hover:bg-slate-200' },
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

      <Card title="Recent Activity">
        {s.recentEntries.length === 0 ? (
          <p className="text-sm text-slate-400 mt-4">No journal entries yet. Create your first entry to get started.</p>
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
            View All Transactions
            <ChevronRight size={14} className="group-hover:translate-x-1 transition-transform" />
          </button>
        )}
      </Card>
    </div>
  );
}

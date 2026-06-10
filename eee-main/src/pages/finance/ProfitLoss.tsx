import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Download, Calendar, TrendingUp, TrendingDown } from 'lucide-react';
import { Card } from '../../components/ui/Cards';
import { cn, formatCurrency } from '../../lib/utils';
import { getPnL, getAccountingPeriods } from '../../services/api';
import type { PnLRow, AccountingPeriod } from '../../types';

interface Props {
  onNavigate?: (screen: string) => void;
}

type RangeMode = 'period' | 'custom';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthStartIso(d = new Date()): string {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function monthEndIso(d = new Date()): string {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
}

export default function ProfitLoss({ onNavigate }: Props) {
  const { t } = useTranslation('finance');
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [mode, setMode] = useState<RangeMode>('period');
  const [periodId, setPeriodId] = useState<number | null>(null);
  const [customStart, setCustomStart] = useState<string>(monthStartIso());
  const [customEnd, setCustomEnd] = useState<string>(monthEndIso());
  const [rows, setRows] = useState<PnLRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Load accounting periods + default to current/open
  useEffect(() => {
    getAccountingPeriods()
      .then(ps => {
        setPeriods(ps);
        const today = todayIso();
        const current = ps.find(p => p.start_date <= today && p.end_date >= today)
          ?? ps.find(p => p.status === 'open')
          ?? ps[0];
        if (current) setPeriodId(current.id);
      })
      .catch(e => setError(e.message));
  }, []);

  // Resolve effective date range based on mode
  const range = useMemo<{ start: string; end: string; label: string } | null>(() => {
    if (mode === 'period') {
      const p = periods.find(x => x.id === periodId);
      if (!p) return null;
      return { start: p.start_date, end: p.end_date, label: p.name };
    }
    if (!customStart || !customEnd || customStart > customEnd) return null;
    return { start: customStart, end: customEnd, label: `${customStart} → ${customEnd}` };
  }, [mode, periodId, periods, customStart, customEnd]);

  // Fetch when range resolves
  useEffect(() => {
    if (!range) return;
    setLoading(true);
    setError('');
    getPnL(range.start, range.end)
      .then(setRows)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [range]);

  // Group postable rows by section
  const revenueRows = useMemo(
    () => rows.filter(r => r.account_type === 'revenue' && r.is_postable && r.is_active),
    [rows],
  );
  const expenseRows = useMemo(
    () => rows.filter(r => r.account_type === 'expense' && r.is_postable && r.is_active),
    [rows],
  );

  const totalRevenue = revenueRows.reduce((s, r) => s + Number(r.net_amount), 0);
  const totalExpense = expenseRows.reduce((s, r) => s + Number(r.net_amount), 0);
  const netIncome = totalRevenue - totalExpense;

  // Drill-down hook — real query filtering in P0 #5
  function openAccount(row: PnLRow) {
    if (!onNavigate || !range) return;
    // Deep-link format reused from JE list (je-edit:<id>);
    // here we shape it as pnl-drill:<account_id>:<start>:<end> so the JE
    // list page can pick this up once P0 #5 (drill-down) is implemented.
    onNavigate(`pnl-drill:${row.id}:${range.start}:${range.end}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">{t('profitLoss.title')}</h2>
          <p className="text-xs text-slate-500 mt-1 uppercase font-bold tracking-wider">
            {t('profitLoss.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <PeriodSelector
            periods={periods}
            mode={mode}
            setMode={setMode}
            periodId={periodId}
            setPeriodId={setPeriodId}
            customStart={customStart}
            customEnd={customEnd}
            setCustomStart={setCustomStart}
            setCustomEnd={setCustomEnd}
          />
          <button
            type="button"
            disabled
            title={t('profitLoss.exportComingTooltip')}
            className="px-4 py-2 text-xs font-bold bg-slate-900 text-white rounded shadow disabled:opacity-40 disabled:cursor-not-allowed uppercase tracking-wide flex items-center gap-2"
          >
            <Download size={14} /> {t('profitLoss.export')}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-100 rounded text-sm text-rose-700">
          {error}
        </div>
      )}

      <Card className="p-0">
        {loading ? (
          <div className="flex items-center justify-center py-20 gap-3 text-slate-400">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm">{t('profitLoss.computing', { label: range?.label ?? '—' })}</span>
          </div>
        ) : !range ? (
          <div className="flex items-center justify-center py-20 text-slate-400 text-sm">
            {t('profitLoss.pickRange')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-200">
                  <th className="px-6 py-4 w-32">{t('profitLoss.code')}</th>
                  <th className="px-6 py-4">{t('profitLoss.account')}</th>
                  <th className="px-6 py-4 text-right w-44">{range.label}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <SectionHeader label={t('profitLoss.revenue')} />
                {revenueRows.length === 0 && (
                  <EmptySectionRow text={t('profitLoss.noRevenue')} />
                )}
                {revenueRows.map(r => (
                  <PnLRowDisplay key={r.id} row={r} onClick={() => openAccount(r)} />
                ))}
                <SubtotalRow label={t('profitLoss.totalRevenue')} amount={totalRevenue} />

                <SectionHeader label={t('profitLoss.expense')} />
                {expenseRows.length === 0 && (
                  <EmptySectionRow text={t('profitLoss.noExpense')} />
                )}
                {expenseRows.map(r => (
                  <PnLRowDisplay key={r.id} row={r} onClick={() => openAccount(r)} negative />
                ))}
                <SubtotalRow label={t('profitLoss.totalExpense')} amount={totalExpense} negative />
              </tbody>
              <tfoot>
                <tr className="bg-slate-900 text-white border-t-2 border-slate-700">
                  <td colSpan={2} className="px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] flex items-center gap-2">
                    {netIncome >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                    {t('profitLoss.netIncome')}
                  </td>
                  <td className={cn(
                    'px-6 py-4 text-right font-mono text-sm font-bold',
                    netIncome >= 0 ? 'text-emerald-300' : 'text-rose-300',
                  )}>
                    {formatCurrency(netIncome)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  return (
    <tr className="bg-slate-50/70">
      <td colSpan={3} className="px-6 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-600">
        {label}
      </td>
    </tr>
  );
}

function EmptySectionRow({ text }: { text: string }) {
  return (
    <tr>
      <td colSpan={3} className="px-6 py-4 text-xs italic text-slate-400">
        {text}
      </td>
    </tr>
  );
}

function PnLRowDisplay({ row, onClick, negative }: { row: PnLRow; onClick: () => void; negative?: boolean }) {
  const { t } = useTranslation('finance');
  const value = Number(row.net_amount);
  return (
    <tr
      onClick={onClick}
      className="hover:bg-blue-50 cursor-pointer transition-colors"
      title={t('profitLoss.drillDownTooltip')}
    >
      <td className="px-6 py-3 font-mono text-xs text-slate-500">{row.account_code}</td>
      <td className="px-6 py-3 text-sm font-semibold text-slate-700">{row.name}</td>
      <td className={cn(
        'px-6 py-3 text-right font-mono text-sm',
        value === 0 ? 'text-slate-300' : negative ? 'text-rose-700' : 'text-emerald-700',
      )}>
        {value === 0 ? '—' : formatCurrency(value)}
      </td>
    </tr>
  );
}

function SubtotalRow({ label, amount, negative }: { label: string; amount: number; negative?: boolean }) {
  return (
    <tr className="bg-slate-100 border-t border-slate-200">
      <td colSpan={2} className="px-6 py-3 text-xs font-bold uppercase tracking-widest text-slate-700">
        {label}
      </td>
      <td className={cn(
        'px-6 py-3 text-right font-mono text-sm font-bold',
        negative ? 'text-rose-700' : 'text-emerald-700',
      )}>
        {formatCurrency(amount)}
      </td>
    </tr>
  );
}

function PeriodSelector({
  periods, mode, setMode, periodId, setPeriodId,
  customStart, customEnd, setCustomStart, setCustomEnd,
}: {
  periods: AccountingPeriod[];
  mode: RangeMode;
  setMode: (m: RangeMode) => void;
  periodId: number | null;
  setPeriodId: (id: number | null) => void;
  customStart: string; customEnd: string;
  setCustomStart: (s: string) => void;
  setCustomEnd: (s: string) => void;
}) {
  const { t } = useTranslation('finance');
  return (
    <div className="flex items-center gap-2 bg-white border border-slate-200 rounded px-2 py-1 shadow-sm">
      <Calendar size={14} className="text-slate-400" />
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setMode('period')}
          className={cn(
            'text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded',
            mode === 'period' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100',
          )}
        >
          {t('profitLoss.period')}
        </button>
        <button
          type="button"
          onClick={() => setMode('custom')}
          className={cn(
            'text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded',
            mode === 'custom' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100',
          )}
        >
          {t('profitLoss.custom')}
        </button>
      </div>
      {mode === 'period' ? (
        <select
          value={periodId ?? ''}
          onChange={e => setPeriodId(e.target.value ? Number(e.target.value) : null)}
          className="text-xs border-l border-slate-200 pl-2 py-1 focus:outline-none bg-transparent min-w-[120px]"
        >
          {periods.length === 0 && <option value="">{t('profitLoss.noPeriods')}</option>}
          {periods.map(p => (
            <option key={p.id} value={p.id}>{p.name} · {p.status}</option>
          ))}
        </select>
      ) : (
        <div className="flex items-center gap-1 text-xs">
          <input
            type="date"
            value={customStart}
            onChange={e => setCustomStart(e.target.value)}
            className="border-l border-slate-200 pl-2 py-1 focus:outline-none bg-transparent"
          />
          <span className="text-slate-400">→</span>
          <input
            type="date"
            value={customEnd}
            onChange={e => setCustomEnd(e.target.value)}
            className="py-1 focus:outline-none bg-transparent"
          />
        </div>
      )}
    </div>
  );
}

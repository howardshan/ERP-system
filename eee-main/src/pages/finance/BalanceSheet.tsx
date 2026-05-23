import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Download, Calendar, Scale } from 'lucide-react';
import { Card } from '../../components/ui/Cards';
import { cn, formatCurrency } from '../../lib/utils';
import { getBalanceSheet, getPnL, getAccountingPeriods } from '../../services/api';
import type { BalanceSheetRow, AccountingPeriod } from '../../types';

interface Props {
  onNavigate?: (screen: string) => void;
}

type DateMode = 'period_end' | 'custom';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthEndIso(d = new Date()): string {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
}

export default function BalanceSheet({ onNavigate }: Props) {
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [mode, setMode] = useState<DateMode>('period_end');
  const [periodId, setPeriodId] = useState<number | null>(null);
  const [customDate, setCustomDate] = useState<string>(monthEndIso());
  const [rows, setRows] = useState<BalanceSheetRow[]>([]);
  const [retainedEarnings, setRetainedEarnings] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Load periods + default to current/open period's end_date
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

  // Resolve effective as-of date
  const asOf = useMemo<{ date: string; label: string } | null>(() => {
    if (mode === 'period_end') {
      const p = periods.find(x => x.id === periodId);
      if (!p) return null;
      return { date: p.end_date, label: `End of ${p.name}` };
    }
    if (!customDate) return null;
    return { date: customDate, label: `As of ${customDate}` };
  }, [mode, periodId, periods, customDate]);

  // Fetch both BS rows AND cumulative P&L for Retained Earnings (BR-F11)
  useEffect(() => {
    if (!asOf) return;
    setLoading(true);
    setError('');
    Promise.all([
      getBalanceSheet(asOf.date),
      getPnL('1900-01-01', asOf.date),  // cumulative since inception
    ])
      .then(([bs, pnl]) => {
        setRows(bs);
        // RE = Sum of revenue net - Sum of expense net = Net Income to date
        const re = pnl.reduce((s, r) => {
          if (!r.is_postable) return s;
          if (r.account_type === 'revenue') return s + Number(r.net_amount);
          if (r.account_type === 'expense') return s - Number(r.net_amount);
          return s;
        }, 0);
        setRetainedEarnings(re);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [asOf]);

  const assets = useMemo(
    () => rows.filter(r => r.account_type === 'asset' && r.is_postable && r.is_active),
    [rows],
  );
  const liabilities = useMemo(
    () => rows.filter(r => r.account_type === 'liability' && r.is_postable && r.is_active),
    [rows],
  );
  const equityAccounts = useMemo(
    () => rows.filter(r => r.account_type === 'equity' && r.is_postable && r.is_active),
    [rows],
  );

  const totalAssets = assets.reduce((s, r) => s + Number(r.balance), 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + Number(r.balance), 0);
  const totalEquityAccounts = equityAccounts.reduce((s, r) => s + Number(r.balance), 0);
  const totalEquity = totalEquityAccounts + retainedEarnings;
  const liabPlusEquity = totalLiabilities + totalEquity;
  const balanced = Math.abs(totalAssets - liabPlusEquity) < 0.01;

  function openAccount(row: BalanceSheetRow) {
    if (!onNavigate || !asOf) return;
    // Drill-down hook — same format as P&L (P0 #5 will implement the receiving end)
    onNavigate(`bs-drill:${row.id}:1900-01-01:${asOf.date}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Balance Sheet</h2>
          <p className="text-xs text-slate-500 mt-1 uppercase font-bold tracking-wider">
            Posted entries · cumulative through as-of date · BR-F9 / F11
          </p>
        </div>
        <div className="flex items-center gap-3">
          <AsOfDateSelector
            periods={periods}
            mode={mode}
            setMode={setMode}
            periodId={periodId}
            setPeriodId={setPeriodId}
            customDate={customDate}
            setCustomDate={setCustomDate}
          />
          {!loading && asOf && (
            <span className={cn(
              'px-3 py-1 text-xs font-bold rounded-full',
              balanced ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700',
            )}>
              {balanced ? 'In Balance' : 'OUT OF BALANCE'}
            </span>
          )}
          <button
            type="button"
            disabled
            title="Export coming with P0 #4 (CSV/Excel)"
            className="px-4 py-2 text-xs font-bold bg-slate-900 text-white rounded shadow disabled:opacity-40 disabled:cursor-not-allowed uppercase tracking-wide flex items-center gap-2"
          >
            <Download size={14} /> Export
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-100 rounded text-sm text-rose-700">{error}</div>
      )}

      <Card className="p-0">
        {loading ? (
          <div className="flex items-center justify-center py-20 gap-3 text-slate-400">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm">Computing balance sheet for {asOf?.label ?? '—'}...</span>
          </div>
        ) : !asOf ? (
          <div className="flex items-center justify-center py-20 text-slate-400 text-sm">
            Pick a period end or custom date.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-200">
                  <th className="px-6 py-4 w-32">Code</th>
                  <th className="px-6 py-4">Account</th>
                  <th className="px-6 py-4 text-right w-44">{asOf.label}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <SectionHeader label="Assets" />
                {assets.length === 0 && <EmptySectionRow text="No posted asset balances." />}
                {assets.map(r => (
                  <BSRowDisplay key={r.id} row={r} onClick={() => openAccount(r)} />
                ))}
                <SubtotalRow label="Total Assets" amount={totalAssets} accent="emerald" />

                <SectionHeader label="Liabilities" />
                {liabilities.length === 0 && <EmptySectionRow text="No posted liability balances." />}
                {liabilities.map(r => (
                  <BSRowDisplay key={r.id} row={r} onClick={() => openAccount(r)} />
                ))}
                <SubtotalRow label="Total Liabilities" amount={totalLiabilities} accent="rose" />

                <SectionHeader label="Equity" />
                {equityAccounts.map(r => (
                  <BSRowDisplay key={r.id} row={r} onClick={() => openAccount(r)} />
                ))}
                {/* Synthetic Retained Earnings row */}
                <tr
                  className="hover:bg-blue-50 cursor-pointer transition-colors"
                  onClick={() => onNavigate?.(`pnl`)}
                  title="Open P&L to see the source revenue/expense (cumulative)"
                >
                  <td className="px-6 py-3 font-mono text-xs text-slate-400 italic">—</td>
                  <td className="px-6 py-3 text-sm font-semibold text-slate-700 italic">
                    Retained Earnings <span className="text-[10px] text-slate-400 font-normal">(computed: cumulative net income)</span>
                  </td>
                  <td className={cn(
                    'px-6 py-3 text-right font-mono text-sm italic',
                    retainedEarnings === 0 ? 'text-slate-300'
                      : retainedEarnings > 0 ? 'text-emerald-700' : 'text-rose-700',
                  )}>
                    {retainedEarnings === 0 ? '—' : formatCurrency(retainedEarnings)}
                  </td>
                </tr>
                <SubtotalRow label="Total Equity" amount={totalEquity} accent="emerald" />
              </tbody>
              <tfoot>
                <tr className="bg-slate-900 text-white border-t-2 border-slate-700">
                  <td colSpan={2} className="px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] flex items-center gap-2">
                    <Scale size={14} />
                    Liabilities + Equity {balanced ? '✓' : '⚠'}
                  </td>
                  <td className="px-6 py-4 text-right font-mono text-sm font-bold">
                    {formatCurrency(liabPlusEquity)}
                  </td>
                </tr>
                {!balanced && (
                  <tr className="bg-rose-100 text-rose-900">
                    <td colSpan={2} className="px-6 py-2 text-[11px] font-bold">
                      Difference (Assets − Liab+Equity)
                    </td>
                    <td className="px-6 py-2 text-right font-mono text-xs font-bold">
                      {formatCurrency(totalAssets - liabPlusEquity)}
                    </td>
                  </tr>
                )}
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
      <td colSpan={3} className="px-6 py-4 text-xs italic text-slate-400">{text}</td>
    </tr>
  );
}

function BSRowDisplay({ row, onClick }: { row: BalanceSheetRow; onClick: () => void }) {
  const value = Number(row.balance);
  return (
    <tr
      onClick={onClick}
      className="hover:bg-blue-50 cursor-pointer transition-colors"
      title="View source journal lines (drill-down)"
    >
      <td className="px-6 py-3 font-mono text-xs text-slate-500">{row.account_code}</td>
      <td className="px-6 py-3 text-sm font-semibold text-slate-700">{row.name}</td>
      <td className={cn(
        'px-6 py-3 text-right font-mono text-sm',
        value === 0 ? 'text-slate-300' : 'text-slate-800',
      )}>
        {value === 0 ? '—' : formatCurrency(value)}
      </td>
    </tr>
  );
}

function SubtotalRow({ label, amount, accent }: {
  label: string; amount: number; accent: 'emerald' | 'rose';
}) {
  return (
    <tr className="bg-slate-100 border-t border-slate-200">
      <td colSpan={2} className="px-6 py-3 text-xs font-bold uppercase tracking-widest text-slate-700">
        {label}
      </td>
      <td className={cn(
        'px-6 py-3 text-right font-mono text-sm font-bold',
        accent === 'emerald' ? 'text-emerald-700' : 'text-rose-700',
      )}>
        {formatCurrency(amount)}
      </td>
    </tr>
  );
}

function AsOfDateSelector({
  periods, mode, setMode, periodId, setPeriodId, customDate, setCustomDate,
}: {
  periods: AccountingPeriod[];
  mode: DateMode;
  setMode: (m: DateMode) => void;
  periodId: number | null;
  setPeriodId: (id: number | null) => void;
  customDate: string;
  setCustomDate: (d: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 bg-white border border-slate-200 rounded px-2 py-1 shadow-sm">
      <Calendar size={14} className="text-slate-400" />
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setMode('period_end')}
          className={cn(
            'text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded',
            mode === 'period_end' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100',
          )}
        >
          Period End
        </button>
        <button
          type="button"
          onClick={() => setMode('custom')}
          className={cn(
            'text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded',
            mode === 'custom' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100',
          )}
        >
          Custom
        </button>
      </div>
      {mode === 'period_end' ? (
        <select
          value={periodId ?? ''}
          onChange={e => setPeriodId(e.target.value ? Number(e.target.value) : null)}
          className="text-xs border-l border-slate-200 pl-2 py-1 focus:outline-none bg-transparent min-w-[140px]"
        >
          {periods.length === 0 && <option value="">No periods</option>}
          {periods.map(p => (
            <option key={p.id} value={p.id}>{p.name} · end {p.end_date}</option>
          ))}
        </select>
      ) : (
        <input
          type="date"
          value={customDate}
          onChange={e => setCustomDate(e.target.value)}
          className="text-xs border-l border-slate-200 pl-2 py-1 focus:outline-none bg-transparent"
        />
      )}
    </div>
  );
}

import React from 'react';
import { Card, Badge } from '../components/ui/Cards';
import { Download, FileSpreadsheet, Lock, Unlock, Calendar, History } from 'lucide-react';
import { formatCurrency, cn } from '../lib/utils';

export function TrialBalance() {
  const rows = [
    { code: '1010-00-100', name: 'Operating Cash - Chase', debit: 1450220.50, credit: 0, type: 'Asset' },
    { code: '1200-00-000', name: 'Accounts Receivable - Trade', debit: 842100, credit: 0, type: 'Asset' },
    { code: '2010-00-000', name: 'Accounts Payable - Suppliers', debit: 0, credit: 1120450, type: 'Liability' },
    { code: '4010-00-100', name: 'Product Sales - Premium Kibble', debit: 0, credit: 1542820.50, type: 'Revenue' },
    { code: '5010-00-100', name: 'Cost of Goods Sold', debit: 1245300, credit: 0, type: 'Expense' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Trial Balance</h2>
          <p className="text-xs text-slate-500 mt-1 uppercase font-bold tracking-wider">Condensed unadjusted trial balance</p>
        </div>
        <button className="px-4 py-2 text-xs font-bold bg-slate-900 text-white rounded shadow hover:bg-black transition-colors uppercase tracking-wide flex items-center gap-2">
          <Download size={14} /> Export Report
        </button>
      </div>

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-200">
                <th className="px-6 py-4">Account ID</th>
                <th className="px-6 py-4">Account Description</th>
                <th className="px-6 py-4 text-right">Debit ($)</th>
                <th className="px-6 py-4 text-right">Credit ($)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 italic">
              {rows.map(row => (
                <tr key={row.code} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-3 font-mono text-xs">{row.code}</td>
                  <td className="px-6 py-3 text-sm font-semibold text-slate-700">{row.name}</td>
                  <td className="px-6 py-3 text-right font-mono text-sm">{formatCurrency(row.debit)}</td>
                  <td className="px-6 py-3 text-right font-mono text-sm">{formatCurrency(row.credit)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-900 text-white border-t-2 border-slate-700">
                <td className="px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em]" colSpan={2}>Grand Ledger Totals</td>
                <td className="px-6 py-4 text-right font-mono text-sm font-bold">$3,537,620.50</td>
                <td className="px-6 py-4 text-right font-mono text-sm font-bold">$2,663,270.50</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
      
      <div className="p-4 bg-amber-50 border border-amber-100 rounded flex gap-4 items-center">
        <div className="p-2 bg-amber-100 text-amber-700 rounded-full">
          <History size={18} />
        </div>
        <p className="text-xs text-amber-800 font-medium italic">
          Last updated today at 09:12 AM. The ledger is currently in balance with the sub-ledger systems.
        </p>
      </div>
    </div>
  );
}

export function AccountingPeriods() {
  const periods = [
    { name: 'OCT 2023', start: '2023-10-01', end: '2023-10-31', status: 'Open' },
    { name: 'SEP 2023', start: '2023-09-01', end: '2023-09-30', status: 'Closed' },
    { name: 'AUG 2023', start: '2023-08-01', end: '2023-08-31', status: 'Closed' },
    { name: 'NOV 2023', start: '2023-11-01', end: '2023-11-30', status: 'Future' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Accounting Periods</h2>
          <p className="text-xs text-slate-500 mt-1 uppercase font-bold tracking-wider">Fiscal year operational status</p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-6">
        {periods.map(period => (
          <Card key={period.name} className="relative group hover:border-blue-300 transition-all">
            <div className="flex justify-between items-start mb-4">
              <div className="p-2 bg-slate-50 rounded text-slate-500 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
                <Calendar size={18} />
              </div>
              <Badge type={period.status === 'Open' ? 'positive' : period.status === 'Closed' ? 'negative' : 'info'}>
                {period.status}
              </Badge>
            </div>
            <h3 className="text-lg font-bold text-slate-900">{period.name}</h3>
            <div className="mt-4 space-y-1">
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Duration</p>
              <p className="text-xs text-slate-600 font-medium">{period.start} → {period.end}</p>
            </div>
            <div className="mt-6 flex gap-2">
              {period.status === 'Open' ? (
                <button className="flex-1 flex items-center justify-center gap-2 py-2 px-3 bg-rose-50 text-rose-600 text-[10px] font-bold rounded uppercase hover:bg-rose-100 transition-colors border border-rose-100">
                  <Lock size={12} /> Close Period
                </button>
              ) : period.status === 'Closed' ? (
                 <button className="flex-1 flex items-center justify-center gap-2 py-2 px-3 bg-blue-50 text-blue-600 text-[10px] font-bold rounded uppercase hover:bg-blue-100 transition-colors border border-blue-100">
                  <Unlock size={12} /> Reopen
                </button>
              ) : (
                <button className="flex-1 flex items-center justify-center gap-2 py-2 px-3 bg-slate-50 text-slate-400 text-[10px] font-bold rounded uppercase cursor-not-allowed border border-slate-100">
                  <Lock size={12} /> Locked
                </button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

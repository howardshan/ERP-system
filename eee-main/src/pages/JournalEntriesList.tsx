import React from 'react';
import { Card, Badge } from '../components/ui/Cards';
import { Search, Filter, History, Eye, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatCurrency } from '../lib/utils';

export default function JournalEntriesList() {
  const entries = [
    { id: 'JE-2023-1042', date: 'Oct 24, 2023', desc: 'Bulk Salmon Meal Purchase - Factory B', amount: 124500, source: 'Goods Receipt', status: 'Posted' },
    { id: 'JE-2023-1043', date: 'Oct 24, 2023', desc: 'Utility Allocation - Q3 Operations', amount: 4820.15, source: 'Manual', status: 'Draft' },
    { id: 'JE-2023-1041', date: 'Oct 23, 2023', desc: 'Packaging Defect Adjustment', amount: 850, source: 'Manual', status: 'Posted' },
    { id: 'JE-2023-1040', date: 'Oct 22, 2023', desc: 'Freight Charge - Logistics Partner Alpha', amount: 2100, source: 'Goods Receipt', status: 'Posted' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Journal Entries</h2>
          <p className="text-xs text-slate-500 mt-1 uppercase font-bold tracking-wider">Historical general ledger records</p>
        </div>
      </div>

      <Card className="p-0">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Filter by ref # or description..."
              className="w-full pl-10 pr-4 py-2 text-sm bg-white border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-2">
             <select className="bg-white border border-slate-200 rounded px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-600">
              <option>All Statuses</option>
              <option>Posted</option>
              <option>Draft</option>
            </select>
             <button className="p-2 border border-slate-200 rounded text-slate-400 hover:bg-slate-100">
              <Filter size={18} />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-200">
                <th className="px-6 py-4">Entry #</th>
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4">Description</th>
                <th className="px-6 py-4 text-right">Amount (USD)</th>
                <th className="px-6 py-4">Source</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map(entry => (
                <tr key={entry.id} className="hover:bg-blue-50/20 transition-colors group">
                  <td className="px-6 py-4 font-bold text-sm text-blue-600 cursor-pointer hover:underline">{entry.id}</td>
                  <td className="px-6 py-4 text-xs font-medium text-slate-500">{entry.date}</td>
                  <td className="px-6 py-4 text-sm text-slate-700">{entry.desc}</td>
                  <td className="px-6 py-4 text-right font-mono text-sm font-bold text-slate-900">{formatCurrency(entry.amount)}</td>
                  <td className="px-6 py-4 text-xs font-bold uppercase text-slate-400 tracking-tight">{entry.source}</td>
                  <td className="px-6 py-4">
                    <Badge type={entry.status === 'Posted' ? 'positive' : 'neutral'}>{entry.status}</Badge>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <button className="p-2 text-slate-300 hover:text-blue-600 hover:bg-blue-50 rounded transition-all">
                      <Eye size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-between items-center text-[10px] font-bold uppercase text-slate-500 tracking-widest">
            <span>Showing 1 to 4 of 124 records</span>
            <div className="flex gap-2">
              <button className="p-1 border border-slate-200 rounded disabled:opacity-30"><ChevronLeft size={16} /></button>
              <button className="p-1 border border-slate-200 rounded disabled:opacity-30"><ChevronRight size={16} /></button>
            </div>
        </div>
      </Card>
    </div>
  );
}

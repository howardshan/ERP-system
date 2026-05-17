import React, { useState, useEffect } from 'react';
import { Plus, Trash2, CheckCircle2, AlertCircle, Save, Send } from 'lucide-react';
import { JournalEntryLine, Account } from '../types';
import { cn, formatCurrency } from '../lib/utils';
import { Card } from '../components/ui/Cards';

export default function JournalEntryForm() {
  const [lines, setLines] = useState<Partial<JournalEntryLine>[]>([
    { id: '1', account_id: '', description: '', debit: 0, credit: 0 },
    { id: '2', account_id: '', description: '', debit: 0, credit: 0 },
  ]);
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

  const totalDebit = lines.reduce((sum, line) => sum + (line.debit || 0), 0);
  const totalCredit = lines.reduce((sum, line) => sum + (line.credit || 0), 0);
  const isBalanced = totalDebit > 0 && totalDebit === totalCredit;

  const addLine = () => {
    setLines([...lines, { id: Math.random().toString(), account_id: '', description: '', debit: 0, credit: 0 }]);
  };

  const removeLine = (id: string) => {
    if (lines.length > 2) {
      setLines(lines.filter(l => l.id !== id));
    }
  };

  const updateLine = (id: string, field: keyof JournalEntryLine, value: any) => {
    setLines(lines.map(line => {
      if (line.id === id) {
        const newLine = { ...line, [field]: value };
        // REQUIRED CORRECTION: Disable other field if one is entered
        if (field === 'debit' && value > 0) newLine.credit = 0;
        if (field === 'credit' && value > 0) newLine.debit = 0;
        return newLine;
      }
      return line;
    }));
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Create Journal Entry</h2>
          <p className="text-xs text-slate-500 mt-1 uppercase font-bold tracking-wider">Manual Adjustment - Ref: JE-2023-1042</p>
        </div>
        <div className="flex items-center gap-4">
          <div className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-full border text-xs font-bold transition-all",
            isBalanced 
              ? "bg-emerald-50 text-emerald-700 border-emerald-100" 
              : "bg-rose-50 text-rose-700 border-rose-100"
          )}>
            {isBalanced ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
            <span>{isBalanced ? 'Entry is Balanced' : 'Entry Out of Balance'}</span>
          </div>
        </div>
      </div>

      <Card className="p-0">
        <div className="p-6 bg-slate-50 border-b border-slate-200">
          <div className="grid grid-cols-12 gap-6">
            <div className="col-span-3 space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Date</label>
              <input 
                type="date" 
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="col-span-9 space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Entry Description</label>
              <input 
                type="text" 
                placeholder="Brief purpose of this entry..."
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                <th className="px-6 py-3 w-48">Account</th>
                <th className="px-6 py-3">Line Description</th>
                <th className="px-6 py-3 w-32 text-right">Debit</th>
                <th className="px-6 py-3 w-32 text-right">Credit</th>
                <th className="px-6 py-3 w-32">Dept</th>
                <th className="px-6 py-3 w-32">Cost Ctr</th>
                <th className="px-6 py-3 w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((line, index) => (
                <tr key={line.id} className="group hover:bg-blue-50/30 transition-colors">
                  <td className="px-6 py-4">
                    <select 
                      className="w-full bg-transparent text-sm font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 rounded p-1 truncate"
                      value={line.account_id}
                      onChange={e => updateLine(line.id!, 'account_id', e.target.value)}
                    >
                      <option value="">Select Account</option>
                      <option value="1120-00-000">1120-00-000 Accounts Receivable</option>
                      <option value="5100-10-100">5100-10-100 Raw Materials COGS</option>
                      <option value="1200-20-100">1200-20-100 Inventory - Finished</option>
                    </select>
                  </td>
                  <td className="px-6 py-4">
                    <input 
                      type="text" 
                      placeholder="Line detail..."
                      className="w-full bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 rounded p-1"
                      value={line.description}
                      onChange={e => updateLine(line.id!, 'description', e.target.value)}
                    />
                  </td>
                  <td className="px-6 py-4">
                    <input 
                      type="number" 
                      placeholder="0.00"
                      className="w-full bg-transparent text-sm text-right font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 rounded p-1"
                      value={line.debit || ''}
                      onChange={e => updateLine(line.id!, 'debit', parseFloat(e.target.value) || 0)}
                    />
                  </td>
                  <td className="px-6 py-4">
                    <input 
                      type="number" 
                      placeholder="0.00"
                      className="w-full bg-transparent text-sm text-right font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 rounded p-1"
                      value={line.credit || ''}
                      onChange={e => updateLine(line.id!, 'credit', parseFloat(e.target.value) || 0)}
                    />
                  </td>
                  <td className="px-6 py-4">
                    <select className="w-full bg-transparent text-xs focus:outline-none">
                      <option value="">None</option>
                      <option value="PROD">Production</option>
                      <option value="LOGS">Logistics</option>
                    </select>
                  </td>
                  <td className="px-6 py-4">
                    <select className="w-full bg-transparent text-xs focus:outline-none">
                      <option value="">None</option>
                      <option value="LINE-A">Line A</option>
                      <option value="LINE-B">Line B</option>
                    </select>
                  </td>
                  <td className="px-6 py-4">
                    <button 
                      onClick={() => removeLine(line.id!)}
                      className="text-slate-300 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-between items-center">
          <button 
            onClick={addLine}
            className="flex items-center gap-2 text-xs font-bold text-blue-600 hover:text-blue-700 uppercase tracking-wide"
          >
            <Plus size={16} />
            <span>Add Transaction Line</span>
          </button>

          <div className="flex gap-12 text-right">
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Total Debit</p>
              <p className="text-xl font-mono font-bold text-slate-900">{formatCurrency(totalDebit)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Total Credit</p>
              <p className="text-xl font-mono font-bold text-slate-900">{formatCurrency(totalCredit)}</p>
            </div>
          </div>
        </div>
      </Card>

      <div className="flex justify-between items-center bg-white p-4 border border-slate-200 rounded-lg">
        <div className="flex gap-4">
           <button className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 transition-colors rounded">
            <Save size={16} />
            <span>Save Draft</span>
          </button>
        </div>
        <button 
          disabled={!isBalanced}
          className={cn(
            "flex items-center gap-2 px-8 py-3 rounded text-sm font-bold shadow-lg transition-all",
            isBalanced 
              ? "bg-blue-600 text-white hover:bg-blue-700" 
              : "bg-slate-200 text-slate-400 cursor-not-allowed"
          )}
        >
          <Send size={16} />
          <span>Post Journal Entry</span>
        </button>
      </div>
    </div>
  );
}

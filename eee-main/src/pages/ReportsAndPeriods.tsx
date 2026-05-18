import React, { useState, useEffect, useCallback } from 'react';
import { Card, Badge } from '../components/ui/Cards';
import { Download, Lock, Unlock, Calendar, Loader2, Plus, X, AlertCircle } from 'lucide-react';
import { formatCurrency, cn } from '../lib/utils';
import { GlAccount, AccountingPeriod } from '../types';
import {
  getTrialBalance, getAccountingPeriods,
  openAccountingPeriod, closeAccountingPeriod, createAccountingPeriod
} from '../services/api';

// ---------------------------------------------------------------
//  Trial Balance
// ---------------------------------------------------------------
export function TrialBalance() {
  const [rows, setRows] = useState<GlAccount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getTrialBalance()
      .then(data => setRows(data.filter(a => a.is_postable)))
      .finally(() => setLoading(false));
  }, []);

  const totalDebit = rows.reduce((s, r) => s + Number(r.total_debit ?? 0), 0);
  const totalCredit = rows.reduce((s, r) => s + Number(r.total_credit ?? 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Trial Balance</h2>
          <p className="text-xs text-slate-500 mt-1 uppercase font-bold tracking-wider">
            Unadjusted · from posted entries only
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!loading && (
            <span className={cn(
              'px-3 py-1 text-xs font-bold rounded-full',
              isBalanced ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
            )}>
              {isBalanced ? 'In Balance' : 'OUT OF BALANCE'}
            </span>
          )}
          <button className="px-4 py-2 text-xs font-bold bg-slate-900 text-white rounded shadow hover:bg-black uppercase tracking-wide flex items-center gap-2">
            <Download size={14} /> Export
          </button>
        </div>
      </div>

      <Card className="p-0">
        {loading ? (
          <div className="flex items-center justify-center py-20 gap-3 text-slate-400">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm">Computing balances...</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <p className="text-sm">No posted entries yet — balances will appear here after posting journal entries.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-200">
                  <th className="px-6 py-4 w-32">Code</th>
                  <th className="px-6 py-4">Account Name</th>
                  <th className="px-6 py-4 w-24">Type</th>
                  <th className="px-6 py-4 text-right w-40">Debit ($)</th>
                  <th className="px-6 py-4 text-right w-40">Credit ($)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(row => (
                  <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-3 font-mono text-xs text-slate-500">{row.account_code}</td>
                    <td className="px-6 py-3 text-sm font-semibold text-slate-700">{row.name}</td>
                    <td className="px-6 py-3 text-xs capitalize text-slate-500">{row.account_type}</td>
                    <td className="px-6 py-3 text-right font-mono text-sm">
                      {Number(row.total_debit) > 0 ? formatCurrency(Number(row.total_debit)) : ''}
                    </td>
                    <td className="px-6 py-3 text-right font-mono text-sm">
                      {Number(row.total_credit) > 0 ? formatCurrency(Number(row.total_credit)) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-900 text-white border-t-2 border-slate-700">
                  <td className="px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em]" colSpan={3}>Totals</td>
                  <td className="px-6 py-4 text-right font-mono text-sm font-bold">{formatCurrency(totalDebit)}</td>
                  <td className="px-6 py-4 text-right font-mono text-sm font-bold">{formatCurrency(totalCredit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------
//  Create Period Modal
// ---------------------------------------------------------------
function CreatePeriodModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const now = new Date();
  const [form, setForm] = useState({
    name: `${now.toLocaleString('default', { month: 'short' }).toUpperCase()} ${now.getFullYear()}`,
    start_date: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0],
    end_date: new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0],
    fiscal_year: now.getFullYear(),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await createAccountingPeriod(form);
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-md p-6">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-bold text-slate-900">Create Accounting Period</h3>
          <button onClick={onClose}><X size={20} className="text-slate-400" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Period Name</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Start Date</label>
              <input
                type="date"
                value={form.start_date}
                onChange={e => setForm({ ...form, start_date: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">End Date</label>
              <input
                type="date"
                value={form.end_date}
                onChange={e => setForm({ ...form, end_date: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Fiscal Year</label>
            <input
              type="number"
              value={form.fiscal_year}
              onChange={e => setForm({ ...form, fiscal_year: Number(e.target.value) })}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          {error && (
            <div className="flex items-center gap-2 text-sm text-rose-600">
              <AlertCircle size={14} /> {error}
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 text-sm font-bold border border-slate-200 rounded hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 flex justify-center items-center gap-2 px-4 py-2 text-sm font-bold bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
              {saving && <Loader2 size={14} className="animate-spin" />}
              Create Period
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
//  Accounting Periods
// ---------------------------------------------------------------
const periodStatusColors: Record<string, 'positive' | 'negative' | 'info' | 'neutral'> = {
  open: 'positive',
  closed: 'negative',
  future: 'info',
  soft_closed: 'neutral',
};

export function AccountingPeriods() {
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAccountingPeriods();
      setPeriods(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleClose(id: number) {
    if (!confirm('Close this period? No more entries can be posted to it.')) return;
    setActionLoading(id);
    setError('');
    try {
      await closeAccountingPeriod(id);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleOpen(id: number) {
    setActionLoading(id);
    setError('');
    try {
      await openAccountingPeriod(id);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Accounting Periods</h2>
          <p className="text-xs text-slate-500 mt-1 uppercase font-bold tracking-wider">Fiscal year operational status</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 text-xs font-bold bg-blue-600 text-white rounded shadow hover:bg-blue-700 uppercase tracking-wide flex items-center gap-2"
        >
          <Plus size={14} /> New Period
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-3 p-4 bg-rose-50 border border-rose-100 rounded text-sm text-rose-700">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 gap-3 text-slate-400">
          <Loader2 size={20} className="animate-spin" />
          <span className="text-sm">Loading periods...</span>
        </div>
      ) : periods.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
          <p className="text-sm">No accounting periods yet.</p>
          <button onClick={() => setShowModal(true)} className="text-sm font-bold text-blue-600 hover:underline">
            Create your first period →
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-6">
          {periods.map(period => (
            <Card key={period.id} className="relative group hover:border-blue-300 transition-all">
              <div className="flex justify-between items-start mb-4">
                <div className="p-2 bg-slate-50 rounded text-slate-500 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
                  <Calendar size={18} />
                </div>
                <Badge type={periodStatusColors[period.status] ?? 'neutral'}>{period.status}</Badge>
              </div>
              <h3 className="text-lg font-bold text-slate-900">{period.name}</h3>
              <div className="mt-3 space-y-1">
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Duration</p>
                <p className="text-xs text-slate-600 font-medium">{period.start_date} → {period.end_date}</p>
                <p className="text-[10px] text-slate-400">FY {period.fiscal_year}</p>
              </div>
              <div className="mt-5">
                {period.status === 'open' && (
                  <button
                    onClick={() => handleClose(period.id)}
                    disabled={actionLoading === period.id}
                    className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-rose-50 text-rose-600 text-[10px] font-bold rounded uppercase hover:bg-rose-100 border border-rose-100 disabled:opacity-50"
                  >
                    {actionLoading === period.id ? <Loader2 size={12} className="animate-spin" /> : <Lock size={12} />}
                    Close Period
                  </button>
                )}
                {period.status === 'closed' && (
                  <button
                    onClick={() => handleOpen(period.id)}
                    disabled={actionLoading === period.id}
                    className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-blue-50 text-blue-600 text-[10px] font-bold rounded uppercase hover:bg-blue-100 border border-blue-100 disabled:opacity-50"
                  >
                    {actionLoading === period.id ? <Loader2 size={12} className="animate-spin" /> : <Unlock size={12} />}
                    Reopen
                  </button>
                )}
                {period.status === 'future' && (
                  <button
                    onClick={() => handleOpen(period.id)}
                    disabled={actionLoading === period.id}
                    className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-emerald-50 text-emerald-600 text-[10px] font-bold rounded uppercase hover:bg-emerald-100 border border-emerald-100 disabled:opacity-50"
                  >
                    {actionLoading === period.id ? <Loader2 size={12} className="animate-spin" /> : <Unlock size={12} />}
                    Open Period
                  </button>
                )}
                {period.status === 'soft_closed' && (
                  <div className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-slate-50 text-slate-400 text-[10px] font-bold rounded uppercase border border-slate-100">
                    <Lock size={12} /> Soft Closed
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {showModal && (
        <CreatePeriodModal onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); load(); }} />
      )}
    </div>
  );
}

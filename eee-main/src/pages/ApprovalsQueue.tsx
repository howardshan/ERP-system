import React, { useState, useEffect, useCallback } from 'react';
import { Card, Badge } from '../components/ui/Cards';
import { cn, formatCurrency } from '../lib/utils';
import { Loader2, CheckCircle2, XCircle, Eye, Clock, AlertTriangle } from 'lucide-react';
import { JournalEntry, ApprovalTier } from '../types';
import { getPendingApprovals, approveJournalEntry, rejectJournalEntry, getApprovalTiers, getJournalEntry } from '../services/api';

export default function ApprovalsQueue({ onNavigate }: { onNavigate?: (screen: string) => void }) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [tiers, setTiers] = useState<ApprovalTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const [actionLoading, setActionLoading] = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pending, tierList] = await Promise.all([
        getPendingApprovals(),
        getApprovalTiers(),
      ]);
      setEntries(pending);
      setTiers(tierList);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load approvals.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function openModal(entry: JournalEntry) {
    setSelectedEntry(entry);
    setModalLoading(true);
    setModalError(null);
    setShowRejectForm(false);
    setRejectReason('');
    setRejectError(null);
    try {
      const full = await getJournalEntry(entry.id);
      setSelectedEntry(full);
    } catch (e: any) {
      setModalError(e.message ?? 'Failed to load entry details.');
    } finally {
      setModalLoading(false);
    }
  }

  function closeModal() {
    setSelectedEntry(null);
    setModalLoading(false);
    setModalError(null);
    setShowRejectForm(false);
    setRejectReason('');
    setRejectError(null);
  }

  async function handleApprove() {
    if (!selectedEntry) return;
    setActionLoading(true);
    setModalError(null);
    try {
      await approveJournalEntry(selectedEntry.id);
      closeModal();
      await load();
    } catch (e: any) {
      setModalError(e.message ?? 'Failed to approve entry.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReject() {
    if (!selectedEntry) return;
    if (!rejectReason.trim()) {
      setRejectError('Rejection reason is required.');
      return;
    }
    setActionLoading(true);
    setRejectError(null);
    setModalError(null);
    try {
      await rejectJournalEntry(selectedEntry.id, rejectReason.trim());
      closeModal();
      await load();
    } catch (e: any) {
      setModalError(e.message ?? 'Failed to reject entry.');
    } finally {
      setActionLoading(false);
    }
  }

  function getTierLabel(tierId?: number) {
    if (!tierId) return '—';
    const tier = tiers.find(t => t.id === tierId);
    return tier ? tier.label : '—';
  }

  const totalDebit = (entry: JournalEntry) => {
    if (entry.lines && entry.lines.length > 0) {
      return entry.lines.reduce((sum, l) => sum + Number(l.debit), 0);
    }
    if (entry.total_debit != null) return entry.total_debit;
    return 0;
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Approvals Queue</h2>
        <p className="text-xs text-slate-500 mt-1 uppercase font-bold tracking-wider">
          {entries.length} entr{entries.length === 1 ? 'y' : 'ies'} pending approval
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-3 px-4 py-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm">
          <AlertTriangle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {tiers.length > 0 && (
        <div className="flex flex-wrap gap-3 p-4 bg-slate-50 border border-slate-200 rounded-lg">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 self-center mr-1">
            Approval Tiers:
          </span>
          {tiers.map(tier => (
            <div
              key={tier.id}
              className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-md shadow-sm"
            >
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-700">{tier.label}</span>
              <span className="text-[10px] text-slate-400">
                {tier.approval_limit == null ? 'Unlimited' : `up to ${formatCurrency(tier.approval_limit)}`}
              </span>
            </div>
          ))}
        </div>
      )}

      <Card className="p-0">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20 gap-3 text-slate-400">
              <Loader2 size={20} className="animate-spin" />
              <span className="text-sm">Loading pending approvals...</span>
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
              <CheckCircle2 size={32} className="text-emerald-400" />
              <p className="text-sm font-medium">No entries pending approval</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-200">
                  <th className="px-6 py-4">Entry #</th>
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4">Description</th>
                  <th className="px-6 py-4">Submitted By</th>
                  <th className="px-6 py-4 text-right">Amount</th>
                  <th className="px-6 py-4">Required Tier</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map(entry => (
                  <tr
                    key={entry.id}
                    onClick={() => openModal(entry)}
                    className="hover:bg-blue-50/30 transition-colors cursor-pointer group"
                  >
                    <td className="px-6 py-4 font-bold text-sm text-blue-600 font-mono">
                      {entry.entry_number}
                    </td>
                    <td className="px-6 py-4 text-xs font-medium text-slate-500">
                      {entry.entry_date}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-700">
                      {entry.description || '—'}
                    </td>
                    <td className="px-6 py-4 text-xs font-mono text-slate-500">
                      {entry.submitted_by
                        ? `…${entry.submitted_by.slice(-8)}`
                        : '—'}
                    </td>
                    <td className="px-6 py-4 text-right font-mono text-sm font-bold text-slate-900">
                      {formatCurrency(totalDebit(entry))}
                    </td>
                    <td className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wide">
                      {getTierLabel(entry.required_tier_id)}
                    </td>
                    <td className="px-6 py-4">
                      <Badge type="warning">Pending Approval</Badge>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Eye
                        size={15}
                        className="text-slate-300 group-hover:text-blue-500 transition-colors inline"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {selectedEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col border border-slate-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/60 rounded-t-xl">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {selectedEntry.entry_number}
                </h3>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">
                  {selectedEntry.entry_date}
                  {selectedEntry.description ? ` · ${selectedEntry.description}` : ''}
                </p>
              </div>
              <button
                onClick={closeModal}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                aria-label="Close"
              >
                <XCircle size={20} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-6 space-y-4">
              {modalError && (
                <div className="flex items-center gap-3 px-4 py-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm">
                  <AlertTriangle size={16} className="shrink-0" />
                  <span>{modalError}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 text-xs">
                <div className="space-y-1">
                  <p className="font-bold uppercase tracking-widest text-slate-400">Submitted By</p>
                  <p className="font-mono text-slate-700">
                    {selectedEntry.submitted_by
                      ? `…${selectedEntry.submitted_by.slice(-8)}`
                      : '—'}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="font-bold uppercase tracking-widest text-slate-400">Required Tier</p>
                  <p className="font-bold text-slate-700 uppercase">
                    {getTierLabel(selectedEntry.required_tier_id)}
                  </p>
                </div>
                {selectedEntry.submitted_at && (
                  <div className="space-y-1">
                    <p className="font-bold uppercase tracking-widest text-slate-400">Submitted At</p>
                    <p className="text-slate-700 flex items-center gap-1">
                      <Clock size={12} />
                      {new Date(selectedEntry.submitted_at).toLocaleString()}
                    </p>
                  </div>
                )}
                {selectedEntry.notes && (
                  <div className="space-y-1 col-span-2">
                    <p className="font-bold uppercase tracking-widest text-slate-400">Notes</p>
                    <p className="text-slate-700">{selectedEntry.notes}</p>
                  </div>
                )}
              </div>

              {modalLoading ? (
                <div className="flex items-center justify-center py-10 gap-3 text-slate-400">
                  <Loader2 size={18} className="animate-spin" />
                  <span className="text-sm">Loading lines...</span>
                </div>
              ) : selectedEntry.lines && selectedEntry.lines.length > 0 ? (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                    Journal Lines
                  </p>
                  <table className="w-full text-left border-collapse border border-slate-200 rounded-lg overflow-hidden text-xs">
                    <thead>
                      <tr className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-200">
                        <th className="px-4 py-3">Account</th>
                        <th className="px-4 py-3">Description</th>
                        <th className="px-4 py-3 text-right">Debit</th>
                        <th className="px-4 py-3 text-right">Credit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedEntry.lines.map((line, i) => (
                        <tr key={line.id ?? i} className="hover:bg-slate-50/50">
                          <td className="px-4 py-2.5 font-mono text-blue-700">
                            {line.account_code
                              ? `${line.account_code} · ${line.account_name ?? ''}`
                              : String(line.gl_account_id)}
                          </td>
                          <td className="px-4 py-2.5 text-slate-600">{line.description || '—'}</td>
                          <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-900">
                            {line.debit > 0 ? formatCurrency(line.debit) : ''}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-900">
                            {line.credit > 0 ? formatCurrency(line.credit) : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-50 border-t border-slate-200 font-bold text-[10px] uppercase tracking-widest text-slate-500">
                        <td className="px-4 py-2.5 col-span-2" colSpan={2}>Totals</td>
                        <td className="px-4 py-2.5 text-right font-mono text-slate-900">
                          {formatCurrency(
                            selectedEntry.lines.reduce((s, l) => s + Number(l.debit), 0)
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-slate-900">
                          {formatCurrency(
                            selectedEntry.lines.reduce((s, l) => s + Number(l.credit), 0)
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : null}

              {showRejectForm && (
                <div className="space-y-2 pt-2">
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    Rejection Reason <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    value={rejectReason}
                    onChange={e => { setRejectReason(e.target.value); setRejectError(null); }}
                    rows={3}
                    placeholder="Explain why this entry is being rejected..."
                    className={cn(
                      'w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-1 resize-none',
                      rejectError
                        ? 'border-rose-400 focus:ring-rose-400'
                        : 'border-slate-200 focus:ring-blue-500'
                    )}
                  />
                  {rejectError && (
                    <p className="text-xs text-rose-600">{rejectError}</p>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/60 rounded-b-xl flex items-center justify-between gap-3">
              <button
                onClick={closeModal}
                className="px-4 py-2 text-xs font-bold border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors uppercase tracking-wide"
              >
                Cancel
              </button>

              <div className="flex items-center gap-3">
                {!showRejectForm ? (
                  <button
                    onClick={() => setShowRejectForm(true)}
                    disabled={actionLoading}
                    className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-rose-50 text-rose-600 border border-rose-200 rounded-lg hover:bg-rose-100 transition-colors disabled:opacity-50 uppercase tracking-wide"
                  >
                    <XCircle size={14} />
                    Reject
                  </button>
                ) : (
                  <button
                    onClick={handleReject}
                    disabled={actionLoading || !rejectReason.trim()}
                    className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition-colors disabled:opacity-50 uppercase tracking-wide"
                  >
                    {actionLoading ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <XCircle size={14} />
                    )}
                    Confirm Rejection
                  </button>
                )}

                <button
                  onClick={handleApprove}
                  disabled={actionLoading}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 uppercase tracking-wide"
                >
                  {actionLoading ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <CheckCircle2 size={14} />
                  )}
                  Approve
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

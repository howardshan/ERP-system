import React, { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, XCircle, CalendarDays } from 'lucide-react';
import { getLeaveRequests, approveLeaveRequest, rejectLeaveRequest, getLeaveTypes } from '../../../services/hrApi';
import type { LeaveRequest, LeaveType } from '../../../services/hrApi';
import { usePermissions } from '../../../contexts/PermissionContext';
import { supabase } from '../../../lib/supabase';

const STATUS_COLORS: Record<string, string> = {
  pending:  'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-600',
  cancelled:'bg-slate-100 text-slate-500',
  recalled: 'bg-blue-100 text-blue-700',
};

export default function LeaveRequests() {
  const { can } = usePermissions();
  const canApprove = can('hr', 'leave', 'approve');

  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading]     = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [rejectModal, setRejectModal] = useState<{ id: number } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [processing, setProcessing] = useState<number | null>(null);
  const [currentUserId, setCurrentUserId] = useState('');

  useEffect(() => {
    supabase.from('erp_user').select('id').then(async ({ data }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: eu } = await supabase.from('erp_user').select('id').eq('auth_user_id', user.id).single();
        if (eu) setCurrentUserId(eu.id);
      }
    });
  }, []);

  async function load() {
    setLoading(true);
    const [r, lt] = await Promise.all([getLeaveRequests(statusFilter ? { status: statusFilter } : {}), getLeaveTypes()]);
    setRequests(r); setLeaveTypes(lt); setLoading(false);
  }
  useEffect(() => { load(); }, [statusFilter]);

  async function approve(id: number) {
    if (!currentUserId) return;
    setProcessing(id);
    await approveLeaveRequest(id, currentUserId);
    load(); setProcessing(null);
  }

  async function reject(id: number) {
    if (!rejectReason.trim()) return;
    if (!currentUserId) return;
    setProcessing(id);
    await rejectLeaveRequest(id, currentUserId, rejectReason);
    setRejectModal(null); setRejectReason('');
    load(); setProcessing(null);
  }

  return (
    <div className="min-h-screen bg-[#faf8f5] flex flex-col">
      <div className="px-10 pt-8 pb-5 border-b border-slate-200 bg-white">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">HR / Time & Leave</p>
        <h1 className="text-2xl font-bold text-slate-900">Leave Requests</h1>
      </div>

      <main className="flex-1 overflow-y-auto px-10 py-7">
        <div className="flex gap-2 mb-5">
          {['','pending','approved','rejected','cancelled'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-xs font-bold rounded-full transition-colors ${statusFilter === s ? 'bg-teal-600 text-white' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}>
              {s || 'All'}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 py-16 justify-center"><Loader2 size={18} className="animate-spin" /></div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {requests.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                <CalendarDays size={32} className="opacity-40" />
                <p className="text-sm">No leave requests</p>
              </div>
            ) : (
              <table className="w-full">
                <thead><tr className="bg-slate-50 border-b border-slate-200">
                  {['Employee','Type','Period','Days','Reason','Status',''].map(h => <th key={h} className="px-5 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">{h}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {requests.map(r => (
                    <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3.5 font-semibold text-slate-900 text-sm">{r.employee_name ?? r.employee_id}</td>
                      <td className="px-5 py-3.5 text-slate-500 text-sm">{r.leave_type_name ?? r.leave_type_id}</td>
                      <td className="px-5 py-3.5 text-slate-500 text-sm">{r.start_date} → {r.end_date}</td>
                      <td className="px-5 py-3.5 text-slate-500 text-sm">{r.days_requested}</td>
                      <td className="px-5 py-3.5 text-slate-500 text-sm max-w-xs truncate">{r.reason ?? '—'}</td>
                      <td className="px-5 py-3.5">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLORS[r.status] ?? 'bg-slate-100 text-slate-500'}`}>{r.status}</span>
                        {r.status === 'rejected' && r.rejection_reason && (
                          <p className="text-[10px] text-red-500 mt-0.5">{r.rejection_reason}</p>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        {canApprove && r.status === 'pending' && (
                          <div className="flex gap-1.5">
                            <button onClick={() => approve(r.id)} disabled={processing === r.id}
                              className="p-1.5 rounded hover:bg-emerald-50 text-emerald-600 disabled:opacity-50 transition-colors" title="Approve">
                              <CheckCircle2 size={15} />
                            </button>
                            <button onClick={() => { setRejectModal({ id: r.id }); setRejectReason(''); }}
                              className="p-1.5 rounded hover:bg-red-50 text-red-500 transition-colors" title="Reject">
                              <XCircle size={15} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </main>

      {rejectModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-slate-900 mb-4">Reject Leave Request</h2>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Reason *</label>
            <textarea rows={3} value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Provide a reason for rejection…"
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none" />
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setRejectModal(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
              <button onClick={() => reject(rejectModal.id)} disabled={!rejectReason.trim()}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-bold rounded-lg">
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

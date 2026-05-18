import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Cards';
import { cn, formatCurrency } from '../lib/utils';
import { Loader2, Pencil, Plus, X, Check, Trash2, Shield } from 'lucide-react';
import { ApprovalTier } from '../types';
import { getApprovalTiers, updateApprovalTier, createApprovalTier, deleteApprovalTier } from '../services/api';

interface EditState {
  label: string;
  approval_limit: string;
}

interface NewTierState {
  name: string;
  label: string;
  approval_limit: string;
  sort_order: string;
}

export default function ApprovalSettings({ onNavigate }: { onNavigate?: (screen: string) => void }) {
  const [tiers, setTiers] = useState<ApprovalTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editState, setEditState] = useState<EditState>({ label: '', approval_limit: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [showAddRow, setShowAddRow] = useState(false);
  const [newTier, setNewTier] = useState<NewTierState>({ name: '', label: '', approval_limit: '', sort_order: '' });
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getApprovalTiers();
      setTiers(data);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load approval tiers.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function startEdit(tier: ApprovalTier) {
    setEditingId(tier.id);
    setEditState({
      label: tier.label,
      approval_limit: tier.approval_limit == null ? '' : String(tier.approval_limit),
    });
    setEditError(null);
    setConfirmDeleteId(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditState({ label: '', approval_limit: '' });
    setEditError(null);
  }

  async function saveEdit(tier: ApprovalTier) {
    const label = editState.label.trim();
    if (!label) {
      setEditError('Label is required.');
      return;
    }
    const approval_limit = editState.approval_limit.trim() === ''
      ? null
      : Number(editState.approval_limit);
    if (editState.approval_limit.trim() !== '' && (isNaN(approval_limit as number) || (approval_limit as number) < 0)) {
      setEditError('Approval limit must be a positive number or empty for unlimited.');
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      await updateApprovalTier(tier.id, { label, approval_limit });
      cancelEdit();
      await load();
    } catch (e: any) {
      setEditError(e.message ?? 'Failed to save tier.');
    } finally {
      setEditSaving(false);
    }
  }

  function openAddRow() {
    const maxSort = tiers.length > 0 ? Math.max(...tiers.map(t => t.sort_order)) + 1 : 1;
    setNewTier({ name: '', label: '', approval_limit: '', sort_order: String(maxSort) });
    setAddError(null);
    setShowAddRow(true);
    setConfirmDeleteId(null);
    cancelEdit();
  }

  function cancelAdd() {
    setShowAddRow(false);
    setNewTier({ name: '', label: '', approval_limit: '', sort_order: '' });
    setAddError(null);
  }

  async function saveAdd() {
    const name = newTier.name.trim();
    const label = newTier.label.trim();
    if (!name || !label) {
      setAddError('Name and label are required.');
      return;
    }
    const sort_order = newTier.sort_order.trim() === '' ? 0 : Number(newTier.sort_order);
    if (isNaN(sort_order)) {
      setAddError('Sort order must be a number.');
      return;
    }
    const approval_limit = newTier.approval_limit.trim() === ''
      ? null
      : Number(newTier.approval_limit);
    if (newTier.approval_limit.trim() !== '' && (isNaN(approval_limit as number) || (approval_limit as number) < 0)) {
      setAddError('Approval limit must be a positive number or empty for unlimited.');
      return;
    }
    setAddSaving(true);
    setAddError(null);
    try {
      await createApprovalTier({ name, label, approval_limit, sort_order });
      cancelAdd();
      await load();
    } catch (e: any) {
      setAddError(e.message ?? 'Failed to create tier.');
    } finally {
      setAddSaving(false);
    }
  }

  async function handleDelete(id: number) {
    setDeletingId(id);
    try {
      await deleteApprovalTier(id);
      setConfirmDeleteId(null);
      await load();
    } catch (e: any) {
      setError(e.message ?? 'Failed to delete tier.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Approval Settings</h2>
          <p className="text-xs text-slate-500 mt-1 uppercase font-bold tracking-wider">
            Manage approval tier thresholds
          </p>
        </div>
        <button
          onClick={openAddRow}
          className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-blue-600 text-white rounded-lg shadow hover:bg-blue-700 transition-colors uppercase tracking-wide"
        >
          <Plus size={14} />
          Add Tier
        </button>
      </div>

      <div className="flex items-start gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-800 text-xs">
        <Shield size={15} className="shrink-0 mt-0.5 text-blue-500" />
        <span>
          <span className="font-bold">Note:</span> Approval limits apply once users are assigned to a tier. Without login/auth configured, all users can approve any amount.
        </span>
      </div>

      {error && (
        <div className="flex items-center gap-3 px-4 py-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm">
          <span>{error}</span>
        </div>
      )}

      <Card className="p-0">
        {loading ? (
          <div className="flex items-center justify-center py-20 gap-3 text-slate-400">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm">Loading tiers...</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-200">
                  <th className="px-6 py-4">Name</th>
                  <th className="px-6 py-4">Label</th>
                  <th className="px-6 py-4 text-right">Approval Limit</th>
                  <th className="px-6 py-4 text-center w-24">Sort Order</th>
                  <th className="px-6 py-4 w-28" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tiers.map(tier => (
                  <tr key={tier.id} className="group hover:bg-slate-50/60 transition-colors">
                    <td className="px-6 py-3 text-xs font-mono font-bold text-slate-500 uppercase tracking-wide">
                      {tier.name}
                    </td>

                    {editingId === tier.id ? (
                      <>
                        <td className="px-6 py-3">
                          <input
                            type="text"
                            value={editState.label}
                            onChange={e => setEditState(s => ({ ...s, label: e.target.value }))}
                            className={cn(
                              'w-full px-2 py-1 text-sm border rounded focus:outline-none focus:ring-1',
                              editError ? 'border-rose-400 focus:ring-rose-400' : 'border-slate-300 focus:ring-blue-500'
                            )}
                            placeholder="e.g. Manager"
                            autoFocus
                          />
                        </td>
                        <td className="px-6 py-3">
                          <input
                            type="number"
                            value={editState.approval_limit}
                            onChange={e => setEditState(s => ({ ...s, approval_limit: e.target.value }))}
                            className={cn(
                              'w-full px-2 py-1 text-sm border rounded focus:outline-none focus:ring-1 text-right',
                              editError ? 'border-rose-400 focus:ring-rose-400' : 'border-slate-300 focus:ring-blue-500'
                            )}
                            placeholder="Unlimited"
                            min="0"
                          />
                          {editError && (
                            <p className="text-[10px] text-rose-600 mt-1">{editError}</p>
                          )}
                        </td>
                        <td className="px-6 py-3 text-center text-xs text-slate-400">
                          {tier.sort_order}
                        </td>
                        <td className="px-6 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => saveEdit(tier)}
                              disabled={editSaving}
                              className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-bold bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 uppercase tracking-wide"
                            >
                              {editSaving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                              Save
                            </button>
                            <button
                              onClick={cancelEdit}
                              disabled={editSaving}
                              className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-bold border border-slate-200 text-slate-600 rounded hover:bg-slate-100 disabled:opacity-50 uppercase tracking-wide"
                            >
                              <X size={12} />
                              Cancel
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-6 py-3 text-sm font-medium text-slate-800">
                          {tier.label}
                        </td>
                        <td className="px-6 py-3 text-right font-mono text-sm text-slate-700">
                          {tier.approval_limit == null
                            ? <span className="text-slate-400 italic text-xs">Unlimited</span>
                            : formatCurrency(tier.approval_limit)
                          }
                        </td>
                        <td className="px-6 py-3 text-center text-xs font-bold text-slate-400">
                          {tier.sort_order}
                        </td>
                        <td className="px-6 py-3">
                          <div className="flex items-center justify-end gap-2">
                            {confirmDeleteId === tier.id ? (
                              <>
                                <span className="text-[10px] text-rose-600 font-bold uppercase tracking-wide mr-1">
                                  Confirm?
                                </span>
                                <button
                                  onClick={() => handleDelete(tier.id)}
                                  disabled={deletingId === tier.id}
                                  className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-bold bg-rose-600 text-white rounded hover:bg-rose-700 disabled:opacity-50 uppercase tracking-wide"
                                >
                                  {deletingId === tier.id
                                    ? <Loader2 size={12} className="animate-spin" />
                                    : <Trash2 size={12} />
                                  }
                                  Delete
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-bold border border-slate-200 text-slate-600 rounded hover:bg-slate-100 uppercase tracking-wide"
                                >
                                  <X size={12} />
                                  No
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => startEdit(tier)}
                                  className="p-1.5 text-slate-300 hover:text-blue-500 hover:bg-blue-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                                  title="Edit"
                                >
                                  <Pencil size={14} />
                                </button>
                                <button
                                  onClick={() => { setConfirmDeleteId(tier.id); cancelEdit(); }}
                                  className="p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                                  title="Delete"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}

                {showAddRow && (
                  <tr className="bg-blue-50/40 border-t-2 border-blue-200">
                    <td className="px-6 py-3">
                      <input
                        type="text"
                        value={newTier.name}
                        onChange={e => setNewTier(s => ({ ...s, name: e.target.value }))}
                        className="w-full px-2 py-1 text-sm border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        placeholder="e.g. tier_3"
                        autoFocus
                      />
                    </td>
                    <td className="px-6 py-3">
                      <input
                        type="text"
                        value={newTier.label}
                        onChange={e => setNewTier(s => ({ ...s, label: e.target.value }))}
                        className="w-full px-2 py-1 text-sm border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        placeholder="e.g. Director"
                      />
                      {addError && (
                        <p className="text-[10px] text-rose-600 mt-1">{addError}</p>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <input
                        type="number"
                        value={newTier.approval_limit}
                        onChange={e => setNewTier(s => ({ ...s, approval_limit: e.target.value }))}
                        className="w-full px-2 py-1 text-sm border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-right"
                        placeholder="Unlimited"
                        min="0"
                      />
                    </td>
                    <td className="px-6 py-3">
                      <input
                        type="number"
                        value={newTier.sort_order}
                        onChange={e => setNewTier(s => ({ ...s, sort_order: e.target.value }))}
                        className="w-full px-2 py-1 text-sm border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-center"
                        placeholder="0"
                      />
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={saveAdd}
                          disabled={addSaving}
                          className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-bold bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 uppercase tracking-wide"
                        >
                          {addSaving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                          Add
                        </button>
                        <button
                          onClick={cancelAdd}
                          disabled={addSaving}
                          className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-bold border border-slate-200 text-slate-600 rounded hover:bg-slate-100 disabled:opacity-50 uppercase tracking-wide"
                        >
                          <X size={12} />
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                )}

                {tiers.length === 0 && !showAddRow && (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-sm text-slate-400">
                      No approval tiers configured. Click "Add Tier" to create one.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

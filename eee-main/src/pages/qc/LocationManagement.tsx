import React, { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Pencil, X, Check } from 'lucide-react';
import { listDryRooms, createDryRoom, updateDryRoomCapacity, deleteDryRoom, DryRoom } from '../../services/qcApi';
import { usePermissions } from '../../contexts/PermissionContext';
import { PermissionDenied } from './components/PermissionDenied';
import { cn } from '../../lib/utils';

export default function LocationManagement() {
  const { t } = useTranslation('qc');
  const { can } = usePermissions();
  const canView = can('qc', 'locations', 'view');
  const canManage = can('qc', 'locations', 'manage');

  const [rooms, setRooms] = useState<DryRoom[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ dryer_number: '', capacity: '' });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCapacity, setEditCapacity] = useState('');

  const load = () => listDryRooms().then(setRooms).catch(e => setError(e.message));
  useEffect(() => { load(); }, []);

  const startCreate = () => {
    setCreating(true);
    setEditingId(null);
    setForm({ dryer_number: '', capacity: '' });
    setError(''); setMsg('');
  };
  const cancelCreate = () => { setCreating(false); setForm({ dryer_number: '', capacity: '' }); };

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const dryer = parseInt(form.dryer_number, 10);
    const capacity = parseInt(form.capacity, 10);
    if (!Number.isFinite(dryer) || dryer < 1) { setError(t('locationManagement.errDryerMin')); return; }
    if (!Number.isFinite(capacity) || capacity < 0) { setError(t('locationManagement.errCapacityMin')); return; }
    setBusy(true); setError('');
    try {
      await createDryRoom({ dryer_number: dryer, capacity });
      setMsg(t('locationManagement.roomAdded', { num: dryer }));
      cancelCreate();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('locationManagement.createFailed'));
    }
    setBusy(false);
  };

  const startEdit = (r: DryRoom) => {
    setCreating(false);
    setEditingId(r.id);
    setEditCapacity(String(r.capacity));
    setError(''); setMsg('');
  };
  const cancelEdit = () => { setEditingId(null); setEditCapacity(''); };

  const submitEdit = async (r: DryRoom) => {
    if (busy) return;
    const capacity = parseInt(editCapacity, 10);
    if (!Number.isFinite(capacity) || capacity < 0) { setError(t('locationManagement.errCapacityMin')); return; }
    setBusy(true); setError('');
    try {
      await updateDryRoomCapacity(r.id, capacity);
      setMsg(t('locationManagement.roomUpdated'));
      cancelEdit();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('locationManagement.updateFailed'));
    }
    setBusy(false);
  };

  const handleDelete = async (r: DryRoom) => {
    if (busy) return;
    if (!window.confirm(t('locationManagement.confirmDeleteRoom', { num: r.dryer_number }))) return;
    setBusy(true); setError('');
    try {
      await deleteDryRoom(r.id);
      setMsg(t('locationManagement.roomDeleted', { num: r.dryer_number }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('locationManagement.deleteFailed'));
    }
    setBusy(false);
  };

  if (!canView) {
    return <PermissionDenied permission="qc.locations.view" feature={t('locationManagement.title')} />;
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="flex items-end justify-between mb-1">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('locationManagement.title')}</h1>
          <p className="text-xs text-slate-500 mt-0.5">{t('locationManagement.roomSubtitle')}</p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={startCreate}
            disabled={creating || busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40"
          >
            <Plus size={12} /> {t('locationManagement.addRoom')}
          </button>
        )}
      </div>

      {msg && <p className="text-emerald-700 bg-emerald-50 p-2 rounded-lg mt-3 text-sm">{msg}</p>}
      {error && <p className="text-red-600 bg-red-50 p-2 rounded-lg mt-3 text-sm">{error}</p>}

      {!canManage && (
        <p className="text-amber-700 bg-amber-50 border border-amber-200 p-3 rounded-lg mt-3 text-sm">
          {t('locationManagement.readOnlyBefore')} <code className="font-mono">qc.locations.manage</code> {t('locationManagement.readOnlyAfter')}
        </p>
      )}

      {/* Create form */}
      {creating && (
        <form onSubmit={submitCreate} className="mt-5 bg-white border-2 border-blue-200 rounded-xl p-4 space-y-3">
          <h2 className="font-bold text-sm text-slate-900">{t('locationManagement.newRoom')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t('locationManagement.dryerNum')}>
              <input
                type="number" min={1}
                value={form.dryer_number}
                onChange={e => setForm({ ...form, dryer_number: e.target.value })}
                className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                required
              />
            </Field>
            <Field label={t('locationManagement.capacity')}>
              <input
                type="number" min={0}
                value={form.capacity}
                onChange={e => setForm({ ...form, capacity: e.target.value })}
                className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                required
              />
            </Field>
          </div>
          <div className="flex items-center gap-2">
            <button type="submit" disabled={busy} className="px-3 py-1.5 rounded text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40">
              {busy ? t('locationManagement.saving') : t('locationManagement.create')}
            </button>
            <button type="button" onClick={cancelCreate} className="px-3 py-1.5 rounded text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700">
              {t('locationManagement.cancel')}
            </button>
          </div>
        </form>
      )}

      {/* Rooms table */}
      <div className="mt-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
          <span className="font-bold text-sm text-slate-900">{t('locationManagement.title')}</span>
          <span className="text-xs text-slate-400">{t('locationManagement.roomCount', { count: rooms.length })}</span>
        </div>
        {rooms.length === 0 ? (
          <p className="text-slate-400 text-sm p-4">{t('locationManagement.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                <th className="px-4 py-2 text-left">{t('locationManagement.dryerNum')}</th>
                <th className="px-4 py-2 text-left">{t('locationManagement.capacity')}</th>
                <th className="px-4 py-2 text-right">{t('locationManagement.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rooms.map(r => {
                const isEditing = editingId === r.id;
                return (
                  <tr key={r.id} className={cn('align-middle', isEditing && 'bg-blue-50/40')}>
                    <td className="px-4 py-2 font-bold text-slate-800">
                      {t('locationManagement.dryerLabel', { num: r.dryer_number })}
                    </td>
                    <td className="px-4 py-2">
                      {isEditing ? (
                        <input
                          type="number" min={0}
                          value={editCapacity}
                          onChange={e => setEditCapacity(e.target.value)}
                          className="w-28 border border-slate-300 rounded px-2 py-1 text-sm"
                          autoFocus
                        />
                      ) : (
                        <span className="text-slate-700 tabular-nums">{r.capacity}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {isEditing ? (
                        <>
                          <button type="button" onClick={() => submitEdit(r)} disabled={busy}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 mr-1.5">
                            <Check size={11} /> {t('locationManagement.save')}
                          </button>
                          <button type="button" onClick={cancelEdit}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700">
                            <X size={11} />
                          </button>
                        </>
                      ) : canManage ? (
                        <>
                          <button type="button" onClick={() => startEdit(r)} disabled={busy || editingId !== null}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold border border-slate-200 hover:border-blue-400 text-slate-700 disabled:opacity-40 mr-1.5">
                            <Pencil size={11} /> {t('locationManagement.edit')}
                          </button>
                          <button type="button" onClick={() => handleDelete(r)} disabled={busy}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold border border-slate-200 hover:border-red-400 hover:text-red-600 text-slate-700 disabled:opacity-40">
                            <Trash2 size={11} />
                          </button>
                        </>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">{label}</span>
      {children}
    </label>
  );
}

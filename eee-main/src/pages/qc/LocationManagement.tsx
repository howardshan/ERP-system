import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, ChevronDown, ChevronRight, Pencil, X, Check } from 'lucide-react';
import {
  listLocations,
  createLocation,
  updateLocation,
  deleteLocation,
  DryingLocation,
} from '../../services/qcApi';
import { usePermissions } from '../../contexts/PermissionContext';
import { PermissionDenied } from './components/PermissionDenied';
import { cn } from '../../lib/utils';

interface CreateForm {
  dryer_number: string;  // string for input control; parsed on submit
  cell_number: string;
  display_name: string;
  code: string;
}

interface EditForm {
  display_name: string;
  code: string;
}

const emptyCreate = (): CreateForm => ({
  dryer_number: '',
  cell_number: '',
  display_name: '',
  code: '',
});

export default function LocationManagement() {
  const { t } = useTranslation('qc');
  const { can } = usePermissions();
  const canView = can('qc', 'locations', 'view');
  const canManage = can('qc', 'locations', 'manage');

  const [locations, setLocations] = useState<DryingLocation[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(emptyCreate());

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ display_name: '', code: '' });

  // Collapsed-by-dryer state — default to ALL collapsed because 500 rows is a lot
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const load = () => listLocations().then(setLocations).catch(e => setError(e.message));
  useEffect(() => { load(); }, []);

  // Group locations by dryer_number for display.  Locations without a
  // dryer_number (shouldn't happen post-M-036 but guard anyway) bucket
  // under a synthetic group keyed by `-1` so they're not silently dropped.
  const groups = useMemo(() => {
    const map = new Map<number, DryingLocation[]>();
    for (const l of locations) {
      const k = l.dryer_number ?? -1;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(l);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.cell_number ?? 0) - (b.cell_number ?? 0));
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [locations]);

  // Initialise collapsed = all dryers on first load so the page isn't a 500-row wall
  useEffect(() => {
    if (collapsed.size === 0 && groups.length > 1) {
      setCollapsed(new Set(groups.map(([n]) => n)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups.length]);

  const toggleGroup = (n: number) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  };

  const startCreate = () => {
    setCreating(true);
    setEditingId(null);
    setCreateForm(emptyCreate());
    setError('');
    setMsg('');
  };

  const cancelCreate = () => {
    setCreating(false);
    setCreateForm(emptyCreate());
  };

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const dryer = parseInt(createForm.dryer_number, 10);
    const cell = parseInt(createForm.cell_number, 10);
    if (!Number.isFinite(dryer) || dryer < 1) {
      setError(t('locationManagement.errDryerMin'));
      return;
    }
    if (!Number.isFinite(cell) || cell < 0) {
      setError(t('locationManagement.errCellMin'));
      return;
    }
    if (!createForm.display_name.trim()) {
      setError(t('locationManagement.errDisplayNameRequired'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const created = await createLocation({
        dryer_number: dryer,
        cell_number: cell,
        display_name: createForm.display_name.trim(),
        code: createForm.code.trim() || null,
      });
      setMsg(t('locationManagement.added', { code: created.code }));
      // Make sure the new dryer's group is expanded so the user sees the row
      setCollapsed(prev => { const n = new Set(prev); n.delete(dryer); return n; });
      cancelCreate();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('locationManagement.createFailed'));
    }
    setBusy(false);
  };

  const startEdit = (l: DryingLocation) => {
    setCreating(false);
    setEditingId(l.id);
    setEditForm({ display_name: l.display_name, code: l.code });
    setError('');
    setMsg('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({ display_name: '', code: '' });
  };

  const submitEdit = async (id: string) => {
    if (busy) return;
    if (!editForm.display_name.trim()) {
      setError(t('locationManagement.errDisplayNameRequired'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await updateLocation({
        id,
        display_name: editForm.display_name.trim(),
        code: editForm.code.trim() || null,
      });
      setMsg(t('locationManagement.updated'));
      cancelEdit();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('locationManagement.updateFailed'));
    }
    setBusy(false);
  };

  const handleDelete = async (l: DryingLocation) => {
    if (busy) return;
    const ok = window.confirm(t('locationManagement.confirmDelete', { code: l.code, name: l.display_name }));
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      await deleteLocation(l.id);
      setMsg(t('locationManagement.deleted', { code: l.code }));
      await load();
    } catch (err) {
      // Occupancy guard surfaces as a thrown Error from the RPC; show it inline
      setError(err instanceof Error ? err.message : t('locationManagement.deleteFailed'));
    }
    setBusy(false);
  };

  if (!canView) {
    return <PermissionDenied permission="qc.locations.view" feature={t('locationManagement.title')} />;
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-end justify-between mb-1">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('locationManagement.title')}</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {t('locationManagement.subtitle')}
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={startCreate}
            disabled={creating || busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40"
          >
            <Plus size={12} /> {t('locationManagement.addLocation')}
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
        <form
          onSubmit={submitCreate}
          className="mt-5 bg-white border-2 border-blue-200 rounded-xl p-4 space-y-3"
        >
          <h2 className="font-bold text-sm text-slate-900">{t('locationManagement.newCell')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <Field label={t('locationManagement.dryerNum')}>
              <input
                type="number"
                min={1}
                value={createForm.dryer_number}
                onChange={e => setCreateForm({ ...createForm, dryer_number: e.target.value })}
                className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                required
              />
            </Field>
            <Field label={t('locationManagement.cellNum')}>
              <input
                type="number"
                min={0}
                value={createForm.cell_number}
                onChange={e => setCreateForm({ ...createForm, cell_number: e.target.value })}
                className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                required
              />
            </Field>
            <Field label={t('locationManagement.displayName')}>
              <input
                type="text"
                value={createForm.display_name}
                onChange={e => setCreateForm({ ...createForm, display_name: e.target.value })}
                placeholder={t('locationManagement.displayNamePlaceholder')}
                className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                required
              />
            </Field>
            <Field label={t('locationManagement.codeOptional')}>
              <input
                type="text"
                value={createForm.code}
                onChange={e => setCreateForm({ ...createForm, code: e.target.value })}
                placeholder={t('locationManagement.codePlaceholder')}
                className="w-full border border-slate-300 rounded px-2 py-1 text-sm font-mono"
              />
            </Field>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={busy}
              className="px-3 py-1.5 rounded text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40"
            >
              {busy ? t('locationManagement.saving') : t('locationManagement.create')}
            </button>
            <button
              type="button"
              onClick={cancelCreate}
              className="px-3 py-1.5 rounded text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700"
            >
              {t('locationManagement.cancel')}
            </button>
          </div>
        </form>
      )}

      {/* Groups */}
      <div className="mt-5 space-y-2">
        {groups.length === 0 && (
          <p className="text-slate-400 text-sm">{t('locationManagement.empty')}</p>
        )}
        {groups.map(([dryerNumber, rows]) => {
          const isCollapsed = collapsed.has(dryerNumber);
          const groupLabel = dryerNumber < 0 ? t('locationManagement.unassigned') : t('locationManagement.dryerLabel', { num: dryerNumber });
          return (
            <div key={dryerNumber} className="bg-white border border-slate-200 rounded-xl">
              <button
                type="button"
                onClick={() => toggleGroup(dryerNumber)}
                className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50 rounded-xl text-left"
              >
                {isCollapsed
                  ? <ChevronRight size={14} className="text-slate-400 shrink-0" />
                  : <ChevronDown  size={14} className="text-slate-400 shrink-0" />}
                <span className="font-bold text-sm text-slate-900">{groupLabel}</span>
                <span className="text-xs text-slate-400 ml-auto">
                  {t('locationManagement.cellCount', { count: rows.length })}
                </span>
              </button>
              {!isCollapsed && (
                <div className="border-t border-slate-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                        <th className="px-4 py-2 text-left">{t('locationManagement.cellNum')}</th>
                        <th className="px-4 py-2 text-left">{t('locationManagement.code')}</th>
                        <th className="px-4 py-2 text-left">{t('locationManagement.displayName')}</th>
                        <th className="px-4 py-2 text-right">{t('locationManagement.actions')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.map(l => {
                        const isEditing = editingId === l.id;
                        return (
                          <tr key={l.id} className={cn('align-middle', isEditing && 'bg-blue-50/40')}>
                            <td className="px-4 py-2 font-mono text-slate-700">
                              {l.cell_number != null ? String(l.cell_number).padStart(2, '0') : '—'}
                            </td>
                            <td className="px-4 py-2">
                              {isEditing ? (
                                <input
                                  type="text"
                                  value={editForm.code}
                                  onChange={e => setEditForm({ ...editForm, code: e.target.value })}
                                  placeholder={t('locationManagement.codeUnchangedPlaceholder')}
                                  className="w-full border border-slate-300 rounded px-2 py-1 text-xs font-mono"
                                />
                              ) : (
                                <span className="font-mono text-xs text-slate-600">{l.code}</span>
                              )}
                            </td>
                            <td className="px-4 py-2">
                              {isEditing ? (
                                <input
                                  type="text"
                                  value={editForm.display_name}
                                  onChange={e => setEditForm({ ...editForm, display_name: e.target.value })}
                                  className="w-full border border-slate-300 rounded px-2 py-1 text-xs"
                                  required
                                />
                              ) : (
                                <span className="text-slate-800">{l.display_name}</span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-right whitespace-nowrap">
                              {isEditing ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => submitEdit(l.id)}
                                    disabled={busy}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 mr-1.5"
                                    title={t('locationManagement.save')}
                                  >
                                    <Check size={11} /> {t('locationManagement.save')}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={cancelEdit}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700"
                                    title={t('locationManagement.cancel')}
                                  >
                                    <X size={11} />
                                  </button>
                                </>
                              ) : canManage ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => startEdit(l)}
                                    disabled={busy || editingId !== null}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold border border-slate-200 hover:border-blue-400 text-slate-700 disabled:opacity-40 mr-1.5"
                                  >
                                    <Pencil size={11} /> {t('locationManagement.edit')}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDelete(l)}
                                    disabled={busy}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold border border-slate-200 hover:border-red-400 hover:text-red-600 text-slate-700 disabled:opacity-40"
                                  >
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
          );
        })}
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

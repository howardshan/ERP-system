import React, { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import {
  listTestTypes,
  createTestType,
  updateTestType,
  deleteTestType,
  TestType,
} from '../../services/qcApi';
import { usePermissions } from '../../contexts/PermissionContext';
import { PermissionDenied } from './components/PermissionDenied';
import { cn } from '../../lib/utils';

export default function TestTypesPage() {
  const { t: tr } = useTranslation('qc');
  const { can } = usePermissions();
  const canView   = can('production', 'products', 'view');
  const canCreate = can('production', 'products', 'create');
  const canEdit   = can('production', 'products', 'edit');
  const canDelete = can('production', 'products', 'delete');

  const [types, setTypes] = useState<TestType[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  // Inline create form
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUnit, setNewUnit] = useState('');
  const [newDesc, setNewDesc] = useState('');

  // Inline edit
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editUnit, setEditUnit] = useState('');
  const [editDesc, setEditDesc] = useState('');

  const load = () => listTestTypes().then(setTypes).catch(e => setError(e.message));

  useEffect(() => { load(); }, []);

  const startCreate = () => {
    setCreating(true); setEditId(null);
    setNewName(''); setNewUnit(''); setNewDesc('');
    setMsg(''); setError('');
  };
  const cancelCreate = () => { setCreating(false); setNewName(''); setNewUnit(''); setNewDesc(''); };

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true); setError('');
    try {
      await createTestType({ name: newName.trim(), unit: newUnit.trim() || null, description: newDesc.trim() || null });
      setMsg(tr('testTypesPage.toastCreated'));
      cancelCreate();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('testTypesPage.toastCreateFailed'));
    }
    setBusy(false);
  };

  const startEdit = (t: TestType) => {
    setEditId(t.id); setCreating(false);
    setEditName(t.name); setEditUnit(t.unit ?? ''); setEditDesc(t.description ?? '');
    setMsg(''); setError('');
  };
  const cancelEdit = () => setEditId(null);

  const submitEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (editId == null) return;
    setBusy(true); setError('');
    try {
      await updateTestType(editId, { name: editName.trim(), unit: editUnit.trim() || null, description: editDesc.trim() || null });
      setMsg(tr('testTypesPage.toastUpdated'));
      setEditId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('testTypesPage.toastUpdateFailed'));
    }
    setBusy(false);
  };

  const remove = async (t: TestType) => {
    if (!confirm(tr('testTypesPage.confirmDelete', { name: t.name }))) return;
    setBusy(true); setError('');
    try {
      await deleteTestType(t.id);
      setMsg(tr('testTypesPage.toastDeleted'));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('testTypesPage.toastDeleteFailed'));
    }
    setBusy(false);
  };

  if (!canView) return <PermissionDenied permission="production.products.view" feature={tr('testTypesPage.feature')} />;

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{tr('testTypesPage.title')}</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {tr('testTypesPage.subtitle')}
          </p>
        </div>
        {canCreate && !creating && (
          <button
            onClick={startCreate}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium"
          >
            <Plus size={14} /> {tr('testTypesPage.addTestType')}
          </button>
        )}
      </div>

      {msg   && <p className="text-emerald-700 bg-emerald-50 border border-emerald-200 p-2 rounded-lg text-sm mb-3">{msg}</p>}
      {error && <p className="text-red-600 bg-red-50 border border-red-200 p-2 rounded-lg text-sm mb-3">{error}</p>}

      {/* ── Create form ──────────────────────────────────────────────────── */}
      {creating && (
        <form
          onSubmit={submitCreate}
          className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 space-y-3"
        >
          <p className="text-sm font-semibold text-blue-900">{tr('testTypesPage.newTestType')}</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-700">{tr('testTypesPage.nameLabel')} <span className="text-red-500">*</span></span>
              <input
                autoFocus
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                placeholder={tr('testTypesPage.namePlaceholder')}
                value={newName}
                onChange={e => setNewName(e.target.value)}
                required
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700">{tr('testTypesPage.defaultUnitLabel')}</span>
              <input
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                placeholder={tr('testTypesPage.unitPlaceholder')}
                value={newUnit}
                onChange={e => setNewUnit(e.target.value)}
              />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-slate-700">{tr('testTypesPage.descriptionLabel')}</span>
            <input
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              placeholder={tr('testTypesPage.descriptionPlaceholder')}
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !newName.trim()}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50"
            >
              Create
            </button>
            <button type="button" onClick={cancelCreate} className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* ── Test type list ────────────────────────────────────────────────── */}
      <div className="bg-white border rounded-xl divide-y">
        {types.length === 0 && (
          <p className="p-5 text-sm text-slate-500">No test types yet. Add one above.</p>
        )}
        {types.map(t => (
          <div key={t.id} className="p-4">
            {editId === t.id ? (
              <form onSubmit={submitEdit} className="space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs font-medium text-slate-700">Name</span>
                    <input
                      autoFocus
                      className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      required
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-slate-700">Unit</span>
                    <input
                      className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                      value={editUnit}
                      onChange={e => setEditUnit(e.target.value)}
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">Description</span>
                  <input
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                    value={editDesc}
                    onChange={e => setEditDesc(e.target.value)}
                  />
                </label>
                <div className="flex gap-2">
                  <button type="submit" disabled={busy} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium disabled:opacity-50">
                    <Check size={12} /> Save
                  </button>
                  <button type="button" onClick={cancelEdit} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-slate-600 hover:bg-slate-100">
                    <X size={12} /> Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900 text-sm">{t.name}</span>
                    {t.unit && (
                      <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                        {t.unit}
                      </span>
                    )}
                    {!t.is_active && (
                      <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">inactive</span>
                    )}
                  </div>
                  {t.description && (
                    <p className="text-xs text-slate-500 mt-0.5">{t.description}</p>
                  )}
                </div>
                <div className={cn('flex items-center gap-1 shrink-0', (!canEdit && !canDelete) && 'hidden')}>
                  {canEdit && (
                    <button
                      onClick={() => startEdit(t)}
                      className="p-1.5 rounded hover:bg-slate-100 text-slate-500"
                      title="Edit"
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                  {canDelete && (
                    <button
                      onClick={() => remove(t)}
                      disabled={busy}
                      className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

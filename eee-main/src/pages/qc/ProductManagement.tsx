import React, { FormEvent, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  deleteProducts,
  Product,
  ProductInput,
} from '../../services/qcApi';
import { usePermissions } from '../../contexts/PermissionContext';
import { SelectAllCheckbox } from './components/SelectAllCheckbox';
import { cn } from '../../lib/utils';

const emptyForm = (): ProductInput => ({
  code: '',
  name: '',
  standard_drying_minutes: 240,
  template: { item_name: 'Water Activity (Aw)', unit: null, lower_limit: 0.65, upper_limit: 0.75 },
});

function productToForm(p: Product): ProductInput {
  const t = p.templates[0];
  return {
    code: p.code,
    name: p.name,
    standard_drying_minutes: p.standard_drying_minutes,
    template: t
      ? { item_name: t.item_name, unit: t.unit, lower_limit: t.lower_limit, upper_limit: t.upper_limit }
      : emptyForm().template,
  };
}

export default function ProductManagement() {
  const { can } = usePermissions();
  const canCreate = can('qc', 'products', 'create');
  const canEdit = can('qc', 'products', 'edit');
  const canDelete = can('qc', 'products', 'delete');

  const [products, setProducts] = useState<Product[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ProductInput>(emptyForm());
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const load = () => listProducts().then(setProducts).catch((e) => setError(e.message));

  useEffect(() => { load(); }, []);

  const cancel = () => { setEditingId(null); setCreating(false); setForm(emptyForm()); };
  const startCreate = () => { setEditingId(null); setForm(emptyForm()); setCreating(true); setMsg(''); setError(''); };
  const startEdit = (p: Product) => { setCreating(false); setEditingId(p.id); setForm(productToForm(p)); setMsg(''); setError(''); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (editingId) {
        await updateProduct(editingId, form);
        setMsg('Product updated');
        setEditingId(null);
      } else {
        await createProduct(form);
        setMsg('Product created');
        setCreating(false);
      }
      setForm(emptyForm());
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const remove = async (id: string, code: string) => {
    if (!confirm(`Delete product ${code}?`)) return;
    try {
      await deleteProduct(id);
      if (editingId === id) cancel();
      setMsg('Deleted');
      setSelected((prev) => { const next = new Set(prev); next.delete(id); return next; });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === products.length) setSelected(new Set());
    else setSelected(new Set(products.map((p) => p.id)));
  };

  const bulkDelete = async () => {
    if (!confirmBulkDelete) {
      setConfirmBulkDelete(true);
      setTimeout(() => setConfirmBulkDelete(false), 3000);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await deleteProducts([...selected]);
      setMsg(`Deleted ${selected.size} product(s)`);
      setSelected(new Set());
      setConfirmBulkDelete(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk delete failed');
    }
    setBusy(false);
  };

  const isBusy = creating || editingId !== null;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Products</h1>
      <p className="text-slate-600 mb-4 text-sm">
        Maintain SKU, reference dry time (SOP), and post-dry inspection limits.
      </p>

      {msg && <p className="text-emerald-700 bg-emerald-50 p-2 rounded-lg mb-3 text-sm">{msg}</p>}
      {error && <p className="text-red-600 mb-3 text-sm">{error}</p>}

      <div className="flex items-center gap-2 mb-4">
        {canCreate && (
          <button
            type="button"
            onClick={creating ? cancel : startCreate}
            disabled={editingId !== null}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold',
              creating ? 'bg-slate-200 text-slate-700' : 'bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50',
            )}
          >
            <Plus size={13} /> {creating ? 'Cancel new' : 'Add product'}
          </button>
        )}
      </div>

      <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-3">
        <SelectAllCheckbox total={products.length} selected={selected.size} onToggleAll={toggleSelectAll} />
        {canDelete && selected.size > 0 && (
          <button
            type="button"
            onClick={bulkDelete}
            disabled={busy}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-colors',
              confirmBulkDelete
                ? 'bg-red-600 hover:bg-red-500 text-white'
                : 'bg-red-50 hover:bg-red-100 text-red-600 border border-red-200',
            )}
          >
            <Trash2 size={12} />
            {confirmBulkDelete ? `Confirm delete (${selected.size})` : `Delete ${selected.size}`}
          </button>
        )}
      </div>

      {creating && (
        <form onSubmit={submit} className="bg-white border-2 border-blue-400 rounded-xl p-4 mb-6 space-y-4 shadow-sm">
          <h2 className="font-semibold text-blue-800 text-sm">New product</h2>
          <ProductFormFields form={form} setForm={setForm} />
          <div className="flex gap-2">
            <button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded-lg text-sm font-medium">Save</button>
            <button type="button" className="px-4 py-2 rounded-lg border text-sm" onClick={cancel}>Cancel</button>
          </div>
        </form>
      )}

      <ul className="space-y-3">
        {products.map((p) => {
          const t = p.templates[0];
          const isEditing = editingId === p.id;
          const checked = selected.has(p.id);
          return (
            <li key={p.id} className={cn(
              'rounded-xl p-4 transition-colors',
              isEditing ? 'bg-white border-2 border-blue-500 shadow-sm' : checked ? 'bg-blue-50/40 border-2 border-blue-400' : 'bg-white border',
            )}>
              {isEditing ? (
                <form onSubmit={submit} className="space-y-4">
                  <h2 className="font-semibold text-blue-800 text-sm">Edit · {p.name}</h2>
                  <ProductFormFields form={form} setForm={setForm} />
                  <div className="flex gap-2">
                    <button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded-lg text-sm font-medium">Save</button>
                    <button type="button" className="px-4 py-2 rounded-lg border text-sm" onClick={cancel}>Cancel</button>
                  </div>
                </form>
              ) : (
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSelect(p.id)}
                    className="w-4 h-4 rounded accent-blue-600 mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <div className="font-semibold text-slate-900">{p.name}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{p.code}</div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        {canEdit && (
                          <button
                            type="button"
                            className="text-blue-600 hover:text-blue-700 text-xs font-bold px-2 py-1 disabled:opacity-40"
                            disabled={isBusy}
                            onClick={() => startEdit(p)}
                          >
                            Edit
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            className="text-red-600 hover:text-red-700 text-xs font-bold px-2 py-1 disabled:opacity-40"
                            disabled={isBusy}
                            onClick={() => remove(p.id, p.code)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                    <dl className="mt-3 grid sm:grid-cols-2 gap-2 text-xs">
                      <div>
                        <dt className="text-slate-500">Reference dry</dt>
                        <dd className="text-slate-800">{p.standard_drying_minutes ? `${p.standard_drying_minutes} min` : 'Not set'}</dd>
                      </div>
                      {t && (
                        <div>
                          <dt className="text-slate-500">{t.item_name} spec range</dt>
                          <dd className="text-slate-800">[{t.lower_limit}, {t.upper_limit}]</dd>
                        </div>
                      )}
                    </dl>
                  </div>
                </div>
              )}
            </li>
          );
        })}
        {products.length === 0 && <p className="text-slate-500 text-sm">No products</p>}
      </ul>
    </div>
  );
}

function ProductFormFields({ form, setForm }: { form: ProductInput; setForm: (f: ProductInput) => void }) {
  return (
    <>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-700">SKU code</span>
          <input
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            required
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Product name</span>
          <input
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </label>
      </div>
      <label className="block">
        <span className="text-xs font-medium text-slate-700">Reference dry time (minutes, SOP)</span>
        <input
          type="number"
          min={1}
          className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
          value={form.standard_drying_minutes ?? ''}
          onChange={(e) =>
            setForm({ ...form, standard_drying_minutes: e.target.value ? Number(e.target.value) : null })
          }
        />
      </label>
      <fieldset className="border rounded-lg p-3 space-y-3">
        <legend className="text-xs font-semibold px-1 text-slate-700">Post-dry inspection spec</legend>
        <label className="block">
          <span className="text-xs text-slate-700">Inspection item</span>
          <input
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
            value={form.template.item_name}
            onChange={(e) =>
              setForm({ ...form, template: { ...form.template, item_name: e.target.value } })
            }
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-slate-700">Lower limit</span>
            <input
              type="number"
              step="0.01"
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              value={form.template.lower_limit}
              onChange={(e) =>
                setForm({ ...form, template: { ...form.template, lower_limit: Number(e.target.value) } })
              }
              required
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-700">Upper limit</span>
            <input
              type="number"
              step="0.01"
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              value={form.template.upper_limit}
              onChange={(e) =>
                setForm({ ...form, template: { ...form.template, upper_limit: Number(e.target.value) } })
              }
              required
            />
          </label>
        </div>
      </fieldset>
    </>
  );
}

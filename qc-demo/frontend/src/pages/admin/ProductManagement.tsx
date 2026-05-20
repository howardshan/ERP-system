import { FormEvent, useEffect, useState } from 'react';
import { api, Product, ProductInput } from '../../api/client';
import { AppShell } from '../../components/AppShell';
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
    standard_drying_minutes: p.standard_drying_minutes ?? undefined,
    template: t
      ? {
          item_name: t.item_name,
          unit: t.unit,
          lower_limit: t.lower_limit,
          upper_limit: t.upper_limit,
        }
      : emptyForm().template,
  };
}

function ProductFormFields({
  form,
  setForm,
}: {
  form: ProductInput;
  setForm: (f: ProductInput) => void;
}) {
  return (
    <>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm font-medium">SKU code</span>
          <input
            className="mt-1 w-full border rounded-lg px-3 py-2 min-h-[44px]"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            required
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Product name</span>
          <input
            className="mt-1 w-full border rounded-lg px-3 py-2 min-h-[44px]"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </label>
      </div>
      <label className="block">
        <span className="text-sm font-medium">Reference dry time (minutes, SOP)</span>
        <input
          type="number"
          min={1}
          className="mt-1 w-full border rounded-lg px-3 py-2 min-h-[44px]"
          value={form.standard_drying_minutes ?? ''}
          onChange={(e) =>
            setForm({
              ...form,
              standard_drying_minutes: e.target.value ? Number(e.target.value) : null,
            })
          }
        />
      </label>
      <fieldset className="border rounded-lg p-3 space-y-3">
        <legend className="text-sm font-semibold px-1">Post-dry inspection spec</legend>
        <label className="block">
          <span className="text-sm">Inspection item</span>
          <input
            className="mt-1 w-full border rounded-lg px-3 py-2"
            value={form.template.item_name}
            onChange={(e) =>
              setForm({ ...form, template: { ...form.template, item_name: e.target.value } })
            }
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm">Lower limit</span>
            <input
              type="number"
              step="0.01"
              className="mt-1 w-full border rounded-lg px-3 py-2"
              value={form.template.lower_limit}
              onChange={(e) =>
                setForm({
                  ...form,
                  template: { ...form.template, lower_limit: Number(e.target.value) },
                })
              }
              required
            />
          </label>
          <label className="block">
            <span className="text-sm">Upper limit</span>
            <input
              type="number"
              step="0.01"
              className="mt-1 w-full border rounded-lg px-3 py-2"
              value={form.template.upper_limit}
              onChange={(e) =>
                setForm({
                  ...form,
                  template: { ...form.template, upper_limit: Number(e.target.value) },
                })
              }
              required
            />
          </label>
        </div>
      </fieldset>
    </>
  );
}

export function ProductManagement() {
  const [products, setProducts] = useState<Product[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ProductInput>(emptyForm());
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => api.products().then(setProducts).catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  const cancel = () => {
    setEditingId(null);
    setCreating(false);
    setForm(emptyForm());
  };

  const startCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setCreating(true);
    setMsg('');
    setError('');
  };

  const startEdit = (p: Product) => {
    setCreating(false);
    setEditingId(p.id);
    setForm(productToForm(p));
    setMsg('');
    setError('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (editingId) {
        await api.updateProduct(editingId, form);
        setMsg('Product updated');
        setEditingId(null);
      } else {
        await api.createProduct(form);
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
      await api.deleteProduct(id);
      if (editingId === id) cancel();
      setMsg('Deleted');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const isBusy = creating || editingId !== null;

  return (
    <AppShell variant="admin" title="Products">
      <p className="text-slate-600 mb-4 text-sm">
        Maintain SKU, reference dry time (SOP), and post-dry inspection limits. Actual sub-lot check-in/out
        times are recorded under Production Lots on the QC floor.
      </p>
      {msg && <p className="text-emerald-700 bg-emerald-50 p-3 rounded-lg mb-4">{msg}</p>}
      {error && <p className="text-red-600 mb-4">{error}</p>}

      <button
        type="button"
        onClick={creating ? cancel : startCreate}
        disabled={editingId !== null}
        className={cn(
          'mb-4 px-4 py-2 rounded-xl min-h-[44px] font-medium',
          creating
            ? 'bg-slate-200 text-slate-700'
            : 'bg-blue-600 text-white disabled:opacity-50 disabled:cursor-not-allowed'
        )}
      >
        {creating ? 'Cancel new' : 'Add product'}
      </button>

      {creating && (
        <form onSubmit={submit} className="bg-white border-2 border-blue-400 rounded-xl p-4 mb-6 space-y-4 shadow-sm">
          <h2 className="font-semibold text-blue-800">New product</h2>
          <ProductFormFields form={form} setForm={setForm} />
          <div className="flex gap-2">
            <button type="submit" className="flex-1 bg-emerald-600 text-white py-3 rounded-xl min-h-[48px]">
              Save
            </button>
            <button type="button" className="px-4 py-3 rounded-xl border min-h-[48px]" onClick={cancel}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <ul className="space-y-3">
        {products.map((p) => {
          const t = p.templates[0];
          const isEditing = editingId === p.id;

          return (
            <li
              key={p.id}
              className={cn(
                'rounded-xl p-4 transition-colors',
                isEditing
                  ? 'bg-white border-2 border-blue-500 shadow-sm'
                  : 'bg-white border'
              )}
            >
              {isEditing ? (
                <form onSubmit={submit} className="space-y-4">
                  <h2 className="font-semibold text-blue-800">Edit · {p.name}</h2>
                  <ProductFormFields form={form} setForm={setForm} />
                  <div className="flex gap-2">
                    <button type="submit" className="flex-1 bg-emerald-600 text-white py-3 rounded-xl min-h-[48px]">
                      Save
                    </button>
                    <button type="button" className="px-4 py-3 rounded-xl border min-h-[48px]" onClick={cancel}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <div className="font-semibold text-lg">{p.name}</div>
                      <div className="text-sm text-slate-500">{p.code}</div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        className="text-blue-600 min-h-[44px] px-2 disabled:opacity-40"
                        disabled={isBusy}
                        onClick={() => startEdit(p)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="text-red-600 min-h-[44px] px-2 disabled:opacity-40"
                        disabled={isBusy}
                        onClick={() => remove(p.id, p.code)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <dl className="mt-3 grid sm:grid-cols-2 gap-2 text-sm">
                    <div>
                      <dt className="text-slate-500">Reference dry</dt>
                      <dd>{p.standard_drying_minutes ? `${p.standard_drying_minutes} min` : 'Not set'}</dd>
                    </div>
                    {t && (
                      <div>
                        <dt className="text-slate-500">{t.item_name} spec range</dt>
                        <dd>
                          [{t.lower_limit}, {t.upper_limit}]
                        </dd>
                      </div>
                    )}
                  </dl>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </AppShell>
  );
}

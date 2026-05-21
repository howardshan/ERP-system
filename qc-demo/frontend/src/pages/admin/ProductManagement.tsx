import { FormEvent, useEffect, useState } from 'react';
import { Box } from 'lucide-react';
import { api, Product, ProductInput } from '../../api/client';
import { AppShell } from '../../components/AppShell';
import { RowActionsMenu } from '../../components/RowActionsMenu';
import { Alert, Button, Card, EmptyState, Field, Input, PageHeader } from '../../components/ui';
import { getTone } from '../../components/ui/tone';
import { cn } from '../../lib/utils';

const emptyForm = (): ProductInput => ({
  code: '',
  name: '',
  standard_drying_minutes: 240,
  template: { item_name: 'Water Activity (Aw)', unit: null, lower_limit: 0.65, upper_limit: 0.75 },
});

const accentForm = getTone('admin').outlineAccent;

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
        <Field label="SKU code">
          <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
        </Field>
        <Field label="Product name">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </Field>
      </div>
      <Field label="Reference dry time (minutes, SOP)">
        <Input
          type="number"
          min={1}
          value={form.standard_drying_minutes ?? ''}
          onChange={(e) =>
            setForm({
              ...form,
              standard_drying_minutes: e.target.value ? Number(e.target.value) : null,
            })
          }
        />
      </Field>
      <fieldset className={cn('border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/50')}>
        <legend className="text-sm font-semibold px-1 text-slate-800">Post-dry inspection spec</legend>
        <Field label="Inspection item">
          <Input
            value={form.template.item_name}
            onChange={(e) => setForm({ ...form, template: { ...form.template, item_name: e.target.value } })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Lower limit">
            <Input
              type="number"
              step="0.01"
              value={form.template.lower_limit}
              onChange={(e) =>
                setForm({
                  ...form,
                  template: { ...form.template, lower_limit: Number(e.target.value) },
                })
              }
              required
            />
          </Field>
          <Field label="Upper limit">
            <Input
              type="number"
              step="0.01"
              value={form.template.upper_limit}
              onChange={(e) =>
                setForm({
                  ...form,
                  template: { ...form.template, upper_limit: Number(e.target.value) },
                })
              }
              required
            />
          </Field>
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
    <AppShell variant="admin">
      <PageHeader
        title="Products"
        description="Maintain SKU, reference dry time (SOP), and post-dry inspection limits. Actual sub-lot check-in/out times are recorded under Production Lots on the QC floor."
        action={
          <Button variant={creating ? 'secondary' : 'primary'} onClick={creating ? cancel : startCreate} disabled={editingId !== null}>
            {creating ? 'Cancel new' : 'Add product'}
          </Button>
        }
      />
      <div className="space-y-4 mb-4">
        {msg && <Alert variant="success">{msg}</Alert>}
        {error && <Alert variant="error">{error}</Alert>}
      </div>

      {creating && (
        <Card variant="outline" className={cn('p-4 mb-6 space-y-4 border-2 shadow-sm', accentForm)}>
          <h2 className="font-semibold text-indigo-800">New product</h2>
          <form onSubmit={submit} className="space-y-4">
            <ProductFormFields form={form} setForm={setForm} />
            <div className="flex gap-2">
              <Button type="submit" variant="primary" className="flex-1">
                Save
              </Button>
              <Button type="button" variant="secondary" onClick={cancel}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      <ul className="space-y-3">
        {products.map((p) => {
          const t = p.templates[0];
          const isEditing = editingId === p.id;

          return (
            <li key={p.id}>
              <Card variant="elevated" className={cn('p-4', isEditing && cn('border-2', accentForm))}>
                {isEditing ? (
                  <form onSubmit={submit} className="space-y-4">
                    <h2 className="font-semibold text-indigo-800">Edit · {p.name}</h2>
                    <ProductFormFields form={form} setForm={setForm} />
                    <div className="flex gap-2">
                      <Button type="submit" variant="primary" className="flex-1">
                        Save
                      </Button>
                      <Button type="button" variant="secondary" onClick={cancel}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <div className="font-semibold text-lg text-slate-900">{p.name}</div>
                        <div className="text-sm text-slate-500 font-mono">{p.code}</div>
                      </div>
                      <RowActionsMenu
                        disabled={isBusy}
                        actions={[
                          { label: 'Edit', onClick: () => startEdit(p) },
                          { label: 'Delete', variant: 'danger', onClick: () => remove(p.id, p.code) },
                        ]}
                      />
                    </div>
                    <dl className="mt-3 grid sm:grid-cols-2 gap-3 text-sm border-t border-slate-100 pt-3">
                      <div>
                        <dt className="text-slate-500 text-xs uppercase tracking-wide">Reference dry</dt>
                        <dd className="font-medium mt-0.5">
                          {p.standard_drying_minutes ? `${p.standard_drying_minutes} min` : 'Not set'}
                        </dd>
                      </div>
                      {t && (
                        <div>
                          <dt className="text-slate-500 text-xs uppercase tracking-wide">{t.item_name} spec</dt>
                          <dd className="font-medium mt-0.5 tabular-nums">
                            [{t.lower_limit}, {t.upper_limit}]
                          </dd>
                        </div>
                      )}
                    </dl>
                  </>
                )}
              </Card>
            </li>
          );
        })}
        {products.length === 0 && !creating && (
          <EmptyState
            icon={Box}
            title="No products"
            description="Add a product SKU and inspection limits for post-dry QC."
          />
        )}
      </ul>
    </AppShell>
  );
}

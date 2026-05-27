import React, { FormEvent, useEffect, useState } from 'react';
import { Plus, Trash2, FlaskConical, Package } from 'lucide-react';
import {
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  deleteProducts,
  listTestTypes,
  listProductItemLinks,
  addSkuItem,
  removeSkuItem,
  Product,
  ProductInput,
  TestType,
  TemplateInput,
} from '../../services/qcApi';
import { listItems, WarehouseItem } from '../../services/warehouseApi';
import { usePermissions } from '../../contexts/PermissionContext';
import { SelectAllCheckbox } from './components/SelectAllCheckbox';
import { PermissionDenied } from './components/PermissionDenied';
import { DecimalField } from '../../components/ui/DecimalField';
import { cn, fmtDays, daysToMinutes, minutesToDays, MINUTES_PER_DAY } from '../../lib/utils';

const emptyForm = (): ProductInput => ({
  code: '',
  name: '',
  standard_drying_minutes: MINUTES_PER_DAY,
  sample_every_n_carts: 1,
  templates: [],
});

function productToForm(p: Product): ProductInput {
  return {
    code: p.code,
    name: p.name,
    standard_drying_minutes: p.standard_drying_minutes,
    sample_every_n_carts: p.sample_every_n_carts ?? 1,
    templates: p.templates
      .filter(t => t.test_type_id != null)
      .map(t => ({
        test_type_id: t.test_type_id!,
        lower_limit: t.lower_limit,
        upper_limit: t.upper_limit,
      })),
  };
}

export default function ProductManagement() {
  const { can } = usePermissions();
  const canView = can('production', 'products', 'view');
  const canCreate = can('production', 'products', 'create');
  const canEdit = can('production', 'products', 'edit');
  const canDelete = can('production', 'products', 'delete');

  const [products, setProducts] = useState<Product[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ProductInput>(emptyForm());
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [testTypes, setTestTypes] = useState<TestType[]>([]);

  // Final-product (ERP item) linking — see qc_sku_item (M-087) + M-095.
  // `allItems` = every item in the warehouse master, used to populate the
  // multi-select.  `skuItemLinks` = current persisted SKU → item_ids map.
  // `selectedItemIds` = the working set being edited in the open form.
  const [allItems, setAllItems] = useState<WarehouseItem[]>([]);
  const [skuItemLinks, setSkuItemLinks] = useState<Record<string, number[]>>({});
  const [selectedItemIds, setSelectedItemIds] = useState<Set<number>>(new Set());

  const load = () => {
    listProducts().then(setProducts).catch((e) => setError(e.message));
  };

  const reloadLinks = () =>
    listProductItemLinks().then(setSkuItemLinks).catch(() => {});

  useEffect(() => {
    load();
    listTestTypes().then(setTestTypes).catch(() => {});
    listItems().then(setAllItems).catch(() => {});
    reloadLinks();
  }, []);

  const cancel = () => {
    setEditingId(null);
    setCreating(false);
    setForm(emptyForm());
    setSelectedItemIds(new Set());
  };
  const startCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setCreating(true);
    setSelectedItemIds(new Set());
    setMsg('');
    setError('');
  };
  const startEdit = (p: Product) => {
    setCreating(false);
    setEditingId(p.id);
    setForm(productToForm(p));
    setSelectedItemIds(new Set(skuItemLinks[p.id] ?? []));
    setMsg('');
    setError('');
  };

  const toggleItemId = (id: number) => {
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** Persist the diff between the current saved SKU↔Item links and the
   *  working set the user just edited.  Add new ones, remove the unselected
   *  ones, refresh the in-memory map. */
  const syncSkuItemLinks = async (skuId: string) => {
    const current = new Set(skuItemLinks[skuId] ?? []);
    const target = selectedItemIds;
    const toAdd = [...target].filter(id => !current.has(id));
    const toRemove = [...current].filter(id => !target.has(id));
    for (const id of toAdd) await addSkuItem(skuId, id);
    for (const id of toRemove) await removeSkuItem(skuId, id);
    await reloadLinks();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    // Validate limits — DecimalField emits NaN for empty/partial input, so we
    // reject here instead of letting NaN propagate to the backend.
    for (const t of form.templates) {
      if (!Number.isFinite(t.lower_limit) || !Number.isFinite(t.upper_limit)) {
        setError('Each test needs a lower and upper limit.');
        return;
      }
      if (t.lower_limit > t.upper_limit) {
        setError('Lower limit must be ≤ upper limit.');
        return;
      }
    }
    // Normalise the SKU code: empty string means "auto" on create, and "keep
    // existing" on edit — strip it so updateProduct's PATCH doesn't blank out
    // a perfectly good code, and so createProduct's `if (!code)` branch fires
    // and calls qc_next_sku_code.
    const payload: ProductInput = {
      ...form,
      code: form.code && form.code.trim() ? form.code.trim() : undefined,
    };
    try {
      let skuId: string;
      if (editingId) {
        await updateProduct(editingId, payload);
        skuId = editingId;
        setMsg('Product updated');
        setEditingId(null);
      } else {
        const created = await createProduct(payload);
        skuId = created.id;
        setMsg('Product created');
        setCreating(false);
      }
      await syncSkuItemLinks(skuId);
      setForm(emptyForm());
      setSelectedItemIds(new Set());
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

  if (!canView) {
    return <PermissionDenied permission="production.products.view" feature="Products & Templates" />;
  }

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
          <ProductFormFields
                    form={form}
                    setForm={setForm}
                    testTypes={testTypes}
                    allItems={allItems}
                    selectedItemIds={selectedItemIds}
                    onToggleItem={toggleItemId}
                  />
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
                  <ProductFormFields
                    form={form}
                    setForm={setForm}
                    testTypes={testTypes}
                    allItems={allItems}
                    selectedItemIds={selectedItemIds}
                    onToggleItem={toggleItemId}
                  />
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
                    <dl className="mt-3 grid sm:grid-cols-3 gap-2 text-xs">
                      <div>
                        <dt className="text-slate-500">Reference dry</dt>
                        <dd className="text-slate-800">{p.standard_drying_minutes != null ? fmtDays(p.standard_drying_minutes) : 'Not set'}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Sampling rate</dt>
                        <dd className="text-slate-800">
                          1 per <span className="font-mono font-bold">{p.sample_every_n_carts ?? 1}</span> cart(s)
                        </dd>
                      </div>
                      {p.templates.length > 0 && (
                        <div className="sm:col-span-2">
                          <dt className="text-slate-500 mb-1">Required tests</dt>
                          <dd className="flex flex-wrap gap-1.5">
                            {p.templates.map(tmpl => (
                              <span key={tmpl.id} className="text-xs bg-blue-50 border border-blue-200 text-blue-800 rounded px-2 py-0.5">
                                {tmpl.item_name} · [{tmpl.lower_limit}, {tmpl.upper_limit}]
                              </span>
                            ))}
                          </dd>
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

function ProductFormFields({
  form, setForm, testTypes, allItems, selectedItemIds, onToggleItem,
}: {
  form: ProductInput;
  setForm: (f: ProductInput) => void;
  testTypes: TestType[];
  allItems: WarehouseItem[];
  selectedItemIds: Set<number>;
  onToggleItem: (id: number) => void;
}) {
  const daysValue = minutesToDays(form.standard_drying_minutes);
  const usedTypeIds = new Set(form.templates.map(t => t.test_type_id));
  const availableTypes = testTypes.filter(tt => tt.is_active && !usedTypeIds.has(tt.id));

  const updateTemplate = (idx: number, patch: Partial<TemplateInput>) => {
    const next = form.templates.map((t, i) => i === idx ? { ...t, ...patch } : t);
    setForm({ ...form, templates: next });
  };

  const removeTemplate = (idx: number) => {
    setForm({ ...form, templates: form.templates.filter((_, i) => i !== idx) });
  };

  const addTemplate = (typeId: number) => {
    setForm({
      ...form,
      // Start empty (NaN) so operator types fresh values; submit validates.
      templates: [...form.templates, { test_type_id: typeId, lower_limit: NaN, upper_limit: NaN }],
    });
  };

  return (
    <>
      <div className="grid sm:grid-cols-[180px_1fr] gap-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-700">SKU code</span>
          <input
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-mono"
            value={form.code ?? ''}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            placeholder="auto"
            spellCheck={false}
          />
          <span className="mt-0.5 block text-[10px] text-slate-500">
            Leave blank to auto-generate (SKU-NNNN).
          </span>
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
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Reference dry time (days, SOP)</span>
          <DecimalField
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
            value={daysValue ?? NaN}
            onChange={(n) =>
              setForm({ ...form, standard_drying_minutes: Number.isFinite(n) ? daysToMinutes(n) : null })
            }
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Sampling rate (1 per N carts)</span>
          <DecimalField
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
            value={form.sample_every_n_carts ?? NaN}
            onChange={(n) =>
              setForm({ ...form, sample_every_n_carts: Number.isFinite(n) ? Math.max(1, Math.floor(n)) : undefined })
            }
          />
          <span className="mt-0.5 block text-[10px] text-slate-500">
            Groups of N carts; 1 random champion tested per group.
          </span>
        </label>
      </div>

      {/* ── Required tests ──────────────────────────────────────────────── */}
      <fieldset className="border rounded-lg p-3 space-y-3">
        <legend className="text-xs font-semibold px-1 text-slate-700 flex items-center gap-1.5">
          <FlaskConical size={11} /> Required tests
        </legend>

        {form.templates.length === 0 && (
          <p className="text-xs text-amber-600">No tests assigned. Add at least one test below.</p>
        )}

        {form.templates.map((tmpl, idx) => {
          const tt = testTypes.find(x => x.id === tmpl.test_type_id);
          return (
            <div key={tmpl.test_type_id} className="bg-slate-50 border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-800">
                  {tt?.name ?? `Type #${tmpl.test_type_id}`}
                  {tt?.unit && <span className="ml-1.5 text-[10px] font-mono bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded">{tt.unit}</span>}
                </span>
                <button
                  type="button"
                  onClick={() => removeTemplate(idx)}
                  className="text-slate-400 hover:text-red-500 p-1 rounded"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[11px] text-slate-600">Lower limit</span>
                  <DecimalField
                    allowNegative
                    className="mt-0.5 w-full border rounded-lg px-3 py-1.5 text-sm"
                    value={tmpl.lower_limit}
                    onChange={(n) => updateTemplate(idx, { lower_limit: n })}
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] text-slate-600">Upper limit</span>
                  <DecimalField
                    allowNegative
                    className="mt-0.5 w-full border rounded-lg px-3 py-1.5 text-sm"
                    value={tmpl.upper_limit}
                    onChange={(n) => updateTemplate(idx, { upper_limit: n })}
                  />
                </label>
              </div>
            </div>
          );
        })}

        {availableTypes.length > 0 && (
          <div className="flex gap-2 items-center pt-1">
            <select
              className="flex-1 border rounded-lg px-3 py-1.5 text-sm bg-white"
              defaultValue=""
              onChange={e => { if (e.target.value) { addTemplate(Number(e.target.value)); e.target.value = ''; } }}
            >
              <option value="">+ Add test…</option>
              {availableTypes.map(tt => (
                <option key={tt.id} value={tt.id}>{tt.name}{tt.unit ? ` (${tt.unit})` : ''}</option>
              ))}
            </select>
          </div>
        )}
        {availableTypes.length === 0 && testTypes.length > 0 && form.templates.length === testTypes.filter(t => t.is_active).length && (
          <p className="text-[10px] text-slate-400">All active test types assigned.</p>
        )}
        {testTypes.length === 0 && (
          <p className="text-[10px] text-slate-400">
            No test types defined yet. Go to <strong>Test Types</strong> to add some first.
          </p>
        )}
      </fieldset>

      {/* ── Final products (ERP items this SKU can be packed as) ─────────
           Scope: finished_good only.  Raw materials / packaging / intermediates
           live in the same `item` table but aren't valid "what does this SKU
           end up as" choices — those are upstream / consumable inputs.  Any
           legacy non-finished_good link will still appear here so the user
           can uncheck it. */}
      <fieldset className="border border-slate-200 rounded-lg p-3 space-y-2">
        <legend className="px-1 text-xs font-bold text-slate-700 flex items-center gap-1.5">
          <Package size={11} /> Final products
        </legend>
        <p className="text-[10px] text-slate-500">
          Pick every finished good this SKU can ultimately be packaged into. The Production form
          will only let operators choose from this list when they create a work order.
        </p>

        {(() => {
          const finalProductOptions = allItems.filter(it =>
            it.item_type === 'finished_good' || selectedItemIds.has(it.id),
          );
          if (finalProductOptions.length === 0) {
            return (
              <p className="text-[10px] text-amber-600">
                No finished-good items in the Warehouse master yet. Go to{' '}
                <strong>Warehouse → Items</strong> and add one with{' '}
                <code className="font-mono">item_type = finished_good</code>.
              </p>
            );
          }
          return (
            <>
              <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded">
                {finalProductOptions.map(it => {
                  const checked = selectedItemIds.has(it.id);
                  const isLegacy = it.item_type !== 'finished_good';
                  return (
                    <label
                      key={it.id}
                      className={cn(
                        'flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer',
                        checked ? 'bg-blue-50' : 'hover:bg-slate-50',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggleItem(it.id)}
                        className="w-4 h-4 rounded accent-blue-600"
                      />
                      <span className="font-mono text-[10px] text-slate-500 uppercase">{it.sku}</span>
                      <span className="flex-1 truncate text-slate-800">{it.name}</span>
                      <span
                        className={cn(
                          'text-[10px] uppercase tracking-wider',
                          isLegacy ? 'text-amber-600' : 'text-slate-400',
                        )}
                        title={isLegacy ? 'Legacy non-finished_good link — recommend unchecking' : undefined}
                      >
                        {it.item_type}
                      </span>
                    </label>
                  );
                })}
              </div>
              <p className="text-[10px] text-slate-400">
                {selectedItemIds.size} of {finalProductOptions.length} selected
              </p>
            </>
          );
        })()}
      </fieldset>
    </>
  );
}

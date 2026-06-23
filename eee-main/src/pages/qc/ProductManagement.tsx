import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as XLSX from 'xlsx';
import { Plus, Trash2, FlaskConical, Package, Search, ChevronRight, ChevronDown, Download, Upload, X } from 'lucide-react';
import {
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  deleteProducts,
  importProducts,
  listTestTypes,
  listProductItemLinks,
  addSkuItem,
  removeSkuItem,
  Product,
  ProductInput,
  ProductImportRow,
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
  sample_every_n_carts: 3,
  cart_units: 1,
  templates: [],
});

function productToForm(p: Product): ProductInput {
  return {
    code: p.code,
    name: p.name,
    standard_drying_minutes: p.standard_drying_minutes,
    sample_every_n_carts: p.sample_every_n_carts ?? 1,
    cart_units: p.cart_units ?? 1,
    templates: p.templates
      .filter(t => t.test_type_id != null)
      .map(t => ({
        test_type_id: t.test_type_id!,
        lower_limit:      t.lower_limit,
        upper_limit:      t.upper_limit,
        soft_lower_limit: t.soft_lower_limit,
        soft_upper_limit: t.soft_upper_limit,
      })),
  };
}

// Fixed (locale-independent) Excel column headers so export → edit → import
// round-trips regardless of UI language.  See BR-Q81.
const XLSX_HEADERS = {
  code:     'S2 WIP Code',
  name:     'Name',
  dryDays:  'Reference Dry Time (days)',
  sampling: 'Sampling Rate (1 per N carts)',
  units:    'Units per Cart',
} as const;

type ImportRowPreview = {
  rowNum: number;
  code: string;
  name: string;
  drying_days: number | null;
  sample_every_n_carts?: number;
  cart_units?: number;
  status: 'create' | 'update' | 'error';
  error?: string;
};

// `module` decides which permission namespace gates this page so the SAME
// component serves two entry points: Production (`production.products.*`,
// read-only after M-127) and QC (`qc.products.*`, full edit).  Default keeps
// the original Production behaviour for any call site that doesn't pass it.
export default function ProductManagement({ module = 'production' }: { module?: 'production' | 'qc' } = {}) {
  const { t: tr } = useTranslation('qc');
  const { can } = usePermissions();
  const canView = can(module, 'products', 'view');
  const canCreate = can(module, 'products', 'create');
  const canEdit = can(module, 'products', 'edit');
  const canDelete = can(module, 'products', 'delete');
  const canExport = can(module, 'products', 'export');
  const canImport = can(module, 'products', 'import');

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
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportRowPreview[] | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    for (const tmpl of form.templates) {
      if (!Number.isFinite(tmpl.lower_limit) || !Number.isFinite(tmpl.upper_limit) ||
          !Number.isFinite(tmpl.soft_lower_limit) || !Number.isFinite(tmpl.soft_upper_limit)) {
        setError(tr('productManagement.errNeedFourLimits'));
        return;
      }
      if (tmpl.lower_limit > tmpl.upper_limit) {
        setError(tr('productManagement.errHardLowerGtUpper'));
        return;
      }
      // M-118: soft must wrap hard so the DB CHECK matches.
      if (tmpl.soft_lower_limit > tmpl.lower_limit || tmpl.soft_upper_limit < tmpl.upper_limit) {
        setError(tr('productManagement.errSoftMustWrap'));
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
        setMsg(tr('productManagement.msgUpdated'));
        setEditingId(null);
      } else {
        const created = await createProduct(payload);
        skuId = created.id;
        setMsg(tr('productManagement.msgCreated'));
        setCreating(false);
      }
      await syncSkuItemLinks(skuId);
      setForm(emptyForm());
      setSelectedItemIds(new Set());
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('productManagement.errSaveFailed'));
    }
  };

  const remove = async (id: string, code: string) => {
    if (!confirm(tr('productManagement.confirmDeleteProduct', { code }))) return;
    try {
      await deleteProduct(id);
      if (editingId === id) cancel();
      setMsg(tr('productManagement.msgDeleted'));
      setSelected((prev) => { const next = new Set(prev); next.delete(id); return next; });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('productManagement.errDeleteFailed'));
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
    if (filtered.length > 0 && selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((p) => p.id)));
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
      setMsg(tr('productManagement.msgBulkDeleted', { count: selected.size }));
      setSelected(new Set());
      setConfirmBulkDelete(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('productManagement.errBulkDeleteFailed'));
    }
    setBusy(false);
  };

  // ── Excel export / import (BR-Q81) ──────────────────────────────────────────
  const handleExport = () => {
    const header = [XLSX_HEADERS.code, XLSX_HEADERS.name, XLSX_HEADERS.dryDays, XLSX_HEADERS.sampling, XLSX_HEADERS.units];
    const rows = products.map((p) => ({
      [XLSX_HEADERS.code]: p.code,
      [XLSX_HEADERS.name]: p.name,
      [XLSX_HEADERS.dryDays]: p.standard_drying_minutes != null ? minutesToDays(p.standard_drying_minutes) : '',
      [XLSX_HEADERS.sampling]: p.sample_every_n_carts ?? 1,
      [XLSX_HEADERS.units]: p.cart_units ?? 1,
    }));
    const ws = XLSX.utils.json_to_sheet(rows, { header });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Products');
    XLSX.writeFile(wb, 'products.xlsx');
  };

  const handleFile = async (file: File) => {
    setError('');
    setMsg('');
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
      const byCode = new Map(products.map((p) => [p.code.trim().toLowerCase(), p]));
      const num = (v: unknown): number | undefined =>
        v === null || v === undefined || v === '' ? undefined : Number(v);
      const previews: ImportRowPreview[] = raw.map((r, i) => {
        const code = String(r[XLSX_HEADERS.code] ?? '').trim();
        const name = String(r[XLSX_HEADERS.name] ?? '').trim();
        const dry = num(r[XLSX_HEADERS.dryDays]);
        const sample = num(r[XLSX_HEADERS.sampling]);
        const units = num(r[XLSX_HEADERS.units]);
        let error: string | undefined;
        if (!name) error = tr('productManagement.importErrNoName');
        else if (dry !== undefined && !Number.isFinite(dry)) error = tr('productManagement.importErrBadNumber');
        else if (sample !== undefined && (!Number.isFinite(sample) || sample < 1)) error = tr('productManagement.importErrBadNumber');
        else if (units !== undefined && (!Number.isFinite(units) || units <= 0)) error = tr('productManagement.importErrBadNumber');
        const exists = code ? byCode.has(code.toLowerCase()) : false;
        return {
          rowNum: i + 2, // +1 for 1-based, +1 for the header row
          code,
          name,
          drying_days: dry ?? null,
          sample_every_n_carts: sample,
          cart_units: units,
          status: error ? 'error' : exists ? 'update' : 'create',
          error,
        };
      });
      setImportPreview(previews);
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('productManagement.importErrParse'));
    }
  };

  const confirmImport = async () => {
    if (!importPreview) return;
    const valid = importPreview.filter((p) => p.status !== 'error');
    setImporting(true);
    setError('');
    try {
      const rows: ProductImportRow[] = valid.map((p) => ({
        code: p.code || undefined,
        name: p.name,
        standard_drying_minutes: p.drying_days != null ? daysToMinutes(p.drying_days) : null,
        sample_every_n_carts: p.sample_every_n_carts,
        cart_units: p.cart_units,
      }));
      const res = await importProducts(rows);
      setMsg(tr('productManagement.importDone', { created: res.created, updated: res.updated }));
      setImportPreview(null);
      load();
      reloadLinks();
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('productManagement.importErrFailed'));
    }
    setImporting(false);
  };

  const isBusy = creating || editingId !== null;

  // Client-side search over name / S2 WIP code — product master is small.
  const q = query.trim().toLowerCase();
  const filtered = q
    ? products.filter((p) => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q))
    : products;

  if (!canView) {
    return <PermissionDenied permission={`${module}.products.view`} feature={tr('productManagement.featureProductsTemplates')} />;
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">{tr('productManagement.title')}</h1>
      <p className="text-slate-600 mb-4 text-sm">
        {tr('productManagement.subtitle')}
      </p>

      {msg && <p className="text-emerald-700 bg-emerald-50 p-2 rounded-lg mb-3 text-sm">{msg}</p>}
      {error && <p className="text-red-600 mb-3 text-sm">{error}</p>}

      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="relative w-full sm:max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr('productManagement.searchPlaceholder')}
            className="w-full border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-sm"
            spellCheck={false}
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canExport && (
            <button
              type="button"
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              <Download size={13} /> {tr('productManagement.exportBtn')}
            </button>
          )}
          {canImport && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                <Upload size={13} /> {tr('productManagement.importBtn')}
              </button>
            </>
          )}
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
              <Plus size={13} /> {creating ? tr('productManagement.cancelNew') : tr('productManagement.addProduct')}
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-3">
        <SelectAllCheckbox total={filtered.length} selected={selected.size} onToggleAll={toggleSelectAll} />
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
            {confirmBulkDelete ? tr('productManagement.confirmDeleteCount', { count: selected.size }) : tr('productManagement.deleteCount', { count: selected.size })}
          </button>
        )}
      </div>

      {creating && (
        <form onSubmit={submit} className="bg-white border-2 border-blue-400 rounded-xl p-4 mb-6 space-y-4 shadow-sm">
          <h2 className="font-semibold text-blue-800 text-sm">{tr('productManagement.newProduct')}</h2>
          <ProductFormFields
                    form={form}
                    setForm={setForm}
                    testTypes={testTypes}
                    allItems={allItems}
                    selectedItemIds={selectedItemIds}
                    onToggleItem={toggleItemId}
                  />
          <div className="flex gap-2">
            <button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded-lg text-sm font-medium">{tr('productManagement.save')}</button>
            <button type="button" className="px-4 py-2 rounded-lg border text-sm" onClick={cancel}>{tr('productManagement.cancel')}</button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
              <th className="p-3 w-8"></th>
              <th className="p-3 w-8"></th>
              <th className="p-3 font-semibold">{tr('productManagement.colProduct')}</th>
              <th className="p-3 font-semibold">{tr('productManagement.colCode')}</th>
              <th className="p-3 font-semibold">{tr('productManagement.referenceDry')}</th>
              <th className="p-3 font-semibold">{tr('productManagement.samplingRate')}</th>
              <th className="p-3 font-semibold">{tr('productManagement.unitsPerCart')}</th>
              <th className="p-3 font-semibold">{tr('productManagement.requiredTests')}</th>
              {(canEdit || canDelete) && <th className="p-3 font-semibold text-right">{tr('productManagement.colActions')}</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const isEditing = editingId === p.id;
              const checked = selected.has(p.id);
              const isExpanded = expandedId === p.id;
              const colCount = 8 + (canEdit || canDelete ? 1 : 0);

              if (isEditing) {
                return (
                  <tr key={p.id} className="border-b border-slate-100 bg-white">
                    <td colSpan={colCount} className="p-4 border-l-2 border-blue-500">
                      <form onSubmit={submit} className="space-y-4">
                        <h2 className="font-semibold text-blue-800 text-sm">{tr('productManagement.editHeading', { name: p.name })}</h2>
                        <ProductFormFields
                          form={form}
                          setForm={setForm}
                          testTypes={testTypes}
                          allItems={allItems}
                          selectedItemIds={selectedItemIds}
                          onToggleItem={toggleItemId}
                        />
                        <div className="flex gap-2">
                          <button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded-lg text-sm font-medium">{tr('productManagement.save')}</button>
                          <button type="button" className="px-4 py-2 rounded-lg border text-sm" onClick={cancel}>{tr('productManagement.cancel')}</button>
                        </div>
                      </form>
                    </td>
                  </tr>
                );
              }

              return (
                <React.Fragment key={p.id}>
                  <tr className={cn('border-b border-slate-100', checked ? 'bg-blue-50/40' : 'hover:bg-slate-50/60')}>
                    <td className="p-3 align-top">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelect(p.id)}
                        className="w-4 h-4 rounded accent-blue-600"
                      />
                    </td>
                    <td className="p-3 align-top">
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : p.id)}
                        className="text-slate-400 hover:text-slate-700"
                        title={tr('productManagement.requiredTests')}
                      >
                        {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      </button>
                    </td>
                    <td className="p-3 font-medium text-slate-900">{p.name}</td>
                    <td className="p-3 font-mono text-xs text-slate-500">{p.code}</td>
                    <td className="p-3 text-slate-700">{p.standard_drying_minutes != null ? fmtDays(p.standard_drying_minutes) : tr('productManagement.notSet')}</td>
                    <td className="p-3 text-slate-700">
                      {tr('productManagement.onePerPrefix')} <span className="font-mono font-bold">{p.sample_every_n_carts ?? 1}</span> {tr('productManagement.cartsSuffix')}
                    </td>
                    <td className="p-3 text-slate-700"><span className="font-mono font-bold">{p.cart_units ?? 1}</span></td>
                    <td className="p-3 text-slate-700">
                      <span className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded bg-slate-100 text-xs font-medium text-slate-600">
                        {p.templates.length}
                      </span>
                    </td>
                    {(canEdit || canDelete) && (
                      <td className="p-3 text-right whitespace-nowrap">
                        {canEdit && (
                          <button
                            type="button"
                            className="text-blue-600 hover:text-blue-700 text-xs font-bold px-2 py-1 disabled:opacity-40"
                            disabled={isBusy}
                            onClick={() => startEdit(p)}
                          >
                            {tr('productManagement.edit')}
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            className="text-red-600 hover:text-red-700 text-xs font-bold px-2 py-1 disabled:opacity-40"
                            disabled={isBusy}
                            onClick={() => remove(p.id, p.code)}
                          >
                            {tr('productManagement.delete')}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                  {isExpanded && (
                    <tr className="border-b border-slate-100 bg-slate-50/50">
                      <td></td>
                      <td colSpan={colCount - 1} className="p-3">
                        <dt className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">{tr('productManagement.requiredTests')}</dt>
                        {p.templates.length === 0 ? (
                          <p className="text-xs text-slate-400">{tr('productManagement.noTestsAssigned')}</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {p.templates.map((tmpl) => {
                              const hasSoftBand =
                                tmpl.soft_lower_limit < tmpl.lower_limit ||
                                tmpl.soft_upper_limit > tmpl.upper_limit;
                              return (
                                <span key={tmpl.id} className="text-xs bg-blue-50 border border-blue-200 text-blue-800 rounded px-2 py-0.5">
                                  {tmpl.item_name} · [{tmpl.lower_limit}, {tmpl.upper_limit}]
                                  {hasSoftBand && (
                                    <span className="ml-1 text-amber-700">
                                      {tr('productManagement.softBadgePrefix')} [{tmpl.soft_lower_limit}, {tmpl.soft_upper_limit}]
                                    </span>
                                  )}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8 + (canEdit || canDelete ? 1 : 0)} className="p-5 text-center text-sm text-slate-500">
                  {products.length === 0 ? tr('productManagement.noProducts') : tr('productManagement.noSearchResults')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {importPreview && (() => {
        const createCount = importPreview.filter((p) => p.status === 'create').length;
        const updateCount = importPreview.filter((p) => p.status === 'update').length;
        const errorCount = importPreview.filter((p) => p.status === 'error').length;
        const validCount = createCount + updateCount;
        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-xl">
              <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                <h2 className="font-bold text-slate-900">{tr('productManagement.importPreviewTitle')}</h2>
                <button type="button" onClick={() => setImportPreview(null)} className="text-slate-400 hover:text-slate-700">
                  <X size={18} />
                </button>
              </div>
              <div className="p-4 overflow-auto">
                <div className="flex gap-2 mb-3 text-xs">
                  <span className="px-2 py-1 rounded bg-emerald-50 text-emerald-700 font-bold">{tr('productManagement.importCreate')}: {createCount}</span>
                  <span className="px-2 py-1 rounded bg-amber-50 text-amber-700 font-bold">{tr('productManagement.importUpdate')}: {updateCount}</span>
                  {errorCount > 0 && <span className="px-2 py-1 rounded bg-red-50 text-red-700 font-bold">{tr('productManagement.importError')}: {errorCount}</span>}
                </div>
                {importPreview.length === 0 ? (
                  <p className="text-sm text-slate-500">{tr('productManagement.importNoRows')}</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-500 border-b border-slate-200">
                        <th className="p-1.5 w-10">#</th>
                        <th className="p-1.5">{tr('productManagement.colCode')}</th>
                        <th className="p-1.5">{tr('productManagement.colProduct')}</th>
                        <th className="p-1.5">{tr('productManagement.colStatus')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.map((p) => (
                        <tr key={p.rowNum} className="border-b border-slate-100">
                          <td className="p-1.5 text-slate-400">{p.rowNum}</td>
                          <td className="p-1.5 font-mono">{p.code || '—'}</td>
                          <td className="p-1.5">{p.name || '—'}</td>
                          <td className="p-1.5">
                            {p.status === 'error'
                              ? <span className="text-red-600">{p.error}</span>
                              : p.status === 'create'
                                ? <span className="text-emerald-700">{tr('productManagement.importCreate')}</span>
                                : <span className="text-amber-700">{tr('productManagement.importUpdate')}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="p-4 border-t border-slate-200 flex justify-end gap-2">
                <button type="button" onClick={() => setImportPreview(null)} className="px-4 py-2 rounded-lg border text-sm">
                  {tr('productManagement.cancel')}
                </button>
                <button
                  type="button"
                  onClick={confirmImport}
                  disabled={importing || validCount === 0}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium disabled:opacity-50"
                >
                  {importing ? tr('productManagement.importing') : tr('productManagement.importConfirm', { count: validCount })}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
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
  const { t: tr } = useTranslation('qc');
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
      // M-118: 4 empty fields. Operator must fill hard PASS range AND soft
      // tolerance range; submit validates wrap (soft ⊇ hard) and finiteness.
      templates: [...form.templates, {
        test_type_id: typeId,
        lower_limit: NaN, upper_limit: NaN,
        soft_lower_limit: NaN, soft_upper_limit: NaN,
      }],
    });
  };

  return (
    <>
      <div className="grid sm:grid-cols-[180px_1fr] gap-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-700">{tr('productManagement.skuCode')}</span>
          <input
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-mono"
            value={form.code ?? ''}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            placeholder={tr('productManagement.autoPlaceholder')}
            spellCheck={false}
          />
          <span className="mt-0.5 block text-[10px] text-slate-500">
            {tr('productManagement.skuCodeHint')}
          </span>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-700">{tr('productManagement.productName')}</span>
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
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Units per cart (dryer capacity)</span>
          <DecimalField
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
            value={form.cart_units ?? NaN}
            onChange={(n) =>
              setForm({ ...form, cart_units: Number.isFinite(n) && n > 0 ? n : undefined })
            }
          />
          <span className="mt-0.5 block text-[10px] text-slate-500">
            How many capacity units one cart of this product takes (e.g. 1 or 1.5).
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
              {/* M-118: Hard PASS range — auto-pass. */}
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-2">
                <p className="text-[10px] uppercase tracking-wider font-bold text-emerald-700 mb-1.5">
                  Hard PASS range
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[11px] text-slate-600">Lower</span>
                    <DecimalField
                      allowNegative
                      className="mt-0.5 w-full border rounded-lg px-3 py-1.5 text-sm"
                      value={tmpl.lower_limit}
                      onChange={(n) => updateTemplate(idx, { lower_limit: n })}
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-slate-600">Upper</span>
                    <DecimalField
                      allowNegative
                      className="mt-0.5 w-full border rounded-lg px-3 py-1.5 text-sm"
                      value={tmpl.upper_limit}
                      onChange={(n) => updateTemplate(idx, { upper_limit: n })}
                    />
                  </label>
                </div>
              </div>

              {/* M-118: Soft tolerance — supervisor-only override window.
                  Must wrap hard. soft = hard means no override is possible
                  (anything outside hard is forced FAIL). */}
              <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-2">
                <p className="text-[10px] uppercase tracking-wider font-bold text-amber-700 mb-1.5">
                  Soft tolerance (supervisor discretion)
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[11px] text-slate-600">Lower</span>
                    <DecimalField
                      allowNegative
                      className="mt-0.5 w-full border rounded-lg px-3 py-1.5 text-sm"
                      value={tmpl.soft_lower_limit}
                      onChange={(n) => updateTemplate(idx, { soft_lower_limit: n })}
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-slate-600">Upper</span>
                    <DecimalField
                      allowNegative
                      className="mt-0.5 w-full border rounded-lg px-3 py-1.5 text-sm"
                      value={tmpl.soft_upper_limit}
                      onChange={(n) => updateTemplate(idx, { soft_upper_limit: n })}
                    />
                  </label>
                </div>
                <p className="mt-1 text-[10px] text-slate-500 leading-snug">
                  Must wrap the hard range. Set equal to hard to disable supervisor override (anything outside hard ⇒ forced FAIL).
                </p>
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

import React, { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import {
  listItems,
  createItem,
  updateItem,
  listUoms,
  listItemCategories,
  WarehouseItem,
  ItemInput,
  Uom,
  ItemCategory,
  ItemType,
  CostingMethod,
} from '../../services/warehouseApi';
import { usePermissions } from '../../contexts/PermissionContext';
import { cn } from '../../lib/utils';

const ITEM_TYPES: { value: ItemType; labelKey: string }[] = [
  { value: 'raw_material',  labelKey: 'itemsPage.itemType.raw_material' },
  { value: 'packaging',     labelKey: 'itemsPage.itemType.packaging' },
  { value: 'intermediate',  labelKey: 'itemsPage.itemType.intermediate' },
  { value: 'finished_good', labelKey: 'itemsPage.itemType.finished_good' },
];

const COSTING_METHODS: { value: CostingMethod; labelKey: string }[] = [
  { value: 'weighted_average', labelKey: 'itemsPage.costingMethod.weighted_average' },
  { value: 'standard',         labelKey: 'itemsPage.costingMethod.standard' },
  { value: 'fifo',             labelKey: 'itemsPage.costingMethod.fifo' },
];

const emptyForm = (): ItemInput => ({
  sku: '',
  name: '',
  description: null,
  item_type: 'raw_material',
  category_id: null,
  base_uom_id: 0,
  is_lot_controlled: true,
  shelf_life_days: null,
  costing_method: 'weighted_average',
  standard_cost: null,
  allergen_info: null,
  status: 'active',
});

function itemToForm(it: WarehouseItem): ItemInput {
  return {
    sku: it.sku,
    name: it.name,
    description: it.description,
    item_type: it.item_type,
    category_id: it.category_id,
    base_uom_id: it.base_uom_id,
    is_lot_controlled: it.is_lot_controlled,
    shelf_life_days: it.shelf_life_days,
    costing_method: it.costing_method,
    standard_cost: it.standard_cost,
    allergen_info: it.allergen_info,
    status: it.status,
  };
}

export default function ItemsPage() {
  const { t } = useTranslation('warehouse');
  const { can } = usePermissions();
  const canCreate = can('warehouse', 'items', 'create');
  const canEdit = can('warehouse', 'items', 'edit');

  const [items, setItems] = useState<WarehouseItem[]>([]);
  const [uoms, setUoms] = useState<Uom[]>([]);
  const [categories, setCategories] = useState<ItemCategory[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ItemInput>(emptyForm());
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => listItems().then(setItems).catch((e) => setError(e.message));

  useEffect(() => {
    load();
    listUoms().then(setUoms).catch((e) => setError(e.message));
    listItemCategories().then(setCategories).catch(() => { /* categories optional */ });
  }, []);

  const uomLabel = (id: number) => {
    const u = uoms.find((x) => x.id === id);
    return u ? `${u.code} · ${u.name}` : '—';
  };

  const cancel = () => { setEditingId(null); setCreating(false); setForm(emptyForm()); };
  const startCreate = () => {
    const base = emptyForm();
    if (uoms[0]) base.base_uom_id = uoms[0].id;
    setEditingId(null); setForm(base); setCreating(true); setMsg(''); setError('');
  };
  const startEdit = (it: WarehouseItem) => {
    setCreating(false); setEditingId(it.id); setForm(itemToForm(it)); setMsg(''); setError('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.base_uom_id) { setError(t('itemsPage.selectBaseUomError')); return; }
    try {
      if (editingId) {
        await updateItem(editingId, form);
        setMsg(t('itemsPage.itemUpdated'));
        setEditingId(null);
      } else {
        await createItem(form);
        setMsg(t('itemsPage.itemCreated'));
        setCreating(false);
      }
      setForm(emptyForm());
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('itemsPage.saveFailed'));
    }
  };

  const toggleStatus = async (it: WarehouseItem) => {
    setError('');
    try {
      await updateItem(it.id, { status: it.status === 'active' ? 'inactive' : 'active' });
      setMsg(it.status === 'active' ? t('itemsPage.deactivated') : t('itemsPage.activated'));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('itemsPage.operationFailed'));
    }
  };

  const isBusy = creating || editingId !== null;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">{t('itemsPage.title')}</h1>
      <p className="text-slate-600 mb-4 text-sm">
        {t('itemsPage.subtitle')}
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
              creating ? 'bg-slate-200 text-slate-700' : 'bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50',
            )}
          >
            <Plus size={13} /> {creating ? t('itemsPage.cancelNew') : t('itemsPage.addItem')}
          </button>
        )}
      </div>

      {creating && (
        <form onSubmit={submit} className="bg-white border-2 border-emerald-400 rounded-xl p-4 mb-6 space-y-4 shadow-sm">
          <h2 className="font-semibold text-emerald-800 text-sm">{t('itemsPage.newItem')}</h2>
          <ItemFormFields form={form} setForm={setForm} uoms={uoms} categories={categories} />
          <div className="flex gap-2">
            <button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded-lg text-sm font-medium">{t('itemsPage.save')}</button>
            <button type="button" className="px-4 py-2 rounded-lg border text-sm" onClick={cancel}>{t('itemsPage.cancel')}</button>
          </div>
        </form>
      )}

      <ul className="space-y-3">
        {items.map((it) => {
          const isEditing = editingId === it.id;
          return (
            <li key={it.id} className={cn(
              'rounded-xl p-4 transition-colors',
              isEditing ? 'bg-white border-2 border-emerald-500 shadow-sm' : 'bg-white border',
            )}>
              {isEditing ? (
                <form onSubmit={submit} className="space-y-4">
                  <h2 className="font-semibold text-emerald-800 text-sm">{t('itemsPage.editPrefix')} · {it.name}</h2>
                  <ItemFormFields form={form} setForm={setForm} uoms={uoms} categories={categories} />
                  <div className="flex gap-2">
                    <button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded-lg text-sm font-medium">{t('itemsPage.save')}</button>
                    <button type="button" className="px-4 py-2 rounded-lg border text-sm" onClick={cancel}>{t('itemsPage.cancel')}</button>
                  </div>
                </form>
              ) : (
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <div className="font-semibold text-slate-900 flex items-center gap-2">
                          {it.name}
                          {it.status === 'inactive' && (
                            <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">{t('itemsPage.inactiveBadge')}</span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">{it.sku}</div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        {canEdit && (
                          <button
                            type="button"
                            className="text-emerald-700 hover:text-emerald-800 text-xs font-bold px-2 py-1 disabled:opacity-40"
                            disabled={isBusy}
                            onClick={() => startEdit(it)}
                          >
                            {t('itemsPage.edit')}
                          </button>
                        )}
                        {canEdit && (
                          <button
                            type="button"
                            className="text-slate-600 hover:text-slate-800 text-xs font-bold px-2 py-1 disabled:opacity-40"
                            disabled={isBusy}
                            onClick={() => toggleStatus(it)}
                          >
                            {it.status === 'active' ? t('itemsPage.deactivate') : t('itemsPage.activate')}
                          </button>
                        )}
                      </div>
                    </div>
                    <dl className="mt-3 grid sm:grid-cols-4 gap-2 text-xs">
                      <div>
                        <dt className="text-slate-500">{t('itemsPage.type')}</dt>
                        <dd className="text-slate-800">{it.item_type}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">{t('itemsPage.baseUom')}</dt>
                        <dd className="text-slate-800">{uomLabel(it.base_uom_id)}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">{t('itemsPage.lotControlled')}</dt>
                        <dd className="text-slate-800">{it.is_lot_controlled ? t('itemsPage.yes') : t('itemsPage.no')}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">{t('itemsPage.shelfLifeDays')}</dt>
                        <dd className="text-slate-800">{it.shelf_life_days ?? '—'}</dd>
                      </div>
                    </dl>
                  </div>
                </div>
              )}
            </li>
          );
        })}
        {items.length === 0 && <p className="text-slate-500 text-sm">{t('itemsPage.empty')}</p>}
      </ul>
    </div>
  );
}

function ItemFormFields({ form, setForm, uoms, categories }: {
  form: ItemInput;
  setForm: (f: ItemInput) => void;
  uoms: Uom[];
  categories: ItemCategory[];
}) {
  const { t } = useTranslation('warehouse');
  return (
    <>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-700">{t('itemsPage.sku')}</span>
          <input
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
            value={form.sku}
            onChange={(e) => setForm({ ...form, sku: e.target.value })}
            required
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-700">{t('itemsPage.name')}</span>
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
          <span className="text-xs font-medium text-slate-700">{t('itemsPage.type')}</span>
          <select
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white"
            value={form.item_type}
            onChange={(e) => setForm({ ...form, item_type: e.target.value as ItemType })}
          >
            {ITEM_TYPES.map((it) => <option key={it.value} value={it.value}>{t(it.labelKey)}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-700">{t('itemsPage.baseUomLabel')}</span>
          <select
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white"
            value={form.base_uom_id || ''}
            onChange={(e) => setForm({ ...form, base_uom_id: Number(e.target.value) })}
            required
          >
            <option value="" disabled>{t('itemsPage.selectUom')}</option>
            {uoms.map((u) => <option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}
          </select>
        </label>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-700">{t('itemsPage.categoryOptional')}</span>
          <select
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white"
            value={form.category_id ?? ''}
            onChange={(e) => setForm({ ...form, category_id: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">{t('itemsPage.none')}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-700">{t('itemsPage.costingMethodLabel')}</span>
          <select
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white"
            value={form.costing_method}
            onChange={(e) => setForm({ ...form, costing_method: e.target.value as CostingMethod })}
          >
            {COSTING_METHODS.map((c) => <option key={c.value} value={c.value}>{t(c.labelKey)}</option>)}
          </select>
        </label>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-700">{t('itemsPage.shelfLifeLabel')}</span>
          <input
            type="number"
            min={0}
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
            value={form.shelf_life_days ?? ''}
            onChange={(e) => setForm({ ...form, shelf_life_days: e.target.value ? Number(e.target.value) : null })}
          />
        </label>
        <label className="flex items-center gap-2 mt-6">
          <input
            type="checkbox"
            checked={form.is_lot_controlled}
            onChange={(e) => setForm({ ...form, is_lot_controlled: e.target.checked })}
            className="w-4 h-4 rounded accent-emerald-600"
          />
          <span className="text-xs font-medium text-slate-700">{t('itemsPage.lotControlledLabel')}</span>
        </label>
      </div>
    </>
  );
}

import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ProductionLot } from '../../api/client';
import { AppShell } from '../../components/AppShell';
import { LotSubLotSummary } from '../../components/LotSubLotSummary';
import { cn } from '../../lib/utils';

type LotForm = {
  lot_number: string;
  lot_barcode: string;
  work_order_barcode: string;
  sku_id: string;
};

const emptyLotForm = (): LotForm => ({
  lot_number: '',
  lot_barcode: '',
  work_order_barcode: '',
  sku_id: '',
});

function lotToForm(lot: ProductionLot): LotForm {
  return {
    lot_number: lot.lot_number,
    lot_barcode: lot.lot_barcode,
    work_order_barcode: lot.work_order_barcode,
    sku_id: lot.sku_id,
  };
}

function LotFormFields({
  form,
  setForm,
  skus,
}: {
  form: LotForm;
  setForm: (f: LotForm) => void;
  skus: Array<{ id: string; code: string; name: string }>;
}) {
  return (
    <>
      <label className="block">
        <span className="text-sm font-medium">Lot number</span>
        <input
          className="mt-1 w-full border rounded-lg px-3 py-2 min-h-[44px]"
          value={form.lot_number}
          onChange={(e) => setForm({ ...form, lot_number: e.target.value })}
          placeholder="Defaults to lot barcode if empty on create"
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Lot barcode</span>
        <input
          className="mt-1 w-full border rounded-lg px-3 py-2 min-h-[44px] font-mono"
          value={form.lot_barcode}
          onChange={(e) => setForm({ ...form, lot_barcode: e.target.value })}
          required
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Work order barcode</span>
        <input
          className="mt-1 w-full border rounded-lg px-3 py-2 min-h-[44px] font-mono"
          value={form.work_order_barcode}
          onChange={(e) => setForm({ ...form, work_order_barcode: e.target.value })}
          required
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Product (SKU)</span>
        <select
          className="mt-1 w-full border rounded-lg px-3 py-2 min-h-[44px]"
          value={form.sku_id}
          onChange={(e) => setForm({ ...form, sku_id: e.target.value })}
          required
        >
          {skus.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

export function TraceListPage() {
  const [lots, setLots] = useState<ProductionLot[]>([]);
  const [skus, setSkus] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<LotForm>(emptyLotForm());
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => api.productionLots().then(setLots).catch((e) => setError(e.message));

  useEffect(() => {
    load();
    api.skus().then((s) => {
      setSkus(s);
      if (s[0]) setForm((prev) => (prev.sku_id ? prev : { ...prev, sku_id: s[0].id }));
    });
  }, []);

  const cancel = () => {
    setEditingId(null);
    setCreating(false);
    setForm(emptyLotForm());
    if (skus[0]) setForm({ ...emptyLotForm(), sku_id: skus[0].id });
  };

  const startCreate = () => {
    setEditingId(null);
    setForm(skus[0] ? { ...emptyLotForm(), sku_id: skus[0].id } : emptyLotForm());
    setCreating(true);
    setMsg('');
    setError('');
  };

  const startEdit = (lot: ProductionLot) => {
    setCreating(false);
    setEditingId(lot.id);
    setForm(lotToForm(lot));
    setMsg('');
    setError('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (editingId) {
        await api.updateProductionLot(editingId, {
          lot_number: form.lot_number.trim() || undefined,
          lot_barcode: form.lot_barcode.trim(),
          work_order_barcode: form.work_order_barcode.trim(),
          sku_id: form.sku_id,
        });
        setMsg('Production lot updated');
        setEditingId(null);
      } else {
        await api.createProductionLot({
          lot_barcode: form.lot_barcode.trim(),
          work_order_barcode: form.work_order_barcode.trim(),
          sku_id: form.sku_id,
          lot_number: form.lot_number.trim() || undefined,
        });
        setMsg('Production lot created');
        setCreating(false);
      }
      setForm(skus[0] ? { ...emptyLotForm(), sku_id: skus[0].id } : emptyLotForm());
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const remove = async (lot: ProductionLot) => {
    const n = lot.sub_lot_counts?.total ?? 0;
    const warn =
      n > 0
        ? `Delete ${lot.lot_number} and all ${n} sub-lot(s) (including inspection history)?`
        : `Delete production lot ${lot.lot_number}?`;
    if (!confirm(warn)) return;
    try {
      await api.deleteProductionLot(lot.id);
      if (editingId === lot.id) cancel();
      setMsg('Production lot deleted');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const isBusy = creating || editingId !== null;

  return (
    <AppShell variant="admin" title="Batch Trace">
      <p className="text-sm text-slate-600 mb-4">
        Manage production lots and open a batch to edit drying sub-lots and view quality events.
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
        {creating ? 'Cancel new' : 'Add production lot'}
      </button>

      {creating && skus.length > 0 && (
        <form onSubmit={submit} className="bg-white border-2 border-blue-400 rounded-xl p-4 mb-6 space-y-3 shadow-sm">
          <h2 className="font-semibold text-blue-800">New production lot</h2>
          <LotFormFields form={form} setForm={setForm} skus={skus} />
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
        {lots.map((lot) => {
          const isEditing = editingId === lot.id;
          return (
            <li
              key={lot.id}
              className={cn(
                'rounded-xl p-4 transition-colors',
                isEditing ? 'bg-white border-2 border-blue-500 shadow-sm' : 'bg-white border'
              )}
            >
              {isEditing && skus.length > 0 ? (
                <form onSubmit={submit} className="space-y-3">
                  <h2 className="font-semibold text-blue-800">Edit · {lot.lot_number}</h2>
                  <LotFormFields form={form} setForm={setForm} skus={skus} />
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
                    <Link
                      to={`/admin/trace/${lot.id}`}
                      className="flex-1 min-w-0 hover:text-blue-700"
                    >
                      <div className="font-semibold">{lot.lot_number}</div>
                      <p className="text-sm text-slate-600 mt-1">
                        {lot.sku_name} · {lot.lot_barcode}
                      </p>
                    </Link>
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        className="text-blue-600 min-h-[44px] px-2 disabled:opacity-40"
                        disabled={isBusy}
                        onClick={() => startEdit(lot)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="text-red-600 min-h-[44px] px-2 disabled:opacity-40"
                        disabled={isBusy}
                        onClick={() => remove(lot)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <Link to={`/admin/trace/${lot.id}`} className="block mt-2">
                    <LotSubLotSummary counts={lot.sub_lot_counts} />
                  </Link>
                </>
              )}
            </li>
          );
        })}
        {lots.length === 0 && <p className="text-slate-500">No production lots</p>}
      </ul>
    </AppShell>
  );
}

import { FormEvent, useEffect, useState } from 'react';
import { ChevronRight, GitBranch } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, ProductionLot } from '../../api/client';
import { AppShell } from '../../components/AppShell';
import { LotSubLotSummary } from '../../components/LotSubLotSummary';
import { RowActionsMenu } from '../../components/RowActionsMenu';
import { Alert, Button, Card, EmptyState, Field, Input, PageHeader, Select } from '../../components/ui';
import { getTone } from '../../components/ui/tone';
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
      <Field label="Lot number" hint="Defaults to lot barcode if empty on create">
        <Input
          value={form.lot_number}
          onChange={(e) => setForm({ ...form, lot_number: e.target.value })}
        />
      </Field>
      <Field label="Lot barcode">
        <Input
          className="font-mono"
          value={form.lot_barcode}
          onChange={(e) => setForm({ ...form, lot_barcode: e.target.value })}
          required
        />
      </Field>
      <Field label="Work order barcode">
        <Input
          className="font-mono"
          value={form.work_order_barcode}
          onChange={(e) => setForm({ ...form, work_order_barcode: e.target.value })}
          required
        />
      </Field>
      <Field label="Product (SKU)">
        <Select value={form.sku_id} onChange={(e) => setForm({ ...form, sku_id: e.target.value })} required>
          {skus.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>
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
  const accentForm = getTone('admin').outlineAccent;

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
    <AppShell variant="admin">
      <PageHeader
        title="Batch Trace"
        description="Manage production lots and open a batch to edit drying sub-lots and view quality events."
        action={
          <Button
            variant={creating ? 'secondary' : 'primary'}
            onClick={creating ? cancel : startCreate}
            disabled={editingId !== null}
          >
            {creating ? 'Cancel new' : 'Add production lot'}
          </Button>
        }
      />
      <div className="space-y-4 mb-4">
        {msg && <Alert variant="success">{msg}</Alert>}
        {error && <Alert variant="error">{error}</Alert>}
      </div>

      {creating && skus.length > 0 && (
        <Card variant="outline" className={cn('p-4 mb-6 space-y-3 border-2 shadow-sm', accentForm)}>
          <h2 className="font-semibold text-indigo-800">New production lot</h2>
          <form onSubmit={submit} className="space-y-3">
            <LotFormFields form={form} setForm={setForm} skus={skus} />
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
        {lots.map((lot) => {
          const isEditing = editingId === lot.id;
          return (
            <li key={lot.id}>
              <Card
                variant={isEditing ? 'outline' : 'elevated'}
                className={cn('p-4 transition-shadow', isEditing && cn('border-2', accentForm))}
              >
                {isEditing && skus.length > 0 ? (
                  <form onSubmit={submit} className="space-y-3">
                    <h2 className="font-semibold text-indigo-800">Edit · {lot.lot_number}</h2>
                    <LotFormFields form={form} setForm={setForm} skus={skus} />
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
                      <Link
                        to={`/admin/trace/${lot.id}`}
                        className="flex-1 min-w-0 group"
                      >
                        <div className="font-semibold text-slate-900 group-hover:text-indigo-700 flex items-center gap-1">
                          {lot.lot_number}
                          <ChevronRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <p className="text-sm text-slate-600 mt-1">
                          {lot.sku_name} · {lot.lot_barcode}
                        </p>
                      </Link>
                      <RowActionsMenu
                        disabled={isBusy}
                        actions={[
                          { label: 'Edit', onClick: () => startEdit(lot) },
                          { label: 'Delete', variant: 'danger', onClick: () => remove(lot) },
                        ]}
                      />
                    </div>
                    <Link to={`/admin/trace/${lot.id}`} className="block mt-2">
                      <LotSubLotSummary counts={lot.sub_lot_counts} />
                    </Link>
                  </>
                )}
              </Card>
            </li>
          );
        })}
        {lots.length === 0 && (
          <EmptyState
            icon={GitBranch}
            title="No production lots"
            description="Create a production lot to start tracking drying sub-lots."
          />
        )}
      </ul>
    </AppShell>
  );
}

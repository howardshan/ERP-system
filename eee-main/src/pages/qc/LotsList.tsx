import React, { useEffect, useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import {
  listProductionLots,
  listProducts,
  createProductionLot,
  deleteProductionLots,
  ProductionLot,
  Product,
} from '../../services/qcApi';
import { usePermissions } from '../../contexts/PermissionContext';
import { SelectAllCheckbox } from './components/SelectAllCheckbox';
import { cn } from '../../lib/utils';

interface Props {
  onSelectLot: (id: string) => void;
}

export default function LotsList({ onSelectLot }: Props) {
  const { can } = usePermissions();
  const canCreate = can('qc', 'batches', 'create');
  const canDelete = can('qc', 'batches', 'delete');

  const [lots, setLots] = useState<ProductionLot[]>([]);
  const [skus, setSkus] = useState<Product[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [lotBarcode, setLotBarcode] = useState('');
  const [woBarcode, setWoBarcode] = useState('');
  const [skuId, setSkuId] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const load = () => listProductionLots().then(setLots).catch(e => setError(e.message));

  useEffect(() => {
    load();
    listProducts().then((s) => {
      setSkus(s);
      if (s[0]) setSkuId(s[0].id);
    });
  }, []);

  const fillDemo = () => {
    setLotBarcode('LOT-DEMO-001');
    setWoBarcode('WO-DEMO-001');
  };

  const create = async () => {
    setError('');
    setMsg('');
    try {
      await createProductionLot({ lot_barcode: lotBarcode, work_order_barcode: woBarcode, sku_id: skuId });
      setShowForm(false);
      setLotBarcode('');
      setWoBarcode('');
      setMsg('Dry room created');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed');
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
    if (selected.size === lots.length) setSelected(new Set());
    else setSelected(new Set(lots.map(l => l.id)));
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
      await deleteProductionLots([...selected]);
      setMsg(`Deleted ${selected.size} dry room(s)`);
      setSelected(new Set());
      setConfirmBulkDelete(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
    setBusy(false);
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-slate-900">Dry Rooms</h1>
        {canCreate && (
          <button
            type="button"
            onClick={() => setShowForm(v => !v)}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-4 py-2 rounded-lg"
          >
            <Plus size={13} /> {showForm ? 'Cancel' : 'New Dry Room'}
          </button>
        )}
      </div>

      {error && <p className="text-red-600 mb-3 text-sm">{error}</p>}
      {msg && <p className="text-emerald-700 bg-emerald-50 p-2 rounded-lg mb-3 text-sm">{msg}</p>}

      {showForm && canCreate && (
        <div className="bg-white rounded-xl border p-4 mb-4 space-y-3">
          <button type="button" onClick={fillDemo} className="text-xs text-blue-600 underline">
            Fill DEMO barcodes (simulate scan)
          </button>
          <input
            placeholder="Lot barcode"
            className="w-full border rounded-lg px-3 py-2.5 text-sm"
            value={lotBarcode}
            onChange={(e) => setLotBarcode(e.target.value)}
          />
          <input
            placeholder="Work order barcode"
            className="w-full border rounded-lg px-3 py-2.5 text-sm"
            value={woBarcode}
            onChange={(e) => setWoBarcode(e.target.value)}
          />
          <select className="w-full border rounded-lg px-3 py-2.5 text-sm" value={skuId} onChange={(e) => setSkuId(e.target.value)}>
            <option value="">— Select SKU —</option>
            {skus.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button type="button" onClick={create} disabled={!lotBarcode || !woBarcode || !skuId}
                  className="w-full bg-emerald-600 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-medium">
            Save
          </button>
        </div>
      )}

      <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-3">
        <SelectAllCheckbox total={lots.length} selected={selected.size} onToggleAll={toggleSelectAll} />
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

      <ul className="space-y-2">
        {lots.map((lot) => {
          const checked = selected.has(lot.id);
          return (
            <li key={lot.id} className={cn('bg-white border rounded-xl p-3 flex items-center gap-3', checked && 'border-blue-400 bg-blue-50/40')}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleSelect(lot.id)}
                className="w-4 h-4 rounded accent-blue-600"
              />
              <button
                type="button"
                onClick={() => onSelectLot(lot.id)}
                className="flex-1 text-left min-w-0"
              >
                <div className="font-semibold text-slate-900">{lot.lot_number}</div>
                <p className="text-xs text-slate-500 mt-0.5">{lot.sku_name} · {lot.lot_barcode}</p>
              </button>
            </li>
          );
        })}
        {lots.length === 0 && <p className="text-slate-500 text-sm">No dry rooms</p>}
      </ul>
    </div>
  );
}

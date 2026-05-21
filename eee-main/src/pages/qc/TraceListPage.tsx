import React, { useEffect, useState } from 'react';
import { listProductionLots, ProductionLot } from '../../services/qcApi';
import { SelectAllCheckbox } from './components/SelectAllCheckbox';
import { cn } from '../../lib/utils';

interface Props {
  onSelectLot: (id: string) => void;
}

export default function TraceListPage({ onSelectLot }: Props) {
  const [lots, setLots] = useState<ProductionLot[]>([]);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    listProductionLots().then(setLots).catch((e) => setError(e.message));
  }, []);

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
    else setSelected(new Set(lots.map((l) => l.id)));
  };

  const exportSelected = () => {
    const rows = lots.filter((l) => selected.has(l.id));
    const csv = [
      ['lot_number', 'lot_barcode', 'work_order_barcode', 'sku_code', 'sku_name', 'created_at'].join(','),
      ...rows.map(r => [
        r.lot_number, r.lot_barcode, r.work_order_barcode,
        r.sku_code ?? '', r.sku_name ?? '', r.created_at,
      ].map(v => `"${(v ?? '').toString().replace(/"/g, '""')}"`).join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qc-trace-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Batch Trace</h1>
      <p className="text-sm text-slate-600 mb-4">Select a dry room to view sub-lots and quality events.</p>

      {error && <p className="text-red-600 mb-3 text-sm">{error}</p>}

      <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-3">
        <SelectAllCheckbox total={lots.length} selected={selected.size} onToggleAll={toggleSelectAll} />
        {selected.size > 0 && (
          <button
            type="button"
            onClick={exportSelected}
            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-700 hover:bg-slate-600 text-white"
          >
            Export {selected.size} as CSV
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

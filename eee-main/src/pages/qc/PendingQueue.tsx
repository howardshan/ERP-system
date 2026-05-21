import React, { useEffect, useState } from 'react';
import {
  listPendingInspections,
  submitInspectionsBulk,
  formatQcDateTime,
  SubLot,
} from '../../services/qcApi';
import { usePermissions } from '../../contexts/PermissionContext';
import { QcStatusBadge } from './components/QcStatusBadge';
import { SelectAllCheckbox } from './components/SelectAllCheckbox';
import { cn } from '../../lib/utils';

interface Props {
  onInspectSubLot: (subLotId: string) => void;
}

export default function PendingQueue({ onInspectSubLot }: Props) {
  const { can } = usePermissions();
  const canSubmit = can('qc', 'testing', 'submit_inspection');

  const [items, setItems] = useState<SubLot[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showBulkInput, setShowBulkInput] = useState(false);
  const [bulkAw, setBulkAw] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => listPendingInspections().then(setItems).catch((e) => setError(e.message));

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
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
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((s) => s.id)));
  };

  const bulkSubmit = async () => {
    const aw = parseFloat(bulkAw);
    if (!Number.isFinite(aw) || aw < 0 || aw > 2) {
      setError('Enter a valid Aw value (0–2)');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const submissions = [...selected].map(id => ({ subLotId: id, aw }));
      const results = await submitInspectionsBulk(submissions);
      const passed = results.filter(r => r.result === 'pass').length;
      const failed = results.filter(r => r.result === 'fail').length;
      setMsg(`Submitted ${results.length} inspection(s): ${passed} pass, ${failed} hold`);
      setSelected(new Set());
      setShowBulkInput(false);
      setBulkAw('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bulk submission failed');
    }
    setBusy(false);
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900">Testing</h1>
      <p className="text-xs text-slate-500 mt-1 mb-4">Sub-lots awaiting inspection · sorted by check-out time · refreshes every 5s</p>

      {error && <p className="text-red-600 mb-3 text-sm">{error}</p>}
      {msg && <p className="text-emerald-700 bg-emerald-50 p-2 rounded-lg mb-3 text-sm">{msg}</p>}

      <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-3 flex-wrap gap-2">
        <SelectAllCheckbox total={items.length} selected={selected.size} onToggleAll={toggleSelectAll} />
        {canSubmit && selected.size > 0 && (
          <div className="flex items-center gap-2">
            {!showBulkInput ? (
              <button
                type="button"
                onClick={() => setShowBulkInput(true)}
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-500 text-white"
              >
                Bulk submit ({selected.size})
              </button>
            ) : (
              <>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="2"
                  placeholder="Aw"
                  value={bulkAw}
                  onChange={(e) => setBulkAw(e.target.value)}
                  className="border rounded-lg px-2 py-1 text-sm w-20"
                />
                <button
                  type="button"
                  onClick={bulkSubmit}
                  disabled={busy || !bulkAw}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
                >
                  {busy ? 'Submitting…' : `Apply Aw to ${selected.size}`}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowBulkInput(false); setBulkAw(''); }}
                  className="px-2 py-1.5 text-xs text-slate-600"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <ul className="space-y-3">
        {items.map((s) => {
          const checked = selected.has(s.id);
          const overdue = (s.wait_minutes ?? 0) > 120;
          return (
            <li
              key={s.id}
              className={cn(
                'bg-white rounded-xl border-2 p-4 flex gap-3 items-start',
                checked ? 'border-blue-500 bg-blue-50/30' : overdue ? 'border-amber-500 bg-amber-50' : 'border-slate-200',
              )}
            >
              {canSubmit && (
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleSelect(s.id)}
                  className="w-4 h-4 rounded accent-blue-600 mt-1"
                />
              )}
              <button
                type="button"
                onClick={() => onInspectSubLot(s.id)}
                className="flex-1 text-left min-w-0"
              >
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <div className="font-semibold text-base text-slate-900">{s.sub_lot_code}</div>
                    <p className="text-xs text-slate-600 mt-0.5">{s.sku_name} · {s.location_name}</p>
                  </div>
                  <QcStatusBadge status={s.status} />
                </div>
                <div className="text-xs mt-2 text-slate-600 space-y-0.5">
                  <p>In: {formatQcDateTime(s.in_time)}</p>
                  <p>Out: {formatQcDateTime(s.out_time)}</p>
                  {s.wait_minutes != null && (
                    <p className="text-amber-800 font-medium">Waiting {s.wait_minutes} min</p>
                  )}
                </div>
              </button>
            </li>
          );
        })}
        {items.length === 0 && <p className="text-slate-500 text-sm">No pending sub-lots</p>}
      </ul>
    </div>
  );
}

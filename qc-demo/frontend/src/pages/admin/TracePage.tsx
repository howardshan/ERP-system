import { FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, SubLot } from '../../api/client';
import { AppShell } from '../../components/AppShell';
import { RowActionsMenu } from '../../components/RowActionsMenu';
import { StatusBadge } from '../../components/StatusBadge';
import { cn, formatDateTime, STATUS_LABEL, toLocalInputValue } from '../../lib/utils';

const FAIL_EVENTS = new Set(['inspection_failed_hold']);

const STATUS_OPTIONS = Object.keys(STATUS_LABEL);

function suggestedSubLotCode(lotBarcode: string, existingCount: number): string {
  return `${lotBarcode}-D${String(existingCount + 1).padStart(2, '0')}`;
}

type SubLotForm = {
  sub_lot_code: string;
  location_id: string;
  in_time: string;
  out_time: string;
  status: string;
};

function subToForm(s: SubLot): SubLotForm {
  return {
    sub_lot_code: s.sub_lot_code,
    location_id: s.location_id || '',
    in_time: toLocalInputValue(s.in_time),
    out_time: toLocalInputValue(s.out_time),
    status: s.status,
  };
}

export function TracePage() {
  const { lotId } = useParams<{ lotId: string }>();
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof api.productionLotDetail>> | null>(null);
  const [locations, setLocations] = useState<Array<{ id: string; display_name: string }>>([]);
  const [editingSubId, setEditingSubId] = useState<string | null>(null);
  const [subForm, setSubForm] = useState<SubLotForm | null>(null);
  const [checkInCode, setCheckInCode] = useState('');
  const [checkInLocationId, setCheckInLocationId] = useState('');
  const [checkInTime, setCheckInTime] = useState(toLocalInputValue());
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => {
    if (!lotId) return;
    api.productionLotDetail(lotId).then(setDetail).catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
    api.locations().then((locs) => {
      setLocations(locs);
      if (locs[0]) {
        setCheckInLocationId(locs[0].id);
      }
    });
  }, [lotId]);

  const fillSimulatedScan = () => {
    if (!detail) return;
    setCheckInCode(suggestedSubLotCode(detail.lot.lot_barcode, detail.sub_lots.length));
    setError('');
  };

  const checkIn = async (e: FormEvent) => {
    e.preventDefault();
    if (!lotId) return;
    const code = checkInCode.trim();
    if (!code) {
      setError('Sub-lot code is required');
      return;
    }
    setError('');
    try {
      await api.checkInSubLot({
        production_lot_id: lotId,
        sub_lot_code: code,
        location_id: checkInLocationId || undefined,
        in_time: new Date(checkInTime).toISOString(),
      });
      setMsg(`Checked in ${code}`);
      setCheckInCode('');
      setCheckInTime(toLocalInputValue());
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check-in failed');
    }
  };

  const startEditSub = (s: SubLot) => {
    setEditingSubId(s.id);
    setSubForm(subToForm(s));
    setMsg('');
    setError('');
  };

  const cancelEditSub = () => {
    setEditingSubId(null);
    setSubForm(null);
  };

  const saveSub = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingSubId || !subForm) return;
    setError('');
    try {
      await api.updateSubLot(editingSubId, {
        sub_lot_code: subForm.sub_lot_code.trim(),
        location_id: subForm.location_id || null,
        in_time: subForm.in_time ? new Date(subForm.in_time).toISOString() : null,
        out_time: subForm.out_time ? new Date(subForm.out_time).toISOString() : null,
        status: subForm.status,
      });
      setMsg('Sub-lot updated');
      cancelEditSub();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const removeSub = async (s: SubLot) => {
    if (
      !confirm(
        `Delete sub-lot ${s.sub_lot_code}? Only allowed when there are no inspections or dispositions.`
      )
    ) {
      return;
    }
    try {
      await api.deleteSubLot(s.id);
      if (editingSubId === s.id) cancelEditSub();
      setMsg('Sub-lot deleted');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  if (!detail) return <AppShell variant="admin">Loading…</AppShell>;

  return (
    <AppShell variant="admin" title={`Trace · ${detail.lot.lot_number}`}>
      <p className="text-slate-600 mb-2">
        {detail.lot.sku_name} · {detail.lot.lot_barcode} · WO {detail.lot.work_order_barcode}
      </p>
      <Link to="/admin/trace" className="text-sm text-blue-600 mb-4 inline-block min-h-[44px] flex items-center">
        ← Back to batch list
      </Link>

      {msg && <p className="text-emerald-700 bg-emerald-50 p-3 rounded-lg mb-3">{msg}</p>}
      {error && <p className="text-red-600 mb-3">{error}</p>}

      <form onSubmit={checkIn} className="bg-white rounded-xl border p-4 mb-6 space-y-3">
        <h2 className="font-semibold">Add sub-lot (check in)</h2>
        <label className="block">
          <span className="text-sm font-medium">Sub-lot code</span>
          <input
            className="mt-1 w-full border rounded-lg px-3 py-3 min-h-[44px] font-mono"
            value={checkInCode}
            onChange={(e) => setCheckInCode(e.target.value)}
            required
          />
        </label>
        <button type="button" onClick={fillSimulatedScan} className="text-sm text-blue-600 underline min-h-[44px]">
          Simulate barcode scan (fill next code)
        </button>
        <label className="block">
          <span className="text-sm font-medium">Dryer location</span>
          <select
            className="mt-1 w-full border rounded-lg px-3 py-3 min-h-[44px]"
            value={checkInLocationId}
            onChange={(e) => setCheckInLocationId(e.target.value)}
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.display_name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium">Check-in time</span>
          <input
            type="datetime-local"
            className="mt-1 w-full border rounded-lg px-3 py-3 min-h-[44px]"
            value={checkInTime}
            onChange={(e) => setCheckInTime(e.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={!checkInCode.trim()}
          className="w-full bg-sky-600 text-white py-3 rounded-xl min-h-[48px] font-medium disabled:opacity-50"
        >
          Confirm check-in
        </button>
      </form>

      <h2 className="font-semibold mb-2 flex items-center gap-2">
        Drying sub-lots
        <span className="text-sm font-normal text-slate-600 bg-slate-100 border border-slate-200 rounded-full px-2.5 py-0.5 tabular-nums">
          {detail.sub_lots.length}
        </span>
      </h2>
      <ul className="space-y-3 mb-6">
        {detail.sub_lots.map((s) => {
          const isEditing = editingSubId === s.id && subForm;
          return (
            <li
              key={s.id}
              className={cn(
                'rounded-xl p-4',
                isEditing ? 'bg-white border-2 border-blue-500' : 'bg-white border'
              )}
            >
              {isEditing ? (
                <form onSubmit={saveSub} className="space-y-3">
                  <h3 className="font-medium text-blue-800">Edit sub-lot</h3>
                  <label className="block">
                    <span className="text-sm font-medium">Sub-lot code</span>
                    <input
                      className="mt-1 w-full border rounded-lg px-3 py-2 min-h-[44px] font-mono"
                      value={subForm.sub_lot_code}
                      onChange={(e) => setSubForm({ ...subForm, sub_lot_code: e.target.value })}
                      required
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium">Location</span>
                    <select
                      className="mt-1 w-full border rounded-lg px-3 py-2 min-h-[44px]"
                      value={subForm.location_id}
                      onChange={(e) => setSubForm({ ...subForm, location_id: e.target.value })}
                    >
                      <option value="">— None —</option>
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.display_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <label className="block">
                      <span className="text-sm font-medium">Check-in time</span>
                      <input
                        type="datetime-local"
                        className="mt-1 w-full border rounded-lg px-3 py-2 min-h-[44px]"
                        value={subForm.in_time}
                        onChange={(e) => setSubForm({ ...subForm, in_time: e.target.value })}
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium">Check-out time</span>
                      <input
                        type="datetime-local"
                        className="mt-1 w-full border rounded-lg px-3 py-2 min-h-[44px]"
                        value={subForm.out_time}
                        onChange={(e) => setSubForm({ ...subForm, out_time: e.target.value })}
                      />
                    </label>
                  </div>
                  <label className="block">
                    <span className="text-sm font-medium">Status</span>
                    <select
                      className="mt-1 w-full border rounded-lg px-3 py-2 min-h-[44px]"
                      value={subForm.status}
                      onChange={(e) => setSubForm({ ...subForm, status: e.target.value })}
                    >
                      {STATUS_OPTIONS.map((st) => (
                        <option key={st} value={st}>
                          {STATUS_LABEL[st]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="text-xs text-amber-800">
                    Manual status edits are for demo corrections only. Prefer check-in/out on the QC floor for
                    normal workflow.
                  </p>
                  <div className="flex gap-2">
                    <button type="submit" className="flex-1 bg-emerald-600 text-white py-3 rounded-xl min-h-[48px]">
                      Save
                    </button>
                    <button type="button" className="px-4 py-3 rounded-xl border min-h-[48px]" onClick={cancelEditSub}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="flex justify-between items-start gap-2 mb-1">
                    <span className="font-medium text-lg">{s.sub_lot_code}</span>
                    <div className="flex gap-2 shrink-0 items-center">
                      <StatusBadge status={s.status} />
                      <RowActionsMenu
                        disabled={editingSubId !== null}
                        actions={[
                          { label: 'Edit', onClick: () => startEditSub(s) },
                          { label: 'Delete', variant: 'danger', onClick: () => removeSub(s) },
                        ]}
                      />
                    </div>
                  </div>
                  <p className="text-sm text-slate-600">
                    {s.location_name || 'No location'} · In {formatDateTime(s.in_time)} · Out{' '}
                    {formatDateTime(s.out_time)}
                  </p>
                </>
              )}
            </li>
          );
        })}
        {detail.sub_lots.length === 0 && (
          <p className="text-slate-500">No sub-lots yet. Use the form above to check in.</p>
        )}
      </ul>

      <h2 className="font-semibold mb-2">Quality events</h2>
      <ul className="space-y-2 text-sm">
        {detail.events.map((ev) => (
          <li
            key={ev.id}
            className={cn(
              'rounded-xl border p-3',
              FAIL_EVENTS.has(ev.event_type)
                ? 'bg-red-50 border-red-200'
                : 'bg-slate-50 border-slate-200'
            )}
          >
            <p
              className={cn(
                'font-medium leading-snug',
                FAIL_EVENTS.has(ev.event_type) ? 'text-red-900' : 'text-slate-800'
              )}
            >
              {ev.summary}
            </p>
            <p className="text-xs text-slate-500 mt-1.5">{formatDateTime(ev.created_at)}</p>
          </li>
        ))}
        {detail.events.length === 0 && <p className="text-slate-500">No events</p>}
      </ul>
    </AppShell>
  );
}

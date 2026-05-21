import { FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, SubLot } from '../../api/client';
import { AppShell } from '../../components/AppShell';
import { StatusBadge } from '../../components/StatusBadge';
import { formatDateTime, toLocalInputValue } from '../../lib/utils';

function suggestedSubLotCode(lotBarcode: string, existingCount: number): string {
  return `${lotBarcode}-D${String(existingCount + 1).padStart(2, '0')}`;
}

export function LotDetail() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<{
    lot: { lot_number: string; lot_barcode: string; sku_name?: string };
    sub_lots: SubLot[];
  } | null>(null);
  const [locations, setLocations] = useState<Array<{ id: string; display_name: string }>>([]);
  const [subLotCode, setSubLotCode] = useState('');
  const [locationId, setLocationId] = useState('');
  const [inTimeLocal, setInTimeLocal] = useState(toLocalInputValue());
  const [outTimeLocal, setOutTimeLocal] = useState(toLocalInputValue());
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => {
    if (!id) return;
    api.productionLotDetail(id).then(setDetail).catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
    api.locations().then((locs) => {
      setLocations(locs);
      if (locs[0]) setLocationId(locs[0].id);
    });
  }, [id]);

  const fillSimulatedScan = () => {
    if (!detail) return;
    setSubLotCode(suggestedSubLotCode(detail.lot.lot_barcode, detail.sub_lots.length));
    setError('');
  };

  const checkIn = async (e: FormEvent) => {
    e.preventDefault();
    if (!id) return;
    const code = subLotCode.trim();
    if (!code) {
      setError('Sub-lot code is required');
      return;
    }
    setError('');
    try {
      await api.checkInSubLot({
        production_lot_id: id,
        sub_lot_code: code,
        location_id: locationId,
        in_time: new Date(inTimeLocal).toISOString(),
      });
      setMsg(`Checked in ${code} — status: Drying`);
      setSubLotCode('');
      setInTimeLocal(toLocalInputValue());
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check-in failed');
    }
  };

  const checkOut = async (sub: SubLot) => {
    try {
      await api.checkOutSubLot(sub.id, new Date(outTimeLocal).toISOString());
      setMsg(`${sub.sub_lot_code} checked out — pending inspection`);
      setOutTimeLocal(toLocalInputValue());
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check-out failed');
    }
  };

  if (!detail) return <AppShell variant="qc">Loading…</AppShell>;

  const subLotCount = detail.sub_lots.length;

  return (
    <AppShell variant="qc" title={detail.lot.lot_number}>
      <p className="text-slate-600 mb-2">
        {detail.lot.sku_name} · {detail.lot.lot_barcode}
      </p>
      {msg && <p className="text-emerald-700 bg-emerald-50 p-3 rounded-lg mb-3">{msg}</p>}
      {error && <p className="text-red-600 mb-3">{error}</p>}

      <form onSubmit={checkIn} className="bg-white rounded-xl border p-4 mb-6 space-y-3">
        <h2 className="font-semibold">Check in (new drying sub-lot)</h2>
        <label className="block">
          <span className="text-sm font-medium">Sub-lot code (scan or type)</span>
          <input
            className="mt-1 w-full border rounded-lg px-3 py-3 min-h-[44px] font-mono"
            value={subLotCode}
            onChange={(e) => setSubLotCode(e.target.value)}
            placeholder="e.g. LOT-DEMO-001-D03"
            required
            autoComplete="off"
          />
        </label>
        <button
          type="button"
          onClick={fillSimulatedScan}
          className="text-sm text-blue-600 underline min-h-[44px]"
        >
          Simulate barcode scan (fill next code)
        </button>
        <label className="block">
          <span className="text-sm font-medium">Dryer location</span>
          <select
            className="mt-1 w-full border rounded-lg px-3 py-3 min-h-[44px]"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
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
            value={inTimeLocal}
            onChange={(e) => setInTimeLocal(e.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={!subLotCode.trim()}
          className="w-full bg-sky-600 text-white py-3 rounded-xl min-h-[48px] font-medium disabled:opacity-50"
        >
          Confirm check-in
        </button>
      </form>

      <h2 className="font-semibold mb-2 flex items-center gap-2">
        Drying sub-lots
        <span className="text-sm font-normal text-slate-600 bg-slate-100 border border-slate-200 rounded-full px-2.5 py-0.5 tabular-nums">
          {subLotCount}
        </span>
      </h2>
      <ul className="space-y-3">
        {detail.sub_lots.map((s) => (
          <li key={s.id} className="bg-white rounded-xl border p-4 space-y-2">
            <div className="flex justify-between items-start gap-2">
              <div className="font-medium text-lg">{s.sub_lot_code}</div>
              <StatusBadge status={s.status} />
            </div>
            <div className="text-sm text-slate-600 grid sm:grid-cols-2 gap-1">
              <p>Location: {s.location_name || '—'}</p>
              <p>In: {formatDateTime(s.in_time)}</p>
              <p>Out: {formatDateTime(s.out_time)}</p>
              {s.wait_minutes != null && <p className="text-amber-800">Wait: {s.wait_minutes} min</p>}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {s.status === 'drying' && (
                <div className="w-full space-y-2 pt-1 border-t border-slate-100">
                  <label className="block text-sm">
                    <span className="font-medium">Check-out time</span>
                    <input
                      type="datetime-local"
                      className="mt-1 w-full border rounded-lg px-3 py-2 min-h-[44px]"
                      value={outTimeLocal}
                      onChange={(e) => setOutTimeLocal(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => checkOut(s)}
                    className="w-full bg-amber-600 text-white py-2 rounded-xl min-h-[44px] font-medium"
                  >
                    Check out → Pending
                  </button>
                </div>
              )}
              {(s.status === 'pending' || s.status === 'inspecting') && (
                <Link
                  to={`/qc/inspect/${s.id}`}
                  className="flex-1 text-center bg-blue-600 text-white py-2 rounded-xl min-h-[44px] font-medium flex items-center justify-center"
                >
                  Inspect
                </Link>
              )}
            </div>
          </li>
        ))}
        {subLotCount === 0 && (
          <p className="text-slate-500">No sub-lots yet. Check in to create one.</p>
        )}
      </ul>
    </AppShell>
  );
}

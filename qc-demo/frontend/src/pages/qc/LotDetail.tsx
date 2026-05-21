import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Layers } from 'lucide-react';
import { api, SubLot } from '../../api/client';
import { AppShell } from '../../components/AppShell';
import { StatusBadge } from '../../components/StatusBadge';
import { Alert, Button, Card, EmptyState, Field, Input, PageHeader, PageSkeleton, Select } from '../../components/ui';
import { formatDateTime, toLocalInputValue } from '../../lib/utils';

function suggestedSubLotCode(lotBarcode: string, existingCount: number): string {
  return `${lotBarcode}-D${String(existingCount + 1).padStart(2, '0')}`;
}

export function LotDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
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

  if (!detail) {
    return (
      <AppShell variant="qc">
        <PageSkeleton />
      </AppShell>
    );
  }

  const subLotCount = detail.sub_lots.length;

  return (
    <AppShell variant="qc">
      <PageHeader
        title={detail.lot.lot_number}
        description={`${detail.lot.sku_name} · ${detail.lot.lot_barcode}`}
      />
      <div className="space-y-4 mb-4">
        {msg && <Alert variant="success">{msg}</Alert>}
        {error && <Alert variant="error">{error}</Alert>}
      </div>

      <div className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-slate-50/95 backdrop-blur-sm border-b border-slate-200/80 mb-4 md:static md:mx-0 md:px-0 md:py-0 md:bg-transparent md:border-0 md:mb-6">
        <Card variant="elevated" className="p-4 space-y-3 border-2 border-teal-100 shadow-md">
          <h2 className="font-semibold text-teal-900">Check in (new drying sub-lot)</h2>
          <form onSubmit={checkIn} className="space-y-3">
            <Field label="Sub-lot code (scan or type)">
              <Input
                className="font-mono text-lg"
                value={subLotCode}
                onChange={(e) => setSubLotCode(e.target.value)}
                placeholder="e.g. LOT-DEMO-001-D03"
                required
                autoComplete="off"
              />
            </Field>
            <Button type="button" variant="ghost" tone="qc" onClick={fillSimulatedScan} className="!min-h-[36px] text-sm">
              Simulate barcode scan (fill next code)
            </Button>
            <Field label="Dryer location">
              <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.display_name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Check-in time">
              <Input
                type="datetime-local"
                value={inTimeLocal}
                onChange={(e) => setInTimeLocal(e.target.value)}
              />
            </Field>
            <Button type="submit" variant="primary" tone="qc" fullWidth size="lg" disabled={!subLotCode.trim()}>
              Confirm check-in
            </Button>
          </form>
        </Card>
      </div>

      <h2 className="font-semibold mb-3 flex items-center gap-2 text-slate-900">
        Drying sub-lots
        <span className="text-sm font-normal text-slate-600 bg-slate-100 border border-slate-200 rounded-full px-2.5 py-0.5 tabular-nums">
          {subLotCount}
        </span>
      </h2>
      <ul className="space-y-3">
        {detail.sub_lots.map((s) => (
          <li key={s.id}>
            <Card variant="elevated" className="p-4 space-y-2">
              <div className="flex justify-between items-start gap-2">
                <div className="font-medium text-lg font-mono">{s.sub_lot_code}</div>
                <StatusBadge status={s.status} />
              </div>
              <div className="text-sm text-slate-600 grid sm:grid-cols-2 gap-1">
                <p>Location: {s.location_name || '—'}</p>
                <p>In: {formatDateTime(s.in_time)}</p>
                <p>Out: {formatDateTime(s.out_time)}</p>
                {s.wait_minutes != null && <p className="text-amber-800 font-medium">Wait: {s.wait_minutes} min</p>}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {s.status === 'drying' && (
                  <div className="w-full space-y-2 pt-2 border-t border-slate-100">
                    <Field label="Check-out time">
                      <Input
                        type="datetime-local"
                        value={outTimeLocal}
                        onChange={(e) => setOutTimeLocal(e.target.value)}
                      />
                    </Field>
                    <Button
                      type="button"
                      variant="secondary"
                      tone="qc"
                      fullWidth
                      className="!bg-amber-600 !text-white hover:!bg-amber-700 border-amber-600"
                      onClick={() => checkOut(s)}
                    >
                      Check out → Pending
                    </Button>
                  </div>
                )}
                {(s.status === 'pending' || s.status === 'inspecting') && (
                  <Button
                    variant="primary"
                    tone="qc"
                    fullWidth
                    className="flex-1"
                    onClick={() => navigate(`/qc/inspect/${s.id}`)}
                  >
                    Inspect
                  </Button>
                )}
              </div>
            </Card>
          </li>
        ))}
        {subLotCount === 0 && (
          <EmptyState
            icon={Layers}
            title="No sub-lots yet"
            description="Use the check-in form above to register a drying sub-lot."
          />
        )}
      </ul>
    </AppShell>
  );
}

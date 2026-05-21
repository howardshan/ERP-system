import { FormEvent, useEffect, useState } from 'react';
import { ArrowLeft, Layers } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api, SubLot } from '../../api/client';
import { AppShell } from '../../components/AppShell';
import { RowActionsMenu } from '../../components/RowActionsMenu';
import { StatusBadge } from '../../components/StatusBadge';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  PageSkeleton,
  Select,
} from '../../components/ui';
import { getTone } from '../../components/ui/tone';
import { cn, formatDateTime, STATUS_LABEL, toLocalInputValue } from '../../lib/utils';

const FAIL_EVENTS = new Set(['inspection_failed_hold']);
const STATUS_OPTIONS = Object.keys(STATUS_LABEL);
const accentForm = getTone('admin').outlineAccent;
const linkClass = getTone('admin').link;

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
  const [addingCheckIn, setAddingCheckIn] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const startAddingCheckIn = () => {
    setAddingCheckIn(true);
    setMsg('');
    setError('');
  };

  const cancelAddingCheckIn = () => {
    setAddingCheckIn(false);
    setCheckInCode('');
    setCheckInTime(toLocalInputValue());
    setError('');
  };

  const load = () => {
    if (!lotId) return;
    api.productionLotDetail(lotId).then(setDetail).catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
    api.locations().then((locs) => {
      setLocations(locs);
      if (locs[0]) setCheckInLocationId(locs[0].id);
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
      setAddingCheckIn(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check-in failed');
    }
  };

  const startEditSub = (s: SubLot) => {
    setAddingCheckIn(false);
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

  if (!detail) {
    return (
      <AppShell variant="admin">
        <PageSkeleton />
      </AppShell>
    );
  }

  return (
    <AppShell variant="admin">
      <Link
        to="/admin/trace"
        className={cn('text-sm font-medium mb-4 inline-flex items-center gap-1 min-h-[44px]', linkClass)}
      >
        <ArrowLeft className="h-4 w-4" />
        Back to batch list
      </Link>
      <PageHeader
        title={`Trace · ${detail.lot.lot_number}`}
        description={`${detail.lot.sku_name} · ${detail.lot.lot_barcode} · WO ${detail.lot.work_order_barcode}`}
        action={
          <Button
            variant={addingCheckIn ? 'secondary' : 'primary'}
            onClick={addingCheckIn ? cancelAddingCheckIn : startAddingCheckIn}
            disabled={editingSubId !== null}
          >
            {addingCheckIn ? 'Cancel' : 'Add sub-lot'}
          </Button>
        }
      />
      <div className="space-y-4 mb-4">
        {msg && <Alert variant="success">{msg}</Alert>}
        {error && <Alert variant="error">{error}</Alert>}
      </div>

      {addingCheckIn && (
        <Card variant="outline" className={cn('p-4 mb-6 space-y-3 border-2 shadow-sm', accentForm)}>
          <h2 className="font-semibold text-indigo-800">Add sub-lot (check in)</h2>
          <form onSubmit={checkIn} className="space-y-3">
            <Field label="Sub-lot code">
              <Input
                className="font-mono"
                value={checkInCode}
                onChange={(e) => setCheckInCode(e.target.value)}
                required
              />
            </Field>
            <Button type="button" variant="ghost" onClick={fillSimulatedScan} className="!min-h-[36px] text-sm">
              Simulate barcode scan (fill next code)
            </Button>
            <Field label="Dryer location">
              <Select value={checkInLocationId} onChange={(e) => setCheckInLocationId(e.target.value)}>
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
                value={checkInTime}
                onChange={(e) => setCheckInTime(e.target.value)}
              />
            </Field>
            <Button type="submit" variant="primary" fullWidth disabled={!checkInCode.trim()}>
              Confirm check-in
            </Button>
          </form>
        </Card>
      )}

      <h2 className="font-semibold mb-3 flex items-center gap-2 text-slate-900">
        Drying sub-lots
        <span className="text-sm font-normal text-slate-600 bg-slate-100 border border-slate-200 rounded-full px-2.5 py-0.5 tabular-nums">
          {detail.sub_lots.length}
        </span>
      </h2>
      <ul className="space-y-2 mb-8">
        {detail.sub_lots.map((s) => {
          const isEditing = editingSubId === s.id && subForm;
          return (
            <li key={s.id}>
              <Card
                variant="outline"
                className={cn('p-4', isEditing && cn('border-2', accentForm))}
              >
                {isEditing ? (
                  <form onSubmit={saveSub} className="space-y-3">
                    <h3 className="font-medium text-indigo-800">Edit sub-lot</h3>
                    <Field label="Sub-lot code">
                      <Input
                        className="font-mono"
                        value={subForm.sub_lot_code}
                        onChange={(e) => setSubForm({ ...subForm, sub_lot_code: e.target.value })}
                        required
                      />
                    </Field>
                    <Field label="Location">
                      <Select
                        value={subForm.location_id}
                        onChange={(e) => setSubForm({ ...subForm, location_id: e.target.value })}
                      >
                        <option value="">— None —</option>
                        {locations.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.display_name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <Field label="Check-in time">
                        <Input
                          type="datetime-local"
                          value={subForm.in_time}
                          onChange={(e) => setSubForm({ ...subForm, in_time: e.target.value })}
                        />
                      </Field>
                      <Field label="Check-out time">
                        <Input
                          type="datetime-local"
                          value={subForm.out_time}
                          onChange={(e) => setSubForm({ ...subForm, out_time: e.target.value })}
                        />
                      </Field>
                    </div>
                    <Field label="Status">
                      <Select
                        value={subForm.status}
                        onChange={(e) => setSubForm({ ...subForm, status: e.target.value })}
                      >
                        {STATUS_OPTIONS.map((st) => (
                          <option key={st} value={st}>
                            {STATUS_LABEL[st]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Alert variant="info">
                      Manual status edits are for demo corrections only. Prefer check-in/out on the QC floor for
                      normal workflow.
                    </Alert>
                    <div className="flex gap-2">
                      <Button type="submit" variant="primary" className="flex-1">
                        Save
                      </Button>
                      <Button type="button" variant="secondary" onClick={cancelEditSub}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="flex justify-between items-start gap-2">
                      <span className="font-medium text-lg font-mono text-slate-900">{s.sub_lot_code}</span>
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
                    <p className="text-sm text-slate-600 mt-1">
                      {s.location_name || 'No location'} · In {formatDateTime(s.in_time)} · Out{' '}
                      {formatDateTime(s.out_time)}
                    </p>
                  </>
                )}
              </Card>
            </li>
          );
        })}
        {detail.sub_lots.length === 0 && (
          <EmptyState
            icon={Layers}
            title="No sub-lots yet"
            description="Click Add sub-lot to check in a drying sub-lot."
          />
        )}
      </ul>

      <h2 className="font-semibold mb-3 text-slate-900">Quality events</h2>
      {detail.events.length === 0 ? (
        <EmptyState title="No events" description="Check-in, inspection, and disposition events will appear here." />
      ) : (
        <ul className="relative border-l-2 border-slate-200 ml-2 space-y-4 pl-6">
          {detail.events.map((ev) => (
            <li key={ev.id} className="relative">
              <span
                className={cn(
                  'absolute -left-[1.55rem] top-1.5 h-3 w-3 rounded-full ring-2 ring-white',
                  FAIL_EVENTS.has(ev.event_type) ? 'bg-red-500' : 'bg-indigo-400'
                )}
              />
              <Card
                variant="outline"
                className={cn(
                  'p-3 text-sm',
                  FAIL_EVENTS.has(ev.event_type) && 'bg-red-50/80 border-red-200'
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
              </Card>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}

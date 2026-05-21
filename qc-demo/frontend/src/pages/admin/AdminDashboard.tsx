import { useState } from 'react';
import { Inbox } from 'lucide-react';
import { api, DashboardSummary, SubLot, TodayInspectionItem } from '../../api/client';
import { AppShell } from '../../components/AppShell';
import { StatusBadge } from '../../components/StatusBadge';
import { Alert, Button, Card, EmptyState, Field, PageHeader, PageSkeleton, Select, Textarea } from '../../components/ui';
import { usePolling } from '../../hooks/usePolling';
import { cn, formatDateTime } from '../../lib/utils';

type Panel = 'pending' | 'hold' | 'passed' | 'rate';

const DISP_TYPES = [
  { value: 'rework', label: 'Rework' },
  { value: 'grind', label: 'Grind & re-line' },
  { value: 'scrap', label: 'Scrap' },
  { value: 'concession', label: 'Concession' },
];

export function AdminDashboard() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const [selectedHold, setSelectedHold] = useState<SubLot | null>(null);
  const [dispType, setDispType] = useState('rework');
  const [dispRemark, setDispRemark] = useState('');

  const load = () => {
    api
      .dashboard()
      .then((d) => {
        setData(d);
        if (selectedHold) {
          const still = d.holds.find((h) => h.id === selectedHold.id);
          if (!still) setSelectedHold(null);
        }
      })
      .catch((e) => setError(e.message));
  };

  const pollingEnabled = selectedHold === null;
  usePolling(load, 4000, pollingEnabled);

  const togglePanel = (p: Panel) => {
    setPanel((cur) => (cur === p ? null : p));
    setSelectedHold(null);
    setMsg('');
  };

  const submitDisposition = async () => {
    if (!selectedHold) return;
    setError('');
    try {
      await api.disposition({
        drying_sub_lot_id: selectedHold.id,
        type: dispType,
        remark: dispRemark || undefined,
      });
      setMsg(`Disposition completed: ${selectedHold.sub_lot_code}`);
      setSelectedHold(null);
      setDispRemark('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Disposition failed');
    }
  };

  return (
    <AppShell variant="admin">
      <PageHeader
        title="Dashboard"
        description={`Click a metric card for details · auto-refresh every 4s${!pollingEnabled ? ' (paused while disposing)' : ''}`}
      />
      <div className="space-y-4 mb-4">
        {msg && <Alert variant="success">{msg}</Alert>}
        {error && <Alert variant="error">{error}</Alert>}
      </div>

      {!data && <PageSkeleton />}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <StatCard
              label="Pending"
              value={data.pending_count}
              accent="amber"
              active={panel === 'pending'}
              onClick={() => togglePanel('pending')}
            />
            <StatCard
              label="Hold"
              value={data.hold_count}
              accent="red"
              active={panel === 'hold'}
              onClick={() => togglePanel('hold')}
            />
            <StatCard
              label="Passed today"
              value={data.today_passed}
              accent="emerald"
              active={panel === 'passed'}
              onClick={() => togglePanel('passed')}
            />
            <StatCard
              label="Pass rate"
              value={data.pass_rate != null ? `${data.pass_rate}%` : '—'}
              accent="blue"
              active={panel === 'rate'}
              onClick={() => togglePanel('rate')}
            />
          </div>

          {data.longest_wait_minutes != null && panel !== 'pending' && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
              Longest pending wait: {data.longest_wait_minutes} min
            </p>
          )}

          {panel === 'pending' && (
            <DetailPanel title="Pending sub-lots">
              {data.longest_wait_minutes != null && (
                <p className="text-sm text-amber-800 mb-3">Longest wait: {data.longest_wait_minutes} min</p>
              )}
              <SubLotList items={data.pending_items} emptyText="No pending sub-lots" showWait />
            </DetailPanel>
          )}

          {panel === 'hold' && (
            <DetailPanel title="Hold sub-lots · dispose here">
              {data.holds.length === 0 ? (
                <EmptyState icon={Inbox} title="No holds" description="Failed inspections awaiting disposition will appear here." />
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  <ul className="space-y-2">
                    {data.holds.map((h) => (
                      <li key={h.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedHold(h);
                            setMsg('');
                          }}
                          className={cn(
                            'w-full text-left rounded-xl border-2 p-4 min-h-[44px] transition-shadow shadow-sm',
                            selectedHold?.id === h.id
                              ? 'border-indigo-500 ring-2 ring-indigo-100 bg-white'
                              : 'border-red-200 bg-white hover:border-red-300'
                          )}
                        >
                          <div className="flex justify-between items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="font-semibold">{h.sub_lot_code}</div>
                              <p className="text-sm text-slate-600">{h.sku_name}</p>
                              {h.hold_reason && (
                                <p className="text-sm text-red-700 mt-2 leading-snug">Hold reason: {h.hold_reason}</p>
                              )}
                              {h.hold_inspected_at && (
                                <p className="text-xs text-slate-500 mt-1">
                                  Inspected: {formatDateTime(h.hold_inspected_at)}
                                </p>
                              )}
                            </div>
                            <StatusBadge status={h.status} />
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {selectedHold ? (
                    <Card variant="outline" className="p-4 space-y-3 h-fit border-indigo-200">
                      <p className="font-medium text-slate-900">Dispose: {selectedHold.sub_lot_code}</p>
                      {selectedHold.hold_reason && (
                        <Alert variant="error">{selectedHold.hold_reason}</Alert>
                      )}
                      <Field label="Disposition type">
                        <Select value={dispType} onChange={(e) => setDispType(e.target.value)}>
                          {DISP_TYPES.map((d) => (
                            <option key={d.value} value={d.value}>
                              {d.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Remarks">
                        <Textarea
                          placeholder="Optional remarks"
                          value={dispRemark}
                          onChange={(e) => setDispRemark(e.target.value)}
                        />
                      </Field>
                      <div className="flex gap-2">
                        <Button variant="danger" fullWidth onClick={submitDisposition}>
                          Confirm disposition
                        </Button>
                        <Button variant="secondary" onClick={() => setSelectedHold(null)}>
                          Cancel
                        </Button>
                      </div>
                    </Card>
                  ) : (
                    <p className="text-sm text-slate-500 hidden lg:flex items-center justify-center p-8 border border-dashed border-slate-200 rounded-xl">
                      Select a hold sub-lot to dispose
                    </p>
                  )}
                </div>
              )}
            </DetailPanel>
          )}

          {panel === 'passed' && (
            <DetailPanel title="Passed inspections today">
              <TodayInspectionList items={data.today_passed_items} emptyText="No passed inspections today" />
            </DetailPanel>
          )}

          {panel === 'rate' && (
            <DetailPanel title={"Today's inspection summary"}>
              <div className="grid sm:grid-cols-3 gap-3 mb-4 text-sm">
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                  <p className="text-slate-600">Passed</p>
                  <p className="text-2xl font-bold text-emerald-800">{data.today_passed}</p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-slate-600">Failed</p>
                  <p className="text-2xl font-bold text-red-800">{data.today_failed}</p>
                </div>
                <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
                  <p className="text-slate-600">Pass rate</p>
                  <p className="text-2xl font-bold text-indigo-800">
                    {data.pass_rate != null ? `${data.pass_rate}%` : '—'}
                  </p>
                </div>
              </div>
              {data.today_failed > 0 && (
                <>
                  <h3 className="font-medium text-red-800 mb-2">Failed today (on Hold)</h3>
                  <TodayInspectionList items={data.today_failed_items} emptyText="" />
                </>
              )}
              {data.today_passed === 0 && data.today_failed === 0 && (
                <EmptyState title="No inspections recorded today" />
              )}
            </DetailPanel>
          )}
        </>
      )}
    </AppShell>
  );
}

function StatCard({
  label,
  value,
  accent,
  active,
  onClick,
}: {
  label: string;
  value: number | string;
  accent: string;
  active: boolean;
  onClick: () => void;
}) {
  const colors: Record<string, string> = {
    amber: 'bg-amber-50 border-amber-200 hover:border-amber-400',
    red: 'bg-red-50 border-red-200 hover:border-red-400',
    emerald: 'bg-emerald-50 border-emerald-200 hover:border-emerald-400',
    blue: 'bg-indigo-50 border-indigo-200 hover:border-indigo-400',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-xl border-2 p-4 text-left min-h-[44px] transition-shadow',
        colors[accent],
        active && 'ring-2 ring-indigo-500 border-indigo-500 shadow-md'
      )}
    >
      <p className="text-xs text-slate-600">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </button>
  );
}

function DetailPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card variant="elevated" className="p-4 mb-4">
      <h2 className="font-semibold text-lg mb-3 text-slate-900">{title}</h2>
      {children}
    </Card>
  );
}

function SubLotList({
  items,
  emptyText,
  showWait,
}: {
  items: SubLot[];
  emptyText: string;
  showWait?: boolean;
}) {
  if (items.length === 0) return <EmptyState title={emptyText} />;
  return (
    <ul className="space-y-2">
      {items.map((s) => (
        <li key={s.id} className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 flex justify-between items-start gap-2">
          <div>
            <div className="font-medium">{s.sub_lot_code}</div>
            <p className="text-sm text-slate-600">
              {s.sku_name}
              {s.location_name ? ` · ${s.location_name}` : ''}
            </p>
            <p className="text-sm text-slate-500 mt-1">In: {formatDateTime(s.in_time)}</p>
            <p className="text-sm text-slate-500">Out: {formatDateTime(s.out_time)}</p>
            {showWait && s.wait_minutes != null && (
              <p className="text-sm text-amber-800 mt-1">Waiting {s.wait_minutes} min</p>
            )}
          </div>
          <StatusBadge status={s.status} />
        </li>
      ))}
    </ul>
  );
}

function TodayInspectionList({ items, emptyText }: { items: TodayInspectionItem[]; emptyText: string }) {
  if (items.length === 0) {
    return emptyText ? <EmptyState title={emptyText} /> : null;
  }
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={`${item.sub_lot_id}-${item.submitted_at}`} className="rounded-lg border border-slate-200 p-3 bg-white">
          <div className="flex justify-between items-start gap-2">
            <div>
              <div className="font-medium">{item.sub_lot_code}</div>
              <p className="text-sm text-slate-600">{item.sku_name}</p>
            </div>
            <StatusBadge status={item.status} />
          </div>
          <p className="text-sm mt-2 text-slate-600">
            Aw {item.aw ?? '—'} · {formatDateTime(item.submitted_at)}
          </p>
          {item.fail_reason && (
            <p className="text-sm text-red-700 mt-1">{item.fail_reason}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

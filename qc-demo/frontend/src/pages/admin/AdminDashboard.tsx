import { useState } from 'react';
import { api, DashboardSummary, SubLot, TodayInspectionItem } from '../../api/client';
import { AppShell } from '../../components/AppShell';
import { StatusBadge } from '../../components/StatusBadge';
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
    <AppShell variant="admin" title="Dashboard">
      <p className="text-xs text-slate-500 mb-4">
        Click a metric card for details · auto-refresh every 4s
        {!pollingEnabled ? ' (paused while disposing)' : ''}
      </p>
      {msg && <p className="text-emerald-700 bg-emerald-50 p-3 rounded-lg mb-4">{msg}</p>}
      {error && <p className="text-red-600 mb-4">{error}</p>}

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
                <p className="text-slate-500">No holds</p>
              ) : (
                <>
                  <ul className="space-y-2 mb-4">
                    {data.holds.map((h) => (
                      <li key={h.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedHold(h);
                            setMsg('');
                          }}
                          className={cn(
                            'w-full text-left bg-white rounded-xl border-2 p-4 min-h-[44px]',
                            selectedHold?.id === h.id ? 'border-blue-500' : 'border-red-200'
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
                  {selectedHold && (
                    <div className="bg-white rounded-xl border p-4 space-y-3">
                      <p className="font-medium">Dispose: {selectedHold.sub_lot_code}</p>
                      {selectedHold.hold_reason && (
                        <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg p-3">
                          {selectedHold.hold_reason}
                        </p>
                      )}
                      <select
                        className="w-full border rounded-lg px-3 py-3 min-h-[44px]"
                        value={dispType}
                        onChange={(e) => setDispType(e.target.value)}
                      >
                        {DISP_TYPES.map((d) => (
                          <option key={d.value} value={d.value}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                      <textarea
                        className="w-full border rounded-lg px-3 py-3 min-h-[80px]"
                        placeholder="Remarks"
                        value={dispRemark}
                        onChange={(e) => setDispRemark(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={submitDisposition}
                          className="flex-1 bg-red-600 text-white py-3 rounded-xl min-h-[48px] font-medium"
                        >
                          Confirm disposition
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedHold(null)}
                          className="px-4 py-3 rounded-xl border min-h-[48px]"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </>
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
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-slate-600">Pass rate</p>
                  <p className="text-2xl font-bold text-blue-800">
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
                <p className="text-slate-500">No inspections recorded today</p>
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
    blue: 'bg-blue-50 border-blue-200 hover:border-blue-400',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-xl border-2 p-4 text-left min-h-[44px] transition-shadow',
        colors[accent],
        active && 'ring-2 ring-blue-500 border-blue-500 shadow-md'
      )}
    >
      <p className="text-xs text-slate-600">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </button>
  );
}

function DetailPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border rounded-xl p-4 mb-4">
      <h2 className="font-semibold text-lg mb-3">{title}</h2>
      {children}
    </section>
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
  if (items.length === 0) return <p className="text-slate-500">{emptyText}</p>;
  return (
    <ul className="space-y-2">
      {items.map((s) => (
        <li key={s.id} className="border rounded-lg p-3 flex justify-between items-start gap-2">
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
    return emptyText ? <p className="text-slate-500">{emptyText}</p> : null;
  }
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={`${item.sub_lot_id}-${item.submitted_at}`} className="border rounded-lg p-3">
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

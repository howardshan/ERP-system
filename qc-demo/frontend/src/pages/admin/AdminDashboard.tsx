import { useState } from 'react';
import { api, DashboardSummary, SubLot, TodayInspectionItem } from '../../api/client';
import { AppShell } from '../../components/AppShell';
import { StatusBadge } from '../../components/StatusBadge';
import { usePolling } from '../../hooks/usePolling';
import { cn, formatDateTime } from '../../lib/utils';

type Panel = 'pending' | 'hold' | 'passed' | 'rate';

const DISP_TYPES = [
  { value: 'rework', label: '返烘' },
  { value: 'grind', label: '粉碎回线' },
  { value: 'scrap', label: '报废' },
  { value: 'concession', label: '让步' },
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
      setMsg(`已处置：${selectedHold.sub_lot_code}`);
      setSelectedHold(null);
      setDispRemark('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '处置失败');
    }
  };

  return (
    <AppShell variant="admin" title="管理看板">
      <p className="text-xs text-slate-500 mb-4">
        点击指标卡片查看明细；每 4 秒自动刷新{!pollingEnabled ? '（处置中已暂停）' : ''}
      </p>
      {msg && <p className="text-emerald-700 bg-emerald-50 p-3 rounded-lg mb-4">{msg}</p>}
      {error && <p className="text-red-600 mb-4">{error}</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <StatCard
              label="待检"
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
              label="今日合格"
              value={data.today_passed}
              accent="emerald"
              active={panel === 'passed'}
              onClick={() => togglePanel('passed')}
            />
            <StatCard
              label="合格率"
              value={data.pass_rate != null ? `${data.pass_rate}%` : '—'}
              accent="blue"
              active={panel === 'rate'}
              onClick={() => togglePanel('rate')}
            />
          </div>

          {data.longest_wait_minutes != null && panel !== 'pending' && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
              最长待检等待：{data.longest_wait_minutes} 分钟
            </p>
          )}

          {panel === 'pending' && (
            <DetailPanel title="待检子批">
              {data.longest_wait_minutes != null && (
                <p className="text-sm text-amber-800 mb-3">最长等待：{data.longest_wait_minutes} 分钟</p>
              )}
              <SubLotList items={data.pending_items} emptyText="当前无待检子批" showWait />
            </DetailPanel>
          )}

          {panel === 'hold' && (
            <DetailPanel title="Hold 子批 · 可在此处置">
              {data.holds.length === 0 ? (
                <p className="text-slate-500">当前无 Hold</p>
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
                            <div>
                              <div className="font-semibold">{h.sub_lot_code}</div>
                              <p className="text-sm text-slate-600">{h.sku_name}</p>
                            </div>
                            <StatusBadge status={h.status} />
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {selectedHold && (
                    <div className="bg-white rounded-xl border p-4 space-y-3">
                      <p className="font-medium">处置：{selectedHold.sub_lot_code}</p>
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
                        placeholder="备注"
                        value={dispRemark}
                        onChange={(e) => setDispRemark(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={submitDisposition}
                          className="flex-1 bg-red-600 text-white py-3 rounded-xl min-h-[48px] font-medium"
                        >
                          确认处置
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedHold(null)}
                          className="px-4 py-3 rounded-xl border min-h-[48px]"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </DetailPanel>
          )}

          {panel === 'passed' && (
            <DetailPanel title="今日检验合格">
              <TodayInspectionList items={data.today_passed_items} emptyText="今日尚无合格记录" />
            </DetailPanel>
          )}

          {panel === 'rate' && (
            <DetailPanel title="今日检验概况">
              <div className="grid sm:grid-cols-3 gap-3 mb-4 text-sm">
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                  <p className="text-slate-600">合格</p>
                  <p className="text-2xl font-bold text-emerald-800">{data.today_passed}</p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-slate-600">不合格</p>
                  <p className="text-2xl font-bold text-red-800">{data.today_failed}</p>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-slate-600">合格率</p>
                  <p className="text-2xl font-bold text-blue-800">
                    {data.pass_rate != null ? `${data.pass_rate}%` : '—'}
                  </p>
                </div>
              </div>
              {data.today_failed > 0 && (
                <>
                  <h3 className="font-medium text-red-800 mb-2">今日不合格（已 Hold）</h3>
                  <TodayInspectionList items={data.today_failed_items} emptyText="" />
                </>
              )}
              {data.today_passed === 0 && data.today_failed === 0 && (
                <p className="text-slate-500">今日尚无检验记录</p>
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
            <p className="text-sm text-slate-500 mt-1">出房：{formatDateTime(s.out_time)}</p>
            {showWait && s.wait_minutes != null && (
              <p className="text-sm text-amber-800 mt-1">已等待 {s.wait_minutes} 分钟</p>
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
        </li>
      ))}
    </ul>
  );
}

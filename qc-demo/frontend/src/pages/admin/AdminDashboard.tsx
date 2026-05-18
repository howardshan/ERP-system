import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { AppShell } from '../../components/AppShell';
import { usePolling } from '../../hooks/usePolling';

export function AdminDashboard() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.dashboard>> | null>(null);
  const [lots, setLots] = useState<Array<{ id: string; lot_number: string }>>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.productionLots().then((l) => setLots(l.map((x) => ({ id: x.id, lot_number: x.lot_number }))));
  }, []);

  const load = () => {
    api
      .dashboard()
      .then(setData)
      .catch((e) => setError(e.message));
  };

  usePolling(load, 4000);

  return (
    <AppShell variant="admin" title="管理看板">
      <p className="text-xs text-slate-500 mb-4">每 4 秒自动刷新</p>
      {error && <p className="text-red-600">{error}</p>}
      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <StatCard label="待检" value={data.pending_count} accent="amber" />
            <StatCard label="Hold" value={data.hold_count} accent="red" />
            <StatCard label="今日合格" value={data.today_passed} accent="emerald" />
            <StatCard
              label="合格率"
              value={data.pass_rate != null ? `${data.pass_rate}%` : '—'}
              accent="blue"
            />
          </div>
          {data.longest_wait_minutes != null && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
              最长待检等待：{data.longest_wait_minutes} 分钟
            </p>
          )}
          <h2 className="font-semibold mb-2">Hold 列表</h2>
          <ul className="space-y-2">
            {data.holds.map((h) => (
              <li key={h.id} className="bg-white border-2 border-red-200 rounded-xl p-3 flex justify-between items-center">
                <div>
                  <div className="font-medium">{h.sub_lot_code}</div>
                  <div className="text-sm text-slate-500">{h.sku_name}</div>
                </div>
                <Link to="/admin/holds" className="text-red-700 font-medium min-h-[44px] flex items-center px-2">
                  处置 →
                </Link>
              </li>
            ))}
            {data.holds.length === 0 && <p className="text-slate-500 text-sm">当前无 Hold</p>}
          </ul>
          <h2 className="font-semibold mt-6 mb-2">批次追溯</h2>
          <ul className="space-y-1">
            {lots.map((lot) => (
              <li key={lot.id}>
                <Link to={`/admin/trace/${lot.id}`} className="text-blue-600 min-h-[44px] inline-flex items-center">
                  {lot.lot_number} →
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </AppShell>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent: string;
}) {
  const colors: Record<string, string> = {
    amber: 'bg-amber-50 border-amber-200',
    red: 'bg-red-50 border-red-200',
    emerald: 'bg-emerald-50 border-emerald-200',
    blue: 'bg-blue-50 border-blue-200',
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[accent]}`}>
      <p className="text-xs text-slate-600">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}

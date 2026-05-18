import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { AppShell } from '../../components/AppShell';
import { StatusBadge } from '../../components/StatusBadge';
import { formatDateTime } from '../../lib/utils';

export function TracePage() {
  const { lotId } = useParams<{ lotId: string }>();
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof api.productionLotDetail>> | null>(null);

  useEffect(() => {
    if (lotId) api.productionLotDetail(lotId).then(setDetail);
  }, [lotId]);

  if (!detail) return <AppShell variant="admin">加载中…</AppShell>;

  return (
    <AppShell variant="admin" title={`追溯 · ${detail.lot.lot_number}`}>
      <p className="text-slate-600 mb-4">{detail.lot.sku_name}</p>

      <h2 className="font-semibold mb-2">烘干子批</h2>
      <ul className="space-y-2 mb-6">
        {detail.sub_lots.map((s) => (
          <li key={s.id} className="bg-white border rounded-xl p-3">
            <div className="flex justify-between items-center mb-1">
              <span className="font-medium">{s.sub_lot_code}</span>
              <StatusBadge status={s.status} />
            </div>
            <p className="text-sm text-slate-600">
              进房 {formatDateTime(s.in_time)} · 出房 {formatDateTime(s.out_time)}
            </p>
          </li>
        ))}
      </ul>

      <h2 className="font-semibold mb-2">质量事件</h2>
      <ul className="space-y-1 text-sm">
        {detail.events.map((ev, i) => (
          <li key={i} className="bg-slate-50 rounded p-2">
            {ev.event_type} · {new Date(ev.created_at).toLocaleString('zh-CN')}
          </li>
        ))}
        {detail.events.length === 0 && <p className="text-slate-500">暂无事件</p>}
      </ul>

      <Link to="/admin/trace" className="inline-block mt-6 text-blue-600 min-h-[44px] flex items-center">
        返回批次列表
      </Link>
    </AppShell>
  );
}

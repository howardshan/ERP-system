import { useEffect, useState } from 'react';
import { api, SubLot } from '../../api/client';
import { Layout } from '../../components/Layout';
import { StatusBadge } from '../../components/StatusBadge';

const DISP_TYPES = [
  { value: 'rework', label: '返烘' },
  { value: 'grind', label: '粉碎回线' },
  { value: 'scrap', label: '报废' },
  { value: 'concession', label: '让步' },
];

export function HoldsPage() {
  const [holds, setHolds] = useState<SubLot[]>([]);
  const [selected, setSelected] = useState<SubLot | null>(null);
  const [type, setType] = useState('rework');
  const [remark, setRemark] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const load = () =>
    api.dashboard().then((d) => {
      setHolds(d.holds);
    });

  useEffect(() => {
    load();
  }, []);

  const submit = async () => {
    if (!selected) return;
    try {
      await api.disposition({
        drying_sub_lot_id: selected.id,
        type,
        remark: remark || undefined,
      });
      setMsg(`已处置：${selected.sub_lot_code}`);
      setSelected(null);
      setRemark('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '处置失败');
    }
  };

  return (
    <Layout nav={[{ to: '/admin', label: '看板' }]}>
      <h1 className="text-2xl font-bold mb-4">Hold 处置</h1>
      {msg && <p className="text-emerald-700 bg-emerald-50 p-3 rounded-lg mb-4">{msg}</p>}
      {error && <p className="text-red-600 mb-4">{error}</p>}

      <ul className="space-y-2 mb-6">
        {holds.map((h) => (
          <li key={h.id}>
            <button
              type="button"
              onClick={() => setSelected(h)}
              className={`w-full text-left bg-white rounded-xl border-2 p-4 min-h-[44px] ${
                selected?.id === h.id ? 'border-blue-500' : 'border-red-200'
              }`}
            >
              <div className="flex justify-between">
                <span className="font-semibold">{h.sub_lot_code}</span>
                <StatusBadge status={h.status} />
              </div>
            </button>
          </li>
        ))}
      </ul>

      {selected && (
        <div className="bg-white rounded-xl border p-4 space-y-3">
          <p className="font-medium">处置：{selected.sub_lot_code}</p>
          <select className="w-full border rounded-lg px-3 py-3" value={type} onChange={(e) => setType(e.target.value)}>
            {DISP_TYPES.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
          <textarea
            className="w-full border rounded-lg px-3 py-3 min-h-[80px]"
            placeholder="备注"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
          />
          <button type="button" onClick={submit} className="w-full bg-red-600 text-white py-3 rounded-xl min-h-[48px] font-medium">
            确认处置
          </button>
        </div>
      )}
    </Layout>
  );
}

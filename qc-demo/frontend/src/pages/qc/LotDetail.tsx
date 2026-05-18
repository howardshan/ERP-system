import { FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, SubLot } from '../../api/client';
import { Layout } from '../../components/Layout';
import { StatusBadge } from '../../components/StatusBadge';

export function LotDetail() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<{
    lot: { lot_number: string; lot_barcode: string; sku_name?: string };
    sub_lots: SubLot[];
  } | null>(null);
  const [locations, setLocations] = useState<Array<{ id: string; display_name: string }>>([]);
  const [locationId, setLocationId] = useState('');
  const [error, setError] = useState('');

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

  const registerSubLot = async (e: FormEvent) => {
    e.preventDefault();
    if (!id) return;
    const now = new Date().toISOString();
    try {
      await api.createSubLot({
        production_lot_id: id,
        location_id: locationId,
        in_time: now,
        out_time: now,
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '登记失败');
    }
  };

  if (!detail) return <Layout>加载中…</Layout>;

  return (
    <Layout nav={[{ to: '/qc/lots', label: '返回列表' }]}>
      <h1 className="text-2xl font-bold mb-1">{detail.lot.lot_number}</h1>
      <p className="text-slate-600 mb-4">{detail.lot.sku_name}</p>
      {error && <p className="text-red-600 mb-2">{error}</p>}

      <form onSubmit={registerSubLot} className="bg-white rounded-xl border p-4 mb-6 space-y-3">
        <h2 className="font-semibold">登记烘干子批（出房 → 待检）</h2>
        <select className="w-full border rounded-lg px-3 py-3 min-h-[44px]" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.display_name}
            </option>
          ))}
        </select>
        <button type="submit" className="w-full bg-blue-600 text-white py-3 rounded-xl min-h-[48px] font-medium">
          出房登记
        </button>
      </form>

      <h2 className="font-semibold mb-2">子批列表</h2>
      <ul className="space-y-2">
        {detail.sub_lots.map((s) => (
          <li key={s.id} className="bg-white rounded-xl border p-3 flex justify-between items-center gap-2">
            <div>
              <div className="font-medium">{s.sub_lot_code}</div>
              <div className="text-sm text-slate-500">{s.location_name}</div>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={s.status} />
              {(s.status === 'pending' || s.status === 'inspecting') && (
                <Link to={`/qc/inspect/${s.id}`} className="text-blue-600 font-medium min-h-[44px] flex items-center px-2">
                  检验
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Layout>
  );
}

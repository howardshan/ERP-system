import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ProductionLot } from '../../api/client';
import { Layout } from '../../components/Layout';

export function LotsList() {
  const [lots, setLots] = useState<ProductionLot[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [skus, setSkus] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [lotBarcode, setLotBarcode] = useState('');
  const [woBarcode, setWoBarcode] = useState('');
  const [skuId, setSkuId] = useState('');
  const [error, setError] = useState('');

  const load = () => api.productionLots().then(setLots).catch((e) => setError(e.message));

  useEffect(() => {
    load();
    api.skus().then((s) => {
      setSkus(s);
      if (s[0]) setSkuId(s[0].id);
    });
  }, []);

  const fillDemo = () => {
    setLotBarcode('LOT-DEMO-001');
    setWoBarcode('WO-DEMO-001');
  };

  const create = async () => {
    try {
      await api.createProductionLot({
        lot_barcode: lotBarcode,
        work_order_barcode: woBarcode,
        sku_id: skuId,
      });
      setShowForm(false);
      setLotBarcode('');
      setWoBarcode('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
    }
  };

  return (
    <Layout nav={[{ to: '/qc', label: '首页' }, { to: '/qc/pending', label: '待检' }]}>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">生产批</h1>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 text-white px-4 py-2 rounded-xl min-h-[44px] font-medium"
        >
          新建
        </button>
      </div>
      {error && <p className="text-red-600 mb-2">{error}</p>}
      {showForm && (
        <div className="bg-white rounded-xl border p-4 mb-4 space-y-3">
          <button type="button" onClick={fillDemo} className="text-sm text-blue-600 underline min-h-[44px]">
            模拟扫码填入 DEMO 码
          </button>
          <input
            placeholder="批次条码"
            className="w-full border rounded-lg px-3 py-3"
            value={lotBarcode}
            onChange={(e) => setLotBarcode(e.target.value)}
          />
          <input
            placeholder="工单条码"
            className="w-full border rounded-lg px-3 py-3"
            value={woBarcode}
            onChange={(e) => setWoBarcode(e.target.value)}
          />
          <select className="w-full border rounded-lg px-3 py-3" value={skuId} onChange={(e) => setSkuId(e.target.value)}>
            {skus.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={create} className="w-full bg-emerald-600 text-white py-3 rounded-xl min-h-[48px]">
            保存
          </button>
        </div>
      )}
      <ul className="space-y-3">
        {lots.map((lot) => (
          <li key={lot.id}>
            <Link
              to={`/qc/lots/${lot.id}`}
              className="block bg-white rounded-xl border p-4 hover:border-blue-400 min-h-[44px]"
            >
              <div className="font-semibold">{lot.lot_number}</div>
              <p className="text-sm text-slate-600">
                {lot.sku_name} · {lot.lot_barcode}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </Layout>
  );
}

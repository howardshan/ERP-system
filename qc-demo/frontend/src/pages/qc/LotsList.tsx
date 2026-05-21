import { useEffect, useState } from 'react';
import { ChevronRight, Package } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, ProductionLot } from '../../api/client';
import { AppShell } from '../../components/AppShell';
import { LotSubLotSummary } from '../../components/LotSubLotSummary';
import { Alert, Button, Card, EmptyState, Field, Input, PageHeader, Select } from '../../components/ui';
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
      setError(e instanceof Error ? e.message : 'Create failed');
    }
  };

  return (
    <AppShell variant="qc">
      <PageHeader
        title="Production Lots"
        action={
          <Button variant={showForm ? 'secondary' : 'primary'} tone="qc" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : 'New lot'}
          </Button>
        }
      />
      {error && (
        <div className="mb-4">
          <Alert variant="error">{error}</Alert>
        </div>
      )}
      {showForm && (
        <Card variant="elevated" className="p-4 mb-4 space-y-3 border-2 border-teal-200">
          <Button type="button" variant="ghost" tone="qc" onClick={fillDemo} className="!min-h-[36px] text-sm">
            Fill DEMO barcodes (simulate scan)
          </Button>
          <Field label="Lot barcode">
            <Input
              className="font-mono"
              placeholder="Lot barcode"
              value={lotBarcode}
              onChange={(e) => setLotBarcode(e.target.value)}
            />
          </Field>
          <Field label="Work order barcode">
            <Input
              className="font-mono"
              placeholder="Work order barcode"
              value={woBarcode}
              onChange={(e) => setWoBarcode(e.target.value)}
            />
          </Field>
          <Field label="Product (SKU)">
            <Select value={skuId} onChange={(e) => setSkuId(e.target.value)}>
              {skus.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="button" variant="primary" tone="qc" fullWidth size="lg" onClick={create}>
            Save
          </Button>
        </Card>
      )}
      <ul className="space-y-3">
        {lots.map((lot) => (
          <li key={lot.id}>
            <Link to={`/qc/lots/${lot.id}`} className="block group">
              <Card variant="interactive" className="p-4 min-h-[44px] hover:border-teal-200">
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <div className="font-semibold text-lg text-slate-900 group-hover:text-teal-800">
                      {lot.lot_number}
                    </div>
                    <p className="text-sm text-slate-600">
                      {lot.sku_name} · {lot.lot_barcode}
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-slate-300 group-hover:text-teal-600 transition-colors" />
                </div>
                <LotSubLotSummary counts={lot.sub_lot_counts} />
              </Card>
            </Link>
          </li>
        ))}
        {lots.length === 0 && !showForm && (
          <EmptyState
            icon={Package}
            title="No production lots"
            description="Register a new lot to begin sub-lot check-in."
          />
        )}
      </ul>
    </AppShell>
  );
}

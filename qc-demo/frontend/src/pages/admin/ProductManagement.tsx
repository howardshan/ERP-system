import { FormEvent, useEffect, useState } from 'react';
import { api, Product, ProductInput } from '../../api/client';
import { AppShell } from '../../components/AppShell';

const emptyForm = (): ProductInput => ({
  code: '',
  name: '',
  standard_drying_minutes: 240,
  template: { item_name: '水活 Aw', unit: null, lower_limit: 0.65, upper_limit: 0.75 },
});

export function ProductManagement() {
  const [products, setProducts] = useState<Product[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductInput>(emptyForm());
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => api.products().then(setProducts).catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  const startCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setShowForm(true);
    setMsg('');
  };

  const startEdit = (p: Product) => {
    const t = p.templates[0];
    setEditingId(p.id);
    setForm({
      code: p.code,
      name: p.name,
      standard_drying_minutes: p.standard_drying_minutes ?? undefined,
      template: t
        ? {
            item_name: t.item_name,
            unit: t.unit,
            lower_limit: t.lower_limit,
            upper_limit: t.upper_limit,
          }
        : emptyForm().template,
    });
    setShowForm(true);
    setMsg('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (editingId) {
        await api.updateProduct(editingId, form);
        setMsg('产品已更新');
      } else {
        await api.createProduct(form);
        setMsg('产品已创建');
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    }
  };

  const remove = async (id: string, code: string) => {
    if (!confirm(`确定删除产品 ${code}？`)) return;
    try {
      await api.deleteProduct(id);
      setMsg('已删除');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  return (
    <AppShell variant="admin" title="产品管理">
      <p className="text-slate-600 mb-4 text-sm">
        维护 SKU、参考烘干时长（SOP）及烘干后检验限值。现场子批的实际进/出房时间在生产批管理中登记。
      </p>
      {msg && <p className="text-emerald-700 bg-emerald-50 p-3 rounded-lg mb-4">{msg}</p>}
      {error && <p className="text-red-600 mb-4">{error}</p>}

      <button
        type="button"
        onClick={startCreate}
        className="mb-4 bg-blue-600 text-white px-4 py-2 rounded-xl min-h-[44px] font-medium"
      >
        新增产品
      </button>

      {showForm && (
        <form onSubmit={submit} className="bg-white border rounded-xl p-4 mb-6 space-y-4">
          <h2 className="font-semibold">{editingId ? '编辑产品' : '新增产品'}</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium">SKU 编码</span>
              <input
                className="mt-1 w-full border rounded-lg px-3 py-2 min-h-[44px]"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">产品名称</span>
              <input
                className="mt-1 w-full border rounded-lg px-3 py-2 min-h-[44px]"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-medium">参考烘干时长（分钟，SOP）</span>
            <input
              type="number"
              min={1}
              className="mt-1 w-full border rounded-lg px-3 py-2 min-h-[44px]"
              value={form.standard_drying_minutes ?? ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  standard_drying_minutes: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
          </label>
          <fieldset className="border rounded-lg p-3 space-y-3">
            <legend className="text-sm font-semibold px-1">烘干后检验标准</legend>
            <label className="block">
              <span className="text-sm">检验项</span>
              <input
                className="mt-1 w-full border rounded-lg px-3 py-2"
                value={form.template.item_name}
                onChange={(e) =>
                  setForm({ ...form, template: { ...form.template, item_name: e.target.value } })
                }
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm">下限</span>
                <input
                  type="number"
                  step="0.01"
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                  value={form.template.lower_limit}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      template: { ...form.template, lower_limit: Number(e.target.value) },
                    })
                  }
                  required
                />
              </label>
              <label className="block">
                <span className="text-sm">上限</span>
                <input
                  type="number"
                  step="0.01"
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                  value={form.template.upper_limit}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      template: { ...form.template, upper_limit: Number(e.target.value) },
                    })
                  }
                  required
                />
              </label>
            </div>
          </fieldset>
          <div className="flex gap-2">
            <button type="submit" className="flex-1 bg-emerald-600 text-white py-3 rounded-xl min-h-[48px]">
              保存
            </button>
            <button
              type="button"
              className="px-4 py-3 rounded-xl border min-h-[48px]"
              onClick={() => setShowForm(false)}
            >
              取消
            </button>
          </div>
        </form>
      )}

      <ul className="space-y-3">
        {products.map((p) => {
          const t = p.templates[0];
          return (
            <li key={p.id} className="bg-white border rounded-xl p-4">
              <div className="flex justify-between items-start gap-2">
                <div>
                  <div className="font-semibold text-lg">{p.name}</div>
                  <div className="text-sm text-slate-500">{p.code}</div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button type="button" className="text-blue-600 min-h-[44px] px-2" onClick={() => startEdit(p)}>
                    编辑
                  </button>
                  <button type="button" className="text-red-600 min-h-[44px] px-2" onClick={() => remove(p.id, p.code)}>
                    删除
                  </button>
                </div>
              </div>
              <dl className="mt-3 grid sm:grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-slate-500">参考烘干</dt>
                  <dd>{p.standard_drying_minutes ? `${p.standard_drying_minutes} 分钟` : '未设置'}</dd>
                </div>
                {t && (
                  <div>
                    <dt className="text-slate-500">{t.item_name} 合格范围</dt>
                    <dd>
                      [{t.lower_limit}, {t.upper_limit}]
                    </dd>
                  </div>
                )}
              </dl>
            </li>
          );
        })}
      </ul>
    </AppShell>
  );
}

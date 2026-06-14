import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, X, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { Combobox, type ComboOption } from '../../components/ui/Combobox';
import { usePermissions } from '../../contexts/PermissionContext';
import { PermissionDenied } from '../qc/components/PermissionDenied';
import { listProducts, listMachines, type ProductOption, type MachineOption } from '../../services/productionRunApi';
import {
  listWorkOrders, createWorkOrder, updateWorkOrder, closeWorkOrder,
  type WorkOrderRow, type WorkOrderInput, type WorkOrderStatus,
} from '../../services/productionWorkOrderApi';

const ALL_STATUSES: WorkOrderStatus[] = ['open', 'in_progress', 'closed', 'cancelled'];
const ACTIVE_STATUSES: WorkOrderStatus[] = ['open', 'in_progress'];

interface Draft {
  work_order_no: string; product_id: string; machine_id: string;
  planned_qty: string; planned_date: string; status: WorkOrderStatus; note: string;
}
const emptyDraft = (): Draft => ({
  work_order_no: '', product_id: '', machine_id: '',
  planned_qty: '', planned_date: '', status: 'open', note: '',
});
const rowToDraft = (r: WorkOrderRow): Draft => ({
  work_order_no: r.work_order_no,
  product_id: r.product_id ?? '',
  machine_id: r.machine_id ?? '',
  planned_qty: r.planned_qty == null ? '' : String(r.planned_qty),
  planned_date: r.planned_date ?? '',
  status: r.status,
  note: r.note ?? '',
});

const numOrNull = (s: string): number | null => {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

function StatusBadge({ status }: { status: WorkOrderStatus }) {
  const { t } = useTranslation('production');
  const tone: Record<WorkOrderStatus, string> = {
    open: 'bg-blue-50 text-blue-700',
    in_progress: 'bg-amber-50 text-amber-700',
    closed: 'bg-slate-100 text-slate-500',
    cancelled: 'bg-red-50 text-red-600',
  };
  const label: Record<WorkOrderStatus, string> = {
    open: t('workOrder.statusOpen'),
    in_progress: t('workOrder.statusInProgress'),
    closed: t('workOrder.statusClosed'),
    cancelled: t('workOrder.statusCancelled'),
  };
  return <span className={cn('inline-block px-1.5 py-0.5 rounded text-xs font-semibold', tone[status])}>{label[status]}</span>;
}

export default function WorkOrderPage() {
  const { t } = useTranslation('production');
  const { can } = usePermissions();
  const canView = can('production', 'work_order', 'view');
  const canCreate = can('production', 'work_order', 'create');
  const canEdit = can('production', 'work_order', 'edit');
  const canClose = can('production', 'work_order', 'close');

  const [showAll, setShowAll] = useState(false);
  const [rows, setRows] = useState<WorkOrderRow[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [machines, setMachines] = useState<MachineOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState<'new' | string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());

  useEffect(() => {
    listProducts().then(setProducts).catch((e) => setError(e.message));
    listMachines().then(setMachines).catch((e) => setError(e.message));
  }, []);

  const load = () => {
    if (!canView) return;
    setLoading(true);
    listWorkOrders(showAll ? ALL_STATUSES : ACTIVE_STATUSES)
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    setDrawer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAll, canView]);

  const productOpts = useMemo<ComboOption[]>(
    () => products.map((p) => ({ value: p.id, label: p.item_number, hint: p.description ?? undefined })),
    [products]);
  const machineOpts = useMemo<ComboOption[]>(
    () => machines.map((m) => ({ value: m.id, label: m.code })), [machines]);

  if (!canView) {
    return <PermissionDenied permission="production.work_order.view" feature={t('workOrder.feature')} />;
  }

  const openNew = () => { setError(''); setMsg(''); setDraft(emptyDraft()); setDrawer('new'); };
  const openEdit = (r: WorkOrderRow) => { setError(''); setMsg(''); setDraft(rowToDraft(r)); setDrawer(r.id); };
  const close = () => { setDrawer(null); setDraft(emptyDraft()); setError(''); };

  const buildInput = (): WorkOrderInput | null => {
    if (!draft.work_order_no.trim()) { setError(t('workOrder.errWorkOrderNo')); return null; }
    return {
      work_order_no: draft.work_order_no.trim(),
      product_id: draft.product_id || null,
      machine_id: draft.machine_id || null,
      planned_qty: numOrNull(draft.planned_qty),
      planned_date: draft.planned_date || null,
      status: draft.status,
      note: draft.note.trim() || null,
    };
  };

  const save = async () => {
    const input = buildInput();
    if (!input) return;
    setBusy(true); setError('');
    try {
      if (drawer && drawer !== 'new') await updateWorkOrder(drawer, input);
      else await createWorkOrder(input);
      setMsg(t('workOrder.saved'));
      close();
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doClose = async (id: string) => {
    if (!window.confirm(t('workOrder.closeConfirm'))) return;
    setBusy(true); setError('');
    try {
      await closeWorkOrder(id);
      setMsg(t('workOrder.closed'));
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const th = 'px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap';
  const td = 'px-3 py-2.5 text-sm text-slate-700';
  const inputCls = 'w-full border border-slate-300 rounded-lg px-2.5 h-9 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400';

  return (
    <div className="p-6 max-w-6xl">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-slate-900">{t('workOrder.title')}</h1>
        <p className="text-slate-600 text-sm mt-0.5">{t('workOrder.subtitle')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-4 mb-3">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          {t('workOrder.showAll')}
        </label>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-slate-500">{t('workOrder.rowCount', { count: rows.length })}</span>
          {canCreate && (
            <button onClick={openNew}
              className="flex items-center gap-1.5 px-4 h-9 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold">
              <Plus size={14} /> {t('workOrder.addWorkOrder')}
            </button>
          )}
        </div>
      </div>

      {msg && <p className="text-emerald-700 bg-emerald-50 p-2 rounded-lg mb-3 text-sm">{msg}</p>}
      {error && !drawer && <p className="text-red-600 bg-red-50 p-2 rounded-lg mb-3 text-sm">{error}</p>}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className={cn(th, 'text-left')}>{t('workOrder.colWorkOrderNo')}</th>
                <th className={cn(th, 'text-left')}>{t('workOrder.colProduct')}</th>
                <th className={cn(th, 'text-left')}>{t('workOrder.colMachine')}</th>
                <th className={cn(th, 'text-right')}>{t('workOrder.colPlannedQty')}</th>
                <th className={cn(th, 'text-left')}>{t('workOrder.colPlannedDate')}</th>
                <th className={cn(th, 'text-left')}>{t('workOrder.colStatus')}</th>
                <th className={cn(th, 'text-right w-24')}>{t('workOrder.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => (canEdit ? openEdit(r) : undefined)}>
                  <td className={cn(td, 'font-mono font-medium whitespace-nowrap')}>{r.work_order_no}</td>
                  <td className={cn(td, 'max-w-[280px] truncate')} title={r.description ?? ''}>
                    <span className="font-mono text-xs text-slate-400 mr-1.5">{r.item_number ?? '—'}</span>
                    {r.description ?? ''}
                  </td>
                  <td className={cn(td, 'whitespace-nowrap')}>{r.machine_code ?? '—'}</td>
                  <td className={cn(td, 'text-right tabular-nums')}>{r.planned_qty == null ? '—' : r.planned_qty.toLocaleString()}</td>
                  <td className={cn(td, 'whitespace-nowrap')}>{r.planned_date ?? '—'}</td>
                  <td className={td}><StatusBadge status={r.status} /></td>
                  <td className={cn(td, 'text-right whitespace-nowrap')} onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      {canEdit && (
                        <button onClick={() => openEdit(r)} disabled={busy}
                          className="p-1.5 rounded hover:bg-slate-200 text-slate-500 disabled:opacity-40" title={t('workOrder.edit')}>
                          <Pencil size={14} />
                        </button>
                      )}
                      {canClose && r.status !== 'closed' && r.status !== 'cancelled' && (
                        <button onClick={() => doClose(r.id)} disabled={busy}
                          className="p-1.5 rounded hover:bg-emerald-100 text-emerald-600 disabled:opacity-40" title={t('workOrder.close')}>
                          <CheckCircle2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-400">{t('workOrder.empty')}</td></tr>
              )}
              {loading && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-400">{t('workOrder.loading')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {drawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-slate-900/30" onClick={close} />
          <aside className="relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
              <h2 className="text-base font-bold text-slate-900">
                {t(drawer === 'new' ? 'workOrder.drawerTitleNew' : 'workOrder.drawerTitleEdit')}
              </h2>
              <button onClick={close} className="p-1.5 rounded hover:bg-slate-100 text-slate-500" title={t('workOrder.close')}>
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {error && <p className="text-red-600 bg-red-50 p-2 rounded-lg text-sm">{error}</p>}

              <label className="block">
                <span className="text-xs font-medium text-slate-600">{t('workOrder.colWorkOrderNo')}<span className="text-red-500"> *</span></span>
                <input className={inputCls} value={draft.work_order_no}
                  onChange={(e) => setDraft({ ...draft, work_order_no: e.target.value })} />
              </label>

              <label className="block">
                <span className="text-xs font-medium text-slate-600">{t('workOrder.colProduct')}</span>
                <Combobox className={inputCls} value={draft.product_id}
                  onChange={(v) => setDraft({ ...draft, product_id: v })}
                  options={productOpts} placeholder={t('workOrder.selectPlaceholder')} />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">{t('workOrder.colMachine')}</span>
                  <Combobox className={inputCls} value={draft.machine_id}
                    onChange={(v) => setDraft({ ...draft, machine_id: v })}
                    options={machineOpts} placeholder={t('workOrder.selectPlaceholder')} />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">{t('workOrder.colPlannedQty')}</span>
                  <input className={inputCls} inputMode="decimal" value={draft.planned_qty}
                    onChange={(e) => setDraft({ ...draft, planned_qty: e.target.value })} />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">{t('workOrder.colPlannedDate')}</span>
                  <input type="date" className={inputCls} value={draft.planned_date}
                    onChange={(e) => setDraft({ ...draft, planned_date: e.target.value })} />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">{t('workOrder.colStatus')}</span>
                  <select className={inputCls} value={draft.status}
                    onChange={(e) => setDraft({ ...draft, status: e.target.value as WorkOrderStatus })}>
                    <option value="open">{t('workOrder.statusOpen')}</option>
                    <option value="in_progress">{t('workOrder.statusInProgress')}</option>
                    <option value="closed">{t('workOrder.statusClosed')}</option>
                    <option value="cancelled">{t('workOrder.statusCancelled')}</option>
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="text-xs font-medium text-slate-600">{t('workOrder.colNote')}</span>
                <textarea className={cn(inputCls, 'h-auto py-2 resize-none')} rows={2} value={draft.note}
                  onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 shrink-0">
              <button onClick={close} disabled={busy}
                className="px-4 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold">
                {t('workOrder.cancel')}
              </button>
              <button onClick={save} disabled={busy}
                className="px-5 h-9 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold disabled:opacity-50">
                {busy ? t('workOrder.saving') : t('workOrder.save')}
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

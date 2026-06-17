import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import { getISOWeek } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { Combobox, type ComboOption } from '../../components/ui/Combobox';
import { usePermissions } from '../../contexts/PermissionContext';
import { PermissionDenied } from '../qc/components/PermissionDenied';
import {
  listDailyReports, createDailyReport, updateDailyReport, deleteDailyReport,
  listProducts, listMachines, listOperators, listDowntimeReasons,
  type DailyReportRow, type DailyReportInput, type Shift,
  type ProductOption, type MachineOption, type OperatorOption, type DowntimeReasonOption,
} from '../../services/productionRunApi';
import { findWorkOrderByNo } from '../../services/productionWorkOrderApi';

const SHIFTS: Shift[] = ['1st', '2nd', '3rd'];

/** Draft form — numeric fields kept as strings so empty / partial entry works. */
interface Draft {
  machine_id: string; product_id: string; operator_id: string;
  work_order: string; work_order_id: string;
  cart_from: string; cart_to: string; output_qty: string; work_hours: string;
  defect_waste_lbs: string; down_hours: string; downtime_reason_id: string; note: string;
}

const emptyDraft = (): Draft => ({
  machine_id: '', product_id: '', operator_id: '',
  work_order: '', work_order_id: '',
  cart_from: '', cart_to: '', output_qty: '', work_hours: '',
  defect_waste_lbs: '', down_hours: '', downtime_reason_id: '', note: '',
});

const rowToDraft = (r: DailyReportRow): Draft => ({
  machine_id: r.machine_id,
  product_id: r.product_id ?? '',
  operator_id: r.operator_id ?? '',
  work_order: r.work_order ?? '',
  work_order_id: r.work_order_id ?? '',
  cart_from: r.cart_from == null ? '' : String(r.cart_from),
  cart_to: r.cart_to == null ? '' : String(r.cart_to),
  output_qty: String(r.output_qty ?? ''),
  work_hours: String(r.work_hours ?? ''),
  defect_waste_lbs: r.defect_waste_lbs == null ? '' : String(r.defect_waste_lbs),
  down_hours: r.down_hours == null ? '' : String(r.down_hours),
  downtime_reason_id: r.downtime_reason_id ?? '',
  note: r.note ?? '',
});

const numOrNull = (s: string): number | null => {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const intOrNull = (s: string): number | null => {
  const n = numOrNull(s);
  return n == null ? null : Math.trunc(n);
};
const fmt = (n: number | null | undefined, dp = 2): string =>
  n == null || !Number.isFinite(n) ? '—'
    : n.toLocaleString(undefined, { maximumFractionDigits: dp });

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function DailyReportPage() {
  const { t } = useTranslation('production');
  const { can } = usePermissions();
  const canView = can('production', 'daily_report', 'view');
  const canCreate = can('production', 'daily_report', 'create');
  const canEdit = can('production', 'daily_report', 'edit');
  const canDelete = can('production', 'daily_report', 'delete');

  const [date, setDate] = useState<string>(todayISO());
  const [shift, setShift] = useState<Shift>('1st');

  const [rows, setRows] = useState<DailyReportRow[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [machines, setMachines] = useState<MachineOption[]>([]);
  const [operators, setOperators] = useState<OperatorOption[]>([]);
  const [reasons, setReasons] = useState<DowntimeReasonOption[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  // Drawer: null = closed; 'new' = create; otherwise the row id being edited.
  const [drawer, setDrawer] = useState<'new' | string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());

  const productById = useMemo(() => {
    const m = new Map<string, ProductOption>();
    products.forEach((p) => m.set(p.id, p));
    return m;
  }, [products]);

  useEffect(() => {
    listProducts().then(setProducts).catch((e) => setError(e.message));
    listMachines().then(setMachines).catch((e) => setError(e.message));
    listOperators().then(setOperators).catch((e) => setError(e.message));
    listDowntimeReasons().then(setReasons).catch((e) => setError(e.message));
  }, []);

  const load = () => {
    if (!canView) return;
    setLoading(true);
    listDailyReports(date, shift)
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    setDrawer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, shift, canView]);

  if (!canView) {
    return <PermissionDenied permission="production.daily_report.view" feature={t('dailyReport.feature')} />;
  }

  // live preview of the 10 computed columns (mirrors the view / BR-P1)
  const preview = useMemo(() => {
    const p = draft.product_id ? productById.get(draft.product_id) : undefined;
    const output = numOrNull(draft.output_qty) ?? 0;
    const hours = numOrNull(draft.work_hours);
    const cf = intOrNull(draft.cart_from) ?? 0;
    const ct = intOrNull(draft.cart_to) ?? 0;
    const pcsHr = hours && hours > 0 ? output / hours : null;
    return {
      item_description: p?.description ?? null,
      standard_lbs_hr: p ? (p.pcs_lbs_per_hour ?? 0) : null,
      lbs_good_produced: (p?.bone_avg ?? 0) * output,
      runner_weight_pct: p ? (p.runner_avg ?? 0) : null,
      runner_regrind_lbs: (p?.runner_avg ?? 0) * output,
      pcs_lbs_per_hr: pcsHr,
      credit: pcsHr != null && p?.pcs_lbs_per_hour ? pcsHr / p.pcs_lbs_per_hour : null,
      total_carts: ct - cf + 1,
      week_num: date ? getISOWeek(new Date(date + 'T00:00:00')) : null,
    };
  }, [draft, productById, date]);

  const openNew = () => { setError(''); setMsg(''); setDraft(emptyDraft()); setDrawer('new'); };
  const openEdit = (r: DailyReportRow) => { setError(''); setMsg(''); setDraft(rowToDraft(r)); setDrawer(r.id); };
  const closeDrawer = () => { setDrawer(null); setDraft(emptyDraft()); setError(''); };

  const buildInput = (): DailyReportInput | null => {
    if (!draft.machine_id) { setError(t('dailyReport.errMachine')); return null; }
    if (!draft.operator_id) { setError(t('dailyReport.errOperator')); return null; }
    return {
      report_date: date, shift,
      machine_id: draft.machine_id,
      work_order_id: draft.work_order_id || null,
      product_id: draft.product_id || null,
      operator_id: draft.operator_id,
      work_order: draft.work_order.trim() || null,
      cart_from: intOrNull(draft.cart_from),
      cart_to: intOrNull(draft.cart_to),
      output_qty: numOrNull(draft.output_qty) ?? 0,
      work_hours: numOrNull(draft.work_hours) ?? 0,
      defect_waste_lbs: numOrNull(draft.defect_waste_lbs),
      down_hours: numOrNull(draft.down_hours),
      downtime_reason_id: draft.downtime_reason_id || null,
      note: draft.note.trim() || null,
    };
  };

  const save = async () => {
    const input = buildInput();
    if (!input) return;
    setBusy(true); setError('');
    try {
      if (drawer && drawer !== 'new') await updateDailyReport(drawer, input);
      else await createDailyReport(input);
      setMsg(t('dailyReport.saved'));
      closeDrawer();
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm(t('dailyReport.confirmDelete'))) return;
    setBusy(true); setError('');
    try {
      await deleteDailyReport(id);
      setMsg(t('dailyReport.deleted'));
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // ── compact list ──
  const th = 'px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap';
  const td = 'px-3 py-2.5 text-sm text-slate-700';

  const renderList = () => (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className={cn(th, 'text-left')}>{t('dailyReport.colMachine')}</th>
              <th className={cn(th, 'text-left')}>{t('dailyReport.colItem')}</th>
              <th className={cn(th, 'text-left')}>{t('dailyReport.colDescription')}</th>
              <th className={cn(th, 'text-left')}>{t('dailyReport.colOperator')}</th>
              <th className={cn(th, 'text-right')}>{t('dailyReport.colOutput')}</th>
              <th className={cn(th, 'text-right')}>{t('dailyReport.colWorkHours')}</th>
              <th className={cn(th, 'text-right')}>{t('dailyReport.colTotalCarts')}</th>
              <th className={cn(th, 'text-right')}>{t('dailyReport.colPcsHr')}</th>
              <th className={cn(th, 'text-right')}>{t('dailyReport.colCredit')}</th>
              <th className={cn(th, 'text-right w-24')}>{t('dailyReport.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50 cursor-pointer"
                  onClick={() => (canEdit ? openEdit(r) : undefined)}>
                <td className={cn(td, 'font-medium whitespace-nowrap')}>{r.machine_code}</td>
                <td className={cn(td, 'font-mono text-xs whitespace-nowrap')}>{r.item_number ?? '—'}</td>
                <td className={cn(td, 'max-w-[240px] truncate')} title={r.item_description ?? ''}>
                  {r.item_description ?? '—'}
                </td>
                <td className={cn(td, 'whitespace-nowrap')}>
                  {r.operator_name ? (
                    <><span className="text-slate-400 text-xs mr-1">{r.badge_no}</span>{r.operator_name}</>
                  ) : r.source === 'tablet' ? (
                    <span className="inline-flex items-center gap-1.5 text-slate-500">
                      {t('dailyReport.teamRun')}
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 font-bold">TABLET</span>
                    </span>
                  ) : '—'}
                </td>
                <td className={cn(td, 'text-right tabular-nums')}>{fmt(r.output_qty, 0)}</td>
                <td className={cn(td, 'text-right tabular-nums')}>{fmt(r.work_hours)}</td>
                <td className={cn(td, 'text-right tabular-nums')}>{fmt(r.total_carts, 0)}</td>
                <td className={cn(td, 'text-right tabular-nums')}>{fmt(r.pcs_lbs_per_hr)}</td>
                <td className={cn(td, 'text-right tabular-nums')}>
                  <CreditBadge value={r.credit} />
                </td>
                <td className={cn(td, 'text-right whitespace-nowrap')} onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    {canEdit && (
                      <button onClick={() => openEdit(r)} disabled={busy}
                        className="p-1.5 rounded hover:bg-slate-200 text-slate-500 disabled:opacity-40" title={t('dailyReport.edit')}>
                        <Pencil size={14} />
                      </button>
                    )}
                    {canDelete && (
                      <button onClick={() => remove(r.id)} disabled={busy}
                        className="p-1.5 rounded hover:bg-red-100 text-red-500 disabled:opacity-40" title={t('dailyReport.delete')}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={10} className="px-4 py-12 text-center text-sm text-slate-400">
                {t('dailyReport.empty')}
              </td></tr>
            )}
            {loading && (
              <tr><td colSpan={10} className="px-4 py-12 text-center text-sm text-slate-400">
                {t('dailyReport.loading')}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="p-6 max-w-6xl">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-slate-900">{t('dailyReport.title')}</h1>
        <p className="text-slate-600 text-sm mt-0.5">{t('dailyReport.subtitle')}</p>
      </div>

      {/* filter bar */}
      <div className="flex flex-wrap items-end gap-4 mb-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-600">{t('dailyReport.date')}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="block border border-slate-300 rounded-lg px-3 h-9 text-sm mt-1" />
        </label>
        <div>
          <span className="block text-xs font-medium text-slate-600 mb-1">{t('dailyReport.shift')}</span>
          <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden">
            {SHIFTS.map((s) => (
              <button key={s} onClick={() => setShift(s)}
                className={cn('px-4 h-9 text-sm font-semibold',
                  shift === s ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-slate-500">{t('dailyReport.rowCount', { count: rows.length })}</span>
          {canCreate && (
            <button onClick={openNew}
              className="flex items-center gap-1.5 px-4 h-9 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold">
              <Plus size={14} /> {t('dailyReport.addRow')}
            </button>
          )}
        </div>
      </div>

      {msg && <p className="text-emerald-700 bg-emerald-50 p-2 rounded-lg mb-3 text-sm">{msg}</p>}
      {error && !drawer && <p className="text-red-600 bg-red-50 p-2 rounded-lg mb-3 text-sm">{error}</p>}

      {renderList()}

      {drawer && (
        <EntryDrawer
          t={t}
          titleKey={drawer === 'new' ? 'dailyReport.drawerTitleNew' : 'dailyReport.drawerTitleEdit'}
          draft={draft} setDraft={setDraft}
          preview={preview}
          machines={machines} products={products} operators={operators} reasons={reasons}
          error={error}
          busy={busy}
          onClose={closeDrawer}
          onSave={save}
        />
      )}
    </div>
  );
}

/** Small coloured efficiency badge (Credit = actual rate / standard rate). */
function CreditBadge({ value }: { value: number | null }) {
  if (value == null || !Number.isFinite(value)) return <span className="text-slate-400">—</span>;
  const tone = value >= 1 ? 'bg-emerald-50 text-emerald-700'
    : value >= 0.8 ? 'bg-amber-50 text-amber-700'
      : 'bg-red-50 text-red-700';
  return (
    <span className={cn('inline-block px-1.5 py-0.5 rounded text-xs font-semibold tabular-nums', tone)}>
      {value.toLocaleString(undefined, { maximumFractionDigits: 3 })}
    </span>
  );
}

// ── Slide-over entry drawer ─────────────────────────────────────────────────

interface DrawerProps {
  t: (k: string, o?: Record<string, unknown>) => string;
  titleKey: string;
  draft: Draft;
  setDraft: (d: Draft) => void;
  preview: {
    item_description: string | null; standard_lbs_hr: number | null;
    lbs_good_produced: number; runner_weight_pct: number | null;
    runner_regrind_lbs: number; pcs_lbs_per_hr: number | null;
    credit: number | null; total_carts: number; week_num: number | null;
  };
  machines: MachineOption[];
  products: ProductOption[];
  operators: OperatorOption[];
  reasons: DowntimeReasonOption[];
  error: string;
  busy: boolean;
  onClose: () => void;
  onSave: () => void;
}

// Defined at module scope (NOT inside EntryDrawer) — a component re-created on
// each render gets remounted by React, which makes inputs lose focus after
// every keystroke. Keep these stable.
const inputCls = 'w-full border border-slate-300 rounded-lg px-2.5 h-9 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400';

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600">{label}{required && <span className="text-red-500"> *</span>}</span>
      {children}
    </label>
  );
}

function Calc({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-slate-100 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm font-semibold text-slate-800 tabular-nums">{value}</span>
    </div>
  );
}

function EntryDrawer(p: DrawerProps) {
  const { t, draft, setDraft } = p;
  const set = (k: keyof Draft) => (v: string) => setDraft({ ...draft, [k]: v });

  // F3 — work-order-driven autofill. The input accepts a barcode-gun scan
  // (which types the value + Enter) or manual typing (D9); on resolve we look
  // up the work order and auto-fill the product (process/rates come from it).
  const [woStatus, setWoStatus] = useState<'idle' | 'loading' | 'matched' | 'notfound'>(
    draft.work_order_id ? 'matched' : 'idle');
  const resolveWO = async () => {
    const no = draft.work_order.trim();
    if (!no) { setDraft({ ...draft, work_order_id: '' }); setWoStatus('idle'); return; }
    setWoStatus('loading');
    try {
      const m = await findWorkOrderByNo(no);
      if (m) {
        setDraft({ ...draft, work_order_id: m.work_order_id, product_id: m.product_id ?? draft.product_id });
        setWoStatus('matched');
      } else {
        setDraft({ ...draft, work_order_id: '' });
        setWoStatus('notfound');
      }
    } catch {
      setWoStatus('notfound');
    }
  };

  // Searchable options. Operators match on badge # or name; items on item # or
  // description (hint is both shown muted and included in the search).
  const machineOpts = useMemo<ComboOption[]>(
    () => p.machines.map((m) => ({ value: m.id, label: m.code })), [p.machines]);
  const operatorOpts = useMemo<ComboOption[]>(
    () => p.operators.map((o) => ({ value: o.id, label: `${o.badge_no} · ${o.name}` })), [p.operators]);
  const productOpts = useMemo<ComboOption[]>(
    () => p.products.map((pr) => ({ value: pr.id, label: pr.item_number, hint: pr.description ?? undefined })),
    [p.products]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30" onClick={p.onClose} />
      <aside className="relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <h2 className="text-base font-bold text-slate-900">{t(p.titleKey)}</h2>
          <button onClick={p.onClose} className="p-1.5 rounded hover:bg-slate-100 text-slate-500" title={t('dailyReport.close')}>
            <X size={18} />
          </button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {p.error && <p className="text-red-600 bg-red-50 p-2 rounded-lg text-sm">{p.error}</p>}

          {/* Identification */}
          <section className="space-y-3">
            <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">{t('dailyReport.secId')}</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('dailyReport.colMachine')} required>
                <Combobox className={inputCls} value={draft.machine_id} onChange={set('machine_id')}
                  options={machineOpts} placeholder={t('dailyReport.selectPlaceholder')} />
              </Field>
              <Field label={t('dailyReport.colOperator')} required>
                <Combobox className={inputCls} value={draft.operator_id} onChange={set('operator_id')}
                  options={operatorOpts} placeholder={t('dailyReport.selectPlaceholder')} />
              </Field>
              <Field label={t('dailyReport.colItem')}>
                <Combobox className={inputCls} value={draft.product_id} onChange={set('product_id')}
                  options={productOpts} placeholder={t('dailyReport.selectPlaceholder')} />
              </Field>
              <Field label={t('dailyReport.colWorkOrder')}>
                <input className={inputCls} value={draft.work_order}
                  placeholder={t('dailyReport.woScanPlaceholder')}
                  onChange={(e) => { setWoStatus('idle'); setDraft({ ...draft, work_order: e.target.value, work_order_id: '' }); }}
                  onBlur={resolveWO}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); resolveWO(); } }} />
                {woStatus === 'matched' && (
                  <span className="text-[11px] text-emerald-600 mt-1 inline-block">{t('dailyReport.woMatched')}</span>
                )}
                {woStatus === 'notfound' && (
                  <span className="text-[11px] text-amber-600 mt-1 inline-block">{t('dailyReport.woNotFound')}</span>
                )}
              </Field>
            </div>
            {p.preview.item_description && (
              <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-2.5 py-1.5">{p.preview.item_description}</p>
            )}
          </section>

          {/* Carts */}
          <section className="space-y-3">
            <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">{t('dailyReport.secCarts')}</h3>
            <div className="grid grid-cols-3 gap-3">
              <Field label={t('dailyReport.colCartFrom')}>
                <input className={inputCls} inputMode="numeric" value={draft.cart_from} onChange={(e) => set('cart_from')(e.target.value)} />
              </Field>
              <Field label={t('dailyReport.colCartTo')}>
                <input className={inputCls} inputMode="numeric" value={draft.cart_to} onChange={(e) => set('cart_to')(e.target.value)} />
              </Field>
              <Field label={t('dailyReport.colTotalCarts')}>
                <div className={cn(inputCls, 'flex items-center bg-slate-50 text-slate-700 tabular-nums')}>{fmt(p.preview.total_carts, 0)}</div>
              </Field>
            </div>
          </section>

          {/* Production */}
          <section className="space-y-3">
            <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">{t('dailyReport.secProduction')}</h3>
            <div className="grid grid-cols-3 gap-3">
              <Field label={t('dailyReport.colOutput')}>
                <input className={inputCls} inputMode="decimal" value={draft.output_qty} onChange={(e) => set('output_qty')(e.target.value)} />
              </Field>
              <Field label={t('dailyReport.colWorkHours')}>
                <input className={inputCls} inputMode="decimal" value={draft.work_hours} onChange={(e) => set('work_hours')(e.target.value)} />
              </Field>
              <Field label={t('dailyReport.colDefect')}>
                <input className={inputCls} inputMode="decimal" value={draft.defect_waste_lbs} onChange={(e) => set('defect_waste_lbs')(e.target.value)} />
              </Field>
            </div>
          </section>

          {/* Downtime */}
          <section className="space-y-3">
            <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">{t('dailyReport.secDowntime')}</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('dailyReport.colDownHours')}>
                <input className={inputCls} inputMode="decimal" value={draft.down_hours} onChange={(e) => set('down_hours')(e.target.value)} />
              </Field>
              <Field label={t('dailyReport.colDowntimeReason')}>
                <select className={inputCls} value={draft.downtime_reason_id} onChange={(e) => set('downtime_reason_id')(e.target.value)}>
                  <option value="">{t('dailyReport.selectPlaceholder')}</option>
                  {p.reasons.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </Field>
            </div>
          </section>

          {/* Note */}
          <section className="space-y-2">
            <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">{t('dailyReport.secNote')}</h3>
            <textarea className={cn(inputCls, 'h-auto py-2 resize-none')} rows={2}
              value={draft.note} onChange={(e) => set('note')(e.target.value)} />
          </section>

          {/* Calculated */}
          <section className="bg-indigo-50/50 border border-indigo-100 rounded-xl px-4 py-3">
            <h3 className="text-[11px] font-bold text-indigo-500 uppercase tracking-widest mb-2">{t('dailyReport.secCalculated')}</h3>
            <Calc label={t('dailyReport.colStdLbsHr')} value={fmt(p.preview.standard_lbs_hr)} />
            <Calc label={t('dailyReport.colLbsGood')} value={fmt(p.preview.lbs_good_produced)} />
            <Calc label={t('dailyReport.colRunnerPct')} value={fmt(p.preview.runner_weight_pct, 4)} />
            <Calc label={t('dailyReport.colRunnerRegrind')} value={fmt(p.preview.runner_regrind_lbs)} />
            <Calc label={t('dailyReport.colPcsHr')} value={fmt(p.preview.pcs_lbs_per_hr)} />
            <Calc label={t('dailyReport.colCredit')} value={fmt(p.preview.credit, 3)} />
            <Calc label={t('dailyReport.colWeek')} value={fmt(p.preview.week_num, 0)} />
          </section>
        </div>

        {/* footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 shrink-0">
          <button onClick={p.onClose} disabled={p.busy}
            className="px-4 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold">
            {t('dailyReport.cancel')}
          </button>
          <button onClick={p.onSave} disabled={p.busy}
            className="px-5 h-9 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold disabled:opacity-50">
            {p.busy ? t('dailyReport.saving') : t('dailyReport.save')}
          </button>
        </div>
      </aside>
    </div>
  );
}

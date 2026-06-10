import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { getISOWeek } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { usePermissions } from '../../contexts/PermissionContext';
import { PermissionDenied } from '../qc/components/PermissionDenied';
import {
  listDailyReports, createDailyReport, updateDailyReport, deleteDailyReport,
  listProducts, listMachines, listOperators, listDowntimeReasons,
  type DailyReportRow, type DailyReportInput, type Shift,
  type ProductOption, type MachineOption, type OperatorOption, type DowntimeReasonOption,
} from '../../services/productionDailyApi';

const SHIFTS: Shift[] = ['1st', '2nd', '3rd'];
const NEW = '__new__';

/** Draft form — numeric fields are kept as strings so empty / partial entry
 *  ("", "0.") works without flipping to 0. Parsed on save. */
interface Draft {
  machine_id: string;
  product_id: string;
  operator_id: string;
  work_order: string;
  cart_from: string;
  cart_to: string;
  output_qty: string;
  work_hours: string;
  defect_waste_lbs: string;
  down_hours: string;
  downtime_reason_id: string;
  note: string;
}

const emptyDraft = (): Draft => ({
  machine_id: '', product_id: '', operator_id: '', work_order: '',
  cart_from: '', cart_to: '', output_qty: '', work_hours: '',
  defect_waste_lbs: '', down_hours: '', downtime_reason_id: '', note: '',
});

const rowToDraft = (r: DailyReportRow): Draft => ({
  machine_id: r.machine_id,
  product_id: r.product_id ?? '',
  operator_id: r.operator_id,
  work_order: r.work_order ?? '',
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

  // editingId: an existing row id, or NEW for the draft "add row", or null.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());

  const productById = useMemo(() => {
    const m = new Map<string, ProductOption>();
    products.forEach((p) => m.set(p.id, p));
    return m;
  }, [products]);

  // ── data loading ──
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
    setEditingId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, shift, canView]);

  if (!canView) {
    return <PermissionDenied permission="production.daily_report.view" feature={t('dailyReport.feature')} />;
  }

  // ── live preview of the 10 computed columns for the draft (mirrors BR-P1) ──
  const preview = useMemo(() => {
    const p = draft.product_id ? productById.get(draft.product_id) : undefined;
    const output = numOrNull(draft.output_qty) ?? 0;
    const hours = numOrNull(draft.work_hours);
    const cf = intOrNull(draft.cart_from) ?? 0;
    const ct = intOrNull(draft.cart_to) ?? 0;
    const pcsHr = hours && hours > 0 ? output / hours : null;
    return {
      item_description: p?.description ?? null,
      // mirror the view: blank lookup → 0 when product present, else NULL
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

  // ── editing actions ──
  const startAdd = () => {
    setError(''); setMsg('');
    setDraft(emptyDraft());
    setEditingId(NEW);
  };
  const startEdit = (r: DailyReportRow) => {
    setError(''); setMsg('');
    setDraft(rowToDraft(r));
    setEditingId(r.id);
  };
  const cancel = () => { setEditingId(null); setDraft(emptyDraft()); };

  const buildInput = (): DailyReportInput | null => {
    if (!draft.machine_id) { setError(t('dailyReport.errMachine')); return null; }
    if (!draft.operator_id) { setError(t('dailyReport.errOperator')); return null; }
    return {
      report_date: date,
      shift,
      machine_id: draft.machine_id,
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
      if (editingId && editingId !== NEW) await updateDailyReport(editingId, input);
      else await createDailyReport(input);
      setMsg(t('dailyReport.saved'));
      setEditingId(null);
      setDraft(emptyDraft());
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

  // ── render helpers ──
  const th = 'px-2 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap';
  const thCalc = cn(th, 'bg-slate-50 text-indigo-500');
  const td = 'px-2 py-1.5 text-xs text-slate-700 whitespace-nowrap';
  const tdCalc = cn(td, 'bg-slate-50/70 text-slate-600 tabular-nums');
  const input = 'w-full border border-slate-300 rounded px-1.5 h-8 text-xs';
  const colCount = 24;

  const selectCell = (
    value: string, onChange: (v: string) => void,
    opts: { value: string; label: string }[], placeholder = true,
  ) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={input}>
      {placeholder && <option value="">{t('dailyReport.selectPlaceholder')}</option>}
      {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );

  const renderEditRow = (key: string) => (
    <tr key={key} className="bg-amber-50/60 border-y border-amber-200">
      <td className={td}>{selectCell(draft.machine_id, (v) => setDraft({ ...draft, machine_id: v }),
        machines.map((m) => ({ value: m.id, label: m.code })))}</td>
      <td className={td}>{selectCell(draft.product_id, (v) => setDraft({ ...draft, product_id: v }),
        products.map((p) => ({ value: p.id, label: p.item_number })))}</td>
      <td className={tdCalc}>{preview.item_description ?? '—'}</td>
      <td className={td}><input className={input} value={draft.work_order}
        onChange={(e) => setDraft({ ...draft, work_order: e.target.value })} /></td>
      <td className={td}><input className={input} inputMode="numeric" value={draft.cart_from}
        onChange={(e) => setDraft({ ...draft, cart_from: e.target.value })} /></td>
      <td className={td}><input className={input} inputMode="numeric" value={draft.cart_to}
        onChange={(e) => setDraft({ ...draft, cart_to: e.target.value })} /></td>
      <td className={tdCalc}>{fmt(preview.total_carts, 0)}</td>
      <td className={td}><input className={input} inputMode="decimal" value={draft.output_qty}
        onChange={(e) => setDraft({ ...draft, output_qty: e.target.value })} /></td>
      <td className={td}>{selectCell(draft.operator_id, (v) => setDraft({ ...draft, operator_id: v }),
        operators.map((o) => ({ value: o.id, label: `${o.badge_no} · ${o.name}` })))}</td>
      <td className={td}><input className={input} inputMode="decimal" value={draft.work_hours}
        onChange={(e) => setDraft({ ...draft, work_hours: e.target.value })} /></td>
      <td className={td}><input className={input} inputMode="decimal" value={draft.defect_waste_lbs}
        onChange={(e) => setDraft({ ...draft, defect_waste_lbs: e.target.value })} /></td>
      <td className={td}><input className={input} inputMode="decimal" value={draft.down_hours}
        onChange={(e) => setDraft({ ...draft, down_hours: e.target.value })} /></td>
      <td className={td}>{selectCell(draft.downtime_reason_id, (v) => setDraft({ ...draft, downtime_reason_id: v }),
        reasons.map((r) => ({ value: r.id, label: r.label })))}</td>
      <td className={td}><input className={cn(input, 'min-w-[140px]')} value={draft.note}
        onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></td>
      {/* computed */}
      <td className={tdCalc}>{fmt(preview.standard_lbs_hr)}</td>
      <td className={tdCalc}>{fmt(preview.lbs_good_produced)}</td>
      <td className={tdCalc}>{fmt(preview.runner_weight_pct, 4)}</td>
      <td className={tdCalc}>{fmt(preview.runner_regrind_lbs)}</td>
      <td className={tdCalc}>{fmt(preview.pcs_lbs_per_hr)}</td>
      <td className={tdCalc}>{fmt(preview.credit, 3)}</td>
      <td className={tdCalc}>{fmt(preview.week_num, 0)}</td>
      <td className={cn(td, 'sticky right-0 bg-amber-50')}>
        <div className="flex items-center gap-1">
          <button onClick={save} disabled={busy}
            className="p-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50" title={t('dailyReport.save')}>
            <Check size={13} />
          </button>
          <button onClick={cancel} disabled={busy}
            className="p-1 rounded bg-slate-200 hover:bg-slate-300 text-slate-700" title={t('dailyReport.cancel')}>
            <X size={13} />
          </button>
        </div>
      </td>
    </tr>
  );

  const renderReadRow = (r: DailyReportRow) => (
    <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
      <td className={cn(td, 'font-medium')}>{r.machine_code}</td>
      <td className={cn(td, 'font-mono')}>{r.item_number ?? '—'}</td>
      <td className={td}>{r.item_description ?? '—'}</td>
      <td className={cn(td, 'font-mono')}>{r.work_order ?? '—'}</td>
      <td className={td}>{r.cart_from ?? '—'}</td>
      <td className={td}>{r.cart_to ?? '—'}</td>
      <td className={tdCalc}>{fmt(r.total_carts, 0)}</td>
      <td className={cn(td, 'tabular-nums')}>{fmt(r.output_qty, 0)}</td>
      <td className={td}>{r.badge_no} · {r.operator_name}</td>
      <td className={cn(td, 'tabular-nums')}>{fmt(r.work_hours)}</td>
      <td className={cn(td, 'tabular-nums')}>{fmt(r.defect_waste_lbs)}</td>
      <td className={cn(td, 'tabular-nums')}>{fmt(r.down_hours)}</td>
      <td className={td}>{r.downtime_reason ?? '—'}</td>
      <td className={cn(td, 'max-w-[200px] truncate')} title={r.note ?? ''}>{r.note ?? '—'}</td>
      {/* computed */}
      <td className={tdCalc}>{fmt(r.standard_lbs_hr)}</td>
      <td className={tdCalc}>{fmt(r.lbs_good_produced)}</td>
      <td className={tdCalc}>{fmt(r.runner_weight_pct, 4)}</td>
      <td className={tdCalc}>{fmt(r.runner_regrind_lbs)}</td>
      <td className={tdCalc}>{fmt(r.pcs_lbs_per_hr)}</td>
      <td className={tdCalc}>{fmt(r.credit, 3)}</td>
      <td className={tdCalc}>{fmt(r.week_num, 0)}</td>
      <td className={cn(td, 'sticky right-0 bg-white')}>
        <div className="flex items-center gap-1">
          {canEdit && (
            <button onClick={() => startEdit(r)} disabled={editingId !== null || busy}
              className="p-1 rounded hover:bg-slate-200 text-slate-500 disabled:opacity-40" title={t('dailyReport.edit')}>
              <Pencil size={13} />
            </button>
          )}
          {canDelete && (
            <button onClick={() => remove(r.id)} disabled={editingId !== null || busy}
              className="p-1 rounded hover:bg-red-100 text-red-500 disabled:opacity-40" title={t('dailyReport.delete')}>
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );

  return (
    <div className="p-6">
      <div className="mb-4">
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
            <button onClick={startAdd} disabled={editingId !== null}
              className="flex items-center gap-1.5 px-4 h-9 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold disabled:opacity-50">
              <Plus size={14} /> {t('dailyReport.addRow')}
            </button>
          )}
        </div>
      </div>

      {msg && <p className="text-emerald-700 bg-emerald-50 p-2 rounded-lg mb-3 text-sm">{msg}</p>}
      {error && <p className="text-red-600 bg-red-50 p-2 rounded-lg mb-3 text-sm">{error}</p>}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-slate-200">
                <th className={th}>{t('dailyReport.colMachine')}</th>
                <th className={th}>{t('dailyReport.colItem')}</th>
                <th className={th}>{t('dailyReport.colDescription')}</th>
                <th className={th}>{t('dailyReport.colWorkOrder')}</th>
                <th className={th}>{t('dailyReport.colCartFrom')}</th>
                <th className={th}>{t('dailyReport.colCartTo')}</th>
                <th className={thCalc}>{t('dailyReport.colTotalCarts')}</th>
                <th className={th}>{t('dailyReport.colOutput')}</th>
                <th className={th}>{t('dailyReport.colOperator')}</th>
                <th className={th}>{t('dailyReport.colWorkHours')}</th>
                <th className={th}>{t('dailyReport.colDefect')}</th>
                <th className={th}>{t('dailyReport.colDownHours')}</th>
                <th className={th}>{t('dailyReport.colDowntimeReason')}</th>
                <th className={th}>{t('dailyReport.colNote')}</th>
                <th className={thCalc}>{t('dailyReport.colStdLbsHr')}</th>
                <th className={thCalc}>{t('dailyReport.colLbsGood')}</th>
                <th className={thCalc}>{t('dailyReport.colRunnerPct')}</th>
                <th className={thCalc}>{t('dailyReport.colRunnerRegrind')}</th>
                <th className={thCalc}>{t('dailyReport.colPcsHr')}</th>
                <th className={thCalc}>{t('dailyReport.colCredit')}</th>
                <th className={thCalc}>{t('dailyReport.colWeek')}</th>
                <th className={cn(th, 'sticky right-0 bg-white')}>{t('dailyReport.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (editingId === r.id ? renderEditRow(r.id) : renderReadRow(r)))}
              {editingId === NEW && renderEditRow(NEW)}
              {!loading && rows.length === 0 && editingId !== NEW && (
                <tr><td colSpan={colCount} className="px-4 py-10 text-center text-sm text-slate-400">
                  {t('dailyReport.empty')}
                </td></tr>
              )}
              {loading && (
                <tr><td colSpan={colCount} className="px-4 py-10 text-center text-sm text-slate-400">
                  {t('dailyReport.loading')}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

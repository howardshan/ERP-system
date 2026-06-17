import { supabase } from '../lib/supabase';

// Production run data-entry — see M-125 (Phase 2 M1.1, 方案A 单一事实源).
// Hand-entered fields live in prod_run (the single source of truth, shared by
// the manager page and — later — the tablet); the 10 computed columns (BR-P1)
// come from the view prod_run_view, which we read directly. (Renamed from
// productionDailyApi.ts; prod_daily_report is now a back-compat view.)

// ── Types ─────────────────────────────────────────────────────────────────────

export type Shift = '1st' | '2nd' | '3rd';

/** A row of the computed view (read side). */
export interface DailyReportRow {
  id: string;
  report_date: string;            // YYYY-MM-DD
  shift: Shift;
  machine_id: string;
  machine_code: string;
  work_order_id: string | null;
  work_order_no: string | null;
  product_id: string | null;
  item_number: string | null;
  item_description: string | null;
  process: string | null;
  is_activity: boolean | null;
  operator_id: string | null;
  badge_no: number | null;
  operator_name: string | null;
  work_order: string | null;
  cart_from: number | null;
  cart_to: number | null;
  output_qty: number;
  work_hours: number;
  defect_waste_lbs: number | null;
  down_hours: number | null;
  downtime_reason_id: string | null;
  downtime_reason: string | null;
  note: string | null;
  source: string;
  run_status: string;
  final_cart_complete: boolean;
  continues_prev: boolean;
  // computed (BR-P1)
  standard_lbs_hr: number | null;
  lbs_good_produced: number | null;
  runner_weight_pct: number | null;
  runner_regrind_lbs: number | null;
  pcs_lbs_per_hr: number | null;
  credit: number | null;
  total_carts: number | null;
  week_num: number | null;
  created_at: string;
}

/** Hand-entered fields (write side). */
export interface DailyReportInput {
  report_date: string;
  shift: Shift;
  machine_id: string;
  work_order_id?: string | null;
  product_id?: string | null;
  operator_id: string | null;   // null = team run (tablet); set = manager per-operator row
  work_order?: string | null;
  cart_from?: number | null;
  cart_to?: number | null;
  output_qty: number;
  work_hours: number;
  defect_waste_lbs?: number | null;
  down_hours?: number | null;
  downtime_reason_id?: string | null;
  note?: string | null;
}

export interface ProductOption {
  id: string;
  item_number: string;
  description: string | null;
  is_activity: boolean;
  pcs_lbs_per_hour: number | null;
  runner_avg: number | null;
  bone_avg: number | null;
}

export interface MachineOption { id: string; code: string; kind: string }
export interface OperatorOption { id: string; badge_no: number; name: string }
export interface DowntimeReasonOption { id: string; code: string; label: string }

// ── Master data (dropdowns) ─────────────────────────────────────────────────

export async function listProducts(): Promise<ProductOption[]> {
  const { data, error } = await supabase
    .from('prod_product_master')
    .select('id, item_number, description, is_activity, pcs_lbs_per_hour, runner_avg, bone_avg')
    .eq('status', 'active')
    .order('item_number');
  if (error) throw new Error(error.message);
  return (data ?? []) as ProductOption[];
}

export async function listMachines(): Promise<MachineOption[]> {
  const { data, error } = await supabase
    .from('prod_machine')
    .select('id, code, kind')
    .eq('active', true)
    .order('sort_order');
  if (error) throw new Error(error.message);
  return (data ?? []) as MachineOption[];
}

export async function listOperators(): Promise<OperatorOption[]> {
  const { data, error } = await supabase
    .from('prod_operator')
    .select('id, badge_no, name')
    .eq('active', true)
    .order('badge_no');
  if (error) throw new Error(error.message);
  return (data ?? []) as OperatorOption[];
}

/** One operator's attendance on a line for a date+shift (open or closed session). */
export interface ShiftAttendanceRow { machine_id: string; badge_no: number | null; name: string | null }

/** Everyone who clocked in on any line for a given date + shift — used to show the
 *  "team" behind team/tablet runs in the manager Daily Report. */
export async function listShiftAttendance(date: string, shift: Shift): Promise<ShiftAttendanceRow[]> {
  const { data, error } = await supabase
    .from('prod_line_attendance')
    .select('machine_id, operator:prod_operator(badge_no, name)')
    .eq('report_date', date)
    .eq('shift', shift)
    .order('check_in_at');
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Array<{ machine_id: string; operator: { badge_no: number; name: string } | null }>)
    .map((r) => ({ machine_id: r.machine_id, badge_no: r.operator?.badge_no ?? null, name: r.operator?.name ?? null }));
}

export async function listDowntimeReasons(): Promise<DowntimeReasonOption[]> {
  const { data, error } = await supabase
    .from('prod_downtime_reason')
    .select('id, code, label')
    .eq('active', true)
    .order('sort_order');
  if (error) throw new Error(error.message);
  return (data ?? []) as DowntimeReasonOption[];
}

// ── Run rows ────────────────────────────────────────────────────────────────

/** All rows for one date + shift, with computed columns, machine-ordered. */
export async function listDailyReports(date: string, shift: Shift): Promise<DailyReportRow[]> {
  const { data, error } = await supabase
    .from('prod_run_view')
    .select('*')
    .eq('report_date', date)
    .eq('shift', shift)
    .order('machine_code')
    .order('created_at');
  if (error) throw new Error(error.message);
  return (data ?? []) as DailyReportRow[];
}

function toRow(input: DailyReportInput) {
  return {
    report_date: input.report_date,
    shift: input.shift,
    machine_id: input.machine_id,
    work_order_id: input.work_order_id ?? null,
    product_id: input.product_id ?? null,
    operator_id: input.operator_id,
    work_order: input.work_order ?? null,
    cart_from: input.cart_from ?? null,
    cart_to: input.cart_to ?? null,
    output_qty: input.output_qty,
    work_hours: input.work_hours,
    defect_waste_lbs: input.defect_waste_lbs ?? null,
    down_hours: input.down_hours ?? null,
    downtime_reason_id: input.downtime_reason_id ?? null,
    note: input.note ?? null,
    // source defaults to 'manager' in the DB for these manager-page entries.
  };
}

export async function createDailyReport(input: DailyReportInput): Promise<string> {
  const { data, error } = await supabase
    .from('prod_run')
    .insert(toRow(input))
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function updateDailyReport(id: string, input: DailyReportInput): Promise<void> {
  const { error } = await supabase
    .from('prod_run')
    .update({ ...toRow(input), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteDailyReport(id: string): Promise<void> {
  const { error } = await supabase.from('prod_run').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

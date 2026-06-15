import { supabase } from '../lib/supabase';
import type { DailyReportRow } from './productionRunApi';

// Production-line tablet kiosk — see M-126 (Phase 2 M1.2a).
// The tablet runs unauthenticated (anon key, /tablet route). Device login goes
// through the prod_tablet_login SECURITY DEFINER RPC (PIN never exposed via
// REST); attendance (clock in/out) is written directly under dev_all RLS.

export type Shift = '1st' | '2nd' | '3rd';

/** Validated device session returned by prod_tablet_login. */
export interface TabletSession {
  device_id: string;
  code: string;
  name: string | null;
  machine_id: string;
  machine_code: string;
}

/** An on-shift attendance session (who is currently clocked in on this line). */
export interface AttendanceRow {
  id: string;
  operator_id: string;
  badge_no: number | null;
  operator_name: string | null;
  check_in_at: string;
  check_out_at: string | null;
}

interface RawAttendance {
  id: string;
  operator_id: string;
  check_in_at: string;
  check_out_at: string | null;
  operator: { badge_no: number; name: string } | null;
}

/** Validate device code + PIN; returns the bound line, or throws 'unauthorized'. */
export async function tabletLogin(code: string, pin: string): Promise<TabletSession> {
  const { data, error } = await supabase.rpc('prod_tablet_login', {
    p_code: code.trim(),
    p_pin: pin,
  });
  if (error) throw new Error(error.message);
  return data as TabletSession;
}

/** Operators currently clocked in (not yet clocked out) on this line + shift today. */
export async function listOnShift(
  machineId: string, date: string, shift: Shift,
): Promise<AttendanceRow[]> {
  const { data, error } = await supabase
    .from('prod_line_attendance')
    .select('id, operator_id, check_in_at, check_out_at, operator:prod_operator(badge_no, name)')
    .eq('machine_id', machineId)
    .eq('report_date', date)
    .eq('shift', shift)
    .is('check_out_at', null)
    .order('check_in_at');
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RawAttendance[]).map((r) => ({
    id: r.id,
    operator_id: r.operator_id,
    badge_no: r.operator?.badge_no ?? null,
    operator_name: r.operator?.name ?? null,
    check_in_at: r.check_in_at,
    check_out_at: r.check_out_at,
  }));
}

/** Clock an operator in. Guards against a duplicate open session on this line+shift. */
export async function clockIn(
  operatorId: string, machineId: string, date: string, shift: Shift, deviceId: string,
): Promise<void> {
  const { data: existing, error: exErr } = await supabase
    .from('prod_line_attendance')
    .select('id')
    .eq('operator_id', operatorId)
    .eq('machine_id', machineId)
    .eq('report_date', date)
    .eq('shift', shift)
    .is('check_out_at', null)
    .limit(1);
  if (exErr) throw new Error(exErr.message);
  if (existing && existing.length > 0) return; // already on shift — no-op

  const { error } = await supabase.from('prod_line_attendance').insert({
    operator_id: operatorId,
    machine_id: machineId,
    report_date: date,
    shift,
    device_id: deviceId,
  });
  if (error) throw new Error(error.message);
}

/** Clock an attendance session out. */
export async function clockOut(attendanceId: string): Promise<void> {
  const { error } = await supabase
    .from('prod_line_attendance')
    .update({ check_out_at: new Date().toISOString() })
    .eq('id', attendanceId);
  if (error) throw new Error(error.message);
}

// ── Production run (M1.2b) ────────────────────────────────────────────────────

/** Hand-entered fields for a tablet run. Per-line/team: no operator (work hours
 *  come from attendance in M1.3), source='tablet', stamped with the device. */
export interface TabletRunInput {
  report_date: string;
  shift: Shift;
  machine_id: string;
  device_id: string;
  work_order_id?: string | null;
  product_id?: string | null;
  cart_from?: number | null;
  cart_to?: number | null;
  output_qty: number;
  defect_waste_lbs?: number | null;
  note?: string | null;
  final_cart_complete?: boolean;
  continues_prev?: boolean;
}

export async function submitTabletRun(input: TabletRunInput): Promise<string> {
  const { data, error } = await supabase
    .from('prod_run')
    .insert({
      report_date: input.report_date,
      shift: input.shift,
      machine_id: input.machine_id,
      device_id: input.device_id,
      source: 'tablet',
      operator_id: null,            // team run — labor comes from attendance (M1.3)
      work_order_id: input.work_order_id ?? null,
      product_id: input.product_id ?? null,
      cart_from: input.cart_from ?? null,
      cart_to: input.cart_to ?? null,
      output_qty: input.output_qty,
      defect_waste_lbs: input.defect_waste_lbs ?? null,
      note: input.note ?? null,
      final_cart_complete: input.final_cart_complete ?? true,
      continues_prev: input.continues_prev ?? false,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

/** This line + shift's runs today (all sources), newest first. */
export async function listTabletRuns(
  machineId: string, date: string, shift: Shift,
): Promise<DailyReportRow[]> {
  const { data, error } = await supabase
    .from('prod_run_view')
    .select('*')
    .eq('machine_id', machineId)
    .eq('report_date', date)
    .eq('shift', shift)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as DailyReportRow[];
}

// ── Downtime (M1.2b) ──────────────────────────────────────────────────────────

export interface DowntimeEventRow {
  id: string;
  reason_id: string;
  reason_label: string | null;
  start_at: string | null;
  end_at: string | null;
  down_minutes: number | null;
  note: string | null;
}

interface RawDowntime {
  id: string; reason_id: string; start_at: string | null; end_at: string | null;
  down_minutes: number | null; note: string | null;
  reason: { label: string } | null;
}

const DT_SELECT = 'id, reason_id, start_at, end_at, down_minutes, note, reason:prod_downtime_reason(label)';

function mapDowntime(r: RawDowntime): DowntimeEventRow {
  return {
    id: r.id, reason_id: r.reason_id, reason_label: r.reason?.label ?? null,
    start_at: r.start_at, end_at: r.end_at, down_minutes: r.down_minutes, note: r.note,
  };
}

/** Most recent in-progress (open) downtime on this line + shift, or null. */
export async function getOpenDowntime(
  machineId: string, date: string, shift: Shift,
): Promise<DowntimeEventRow | null> {
  const { data, error } = await supabase
    .from('prod_downtime_event')
    .select(DT_SELECT)
    .eq('machine_id', machineId)
    .eq('report_date', date)
    .eq('shift', shift)
    .is('end_at', null)
    .not('start_at', 'is', null)
    .order('start_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapDowntime(data as unknown as RawDowntime) : null;
}

export async function listDowntimeToday(
  machineId: string, date: string, shift: Shift,
): Promise<DowntimeEventRow[]> {
  const { data, error } = await supabase
    .from('prod_downtime_event')
    .select(DT_SELECT)
    .eq('machine_id', machineId)
    .eq('report_date', date)
    .eq('shift', shift)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RawDowntime[]).map(mapDowntime);
}

/** Start a real-time downtime (open event, end_at null). */
export async function startDowntime(
  machineId: string, date: string, shift: Shift, reasonId: string, deviceId: string,
): Promise<void> {
  const { error } = await supabase.from('prod_downtime_event').insert({
    machine_id: machineId, report_date: date, shift,
    reason_id: reasonId, start_at: new Date().toISOString(), device_id: deviceId,
  });
  if (error) throw new Error(error.message);
}

/** Close an open downtime, computing down_minutes from its start. */
export async function endDowntime(id: string, startAtISO: string): Promise<void> {
  const endMs = Date.now();
  const mins = Math.max(0, Math.round((endMs - new Date(startAtISO).getTime()) / 60000));
  const { error } = await supabase
    .from('prod_downtime_event')
    .update({ end_at: new Date(endMs).toISOString(), down_minutes: mins })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

/** Back-fill a past downtime by duration (no start/end timestamps). */
export async function addDowntime(
  machineId: string, date: string, shift: Shift, reasonId: string, minutes: number, deviceId: string,
): Promise<void> {
  const { error } = await supabase.from('prod_downtime_event').insert({
    machine_id: machineId, report_date: date, shift,
    reason_id: reasonId, down_minutes: minutes, device_id: deviceId,
  });
  if (error) throw new Error(error.message);
}

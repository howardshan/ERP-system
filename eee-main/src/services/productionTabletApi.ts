import { supabase } from '../lib/supabase';

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

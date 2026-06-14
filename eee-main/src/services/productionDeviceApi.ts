import { supabase } from '../lib/supabase';

// Production-line tablet device management — see M-126 (Phase 2 M1.2a).
// Manager-side CRUD for prod_line_device (code + PIN + bound line). The tablet
// kiosk authenticates via the prod_tablet_login RPC, not through this module.

export interface DeviceRow {
  id: string;
  code: string;
  name: string | null;
  machine_id: string;
  machine_code: string | null;
  pin: string;
  active: boolean;
  created_at: string;
}

export interface DeviceInput {
  code: string;
  name?: string | null;
  machine_id: string;
  pin: string;
  active?: boolean;
}

interface RawDevice {
  id: string; code: string; name: string | null; machine_id: string;
  pin: string; active: boolean; created_at: string;
  machine: { code: string } | null;
}

const SELECT = '*, machine:prod_machine(code)';

function mapRow(r: RawDevice): DeviceRow {
  return {
    id: r.id, code: r.code, name: r.name, machine_id: r.machine_id,
    machine_code: r.machine?.code ?? null, pin: r.pin, active: r.active,
    created_at: r.created_at,
  };
}

export async function listDevices(): Promise<DeviceRow[]> {
  const { data, error } = await supabase
    .from('prod_line_device')
    .select(SELECT)
    .order('code');
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RawDevice[]).map(mapRow);
}

function toRow(input: DeviceInput) {
  return {
    code: input.code.trim(),
    name: input.name?.trim() || null,
    machine_id: input.machine_id,
    pin: input.pin.trim(),
    active: input.active ?? true,
  };
}

export async function createDevice(input: DeviceInput): Promise<string> {
  const { data, error } = await supabase
    .from('prod_line_device')
    .insert(toRow(input))
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function updateDevice(id: string, input: DeviceInput): Promise<void> {
  const { error } = await supabase
    .from('prod_line_device')
    .update({ ...toRow(input), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function disableDevice(id: string): Promise<void> {
  const { error } = await supabase
    .from('prod_line_device')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

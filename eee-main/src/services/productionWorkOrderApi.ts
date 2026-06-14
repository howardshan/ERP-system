import { supabase } from '../lib/supabase';

// Production work-order master data — see M-125 (Phase 2 M1.1).
// Work orders originate in an external system; for M1 they're maintained
// in-system by planners and drive the entry autofill (F3) on prod_run.

// ── Types ─────────────────────────────────────────────────────────────────────

export type WorkOrderStatus = 'open' | 'in_progress' | 'closed' | 'cancelled';

export interface WorkOrderRow {
  id: string;
  work_order_no: string;
  product_id: string | null;
  item_number: string | null;
  description: string | null;
  machine_id: string | null;
  machine_code: string | null;
  planned_qty: number | null;
  status: WorkOrderStatus;
  planned_date: string | null;
  note: string | null;
  created_at: string;
}

export interface WorkOrderInput {
  work_order_no: string;
  product_id?: string | null;
  machine_id?: string | null;
  planned_qty?: number | null;
  status?: WorkOrderStatus;
  planned_date?: string | null;
  note?: string | null;
}

/** Autofill payload returned by findWorkOrderByNo (F3). Process comes from the
 *  product per D10 — the work order itself stores no process. */
export interface WorkOrderLookup {
  work_order_id: string;
  work_order_no: string;
  status: WorkOrderStatus;
  product_id: string | null;
  item_number: string | null;
  description: string | null;
  process: string | null;
  pcs_lbs_per_hour: number | null;
  runner_avg: number | null;
  bone_avg: number | null;
}

export interface WorkOrderRollup {
  work_order_id: string;
  work_order_no: string;
  planned_qty: number | null;
  run_count: number;
  total_output: number;
  distinct_carts: number;
}

// Shape returned by the nested select below.
interface RawWorkOrder {
  id: string;
  work_order_no: string;
  product_id: string | null;
  machine_id: string | null;
  planned_qty: number | null;
  status: WorkOrderStatus;
  planned_date: string | null;
  note: string | null;
  created_at: string;
  product: { item_number: string; description: string | null } | null;
  machine: { code: string } | null;
}

const SELECT =
  '*, product:prod_product_master(item_number, description), machine:prod_machine(code)';

function mapRow(r: RawWorkOrder): WorkOrderRow {
  return {
    id: r.id,
    work_order_no: r.work_order_no,
    product_id: r.product_id,
    item_number: r.product?.item_number ?? null,
    description: r.product?.description ?? null,
    machine_id: r.machine_id,
    machine_code: r.machine?.code ?? null,
    planned_qty: r.planned_qty,
    status: r.status,
    planned_date: r.planned_date,
    note: r.note,
    created_at: r.created_at,
  };
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

/** List work orders. Pass statuses to filter (default: active = exclude closed/cancelled). */
export async function listWorkOrders(
  statuses: WorkOrderStatus[] = ['open', 'in_progress'],
): Promise<WorkOrderRow[]> {
  let q = supabase.from('prod_work_order').select(SELECT).order('created_at', { ascending: false });
  if (statuses.length) q = q.in('status', statuses);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RawWorkOrder[]).map(mapRow);
}

function toRow(input: WorkOrderInput) {
  return {
    work_order_no: input.work_order_no.trim(),
    product_id: input.product_id || null,
    machine_id: input.machine_id || null,
    planned_qty: input.planned_qty ?? null,
    status: input.status ?? 'open',
    planned_date: input.planned_date || null,
    note: input.note?.trim() || null,
  };
}

export async function createWorkOrder(input: WorkOrderInput): Promise<string> {
  const { data, error } = await supabase
    .from('prod_work_order')
    .insert(toRow(input))
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function updateWorkOrder(id: string, input: WorkOrderInput): Promise<void> {
  const { error } = await supabase
    .from('prod_work_order')
    .update({ ...toRow(input), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function closeWorkOrder(id: string): Promise<void> {
  const { error } = await supabase
    .from('prod_work_order')
    .update({ status: 'closed', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

// ── Autofill / rollup (F3, D8) ────────────────────────────────────────────────

/** Exact work-order-number lookup for entry autofill. Returns null if not found. */
export async function findWorkOrderByNo(no: string): Promise<WorkOrderLookup | null> {
  const trimmed = no.trim();
  if (!trimmed) return null;
  const { data, error } = await supabase
    .from('prod_work_order')
    .select(
      'id, work_order_no, status, product_id, ' +
      'product:prod_product_master(item_number, description, process, pcs_lbs_per_hour, runner_avg, bone_avg)',
    )
    .ilike('work_order_no', trimmed)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const r = data as unknown as {
    id: string; work_order_no: string; status: WorkOrderStatus; product_id: string | null;
    product: {
      item_number: string; description: string | null; process: string | null;
      pcs_lbs_per_hour: number | null; runner_avg: number | null; bone_avg: number | null;
    } | null;
  };
  return {
    work_order_id: r.id,
    work_order_no: r.work_order_no,
    status: r.status,
    product_id: r.product_id,
    item_number: r.product?.item_number ?? null,
    description: r.product?.description ?? null,
    process: r.product?.process ?? null,
    pcs_lbs_per_hour: r.product?.pcs_lbs_per_hour ?? null,
    runner_avg: r.product?.runner_avg ?? null,
    bone_avg: r.product?.bone_avg ?? null,
  };
}

export async function getWorkOrderRollup(workOrderId: string): Promise<WorkOrderRollup | null> {
  const { data, error } = await supabase
    .from('prod_work_order_rollup_view')
    .select('*')
    .eq('work_order_id', workOrderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as WorkOrderRollup | null;
}

/** D8 carry-over: most recent run for this WO whose last cart was left unfinished.
 *  Returns the cart number to continue, or null. (Wired into the tablet UI in M1.2.) */
export async function getCarryOverCart(
  workOrderId: string,
): Promise<{ continueCart: number; runId: string } | null> {
  const { data, error } = await supabase
    .from('prod_run_view')
    .select('id, cart_to, final_cart_complete')
    .eq('work_order_id', workOrderId)
    .order('report_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const r = data as { id: string; cart_to: number | null; final_cart_complete: boolean };
  if (r.final_cart_complete || r.cart_to == null) return null;
  return { continueCart: r.cart_to, runId: r.id };
}

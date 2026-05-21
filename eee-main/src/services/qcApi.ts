import { supabase } from '../lib/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SubLotStatus =
  | 'created' | 'drying' | 'awaiting_recheck'
  | 'pending' | 'inspecting' | 'passed' | 'hold' | 'disposing' | 'closed';

export interface SubLot {
  id: string;
  production_lot_id: string;
  sub_lot_code: string;
  location_id: string | null;
  location_name: string | null;
  dryer_number: number | null;
  cell_number: number | null;
  in_time: string | null;
  out_time: string | null;
  status: SubLotStatus;
  expected_dry_minutes: number | null;
  expected_finish_at: string | null;
  total_dried_minutes: number | null;
  remaining_minutes: number | null;
  lot_number?: string | null;
  has_pending_sample?: boolean;
  latest_pending_sample_id?: string | null;
  latest_pending_sample_pk?: string | null;
  lot_barcode: string | null;
  sku_name: string | null;
  wait_minutes: number | null;
  hold_reason: string | null;
  hold_aw: number | null;
  hold_item_name: string | null;
  hold_lower_limit: number | null;
  hold_upper_limit: number | null;
  hold_inspected_at: string | null;
}

export interface ProductionLot {
  id: string;
  lot_number: string;
  lot_barcode: string;
  work_order_barcode: string;
  sku_id: string;
  sku_code: string | null;
  sku_name: string | null;
  created_at: string;
}

export interface InspectionTemplate {
  id: string;
  sku_id: string;
  item_name: string;
  unit: string | null;
  lower_limit: number;
  upper_limit: number;
}

export interface Product {
  id: string;
  code: string;
  name: string;
  standard_drying_minutes: number | null;
  templates: InspectionTemplate[];
}

export interface ProductInput {
  code: string;
  name: string;
  standard_drying_minutes: number | null;
  template: {
    item_name: string;
    unit: string | null;
    lower_limit: number;
    upper_limit: number;
  };
}

export interface DryingLocation {
  id: string;
  code: string;
  display_name: string;
  dryer_number: number | null;
  cell_number: number | null;
}

export interface QualityEvent {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
  sub_lot_code: string | null;
  summary: string;
}

export interface ProductionLotDetail {
  lot: ProductionLot;
  sub_lots: SubLot[];
  events: QualityEvent[];
}

export interface TodayInspectionItem {
  sub_lot_id: string;
  sub_lot_code: string;
  sku_name: string | null;
  aw: number | null;
  result: 'pass' | 'fail';
  submitted_at: string;
  status: SubLotStatus | 'unknown';
  fail_reason: string | null;
}

export interface DashboardSummary {
  pending_count: number;
  longest_wait_minutes: number | null;
  hold_count: number;
  today_passed: number;
  today_failed: number;
  pass_rate: number | null;
  pending_items: SubLot[];
  holds: SubLot[];
  today_passed_items: TodayInspectionItem[];
  today_failed_items: TodayInspectionItem[];
}

export interface InspectionResult {
  id: string;
  drying_sub_lot_id: string;
  result: 'pass' | 'fail';
  values_json: { aw: number };
  submitted_at: string;
  new_status: SubLotStatus;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function rpc<T>(fn: string, params: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, params);
  if (error) throw new Error(error.message);
  return data as T;
}

// ── Master data ───────────────────────────────────────────────────────────────

export async function listProducts(): Promise<Product[]> {
  return rpc<Product[]>('qc_list_products');
}

export async function listLocations(): Promise<DryingLocation[]> {
  return rpc<DryingLocation[]>('qc_list_locations');
}

export async function createProduct(input: ProductInput): Promise<Product> {
  if (input.template.lower_limit > input.template.upper_limit) {
    throw new Error('Lower limit cannot exceed upper limit');
  }
  const { data: sku, error } = await supabase
    .from('qc_product_sku')
    .insert({
      code: input.code,
      name: input.name,
      standard_drying_minutes: input.standard_drying_minutes,
    })
    .select('id, code, name, standard_drying_minutes')
    .single();
  if (error) throw new Error(error.message);

  const { error: tmplErr } = await supabase
    .from('qc_inspection_template')
    .insert({
      sku_id: sku.id,
      item_name: input.template.item_name,
      unit: input.template.unit,
      lower_limit: input.template.lower_limit,
      upper_limit: input.template.upper_limit,
    });
  if (tmplErr) throw new Error(tmplErr.message);

  const all = await listProducts();
  const found = all.find(p => p.id === sku.id);
  return found ?? ({ ...sku, templates: [] } as Product);
}

export async function updateProduct(id: string, input: Partial<ProductInput>): Promise<Product> {
  if (input.template && input.template.lower_limit > input.template.upper_limit) {
    throw new Error('Lower limit cannot exceed upper limit');
  }
  const skuPatch: Record<string, unknown> = {};
  if (input.code !== undefined) skuPatch.code = input.code;
  if (input.name !== undefined) skuPatch.name = input.name;
  if (input.standard_drying_minutes !== undefined) skuPatch.standard_drying_minutes = input.standard_drying_minutes;
  if (Object.keys(skuPatch).length > 0) {
    const { error } = await supabase.from('qc_product_sku').update(skuPatch).eq('id', id);
    if (error) throw new Error(error.message);
  }
  if (input.template) {
    const { data: existing } = await supabase
      .from('qc_inspection_template')
      .select('id')
      .eq('sku_id', id)
      .limit(1)
      .maybeSingle();
    if (existing?.id) {
      const { error } = await supabase
        .from('qc_inspection_template')
        .update({
          item_name: input.template.item_name,
          unit: input.template.unit,
          lower_limit: input.template.lower_limit,
          upper_limit: input.template.upper_limit,
        })
        .eq('id', existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from('qc_inspection_template').insert({
        sku_id: id,
        item_name: input.template.item_name,
        unit: input.template.unit,
        lower_limit: input.template.lower_limit,
        upper_limit: input.template.upper_limit,
      });
      if (error) throw new Error(error.message);
    }
  }
  const all = await listProducts();
  const found = all.find(p => p.id === id);
  if (!found) throw new Error('Product not found');
  return found;
}

export async function deleteProduct(id: string): Promise<void> {
  const { error } = await supabase.from('qc_product_sku').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteProducts(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('qc_product_sku').delete().in('id', ids);
  if (error) throw new Error(error.message);
}

// ── Production lots ───────────────────────────────────────────────────────────

export async function listProductionLots(): Promise<ProductionLot[]> {
  return rpc<ProductionLot[]>('qc_list_production_lots');
}

export async function createProductionLot(input: {
  lot_barcode: string;
  work_order_barcode: string;
  sku_id: string;
  lot_number?: string;
}): Promise<ProductionLot> {
  const lot_number = input.lot_number ?? input.lot_barcode;
  const { error } = await supabase.from('qc_production_lot').insert({
    lot_number,
    lot_barcode: input.lot_barcode,
    work_order_barcode: input.work_order_barcode,
    sku_id: input.sku_id,
  });
  if (error) {
    if (error.message.toLowerCase().includes('duplicate')) {
      throw new Error('Lot number already exists');
    }
    throw new Error(error.message);
  }
  const all = await listProductionLots();
  const found = all.find(l => l.lot_number === lot_number);
  if (!found) throw new Error('Lot created but not returned');
  return found;
}

export async function productionLotDetail(lotId: string): Promise<ProductionLotDetail> {
  return rpc<ProductionLotDetail>('qc_production_lot_detail', { p_lot_id: lotId });
}

// ── Production batch creation (creates 1 Dry Room + N Sub-lots in one go) ─────
//
// Production is a temporary creation wizard until a real Production module
// exists. The form-level fields (production_date, shift) are only used to
// auto-generate a default code; everything ultimately lands in qc_production_lot
// + qc_drying_sub_lot using the existing schema.

export interface ProductionBatchInput {
  production_date: string;          // YYYY-MM-DD
  shift: string;                    // early / late / night / other
  production_code: string;          // lot_number + lot_barcode
  work_order_barcode: string;
  sku_id: string;
  expected_dry_minutes: number | null;  // applied to every sub-lot created in this batch
  sub_lots: Array<{
    sub_lot_code?: string | null;   // optional override; otherwise auto = <lot_barcode>-D##
  }>;
}

export interface ProductionBatchResult {
  lot: ProductionLot;
  sub_lots: SubLot[];
}

export async function createProductionBatch(input: ProductionBatchInput): Promise<ProductionBatchResult> {
  if (!input.production_code) throw new Error('Production code is required');
  if (!input.work_order_barcode) throw new Error('Work order barcode is required');
  if (!input.sku_id) throw new Error('SKU is required');
  if (input.sub_lots.length === 0) throw new Error('At least one sub-lot is required');

  const lot = await createProductionLot({
    lot_number: input.production_code,
    lot_barcode: input.production_code,
    work_order_barcode: input.work_order_barcode,
    sku_id: input.sku_id,
  });

  // Sub-lots created here live in 'created' status; they enter the dryer later
  // via the Check-in to Dryer page (qc_register_in_dryer).
  const subLots: SubLot[] = [];
  for (const sl of input.sub_lots) {
    const created = await createSubLot({
      production_lot_id: lot.id,
      sub_lot_code: sl.sub_lot_code ?? null,
      expected_dry_minutes: input.expected_dry_minutes,
    });
    subLots.push(created);
  }

  return { lot, sub_lots: subLots };
}

// ── Dry Room (physical dryer) summary & per-dryer sub-lot listing ───────────

export interface DryRoomSummary {
  dryer_number: number;
  total_cells: number;
  occupied_count: number;
  available_count: number;
  drying_count: number;
  next_finish_at: string | null;
}

export async function listDryRoomSummary(): Promise<DryRoomSummary[]> {
  return rpc<DryRoomSummary[]>('qc_dry_room_summary');
}

export async function listSubLotsByDryer(dryerNumber: number): Promise<SubLot[]> {
  return rpc<SubLot[]>('qc_list_sub_lots_by_dryer', { p_dryer_number: dryerNumber });
}

export async function deleteProductionLots(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('qc_production_lot').delete().in('id', ids);
  if (error) throw new Error(error.message);
}

// ── Sub-lots ──────────────────────────────────────────────────────────────────

export async function checkInSubLot(input: {
  production_lot_id: string;
  location_id?: string | null;
  in_time?: string | null;
  sub_lot_code?: string | null;
}): Promise<SubLot> {
  return rpc<SubLot>('qc_check_in_sub_lot', {
    p_production_lot_id: input.production_lot_id,
    p_location_id: input.location_id ?? null,
    p_in_time: input.in_time ?? null,
    p_sub_lot_code: input.sub_lot_code ?? null,
  });
}

// Production form: create sub-lot in 'created' status (not yet in dryer)
export async function createSubLot(input: {
  production_lot_id: string;
  sub_lot_code?: string | null;
  expected_dry_minutes?: number | null;
}): Promise<SubLot> {
  return rpc<SubLot>('qc_create_sub_lot', {
    p_production_lot_id: input.production_lot_id,
    p_sub_lot_code: input.sub_lot_code ?? null,
    p_expected_dry_minutes: input.expected_dry_minutes ?? null,
  });
}

// Check-in to Dryer: move 'created' → 'drying' at a specific grid cell
export async function registerInDryer(input: {
  sub_lot_id: string;
  location_id: string;
  in_time?: string | null;
}): Promise<SubLot> {
  return rpc<SubLot>('qc_register_in_dryer', {
    p_sub_lot_id: input.sub_lot_id,
    p_location_id: input.location_id,
    p_in_time: input.in_time ?? null,
  });
}

// List sub-lots awaiting check-in (status = 'created')
export async function listAwaitingCheckIn(): Promise<SubLot[]> {
  const list = await rpc<SubLot[]>('qc_list_sub_lots');
  return list.filter(s => s.status === 'created');
}

// List sub-lots in awaiting_recheck (displaced, paused)
export async function listAwaitingRecheck(): Promise<SubLot[]> {
  return rpc<SubLot[]>('qc_list_awaiting_recheck');
}

// Move a drying sub-lot to another cell. If the target is occupied,
// the occupant is displaced to awaiting_recheck (paused, time preserved).
export async function moveSubLot(input: {
  sub_lot_id: string;
  new_location_id: string;
}): Promise<SubLot> {
  return rpc<SubLot>('qc_move_sub_lot', {
    p_sub_lot_id: input.sub_lot_id,
    p_new_location_id: input.new_location_id,
  });
}

export async function checkOutSubLot(subLotId: string, outTime?: string | null): Promise<SubLot> {
  return rpc<SubLot>('qc_check_out_sub_lot', {
    p_sub_lot_id: subLotId,
    p_out_time: outTime ?? null,
  });
}

export async function checkOutSubLotsBulk(subLotIds: string[], outTime?: string | null): Promise<void> {
  for (const id of subLotIds) {
    await checkOutSubLot(id, outTime ?? null);
  }
}

export async function listPendingInspections(): Promise<SubLot[]> {
  return rpc<SubLot[]>('qc_list_pending_inspections');
}

export async function inspectionTemplateForSubLot(subLotId: string): Promise<{
  sub_lot: SubLot;
  template: { item_name: string; lower_limit: number; upper_limit: number };
}> {
  const { data: subRow, error: subErr } = await supabase
    .from('qc_drying_sub_lot')
    .select('id, production_lot_id')
    .eq('id', subLotId)
    .single();
  if (subErr || !subRow) throw new Error(subErr?.message ?? 'Sub-lot not found');

  const { data: lot, error: lotErr } = await supabase
    .from('qc_production_lot')
    .select('sku_id')
    .eq('id', subRow.production_lot_id)
    .single();
  if (lotErr || !lot) throw new Error(lotErr?.message ?? 'Production lot not found');

  const { data: tmpl, error: tmplErr } = await supabase
    .from('qc_inspection_template')
    .select('item_name, lower_limit, upper_limit')
    .eq('sku_id', lot.sku_id)
    .limit(1)
    .maybeSingle();
  if (tmplErr) throw new Error(tmplErr.message);
  if (!tmpl) throw new Error('No inspection template for SKU');

  const list = await rpc<SubLot[]>('qc_list_sub_lots', { p_production_lot_id: subRow.production_lot_id });
  const sub_lot = list.find(s => s.id === subLotId);
  if (!sub_lot) throw new Error('Sub-lot not found');

  return {
    sub_lot,
    template: {
      item_name: tmpl.item_name as string,
      lower_limit: Number(tmpl.lower_limit),
      upper_limit: Number(tmpl.upper_limit),
    },
  };
}

export async function submitInspection(
  subLotId: string,
  aw: number,
  samplePk?: string | null,
): Promise<InspectionResult> {
  return rpc<InspectionResult>('qc_submit_inspection', {
    p_sub_lot_id: subLotId,
    p_aw: aw,
    p_sample_pk: samplePk ?? null,
  });
}

// ── Samples ───────────────────────────────────────────────────────────────────

export type SampleStatus = 'pending' | 'inspected' | 'voided';

export interface Sample {
  id: string;                     // PK uuid
  drying_sub_lot_id: string;
  sample_id: string;              // user-entered identifier
  taken_at: string;
  status: SampleStatus;
  inspection_record_id?: string | null;
  aw?: number | null;
  result?: 'pass' | 'fail' | null;
}

export async function takeSample(input: { sub_lot_id: string; sample_id: string }): Promise<Sample> {
  return rpc<Sample>('qc_take_sample', {
    p_sub_lot_id: input.sub_lot_id,
    p_sample_id: input.sample_id,
  });
}

export async function listSamplesForSubLot(subLotId: string): Promise<Sample[]> {
  return rpc<Sample[]>('qc_list_samples_for_sub_lot', { p_sub_lot_id: subLotId });
}

export async function findSubLotsBySample(sampleId: string): Promise<Array<{
  sample_id: string;
  sample_pk: string;
  drying_sub_lot_id: string;
  taken_at: string;
  status: SampleStatus;
}>> {
  return rpc('qc_find_sub_lot_by_sample', { p_sample_id: sampleId });
}

export async function submitInspectionsBulk(items: Array<{ subLotId: string; aw: number }>): Promise<InspectionResult[]> {
  const results: InspectionResult[] = [];
  for (const item of items) {
    results.push(await submitInspection(item.subLotId, item.aw));
  }
  return results;
}

// ── Dispositions ──────────────────────────────────────────────────────────────

export type DispositionType =
  | 'rework' | 'grind' | 'scrap' | 'concession' | 'redry_dryer' | 'room_temp_dry';

export async function createDisposition(input: {
  drying_sub_lot_id: string;
  type: DispositionType;
  remark?: string | null;
  redry_expected_dry_minutes?: number | null;
}): Promise<{ id: string; new_status: SubLotStatus; type: DispositionType; redry_expected_dry_minutes: number | null }> {
  return rpc('qc_create_disposition', {
    p_sub_lot_id: input.drying_sub_lot_id,
    p_type: input.type,
    p_remark: input.remark ?? null,
    p_redry_expected_dry_minutes: input.redry_expected_dry_minutes ?? null,
  });
}

export async function createDispositionsBulk(
  subLotIds: string[],
  type: DispositionType,
  remark?: string | null,
): Promise<void> {
  for (const id of subLotIds) {
    await createDisposition({ drying_sub_lot_id: id, type, remark: remark ?? null });
  }
}

// ── Room temp dry ─────────────────────────────────────────────────────────────

export interface RoomTempDryingSubLot extends SubLot {
  room_temp_started_at: string;
  room_temp_elapsed_minutes: number;
}

export async function listRoomTempDrying(): Promise<RoomTempDryingSubLot[]> {
  return rpc<RoomTempDryingSubLot[]>('qc_list_room_temp_drying');
}

export async function stopRoomTempDry(subLotId: string): Promise<SubLot> {
  return rpc<SubLot>('qc_stop_room_temp_dry', { p_sub_lot_id: subLotId });
}

// ── Full sub-lot history (timeline view) ─────────────────────────────────────

export interface SubLotFullHistory {
  sub_lot: SubLot;
  spot_history: Array<{
    id: string;
    dryer_number: number | null;
    cell_number: number | null;
    started_at: string;
    ended_at: string | null;
    end_reason: 'check_out' | 'move' | 'displaced' | null;
    duration_minutes: number | null;
  }>;
  samples: Array<{
    id: string;
    sample_id: string;
    taken_at: string;
    status: SampleStatus;
    aw: number | null;
    result: 'pass' | 'fail' | null;
    inspection_record_id: string | null;
  }>;
  inspections: Array<{
    id: string;
    result: 'pass' | 'fail';
    aw: number | null;
    submitted_at: string;
    sample_id: string | null;
  }>;
  dispositions: Array<{
    id: string;
    type: DispositionType;
    remark: string | null;
    redry_expected_dry_minutes: number | null;
    created_at: string;
  }>;
  room_temp_sessions: Array<{
    id: string;
    started_at: string;
    ended_at: string | null;
    duration_minutes: number | null;
  }>;
  events: QualityEvent[];
}

export async function subLotFullHistory(subLotId: string): Promise<SubLotFullHistory> {
  return rpc<SubLotFullHistory>('qc_sub_lot_full_history', { p_sub_lot_id: subLotId });
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export async function dashboardSummary(): Promise<DashboardSummary> {
  return rpc<DashboardSummary>('qc_dashboard_summary');
}

// ── Unified QC Home + Dashboard overview ─────────────────────────────────────

export interface QcOverviewStats {
  expected_finish_today: number;
  currently_drying: number;
  room_temp_drying: number;
  awaiting_sample: number;
  awaiting_wa_result: number;
  passed_today: number;
  failed_today: number;
  longest_wait_minutes: number | null;
  pass_rate_pct: number | null;
}

export interface NeedsAttentionItem {
  inspection_id: string;
  drying_sub_lot_id: string;
  sub_lot_code: string;
  sku_name: string | null;
  lot_number: string | null;
  aw: number | null;
  result: 'pass' | 'fail';
  submitted_at: string;
  current_status: SubLotStatus;
  sample_id: string | null;
}

export interface QcOverview {
  today: string;
  stats: QcOverviewStats;
  needs_attention: NeedsAttentionItem[];
}

export async function getQcOverview(): Promise<QcOverview> {
  return rpc<QcOverview>('qc_overview');
}

// Release a passed sub-lot to next process (status: passed → closed)
export async function releasePassedSubLot(subLotId: string): Promise<SubLot> {
  return rpc<SubLot>('qc_release_passed_sub_lot', { p_sub_lot_id: subLotId });
}

// ── Demo seed ─────────────────────────────────────────────────────────────────

export async function seedDemoData(): Promise<{ skus: number; locations: number; production_lots: number; drying_sub_lots: number }> {
  return rpc('qc_seed_demo_data');
}

// ── Display helpers ───────────────────────────────────────────────────────────

export const STATUS_LABEL: Record<string, string> = {
  created: 'Created',
  drying: 'Drying',
  awaiting_recheck: 'Awaiting Re-place',
  room_temp_drying: 'Room Temp Dry',
  pending: 'Pending',
  inspecting: 'Inspecting',
  passed: 'Passed',
  hold: 'Hold',
  disposing: 'Disposing',
  closed: 'Closed',
};

export const STATUS_COLOR: Record<string, string> = {
  created: 'bg-slate-100 text-slate-700 border-slate-300',
  drying: 'bg-sky-100 text-sky-900 border-sky-300',
  awaiting_recheck: 'bg-amber-100 text-amber-900 border-amber-300',
  room_temp_drying: 'bg-orange-100 text-orange-900 border-orange-300',
  pending: 'bg-amber-100 text-amber-900 border-amber-300',
  inspecting: 'bg-blue-100 text-blue-900 border-blue-300',
  passed: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  hold: 'bg-red-100 text-red-900 border-red-300',
  disposing: 'bg-purple-100 text-purple-900 border-purple-300',
  closed: 'bg-slate-100 text-slate-700 border-slate-300',
};

export function formatQcDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function toLocalInputValue(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

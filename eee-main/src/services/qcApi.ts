import { supabase } from '../lib/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SubLotStatus =
  | 'created' | 'drying' | 'awaiting_recheck' | 'room_temp_drying'
  | 'pending' | 'inspecting' | 'passed' | 'hold' | 'disposing' | 'closed'
  | 'awaiting_group_result';

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
  produced_at?: string | null;
  status: SubLotStatus;
  expected_dry_minutes: number | null;
  expected_finish_at: string | null;
  total_dried_minutes: number | null;
  remaining_minutes: number | null;
  lot_number?: string | null;
  sku_id?: string | null;
  sku_code?: string | null;
  has_pending_sample?: boolean;
  latest_pending_sample_id?: string | null;
  latest_pending_sample_pk?: string | null;
  // M-048: sampling groups
  sample_every_n_carts?: number;
  test_group_id?: string | null;
  test_group_sequence?: number | null;
  test_group_status?: 'sampling' | 'passed' | 'closed_failed' | null;
  test_group_member_count?: number | null;
  is_test_champion?: boolean;
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
  expected_dry_minutes: number;  // M-050: required at lot creation (BR-Q29)
  created_at: string;
  // M-099: counts for the "scanned / total" badge on Batch Trace.
  // scanned_count = carts with scanned_for_check_in_at IS NOT NULL.
  // Optional because some legacy callers don't go through the M-099 RPC.
  scanned_count?: number;
  total_count?: number;
  // M-099: max -NNN suffix across ALL carts (incl. unscanned), so AddCarts
  // can default start_seq = max_seq + 1 even when unscanned carts are hidden
  // from the detail page's sub_lots list. Only emitted by lot_detail RPC.
  max_seq?: number;
}

export interface TestType {
  id: number;
  name: string;
  unit: string | null;
  description: string | null;
  is_active: boolean;
}

export interface InspectionTemplate {
  id: string;
  sku_id: string;
  test_type_id: number | null;  // M-087
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
  sample_every_n_carts?: number;  // M-048
  templates: InspectionTemplate[];
}

export interface TemplateInput {
  test_type_id: number;
  lower_limit: number;
  upper_limit: number;
}

export interface ProductInput {
  code?: string | null;  // M-050: auto-generated if absent (BR-Q33)
  name: string;
  standard_drying_minutes: number | null;
  sample_every_n_carts?: number;  // M-048
  templates: TemplateInput[];     // M-087: one entry per required test
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
  suggested?: 'pass' | 'fail' | null;
  remark?: string | null;
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

export async function createLocation(input: {
  dryer_number: number;
  cell_number: number;
  display_name: string;
  code?: string | null;
}): Promise<DryingLocation> {
  return rpc<DryingLocation>('qc_create_location', {
    p_dryer_number: input.dryer_number,
    p_cell_number: input.cell_number,
    p_display_name: input.display_name,
    p_code: input.code ?? null,
  });
}

export async function updateLocation(input: {
  id: string;
  display_name: string;
  code?: string | null;
}): Promise<DryingLocation> {
  return rpc<DryingLocation>('qc_update_location', {
    p_id: input.id,
    p_display_name: input.display_name,
    p_code: input.code ?? null,
  });
}

export async function deleteLocation(id: string): Promise<{ id: string; code: string; deleted: boolean }> {
  return rpc('qc_delete_location', { p_id: id });
}

export async function createProduct(input: ProductInput): Promise<Product> {
  for (const t of input.templates) {
    if (t.lower_limit > t.upper_limit) throw new Error('Lower limit cannot exceed upper limit');
  }

  // M-050: auto-generate SKU code when client doesn't supply one (BR-Q33).
  let code = input.code?.trim();
  if (!code) {
    code = await rpc<string>('qc_next_sku_code');
  }

  const { data: sku, error } = await supabase
    .from('qc_product_sku')
    .insert({
      code,
      name: input.name,
      standard_drying_minutes: input.standard_drying_minutes,
      sample_every_n_carts: input.sample_every_n_carts ?? 1,
    })
    .select('id, code, name, standard_drying_minutes, sample_every_n_carts')
    .single();
  if (error) throw new Error(error.message);

  // M-087: insert one template row per requested test type
  if (input.templates.length > 0) {
    const rows = input.templates.map(t => ({
      sku_id: sku.id,
      test_type_id: t.test_type_id,
      item_name: '',          // will be overwritten by qc_list_products JOIN
      lower_limit: t.lower_limit,
      upper_limit: t.upper_limit,
    }));
    // item_name is NOT NULL — derive it from the test type
    const { data: types } = await supabase
      .from('qc_test_type')
      .select('id, name, unit')
      .in('id', input.templates.map(t => t.test_type_id));
    const typeMap = Object.fromEntries((types ?? []).map((tt: { id: number; name: string; unit: string | null }) => [tt.id, tt]));
    const fullRows = rows.map(r => ({
      ...r,
      item_name: typeMap[r.test_type_id]?.name ?? 'Unknown',
      unit: typeMap[r.test_type_id]?.unit ?? null,
    }));
    const { error: tmplErr } = await supabase.from('qc_inspection_template').insert(fullRows);
    if (tmplErr) throw new Error(tmplErr.message);
  }

  const all = await listProducts();
  const found = all.find(p => p.id === sku.id);
  return found ?? ({ ...sku, templates: [] } as Product);
}

export async function updateProduct(id: string, input: Partial<ProductInput>): Promise<Product> {
  const skuPatch: Record<string, unknown> = {};
  if (input.code !== undefined) skuPatch.code = input.code;
  if (input.name !== undefined) skuPatch.name = input.name;
  if (input.standard_drying_minutes !== undefined) skuPatch.standard_drying_minutes = input.standard_drying_minutes;
  if (input.sample_every_n_carts !== undefined) skuPatch.sample_every_n_carts = input.sample_every_n_carts;
  if (Object.keys(skuPatch).length > 0) {
    const { error } = await supabase.from('qc_product_sku').update(skuPatch).eq('id', id);
    if (error) throw new Error(error.message);
  }
  // M-087: replace templates wholesale — delete existing, insert new set
  if (input.templates !== undefined) {
    const { error: delErr } = await supabase
      .from('qc_inspection_template').delete().eq('sku_id', id);
    if (delErr) throw new Error(delErr.message);
    if (input.templates.length > 0) {
      const { data: types } = await supabase
        .from('qc_test_type')
        .select('id, name, unit')
        .in('id', input.templates.map(t => t.test_type_id));
      const typeMap = Object.fromEntries((types ?? []).map((tt: { id: number; name: string; unit: string | null }) => [tt.id, tt]));
      const rows = input.templates.map(t => ({
        sku_id: id,
        test_type_id: t.test_type_id,
        item_name: typeMap[t.test_type_id]?.name ?? 'Unknown',
        unit: typeMap[t.test_type_id]?.unit ?? null,
        lower_limit: t.lower_limit,
        upper_limit: t.upper_limit,
      }));
      const { error: insErr } = await supabase.from('qc_inspection_template').insert(rows);
      if (insErr) throw new Error(insErr.message);
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

// M-086: SKU → ERP item links (one-to-many via qc_sku_item junction table).
// Returns a map of sku_id → array of item_ids.
export async function listProductItemLinks(): Promise<Record<string, number[]>> {
  const { data, error } = await supabase.from('qc_sku_item').select('sku_id, item_id');
  if (error) throw new Error(error.message);
  const map: Record<string, number[]> = {};
  (data ?? []).forEach((r: { sku_id: string; item_id: number }) => {
    if (!map[r.sku_id]) map[r.sku_id] = [];
    map[r.sku_id].push(r.item_id);
  });
  return map;
}

export async function addSkuItem(skuId: string, itemId: number): Promise<void> {
  const { error } = await supabase.from('qc_sku_item').insert({ sku_id: skuId, item_id: itemId });
  if (error) throw new Error(error.message);
}

export async function removeSkuItem(skuId: string, itemId: number): Promise<void> {
  const { error } = await supabase.from('qc_sku_item')
    .delete().eq('sku_id', skuId).eq('item_id', itemId);
  if (error) throw new Error(error.message);
}

// ── Test Type catalog (M-087) ─────────────────────────────────────────────────

export async function listTestTypes(): Promise<TestType[]> {
  const { data, error } = await supabase
    .from('qc_test_type')
    .select('*')
    .order('id');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createTestType(input: { name: string; unit?: string | null; description?: string | null }): Promise<TestType> {
  const { data, error } = await supabase
    .from('qc_test_type')
    .insert({ name: input.name.trim(), unit: input.unit ?? null, description: input.description ?? null })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateTestType(id: number, patch: { name?: string; unit?: string | null; description?: string | null; is_active?: boolean }): Promise<void> {
  const { error } = await supabase.from('qc_test_type').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteTestType(id: number): Promise<void> {
  const { error } = await supabase.from('qc_test_type').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ── Production lots ───────────────────────────────────────────────────────────

export async function listProductionLots(): Promise<ProductionLot[]> {
  return rpc<ProductionLot[]>('qc_list_production_lots');
}

export async function findLotsByWorkOrder(workOrderBarcode: string): Promise<ProductionLot[]> {
  const lots = await listProductionLots();
  return lots.filter(l => l.work_order_barcode === workOrderBarcode);
}

export async function listSubLotsForLot(lotId: string): Promise<SubLot[]> {
  const { data, error } = await supabase
    .from('qc_drying_sub_lot')
    .select('*')
    .eq('production_lot_id', lotId)
    .order('sub_lot_code', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as SubLot[];
}

// M-050: atomic lot + sub-lot range creation. expected_dry_minutes is required (BR-Q29).
// Sub-lot codes are <lot_barcode>-NNN (3-digit padded, BR-Q30).
export interface CreateProductionLotResult {
  lot_id: string;
  lot_number: string;
  lot_barcode: string;
  expected_dry_minutes: number;
  sub_lot_count: number;
  sub_lot_ids: string[];
}

export async function createProductionLot(input: {
  lot_barcode: string;
  work_order_barcode: string;
  sku_id: string;
  expected_dry_minutes: number;
  sub_lot_start_seq?: number;
  sub_lot_end_seq: number;
  lot_number?: string;
  packaging_item_id?: number | null;  // M-095
}): Promise<CreateProductionLotResult> {
  if (!input.expected_dry_minutes || input.expected_dry_minutes <= 0) {
    throw new Error('Expected dry time is required (BR-Q29)');
  }
  return rpc<CreateProductionLotResult>('qc_create_production_lot_with_sub_lots', {
    p_lot_number: input.lot_number ?? input.lot_barcode,
    p_lot_barcode: input.lot_barcode,
    p_work_order_barcode: input.work_order_barcode,
    p_sku_id: input.sku_id,
    p_expected_dry_minutes: input.expected_dry_minutes,
    p_sub_lot_start_seq: input.sub_lot_start_seq ?? 1,
    p_sub_lot_end_seq: input.sub_lot_end_seq,
    p_packaging_item_id: input.packaging_item_id ?? null,
  });
}

// Add more carts to an existing work order (continuing the 3-digit sequence).
export interface AddSubLotsResult {
  added_count: number;
  start_seq: number;
  end_seq: number;
  sub_lot_ids: string[];
}

export async function addSubLotsToLot(input: {
  production_lot_id: string;
  start_seq?: number | null;   // if null, continues from existing max + 1
  end_seq?: number | null;
  count?: number | null;       // alternative to end_seq
}): Promise<AddSubLotsResult> {
  return rpc<AddSubLotsResult>('qc_add_sub_lots_to_lot', {
    p_production_lot_id: input.production_lot_id,
    p_start_seq: input.start_seq ?? null,
    p_end_seq: input.end_seq ?? null,
    p_count: input.count ?? null,
  });
}

// M-050: move drying carts to a different dryer (BR-Q31).
export interface MoveDryerResult {
  requested: number;
  succeeded: Array<{ sub_lot_id: string; sub_lot_code: string; old_dryer: number | null; new_dryer: number }>;
  failed: Array<{ sub_lot_id: string; sub_lot_code?: string; reason: string; status?: string }>;
}

export async function moveSubLotsDryer(input: {
  sub_lot_ids: string[];
  new_dryer_number: number;
}): Promise<MoveDryerResult> {
  return rpc<MoveDryerResult>('qc_move_sub_lots_dryer', {
    p_sub_lot_ids: input.sub_lot_ids,
    p_new_dryer_number: input.new_dryer_number,
  });
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

// M-050: production wizard input — only min/max sub-lot sequence numbers
// (no per-cart code list). `expected_dry_minutes` is required (BR-Q29).
export interface ProductionBatchInput {
  production_date: string;          // YYYY-MM-DD
  shift: string;                    // early / late / night / other
  production_code: string;          // lot_number + lot_barcode
  work_order_barcode: string;
  sku_id: string;
  expected_dry_minutes: number;     // required; days → minutes converted by caller
  sub_lot_start_seq: number;        // inclusive, default 1
  sub_lot_end_seq: number;          // inclusive
  packaging_item_id?: number | null; // M-095 — final-product item picked from SKU's linked list
}

export interface ProductionBatchResult {
  lot_id: string;
  lot_number: string;
  lot_barcode: string;
  expected_dry_minutes: number;
  sub_lot_count: number;
  sub_lot_ids: string[];
}

export async function createProductionBatch(input: ProductionBatchInput): Promise<ProductionBatchResult> {
  if (!input.production_code) throw new Error('Production code is required');
  if (!input.work_order_barcode) throw new Error('Work order barcode is required');
  if (!input.sku_id) throw new Error('SKU is required');
  if (!input.expected_dry_minutes || input.expected_dry_minutes <= 0) {
    throw new Error('Expected dry time is required (BR-Q29)');
  }
  if (input.sub_lot_end_seq < input.sub_lot_start_seq) {
    throw new Error('Sub-lot max number must be >= min number');
  }

  return createProductionLot({
    lot_number: input.production_code,
    lot_barcode: input.production_code,
    work_order_barcode: input.work_order_barcode,
    sku_id: input.sku_id,
    expected_dry_minutes: input.expected_dry_minutes,
    sub_lot_start_seq: input.sub_lot_start_seq,
    sub_lot_end_seq: input.sub_lot_end_seq,
    packaging_item_id: input.packaging_item_id ?? null,
  });
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

// Bulk check-in (no cell selection) — used when qc.spot_selection_enabled = false.
// Each sub-lot occupies 1/100 of the dryer's capacity but has no cell_number.
export interface BulkCheckInResult {
  dryer_number: number;
  requested: number;
  succeeded: Array<{ sub_lot_id: string; sub_lot_code: string }>;
  failed: Array<{
    sub_lot_id: string;
    sub_lot_code?: string;
    reason: 'not_found' | 'wrong_status' | string;
    status?: string;
  }>;
}

export async function registerSubLotsBulk(input: {
  sub_lot_ids: string[];
  dryer_number: number;
  in_time?: string | null;
}): Promise<BulkCheckInResult> {
  return rpc<BulkCheckInResult>('qc_register_sub_lots_in_dryer_bulk', {
    p_sub_lot_ids: input.sub_lot_ids,
    p_dryer_number: input.dryer_number,
    p_in_time: input.in_time ?? null,
  });
}

// ── App settings (feature flags) ─────────────────────────────────────────────

export async function getAppSetting<T = unknown>(key: string): Promise<T | null> {
  const { data, error } = await supabase.rpc('get_app_setting', { p_key: key });
  if (error) throw new Error(error.message);
  return (data ?? null) as T | null;
}

// M-098: list only carts that have been physically scanned at the dryer
// (status='created' AND scanned_for_check_in_at IS NOT NULL).  Server-side
// filter via qc_list_awaiting_check_in() so we don't ship a full list to
// the client just to throw most of it away.
export async function listAwaitingCheckIn(): Promise<SubLot[]> {
  return rpc<SubLot[]>('qc_list_awaiting_check_in');
}

// M-098: stamp a cart as physically present at the dryer.  Idempotent —
// re-scanning a cart that's already stamped is a silent no-op.  Returns the
// updated sub-lot's id / code / status / scanned_for_check_in_at.
export async function scanCartForCheckIn(subLotId: string): Promise<{
  sub_lot_id: string;
  sub_lot_code: string;
  status: SubLotStatus;
  scanned_for_check_in_at: string | null;
}> {
  return rpc('qc_scan_cart_for_check_in', { p_sub_lot_id: subLotId });
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

// Legacy per-cart bulk (kept for callers that don't need sampling groups).
export async function checkOutSubLotsLegacy(subLotIds: string[], outTime?: string | null): Promise<void> {
  for (const id of subLotIds) {
    await checkOutSubLot(id, outTime ?? null);
  }
}

// M-048: Bulk check-out that also forms sampling groups + picks champions.
export interface BulkCheckOutGroup {
  test_group_id: string;
  group_sequence: number;
  production_lot_id: string;
  member_count: number;
  champion_id: string;
  member_ids: string[];
}
export interface BulkCheckOutResult {
  requested: number;
  succeeded: Array<{ sub_lot_id: string; sub_lot_code: string }>;
  failed: Array<{
    sub_lot_id: string;
    sub_lot_code?: string;
    reason: 'not_found' | 'wrong_status' | string;
    status?: string;
  }>;
  groups: BulkCheckOutGroup[];
}

export async function checkOutSubLotsBulk(input: {
  sub_lot_ids: string[];
  out_time?: string | null;
}): Promise<BulkCheckOutResult> {
  return rpc<BulkCheckOutResult>('qc_check_out_sub_lots_bulk', {
    p_sub_lot_ids: input.sub_lot_ids,
    p_out_time: input.out_time ?? null,
  });
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
  result?: 'pass' | 'fail' | null,
  remark?: string | null,
): Promise<InspectionResult> {
  return rpc<InspectionResult>('qc_submit_inspection', {
    p_sub_lot_id: subLotId,
    p_aw: aw,
    p_sample_pk: samplePk ?? null,
    p_result: result ?? null,
    p_remark: remark ?? null,
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
  | 'rework' | 'grind' | 'scrap' | 'concession'
  | 'redry_dryer' | 'room_temp_dry' | 'retest';

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
    remark: string | null;
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

// M-050: per-SKU pass-rate forecast.
// Predicted passes = round(in_progress_carts × today_pass_rate). When the SKU
// has no inspections today, the forecast assumes 100% rate.
export interface PassRateForecastItem {
  sku_id: string;
  sku_code: string;
  sku_name: string;
  in_progress: number;
  today_pass_rate: number | null;
  today_inspections: number;
  forecast_passes: number;
}

export async function dashboardPassRateForecast(): Promise<PassRateForecastItem[]> {
  return rpc<PassRateForecastItem[]>('qc_dashboard_pass_rate_forecast');
}

// M-093: per-SKU pipeline summary used by the Production dashboard.
export interface ProductionPipelineItem {
  sku_id: string;
  sku_code: string;
  sku_name: string;
  production_count: number;   // status='created'
  dry_room_count: number;     // drying / awaiting_recheck / room_temp_drying
  testing_count: number;      // pending / inspecting / awaiting_group_result / hold / passed
  released_count: number;     // status='closed'  (released, not yet dispatched)
  packaged_count: number;     // status='dispatched'
  total: number;
}

export async function productionPipelineSummary(): Promise<ProductionPipelineItem[]> {
  return rpc<ProductionPipelineItem[]>('qc_production_pipeline_summary');
}

// M-050: analysis page metrics with filters (BR-Q32).
export interface AnalysisMetrics {
  total_sub_lots: number;
  avg_dry_minutes: number | null;
  first_inspection_count: number;
  first_pass_count: number;
  first_fail_count: number;
  pass_rate: number | null;
  retest_count: number;
  retest_pass_rate: number | null;
  redry_count: number;
  redry_avg_minutes: number | null;
  redry_pass_rate: number | null;
  room_temp_count: number;
  room_temp_avg_minutes: number | null;
  room_temp_pass_rate: number | null;
  scrap_count: number;
}

export async function analysisMetrics(input: {
  sku_id?: string | null;
  from_date?: string | null;       // YYYY-MM-DD (inclusive)
  to_date?: string | null;         // YYYY-MM-DD (inclusive)
  dryer_number?: number | null;
  production_lot_id?: string | null;
}): Promise<AnalysisMetrics> {
  return rpc<AnalysisMetrics>('qc_analysis_metrics', {
    p_sku_id: input.sku_id ?? null,
    p_from_date: input.from_date ?? null,
    p_to_date: input.to_date ?? null,
    p_dryer_number: input.dryer_number ?? null,
    p_production_lot_id: input.production_lot_id ?? null,
  });
}

// M-072: per-cart drill-down for a recovery path
export interface RecoveryDetailItem {
  disposition_id: string;
  sub_lot_id: string;
  sub_lot_code: string;
  sku_name: string | null;
  lot_number: string | null;
  work_order_barcode: string | null;
  disposition_type: 'retest' | 'redry_dryer' | 'room_temp_dry';
  disposition_at: string;
  dwell_minutes: number | null;
  next_result: 'pass' | 'fail' | null;
  next_aw: number | null;
  remark: string | null;
}

export async function analysisRecoveryDetail(input: {
  type: 'retest' | 'redry_dryer' | 'room_temp_dry';
  sku_id?: string | null;
  from_date?: string | null;
  to_date?: string | null;
  dryer_number?: number | null;
  production_lot_id?: string | null;
}): Promise<RecoveryDetailItem[]> {
  return rpc<RecoveryDetailItem[]>('qc_analysis_recovery_detail', {
    p_type: input.type,
    p_sku_id: input.sku_id ?? null,
    p_from_date: input.from_date ?? null,
    p_to_date: input.to_date ?? null,
    p_dryer_number: input.dryer_number ?? null,
    p_production_lot_id: input.production_lot_id ?? null,
  });
}

// ── Avg-dry-time drill-down (Analysis page) ─────────────────────────────────

export interface AvgDryTimeDaily {
  date: string;             // YYYY-MM-DD
  sub_lot_count: number;
  avg_dry_minutes: number;
}

export async function analysisAvgDryTimeDaily(input: {
  sku_id?: string | null;
  from_date?: string | null;
  to_date?: string | null;
  dryer_number?: number | null;
  production_lot_id?: string | null;
}): Promise<AvgDryTimeDaily[]> {
  return rpc<AvgDryTimeDaily[]>('qc_analysis_avg_dry_time_daily', {
    p_sku_id: input.sku_id ?? null,
    p_from_date: input.from_date ?? null,
    p_to_date: input.to_date ?? null,
    p_dryer_number: input.dryer_number ?? null,
    p_production_lot_id: input.production_lot_id ?? null,
  });
}

export interface AvgDryTimeByWorkOrder {
  production_lot_id: string;
  lot_number: string;
  work_order_barcode: string | null;
  sku_code: string;
  sku_name: string;
  sub_lot_count: number;
  min_dry_minutes: number;
  max_dry_minutes: number;
  avg_dry_minutes: number;
  median_dry_minutes: number;
}

export async function analysisAvgDryTimeByWorkOrder(input: {
  day: string;              // YYYY-MM-DD
  sku_id?: string | null;
  dryer_number?: number | null;
  production_lot_id?: string | null;
}): Promise<AvgDryTimeByWorkOrder[]> {
  return rpc<AvgDryTimeByWorkOrder[]>('qc_analysis_avg_dry_time_by_work_order', {
    p_day: input.day,
    p_sku_id: input.sku_id ?? null,
    p_dryer_number: input.dryer_number ?? null,
    p_production_lot_id: input.production_lot_id ?? null,
  });
}

// ── Pass / fail / pass-rate drill-down (Analysis page) ──────────────────────

export interface OutcomesDaily {
  date: string;             // YYYY-MM-DD
  sub_lot_count: number;
  pass_count: number;
  fail_count: number;
  pass_rate: number | null;
}

export async function analysisOutcomesDaily(input: {
  sku_id?: string | null;
  from_date?: string | null;
  to_date?: string | null;
  dryer_number?: number | null;
  production_lot_id?: string | null;
}): Promise<OutcomesDaily[]> {
  return rpc<OutcomesDaily[]>('qc_analysis_outcomes_daily', {
    p_sku_id: input.sku_id ?? null,
    p_from_date: input.from_date ?? null,
    p_to_date: input.to_date ?? null,
    p_dryer_number: input.dryer_number ?? null,
    p_production_lot_id: input.production_lot_id ?? null,
  });
}

export interface OutcomesByWorkOrder {
  production_lot_id: string;
  lot_number: string;
  work_order_barcode: string | null;
  sku_code: string;
  sku_name: string;
  sub_lot_count: number;
  pass_count: number;
  fail_count: number;
  pass_rate: number | null;
}

export async function analysisOutcomesByWorkOrder(input: {
  day: string;
  sku_id?: string | null;
  dryer_number?: number | null;
  production_lot_id?: string | null;
}): Promise<OutcomesByWorkOrder[]> {
  return rpc<OutcomesByWorkOrder[]>('qc_analysis_outcomes_by_work_order', {
    p_day: input.day,
    p_sku_id: input.sku_id ?? null,
    p_dryer_number: input.dryer_number ?? null,
    p_production_lot_id: input.production_lot_id ?? null,
  });
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
  /** Champion / solo cart that was actually tested */
  drying_sub_lot_id: string;
  sub_lot_code: string;
  sku_name: string | null;
  lot_number: string | null;
  work_order_barcode: string | null;
  aw: number | null;
  result: 'pass' | 'fail';
  submitted_at: string;
  current_status: SubLotStatus;
  sample_id: string | null;
  /** Sampling-group fields (group_size=1 and arrays have one element for solo carts) */
  test_group_id: string | null;
  group_size: number;
  group_sub_lot_ids: string[];
  group_sub_lot_codes: string[];
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

/** Release every cart in a sampling group (all are in 'passed' status). */
export async function releasePassedSubLotsGroup(subLotIds: string[]): Promise<void> {
  await Promise.all(subLotIds.map(id => releasePassedSubLot(id)));
}

/** Apply the same disposition to every cart in a sampling group. */
export async function createDispositionGroup(input: {
  sub_lot_ids: string[];
  type: DispositionType;
  remark: string | null;
  redry_expected_dry_minutes: number | null;
}): Promise<void> {
  // Retest is a group-level action: a single qc_create_disposition call
  // normalises the whole group around one champion (M-106). Calling it per
  // cart would race/shatter the group, so fire it exactly once. Every other
  // disposition type (scrap / redry / room-temp) is genuinely per-cart.
  if (input.type === 'retest') {
    await createDisposition({
      drying_sub_lot_id: input.sub_lot_ids[0],
      type: input.type,
      remark: input.remark,
      redry_expected_dry_minutes: input.redry_expected_dry_minutes,
    });
    return;
  }
  await Promise.all(
    input.sub_lot_ids.map(id =>
      createDisposition({
        drying_sub_lot_id: id,
        type: input.type,
        remark: input.remark,
        redry_expected_dry_minutes: input.redry_expected_dry_minutes,
      }),
    ),
  );
}

// Look up a sub-lot by its scanned QR / barcode code (M-043).
// Accepts raw code or URL where the last path segment is the code.
// Returns null if no match.
export async function findSubLotByCode(code: string): Promise<SubLot | null> {
  const { data, error } = await supabase.rpc('qc_find_sub_lot_by_code', { p_code: code });
  if (error) throw new Error(error.message);
  return (data ?? null) as SubLot | null;
}

// ── Demo seed ─────────────────────────────────────────────────────────────────

export async function seedDemoData(): Promise<{ skus: number; locations: number; production_lots: number; drying_sub_lots: number }> {
  return rpc('qc_seed_demo_data');
}

// ── Testing Dashboard ─────────────────────────────────────────────────────────

export interface TestingDayForecast {
  date: string;          // YYYY-MM-DD
  label: string;         // "Today" | "Tomorrow" | "Day 3"
  products: Array<{
    sku_name: string;
    sku_code: string | null;
    count: number;          // number of carts expected to finish on that day
    samples_needed: number; // ceil(count / sample_every_n_carts)
  }>;
  total: number;
  total_samples: number;   // sum of samples_needed across all SKUs
}

export interface TestingDashboardData {
  forecast: TestingDayForecast[];       // next 3 days
  today_summary: {
    awaiting_sample: number;            // pending sub-lots with no sample taken
    sample_taken: number;               // pending sub-lots that have a sample
    awaiting_result: number;            // samples taken but no result entered yet
    completed_today: number;            // sub-lots with result submitted today
  };
}

export async function getTestingDashboard(): Promise<TestingDashboardData> {
  // Fetch currently drying sub-lots for forecast.
  // expected_finish_at is a computed value (in_time + expected_dry_minutes), not a real column.
  // sku_name / sku_code live on qc_product_sku via qc_production_lot join.
  const { data: drying, error: dErr } = await supabase
    .from('qc_drying_sub_lot')
    .select(`
      id, in_time, expected_dry_minutes, status,
      qc_production_lot (
        qc_product_sku ( name, code, sample_every_n_carts )
      )
    `)
    .eq('status', 'drying')
    .not('in_time', 'is', null)
    .not('expected_dry_minutes', 'is', null);
  if (dErr) throw new Error(dErr.message);

  // Build 3-day forecast
  const today = new Date(); today.setHours(0,0,0,0);
  const days = [0,1,2].map(offset => {
    const d = new Date(today); d.setDate(d.getDate() + offset);
    return d.toISOString().split('T')[0];
  });
  const labels = ['Today', 'Tomorrow', 'Day 3'];

  const forecast: TestingDayForecast[] = days.map((date, i) => {
    const carts = (drying ?? []).filter(s => {
      if (!s.in_time || !s.expected_dry_minutes) return false;
      // Compute expected finish from in_time + expected_dry_minutes
      const finishMs = new Date(s.in_time).getTime() + (s.expected_dry_minutes as number) * 60_000;
      const d = new Date(finishMs).toISOString().split('T')[0];
      return d === date;
    });
    // group by sku (sku data comes via the nested join)
    const skuMap = new Map<string, { sku_name: string; sku_code: string | null; count: number; n: number }>();
    for (const c of carts) {
      const lot = c.qc_production_lot as { qc_product_sku?: { name?: string; code?: string; sample_every_n_carts?: number } } | null;
      const skuName = lot?.qc_product_sku?.name ?? 'Unknown';
      const skuCode = lot?.qc_product_sku?.code ?? null;
      const n = lot?.qc_product_sku?.sample_every_n_carts ?? 1;
      const existing = skuMap.get(skuName);
      if (existing) existing.count++;
      else skuMap.set(skuName, { sku_name: skuName, sku_code: skuCode, count: 1, n });
    }
    const products = Array.from(skuMap.values()).map(({ sku_name, sku_code, count, n }) => ({
      sku_name,
      sku_code,
      count,
      samples_needed: Math.ceil(count / Math.max(n, 1)),
    }));
    const total_samples = products.reduce((sum, p) => sum + p.samples_needed, 0);
    return { date, label: labels[i], products, total: carts.length, total_samples };
  });

  // Fetch pending sub-lots (checked out, awaiting testing)
  const pending = await listPendingInspections();
  const awaiting_sample = pending.filter(s => !s.has_pending_sample).length;
  const sample_taken = pending.filter(s => s.has_pending_sample).length;

  // Fetch today's completed inspections count
  const todayStr = days[0];
  const nextStr = days[1] ?? new Date(new Date(todayStr).getTime() + 86400000).toISOString().split('T')[0];
  const { count: completedCount } = await supabase
    .from('qc_inspection_record')
    .select('id', { count: 'exact', head: true })
    .gte('submitted_at', todayStr + 'T00:00:00Z')
    .lt('submitted_at', nextStr + 'T00:00:00Z');
  const completed_today = completedCount ?? 0;

  // awaiting_result = samples taken but not yet have result
  const { count: awaitingCount } = await supabase
    .from('qc_sample')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');

  return {
    forecast,
    today_summary: {
      awaiting_sample,
      sample_taken,
      awaiting_result: awaitingCount ?? sample_taken,
      completed_today,
    },
  };
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
  awaiting_group_result: 'Awaiting Group Result',
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
  awaiting_group_result: 'bg-indigo-100 text-indigo-900 border-indigo-300',
};

/** Format a UTC ISO timestamp as Dallas local time (America/Chicago). */
export function formatQcDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date(iso));
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
    return `${get('month')}/${get('day')} ${get('hour')}:${get('minute')} ${get('dayPeriod')}`;
  } catch {
    return iso;
  }
}

export function toLocalInputValue(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface FailGroupMember {
  id: string;
  sub_lot_code: string;
  status: string;
  is_champion: boolean;
}
export interface RecentFailItem {
  inspection_id: string;
  sample_id: string | null;
  aw: number | null;
  submitted_at: string;
  sku_name: string | null;
  lot_number: string | null;
  work_order_barcode: string | null;
  champion_code: string;
  test_group_id: string | null;
  group_members: FailGroupMember[];
}
export async function getRecentFailedInspections(days = 2): Promise<RecentFailItem[]> {
  return rpc<RecentFailItem[]>('qc_recent_failed_inspections', { p_days: days });
}

/** Fetch all sub-lots that belong to the same test group (by test_group_id). */
export async function getGroupMembers(testGroupId: string): Promise<Array<{ id: string; sub_lot_code: string; is_test_champion: boolean; status: string }>> {
  const { data, error } = await supabase
    .from('qc_drying_sub_lot')
    .select('id, sub_lot_code, is_test_champion, status')
    .eq('test_group_id', testGroupId)
    .order('sub_lot_code');
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ id: string; sub_lot_code: string; is_test_champion: boolean; status: string }>;
}

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
  work_order_barcode?: string | null;   // M-053: emitted by qc_sub_lot_to_json
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
  // M-164: every cart's sub_lot_code for this WO, so Batch Trace search can
  // match a full sub-lot number directly. Only emitted by the list RPC.
  sub_lot_codes?: string[];
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
  // M-118: soft band. Backfilled = hard on existing rows so override is closed
  // by default; ops widens per SKU to enable supervisor discretion.
  soft_lower_limit: number;
  soft_upper_limit: number;
}

export interface Product {
  id: string;
  code: string;
  name: string;
  standard_drying_minutes: number | null;
  sample_every_n_carts?: number;  // M-048
  cart_units?: number;            // M-125: capacity units one cart consumes (e.g. 1 or 1.5)
  templates: InspectionTemplate[];
}

export interface TemplateInput {
  test_type_id: number;
  lower_limit: number;
  upper_limit: number;
  // M-118: soft band must wrap hard ([soft_lower, lower) ∪ (upper, soft_upper]
  // = supervisor-decided range). soft = hard disables the supervisor override.
  soft_lower_limit: number;
  soft_upper_limit: number;
}

export interface ProductInput {
  code?: string | null;  // M-050: auto-generated if absent (BR-Q33)
  name: string;
  standard_drying_minutes: number | null;
  sample_every_n_carts?: number;  // M-048
  cart_units?: number;            // M-125: capacity units per cart (default 1)
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
  /** M-149: account that performed the action (full name or email). */
  actor?: string | null;
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

// ── Dry rooms (room-level capacity; the new smallest unit) ───────────────────
export interface DryRoom {
  id: string;
  dryer_number: number;
  capacity: number;
}

export async function listDryRooms(): Promise<DryRoom[]> {
  const { data, error } = await supabase
    .from('qc_dry_room')
    .select('id, dryer_number, capacity')
    .order('dryer_number');
  if (error) throw new Error(error.message);
  return (data ?? []) as DryRoom[];
}

export async function createDryRoom(input: { dryer_number: number; capacity: number }): Promise<DryRoom> {
  const { data, error } = await supabase
    .from('qc_dry_room')
    .insert({ dryer_number: input.dryer_number, capacity: input.capacity })
    .select('id, dryer_number, capacity')
    .single();
  if (error) throw new Error(error.message);
  return data as DryRoom;
}

export async function updateDryRoomCapacity(id: string, capacity: number): Promise<DryRoom> {
  const { data, error } = await supabase
    .from('qc_dry_room')
    .update({ capacity })
    .eq('id', id)
    .select('id, dryer_number, capacity')
    .single();
  if (error) throw new Error(error.message);
  return data as DryRoom;
}

export async function deleteDryRoom(id: string): Promise<void> {
  const { error } = await supabase.from('qc_dry_room').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ── Product / Test-Type audit log (M-148, BR-Q80) ─────────────────────────────
// Mirrors finance_audit_log's logFinanceAction: fire-and-forget, resolves the
// actor's display name from erp_user, never throws into the calling operation.

export interface ProductAuditLogEntry {
  id: number;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_auth_id: string | null;
  actor_name: string;
  changed_at: string;
  before_snapshot: Record<string, unknown> | null;
  after_snapshot: Record<string, unknown> | null;
  diff: Record<string, { before: unknown; after: unknown }> | null;
  entry_number: string | null;
  description: string | null;
}

function computeProductDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { before: unknown; after: unknown }> | null {
  const result: Record<string, { before: unknown; after: unknown }> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      result[k] = { before: before[k], after: after[k] };
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

async function logProductAction(params: {
  entity_type: 'product' | 'test_type' | 'product_import';
  entity_id: string | number;
  action: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  entry_number?: string | null;
  description?: string | null;
}): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: erpRow } = await supabase
      .from('erp_user')
      .select('full_name')
      .eq('auth_user_id', user.id)
      .single();

    const diff = params.before && params.after
      ? computeProductDiff(params.before, params.after)
      : null;

    await supabase.from('qc_product_audit_log').insert({
      entity_type: params.entity_type,
      entity_id:   String(params.entity_id),
      action:      params.action,
      actor_auth_id: user.id,
      actor_name:  erpRow?.full_name ?? user.email ?? 'Unknown',
      before_snapshot: params.before ?? null,
      after_snapshot:  params.after  ?? null,
      diff,
      entry_number: params.entry_number ?? null,
      description:  params.description  ?? null,
    });
  } catch {
    // Logging must never break the main operation
  }
}

export async function getProductAuditLog(params?: {
  entity_type?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<ProductAuditLogEntry[]> {
  let query = supabase
    .from('qc_product_audit_log')
    .select('*')
    .order('changed_at', { ascending: false })
    .range(params?.offset ?? 0, (params?.offset ?? 0) + (params?.limit ?? 100) - 1);

  if (params?.entity_type) query = query.eq('entity_type', params.entity_type);
  if (params?.search) {
    const q = params.search.trim();
    query = query.or(`description.ilike.%${q}%,entry_number.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data as ProductAuditLogEntry[];
}

const PRODUCT_CORE_COLS = 'code, name, standard_drying_minutes, sample_every_n_carts, cart_units';

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
      sample_every_n_carts: input.sample_every_n_carts ?? 3,
      cart_units: input.cart_units ?? 1,
    })
    .select('id, code, name, standard_drying_minutes, sample_every_n_carts, cart_units')
    .single();
  if (error) throw new Error(error.message);

  // M-087: insert one template row per requested test type
  if (input.templates.length > 0) {
    const rows = input.templates.map(t => ({
      sku_id: sku.id,
      test_type_id: t.test_type_id,
      item_name: '',          // will be overwritten by qc_list_products JOIN
      lower_limit:      t.lower_limit,
      upper_limit:      t.upper_limit,
      soft_lower_limit: t.soft_lower_limit,
      soft_upper_limit: t.soft_upper_limit,
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

  void logProductAction({
    entity_type: 'product',
    entity_id: sku.id,
    action: 'create',
    after: {
      code: sku.code, name: sku.name,
      standard_drying_minutes: sku.standard_drying_minutes,
      sample_every_n_carts: sku.sample_every_n_carts,
      cart_units: sku.cart_units,
    },
    entry_number: sku.code,
    description: `Created product ${sku.code} — ${sku.name}`,
  });

  const all = await listProducts();
  const found = all.find(p => p.id === sku.id);
  return found ?? ({ ...sku, templates: [] } as Product);
}

export async function updateProduct(id: string, input: Partial<ProductInput>): Promise<Product> {
  // Snapshot core fields before mutating, for the audit diff.
  const { data: beforeRow } = await supabase
    .from('qc_product_sku').select(PRODUCT_CORE_COLS).eq('id', id).single();

  const skuPatch: Record<string, unknown> = {};
  if (input.code !== undefined) skuPatch.code = input.code;
  if (input.name !== undefined) skuPatch.name = input.name;
  if (input.standard_drying_minutes !== undefined) skuPatch.standard_drying_minutes = input.standard_drying_minutes;
  if (input.sample_every_n_carts !== undefined) skuPatch.sample_every_n_carts = input.sample_every_n_carts;
  if (input.cart_units !== undefined) skuPatch.cart_units = input.cart_units;
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
        lower_limit:      t.lower_limit,
        upper_limit:      t.upper_limit,
        soft_lower_limit: t.soft_lower_limit,
        soft_upper_limit: t.soft_upper_limit,
      }));
      const { error: insErr } = await supabase.from('qc_inspection_template').insert(rows);
      if (insErr) throw new Error(insErr.message);
    }
  }
  const all = await listProducts();
  const found = all.find(p => p.id === id);
  if (!found) throw new Error('Product not found');

  void logProductAction({
    entity_type: 'product',
    entity_id: id,
    action: 'edit',
    before: beforeRow ?? null,
    after: {
      code: found.code, name: found.name,
      standard_drying_minutes: found.standard_drying_minutes,
      sample_every_n_carts: found.sample_every_n_carts,
      cart_units: found.cart_units,
    },
    entry_number: found.code,
    description: `Updated product ${found.code}`,
  });

  return found;
}

export async function deleteProduct(id: string): Promise<void> {
  const { data: beforeRow } = await supabase
    .from('qc_product_sku').select(PRODUCT_CORE_COLS).eq('id', id).single();
  const { error } = await supabase.from('qc_product_sku').delete().eq('id', id);
  if (error) throw new Error(error.message);
  void logProductAction({
    entity_type: 'product',
    entity_id: id,
    action: 'delete',
    before: beforeRow ?? null,
    entry_number: (beforeRow as { code?: string } | null)?.code ?? null,
    description: `Deleted product ${(beforeRow as { code?: string } | null)?.code ?? id}`,
  });
}

export async function deleteProducts(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { data: beforeRows } = await supabase
    .from('qc_product_sku').select('id, code, name').in('id', ids);
  const { error } = await supabase.from('qc_product_sku').delete().in('id', ids);
  if (error) throw new Error(error.message);
  for (const row of (beforeRows ?? []) as { id: string; code: string; name: string }[]) {
    void logProductAction({
      entity_type: 'product',
      entity_id: row.id,
      action: 'delete',
      before: { code: row.code, name: row.name },
      entry_number: row.code,
      description: `Deleted product ${row.code}`,
    });
  }
}

// ── Excel import (BR-Q81) ─────────────────────────────────────────────────────
// Phase 1: core fields only, matched by `code` (S2 WIP code).  A row whose code
// matches an existing product updates its core fields (templates / final-product
// links are left untouched); a row with no match (or blank code) creates a new
// product with no test templates.  Rows are NOT deleted for codes absent from
// the sheet — import never removes products.
//
// The caller (ProductManagement) only passes rows that actually changed
// (unchanged rows are filtered out in the preview), so this loop is normally
// tiny.  Each row is a single lightweight UPDATE/INSERT — we deliberately do
// NOT route through updateProduct/createProduct here, because those re-fetch
// the whole product list and write a per-row audit entry, which made a 379-row
// import take minutes.  One summary `product_import` audit entry is written at
// the end instead.  `onProgress` drives the UI progress bar; `signal` lets the
// user abort mid-run (already-committed rows stay — re-importing is idempotent).

export interface ProductImportRow {
  code?: string | null;
  name: string;
  standard_drying_minutes: number | null;
  sample_every_n_carts?: number;
  cart_units?: number;
  // BR-Q81 phase 2: required-test templates.  `undefined` = the import sheet
  // had no "Required Tests" column → leave a product's tests untouched.  An
  // array (possibly empty) = replace the product's templates wholesale.
  templates?: TemplateInput[];
}

export interface ProductImportResult { created: number; updated: number; processed: number; total: number; aborted: boolean; }

// Replace a SKU's inspection templates wholesale (delete + insert), deriving
// item_name/unit from the test-type catalog — same shape as create/updateProduct.
async function replaceProductTemplates(
  skuId: string,
  templates: TemplateInput[],
  typeMap: Record<number, { name: string; unit: string | null }>,
): Promise<void> {
  const { error: delErr } = await supabase.from('qc_inspection_template').delete().eq('sku_id', skuId);
  if (delErr) throw new Error(delErr.message);
  if (templates.length === 0) return;
  const rows = templates.map(t => ({
    sku_id: skuId,
    test_type_id: t.test_type_id,
    item_name: typeMap[t.test_type_id]?.name ?? 'Unknown',
    unit: typeMap[t.test_type_id]?.unit ?? null,
    lower_limit:      t.lower_limit,
    upper_limit:      t.upper_limit,
    soft_lower_limit: t.soft_lower_limit,
    soft_upper_limit: t.soft_upper_limit,
  }));
  const { error: insErr } = await supabase.from('qc_inspection_template').insert(rows);
  if (insErr) throw new Error(insErr.message);
}

export async function importProducts(
  rows: ProductImportRow[],
  opts?: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal },
): Promise<ProductImportResult> {
  const existing = await listProducts();
  const byCode = new Map(existing.map(p => [p.code.trim().toLowerCase(), p]));
  // Test-type catalog for item_name/unit derivation when replacing templates.
  const { data: types } = await supabase.from('qc_test_type').select('id, name, unit');
  const typeMap: Record<number, { name: string; unit: string | null }> =
    Object.fromEntries((types ?? []).map((tt: { id: number; name: string; unit: string | null }) => [tt.id, tt]));
  const total = rows.length;
  let created = 0;
  let updated = 0;
  let processed = 0;
  let aborted = false;
  // Per-row record of what the import touched, stored in the audit snapshot so
  // the Change Log can show exactly which products were created / updated.
  const items: { code: string; name: string; action: 'create' | 'update' }[] = [];

  for (const row of rows) {
    if (opts?.signal?.aborted) { aborted = true; break; }
    const code = row.code?.trim();
    const match = code ? byCode.get(code.toLowerCase()) : undefined;
    if (match) {
      const patch: Record<string, unknown> = {
        name: row.name,
        standard_drying_minutes: row.standard_drying_minutes,
      };
      if (row.sample_every_n_carts !== undefined) patch.sample_every_n_carts = row.sample_every_n_carts;
      if (row.cart_units !== undefined) patch.cart_units = row.cart_units;
      const { error } = await supabase.from('qc_product_sku').update(patch).eq('id', match.id);
      if (error) throw new Error(error.message);
      if (row.templates !== undefined) await replaceProductTemplates(match.id, row.templates, typeMap);
      updated++;
      items.push({ code: match.code, name: row.name, action: 'update' });
    } else {
      const newCode = code && code.length ? code : await rpc<string>('qc_next_sku_code');
      const { data: ins, error } = await supabase.from('qc_product_sku').insert({
        code: newCode,
        name: row.name,
        standard_drying_minutes: row.standard_drying_minutes,
        sample_every_n_carts: row.sample_every_n_carts ?? 3,
        cart_units: row.cart_units ?? 1,
      }).select('id').single();
      if (error) throw new Error(error.message);
      if (row.templates !== undefined && row.templates.length > 0) {
        await replaceProductTemplates(ins.id, row.templates, typeMap);
      }
      created++;
      items.push({ code: newCode, name: row.name, action: 'create' });
    }
    processed++;
    opts?.onProgress?.(processed, total);
  }

  void logProductAction({
    entity_type: 'product_import',
    entity_id: 'import',
    action: 'import',
    after: { created, updated, processed, total, aborted, items },
    description: `Imported products from Excel — ${created} created, ${updated} updated`
      + (aborted ? ` (cancelled after ${processed}/${total})` : ''),
  });
  return { created, updated, processed, total, aborted };
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

// S4: minimal production_lot lookup used by ReleaseDialog when it needs to
// resolve sku_id from a PACKAGING_REQUIRED:<production_lot_id> error.
export async function getProductionLotSku(productionLotId: string): Promise<{ sku_id: string | null; sku_code: string | null; packaging_item_id: number | null }> {
  const { data, error } = await supabase
    .from('qc_production_lot')
    .select('sku_id, packaging_item_id, sku:sku_id(code)')
    .eq('id', productionLotId)
    .single();
  if (error) throw new Error(error.message);
  // supabase-js infers embedded selects as arrays even on single-FK joins;
  // cast through unknown to unwrap.
  const row = data as unknown as {
    sku_id: string | null;
    packaging_item_id: number | null;
    sku: { code: string } | { code: string }[] | null;
  };
  const skuObj = Array.isArray(row.sku) ? row.sku[0] : row.sku;
  return {
    sku_id: row.sku_id,
    sku_code: skuObj?.code ?? null,
    packaging_item_id: row.packaging_item_id,
  };
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
  void logProductAction({
    entity_type: 'test_type',
    entity_id: data.id,
    action: 'create',
    after: { name: data.name, unit: data.unit, description: data.description },
    entry_number: data.name,
    description: `Created test type ${data.name}`,
  });
  return data;
}

export async function updateTestType(id: number, patch: { name?: string; unit?: string | null; description?: string | null; is_active?: boolean }): Promise<void> {
  const { data: beforeRow } = await supabase
    .from('qc_test_type').select('name, unit, description, is_active').eq('id', id).single();
  const { error } = await supabase.from('qc_test_type').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
  const { data: afterRow } = await supabase
    .from('qc_test_type').select('name, unit, description, is_active').eq('id', id).single();
  void logProductAction({
    entity_type: 'test_type',
    entity_id: id,
    action: 'edit',
    before: beforeRow ?? null,
    after: afterRow ?? null,
    entry_number: (afterRow as { name?: string } | null)?.name ?? (beforeRow as { name?: string } | null)?.name ?? null,
    description: `Updated test type ${(afterRow as { name?: string } | null)?.name ?? id}`,
  });
}

export async function deleteTestType(id: number): Promise<void> {
  const { data: beforeRow } = await supabase
    .from('qc_test_type').select('name, unit, description').eq('id', id).single();
  const { error } = await supabase.from('qc_test_type').delete().eq('id', id);
  if (error) throw new Error(error.message);
  void logProductAction({
    entity_type: 'test_type',
    entity_id: id,
    action: 'delete',
    before: beforeRow ?? null,
    entry_number: (beforeRow as { name?: string } | null)?.name ?? null,
    description: `Deleted test type ${(beforeRow as { name?: string } | null)?.name ?? id}`,
  });
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

// M-166: reason codes for withdrawing carts from the awaiting-check-in queue.
export type WithdrawReason = 'shift_change' | 'scan_error' | 'other';

export interface WithdrawResult {
  requested: number;
  succeeded: Array<{ sub_lot_id: string; sub_lot_code: string }>;
  failed: Array<{ sub_lot_id: string; sub_lot_code?: string; reason: string; status?: string }>;
}

// M-166: withdraw carts from the "awaiting check-in" queue with a reason.
// Clears scanned_for_check_in_at (cart reverts to un-staged `created`) and logs
// a `check_in_withdrawn` quality event per cart (→ cart timeline + audit log).
export async function withdrawAwaitingCheckIn(
  subLotIds: string[],
  reason: WithdrawReason,
  reasonNote?: string | null,
): Promise<WithdrawResult> {
  return rpc<WithdrawResult>('qc_withdraw_awaiting_check_in', {
    p_sub_lot_ids: subLotIds,
    p_reason: reason,
    p_reason_note: reasonNote ?? null,
  });
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
// M-118: deterministic chunking + operator-chosen sampling method.
export type SamplingMethod = 'method_1' | 'method_2';

export interface BulkCheckOutGroup {
  test_group_id: string;
  group_sequence: number;
  production_lot_id: string;
  member_count: number;
  champion_id: string;
  member_ids: string[];
  redry?: boolean;
  original_group_id?: string | null;
  sampling_method?: SamplingMethod;
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
  sampling_method?: SamplingMethod;
}): Promise<BulkCheckOutResult> {
  return rpc<BulkCheckOutResult>('qc_check_out_sub_lots_bulk', {
    p_sub_lot_ids: input.sub_lot_ids,
    p_out_time: input.out_time ?? null,
    p_sampling_method: input.sampling_method ?? 'method_2',
  });
}

export async function listPendingInspections(): Promise<SubLot[]> {
  return rpc<SubLot[]>('qc_list_pending_inspections');
}

export async function inspectionTemplateForSubLot(subLotId: string): Promise<{
  sub_lot: SubLot;
  template: {
    item_name: string;
    lower_limit: number;
    upper_limit: number;
    // M-118: TestingPage uses these to compute the three-band verdict and
    // gate the Pass/Fail buttons. soft = hard means no supervisor override
    // is available (anything outside hard is forced FAIL).
    soft_lower_limit: number;
    soft_upper_limit: number;
  };
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
    .select('item_name, lower_limit, upper_limit, soft_lower_limit, soft_upper_limit')
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
      lower_limit:      Number(tmpl.lower_limit),
      upper_limit:      Number(tmpl.upper_limit),
      soft_lower_limit: Number(tmpl.soft_lower_limit),
      soft_upper_limit: Number(tmpl.soft_upper_limit),
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

// ── Multi-test inspection (M-138) ───────────────────────────────────────────
export interface TestTemplateLimits {
  id: string;                 // qc_inspection_template.id — key for p_values
  test_type_id: number | null;
  item_name: string;
  unit: string | null;
  lower_limit: number;
  upper_limit: number;
  soft_lower_limit: number;
  soft_upper_limit: number;
}

/** Load ALL inspection templates (tests) configured for a sub-lot's SKU. */
export async function inspectionTemplatesForSubLot(subLotId: string): Promise<{
  sub_lot: SubLot;
  templates: TestTemplateLimits[];
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

  const { data: rows, error: tmplErr } = await supabase
    .from('qc_inspection_template')
    .select('id, test_type_id, item_name, unit, lower_limit, upper_limit, soft_lower_limit, soft_upper_limit')
    .eq('sku_id', lot.sku_id)
    .order('id');
  if (tmplErr) throw new Error(tmplErr.message);

  const list = await rpc<SubLot[]>('qc_list_sub_lots', { p_production_lot_id: subRow.production_lot_id });
  const sub_lot = list.find(s => s.id === subLotId);
  if (!sub_lot) throw new Error('Sub-lot not found');

  const templates: TestTemplateLimits[] = (rows ?? []).map(r => ({
    id: r.id as string,
    test_type_id: (r.test_type_id as number | null) ?? null,
    item_name: r.item_name as string,
    unit: (r.unit as string | null) ?? null,
    lower_limit:      Number(r.lower_limit),
    upper_limit:      Number(r.upper_limit),
    soft_lower_limit: Number(r.soft_lower_limit),
    soft_upper_limit: Number(r.soft_upper_limit),
  }));

  return { sub_lot, templates };
}

/** Submit one reading per test (keyed by template id) in a single inspection. */
// M-156: environment readings captured alongside the test (testing temp /
// humidity / room temp). Persisted into qc_inspection_record.values_json.env.
export interface TestEnv {
  testing_temp: number;
  humidity: number;
  room_temp: number;
}

export async function submitInspectionMulti(
  subLotId: string,
  values: Record<string, number>,
  samplePk?: string | null,
  result?: 'pass' | 'fail' | null,
  remark?: string | null,
  env?: TestEnv | null,
): Promise<InspectionResult> {
  return rpc<InspectionResult>('qc_submit_inspection', {
    p_sub_lot_id: subLotId,
    p_values: values,
    p_sample_pk: samplePk ?? null,
    p_result: result ?? null,
    p_remark: remark ?? null,
    p_env: env ?? null,
  });
}

/** Most recent env readings entered today — used to default the next cart's env. */
export async function getLatestTestEnv(): Promise<TestEnv | null> {
  return rpc<TestEnv | null>('qc_latest_test_env');
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

export async function takeSample(input: { sub_lot_id: string; sample_id?: string | null }): Promise<Sample> {
  // M-119: when sample_id is omitted the backend auto-generates from the
  // cart code (<sub_lot_code> / <sub_lot_code>R / <sub_lot_code>R2 / ...).
  return rpc<Sample>('qc_take_sample', {
    p_sub_lot_id: input.sub_lot_id,
    p_sample_id: input.sample_id ?? null,
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

/**
 * M-146: one flattened reading from a multi-test inspection. The SQL helper
 * sorts these by `item_name` so the order is stable across reads. Legacy
 * single-Aw inspections come back as a one-element array with `unit: 'Aw'`.
 */
export interface InspectionReading {
  item_name: string;          // e.g. "Water Activity", "Water Density"
  unit: string | null;        // e.g. "Aw", "%"
  value: number | null;
  in_hard?: boolean | null;   // within hard limits
  in_soft?: boolean | null;   // within soft limits
}

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
    /** M-146: every reading on the linked inspection (Aw + density + …). */
    readings?: InspectionReading[];
    inspection_record_id: string | null;
    /** M-149: account that took the sample. */
    taken_by?: string | null;
  }>;
  inspections: Array<{
    id: string;
    result: 'pass' | 'fail';
    aw: number | null;
    /** M-146: full per-test reading list; falls back to a single Aw entry for legacy records. */
    readings?: InspectionReading[];
    remark: string | null;
    submitted_at: string;
    sample_id: string | null;
    /** M-149: account that submitted the inspection. */
    inspector?: string | null;
  }>;
  dispositions: Array<{
    id: string;
    type: DispositionType;
    remark: string | null;
    redry_expected_dry_minutes: number | null;
    created_at: string;
    /** M-149: account that recorded the disposition. */
    operator?: string | null;
  }>;
  room_temp_sessions: Array<{
    id: string;
    started_at: string;
    ended_at: string | null;
    duration_minutes: number | null;
    /** M-149: accounts that started / ended the session. */
    started_by?: string | null;
    ended_by?: string | null;
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

// M-157: Dashboard module — per work-order cart pipeline, grouped product → WO.
export interface WorkOrderPipelineRow {
  work_order_no: string;
  dry_room: number;      // drying / room_temp_drying / awaiting_recheck
  waiting_test: number;  // pending, waiting to be sampled
  sampled: number;       // pending+sample / inspecting / awaiting_group_result
  passed: number;        // status='passed' (= waiting release)
  retest: number;        // hold / disposing
  released: number;      // status='closed' (waiting packing)
  dispatched: number;    // status='dispatched'
  total: number;
}
export type WorkOrderPipelineTotals = Omit<WorkOrderPipelineRow, 'work_order_no'>;
export interface ProductPipelineGroup {
  sku_id: string;
  sku_code: string;
  sku_name: string;
  totals: WorkOrderPipelineTotals;
  work_orders: WorkOrderPipelineRow[];
}
export async function dashboardWorkOrderPipeline(): Promise<ProductPipelineGroup[]> {
  return rpc<ProductPipelineGroup[]>('qc_dashboard_work_order_pipeline');
}

// M-157: drying-room exit forecast — carts still drying, bucketed by ETA day.
export interface DryingExitBucket {
  bucket_date: string | null;            // YYYY-MM-DD (null for overdue/later/unknown)
  grp: 'overdue' | 'day' | 'later' | 'unknown';
  days_from_today: number | null;        // 0 = today, 1 = tomorrow, …
  cart_count: number;
}
export async function dashboardDryingExitForecast(days = 7): Promise<DryingExitBucket[]> {
  return rpc<DryingExitBucket[]>('qc_dashboard_drying_exit_forecast', { p_days: days });
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
  /**
   * M-120: subset of `failed_today` whose fails have NOT been resolved yet
   * — no later passing inspection and no later terminal disposition
   * (scrap / grind / concession / rework) on the same cart or anywhere in
   * the same sampling group.
   */
  failed_today_open?: number;
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

// ── Release errors (S4) ──────────────────────────────────────────────────────
//
// The release RPC (M-116) calls wh_sync_release_from_qc, which raises one of
// three named exceptions when something on the warehouse side blocks the sync.
// We surface them as typed errors so the UI can react: PackagingRequiredError
// triggers a picker modal; NoPackagingLinkedError points the operator to
// ProductManagement; YieldRequiredError should never reach the UI (the form
// guards it) but is here for safety.

export class PackagingRequiredError extends Error {
  productionLotId: string;
  constructor(productionLotId: string) {
    super(`PACKAGING_REQUIRED: ${productionLotId}`);
    this.name = 'PackagingRequiredError';
    this.productionLotId = productionLotId;
  }
}

export class NoPackagingLinkedError extends Error {
  skuId: string;
  constructor(skuId: string) {
    super(`NO_PACKAGING_LINKED: ${skuId}`);
    this.name = 'NoPackagingLinkedError';
    this.skuId = skuId;
  }
}

export class YieldRequiredError extends Error {
  constructor(msg: string = 'YIELD_REQUIRED') {
    super(msg);
    this.name = 'YieldRequiredError';
  }
}

/**
 * Release a passed sub-lot to next process (status: passed → closed).
 *
 * S4: now requires `yieldQuantity` — the actual produced quantity (in the
 * packaging item's base UOM) recorded by the operator. The release RPC posts
 * +yield to LOC-PACK-STAGE via wh_sync_release_from_qc. If sync fails, the
 * whole RPC rolls back and sub_lot stays in 'passed' (BR-W3).
 */
export async function releasePassedSubLot(subLotId: string, yieldQuantity?: number | null): Promise<SubLot> {
  // M-139: yield is optional. When omitted, the cart is released without posting
  // any ERP quantity (the quantity step is captured later, e.g. at packing).
  try {
    return await rpc<SubLot>('qc_release_passed_sub_lot', {
      p_sub_lot_id: subLotId,
      p_yield_quantity: yieldQuantity != null && yieldQuantity > 0 ? yieldQuantity : null,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const packMatch = msg.match(/PACKAGING_REQUIRED:\s*([\w-]+)/);
    if (packMatch) throw new PackagingRequiredError(packMatch[1]);
    const noLinkMatch = msg.match(/NO_PACKAGING_LINKED:\s*([\w-]+)/);
    if (noLinkMatch) throw new NoPackagingLinkedError(noLinkMatch[1]);
    if (msg.includes('YIELD_REQUIRED')) throw new YieldRequiredError(msg);
    throw e;
  }
}

/**
 * Release every cart in a sampling group. M-139: no yield is collected — release
 * just closes the carts (ERP quantity is captured at a later step).
 */
export async function releasePassedSubLotsGroup(subLotIds: string[]): Promise<void> {
  await Promise.all(subLotIds.map(id => releasePassedSubLot(id)));
}

/** Apply the same disposition to every cart in a sampling group. */
export async function createDispositionGroup(input: {
  sub_lot_ids: string[];
  /**
   * The cart whose result the group inherited (the existing champion). When
   * provided AND `type === 'retest'`, the single retest call is dispatched on
   * this cart so M-106's normalisation keeps the original champion in place.
   * Falls back to `sub_lot_ids[0]` if omitted. See bug note in QcHome.
   */
  champion_sub_lot_id?: string;
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
      drying_sub_lot_id: input.champion_sub_lot_id ?? input.sub_lot_ids[0],
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
/**
 * M-120: outcome resolved against later events (same cart or same group).
 *   - `retest_passed` — a later passing inspection exists
 *   - `disposed`     — a later terminal disposition exists
 *                       (scrap / grind / concession / rework)
 *   - `open`         — neither; the failure is still in the open queue
 * Precedence (highest wins): retest_passed > disposed > open.
 */
export type FailOutcome = 'retest_passed' | 'disposed' | 'open';

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
  outcome?: FailOutcome;
  group_members: FailGroupMember[];
}
export async function getRecentFailedInspections(days = 2): Promise<RecentFailItem[]> {
  return rpc<RecentFailItem[]>('qc_recent_failed_inspections', { p_days: days });
}

/**
 * M-121: mirror of RecentFailItem for passed inspections.
 *   `released`         — every group member has moved past `passed`
 *   `awaiting_release` — at least one member is still `passed`
 */
export type PassOutcome = 'released' | 'awaiting_release';

export interface RecentPassItem {
  inspection_id: string;
  sample_id: string | null;
  aw: number | null;
  submitted_at: string;
  sku_name: string | null;
  lot_number: string | null;
  work_order_barcode: string | null;
  champion_code: string;
  test_group_id: string | null;
  outcome?: PassOutcome;
  group_members: FailGroupMember[];
}

export async function getRecentPassedInspections(days = 2): Promise<RecentPassItem[]> {
  return rpc<RecentPassItem[]>('qc_recent_passed_inspections', { p_days: days });
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

// ─── Daily Test Report (M-151) ─────────────────────────────────────────────

/** One flattened reading inside an inspection (multi-test shape). */
export interface DailyTestReading {
  item_name: string;
  unit: string | null;
  value: number;
  in_hard?: boolean | null;
  in_soft?: boolean | null;
}

/** One inspection done on the report's day. */
export interface DailyTestRow {
  inspection_id: string;
  sample_id: string | null;
  sub_lot_code: string;
  sku_name: string | null;
  result: 'pass' | 'fail';
  readings: DailyTestReading[];
  remark: string | null;
  submitted_at: string;
  inspector: string | null;
}

/** A signed report in the history list. */
export interface DailyReportListItem {
  id: string;
  report_date: string;
  signer_name: string;
  signed_at: string;
  signature_type: 'typed' | 'drawn';
  is_backdated: boolean;
  backdate_reason: string | null;
  pdf_storage_path: string | null;
  test_count: number;
  pass_count: number;
  fail_count: number;
}

const DAILY_REPORT_BUCKET = 'qc-daily-reports';

/** All inspections submitted on `date` (YYYY-MM-DD). */
export async function getDailyTestData(date: string): Promise<DailyTestRow[]> {
  return rpc<DailyTestRow[]>('qc_daily_test_report_data', { p_date: date });
}

/** All signed daily reports, newest first. */
export async function listDailyReports(): Promise<DailyReportListItem[]> {
  return rpc<DailyReportListItem[]>('qc_list_daily_reports');
}

/**
 * Sign + archive a daily report: upload the PDF to Storage, then persist the
 * signed record (server derives signer + back-date flag). Throws if the day is
 * already signed.
 */
export async function signDailyReport(params: {
  date: string;
  signatureType: 'typed' | 'drawn';
  signatureData: string;
  snapshot: Record<string, unknown>;
  pdfBlob: Blob;
  backdateReason?: string | null;
}): Promise<DailyReportListItem> {
  const path = `${params.date}/${params.date}.pdf`;
  const { error: upErr } = await supabase.storage
    .from(DAILY_REPORT_BUCKET)
    .upload(path, params.pdfBlob, { contentType: 'application/pdf', upsert: false });
  if (upErr) throw new Error(upErr.message);

  return rpc<DailyReportListItem>('qc_sign_daily_report', {
    p_date: params.date,
    p_signature_type: params.signatureType,
    p_signature_data: params.signatureData,
    p_snapshot: params.snapshot,
    p_pdf_path: path,
    p_backdate_reason: params.backdateReason ?? null,
  });
}

/** Signed download URL (1h) for an archived report PDF. */
export async function getDailyReportPdfUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(DAILY_REPORT_BUCKET)
    .createSignedUrl(storagePath, 3600);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

// ─── Testing data export (WA / MC% template, M-155) ─────────────────────────

/** One inspection row shaped for the WA_MC export template. */
export interface TestingExportRow {
  inspection_id: string;
  product_name: string | null;
  item_no: string | null;
  test_date: string;            // ISO; rendered as the Date column
  wo_lot: string | null;
  sample_id: string | null;     // Carts# column = sample number
  sub_lot_code: string;
  mc_value: number | null;
  aw_value: number | null;
  testing_temp: number | null;
  humidity: number | null;
  room_temp: number | null;
  inspector: string | null;
  result: 'pass' | 'fail';
  mc_min: number | null;
  mc_max: number | null;
  aw_min: number | null;
  aw_max: number | null;
  retest_accept: string;        // 'Accept' | 'Retest' | ''
  note: string | null;
}

/** Filtered testing rows for the export page (by date range / SKU / work order). */
export async function getTestingExportRows(filters: {
  sku_id?: string | null;
  from_date?: string | null;          // YYYY-MM-DD
  to_date?: string | null;
  production_lot_id?: string | null;
}): Promise<TestingExportRow[]> {
  return rpc<TestingExportRow[]>('qc_testing_export_rows', {
    p_sku_id: filters.sku_id ?? null,
    p_from_date: filters.from_date ?? null,
    p_to_date: filters.to_date ?? null,
    p_production_lot_id: filters.production_lot_id ?? null,
  });
}

import { supabase } from '../lib/supabase';

// RPC wrapper — throws on error (mirrors qcApi convention).
async function rpc<T>(fn: string, params: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, params);
  if (error) throw new Error(error.message);
  return data as T;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type ItemType = 'raw_material' | 'packaging' | 'intermediate' | 'finished_good';
export type CostingMethod = 'standard' | 'weighted_average' | 'fifo';
export type ItemStatus = 'active' | 'inactive';
export type UomType = 'weight' | 'volume' | 'count';
export type LocationType = 'storage' | 'receiving' | 'shipping' | 'production' | 'quarantine';
export type LotStatus =
  | 'quarantine' | 'available' | 'on_hold' | 'consumed' | 'rejected' | 'expired';

export interface Uom {
  id: number;
  code: string;
  name: string;
  uom_type: UomType;
}

export interface ItemCategory {
  id: number;
  code: string;
  name: string;
  parent_id: number | null;
}

export interface WarehouseItem {
  id: number;
  sku: string;
  name: string;
  description: string | null;
  item_type: ItemType;
  category_id: number | null;
  base_uom_id: number;
  is_lot_controlled: boolean;
  shelf_life_days: number | null;
  default_warehouse_id: number | null;
  costing_method: CostingMethod;
  standard_cost: number | null;
  allergen_info: string | null;
  status: ItemStatus;
  created_at: string;
}

export interface ItemInput {
  sku: string;
  name: string;
  description?: string | null;
  item_type: ItemType;
  category_id?: number | null;
  base_uom_id: number;
  is_lot_controlled: boolean;
  shelf_life_days?: number | null;
  costing_method: CostingMethod;
  standard_cost?: number | null;
  allergen_info?: string | null;
  status?: ItemStatus;
}

export interface WarehouseLocation {
  id: number;
  warehouse_id: number;
  code: string;
  name: string | null;
  location_type: LocationType;
  is_active: boolean;
}

export interface WarehouseLot {
  id: number;
  lot_number: string;
  item_id: number;
  expiry_date: string | null;
  source_type: 'purchased' | 'produced';
  status: LotStatus;
  created_at: string;
}

// ── Items (master data) ─────────────────────────────────────────────────────

export async function listItems(): Promise<WarehouseItem[]> {
  const { data, error } = await supabase
    .from('item')
    .select('*')
    .order('sku', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as WarehouseItem[];
}

export async function createItem(input: ItemInput): Promise<WarehouseItem> {
  if (!input.sku.trim()) throw new Error('SKU is required');
  if (!input.name.trim()) throw new Error('Name is required');
  const { data, error } = await supabase
    .from('item')
    .insert({
      sku: input.sku.trim(),
      name: input.name.trim(),
      description: input.description ?? null,
      item_type: input.item_type,
      category_id: input.category_id ?? null,
      base_uom_id: input.base_uom_id,
      is_lot_controlled: input.is_lot_controlled,
      shelf_life_days: input.shelf_life_days ?? null,
      costing_method: input.costing_method,
      standard_cost: input.standard_cost ?? null,
      allergen_info: input.allergen_info ?? null,
      status: input.status ?? 'active',
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as WarehouseItem;
}

export async function updateItem(id: number, input: Partial<ItemInput>): Promise<WarehouseItem> {
  const patch: Record<string, unknown> = {};
  if (input.sku !== undefined) patch.sku = input.sku.trim();
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.description !== undefined) patch.description = input.description;
  if (input.item_type !== undefined) patch.item_type = input.item_type;
  if (input.category_id !== undefined) patch.category_id = input.category_id;
  if (input.base_uom_id !== undefined) patch.base_uom_id = input.base_uom_id;
  if (input.is_lot_controlled !== undefined) patch.is_lot_controlled = input.is_lot_controlled;
  if (input.shelf_life_days !== undefined) patch.shelf_life_days = input.shelf_life_days;
  if (input.costing_method !== undefined) patch.costing_method = input.costing_method;
  if (input.standard_cost !== undefined) patch.standard_cost = input.standard_cost;
  if (input.allergen_info !== undefined) patch.allergen_info = input.allergen_info;
  if (input.status !== undefined) patch.status = input.status;

  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from('item').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  }
  const { data, error } = await supabase.from('item').select('*').eq('id', id).single();
  if (error) throw new Error(error.message);
  return data as WarehouseItem;
}

// ── Lookups ───────────────────────────────────────────────────────────────────

export async function listUoms(): Promise<Uom[]> {
  const { data, error } = await supabase
    .from('uom')
    .select('id, code, name, uom_type')
    .order('code', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Uom[];
}

export async function listItemCategories(): Promise<ItemCategory[]> {
  const { data, error } = await supabase
    .from('item_category')
    .select('id, code, name, parent_id')
    .order('code', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ItemCategory[];
}

export async function listLocations(): Promise<WarehouseLocation[]> {
  const { data, error } = await supabase
    .from('location')
    .select('id, warehouse_id, code, name, location_type, is_active')
    .order('code', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as WarehouseLocation[];
}

// Read-only in S0; write operations (create/release/reject) arrive in later sprints.
export async function listLots(): Promise<WarehouseLot[]> {
  const { data, error } = await supabase
    .from('lot')
    .select('id, lot_number, item_id, expiry_date, source_type, status, created_at')
    .order('id', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as WarehouseLot[];
}

// ── Inventory ledger (Sprint 1) ─────────────────────────────────────────────

export interface WarehouseBalance {
  item_id: number;
  item_sku: string;
  item_name: string;
  lot_id: number | null;
  lot_number: string | null;
  lot_status: LotStatus | null;
  expiry_date: string | null;
  location_id: number;
  location_code: string;
  location_type: LocationType;
  quantity_on_hand: number;
  quantity_allocated: number;
  quantity_available: number;
  base_uom: string;
}

export interface WarehouseTransaction {
  id: number;
  transaction_date: string;
  item_sku: string;
  item_name: string;
  lot_number: string | null;
  location_code: string;
  quantity: number;
  transaction_type: string;
  unit_cost: number | null;
  reference_type: string | null;
  reference_id: number | null;
  notes: string | null;
  created_by: string | null;
}

export interface ReceiptLineInput {
  item_id: number;
  quantity: number;
  uom_id: number;
  location_id: number;
  lot_status?: LotStatus;        // default 'available'
  lot_number?: string | null;    // auto-generated if absent
  expiry_date?: string | null;
  unit_cost?: number | null;
}

export interface ReceiptInput {
  lines: ReceiptLineInput[];
  receipt_date?: string;         // default today (server)
  supplier_id?: number | null;   // optional for direct receipts
  warehouse_id?: number | null;  // default WH-MAIN (server)
  notes?: string | null;
}

export interface PostReceiptResult {
  grn_id: number;
  grn_number: string;
  line_count: number;
  lot_ids: number[];
}

export interface GoodsReceiptRow {
  id: number;
  grn_number: string;
  receipt_type: 'po' | 'direct';
  po_id: number | null;
  supplier_id: number | null;
  receipt_date: string;
  warehouse_id: number;
  status: 'draft' | 'posted' | 'cancelled';
  created_at: string;
}

export async function postReceipt(input: ReceiptInput): Promise<PostReceiptResult> {
  if (!input.lines || input.lines.length === 0) throw new Error('至少需要一行收货明细');
  // receipt_date must not be null (NOT NULL column). The SQL param DEFAULT only
  // applies when the arg is omitted, not when null is passed — so default here.
  return rpc<PostReceiptResult>('wh_post_receipt', {
    p_lines: input.lines,
    p_receipt_date: input.receipt_date ?? new Date().toISOString().slice(0, 10),
    p_supplier_id: input.supplier_id ?? null,
    p_warehouse_id: input.warehouse_id ?? null,
    p_notes: input.notes ?? null,
  });
}

export async function listBalance(filters: { locationId?: number; itemId?: number } = {}): Promise<WarehouseBalance[]> {
  return rpc<WarehouseBalance[]>('wh_list_balance', {
    p_location_id: filters.locationId ?? null,
    p_item_id: filters.itemId ?? null,
  });
}

export async function listTransactions(
  filters: { itemId?: number; lotId?: number; locationId?: number; limit?: number } = {},
): Promise<WarehouseTransaction[]> {
  return rpc<WarehouseTransaction[]>('wh_list_transactions', {
    p_item_id: filters.itemId ?? null,
    p_lot_id: filters.lotId ?? null,
    p_location_id: filters.locationId ?? null,
    p_limit: filters.limit ?? 200,
  });
}

// GR list is a read — direct query is allowed (RPC-first only governs writes).
export async function listGoodsReceipts(): Promise<GoodsReceiptRow[]> {
  const { data, error } = await supabase
    .from('goods_receipt')
    .select('id, grn_number, receipt_type, po_id, supplier_id, receipt_date, warehouse_id, status, created_at')
    .order('id', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as GoodsReceiptRow[];
}

// ── In-warehouse operations (Sprint 2) ──────────────────────────────────────

export interface LotHeader {
  id: number;
  lot_number: string;
  item_id: number;
  item_sku: string | null;
  item_name: string | null;
  base_uom_id: number | null;
  supplier_lot_number: string | null;
  manufacture_date: string | null;
  expiry_date: string | null;
  source_type: 'purchased' | 'produced';
  source_doc_type: string | null;
  source_doc_id: number | null;
  status: LotStatus;
  created_at: string;
}

export async function postTransfer(input: {
  itemId: number; lotId: number; fromLocationId: number; toLocationId: number;
  quantity: number; uomId: number; notes?: string | null;
}): Promise<{ transfer_out_id: number; transfer_in_id: number }> {
  return rpc('wh_post_transfer', {
    p_item_id: input.itemId,
    p_lot_id: input.lotId,
    p_from_location_id: input.fromLocationId,
    p_to_location_id: input.toLocationId,
    p_quantity: input.quantity,
    p_uom_id: input.uomId,
    p_notes: input.notes ?? null,
  });
}

export async function postAdjustment(input: {
  itemId: number; lotId: number; locationId: number;
  quantityDelta: number; uomId: number; reason: string;
}): Promise<number> {
  return rpc<number>('wh_post_adjustment', {
    p_item_id: input.itemId,
    p_lot_id: input.lotId,
    p_location_id: input.locationId,
    p_quantity_delta: input.quantityDelta,
    p_uom_id: input.uomId,
    p_reason: input.reason,
  });
}

export async function cancelGrn(grnId: number): Promise<{ grn_id: number; grn_number: string; lines_reversed: number }> {
  return rpc('wh_cancel_grn', { p_grn_id: grnId });
}

export async function rebuildBalance(): Promise<{ rebuilt_rows: number }> {
  return rpc('wh_rebuild_balance', {});
}

// Lot header for the detail page (embeds item via FK).
export async function getLot(lotId: number): Promise<LotHeader> {
  const { data, error } = await supabase
    .from('lot')
    .select('id, lot_number, item_id, supplier_lot_number, manufacture_date, expiry_date, source_type, source_doc_type, source_doc_id, status, created_at, item:item_id(sku, name, base_uom_id)')
    .eq('id', lotId)
    .single();
  if (error) throw new Error(error.message);
  const row = data as Record<string, unknown>;
  const itemEmbed = row.item as { sku: string; name: string; base_uom_id: number } | null;
  return {
    id: row.id as number,
    lot_number: row.lot_number as string,
    item_id: row.item_id as number,
    item_sku: itemEmbed?.sku ?? null,
    item_name: itemEmbed?.name ?? null,
    base_uom_id: itemEmbed?.base_uom_id ?? null,
    supplier_lot_number: (row.supplier_lot_number as string) ?? null,
    manufacture_date: (row.manufacture_date as string) ?? null,
    expiry_date: (row.expiry_date as string) ?? null,
    source_type: row.source_type as 'purchased' | 'produced',
    source_doc_type: (row.source_doc_type as string) ?? null,
    source_doc_id: (row.source_doc_id as number) ?? null,
    status: row.status as LotStatus,
    created_at: row.created_at as string,
  };
}

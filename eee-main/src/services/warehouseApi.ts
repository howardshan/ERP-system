import { supabase } from '../lib/supabase';

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

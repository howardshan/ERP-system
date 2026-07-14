import { supabase } from '../lib/supabase';

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export interface PkgCart {
  id: string;
  sub_lot_code: string;
  lot_number: string | null;
  work_order_barcode: string | null;
  sku_id: string;
  sku_name: string;
  sku_code: string;
  /** Packaging item (item_type='packaging') assigned to the cart's work order.
   *  M-092 added these — null when no packaging has been linked yet. */
  packaging_id: number | null;
  packaging_sku: string | null;
  packaging_name: string | null;
  released_at: string;
  days_in_stock: number;
}

export interface PkgSku {
  sku_id: string;
  sku_name: string;
  sku_code: string;
  cart_count: number;
}

export interface PkgDispatchResult {
  outbound_id: number;
  cart_count: number;
  dispatched_ids: string[];
}

export interface PkgInventorySku {
  sku_id: string;
  sku_name: string;
  sku_code: string;
  total: number;
  green: number;
  yellow: number;
  red: number;
}

export async function getSkusWithStock(): Promise<PkgSku[]> {
  return rpc<PkgSku[]>('pkg_skus_with_stock');
}

export async function getAvailableCarts(skuId?: string): Promise<PkgCart[]> {
  return rpc<PkgCart[]>('pkg_available_carts', skuId ? { p_sku_id: skuId } : {});
}

// M-167: per-work-order "entered dryer − dispatched" counts for the packaging
// list denominator (shown as "N / remaining CART(S)").
export interface WoDryDispatchCount {
  work_order_barcode: string;
  entered: number;
  dispatched: number;
  remaining: number;
}

export async function getWoDryDispatchCounts(skuId?: string): Promise<WoDryDispatchCount[]> {
  return rpc<WoDryDispatchCount[]>('pkg_wo_dry_dispatch_counts', skuId ? { p_sku_id: skuId } : {});
}

export async function dispatchCarts(subLotIds: string[], note?: string): Promise<PkgDispatchResult> {
  return rpc<PkgDispatchResult>('pkg_dispatch_carts', {
    p_sub_lot_ids: subLotIds,
    p_note: note ?? null,
  });
}

export async function getInventorySummary(): Promise<PkgInventorySku[]> {
  return rpc<PkgInventorySku[]>('pkg_inventory_summary');
}

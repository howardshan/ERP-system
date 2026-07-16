// QC sampling-group planner — the deterministic counterpart to
// `qc_check_out_sub_lots_bulk` in
// supabase/migrations/20260527000015_qc_check_out_bulk_sampling_method.sql
// (M-118). The frontend uses this to render a live group preview inside
// BulkCheckOutDialog so the operator can see exactly what will be created
// before clicking Confirm. The SQL function remains the source of truth at
// execution time; the two MUST stay in sync.

export type SamplingMethod = 'method_1' | 'method_2';

export interface PlannedGroup<T> {
  /** Members in descending sub_lot_code order (highest cart first). */
  members: T[];
  /** Index of the champion within `members`. */
  championIndex: number;
}

/**
 * Plan sampling groups for a batch about to be checked out.
 *
 * @param ascCarts  Carts sorted by sub_lot_code in **ascending** order.
 * @param sampleN   SKU's `sample_every_n_carts` (≥ 1; clamped here too).
 * @param method    'method_1' (chunk-by-N, remainder solo) or 'method_2'
 *                  (merge remainder into the last big group).
 *
 * Algorithm (mirrors the SQL exactly). Work in **descending** order
 * (highest cart first); N = max(1, sampleN).
 *
 *   Method 1:
 *     Chunk every N carts from the top; remainder is its own group.
 *     Champion = first item of each chunk (= highest sub_lot_code).
 *
 *   Method 2 (default):
 *     Chunk every N from the top (champion = highest), EXCEPT when the
 *     remaining count R of the tail satisfies N < R < 2N. Then split the tail
 *     EVENLY into an upper group (champion = highest) and a lower group
 *     (champion = highest of the lower half = the middle, smaller-if-two cart).
 *     e.g. T=10, N=3 → 第1组{10,9,8}→10, 第2组{7,6,5}→7,
 *                      第3组{4,3}→4,      第4组{2,1}→2.
 *
 * NOTE: redry buckets do NOT use this planner — they keep the original
 * champion (see BulkCheckOutDialog + qc_check_out_sub_lots_bulk Step 2b).
 */
export function planSamplingGroups<T extends { sub_lot_code: string }>(
  ascCarts: T[],
  sampleN: number,
  method: SamplingMethod,
): PlannedGroup<T>[] {
  const T = ascCarts.length;
  if (T === 0) return [];

  const N = Math.max(1, sampleN | 0);

  // Work in descending order: highest sub_lot_code first.
  const desc = ascCarts.slice().sort((a, b) =>
    b.sub_lot_code.localeCompare(a.sub_lot_code),
  );

  const groups: PlannedGroup<T>[] = [];

  if (method === 'method_2') {
    // Chunk by N (champion = highest). When the tail's remaining count R is
    // N < R < 2N, split the tail evenly into an upper group (champion = highest)
    // and a lower group (champion = highest of the lower half = the middle,
    // smaller-if-two, cart of the tail). Split point = middle of the carts below
    // the top one.
    let i = 0;
    while (i < T) {
      const remaining = T - i;
      if (remaining > N && remaining < 2 * N) {
        const split = (i + 1) + Math.floor((remaining - 1) / 2);   // 0-based split index
        groups.push({ members: desc.slice(i, split), championIndex: 0 });
        groups.push({ members: desc.slice(split, T), championIndex: 0 });
        break;
      }
      const members = desc.slice(i, Math.min(i + N, T));
      groups.push({ members, championIndex: 0 });
      i += N;
    }
  } else {
    // Method 1: chunk by N, remainder solo, champion = highest in each.
    for (let i = 0; i < T; i += N) {
      const members = desc.slice(i, Math.min(i + N, T));
      groups.push({ members, championIndex: 0 });
    }
  }

  return groups;
}

/** Convenience: pluck the champion from a planned group. */
export function championOf<T>(g: PlannedGroup<T>): T {
  return g.members[g.championIndex];
}

/**
 * Partition carts into check-in ("in_time") batches — the counterpart to
 * `qc__intime_windows` in the SQL (M-158). Carts are sorted by in_time ascending;
 * a new batch starts whenever a cart's in_time is more than `minutes` after the
 * current batch's EARLIEST (anchor) cart, so each batch spans ≤ `minutes`.
 *
 *   e.g. in_times 10:00, 10:50, 11:10, 11:20 with minutes=60
 *        → [[10:00, 10:50], [11:10, 11:20]]
 *
 * Carts without an in_time each form their own batch. The MUST-stay-in-sync SQL
 * runs the same greedy anchor algorithm at execution time.
 */
export function partitionByIntimeWindow<T extends { in_time?: string | null; sub_lot_code: string }>(
  carts: T[],
  minutes: number,
): T[][] {
  if (carts.length === 0) return [];
  const sorted = carts.slice().sort((a, b) => {
    const ta = a.in_time ? Date.parse(a.in_time) : Number.POSITIVE_INFINITY;
    const tb = b.in_time ? Date.parse(b.in_time) : Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    return a.sub_lot_code.localeCompare(b.sub_lot_code);
  });
  const windowMs = minutes * 60_000;
  const out: T[][] = [];
  let cur: T[] = [];
  let anchor = NaN;
  for (const c of sorted) {
    const t = c.in_time ? Date.parse(c.in_time) : NaN;
    const startNew = cur.length === 0 || Number.isNaN(t) || Number.isNaN(anchor) || (t - anchor) > windowMs;
    if (startNew) {
      if (cur.length) out.push(cur);
      cur = [c];
      anchor = t;
    } else {
      cur.push(c);
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

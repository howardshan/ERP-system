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
 * Algorithm (mirrors the SQL exactly):
 *   T = ascCarts.length, N = max(1, sampleN), R = T mod N.
 *   Work in **descending** order (highest cart first).
 *
 *   Method 1, or Method 2 with R==0 / T<=N:
 *     Chunk every N carts from the top; remainder is its own group.
 *     Champion = first item of each chunk (= highest sub_lot_code).
 *
 *   Method 2 with R>0 and T>N:
 *     First `floor(T/N) - 1` chunks of N (champion = highest in chunk).
 *     Last chunk of `N + R` carts (champion = the "middle-large" one,
 *     i.e. ascending position floor(K/2)+1, 1-indexed).
 */
export function planSamplingGroups<T extends { sub_lot_code: string }>(
  ascCarts: T[],
  sampleN: number,
  method: SamplingMethod,
): PlannedGroup<T>[] {
  const T = ascCarts.length;
  if (T === 0) return [];

  const N = Math.max(1, sampleN | 0);
  const R = T % N;

  // Work in descending order: highest sub_lot_code first.
  const desc = ascCarts.slice().sort((a, b) =>
    b.sub_lot_code.localeCompare(a.sub_lot_code),
  );

  const groups: PlannedGroup<T>[] = [];

  if (method === 'method_2' && T > N && R > 0) {
    // Method 2: merge remainder into the last (lowest-numbered) chunk.
    const fullChunks = Math.floor(T / N) - 1;

    for (let i = 0; i < fullChunks; i++) {
      const members = desc.slice(i * N, (i + 1) * N);
      // Champion = first element of the descending chunk = highest in chunk.
      groups.push({ members, championIndex: 0 });
    }

    const tail = desc.slice(fullChunks * N, T);  // last big chunk, length N+R
    const K = tail.length;
    // Champion = ascending position floor(K/2)+1 (1-indexed).
    //          = descending position (K - floor(K/2)) (1-indexed)
    //          = descending index   (K - floor(K/2) - 1) (0-indexed).
    const championIndex = K - Math.floor(K / 2) - 1;
    groups.push({ members: tail, championIndex });
  } else {
    // Method 1, or Method 2 with R==0 / T<=N: chunk by N, remainder solo.
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

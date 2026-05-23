import { useEffect, useState } from 'react';
import { getAppSetting } from '../../../services/qcApi';

// Cache-busting: caller can pass `nonce` to force re-fetch (e.g. after toggling
// the flag in settings UI — not built yet but reserved).
let cachedValue: boolean | null = null;
let cachedAt = 0;
const TTL_MS = 60_000;

/**
 * Returns whether spot/cell-level selection is enabled for dry-room check-in.
 *
 * Default is `false` (no cell selection) — see M-047.
 *
 * The result is cached in-memory for 60s; pass `force=true` to invalidate.
 */
export function useQcSpotSelectionEnabled(force = false): { enabled: boolean; loading: boolean } {
  const [enabled, setEnabled] = useState<boolean | null>(
    !force && cachedValue !== null && Date.now() - cachedAt < TTL_MS ? cachedValue : null,
  );
  const [loading, setLoading] = useState(enabled === null);

  useEffect(() => {
    if (enabled !== null && !force) return;
    let cancelled = false;
    setLoading(true);
    getAppSetting<boolean>('qc.spot_selection_enabled')
      .then(v => {
        if (cancelled) return;
        const resolved = v === true;
        cachedValue = resolved;
        cachedAt = Date.now();
        setEnabled(resolved);
      })
      .catch(() => { if (!cancelled) setEnabled(false); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [force, enabled]);

  return { enabled: enabled ?? false, loading };
}

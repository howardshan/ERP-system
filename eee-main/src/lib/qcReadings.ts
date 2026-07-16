import { InspectionReading } from '../services/qcApi';

/** Short label for a reading: the parenthetical abbreviation of the item name
 *  ("Moisture Content (MC%)" → "MC%", "Water Activity (Aw)" → "Aw"), else the
 *  item name, else the unit. */
function readingLabel(r: InspectionReading): string {
  const m = r.item_name?.match(/\(([^)]+)\)\s*$/);
  return (m ? m[1] : (r.item_name || r.unit || '')).trim();
}

/**
 * Render ALL test readings compactly, e.g. "MC% 14 · Aw 0.6" (M-170).
 * Falls back to "Aw {aw}" for legacy single-Aw records with no readings array.
 * Returns null when there is nothing to show.
 */
export function formatReadings(
  readings: InspectionReading[] | undefined | null,
  awFallback?: number | null,
): string | null {
  if (readings && readings.length > 0) {
    const parts = readings
      .filter(r => r.value != null)
      .map(r => `${readingLabel(r)} ${r.value}`.trim());
    if (parts.length > 0) return parts.join(' · ');
  }
  if (awFallback != null) return `Aw ${awFallback}`;
  return null;
}

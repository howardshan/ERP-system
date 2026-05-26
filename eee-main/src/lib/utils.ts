import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount);
}

// Minutes → days conversion (UI surface uses days; DB stays in minutes — 1 day = 1440 min).
export const MINUTES_PER_DAY = 1440;

export function minutesToDays(mins: number | null | undefined): number | null {
  if (mins == null) return null;
  return mins / MINUTES_PER_DAY;
}

export function daysToMinutes(days: number | null | undefined): number | null {
  if (days == null) return null;
  return Math.round(days * MINUTES_PER_DAY);
}

// Format minutes as "Xd Yh", "Yh Zm", or "Zm" depending on magnitude.
// Used everywhere drying time / countdowns are rendered.
export function fmtDuration(mins: number | null | undefined): string {
  if (mins == null) return '—';
  const sign = mins < 0 ? '-' : '';
  const abs = Math.abs(Math.round(mins));
  if (abs >= MINUTES_PER_DAY) {
    const d = Math.floor(abs / MINUTES_PER_DAY);
    const h = Math.round((abs % MINUTES_PER_DAY) / 60);
    return h === 0 ? `${sign}${d}d` : `${sign}${d}d ${h}h`;
  }
  if (abs >= 60) {
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return m === 0 ? `${sign}${h}h` : `${sign}${h}h ${m}m`;
  }
  return `${sign}${abs}m`;
}

// Concise days display for inputs/labels — "1.5 days" / "12h" if < 1 day.
export function fmtDays(mins: number | null | undefined, opts: { precise?: boolean } = {}): string {
  if (mins == null) return '—';
  if (mins < MINUTES_PER_DAY) return fmtDuration(mins);
  const d = mins / MINUTES_PER_DAY;
  return opts.precise ? `${d.toFixed(2)}d` : `${d % 1 === 0 ? d : d.toFixed(1)}d`;
}

// ── Dallas / Texas timezone helpers ────────────────────────────────────────
// All QC operations happen in Dallas, TX (America/Chicago, UTC-6 CST / UTC-5 CDT).
// Use these whenever you need a local date or formatted timestamp rather than
// reaching for `new Date().toISOString()` (which is UTC-only).

const DALLAS_TZ = 'America/Chicago';

/**
 * Returns today's date string "YYYY-MM-DD" in Dallas local time.
 * Safe to call at any hour — it accounts for the UTC offset correctly.
 */
export function dallasToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DALLAS_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/**
 * Returns the date string "YYYY-MM-DD" for N days before today in Dallas time.
 */
export function dallasDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DALLAS_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/**
 * Formats a UTC timestamp string (from Supabase) as a human-readable
 * Dallas local time.  Examples:
 *   fmtDallasTime('2026-05-26T08:30:00Z')  →  "05/26 02:30 AM"
 *   fmtDallasTime('2026-05-26T08:30:00Z', { seconds: true })  →  "05/26 02:30:05 AM"
 */
export function fmtDallasTime(
  utcIso: string | null | undefined,
  opts: { seconds?: boolean; date?: boolean } = {},
): string {
  if (!utcIso) return '—';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DALLAS_TZ,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(opts.seconds ? { second: '2-digit' } : {}),
    hour12: true,
  }).formatToParts(new Date(utcIso));
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  const datePart = `${get('month')}/${get('day')}`;
  const timePart = opts.seconds
    ? `${get('hour')}:${get('minute')}:${get('second')} ${get('dayPeriod')}`
    : `${get('hour')}:${get('minute')} ${get('dayPeriod')}`;
  return opts.date === false ? timePart : `${datePart} ${timePart}`;
}

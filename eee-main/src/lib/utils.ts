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

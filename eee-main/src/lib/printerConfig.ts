const KEY = 'erp_label_printer';

// CUPS queue names are ASCII only: letters, digits, underscore, hyphen, dot.
// Strip any trailing non-ASCII text (e.g. Chinese status appended by lpstat -a).
const sanitize = (name: string): string => name.replace(/[^\x00-\x7F].*$/, '').trim();

export const getSavedPrinter = (): string | null => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const clean = sanitize(raw);
    if (clean !== raw) localStorage.setItem(KEY, clean);
    return clean || null;
  } catch { return null; }
};

export const savePrinter = (name: string): void => {
  try { localStorage.setItem(KEY, name); } catch { /* ignore */ }
};

export const clearPrinter = (): void => {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
};

// ── Label printer resolution (per machine) ───────────────────────────────────
// Render the label bitmap at the printer's NATIVE dpi so the bridge maps
// 1 image pixel → 1 printer dot with no rescaling (crispest edges). Set this
// to match each machine's printer: most thermal label printers are 203 dpi,
// some are 300 dpi, a few 600 dpi.
const DPI_KEY = 'erp_label_dpi';
export type LabelDpi = 203 | 300 | 600;
export const LABEL_DPIS: LabelDpi[] = [203, 300, 600];

export const getSavedDpi = (): LabelDpi => {
  try {
    const v = parseInt(localStorage.getItem(DPI_KEY) || '', 10);
    return (v === 300 || v === 600) ? v : 203;
  } catch { return 203; }
};

export const saveDpi = (dpi: LabelDpi): void => {
  try { localStorage.setItem(DPI_KEY, String(dpi)); } catch { /* ignore */ }
};

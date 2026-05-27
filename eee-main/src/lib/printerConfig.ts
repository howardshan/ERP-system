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

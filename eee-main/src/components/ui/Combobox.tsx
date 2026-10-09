import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ComboOption {
  value: string;
  /** Primary text — shown in the input when selected, and matched while typing. */
  label: string;
  /** Secondary muted text shown in the list; also included in the search match. */
  hint?: string;
}

interface Props {
  value: string;                       // selected option value ('' = none)
  onChange: (value: string) => void;
  options: ComboOption[];
  placeholder?: string;
  emptyText?: string;                  // shown when no option matches
  className?: string;                  // applied to the text input
  /** Max options rendered at once (perf cap for long lists). */
  limit?: number;
}

/**
 * Searchable single-select combobox: dropdown + free typing + live filtering.
 * Used where a plain <select> has too many options to scan (machines, operators,
 * products). Filters on `label` and `hint` (case-insensitive substring).
 */
export function Combobox({
  value, onChange, options, placeholder, emptyText, className, limit = 100,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value],
  );

  // Ranked filtering: exact label match FIRST, then label prefix, then label
  // substring, then hint (name) substring. Ordering here is CORRECTNESS, not
  // cosmetics: Enter and the default highlight commit filtered[0], and barcode
  // scanners terminate a scan with Enter — with a plain substring filter kept in
  // list order, a leading-zero or superset code (e.g. '058202' vs '58202',
  // '11500N' vs '11500') could sit at index 0 and steal the commit even though
  // the operator typed the exact code (BR-Q89).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, limit);
    const rank = (o: ComboOption): number => {
      const label = o.label.toLowerCase();
      if (label === q) return 0;
      if (label.startsWith(q)) return 1;
      if (label.includes(q)) return 2;
      return o.hint && o.hint.toLowerCase().includes(q) ? 3 : 4;
    };
    return options
      .map((o, i) => ({ o, r: rank(o), i }))
      .filter((x) => x.r < 4)
      .sort((a, b) => a.r - b.r || a.i - b.i)   // stable within each rank
      .map((x) => x.o)
      .slice(0, limit);
  }, [options, query, limit]);

  // Leaving the field with text still typed but never committed (no Enter / no
  // click on a row) must NOT silently keep the previous value — that let an
  // operator type a valid code, click away, and unknowingly submit the old
  // selection. So on blur/outside-click: if the typed text exactly matches an
  // option's label, commit it; if something was typed but matches nothing, clear
  // the selection so required-field validation catches it. An empty query (just
  // opened and clicked away) leaves the current selection untouched.
  const commitOrReset = () => {
    const q = query.trim();
    if (q) {
      const exact = options.find((o) => o.label.toLowerCase() === q.toLowerCase());
      onChange(exact ? exact.value : '');
    }
    setOpen(false);
    setQuery('');
  };
  // The document listener is registered once, so read the latest impl via a ref.
  const commitRef = useRef(commitOrReset);
  commitRef.current = commitOrReset;

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        commitRef.current();
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // Keep the highlighted row in view.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[activeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open]);

  const openList = () => { setQuery(''); setActiveIdx(0); setOpen(true); };
  const choose = (o: ComboOption) => {
    onChange(o.value);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  };
  const clear = () => { onChange(''); setQuery(''); setOpen(false); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); openList(); }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[activeIdx]) choose(filtered[activeIdx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    } else if (e.key === 'Tab') {
      // Tabbing away is a blur too — commit an exact typed match or drop a stale
      // selection, same as an outside click. Don't preventDefault: let focus move.
      commitOrReset();
    }
  };

  // Input shows the live query while open, otherwise the selected label.
  const display = open ? query : (selected?.label ?? '');

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={display}
          placeholder={placeholder}
          onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); if (!open) setOpen(true); }}
          onFocus={openList}
          onKeyDown={onKeyDown}
          className={cn('pr-12', className)}
          role="combobox"
          aria-expanded={open}
          autoComplete="off"
        />
        <div className="absolute inset-y-0 right-0 flex items-center pr-2 gap-0.5">
          {selected && (
            <button type="button" tabIndex={-1} onMouseDown={(e) => { e.preventDefault(); clear(); }}
              className="p-0.5 rounded hover:bg-slate-200 text-slate-400" aria-label="clear">
              <X size={13} />
            </button>
          )}
          <ChevronDown size={14} className="text-slate-400 pointer-events-none" />
        </div>
      </div>

      {open && (
        <ul ref={listRef}
          className="absolute z-10 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg py-1">
          {filtered.length === 0 && (
            <li className="px-3 py-2 text-xs text-slate-400">{emptyText ?? '—'}</li>
          )}
          {filtered.map((o, i) => (
            <li key={o.value}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); choose(o); }}
                onMouseEnter={() => setActiveIdx(i)}
                className={cn(
                  'w-full text-left px-3 py-1.5 text-sm flex items-baseline gap-2',
                  i === activeIdx ? 'bg-indigo-50' : 'hover:bg-slate-50',
                  o.value === value && 'font-semibold',
                )}
              >
                <span className="text-slate-800 whitespace-nowrap">{o.label}</span>
                {o.hint && <span className="text-xs text-slate-400 truncate">{o.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import React, { useEffect, useRef, useState } from 'react';

/**
 * Decimal-friendly numeric input that doesn't get stuck at "0".
 *
 * Why this exists: `<input type="number" value={n} onChange={e => Number(e.target.value)}>`
 * has two well-known UX bugs:
 *   1. Clearing the field flips the state back to 0 (`Number('') === 0`), so a
 *      pre-filled "0" can never be deleted.
 *   2. Typing "0." → React re-renders `value={0}` and the trailing "." is lost,
 *      so the operator has to type "00." or similar to get the decimal in.
 *
 * Fix: keep the raw text locally; only forward a parsed number when the text
 * is a complete finite number. Empty / partial states (`""`, `"0."`, `"."`,
 * `"-"`) emit `NaN` so the caller can treat them as "not yet a number".
 */
export interface DecimalFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: number;                        // NaN means "empty"
  onChange: (next: number) => void;     // emits NaN when input is empty/partial
  allowNegative?: boolean;
}

export function DecimalField({
  value, onChange, allowNegative = false, className, ...rest
}: DecimalFieldProps) {
  const [text, setText] = useState<string>(() =>
    Number.isFinite(value) ? String(value) : ''
  );
  const focusedRef = useRef(false);

  // Sync external value changes (e.g. switching which row is being edited).
  // Skip while the input is focused so the operator's mid-typing buffer
  // ("0.") isn't reformatted under their fingers when the parent re-renders
  // with a numerically-equal value.
  useEffect(() => {
    if (focusedRef.current) return;
    const next = Number.isFinite(value) ? String(value) : '';
    setText((prev) => (Number(prev) === value && prev !== '' ? prev : next));
  }, [value]);

  const re = allowNegative ? /^-?\d*\.?\d*$/ : /^\d*\.?\d*$/;

  return (
    <input
      type="text"
      inputMode="decimal"
      className={className}
      value={text}
      onFocus={(e) => { focusedRef.current = true; rest.onFocus?.(e); }}
      onBlur={(e) => {
        focusedRef.current = false;
        // Normalise trailing garbage like "0." → "0" on blur so the display
        // matches the committed value.
        if (Number.isFinite(value)) setText(String(value));
        else setText('');
        rest.onBlur?.(e);
      }}
      onChange={(e) => {
        const v = e.target.value;
        if (v !== '' && !re.test(v)) return;       // reject letters etc.
        setText(v);
        if (v === '' || v === '.' || v === '-' || v === '-.') {
          onChange(NaN);
        } else {
          const n = parseFloat(v);
          onChange(Number.isFinite(n) ? n : NaN);
        }
      }}
      {...rest}
    />
  );
}

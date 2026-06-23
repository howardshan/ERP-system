import React, { useEffect, useRef } from 'react';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];

/**
 * Touch-friendly numeric keypad used in TestingPage to enter Aw / lab readings.
 *
 * Also listens to the **physical keyboard** while mounted so operators on a
 * laptop can just type digits / "." / Backspace without clicking the buttons.
 * Physical input is suppressed when any editable element (input, textarea,
 * select, contenteditable) has focus — that way the Sample ID input and the
 * Remark textarea on the same screen still get their normal typing behaviour.
 */
export function NumericKeypad(
  { value, onChange, maxDecimals = 2 }:
  { value: string; onChange: (v: string) => void; maxDecimals?: number },
) {
  // Keep latest value + onChange (+ maxDecimals) in a ref so the keydown listener
  // can read them without re-binding on every keystroke.
  const stateRef = useRef({ value, onChange, maxDecimals });
  stateRef.current = { value, onChange, maxDecimals };

  const apply = (key: string) => {
    const { value: v, onChange: cb, maxDecimals: md } = stateRef.current;
    if (key === '⌫') {
      cb(v.slice(0, -1));
      return;
    }
    if (key === '.' && v.includes('.')) return;
    if (v === '' && key === '.') {
      cb('0.');
      return;
    }
    const next = v + key;
    const parts = next.split('.');
    if (parts[1] && parts[1].length > md) return;
    cb(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't steal keystrokes from real form fields on the same page.
      const el = document.activeElement as HTMLElement | null;
      if (el) {
        const tag = el.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) {
          return;
        }
      }
      // Ignore modifier-combo shortcuts (Cmd+R, Ctrl+L, etc.) so we don't
      // interfere with browser actions.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        apply(e.key);
      } else if (e.key === '.' || e.key === ',') {
        // Accept "," too — some keypad layouts emit "," for the decimal.
        e.preventDefault();
        apply('.');
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        apply('⌫');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // apply() reads from stateRef so this listener never needs re-binding.
  }, []);

  return (
    <div className="grid grid-cols-3 gap-3 max-w-md mx-auto">
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => apply(k)}
          className="min-h-[52px] text-2xl font-semibold rounded-xl bg-white border-2 border-slate-200 active:bg-slate-100 shadow-sm"
        >
          {k}
        </button>
      ))}
    </div>
  );
}

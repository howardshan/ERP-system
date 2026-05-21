import React from 'react';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];

export function NumericKeypad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const press = (key: string) => {
    if (key === '⌫') {
      onChange(value.slice(0, -1));
      return;
    }
    if (key === '.' && value.includes('.')) return;
    if (value === '' && key === '.') {
      onChange('0.');
      return;
    }
    const next = value + key;
    const parts = next.split('.');
    if (parts[1] && parts[1].length > 2) return;
    onChange(next);
  };

  return (
    <div className="grid grid-cols-3 gap-3 max-w-md mx-auto">
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => press(k)}
          className="min-h-[52px] text-2xl font-semibold rounded-xl bg-white border-2 border-slate-200 active:bg-slate-100 shadow-sm"
        >
          {k}
        </button>
      ))}
    </div>
  );
}

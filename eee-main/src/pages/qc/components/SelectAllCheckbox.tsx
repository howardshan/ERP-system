import React, { useEffect, useRef } from 'react';

interface Props {
  total: number;
  selected: number;
  onToggleAll: () => void;
  label?: string;
}

export function SelectAllCheckbox({ total, selected, onToggleAll, label }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const allSelected = total > 0 && selected === total;
  const indeterminate = selected > 0 && selected < total;

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
      <input
        ref={ref}
        type="checkbox"
        checked={allSelected}
        onChange={onToggleAll}
        disabled={total === 0}
        className="w-4 h-4 rounded accent-blue-600 cursor-pointer disabled:cursor-not-allowed"
      />
      <span className="font-medium">
        {label ?? 'Select all'}
        {total > 0 && (
          <span className="ml-1 text-slate-400">
            ({selected}/{total})
          </span>
        )}
      </span>
    </label>
  );
}

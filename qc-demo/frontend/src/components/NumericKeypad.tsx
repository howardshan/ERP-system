import { Delete } from 'lucide-react';
import { cn } from '../lib/utils';

type Props = {
  value: string;
  onChange: (v: string) => void;
};

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'] as const;

export function NumericKeypad({ value, onChange }: Props) {
  const press = (key: (typeof KEYS)[number]) => {
    if (key === 'back') {
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
          aria-label={k === 'back' ? 'Backspace' : k}
          className={cn(
            'min-h-[56px] text-2xl font-semibold rounded-xl bg-white border-2 border-slate-200',
            'shadow-sm transition-all active:scale-[0.98] active:bg-teal-50 active:border-teal-300',
            'hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2',
            k === 'back' && 'text-lg'
          )}
        >
          {k === 'back' ? <Delete className="h-6 w-6 mx-auto text-slate-600" /> : k}
        </button>
      ))}
    </div>
  );
}

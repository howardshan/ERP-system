import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '../lib/utils';

export type RowAction = {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'danger';
  disabled?: boolean;
};

export function RowActionsMenu({
  actions,
  disabled = false,
  align = 'right',
}: {
  actions: RowAction[];
  disabled?: boolean;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const run = (action: RowAction) => {
    if (action.disabled) return;
    setOpen(false);
    action.onClick();
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-label="Actions"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'min-h-[44px] min-w-[44px] rounded-lg border border-slate-200 bg-white',
          'text-slate-600 hover:bg-slate-50 hover:border-slate-300',
          'flex items-center justify-center text-xl leading-none tracking-tighter',
          'disabled:opacity-40 disabled:cursor-not-allowed'
        )}
      >
        ⋮
      </button>
      {open && (
        <ul
          id={menuId}
          role="menu"
          className={cn(
            'absolute z-20 mt-1 min-w-[9rem] py-1 rounded-lg border border-slate-200',
            'bg-white shadow-lg',
            align === 'right' ? 'right-0' : 'left-0'
          )}
        >
          {actions.map((action) => (
            <li key={action.label} role="none">
              <button
                type="button"
                role="menuitem"
                disabled={action.disabled}
                onClick={() => run(action)}
                className={cn(
                  'w-full text-left px-4 py-3 text-sm min-h-[44px]',
                  action.variant === 'danger'
                    ? 'text-red-600 hover:bg-red-50'
                    : 'text-slate-800 hover:bg-slate-50',
                  'disabled:opacity-40 disabled:cursor-not-allowed'
                )}
              >
                {action.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

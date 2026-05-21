import { useEffect, useId, useRef, useState } from 'react';
import { MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';

export type RowAction = {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'danger';
  disabled?: boolean;
};

const actionIcons: Record<string, typeof Pencil> = {
  Edit: Pencil,
  Delete: Trash2,
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
          'flex items-center justify-center transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2',
          'disabled:opacity-40 disabled:cursor-not-allowed'
        )}
      >
        <MoreVertical className="h-5 w-5" aria-hidden />
      </button>
      {open && (
        <ul
          id={menuId}
          role="menu"
          className={cn(
            'absolute z-20 mt-1 min-w-[10rem] py-1 rounded-xl border border-slate-200',
            'bg-white shadow-lg ring-1 ring-slate-200/80',
            align === 'right' ? 'right-0' : 'left-0'
          )}
        >
          {actions.map((action) => {
            const Icon = actionIcons[action.label];
            return (
              <li key={action.label} role="none">
                <button
                  type="button"
                  role="menuitem"
                  disabled={action.disabled}
                  onClick={() => run(action)}
                  className={cn(
                    'w-full text-left px-3 py-2.5 text-sm min-h-[44px] flex items-center gap-2',
                    action.variant === 'danger'
                      ? 'text-red-600 hover:bg-red-50'
                      : 'text-slate-800 hover:bg-slate-50',
                    'disabled:opacity-40 disabled:cursor-not-allowed'
                  )}
                >
                  {Icon && <Icon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />}
                  {action.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

interface Props {
  /** Optional heading shown bold at the top of the popover. */
  title?: string;
  /** Body text — explanation of the metric / card / section. */
  content: React.ReactNode;
  /** Override icon size (default 12px — sized for stat-card headers). */
  size?: number;
  /** Extra class for the trigger button (positioning, etc.). */
  className?: string;
  /**
   * Trigger color hint. Default is a soft slate; pass a tailwind text color
   * class to match the surrounding card accent (e.g. 'text-amber-600/70').
   */
  triggerClass?: string;
  /** Popover alignment relative to the trigger (default 'right'). */
  align?: 'left' | 'right';
}

/**
 * Click-to-open help bubble. Click the "?" icon to toggle; click outside or
 * press Escape to close. Stops propagation so it never triggers the parent
 * card's onClick. Intentionally small / zero-deps — no third-party popper.
 */
export function HelpPopover({
  title,
  content,
  size = 12,
  className,
  triggerClass,
  align = 'right',
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={rootRef} className={cn('relative inline-flex', className)}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        aria-label="What does this mean?"
        aria-expanded={open}
        className={cn(
          'inline-flex items-center justify-center rounded-full transition-opacity',
          'opacity-60 hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
          triggerClass ?? 'text-slate-500',
        )}
      >
        <HelpCircle size={size} />
      </button>
      {open && (
        <div
          role="tooltip"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'absolute z-50 top-full mt-1 w-64 rounded-lg border border-slate-200 bg-white p-3',
            'shadow-lg text-[11px] leading-relaxed text-slate-700',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {title && (
            <p className="text-xs font-bold text-slate-900 mb-1">{title}</p>
          )}
          <div className="whitespace-pre-wrap">{content}</div>
        </div>
      )}
    </span>
  );
}

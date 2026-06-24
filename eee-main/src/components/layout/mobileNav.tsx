import React, { useState } from 'react';
import { Menu } from 'lucide-react';
import { cn } from '../../lib/utils';

// Shared "collapsible sidebar on mobile" primitives. Every module shell uses a
// fixed `w-64` sidebar with `ml-64` content + a sticky header — fine on desktop
// but on small screens the sidebar covers/squeezes content. These helpers make
// the sidebar an off-canvas drawer below `lg` (toggled by a hamburger) while
// keeping the always-visible behaviour at `lg` and up.

export function useSidebar() {
  const [open, setOpen] = useState(false);
  return {
    open,
    openSidebar: () => setOpen(true),
    closeSidebar: () => setOpen(false),
  };
}

/** Transform classes for the <aside>: off-canvas (hidden) on mobile unless
 *  open; always on-canvas at lg+. Append to the aside's existing fixed/w-64. */
export function sidebarOffCanvas(open: boolean): string {
  return cn(
    'z-40 transition-transform duration-200 lg:translate-x-0',
    open ? 'translate-x-0' : '-translate-x-full',
  );
}

/** Dark backdrop behind an open drawer — mobile only. */
export function SidebarScrim({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <div onClick={onClose} aria-hidden className="fixed inset-0 bg-black/40 z-30 lg:hidden" />;
}

/** Hamburger toggle — render at the start of a module header; mobile only. */
export function SidebarToggle({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open menu"
      className={cn('p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors lg:hidden', className)}
    >
      <Menu size={18} />
    </button>
  );
}

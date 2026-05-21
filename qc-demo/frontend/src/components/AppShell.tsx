import { useState } from 'react';
import {
  Box,
  ClipboardCheck,
  GitBranch,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  X,
} from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { clearAuth, loadAuth } from '../api/client';
import { ShellAccentProvider } from '../context/ShellAccentContext';
import { Button } from './ui/Button';
import { getTone } from './ui/tone';
import { DemoBanner } from './DemoBanner';
import { cn } from '../lib/utils';
import type { LucideIcon } from 'lucide-react';

type NavItem = { to: string; label: string; icon: LucideIcon };

const QC_NAV: NavItem[] = [
  { to: '/qc', label: 'QC Home', icon: Home },
  { to: '/qc/lots', label: 'Production Lots', icon: Package },
  { to: '/qc/pending', label: 'Pending Queue', icon: ClipboardCheck },
];

const ADMIN_NAV: NavItem[] = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/admin/products', label: 'Products', icon: Box },
  { to: '/admin/trace', label: 'Batch Trace', icon: GitBranch },
];

const ROLE_LABEL: Record<string, string> = {
  manager: 'Quality Manager',
  qc: 'QC Operator',
};

export function AppShell({
  variant,
  children,
  title,
}: {
  variant: 'qc' | 'admin';
  children: React.ReactNode;
  title?: string;
}) {
  const auth = loadAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const accent = variant;
  const t = getTone(accent);
  const nav = variant === 'qc' ? QC_NAV : ADMIN_NAV;
  const roleTitle = variant === 'qc' ? 'QC Floor' : 'Quality Management';
  const comfortable = variant === 'qc';
  const maxWidth = variant === 'admin' ? 'max-w-6xl' : 'max-w-5xl';

  const NavLinks = ({ onNavigate }: { onNavigate?: () => void }) => (
    <nav className={cn('flex flex-col gap-0.5 p-3', comfortable && 'gap-1')}>
      {nav.map((item) => {
        const Icon = item.icon;
        const active =
          location.pathname === item.to ||
          (item.to !== '/qc' && item.to !== '/admin' && location.pathname.startsWith(item.to));
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={cn(
              'rounded-lg text-sm font-medium min-h-[44px] flex items-center gap-3 border-l-[3px] border-transparent pl-2.5 pr-3',
              comfortable && 'min-h-[48px] text-base',
              active ? t.navActive : 'text-slate-700 hover:bg-slate-50'
            )}
          >
            <Icon className="h-5 w-5 shrink-0 opacity-80" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <ShellAccentProvider accent={accent}>
      <div className="min-h-screen flex flex-col bg-slate-50">
        <DemoBanner />
        <header className="bg-white border-b border-slate-200/80 shadow-sm px-4 py-3 flex items-center gap-3 shrink-0">
          <button
            type="button"
            className="lg:hidden min-h-[44px] min-w-[44px] rounded-lg border border-slate-200 flex items-center justify-center text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="font-bold text-lg text-slate-900 tracking-tight">{roleTitle}</div>
          <div className="flex-1" />
          {auth?.role === 'manager' && variant === 'admin' && (
            <Link
              to="/qc"
              className={cn('text-sm font-medium min-h-[44px] flex items-center px-2', t.link)}
            >
              QC Floor
            </Link>
          )}
          {auth?.role === 'manager' && variant === 'qc' && (
            <Link
              to="/admin"
              className={cn('text-sm font-medium min-h-[44px] flex items-center px-2', t.link)}
            >
              Admin
            </Link>
          )}
          {auth && (
            <span
              className={cn(
                'hidden sm:inline-flex text-xs font-medium px-2.5 py-1 rounded-full border',
                variant === 'admin' ? 'bg-indigo-50 text-indigo-800 border-indigo-200' : 'bg-teal-50 text-teal-800 border-teal-200'
              )}
            >
              {ROLE_LABEL[auth.role] ?? auth.role}
            </span>
          )}
          <span className="text-sm text-slate-500 hidden md:inline">{auth?.displayName || auth?.username}</span>
          <Button variant="ghost" size="md" onClick={() => { clearAuth(); navigate('/login'); }}>
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </header>

        <div className="flex flex-1 min-h-0">
          <aside className="hidden lg:flex w-60 shrink-0 bg-white border-r border-slate-200/80 flex-col">
            <p className="px-4 pt-4 pb-1 text-xs font-semibold text-slate-400 uppercase tracking-wide">Menu</p>
            <NavLinks />
          </aside>

          {drawerOpen && (
            <>
              <button
                type="button"
                className="fixed inset-0 bg-black/40 z-40 lg:hidden transition-opacity"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close overlay"
              />
              <aside className="fixed left-0 top-0 bottom-0 w-72 bg-white z-50 shadow-xl lg:hidden flex flex-col">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
                  <span className="font-semibold text-slate-900">Menu</span>
                  <button
                    type="button"
                    className="min-h-[44px] min-w-[44px] rounded-lg flex items-center justify-center hover:bg-slate-100"
                    onClick={() => setDrawerOpen(false)}
                    aria-label="Close menu"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <NavLinks onNavigate={() => setDrawerOpen(false)} />
              </aside>
            </>
          )}

          <main className={cn('flex-1 overflow-auto p-4 md:p-6 w-full mx-auto', maxWidth)}>
            {title && <h1 className="text-2xl font-bold mb-4 text-slate-900 tracking-tight">{title}</h1>}
            {children}
          </main>
        </div>
      </div>
    </ShellAccentProvider>
  );
}

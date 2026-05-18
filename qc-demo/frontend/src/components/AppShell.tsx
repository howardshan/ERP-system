import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { clearAuth, loadAuth } from '../api/client';
import { DemoBanner } from './DemoBanner';
import { cn } from '../lib/utils';

type NavItem = { to: string; label: string };

const QC_NAV: NavItem[] = [
  { to: '/qc', label: 'QC 工作台' },
  { to: '/qc/lots', label: '生产批管理' },
  { to: '/qc/pending', label: '待检队列' },
];

const ADMIN_NAV: NavItem[] = [
  { to: '/admin', label: '管理看板' },
  { to: '/admin/products', label: '产品管理' },
  { to: '/admin/trace', label: '批次追溯' },
];

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

  const nav = variant === 'qc' ? QC_NAV : ADMIN_NAV;
  const roleTitle = variant === 'qc' ? 'QC 现场' : '质量管理';

  const NavLinks = ({ onNavigate }: { onNavigate?: () => void }) => (
    <nav className="flex flex-col gap-1 p-3">
      {nav.map((item) => {
        const active =
          location.pathname === item.to ||
          (item.to !== '/qc' && item.to !== '/admin' && location.pathname.startsWith(item.to));
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={cn(
              'rounded-lg px-3 py-3 text-sm font-medium min-h-[44px] flex items-center',
              active ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-100'
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen flex flex-col bg-slate-100">
      <DemoBanner />
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 shrink-0">
        <button
          type="button"
          className="lg:hidden min-h-[44px] min-w-[44px] rounded-lg border border-slate-200 text-xl"
          onClick={() => setDrawerOpen(true)}
          aria-label="打开菜单"
        >
          ☰
        </button>
        <div className="font-bold text-lg text-slate-800">{roleTitle}</div>
        <div className="flex-1" />
        {auth?.role === 'manager' && variant === 'admin' && (
          <Link to="/qc" className="text-sm text-blue-600 min-h-[44px] flex items-center px-2">
            QC 现场
          </Link>
        )}
        {auth?.role === 'manager' && variant === 'qc' && (
          <Link to="/admin" className="text-sm text-blue-600 min-h-[44px] flex items-center px-2">
            管理端
          </Link>
        )}
        <span className="text-sm text-slate-500 hidden sm:inline">{auth?.displayName || auth?.username}</span>
        <button
          type="button"
          className="text-sm text-slate-600 underline min-h-[44px] px-2"
          onClick={() => {
            clearAuth();
            navigate('/login');
          }}
        >
          退出
        </button>
      </header>

      <div className="flex flex-1 min-h-0">
        <aside className="hidden lg:flex w-56 shrink-0 bg-white border-r border-slate-200 flex-col">
          <p className="p-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">菜单</p>
          <NavLinks />
        </aside>

        {drawerOpen && (
          <>
            <button
              type="button"
              className="fixed inset-0 bg-black/40 z-40 lg:hidden"
              onClick={() => setDrawerOpen(false)}
              aria-label="关闭遮罩"
            />
            <aside className="fixed left-0 top-0 bottom-0 w-72 bg-white z-50 shadow-xl lg:hidden flex flex-col pt-14">
              <NavLinks onNavigate={() => setDrawerOpen(false)} />
            </aside>
          </>
        )}

        <main className="flex-1 overflow-auto p-4 md:p-6 max-w-5xl w-full mx-auto">
          {title && <h1 className="text-2xl font-bold mb-4 text-slate-900">{title}</h1>}
          {children}
        </main>
      </div>
    </div>
  );
}

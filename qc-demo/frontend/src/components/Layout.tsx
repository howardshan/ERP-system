import { Link, useNavigate } from 'react-router-dom';
import { clearAuth, loadAuth } from '../api/client';
import { DemoBanner } from './DemoBanner';

export function Layout({
  children,
  nav,
}: {
  children: React.ReactNode;
  nav?: { to: string; label: string }[];
}) {
  const auth = loadAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col">
      <DemoBanner />
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-2">
        <div className="font-bold text-lg text-slate-800">烘干后 QC</div>
        <div className="flex items-center gap-2 text-sm flex-wrap justify-end">
          {nav?.map((n) => (
            <Link key={n.to} to={n.to} className="text-blue-600 font-medium px-2 py-1 min-h-[44px] flex items-center">
              {n.label}
            </Link>
          ))}
          <span className="text-slate-500">{auth?.displayName || auth?.username}</span>
          <button
            type="button"
            className="text-slate-600 underline min-h-[44px] px-2"
            onClick={() => {
              clearAuth();
              navigate('/login');
            }}
          >
            退出
          </button>
        </div>
      </header>
      <main className="flex-1 p-4 max-w-4xl mx-auto w-full">{children}</main>
    </div>
  );
}

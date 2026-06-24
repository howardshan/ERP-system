import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { useSidebar, SidebarScrim } from './mobileNav';
import { getPendingApprovals } from '../../services/api';

interface DashboardLayoutProps {
  children: (activeScreen: string, setActiveScreen: (s: string) => void) => React.ReactNode;
  onHome: () => void;
  onLogout: () => void;
  userName: string;
  userEmail: string;
}

export function DashboardLayout({ children, onHome, onLogout, userName, userEmail }: DashboardLayoutProps) {
  const { t } = useTranslation('nav');
  const [activeScreen, setActiveScreen] = useState('dashboard');
  const [pendingCount, setPendingCount] = useState(0);
  const { open, openSidebar, closeSidebar } = useSidebar();

  useEffect(() => {
    getPendingApprovals()
      .then(entries => setPendingCount(entries.length))
      .catch(() => {});
  }, [activeScreen]);

  return (
    <div className="min-h-screen bg-[#faf8f5]">
      <Sidebar
        activeScreen={activeScreen}
        setActiveScreen={(s) => { setActiveScreen(s); closeSidebar(); }}
        pendingApprovalCount={pendingCount}
        onHome={onHome}
        open={open}
      />
      <SidebarScrim open={open} onClose={closeSidebar} />
      <div className="lg:ml-64 flex flex-col min-h-screen">
        <TopBar userName={userName} userEmail={userEmail} onLogout={onLogout} onMenuClick={openSidebar} />
        <main className="flex-1 p-4 sm:p-8">
          {children(activeScreen, setActiveScreen)}
        </main>
        <footer className="px-8 py-3 bg-white border-t border-slate-200 text-[10px] text-slate-400 flex justify-between uppercase font-bold tracking-widest">
          <div>{t('dashboardLayout.erpStatus')}</div>
          <div>{t('dashboardLayout.server')}</div>
        </footer>
      </div>
    </div>
  );
}

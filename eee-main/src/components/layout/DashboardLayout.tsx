import React, { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { getPendingApprovals } from '../../services/api';

interface DashboardLayoutProps {
  children: (activeScreen: string, setActiveScreen: (s: string) => void) => React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [activeScreen, setActiveScreen] = useState('dashboard');
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    getPendingApprovals()
      .then(entries => setPendingCount(entries.length))
      .catch(() => {});
  }, [activeScreen]); // refresh badge whenever user navigates

  return (
    <div className="min-h-screen bg-[#f8f9ff]">
      <Sidebar
        activeScreen={activeScreen}
        setActiveScreen={setActiveScreen}
        pendingApprovalCount={pendingCount}
      />
      <div className="ml-64 flex flex-col min-h-screen">
        <TopBar />
        <main className="flex-1 p-8">
          {children(activeScreen, setActiveScreen)}
        </main>
        <footer className="px-8 py-3 bg-white border-t border-slate-200 text-[10px] text-slate-400 flex justify-between uppercase font-bold tracking-widest">
          <div>ERP Status: Active</div>
          <div>Server: US-WEST-1 (Production)</div>
        </footer>
      </div>
    </div>
  );
}

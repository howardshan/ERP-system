import React, { useState } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

interface DashboardLayoutProps {
  children: (activeScreen: string, setActiveScreen: (s: string) => void) => React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [activeScreen, setActiveScreen] = useState('dashboard');

  return (
    <div className="min-h-screen bg-[#f8f9ff]">
      <Sidebar activeScreen={activeScreen} setActiveScreen={setActiveScreen} />
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

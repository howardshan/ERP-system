import React, { useState, useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { PermissionProvider } from './contexts/PermissionContext';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import { DashboardLayout } from './components/layout/DashboardLayout';
import FinanceDashboard from './pages/FinanceDashboard';
import ChartOfAccounts from './pages/ChartOfAccounts';
import JournalEntryForm from './pages/JournalEntryForm';
import JournalEntriesList from './pages/JournalEntriesList';
import AccountsSubmodule from './pages/AccountsSubmodule';
import { TrialBalance, AccountingPeriods } from './pages/ReportsAndPeriods';
import ApprovalsQueue from './pages/ApprovalsQueue';
import ApprovalSettings from './pages/ApprovalSettings';
import WorkflowList from './pages/WorkflowList';
import WorkflowBuilder from './pages/WorkflowBuilder';
import DocsPage from './pages/DocsPage';
import UserManagement from './pages/auth/UserManagement';
import HRModule from './pages/hr/HRModule';
import QualityControlModule from './pages/qc/QualityControlModule';
import AuditLog from './pages/finance/AuditLog';
import ProfitLoss from './pages/finance/ProfitLoss';
import BalanceSheet from './pages/finance/BalanceSheet';

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [activeModule, setActiveModule] = useState<string>('home');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  // Loading while session is being checked
  if (session === undefined) {
    return (
      <div className="min-h-screen bg-[#faf8f5] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (session === null) {
    return <LoginPage />;
  }

  const userEmail = session.user.email ?? '';
  const userName = session.user.user_metadata?.full_name ?? userEmail.split('@')[0];

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  return (
    <PermissionProvider authUserId={session.user.id}>
      <AppShell
        activeModule={activeModule}
        setActiveModule={setActiveModule}
        userName={userName}
        userEmail={userEmail}
        onLogout={handleLogout}
      />
    </PermissionProvider>
  );
}

function AppShell({
  activeModule, setActiveModule, userName, userEmail, onLogout,
}: {
  activeModule: string;
  setActiveModule: (m: string) => void;
  userName: string;
  userEmail: string;
  onLogout: () => void;
}) {
  if (activeModule === 'home') {
    return (
      <HomePage
        onNavigate={setActiveModule}
        onLogout={onLogout}
        userName={userName}
        userEmail={userEmail}
      />
    );
  }

  if (activeModule === 'finance') {
    return (
      <DashboardLayout onHome={() => setActiveModule('home')} onLogout={onLogout} userName={userName} userEmail={userEmail}>
        {(activeScreen, setActiveScreen) => {
          if (activeScreen.startsWith('je-edit:')) {
            const id = parseInt(activeScreen.split(':')[1], 10);
            return <JournalEntryForm onNavigate={setActiveScreen} editEntryId={id} />;
          }

          switch (activeScreen) {
            case 'dashboard':
              return <FinanceDashboard onNavigate={setActiveScreen} />;
            case 'coa':
              return <ChartOfAccounts />;
            case 'je-create':
              return <JournalEntryForm onNavigate={setActiveScreen} />;
            case 'je-list':
              return <JournalEntriesList onNavigate={setActiveScreen} />;
            case 'approvals':
              return <ApprovalsQueue onNavigate={setActiveScreen} />;
            case 'ap':
              return <AccountsSubmodule type="AP" />;
            case 'ar':
              return <AccountsSubmodule type="AR" />;
            case 'trial-balance':
              return <TrialBalance />;
            case 'pnl':
              return <ProfitLoss onNavigate={setActiveScreen} />;
            case 'bs':
              return <BalanceSheet onNavigate={setActiveScreen} />;
            case 'reports':
            case 'periods':
              return <AccountingPeriods />;
            case 'approval-settings':
              return <ApprovalSettings />;
            case 'audit-log':
              return <AuditLog />;
            default:
              return <FinanceDashboard onNavigate={setActiveScreen} />;
          }
        }}
      </DashboardLayout>
    );
  }

  if (activeModule === 'workflow') {
    return <WorkflowModule onHome={() => setActiveModule('home')} />;
  }

  if (activeModule === 'docs') {
    return <DocsPage onHome={() => setActiveModule('home')} />;
  }

  if (activeModule === 'auth') {
    return <UserManagement onHome={() => setActiveModule('home')} />;
  }

  if (activeModule === 'hr') {
    return <HRModule onHome={() => setActiveModule('home')} />;
  }

  if (activeModule === 'qc') {
    return <QualityControlModule onHome={() => setActiveModule('home')} />;
  }

  return <ModulePlaceholder name={activeModule} onHome={() => setActiveModule('home')} />;
}

function WorkflowModule({ onHome }: { onHome: () => void }) {
  const [screen, setScreen] = useState('wf-list');

  function navigate(s: string) {
    if (s === 'home') { onHome(); return; }
    setScreen(s);
  }

  if (screen.startsWith('wf-builder:')) {
    const id = screen.split(':')[1];
    return (
      <WorkflowBuilder
        workflowId={id && id !== 'new' ? parseInt(id, 10) : null}
        onNavigate={navigate}
      />
    );
  }

  return <WorkflowList onNavigate={navigate} />;
}

function ModulePlaceholder({ name, onHome }: { name: string; onHome: () => void }) {
  const labels: Record<string, string> = {
    warehouse: 'Warehouse & Inventory',
    sales: 'Sales & Distribution',
    production: 'Production & Manufacturing',
    auth: 'Users & Authentication',
  };

  return (
    <div className="min-h-screen bg-[#faf8f5] flex flex-col items-center justify-center gap-6">
      <p className="text-slate-400 text-xs uppercase tracking-widest font-bold">In Development</p>
      <h1 className="text-3xl font-bold text-slate-900">{labels[name] ?? name}</h1>
      <p className="text-slate-500 text-sm">This module is coming soon.</p>
      <button
        onClick={onHome}
        className="mt-4 px-6 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 text-sm font-bold rounded-xl transition-colors"
      >
        ← Back to Home
      </button>
    </div>
  );
}

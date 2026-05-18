import React from 'react';
import { DashboardLayout } from './components/layout/DashboardLayout';
import FinanceDashboard from './pages/FinanceDashboard';
import ChartOfAccounts from './pages/ChartOfAccounts';
import JournalEntryForm from './pages/JournalEntryForm';
import JournalEntriesList from './pages/JournalEntriesList';
import AccountsSubmodule from './pages/AccountsSubmodule';
import { TrialBalance, AccountingPeriods } from './pages/ReportsAndPeriods';
import ApprovalsQueue from './pages/ApprovalsQueue';
import ApprovalSettings from './pages/ApprovalSettings';

export default function App() {
  return (
    <DashboardLayout>
      {(activeScreen, setActiveScreen) => {
        // "je-edit:123" deep-link
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
          case 'reports':
          case 'periods':
            return <AccountingPeriods />;
          case 'approval-settings':
            return <ApprovalSettings />;
          default:
            return <FinanceDashboard onNavigate={setActiveScreen} />;
        }
      }}
    </DashboardLayout>
  );
}

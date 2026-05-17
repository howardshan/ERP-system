/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { DashboardLayout } from './components/layout/DashboardLayout';
import FinanceDashboard from './pages/FinanceDashboard';
import ChartOfAccounts from './pages/ChartOfAccounts';
import JournalEntryForm from './pages/JournalEntryForm';
import JournalEntriesList from './pages/JournalEntriesList';
import AccountsSubmodule from './pages/AccountsSubmodule';
import { TrialBalance, AccountingPeriods } from './pages/ReportsAndPeriods';

export default function App() {
  return (
    <DashboardLayout>
      {(activeScreen) => {
        switch (activeScreen) {
          case 'dashboard':
            return <FinanceDashboard />;
          case 'coa':
            return <ChartOfAccounts />;
          case 'je-create':
            return <JournalEntryForm />;
          case 'je-list':
            return <JournalEntriesList />;
          case 'ap':
            return <AccountsSubmodule type="AP" />;
          case 'ar':
            return <AccountsSubmodule type="AR" />;
          case 'trial-balance':
            return <TrialBalance />;
          case 'periods':
            return <AccountingPeriods />;
          default:
            return <FinanceDashboard />;
        }
      }}
    </DashboardLayout>
  );
}

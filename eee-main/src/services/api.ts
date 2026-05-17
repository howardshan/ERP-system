import { Account, JournalEntry, AccountingPeriod, Invoice } from '../types';

/**
 * MOCK API SERVICE
 * In a real application, these would use the Supabase client:
 * supabase.rpc('function_name', { params })
 */

export const api = {
  // Accounts
  getAccounts: async (): Promise<Account[]> => {
    // Implementation of hierarchical fetch
    return [];
  },

  // Journal Entries
  getJournalEntries: async (): Promise<JournalEntry[]> => {
    return [];
  },

  postJournalEntry: async (entry: Partial<JournalEntry>): Promise<{ success: boolean; error?: string }> => {
    console.log('Posting Journal Entry to Supabase RPC:', entry);
    // Stub for supabase.rpc('post_journal_entry', { entry_data: entry })
    return { success: true };
  },

  // AP / AR
  getInvoices: async (type: 'AP' | 'AR'): Promise<Invoice[]> => {
    return [];
  },

  // Periods
  getPeriods: async (): Promise<AccountingPeriod[]> => {
    return [];
  },

  closeAccountingPeriod: async (periodId: string): Promise<{ success: boolean; error?: string }> => {
    console.log('Closing period via Supabase RPC:', periodId);
    // Stub for supabase.rpc('close_period', { pid: periodId })
    return { success: true };
  },

  // Reports
  getTrialBalance: async (periodId: string) => {
    // Stub for complex reporting logic
    return [];
  }
};

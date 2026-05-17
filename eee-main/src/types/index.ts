export type AccountType = 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense';

export interface Account {
  id: string;
  code: string; // Segmented: e.g. 1200-10-300
  name: string;
  type: AccountType;
  level: number;
  parent_id?: string;
  is_postable: boolean;
  balance: number;
  children?: Account[];
}

export type JournalStatus = 'Draft' | 'Posted' | 'Approved' | 'Pending';

export interface JournalEntryLine {
  id: string;
  account_id: string;
  description: string;
  debit: number;
  credit: number;
  department?: string;
  cost_center?: string;
}

export interface JournalEntry {
  id: string;
  date: string;
  period_id: string;
  description: string;
  status: JournalStatus;
  lines: JournalEntryLine[];
  reference?: string;
}

export interface Invoice {
  id: string;
  number: string;
  entity_name: string; // Supplier or Customer
  date: string;
  due_date: string;
  amount: number;
  paid_amount: number;
  balance: number;
  status: 'Open' | 'Paid' | 'Overdue' | 'Partial';
}

export type PeriodStatus = 'Open' | 'Closed' | 'Future';

export interface AccountingPeriod {
  id: string;
  name: string; // OCT 2023
  start_date: string;
  end_date: string;
  status: PeriodStatus;
}

import type { ModuleDef } from '../types/auth';

export const PERMISSION_STRUCTURE: Record<string, ModuleDef> = {
  finance: {
    label: 'Financial Management',
    resources: {
      module_permissions: {
        label: 'Module Permissions',
        permissions: [
          { id: 'manage', label: 'Manage User Permissions', prereq: null },
        ],
      },
      journal_entry: {
        label: 'Journal Entries',
        permissions: [
          { id: 'view',    label: 'View',    prereq: null },
          { id: 'create',  label: 'Create',  prereq: 'view' },
          { id: 'edit',    label: 'Edit',    prereq: 'view' },
          { id: 'delete',  label: 'Delete',  prereq: 'edit' },
          { id: 'approve', label: 'Approve', prereq: 'view', hasLimit: true },
        ],
      },
      chart_of_accounts: {
        label: 'Chart of Accounts',
        permissions: [
          { id: 'view',   label: 'View',   prereq: null },
          { id: 'create', label: 'Create', prereq: 'view' },
          { id: 'edit',   label: 'Edit',   prereq: 'view' },
          { id: 'delete', label: 'Delete', prereq: 'edit' },
        ],
      },
      accounting_periods: {
        label: 'Accounting Periods',
        permissions: [
          { id: 'view',  label: 'View',  prereq: null },
          { id: 'close', label: 'Close', prereq: 'view' },
          { id: 'open',  label: 'Open',  prereq: 'view' },
        ],
      },
    },
  },
  workflow: {
    label: 'Workflow Studio',
    resources: {
      module_permissions: {
        label: 'Module Permissions',
        permissions: [
          { id: 'manage', label: 'Manage User Permissions', prereq: null },
        ],
      },
      workflow: {
        label: 'Workflows',
        permissions: [
          { id: 'view',    label: 'View',    prereq: null },
          { id: 'create',  label: 'Create',  prereq: 'view' },
          { id: 'edit',    label: 'Edit',    prereq: 'view' },
          { id: 'delete',  label: 'Delete',  prereq: 'edit' },
          { id: 'execute', label: 'Execute', prereq: 'view' },
        ],
      },
    },
  },
  warehouse: {
    label: 'Warehouse & Inventory',
    resources: {
      module_permissions: {
        label: 'Module Permissions',
        permissions: [
          { id: 'manage', label: 'Manage User Permissions', prereq: null },
        ],
      },
      inventory: {
        label: 'Inventory',
        permissions: [
          { id: 'view',     label: 'View',             prereq: null },
          { id: 'receive',  label: 'Goods Receipt',    prereq: 'view' },
          { id: 'transfer', label: 'Stock Transfer',   prereq: 'view' },
          { id: 'adjust',   label: 'Adjust Balance',   prereq: 'view' },
        ],
      },
    },
  },
  sales: {
    label: 'Sales & Distribution',
    resources: {
      module_permissions: {
        label: 'Module Permissions',
        permissions: [
          { id: 'manage', label: 'Manage User Permissions', prereq: null },
        ],
      },
      sales_order: {
        label: 'Sales Orders',
        permissions: [
          { id: 'view',    label: 'View',     prereq: null },
          { id: 'create',  label: 'Create',   prereq: 'view' },
          { id: 'edit',    label: 'Edit',     prereq: 'view' },
          { id: 'confirm', label: 'Confirm',  prereq: 'view' },
          { id: 'delete',  label: 'Delete',   prereq: 'edit' },
        ],
      },
    },
  },
  production: {
    label: 'Production & Manufacturing',
    resources: {
      module_permissions: {
        label: 'Module Permissions',
        permissions: [
          { id: 'manage', label: 'Manage User Permissions', prereq: null },
        ],
      },
      production_order: {
        label: 'Production Orders',
        permissions: [
          { id: 'view',     label: 'View',     prereq: null },
          { id: 'create',   label: 'Create',   prereq: 'view' },
          { id: 'release',  label: 'Release',  prereq: 'view' },
          { id: 'complete', label: 'Complete', prereq: 'view' },
        ],
      },
    },
  },
  auth: {
    label: 'Users & Authentication',
    resources: {
      module_permissions: {
        label: 'Module Permissions',
        permissions: [
          { id: 'manage', label: 'Manage User Permissions', prereq: null },
        ],
      },
      users: {
        label: 'User Accounts',
        permissions: [
          { id: 'view',           label: 'View',           prereq: null },
          { id: 'create',         label: 'Create User',    prereq: 'view' },
          { id: 'edit',           label: 'Edit User',      prereq: 'view' },
          { id: 'delete',         label: 'Delete User',    prereq: 'edit' },
          { id: 'reset_password', label: 'Reset Password', prereq: 'view' },
        ],
      },
      roles: {
        label: 'Roles & Permissions',
        permissions: [
          { id: 'view',   label: 'View',      prereq: null },
          { id: 'manage', label: 'Edit Role', prereq: 'view' },
        ],
      },
      departments: {
        label: 'Departments',
        permissions: [
          { id: 'view',   label: 'View',            prereq: null },
          { id: 'manage', label: 'Edit Department', prereq: 'view' },
        ],
      },
    },
  },
};

export const ALL_MODULES = Object.keys(PERMISSION_STRUCTURE);

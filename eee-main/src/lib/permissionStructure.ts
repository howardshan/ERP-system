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
      audit_log: {
        label: 'Audit Log',
        permissions: [
          { id: 'view', label: 'View Audit Log', prereq: null },
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
  hr: {
    label: 'Human Resources',
    resources: {
      module_permissions: {
        label: 'Module Permissions',
        permissions: [
          { id: 'manage', label: 'Manage User Permissions', prereq: null },
        ],
      },
      employees: {
        label: 'Employee Profiles',
        permissions: [
          { id: 'view',   label: 'View',         prereq: null },
          { id: 'edit',   label: 'Edit Profile', prereq: 'view' },
          { id: 'export', label: 'Export CSV',   prereq: 'view' },
        ],
      },
      departments: {
        label: 'Departments',
        permissions: [
          { id: 'view',   label: 'View',   prereq: null },
          { id: 'create', label: 'Create', prereq: 'view' },
          { id: 'edit',   label: 'Edit',   prereq: 'view' },
        ],
      },
      recruitment: {
        label: 'Recruitment & Interviews',
        permissions: [
          { id: 'view',   label: 'View',   prereq: null },
          { id: 'create', label: 'Create', prereq: 'view' },
          { id: 'edit',   label: 'Edit',   prereq: 'view' },
          { id: 'delete', label: 'Delete', prereq: 'edit' },
        ],
      },
      onboarding: {
        label: 'Onboarding',
        permissions: [
          { id: 'view',   label: 'View',   prereq: null },
          { id: 'manage', label: 'Manage', prereq: 'view' },
        ],
      },
      leave: {
        label: 'Leave Management',
        permissions: [
          { id: 'view',     label: 'View All Requests', prereq: null },
          { id: 'view_own', label: 'View Own Leave',    prereq: null },
          { id: 'approve',  label: 'Approve/Reject',    prereq: 'view' },
          { id: 'manage',   label: 'Manage Leave Types', prereq: 'view' },
        ],
      },
      payroll: {
        label: 'Payroll',
        permissions: [
          { id: 'view',    label: 'View',          prereq: null },
          { id: 'create',  label: 'Create Pay Run', prereq: 'view' },
          { id: 'approve', label: 'Approve',        prereq: 'view' },
          { id: 'manage',  label: 'Manage',         prereq: 'view' },
        ],
      },
      benefits: {
        label: 'Benefits',
        permissions: [
          { id: 'view',   label: 'View',   prereq: null },
          { id: 'manage', label: 'Manage', prereq: 'view' },
        ],
      },
      performance: {
        label: 'Performance Management',
        permissions: [
          { id: 'view',   label: 'View',   prereq: null },
          { id: 'manage', label: 'Manage', prereq: 'view' },
        ],
      },
      training: {
        label: 'Training & Development',
        permissions: [
          { id: 'view',   label: 'View',   prereq: null },
          { id: 'manage', label: 'Manage', prereq: 'view' },
        ],
      },
      audit_log: {
        label: 'HR Audit Log',
        permissions: [
          { id: 'view', label: 'View HR Audit Log', prereq: null },
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

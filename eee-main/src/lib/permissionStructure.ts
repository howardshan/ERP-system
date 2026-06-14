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
      items: {
        label: 'Items (Master Data)',
        permissions: [
          { id: 'view',   label: 'View',   prereq: null },
          { id: 'create', label: 'Create', prereq: 'view' },
          { id: 'edit',   label: 'Edit',   prereq: 'view' },
          { id: 'delete', label: 'Delete', prereq: 'edit' },
        ],
      },
      locations: {
        label: 'Locations',
        permissions: [
          { id: 'view', label: 'View', prereq: null },
          { id: 'edit', label: 'Edit', prereq: 'view' },
        ],
      },
      lots: {
        label: 'Lots',
        permissions: [
          { id: 'view',    label: 'View',    prereq: null },
          { id: 'release', label: 'Release', prereq: 'view' },
          { id: 'reject',  label: 'Reject',  prereq: 'view' },
        ],
      },
      goods_receipt: {
        label: 'Goods Receipt',
        permissions: [
          { id: 'view',   label: 'View',   prereq: null },
          { id: 'create', label: 'Create', prereq: 'view' },
          { id: 'post',   label: 'Post',   prereq: 'create' },
          { id: 'cancel', label: 'Cancel', prereq: 'view' },
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
        label: 'Production Orders (planned, not yet wired)',
        permissions: [
          { id: 'view',     label: 'View',     prereq: null },
          { id: 'create',   label: 'Create',   prereq: 'view' },
          { id: 'release',  label: 'Release',  prereq: 'view' },
          { id: 'complete', label: 'Complete', prereq: 'view' },
        ],
      },
      // M-125 (Phase 2 M1.1) — Work order master data (prod_work_order).
      // Frontend call site: pages/production/WorkOrderPage.tsx. NOTE: distinct
      // from the `work_orders` (plural) resource below, which is the QC-origin
      // "create batch / add carts" form.
      work_order: {
        label: 'Work Orders (master data)',
        permissions: [
          { id: 'view',   label: 'View',   prereq: null },
          { id: 'create', label: 'Create', prereq: 'view' },
          { id: 'edit',   label: 'Edit',   prereq: 'view' },
          { id: 'close',  label: 'Close',  prereq: 'view' },
        ],
      },
      // Moved here from `qc` module — see M-094.  Frontend call sites:
      // pages/qc/Production.tsx, pages/qc/LotDetail.tsx.
      work_orders: {
        label: 'Work Orders (Production form)',
        permissions: [
          { id: 'create', label: 'Create Work Order / Add Carts', prereq: null },
        ],
      },
      trace: {
        label: 'Batch Trace',
        permissions: [
          { id: 'view',            label: 'View Trace',                       prereq: null },
          { id: 'add_carts',       label: 'Add Carts to Existing Work Order', prereq: 'view' },
          { id: 'reprint_sticker', label: 'Reprint Cart Sticker',             prereq: 'view' },
        ],
      },
      products: {
        label: 'Products & Inspection Templates',
        permissions: [
          { id: 'view',   label: 'View',   prereq: null },
          { id: 'create', label: 'Create', prereq: 'view' },
          { id: 'edit',   label: 'Edit',   prereq: 'view' },
          { id: 'delete', label: 'Delete', prereq: 'edit' },
        ],
      },
      // M-122 — Daily Report data-entry (digitised Forming Production Excel).
      // Frontend call site: pages/production/DailyReportPage.tsx.
      daily_report: {
        label: 'Daily Report (Forming Production)',
        permissions: [
          { id: 'view',   label: 'View Daily Reports', prereq: null },
          { id: 'create', label: 'Create Report Row',  prereq: 'view' },
          { id: 'edit',   label: 'Edit Report Row',    prereq: 'view' },
          { id: 'delete', label: 'Delete Report Row',  prereq: 'edit' },
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
  qc: {
    label: 'Quality Control',
    resources: {
      module_permissions: {
        label: 'Module Permissions',
        permissions: [
          { id: 'manage', label: 'Manage User Permissions', prereq: null },
        ],
      },
      // (Moved to `production` module — see M-094.)
      dry_rooms: {
        label: 'Dry Rooms (5 physical dryers)',
        permissions: [
          { id: 'view_status', label: 'View Dryer Status & Grid',          prereq: null },
          { id: 'check_in',    label: 'Check In Sub-lot to Cell',          prereq: 'view_status' },
          { id: 'move',        label: 'Move Sub-lot Between Dry Rooms',    prereq: 'view_status' },
          { id: 'check_out',   label: 'Check Out Sub-lot from Dryer',      prereq: 'view_status' },
        ],
      },
      testing: {
        label: 'Testing & Dispositions',
        permissions: [
          { id: 'view_status',              label: 'View Testing Queue',                  prereq: null },
          { id: 'view_dashboard',           label: 'View Testing Dashboard (forecast)',   prereq: 'view_status' },
          { id: 'take_sample',              label: 'Take Sample',                         prereq: 'view_status' },
          { id: 'submit_inspection',        label: 'Submit Inspection (input WA)',        prereq: 'view_status' },
          // M-118: gate manual override of the auto-judged PASS/FAIL.
          // Required to flip the verdict inside the hard PASS range or to
          // make any decision in the soft tolerance band. Outside soft, even
          // supervisors must FAIL — no override allowed there.
          { id: 'supervisor_judge',         label: 'Supervisor Judge (override / soft band decisions)', prereq: 'submit_inspection' },
          { id: 'dispose_redry',            label: 'Dispose: Re-dry in dryer',            prereq: 'view_status' },
          { id: 'dispose_room_temp',        label: 'Dispose: Room temp dry',              prereq: 'view_status' },
          { id: 'dispose_retest',           label: 'Dispose: Retest (no re-dry)',         prereq: 'view_status' },
          { id: 'dispose_scrap_concession', label: 'Dispose: Scrap / Discard',            prereq: 'view_status' },
          { id: 'stop_room_temp',           label: 'Stop Room-temp Dry Session',          prereq: 'view_status' },
        ],
      },
      sub_lots: {
        label: 'Sub-lot History',
        permissions: [
          { id: 'view_history', label: 'View Sub-lot Full Timeline', prereq: null },
        ],
      },
      // products: moved to `production` module — see M-094.
      locations: {
        label: 'Dryer Locations (master data)',
        permissions: [
          { id: 'view',   label: 'View',           prereq: null },
          { id: 'manage', label: 'Manage Locations', prereq: 'view' },
        ],
      },
      dashboard: {
        label: 'QC Dashboard (merged QC Home)',
        permissions: [
          { id: 'view',         label: 'View Dashboard',                       prereq: null },
          { id: 'release_pass', label: 'Release Passed Sub-lot (assign next)', prereq: 'view' },
        ],
      },
      analysis: {
        label: 'Analysis',
        permissions: [
          { id: 'view', label: 'View Analysis', prereq: null },
        ],
      },
      // trace: moved to `production` module — see M-094.
      audit_log: {
        label: 'QC Audit Log',
        permissions: [
          { id: 'view', label: 'View QC Audit Log', prereq: null },
        ],
      },
    },
  },
  packaging: {
    label: 'Packaging',
    resources: {
      outbound: {
        label: 'Outbound Dispatch',
        permissions: [
          { id: 'view',     label: 'View Packaging Queue', prereq: null },
          { id: 'dispatch', label: 'Dispatch Carts',       prereq: 'view' },
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

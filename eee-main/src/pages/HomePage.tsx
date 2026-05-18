import React from 'react';
import {
  BarChart3,
  Package,
  ShoppingCart,
  Factory,
  ShieldCheck,
  GitBranch,
  BookOpen,
  ArrowRight,
  ChevronRight,
} from 'lucide-react';

interface Module {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  status: 'active' | 'coming_soon';
  color: {
    bg: string;
    border: string;
    icon: string;
    iconBg: string;
    badge: string;
    badgeText: string;
    button: string;
    chevron: string;
  };
  features: string[];
}

const MODULES: Module[] = [
  {
    id: 'finance',
    label: 'Financial Management',
    description: 'General ledger, journal entries, AP/AR, trial balance, and multi-level approval workflows.',
    icon: BarChart3,
    status: 'active',
    color: {
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      icon: 'text-blue-600',
      iconBg: 'bg-blue-100',
      badge: 'bg-blue-100 border-blue-200',
      badgeText: 'text-blue-700',
      button: 'bg-blue-600 hover:bg-blue-500 text-white',
      chevron: 'text-blue-500',
    },
    features: ['Chart of Accounts', 'Journal Entries', 'Approval Workflow', 'Trial Balance'],
  },
  {
    id: 'warehouse',
    label: 'Warehouse & Inventory',
    description: 'Lot-tracked inventory, goods receipts, stock transfers, and real-time balance ledger.',
    icon: Package,
    status: 'coming_soon',
    color: {
      bg: 'bg-emerald-50',
      border: 'border-emerald-200',
      icon: 'text-emerald-600',
      iconBg: 'bg-emerald-100',
      badge: 'bg-slate-100 border-slate-200',
      badgeText: 'text-slate-500',
      button: 'bg-emerald-200 cursor-not-allowed text-emerald-700',
      chevron: 'text-emerald-500',
    },
    features: ['Lot Traceability', 'Goods Receipt', 'Stock Transfer', 'Inventory Balance'],
  },
  {
    id: 'sales',
    label: 'Sales & Distribution',
    description: 'Sales orders, shipment planning, customer invoicing, and AR integration.',
    icon: ShoppingCart,
    status: 'coming_soon',
    color: {
      bg: 'bg-purple-50',
      border: 'border-purple-200',
      icon: 'text-purple-600',
      iconBg: 'bg-purple-100',
      badge: 'bg-slate-100 border-slate-200',
      badgeText: 'text-slate-500',
      button: 'bg-purple-200 cursor-not-allowed text-purple-700',
      chevron: 'text-purple-500',
    },
    features: ['Sales Orders', 'Shipment Tracking', 'AR Invoicing', 'Customer Portal'],
  },
  {
    id: 'production',
    label: 'Production & Manufacturing',
    description: 'Formula management, production orders, batch manufacturing, and yield tracking.',
    icon: Factory,
    status: 'coming_soon',
    color: {
      bg: 'bg-orange-50',
      border: 'border-orange-200',
      icon: 'text-orange-600',
      iconBg: 'bg-orange-100',
      badge: 'bg-slate-100 border-slate-200',
      badgeText: 'text-slate-500',
      button: 'bg-orange-200 cursor-not-allowed text-orange-700',
      chevron: 'text-orange-500',
    },
    features: ['Formula / BOM', 'Production Orders', 'Consumption Tracking', 'Yield Analysis'],
  },
  {
    id: 'workflow',
    label: 'Workflow Studio',
    description: 'Build custom automations by dragging nodes — connect data sources, apply logic, and trigger actions across all modules.',
    icon: GitBranch,
    status: 'active',
    color: {
      bg: 'bg-cyan-50',
      border: 'border-cyan-200',
      icon: 'text-cyan-600',
      iconBg: 'bg-cyan-100',
      badge: 'bg-cyan-100 border-cyan-200',
      badgeText: 'text-cyan-700',
      button: 'bg-cyan-600 hover:bg-cyan-500 text-white',
      chevron: 'text-cyan-500',
    },
    features: ['Drag & Drop Canvas', 'Data Source Nodes', 'Logic & Branching', 'Action Automation'],
  },
  {
    id: 'docs',
    label: 'Documentation',
    description: 'Project architecture, module specs, database schema, RPC functions, migrations index, and design tokens.',
    icon: BookOpen,
    status: 'active',
    color: {
      bg: 'bg-stone-50',
      border: 'border-stone-200',
      icon: 'text-stone-600',
      iconBg: 'bg-stone-100',
      badge: 'bg-stone-100 border-stone-200',
      badgeText: 'text-stone-600',
      button: 'bg-stone-700 hover:bg-stone-600 text-white',
      chevron: 'text-stone-400',
    },
    features: ['Routing Structure', 'Module Specs', 'DB Schema & RPC', 'Migrations Index'],
  },
  {
    id: 'auth',
    label: 'Users & Authentication',
    description: 'User accounts, role-based access control, approval tier assignments, and audit logs.',
    icon: ShieldCheck,
    status: 'active',
    color: {
      bg: 'bg-slate-50',
      border: 'border-slate-200',
      icon: 'text-slate-600',
      iconBg: 'bg-slate-200',
      badge: 'bg-slate-100 border-slate-200',
      badgeText: 'text-slate-600',
      button: 'bg-slate-700 hover:bg-slate-600 text-white',
      chevron: 'text-slate-400',
    },
    features: ['User Management', 'Role & Permissions', 'Approval Tiers', 'Audit Trail'],
  },
];

interface HomePageProps {
  onNavigate: (module: string) => void;
  onLogout: () => void;
  userName: string;
  userEmail: string;
}

export default function HomePage({ onNavigate, onLogout, userName, userEmail }: HomePageProps) {
  return (
    <div className="min-h-screen bg-[#faf8f5] flex flex-col">
      {/* Header */}
      <header className="px-12 pt-12 pb-6 flex items-end justify-between">
        <div>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <BarChart3 size={18} className="text-white" />
            </div>
            <span className="text-slate-900 font-bold text-lg tracking-tight">PetFood ERP</span>
          </div>
          <h1 className="text-4xl font-bold text-slate-900 tracking-tight">
            Module Hub
          </h1>
          <p className="text-slate-500 text-sm mt-2">
            Select a module to get started
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-sm font-bold text-slate-900">{userName}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{userEmail}</p>
          </div>
          <button
            onClick={onLogout}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Divider */}
      <div className="mx-12 h-px bg-slate-200 mb-10" />

      {/* Module Grid */}
      <main className="flex-1 px-12 pb-12">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {MODULES.map((mod) => {
            const Icon = mod.icon;
            const isActive = mod.status === 'active';

            return (
              <div
                key={mod.id}
                onClick={() => isActive && onNavigate(mod.id)}
                className={`
                  relative rounded-2xl border p-6 flex flex-col gap-4 transition-all duration-200
                  ${mod.color.bg} ${mod.color.border}
                  ${isActive
                    ? 'cursor-pointer hover:scale-[1.02] hover:shadow-lg hover:shadow-slate-200'
                    : 'opacity-70'}
                `}
              >
                {/* Top row: icon + badge */}
                <div className="flex items-start justify-between">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${mod.color.iconBg} ${mod.color.icon}`}>
                    <Icon size={22} />
                  </div>
                  <span className={`
                    text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full border
                    ${mod.color.badge} ${mod.color.badgeText}
                  `}>
                    {isActive ? 'Active' : 'Coming Soon'}
                  </span>
                </div>

                {/* Title + description */}
                <div>
                  <h2 className="text-slate-900 font-bold text-base mb-1.5">{mod.label}</h2>
                  <p className="text-slate-500 text-xs leading-relaxed">{mod.description}</p>
                </div>

                {/* Feature list */}
                <ul className="space-y-1.5">
                  {mod.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-xs text-slate-500">
                      <ChevronRight size={12} className={mod.color.chevron} />
                      {f}
                    </li>
                  ))}
                </ul>

                {/* CTA button */}
                <button
                  disabled={!isActive}
                  onClick={(e) => { e.stopPropagation(); isActive && onNavigate(mod.id); }}
                  className={`
                    mt-auto flex items-center justify-center gap-2
                    text-xs font-bold uppercase tracking-wider
                    py-2.5 rounded-xl transition-colors
                    ${mod.color.button}
                  `}
                >
                  {isActive ? (
                    <>Open Module <ArrowRight size={13} /></>
                  ) : (
                    'In Development'
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </main>

      {/* Footer */}
      <footer className="px-12 py-4 border-t border-slate-200 flex items-center justify-between">
        <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
          PetFood Manufacturing ERP
        </p>
        <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
          Powered by Supabase + Tauri
        </p>
      </footer>
    </div>
  );
}

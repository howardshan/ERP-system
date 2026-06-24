import React, { useState } from 'react';
import {
  BarChart3,
  Package,
  ShoppingCart,
  Factory,
  ShieldCheck,
  GitBranch,
  BookOpen,
  Users,
  ClipboardCheck,
  ArrowRight,
  ChevronRight,
  RefreshCw,
  Settings,
  HelpCircle,
  ScrollText,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePermissions } from '../contexts/PermissionContext';
import { useModuleVisibility } from '../contexts/ModuleVisibilityContext';
import { PrinterSettingsPopover } from '../components/PrinterSettingsPopover';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

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
    status: 'active',
    color: {
      bg: 'bg-emerald-50',
      border: 'border-emerald-200',
      icon: 'text-emerald-600',
      iconBg: 'bg-emerald-100',
      badge: 'bg-emerald-100 border-emerald-200',
      badgeText: 'text-emerald-700',
      button: 'bg-emerald-600 hover:bg-emerald-500 text-white',
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
    description: 'Per-SKU pipeline dashboard, work-order creation with cart stickers, batch trace, and product/template master data.',
    icon: Factory,
    status: 'active',
    color: {
      bg: 'bg-indigo-50',
      border: 'border-indigo-200',
      icon: 'text-indigo-700',
      iconBg: 'bg-indigo-100',
      badge: 'bg-indigo-100 border-indigo-200',
      badgeText: 'text-indigo-700',
      button: 'bg-indigo-600 hover:bg-indigo-500 text-white',
      chevron: 'text-indigo-500',
    },
    features: ['Pipeline Dashboard', 'Work Orders + Stickers', 'Batch Trace', 'Products & Test Types'],
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
    id: 'qc',
    label: 'Quality Control',
    description: 'Post-dry inspection workflow: production lots, drying sub-lots, pending queue, hold disposition, and batch trace.',
    icon: ClipboardCheck,
    status: 'active',
    color: {
      bg: 'bg-rose-50',
      border: 'border-rose-200',
      icon: 'text-rose-700',
      iconBg: 'bg-rose-100',
      badge: 'bg-rose-100 border-rose-200',
      badgeText: 'text-rose-700',
      button: 'bg-rose-600 hover:bg-rose-500 text-white',
      chevron: 'text-rose-500',
    },
    features: ['Sub-lot Check-in/out', 'Pending Queue', 'Hold Disposition', 'Batch Trace'],
  },
  {
    id: 'packaging',
    label: 'Packaging',
    description: 'Dispatch released QC carts to packaging. FIFO-ordered cart selection, scan support, and days-in-stock tracking.',
    icon: Package,
    status: 'active',
    color: {
      bg: 'bg-orange-50',
      border: 'border-orange-200',
      icon: 'text-orange-700',
      iconBg: 'bg-orange-100',
      badge: 'bg-orange-100 border-orange-200',
      badgeText: 'text-orange-700',
      button: 'bg-orange-600 hover:bg-orange-500 text-white',
      chevron: 'text-orange-500',
    },
    features: ['FIFO Dispatch', 'Scan QR Code', 'Days-in-Stock Alert', 'Outbound Record'],
  },
  {
    id: 'hr',
    label: 'Human Resources',
    description: 'Employee directory, job titles, departments, reporting lines, and profile management.',
    icon: Users,
    status: 'active',
    color: {
      bg: 'bg-teal-50',
      border: 'border-teal-200',
      icon: 'text-teal-600',
      iconBg: 'bg-teal-100',
      badge: 'bg-teal-100 border-teal-200',
      badgeText: 'text-teal-700',
      button: 'bg-teal-600 hover:bg-teal-500 text-white',
      chevron: 'text-teal-500',
    },
    features: ['Employee Directory', 'Job Titles & Roles', 'Department & Manager', 'Profile Editing'],
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
  {
    id: 'logs',
    label: 'Logs & Audit',
    description: 'System-wide operation log across all modules, filterable by person, module and time.',
    icon: ScrollText,
    status: 'active',
    color: {
      bg: 'bg-zinc-50',
      border: 'border-zinc-200',
      icon: 'text-zinc-700',
      iconBg: 'bg-zinc-200',
      badge: 'bg-zinc-100 border-zinc-200',
      badgeText: 'text-zinc-600',
      button: 'bg-zinc-700 hover:bg-zinc-600 text-white',
      chevron: 'text-zinc-400',
    },
    features: ['Cross-module log', 'Filter by person', 'Filter by module', 'Time-range search'],
  },
  {
    id: 'faq',
    label: 'FAQ & Help',
    description: 'How-to answers for every module of the QC & production system, with search.',
    icon: HelpCircle,
    status: 'active',
    color: {
      bg: 'bg-violet-50',
      border: 'border-violet-200',
      icon: 'text-violet-700',
      iconBg: 'bg-violet-100',
      badge: 'bg-violet-100 border-violet-200',
      badgeText: 'text-violet-700',
      button: 'bg-violet-600 hover:bg-violet-500 text-white',
      chevron: 'text-violet-500',
    },
    features: ['Searchable Q&A', 'All 8 modules', 'Trilingual', 'Operator guides'],
  },
];

interface HomePageProps {
  onNavigate: (module: string) => void;
  onLogout: () => void;
  userName: string;
  userEmail: string;
}

export default function HomePage({ onNavigate, onLogout, userName, userEmail }: HomePageProps) {
  const { t } = useTranslation('app');
  const { reload, canAccessModule } = usePermissions();
  const { isVisible } = useModuleVisibility();
  const [reloading, setReloading] = useState(false);

  async function handleReload() {
    setReloading(true);
    await reload();
    setReloading(false);
  }

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
            {t('homePage.moduleHub')}
          </h1>
          <p className="text-slate-500 text-sm mt-2">
            {t('homePage.selectModule')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <PrinterSettingsPopover />
          <div className="w-px h-5 bg-slate-200" />
          <button
            onClick={() => onNavigate('account-settings')}
            className="text-right group"
            title={t('homePage.accountSettings')}
          >
            <p className="text-sm font-bold text-slate-900 group-hover:text-blue-700 transition-colors">{userName}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{userEmail}</p>
          </button>
          <button
            onClick={() => onNavigate('account-settings')}
            title={t('homePage.accountSettings')}
            className="p-2 text-slate-400 hover:text-slate-700 transition-colors"
          >
            <Settings size={15} />
          </button>
          <button
            onClick={handleReload}
            disabled={reloading}
            title={t('homePage.reloadPermissions')}
            className="p-2 text-slate-400 hover:text-slate-700 disabled:opacity-40 transition-colors"
          >
            <RefreshCw size={15} className={reloading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={onLogout}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors"
          >
            {t('homePage.signOut')}
          </button>
        </div>
      </header>

      {/* Divider */}
      <div className="mx-12 h-px bg-slate-200 mb-10" />

      {/* Module Grid */}
      <main className="flex-1 px-12 pb-12">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {MODULES.filter((mod) => isVisible(mod.id) && (mod.id === 'faq' || canAccessModule(mod.id))).map((mod) => {
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
                    {isActive ? t('homePage.active') : t('homePage.comingSoon')}
                  </span>
                </div>

                {/* Title + description */}
                <div>
                  <h2 className="text-slate-900 font-bold text-base mb-1.5">{t(`homePage.modules.${mod.id}.label`)}</h2>
                  <p className="text-slate-500 text-xs leading-relaxed">{t(`homePage.modules.${mod.id}.description`)}</p>
                </div>

                {/* Feature list */}
                <ul className="space-y-1.5">
                  {mod.features.map((f, i) => (
                    <li key={f} className="flex items-center gap-2 text-xs text-slate-500">
                      <ChevronRight size={12} className={mod.color.chevron} />
                      {t(`homePage.modules.${mod.id}.features.${i}`)}
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
                    <>{t('homePage.openModule')} <ArrowRight size={13} /></>
                  ) : (
                    t('homePage.inDevelopment')
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

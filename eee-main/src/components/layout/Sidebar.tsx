import React from 'react';
import {
  LayoutDashboard,
  Network,
  PlusSquare,
  ListFilter,
  Wallet,
  Receipt,
  Scale,
  TrendingUp,
  CalendarDays,
  ShieldCheck,
  HelpCircle,
  LayoutGrid,
  ScrollText,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { usePermissions } from '../../contexts/PermissionContext';

interface NavItemProps {
  icon: React.ElementType;
  label: string;
  isActive?: boolean;
  onClick: () => void;
  badge?: number;
}

function NavItem({ icon: Icon, label, isActive, onClick, badge }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors relative',
        isActive
          ? 'text-white bg-white/10 font-semibold'
          : 'text-slate-400 hover:text-white hover:bg-white/5',
      )}
    >
      {isActive && <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-400" />}
      <Icon size={18} />
      <span className="flex-1 text-left">{label}</span>
      {badge != null && badge > 0 && (
        <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
          {badge}
        </span>
      )}
    </button>
  );
}

function NavSection({ title }: { title: string }) {
  return (
    <div className="px-4 pt-5 pb-1">
      <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">{title}</span>
    </div>
  );
}

interface SidebarProps {
  activeScreen: string;
  setActiveScreen: (screen: string) => void;
  pendingApprovalCount?: number;
  onHome: () => void;
}

export function Sidebar({ activeScreen, setActiveScreen, pendingApprovalCount = 0, onHome }: SidebarProps) {
  const isActive = (id: string) =>
    activeScreen === id || activeScreen.startsWith(id + ':');
  const { can } = usePermissions();
  const { t } = useTranslation('nav');

  const canViewJE       = can('finance', 'journal_entry', 'view');
  const canCreateJE     = can('finance', 'journal_entry', 'create');
  const canViewCoA      = can('finance', 'chart_of_accounts', 'view');
  const canViewPeriods  = can('finance', 'accounting_periods', 'view');
  const canViewAuditLog = can('finance', 'audit_log', 'view');

  return (
    <aside className="w-64 bg-[#0a0f1d] border-r border-white/10 flex flex-col h-screen fixed left-0 top-0">
      {/* Logo / back to home */}
      <div className="p-5 mb-1">
        <button
          onClick={onHome}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors group text-left"
        >
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
            <LayoutGrid size={14} className="text-white" />
          </div>
          <div>
            <p className="text-white font-bold text-sm leading-none">{t('financials')}</p>
            <p className="text-[9px] text-slate-500 uppercase tracking-widest font-bold mt-0.5 group-hover:text-slate-400 transition-colors">
              ← {t('allModules')}
            </p>
          </div>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto space-y-0.5">
        <NavSection title={t('section.overview')} />
        <NavItem icon={LayoutDashboard} label={t('item.dashboard')} isActive={isActive('dashboard')} onClick={() => setActiveScreen('dashboard')} />

        <NavSection title={t('section.generalLedger')} />
        {canViewCoA && (
          <NavItem icon={Network} label={t('item.chartOfAccounts')} isActive={isActive('coa')} onClick={() => setActiveScreen('coa')} />
        )}
        {canCreateJE && (
          <NavItem icon={PlusSquare} label={t('item.newJournalEntry')} isActive={isActive('je-create')} onClick={() => setActiveScreen('je-create')} />
        )}
        {canViewJE && (
          <NavItem icon={ListFilter} label={t('item.journalEntries')} isActive={isActive('je-list') || isActive('je-edit')} onClick={() => setActiveScreen('je-list')} />
        )}
        {canViewJE && (
          <NavItem icon={ShieldCheck} label={t('item.approvals')} isActive={isActive('approvals')} onClick={() => setActiveScreen('approvals')} badge={pendingApprovalCount} />
        )}

        <NavSection title={t('section.payablesReceivables')} />
        <NavItem icon={Wallet}  label={t('item.accountsPayable')}    isActive={isActive('ap')} onClick={() => setActiveScreen('ap')} />
        <NavItem icon={Receipt} label={t('item.accountsReceivable')} isActive={isActive('ar')} onClick={() => setActiveScreen('ar')} />

        {(canViewJE || canViewPeriods) && <NavSection title={t('section.reports')} />}
        {canViewJE && (
          <NavItem icon={Scale} label={t('item.trialBalance')} isActive={isActive('trial-balance')} onClick={() => setActiveScreen('trial-balance')} />
        )}
        {canViewJE && (
          <NavItem icon={TrendingUp} label={t('item.profitLoss')} isActive={isActive('pnl')} onClick={() => setActiveScreen('pnl')} />
        )}
        {canViewJE && (
          <NavItem icon={Scale} label={t('item.balanceSheet')} isActive={isActive('bs')} onClick={() => setActiveScreen('bs')} />
        )}
        {canViewPeriods && (
          <NavItem icon={CalendarDays} label={t('item.accountingPeriods')} isActive={isActive('periods')} onClick={() => setActiveScreen('periods')} />
        )}

        {canViewAuditLog && <NavSection title={t('section.administration')} />}
        {canViewAuditLog && (
          <NavItem icon={ScrollText} label={t('item.auditLog')} isActive={isActive('audit-log')} onClick={() => setActiveScreen('audit-log')} />
        )}
      </nav>

      <div className="p-4 border-t border-white/5 space-y-0.5">
        <button className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">
          <HelpCircle size={18} />
          <span>{t('common:support')}</span>
        </button>
      </div>
    </aside>
  );
}

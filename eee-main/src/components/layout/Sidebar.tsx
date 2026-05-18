import React from 'react';
import {
  LayoutDashboard,
  Network,
  PlusSquare,
  ListFilter,
  Wallet,
  Receipt,
  Scale,
  CalendarDays,
  ShieldCheck,
  SlidersHorizontal,
  HelpCircle,
} from 'lucide-react';
import { cn } from '../../lib/utils';

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
}

export function Sidebar({ activeScreen, setActiveScreen, pendingApprovalCount = 0 }: SidebarProps) {
  const isActive = (id: string) =>
    activeScreen === id || activeScreen.startsWith(id + ':');

  return (
    <aside className="w-64 bg-[#0a0f1d] border-r border-white/10 flex flex-col h-screen fixed left-0 top-0">
      <div className="p-6 mb-2">
        <h1 className="text-xl font-bold text-white tracking-tight">Financials</h1>
        <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mt-1">
          PetFood Manufacturing ERP
        </p>
      </div>

      <nav className="flex-1 overflow-y-auto space-y-0.5">
        <NavSection title="Overview" />
        <NavItem icon={LayoutDashboard} label="Dashboard"        isActive={isActive('dashboard')}     onClick={() => setActiveScreen('dashboard')} />

        <NavSection title="General Ledger" />
        <NavItem icon={Network}         label="Chart of Accounts"      isActive={isActive('coa')}           onClick={() => setActiveScreen('coa')} />
        <NavItem icon={PlusSquare}      label="New Journal Entry"       isActive={isActive('je-create')}     onClick={() => setActiveScreen('je-create')} />
        <NavItem icon={ListFilter}      label="Journal Entries"         isActive={isActive('je-list') || isActive('je-edit')} onClick={() => setActiveScreen('je-list')} />
        <NavItem icon={ShieldCheck}     label="Approvals"               isActive={isActive('approvals')}     onClick={() => setActiveScreen('approvals')} badge={pendingApprovalCount} />

        <NavSection title="Payables & Receivables" />
        <NavItem icon={Wallet}          label="Accounts Payable"        isActive={isActive('ap')}            onClick={() => setActiveScreen('ap')} />
        <NavItem icon={Receipt}         label="Accounts Receivable"     isActive={isActive('ar')}            onClick={() => setActiveScreen('ar')} />

        <NavSection title="Reports" />
        <NavItem icon={Scale}           label="Trial Balance"           isActive={isActive('trial-balance')} onClick={() => setActiveScreen('trial-balance')} />
        <NavItem icon={CalendarDays}    label="Accounting Periods"      isActive={isActive('periods')}       onClick={() => setActiveScreen('periods')} />
      </nav>

      <div className="p-4 border-t border-white/5 space-y-0.5">
        <NavItem icon={SlidersHorizontal} label="Approval Settings" isActive={isActive('approval-settings')} onClick={() => setActiveScreen('approval-settings')} />
        <button className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">
          <HelpCircle size={18} />
          <span>Support</span>
        </button>
      </div>
    </aside>
  );
}

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
  Settings,
  HelpCircle,
} from 'lucide-react';
import { cn } from '../../lib/utils';

interface NavItemProps {
  icon: React.ElementType;
  label: string;
  isActive?: boolean;
  onClick: () => void;
  key?: string | number;
}

function NavItem({ icon: Icon, label, isActive, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors relative",
        isActive 
          ? "text-white bg-white/10 font-semibold" 
          : "text-slate-400 hover:text-white hover:bg-white/5"
      )}
    >
      {isActive && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-400" />
      )}
      <Icon size={18} />
      <span>{label}</span>
    </button>
  );
}

interface SidebarProps {
  activeScreen: string;
  setActiveScreen: (screen: string) => void;
}

export function Sidebar({ activeScreen, setActiveScreen }: SidebarProps) {
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'coa', label: 'Chart of Accounts', icon: Network },
    { id: 'je-create', label: 'Journal Entry (Create)', icon: PlusSquare },
    { id: 'je-list', label: 'Journal Entries (List)', icon: ListFilter },
    { id: 'ap', label: 'Accounts Payable', icon: Wallet },
    { id: 'ar', label: 'Accounts Receivable', icon: Receipt },
    { id: 'trial-balance', label: 'Trial Balance', icon: Scale },
    { id: 'periods', label: 'Accounting Periods', icon: CalendarDays },
  ];

  return (
    <aside className="w-64 bg-[#0a0f1d] border-r border-white/10 flex flex-col h-screen fixed left-0 top-0">
      <div className="p-6 mb-4">
        <h1 className="text-xl font-bold text-white tracking-tight">Financials</h1>
        <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mt-1">
          PetFood Manufacturing ERP
        </p>
      </div>

      <nav className="flex-1 space-y-1">
        {menuItems.map((item) => (
          <NavItem
            key={item.id}
            icon={item.icon}
            label={item.label}
            isActive={activeScreen === item.id}
            onClick={() => setActiveScreen(item.id)}
          />
        ))}
      </nav>

      <div className="p-4 border-t border-white/5 space-y-1">
        <button className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">
          <Settings size={18} />
          <span>Settings</span>
        </button>
        <button className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">
          <HelpCircle size={18} />
          <span>Support</span>
        </button>
      </div>
    </aside>
  );
}

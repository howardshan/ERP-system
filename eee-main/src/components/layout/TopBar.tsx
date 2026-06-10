import React, { useState } from 'react';
import { Bell, Search, LogOut, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { usePermissions } from '../../contexts/PermissionContext';
import { LanguageSwitcher } from '../LanguageSwitcher';

interface TopBarProps {
  userName: string;
  userEmail: string;
  onLogout: () => void;
}

export function TopBar({ userName, userEmail, onLogout }: TopBarProps) {
  const { reload } = usePermissions();
  const { t } = useTranslation();
  const [reloading, setReloading] = useState(false);

  async function handleReload() {
    setReloading(true);
    await reload();
    setReloading(false);
  }

  const initials = userName
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 sticky top-0 z-30">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-100 rounded text-blue-700 font-bold text-[11px] uppercase tracking-wider">
          {t('period')}
        </div>
        <div className="h-6 w-px bg-slate-200" />
        <p className="text-xs text-slate-500 font-medium tracking-wide">
          {format(new Date(), 'EEEE, MMMM do, yyyy')}
        </p>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder={t('search')}
            className="pl-9 pr-4 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 w-64"
          />
        </div>
        <LanguageSwitcher />
        <button className="p-2 text-slate-400 hover:text-slate-600 transition-colors relative">
          <Bell size={18} />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border-2 border-white" />
        </button>
        <div className="flex items-center gap-3 pl-3 border-l border-slate-200">
          <div className="text-right">
            <p className="text-xs font-bold text-slate-900">{userName}</p>
            <p className="text-[10px] text-slate-400 tracking-tight">{userEmail}</p>
          </div>
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
            {initials}
          </div>
          <button
            onClick={handleReload}
            disabled={reloading}
            title={t('reloadPermissions')}
            className="p-1.5 text-slate-400 hover:text-slate-700 transition-colors disabled:opacity-40"
          >
            <RefreshCw size={15} className={reloading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={onLogout}
            title={t('signOut')}
            className="p-1.5 text-slate-400 hover:text-slate-700 transition-colors"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </header>
  );
}

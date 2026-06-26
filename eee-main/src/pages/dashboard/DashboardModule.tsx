import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LayoutGrid, LayoutDashboard, GitBranch, CalendarClock, HelpCircle, ArrowLeft,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { usePermissions } from '../../contexts/PermissionContext';
import WorkOrderPipelinePage from './WorkOrderPipelinePage';
import DryingExitForecastPage from './DryingExitForecastPage';

interface Props {
  onHome: () => void;
}

function NavItem({ icon: Icon, label, isActive, onClick }: {
  icon: React.ElementType; label: string; isActive: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors relative',
        isActive ? 'text-white bg-white/10 font-semibold' : 'text-slate-400 hover:text-white hover:bg-white/5',
      )}
    >
      {isActive && <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-400" />}
      <Icon size={18} />
      <span className="flex-1 text-left">{label}</span>
    </button>
  );
}

export default function DashboardModule({ onHome }: Props) {
  const { t } = useTranslation('dashboard');
  const { can } = usePermissions();
  const [screen, setScreen] = useState<'pipeline' | 'forecast'>('pipeline');

  const canView = can('dashboard', 'pipeline', 'view');

  function renderContent() {
    if (!canView) {
      return <div className="p-10 text-center text-sm text-slate-400">{t('module.noAccess')}</div>;
    }
    if (screen === 'forecast') return <DryingExitForecastPage />;
    return <WorkOrderPipelinePage />;
  }

  return (
    <div className="min-h-screen bg-[#faf8f5] flex">
      {/* Sidebar */}
      <aside className="w-64 bg-[#0a0f1d] border-r border-white/10 flex flex-col h-screen fixed left-0 top-0">
        <div className="p-5 mb-1">
          <button
            onClick={onHome}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors group text-left"
          >
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0">
              <LayoutGrid size={14} className="text-white" />
            </div>
            <div>
              <p className="text-white font-bold text-sm leading-none">{t('module.title')}</p>
              <p className="text-[9px] text-slate-500 uppercase tracking-widest font-bold mt-0.5 group-hover:text-slate-400 transition-colors">
                {t('module.allModules')}
              </p>
            </div>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto space-y-0.5 pb-4">
          <NavItem icon={GitBranch} label={t('module.navPipeline')}
                   isActive={screen === 'pipeline'} onClick={() => setScreen('pipeline')} />
          <NavItem icon={CalendarClock} label={t('module.navForecast')}
                   isActive={screen === 'forecast'} onClick={() => setScreen('forecast')} />
        </nav>

        <div className="p-4 border-t border-white/5">
          <button className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">
            <HelpCircle size={18} />
            <span>{t('module.support')}</span>
          </button>
        </div>
      </aside>

      <div className="ml-64 flex-1 min-h-screen flex flex-col">
        <header className="sticky top-0 z-30 bg-white/85 backdrop-blur border-b border-slate-200 px-6 py-2 flex items-center justify-between shrink-0">
          <button
            onClick={onHome}
            className="flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-100 transition-colors"
          >
            <ArrowLeft size={14} /> {t('module.moduleHub')}
          </button>
          <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold text-slate-400">
            <LayoutDashboard size={12} /> {t('module.title')}
          </span>
        </header>
        <div className="flex-1">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}

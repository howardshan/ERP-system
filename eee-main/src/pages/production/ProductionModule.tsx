import React, { useState } from 'react';
import {
  BarChart3,
  Factory,
  GitBranch,
  Package,
  FlaskConical,
  HelpCircle,
  ArrowLeft,
  LayoutGrid,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { usePermissions } from '../../contexts/PermissionContext';

// Re-use the existing QC screens — the components themselves stay in
// src/pages/qc/ so QC's own routes (if any are added back) still work, but
// the canonical entry point for these features is now this Production
// module.  Permission keys remain `qc.production.*`, `qc.trace.*`,
// `qc.products.*` (see BR-Q51) to avoid breaking existing grants.
import Production from '../qc/Production';
import TraceListPage from '../qc/TraceListPage';
import TracePage from '../qc/TracePage';
import ProductManagement from '../qc/ProductManagement';
import TestTypesPage from '../qc/TestTypesPage';
import SubLotHistoryDrawer from '../qc/SubLotHistoryDrawer';
import ProductionDashboard from './ProductionDashboard';

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
        'w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors text-left',
        isActive
          ? 'bg-white/10 text-white font-bold'
          : 'text-slate-400 hover:bg-white/5 hover:text-white',
      )}
    >
      <Icon size={16} className="shrink-0" />
      <span>{label}</span>
    </button>
  );
}

function NavSection({ title }: { title: string }) {
  return (
    <div className="px-5 pt-4 pb-1">
      <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">{title}</span>
    </div>
  );
}

export default function ProductionModule({ onHome }: Props) {
  const { can } = usePermissions();
  const [screen, setScreen] = useState<string>('dashboard');
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);
  const [historySubLotId, setHistorySubLotId] = useState<string | null>(null);

  // Permission gates — keys still live under the qc.* namespace because
  // permissionStructure.ts and existing grants weren't renamed when these
  // features moved to this module.
  const canViewDashboard  = can('qc', 'dashboard', 'view');
  const canCreateBatch    = can('production', 'work_orders', 'create');
  const canViewTrace      = can('production', 'trace', 'view');
  const canManageProducts = can('production', 'products', 'view');

  const isActive = (id: string) => screen === id || screen.startsWith(id + ':');
  const navigate = (s: string) => setScreen(s);

  function renderContent() {
    if (screen === 'dashboard') {
      return <ProductionDashboard />;
    }
    if (screen === 'production') {
      // No onCreated callback: post-create navigation (Continue to Dry Rooms)
      // would jump across modules, which we don't support yet.  The success
      // banner keeps the Print stickers button on its own.
      return <Production />;
    }
    if (screen === 'trace') {
      return (
        <TraceListPage
          onSelectLot={(id) => { setSelectedLotId(id); setScreen('trace-detail'); }}
        />
      );
    }
    if (screen === 'trace-detail' && selectedLotId) {
      return (
        <TracePage
          lotId={selectedLotId}
          onBack={() => setScreen('trace')}
          onOpenHistory={(id) => setHistorySubLotId(id)}
        />
      );
    }
    if (screen === 'products') {
      return <ProductManagement />;
    }
    if (screen === 'test-types') {
      return <TestTypesPage />;
    }
    return <ProductionDashboard />;
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
              <p className="text-white font-bold text-sm leading-none">Production &amp; Mfg</p>
              <p className="text-[9px] text-slate-500 uppercase tracking-widest font-bold mt-0.5 group-hover:text-slate-400 transition-colors">
                ← All Modules
              </p>
            </div>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto space-y-0.5 pb-4">
          {canViewDashboard && (
            <NavItem icon={BarChart3} label="Dashboard" isActive={isActive('dashboard')} onClick={() => navigate('dashboard')} />
          )}

          {canCreateBatch && (
            <>
              <NavSection title="Floor" />
              <NavItem icon={Factory} label="Production" isActive={isActive('production')} onClick={() => navigate('production')} />
            </>
          )}

          {canViewTrace && (
            <>
              <NavSection title="Traceability" />
              <NavItem icon={GitBranch} label="Batch Trace"
                       isActive={isActive('trace') || isActive('trace-detail')}
                       onClick={() => navigate('trace')} />
            </>
          )}

          {canManageProducts && (
            <>
              <NavSection title="Master Data" />
              <NavItem icon={Package}      label="Products"   isActive={isActive('products')}   onClick={() => navigate('products')} />
              <NavItem icon={FlaskConical} label="Test Types" isActive={isActive('test-types')} onClick={() => navigate('test-types')} />
            </>
          )}
        </nav>

        <div className="p-4 border-t border-white/5">
          <button className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">
            <HelpCircle size={18} />
            <span>Support</span>
          </button>
        </div>
      </aside>

      <div className="ml-64 flex-1 min-h-screen flex flex-col">
        <header className="sticky top-0 z-30 bg-white/85 backdrop-blur border-b border-slate-200 px-6 py-2 flex items-center justify-between shrink-0">
          <button
            onClick={onHome}
            className="flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-100 transition-colors"
          >
            <ArrowLeft size={14} /> Module Hub
          </button>
          <span className="text-[10px] uppercase tracking-widest font-bold text-slate-400">
            Production &amp; Manufacturing
          </span>
        </header>
        <div className="flex-1">
          {renderContent()}
        </div>
      </div>

      {historySubLotId && (
        <SubLotHistoryDrawer
          subLotId={historySubLotId}
          onClose={() => setHistorySubLotId(null)}
        />
      )}
    </div>
  );
}

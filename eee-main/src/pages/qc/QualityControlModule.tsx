import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ClipboardCheck,
  ListChecks,
  Grid3X3,
  LayoutGrid,
  HelpCircle,
  ArrowLeft,
  BarChart3,
  MapPin,
  Package,
  FlaskConical,
  History,
  FileSignature,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { usePermissions } from '../../contexts/PermissionContext';
import { useSidebar, sidebarOffCanvas, SidebarScrim, SidebarToggle } from '../../components/layout/mobileNav';
import QcHome from './QcHome';
import LotsList from './LotsList';
import LotDetail from './LotDetail';
import PendingQueue from './PendingQueue';
import InspectPage from './InspectPage';
import AdminDashboard from './AdminDashboard';
import LocationManagement from './LocationManagement';
import AnalysisPage from './AnalysisPage';
import DryRoomsList from './DryRoomsList';
import DryRoomDetail from './DryRoomDetail';
import TestingPage from './TestingPage';
import RoomTempDryPage from './RoomTempDryPage';
import SubLotHistoryDrawer from './SubLotHistoryDrawer';
import ProductManagement from './ProductManagement';
import TestTypesPage from './TestTypesPage';
import ProductAuditLog from './ProductAuditLog';
import DailyTestReport from './DailyTestReport';

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
      {isActive && <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-400" />}
      <Icon size={18} />
      <span className="flex-1 text-left">{label}</span>
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

export default function QualityControlModule({ onHome }: Props) {
  const { t } = useTranslation('qc');
  const { can } = usePermissions();
  const [screen, setScreen] = useState('home');
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);
  const [selectedSubLotId, setSelectedSubLotId] = useState<string | null>(null);
  const [selectedDryerNumber, setSelectedDryerNumber] = useState<number | null>(null);
  const [historySubLotId, setHistorySubLotId] = useState<string | null>(null);

  // Production / Batch Trace / Products & Templates / Test Types moved to
  // the Production module — their `can()` checks live in ProductionModule.tsx.
  const canViewDryRooms   = can('qc', 'dry_rooms', 'view_status');
  const canViewTesting    = can('qc', 'testing', 'view_status');
  const canViewDailyReport = can('qc', 'daily_report', 'view');
  const canViewLocations  = can('qc', 'locations', 'view');
  // Analysis is a read-only reporting page — visible to anyone who can access
  // the QC dashboard (dashboard.view) or has the explicit analysis.view grant.
  const canViewDashboard  = can('qc', 'dashboard', 'view');
  const canViewAnalysis   = can('qc', 'analysis', 'view') || canViewDashboard;
  // Products & Test Types master data — edit rights returned to QC (M-147).
  const canManageProducts = can('qc', 'products', 'view');
  const canViewProductLog = can('qc', 'products', 'view_log');

  const isActive = (id: string) => screen === id || screen.startsWith(id + ':');
  const { open, openSidebar, closeSidebar } = useSidebar();

  function navigate(s: string) {
    setScreen(s);
    closeSidebar();
  }

  function renderContent() {
    if (screen === 'home') {
      return (
        <QcHome
          onNavigate={navigate}
          onOpenHistory={(id) => setHistorySubLotId(id)}
          onOpenSubLot={(_id) => navigate('testing')}
        />
      );
    }
    if (screen === 'dry-rooms') {
      return (
        <DryRoomsList
          onSelectDryer={(n) => { setSelectedDryerNumber(n); setScreen('dry-room-detail'); }}
          onSelectRoomTempDry={() => setScreen('room-temp')}
        />
      );
    }
    if (screen === 'dry-room-detail' && selectedDryerNumber != null) {
      return (
        <DryRoomDetail
          dryerNumber={selectedDryerNumber}
          onBack={() => setScreen('dry-rooms')}
          onCheckedOut={() => { /* Sub-lot is now in pending; user can navigate to Testing manually */ }}
          onOpenHistory={(id) => setHistorySubLotId(id)}
        />
      );
    }
    if (screen === 'batches') {
      return (
        <LotsList
          onSelectLot={(id) => { setSelectedLotId(id); setScreen('lot-detail'); }}
        />
      );
    }
    if (screen === 'lot-detail' && selectedLotId) {
      return (
        <LotDetail
          lotId={selectedLotId}
          onBack={() => setScreen('batches')}
          onInspectSubLot={(id) => { setSelectedSubLotId(id); setScreen('inspect'); }}
        />
      );
    }
    if (screen === 'testing') {
      return <TestingPage onOpenHistory={(id) => setHistorySubLotId(id)} />;
    }
    if (screen === 'daily-report') {
      return <DailyTestReport />;
    }
    if (screen === 'room-temp') {
      return (
        <RoomTempDryPage
          onOpenHistory={(id) => setHistorySubLotId(id)}
          onBack={() => setScreen('dry-rooms')}
        />
      );
    }
    // Legacy: keep old PendingQueue/InspectPage accessible during transition
    if (screen === 'pending') {
      return (
        <PendingQueue
          onInspectSubLot={(id) => { setSelectedSubLotId(id); setScreen('inspect'); }}
        />
      );
    }
    if (screen === 'inspect' && selectedSubLotId) {
      return (
        <InspectPage
          subLotId={selectedSubLotId}
          onBack={() => setScreen('pending')}
        />
      );
    }
    if (screen === 'dashboard') {
      return <AdminDashboard />;
    }
    // Production / Batch Trace / Products & Templates / Test Types moved to
    // the Production module (BR-Q51).  Their old screen keys are no longer
    // routed here; navigating to them from inside QC falls through to QcHome.
    if (screen === 'locations') {
      return <LocationManagement />;
    }
    if (screen === 'analysis') {
      return <AnalysisPage />;
    }
    if (screen === 'products') {
      return <ProductManagement module="qc" />;
    }
    if (screen === 'test-types') {
      return <TestTypesPage module="qc" />;
    }
    if (screen === 'product-log') {
      return <ProductAuditLog />;
    }
    return <QcHome onNavigate={navigate} />;
  }

  return (
    <div className="min-h-screen bg-[#faf8f5] flex">
      {/* Sidebar */}
      <SidebarScrim open={open} onClose={closeSidebar} />
      <aside className={cn('w-64 bg-[#0a0f1d] border-r border-white/10 flex flex-col h-screen fixed left-0 top-0', sidebarOffCanvas(open))}>
        <div className="p-5 mb-1">
          <button
            onClick={onHome}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors group text-left"
          >
            <div className="w-7 h-7 rounded-lg bg-emerald-600 flex items-center justify-center shrink-0">
              <LayoutGrid size={14} className="text-white" />
            </div>
            <div>
              <p className="text-white font-bold text-sm leading-none">{t('qualityControlModule.title')}</p>
              <p className="text-[9px] text-slate-500 uppercase tracking-widest font-bold mt-0.5 group-hover:text-slate-400 transition-colors">
                {t('qualityControlModule.allModules')}
              </p>
            </div>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto space-y-0.5 pb-4">
          <NavItem icon={ClipboardCheck} label={t('qualityControlModule.qcHome')} isActive={isActive('home')} onClick={() => navigate('home')} />
          {canViewAnalysis && (
            <NavItem icon={BarChart3} label={t('qualityControlModule.analysis')}
                     isActive={isActive('analysis')}
                     onClick={() => navigate('analysis')} />
          )}

          {(canViewDryRooms || canViewTesting || canViewDailyReport) && <NavSection title={t('qualityControlModule.floor')} />}
          {canViewDryRooms && (
            <NavItem icon={Grid3X3} label={t('qualityControlModule.dryRooms')}
                     isActive={isActive('dry-rooms') || isActive('dry-room-detail')}
                     onClick={() => navigate('dry-rooms')} />
          )}
          {canViewTesting && (
            <NavItem icon={ListChecks} label={t('qualityControlModule.testing')}
                     isActive={isActive('testing') || isActive('pending') || isActive('inspect')}
                     onClick={() => navigate('testing')} />
          )}
          {canViewDailyReport && (
            <NavItem icon={FileSignature} label={t('qualityControlModule.dailyReport')}
                     isActive={isActive('daily-report')}
                     onClick={() => navigate('daily-report')} />
          )}
          {/* Room Temp Dry is now managed inside Dry Rooms (card on DryRoomsList) — no separate sidebar entry */}
          {/* Production / Batch Trace / Products & Templates moved to the Production module (BR-Q51) */}

          {(canViewLocations || canManageProducts || canViewProductLog) && <NavSection title={t('qualityControlModule.masterData')} />}
          {canManageProducts && (
            <>
              <NavItem icon={Package} label={t('qualityControlModule.products')}
                       isActive={isActive('products')} onClick={() => navigate('products')} />
              <NavItem icon={FlaskConical} label={t('qualityControlModule.testTypes')}
                       isActive={isActive('test-types')} onClick={() => navigate('test-types')} />
            </>
          )}
          {canViewProductLog && (
            <NavItem icon={History} label={t('qualityControlModule.productLog')}
                     isActive={isActive('product-log')} onClick={() => navigate('product-log')} />
          )}
          {canViewLocations && (
            <NavItem icon={MapPin} label={t('qualityControlModule.dryerLocations')} isActive={isActive('locations')} onClick={() => navigate('locations')} />
          )}
        </nav>

        <div className="p-4 border-t border-white/5">
          <button className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">
            <HelpCircle size={18} />
            <span>{t('qualityControlModule.support')}</span>
          </button>
        </div>
      </aside>

      <div className="lg:ml-64 flex-1 min-w-0 min-h-screen flex flex-col">
        {/* Top action bar — visible on every QC page so the user always has a clear way home */}
        <header className="sticky top-0 z-20 bg-white/85 backdrop-blur border-b border-slate-200 px-4 sm:px-6 py-2 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5">
            <SidebarToggle onClick={openSidebar} className="-ml-1" />
            <button
              onClick={onHome}
              className="flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-100 transition-colors"
            >
              <ArrowLeft size={14} /> {t('qualityControlModule.moduleHub')}
            </button>
          </div>
          <span className="text-[10px] uppercase tracking-widest font-bold text-slate-400">
            {t('qualityControlModule.title')}
          </span>
        </header>
        <div className="flex-1 min-w-0">
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

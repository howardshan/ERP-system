import React, { useState } from 'react';
import {
  Package,
  Boxes,
  MapPin,
  LayoutGrid,
  HelpCircle,
  ArrowLeft,
  Layers,
  Truck,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { usePermissions } from '../../contexts/PermissionContext';
import ItemsPage from './ItemsPage';
import LocationsPage from './LocationsPage';
import BalancePage from './BalancePage';
import GoodsReceiptPage from './GoodsReceiptPage';

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

export default function WarehouseModule({ onHome }: Props) {
  const { can } = usePermissions();
  const [screen, setScreen] = useState('home');

  const canViewItems = can('warehouse', 'items', 'view');
  const canViewLocations = can('warehouse', 'locations', 'view');
  const canViewInventory = can('warehouse', 'inventory', 'view');
  const canViewReceipts = can('warehouse', 'goods_receipt', 'view');

  const isActive = (id: string) => screen === id || screen.startsWith(id + ':');
  const navigate = (s: string) => setScreen(s);

  function renderContent() {
    if (screen === 'balance' && canViewInventory) return <BalancePage />;
    if (screen === 'goods-receipt' && canViewReceipts) return <GoodsReceiptPage />;
    if (screen === 'items' && canViewItems) return <ItemsPage />;
    if (screen === 'locations' && canViewLocations) return <LocationsPage />;
    return <WarehouseHome />;
  }

  return (
    <div className="min-h-screen bg-[#faf8f5] flex">
      <aside className="w-64 bg-[#0a0f1d] border-r border-white/10 flex flex-col h-screen fixed left-0 top-0">
        <div className="p-5 mb-1">
          <button
            onClick={onHome}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors group text-left"
          >
            <div className="w-7 h-7 rounded-lg bg-emerald-600 flex items-center justify-center shrink-0">
              <LayoutGrid size={14} className="text-white" />
            </div>
            <div>
              <p className="text-white font-bold text-sm leading-none">Warehouse</p>
              <p className="text-[9px] text-slate-500 uppercase tracking-widest font-bold mt-0.5 group-hover:text-slate-400 transition-colors">
                ← All Modules
              </p>
            </div>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto space-y-0.5 pb-4">
          <NavItem icon={Package} label="Overview" isActive={isActive('home')} onClick={() => navigate('home')} />

          {(canViewInventory || canViewReceipts) && <NavSection title="Inventory" />}
          {canViewInventory && (
            <NavItem icon={Layers} label="Balance" isActive={isActive('balance')} onClick={() => navigate('balance')} />
          )}
          {canViewReceipts && (
            <NavItem icon={Truck} label="Goods Receipt" isActive={isActive('goods-receipt')} onClick={() => navigate('goods-receipt')} />
          )}

          {(canViewItems || canViewLocations) && <NavSection title="Master Data" />}
          {canViewItems && (
            <NavItem icon={Boxes} label="Items" isActive={isActive('items')} onClick={() => navigate('items')} />
          )}
          {canViewLocations && (
            <NavItem icon={MapPin} label="Locations" isActive={isActive('locations')} onClick={() => navigate('locations')} />
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
            Warehouse &amp; Inventory
          </span>
        </header>
        <div className="flex-1">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}

function WarehouseHome() {
  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Warehouse &amp; Inventory</h1>
      <p className="text-slate-600 mb-6 text-sm">
        Sprint 0 — master data foundation. Inventory ledger, goods receipt, transfers and QC
        release sync arrive in later sprints.
      </p>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="rounded-xl border bg-white p-5">
          <div className="flex items-center gap-2 text-emerald-700 font-semibold mb-1">
            <Boxes size={18} /> Items
          </div>
          <p className="text-sm text-slate-600">Maintain item master data (SKU, type, base UOM, lot control, shelf life).</p>
        </div>
        <div className="rounded-xl border bg-white p-5">
          <div className="flex items-center gap-2 text-emerald-700 font-semibold mb-1">
            <MapPin size={18} /> Locations
          </div>
          <p className="text-sm text-slate-600">The 7 logical zones of the main warehouse (raw material → finished goods).</p>
        </div>
      </div>
    </div>
  );
}

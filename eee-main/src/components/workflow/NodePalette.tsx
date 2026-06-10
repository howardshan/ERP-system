import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Zap, Clock, FilePlus, Package, ShoppingCart,
  BarChart3, FileText, Database, Wallet, Receipt,
  Filter, GitBranch, Sigma, Shuffle,
  PenLine, Send, Bell, Download,
  LayoutDashboard, Mail, Webhook,
  ChevronDown,
} from 'lucide-react';
import type { NodeCategory, NodeSubtype } from '../../types/workflow';

interface PaletteItem {
  subtype: NodeSubtype;
  labelKey: string;
  icon: React.ReactNode;
}

interface PaletteGroup {
  category: NodeCategory;
  labelKey: string;
  labelColor: string;
  itemClass: string;
  items: PaletteItem[];
}

const PALETTE: PaletteGroup[] = [
  {
    category: 'trigger',
    labelKey: 'nodePalette.groupTriggers',
    labelColor: 'text-emerald-600',
    itemClass: 'text-emerald-700 border-emerald-200 bg-emerald-50 hover:bg-emerald-100',
    items: [
      { subtype: 'manual',              labelKey: 'nodePalette.manualRun',         icon: <Zap size={13} /> },
      { subtype: 'schedule',            labelKey: 'nodePalette.onSchedule',        icon: <Clock size={13} /> },
      { subtype: 'on_je_created',       labelKey: 'nodePalette.jeCreated',         icon: <FilePlus size={13} /> },
      { subtype: 'on_inventory_change', labelKey: 'nodePalette.inventoryChange',   icon: <Package size={13} /> },
      { subtype: 'on_so_created',       labelKey: 'nodePalette.salesOrderCreated', icon: <ShoppingCart size={13} /> },
      { subtype: 'on_po_created',       labelKey: 'nodePalette.poCreated',         icon: <ShoppingCart size={13} /> },
    ],
  },
  {
    category: 'dataSource',
    labelKey: 'nodePalette.groupDataSources',
    labelColor: 'text-blue-600',
    itemClass: 'text-blue-700 border-blue-200 bg-blue-50 hover:bg-blue-100',
    items: [
      { subtype: 'gl_accounts',       labelKey: 'nodePalette.glAccounts',       icon: <BarChart3 size={13} /> },
      { subtype: 'journal_entries',   labelKey: 'nodePalette.journalEntries',   icon: <FileText size={13} /> },
      { subtype: 'inventory_balance', labelKey: 'nodePalette.inventoryBalance', icon: <Database size={13} /> },
      { subtype: 'purchase_orders',   labelKey: 'nodePalette.purchaseOrders',   icon: <Wallet size={13} /> },
      { subtype: 'sales_orders',      labelKey: 'nodePalette.salesOrders',      icon: <ShoppingCart size={13} /> },
      { subtype: 'ap_invoices',       labelKey: 'nodePalette.apInvoices',       icon: <Wallet size={13} /> },
      { subtype: 'ar_invoices',       labelKey: 'nodePalette.arInvoices',       icon: <Receipt size={13} /> },
    ],
  },
  {
    category: 'logic',
    labelKey: 'nodePalette.groupLogic',
    labelColor: 'text-amber-600',
    itemClass: 'text-amber-700 border-amber-200 bg-amber-50 hover:bg-amber-100',
    items: [
      { subtype: 'filter',    labelKey: 'nodePalette.filterWhere',     icon: <Filter size={13} /> },
      { subtype: 'branch',    labelKey: 'nodePalette.branchIfElse',    icon: <GitBranch size={13} /> },
      { subtype: 'aggregate', labelKey: 'nodePalette.aggregate',       icon: <Sigma size={13} /> },
      { subtype: 'transform', labelKey: 'nodePalette.transformFields', icon: <Shuffle size={13} /> },
    ],
  },
  {
    category: 'action',
    labelKey: 'nodePalette.groupActions',
    labelColor: 'text-violet-600',
    itemClass: 'text-violet-700 border-violet-200 bg-violet-50 hover:bg-violet-100',
    items: [
      { subtype: 'create_je',         labelKey: 'nodePalette.createJournalEntry', icon: <PenLine size={13} /> },
      { subtype: 'post_je',           labelKey: 'nodePalette.postJournalEntry',   icon: <Send size={13} /> },
      { subtype: 'send_notification', labelKey: 'nodePalette.sendNotification',   icon: <Bell size={13} /> },
      { subtype: 'export_csv',        labelKey: 'nodePalette.exportToCsv',        icon: <Download size={13} /> },
    ],
  },
  {
    category: 'output',
    labelKey: 'nodePalette.groupOutputs',
    labelColor: 'text-slate-600',
    itemClass: 'text-slate-700 border-slate-200 bg-slate-100 hover:bg-slate-200',
    items: [
      { subtype: 'dashboard_widget', labelKey: 'nodePalette.dashboardWidget', icon: <LayoutDashboard size={13} /> },
      { subtype: 'email_report',     labelKey: 'nodePalette.emailReport',     icon: <Mail size={13} /> },
      { subtype: 'webhook',          labelKey: 'nodePalette.webhook',         icon: <Webhook size={13} /> },
    ],
  },
];

interface NodePaletteProps {
  onAdd: (subtype: NodeSubtype, label: string, category: NodeCategory) => void;
}

export function NodePalette({ onAdd }: NodePaletteProps) {
  const { t } = useTranslation('workflowBuilder');
  const [collapsed, setCollapsed] = useState<Set<NodeCategory>>(new Set());

  function onDragStart(e: React.DragEvent, item: PaletteItem, category: NodeCategory) {
    e.dataTransfer.setData(
      'text/plain',
      JSON.stringify({ subtype: item.subtype, label: t(item.labelKey), category }),
    );
    e.dataTransfer.effectAllowed = 'move';
  }

  function toggleGroup(cat: NodeCategory) {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  }

  return (
    <div className="w-64 bg-[#faf8f5] border-r border-slate-200 flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200">
        <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">{t('nodePalette.title')}</p>
        <p className="text-[9px] text-slate-400 mt-0.5">{t('nodePalette.hint')}</p>
      </div>

      <div className="flex-1 overflow-y-auto py-2 space-y-1">
        {PALETTE.map((group) => {
          const isOpen = !collapsed.has(group.category);
          return (
            <div key={group.category}>
              {/* Group header */}
              <button
                onClick={() => toggleGroup(group.category)}
                className="w-full flex items-center justify-between px-4 py-2 hover:bg-slate-100 transition-colors"
              >
                <span className={`text-[10px] font-bold uppercase tracking-widest ${group.labelColor}`}>
                  {t(group.labelKey)}
                </span>
                <ChevronDown
                  size={12}
                  className={`text-slate-400 transition-transform ${isOpen ? '' : '-rotate-90'}`}
                />
              </button>

              {/* Items */}
              {isOpen && (
                <div className="px-2 pb-1 space-y-0.5">
                  {group.items.map((item) => (
                    <div
                      key={item.subtype}
                      draggable
                      onDragStart={(e) => onDragStart(e, item, group.category)}
                      onClick={() => onAdd(item.subtype, t(item.labelKey), group.category)}
                      className={`
                        flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer
                        transition-all hover:scale-[1.02] hover:shadow-sm active:scale-95
                        ${group.itemClass}
                      `}
                    >
                      <span className="shrink-0">{item.icon}</span>
                      <span className="text-[11px] font-medium truncate">{t(item.labelKey)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

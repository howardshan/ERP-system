import React, { useState } from 'react';
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
  label: string;
  icon: React.ReactNode;
}

interface PaletteGroup {
  category: NodeCategory;
  label: string;
  labelColor: string;
  itemClass: string;
  items: PaletteItem[];
}

const PALETTE: PaletteGroup[] = [
  {
    category: 'trigger',
    label: 'Triggers',
    labelColor: 'text-emerald-600',
    itemClass: 'text-emerald-700 border-emerald-200 bg-emerald-50 hover:bg-emerald-100',
    items: [
      { subtype: 'manual',              label: 'Manual Run',          icon: <Zap size={13} /> },
      { subtype: 'schedule',            label: 'On Schedule',         icon: <Clock size={13} /> },
      { subtype: 'on_je_created',       label: 'JE Created',          icon: <FilePlus size={13} /> },
      { subtype: 'on_inventory_change', label: 'Inventory Change',    icon: <Package size={13} /> },
      { subtype: 'on_so_created',       label: 'Sales Order Created', icon: <ShoppingCart size={13} /> },
      { subtype: 'on_po_created',       label: 'PO Created',          icon: <ShoppingCart size={13} /> },
    ],
  },
  {
    category: 'dataSource',
    label: 'Data Sources',
    labelColor: 'text-blue-600',
    itemClass: 'text-blue-700 border-blue-200 bg-blue-50 hover:bg-blue-100',
    items: [
      { subtype: 'gl_accounts',       label: 'GL Accounts',        icon: <BarChart3 size={13} /> },
      { subtype: 'journal_entries',   label: 'Journal Entries',    icon: <FileText size={13} /> },
      { subtype: 'inventory_balance', label: 'Inventory Balance',  icon: <Database size={13} /> },
      { subtype: 'purchase_orders',   label: 'Purchase Orders',    icon: <Wallet size={13} /> },
      { subtype: 'sales_orders',      label: 'Sales Orders',       icon: <ShoppingCart size={13} /> },
      { subtype: 'ap_invoices',       label: 'AP Invoices',        icon: <Wallet size={13} /> },
      { subtype: 'ar_invoices',       label: 'AR Invoices',        icon: <Receipt size={13} /> },
    ],
  },
  {
    category: 'logic',
    label: 'Logic',
    labelColor: 'text-amber-600',
    itemClass: 'text-amber-700 border-amber-200 bg-amber-50 hover:bg-amber-100',
    items: [
      { subtype: 'filter',    label: 'Filter / Where',   icon: <Filter size={13} /> },
      { subtype: 'branch',    label: 'Branch (If/Else)', icon: <GitBranch size={13} /> },
      { subtype: 'aggregate', label: 'Aggregate',        icon: <Sigma size={13} /> },
      { subtype: 'transform', label: 'Transform Fields', icon: <Shuffle size={13} /> },
    ],
  },
  {
    category: 'action',
    label: 'Actions',
    labelColor: 'text-violet-600',
    itemClass: 'text-violet-700 border-violet-200 bg-violet-50 hover:bg-violet-100',
    items: [
      { subtype: 'create_je',         label: 'Create Journal Entry', icon: <PenLine size={13} /> },
      { subtype: 'post_je',           label: 'Post Journal Entry',   icon: <Send size={13} /> },
      { subtype: 'send_notification', label: 'Send Notification',    icon: <Bell size={13} /> },
      { subtype: 'export_csv',        label: 'Export to CSV',        icon: <Download size={13} /> },
    ],
  },
  {
    category: 'output',
    label: 'Outputs',
    labelColor: 'text-slate-600',
    itemClass: 'text-slate-700 border-slate-200 bg-slate-100 hover:bg-slate-200',
    items: [
      { subtype: 'dashboard_widget', label: 'Dashboard Widget', icon: <LayoutDashboard size={13} /> },
      { subtype: 'email_report',     label: 'Email Report',     icon: <Mail size={13} /> },
      { subtype: 'webhook',          label: 'Webhook',          icon: <Webhook size={13} /> },
    ],
  },
];

interface NodePaletteProps {
  onAdd: (subtype: NodeSubtype, label: string, category: NodeCategory) => void;
}

export function NodePalette({ onAdd }: NodePaletteProps) {
  const [collapsed, setCollapsed] = useState<Set<NodeCategory>>(new Set());

  function onDragStart(e: React.DragEvent, item: PaletteItem, category: NodeCategory) {
    e.dataTransfer.setData(
      'text/plain',
      JSON.stringify({ subtype: item.subtype, label: item.label, category }),
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
        <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Node Palette</p>
        <p className="text-[9px] text-slate-400 mt-0.5">Click to add · drag to position</p>
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
                  {group.label}
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
                      onClick={() => onAdd(item.subtype, item.label, group.category)}
                      className={`
                        flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer
                        transition-all hover:scale-[1.02] hover:shadow-sm active:scale-95
                        ${group.itemClass}
                      `}
                    >
                      <span className="shrink-0">{item.icon}</span>
                      <span className="text-[11px] font-medium truncate">{item.label}</span>
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

import React from 'react';
import { type Node, type NodeProps } from '@xyflow/react';
import {
  Zap, Clock, FilePlus, Package, ShoppingCart,
  Database, BarChart3, FileText, Wallet, Receipt,
  GitBranch, Filter, Sigma, Shuffle,
  PenLine, Send, Download, Bell,
  LayoutDashboard, Mail, Webhook,
} from 'lucide-react';
import { BaseNode } from './BaseNode';
import type { WorkflowNodeData } from '../../../types/workflow';

const SUBTYPE_META: Record<string, { icon: React.ReactNode; sublabel: string }> = {
  // Triggers
  manual:               { icon: <Zap size={13} />,         sublabel: 'Trigger' },
  schedule:             { icon: <Clock size={13} />,        sublabel: 'Trigger' },
  on_je_created:        { icon: <FilePlus size={13} />,     sublabel: 'Trigger' },
  on_inventory_change:  { icon: <Package size={13} />,      sublabel: 'Trigger' },
  on_so_created:        { icon: <ShoppingCart size={13} />, sublabel: 'Trigger' },
  on_po_created:        { icon: <ShoppingCart size={13} />, sublabel: 'Trigger' },
  // Data Sources
  gl_accounts:          { icon: <BarChart3 size={13} />,    sublabel: 'Data Source' },
  journal_entries:      { icon: <FileText size={13} />,     sublabel: 'Data Source' },
  inventory_balance:    { icon: <Database size={13} />,     sublabel: 'Data Source' },
  purchase_orders:      { icon: <Wallet size={13} />,       sublabel: 'Data Source' },
  sales_orders:         { icon: <ShoppingCart size={13} />, sublabel: 'Data Source' },
  ap_invoices:          { icon: <Wallet size={13} />,       sublabel: 'Data Source' },
  ar_invoices:          { icon: <Receipt size={13} />,      sublabel: 'Data Source' },
  // Logic
  filter:               { icon: <Filter size={13} />,       sublabel: 'Logic' },
  branch:               { icon: <GitBranch size={13} />,    sublabel: 'Logic' },
  aggregate:            { icon: <Sigma size={13} />,        sublabel: 'Logic' },
  transform:            { icon: <Shuffle size={13} />,      sublabel: 'Logic' },
  // Actions
  create_je:            { icon: <PenLine size={13} />,      sublabel: 'Action' },
  post_je:              { icon: <Send size={13} />,         sublabel: 'Action' },
  send_notification:    { icon: <Bell size={13} />,         sublabel: 'Action' },
  export_csv:           { icon: <Download size={13} />,     sublabel: 'Action' },
  update_record:        { icon: <PenLine size={13} />,      sublabel: 'Action' },
  // Output
  dashboard_widget:     { icon: <LayoutDashboard size={13} />, sublabel: 'Output' },
  email_report:         { icon: <Mail size={13} />,         sublabel: 'Output' },
  webhook:              { icon: <Webhook size={13} />,      sublabel: 'Output' },
};

function configPreview(config: Record<string, unknown>): { key: string; value: string }[] {
  return Object.entries(config)
    .filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .slice(0, 3)
    .map(([k, v]) => ({ key: k, value: String(v) }));
}

export function WorkflowNode({ data, selected }: NodeProps<Node<WorkflowNodeData>>) {
  const meta = SUBTYPE_META[data.subtype] ?? { icon: <Zap size={13} />, sublabel: '' };
  const isBranch = data.subtype === 'branch';

  return (
    <BaseNode
      category={data.category}
      icon={meta.icon}
      label={data.label}
      sublabel={meta.sublabel}
      configRows={configPreview(data.config)}
      selected={selected}
      hasInput={data.category !== 'trigger'}
      hasOutput={!isBranch}
      outputHandles={isBranch ? [
        { id: 'true',  label: 'True',  top: 33 },
        { id: 'false', label: 'False', top: 67 },
      ] : undefined}
    />
  );
}

export const nodeTypes = {
  workflowNode: WorkflowNode,
};

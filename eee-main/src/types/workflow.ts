export type NodeCategory = 'trigger' | 'dataSource' | 'logic' | 'action' | 'output';

export type TriggerSubtype =
  | 'manual'
  | 'schedule'
  | 'on_je_created'
  | 'on_inventory_change'
  | 'on_so_created'
  | 'on_po_created';

export type DataSourceSubtype =
  | 'gl_accounts'
  | 'journal_entries'
  | 'inventory_balance'
  | 'purchase_orders'
  | 'sales_orders'
  | 'ap_invoices'
  | 'ar_invoices';

export type LogicSubtype = 'filter' | 'branch' | 'aggregate' | 'transform';

export type ActionSubtype =
  | 'create_je'
  | 'post_je'
  | 'send_notification'
  | 'export_csv'
  | 'update_record';

export type OutputSubtype = 'dashboard_widget' | 'email_report' | 'webhook';

export type NodeSubtype =
  | TriggerSubtype
  | DataSourceSubtype
  | LogicSubtype
  | ActionSubtype
  | OutputSubtype;

// extends Record<string, unknown> so React Flow's Node<T> constraint is satisfied
export interface WorkflowNodeData extends Record<string, unknown> {
  label: string;
  subtype: NodeSubtype;
  category: NodeCategory;
  config: Record<string, unknown>;
}

export interface WorkflowEdgeData {
  label?: string;
  condition?: string; // for branch nodes: 'true' | 'false'
}

export interface WorkflowDefinition {
  id: number;
  name: string;
  description: string | null;
  nodes_json: string; // JSON stringified ReactFlow nodes
  edges_json: string; // JSON stringified ReactFlow edges
  status: 'draft' | 'active' | 'paused' | 'archived';
  created_at: string;
  updated_at: string | null;
  created_by: string | null;
}

export interface WorkflowRun {
  id: number;
  workflow_id: number;
  triggered_by: 'manual' | 'schedule' | 'event';
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
}

import { supabase } from '../lib/supabase';
import type { WorkflowDefinition, WorkflowRun } from '../types/workflow';

export async function getWorkflows(): Promise<WorkflowDefinition[]> {
  const { data, error } = await supabase
    .from('workflow_definition')
    .select('*')
    .order('updated_at', { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return data as WorkflowDefinition[];
}

export async function getWorkflow(id: number): Promise<WorkflowDefinition> {
  const { data, error } = await supabase
    .from('workflow_definition')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw new Error(error.message);
  return data as WorkflowDefinition;
}

export async function createWorkflow(params: {
  name: string;
  description?: string;
  nodes_json?: string;
  edges_json?: string;
}): Promise<WorkflowDefinition> {
  const { data, error } = await supabase
    .from('workflow_definition')
    .insert({
      name: params.name,
      description: params.description ?? null,
      nodes_json: params.nodes_json ?? '[]',
      edges_json: params.edges_json ?? '[]',
      status: 'draft',
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as WorkflowDefinition;
}

export async function saveWorkflow(
  id: number,
  params: { name?: string; description?: string; nodes_json: string; edges_json: string },
): Promise<void> {
  const { error } = await supabase
    .from('workflow_definition')
    .update({ ...params, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function updateWorkflowStatus(
  id: number,
  status: WorkflowDefinition['status'],
): Promise<void> {
  const { error } = await supabase
    .from('workflow_definition')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteWorkflow(id: number): Promise<void> {
  const { error } = await supabase
    .from('workflow_definition')
    .delete()
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function getWorkflowRuns(workflowId: number): Promise<WorkflowRun[]> {
  const { data, error } = await supabase
    .from('workflow_run')
    .select('*')
    .eq('workflow_id', workflowId)
    .order('started_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return data as WorkflowRun[];
}

export async function createWorkflowRun(workflowId: number): Promise<WorkflowRun> {
  const { data, error } = await supabase
    .from('workflow_run')
    .insert({ workflow_id: workflowId, triggered_by: 'manual', status: 'running' })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as WorkflowRun;
}

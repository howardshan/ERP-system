import { supabase } from '../lib/supabase';

// One normalized row of the cross-module system log (view v_system_audit_log,
// M-155). Aggregates finance/hr/qc/auth audit tables + qc_quality_event /
// prod_downtime_event / notification_log operational events.
export interface SystemLogEntry {
  id: string;
  source: string;
  module: string;
  ts: string;
  actor_auth_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  summary: string | null;
  detail: Record<string, unknown> | null;
}

export async function getSystemLog(params?: {
  module?: string;
  actor_auth_id?: string;
  from?: string;   // ISO timestamp (inclusive lower bound)
  to?: string;     // ISO timestamp (inclusive upper bound)
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<SystemLogEntry[]> {
  let query = supabase
    .from('v_system_audit_log')
    .select('*')
    .order('ts', { ascending: false })
    .range(params?.offset ?? 0, (params?.offset ?? 0) + (params?.limit ?? 50) - 1);

  if (params?.module) query = query.eq('module', params.module);
  if (params?.actor_auth_id) query = query.eq('actor_auth_id', params.actor_auth_id);
  if (params?.from) query = query.gte('ts', params.from);
  if (params?.to) query = query.lte('ts', params.to);
  if (params?.search) {
    const q = params.search.trim();
    query = query.or(`summary.ilike.%${q}%,actor_name.ilike.%${q}%,entity_id.ilike.%${q}%,action.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data as SystemLogEntry[];
}

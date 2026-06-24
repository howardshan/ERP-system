import { supabase } from '../lib/supabase';
import type { ErpUser, UserPermissionGrant } from '../types/auth';

export async function getUsers(): Promise<ErpUser[]> {
  const { data, error } = await supabase.rpc('list_erp_users');
  if (error) throw error;

  const rows = (data ?? []) as Array<{
    erp_user_id: string; auth_user_id: string | null; email: string;
    full_name: string; role: string | null; department: string | null;
    manager_id: string | null; manager_name: string | null;
    is_active: boolean; created_at: string;
  }>;

  const { data: access } = await supabase.from('user_module_access').select('user_id, module_id');
  const accessMap: Record<string, string[]> = {};
  for (const row of access ?? []) {
    (accessMap[row.user_id] ??= []).push(row.module_id);
  }

  return rows.map(r => ({
    id: r.erp_user_id,
    auth_user_id: r.auth_user_id ?? undefined,
    full_name: r.full_name,
    email: r.email,
    role: r.role,
    department: r.department,
    manager_id: r.manager_id,
    manager: r.manager_id && r.manager_name ? { id: r.manager_id, full_name: r.manager_name } : undefined,
    is_active: r.is_active,
    created_at: r.created_at,
    module_access: accessMap[r.erp_user_id] ?? [],
  }));
}

export async function getUser(id: string): Promise<ErpUser> {
  // Use RPC so we get auth-overlay data (full_name from auth metadata etc.)
  const { data, error } = await supabase.rpc('list_erp_users');
  if (error) throw error;

  const rows = (data ?? []) as Array<{
    erp_user_id: string; auth_user_id: string | null; email: string;
    full_name: string; role: string | null; department: string | null;
    manager_id: string | null; manager_name: string | null;
    is_active: boolean; created_at: string;
  }>;

  const row = rows.find(r => r.erp_user_id === id);
  if (!row) throw new Error('User not found');

  const { data: access } = await supabase
    .from('user_module_access')
    .select('module_id')
    .eq('user_id', id);

  return {
    id: row.erp_user_id,
    auth_user_id: row.auth_user_id ?? undefined,
    full_name: row.full_name,
    email: row.email,
    role: row.role,
    department: row.department,
    manager_id: row.manager_id,
    manager: row.manager_id && row.manager_name ? { id: row.manager_id, full_name: row.manager_name } : undefined,
    is_active: row.is_active,
    created_at: row.created_at,
    module_access: (access ?? []).map(r => r.module_id),
  };
}

export async function updateUser(id: string, patch: Partial<Pick<ErpUser, 'full_name' | 'role' | 'department' | 'manager_id' | 'is_active'>>): Promise<void> {
  const { error } = await supabase.from('erp_user').update(patch).eq('id', id);
  if (error) throw error;
}

export async function setModuleAccess(userId: string, moduleIds: string[]): Promise<void> {
  await supabase.from('user_module_access').delete().eq('user_id', userId);
  if (moduleIds.length > 0) {
    const { error } = await supabase.from('user_module_access').insert(
      moduleIds.map(m => ({ user_id: userId, module_id: m }))
    );
    if (error) throw error;
  }
}

export async function getUserPermissions(userId: string): Promise<UserPermissionGrant[]> {
  const { data, error } = await supabase
    .from('user_permission_grant')
    .select('*')
    .eq('user_id', userId);
  if (error) throw error;
  return data ?? [];
}

export async function setPermission(
  userId: string, moduleId: string, resource: string, permission: string,
  enabled: boolean, approvalLimit?: number | null
): Promise<void> {
  if (enabled) {
    const { error } = await supabase.from('user_permission_grant').upsert({
      user_id: userId, module_id: moduleId, resource, permission,
      approval_limit: approvalLimit ?? null,
    }, { onConflict: 'user_id,module_id,resource,permission' });
    if (error) throw error;
  } else {
    const { error } = await supabase.from('user_permission_grant')
      .delete()
      .match({ user_id: userId, module_id: moduleId, resource, permission });
    if (error) throw error;
  }
}

export async function getPermissionHolders(
  moduleId: string, resource: string, permission: string
): Promise<UserPermissionGrant[]> {
  const { data, error } = await supabase
    .from('user_permission_grant')
    .select('*, user:user_id(id, full_name, email, department)')
    .match({ module_id: moduleId, resource, permission });
  if (error) throw error;
  return data ?? [];
}

// ── Auth audit log (M-153) ────────────────────────────────────────────────────
// Dual-subject audit: records the actor (resolved from the current session) and
// the target user the action was performed on.  Fire-and-forget like the other
// modules' loggers — never throws into the calling operation.

export interface AuthAuditLogEntry {
  id: number;
  action: string;
  actor_auth_id: string | null;
  actor_name: string;
  target_auth_id: string | null;
  target_user_id: string | null;
  target_name: string | null;
  target_email: string | null;
  before_snapshot: Record<string, unknown> | null;
  after_snapshot: Record<string, unknown> | null;
  diff: Record<string, unknown> | null;
  description: string | null;
  changed_at: string;
}

export async function logAuthAction(params: {
  action: string;
  target_auth_id?: string | null;
  target_user_id?: string | null;
  target_name?: string | null;
  target_email?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  diff?: Record<string, unknown> | null;
  description?: string | null;
}): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: erpRow } = await supabase
      .from('erp_user').select('full_name').eq('auth_user_id', user.id).single();
    await supabase.from('auth_audit_log').insert({
      action:         params.action,
      actor_auth_id:  user.id,
      actor_name:     erpRow?.full_name ?? user.email ?? 'Unknown',
      target_auth_id: params.target_auth_id ?? null,
      target_user_id: params.target_user_id ?? null,
      target_name:    params.target_name ?? null,
      target_email:   params.target_email ?? null,
      before_snapshot: params.before ?? null,
      after_snapshot:  params.after ?? null,
      diff:            params.diff ?? null,
      description:     params.description ?? null,
    });
  } catch {
    // Logging must never break the main operation
  }
}

export async function getAuthAuditLog(params?: {
  target_user_id?: string;
  action?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<AuthAuditLogEntry[]> {
  let query = supabase
    .from('auth_audit_log')
    .select('*')
    .order('changed_at', { ascending: false })
    .range(params?.offset ?? 0, (params?.offset ?? 0) + (params?.limit ?? 100) - 1);
  if (params?.target_user_id) query = query.eq('target_user_id', params.target_user_id);
  if (params?.action) query = query.eq('action', params.action);
  if (params?.search) {
    const q = params.search.trim();
    query = query.or(
      `description.ilike.%${q}%,actor_name.ilike.%${q}%,target_name.ilike.%${q}%,target_email.ilike.%${q}%`,
    );
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data as AuthAuditLogEntry[];
}

export async function resetUserPassword(authUserId: string, newPassword: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reset-user-password`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ auth_user_id: authUserId, new_password: newPassword }),
    }
  );
  const json = await res.json();
  if (json.error) throw new Error(json.error);
}

// Admin "reset MFA" — removes all of a user's TOTP factors via EF-005 so they
// can re-enroll on next login (recovery for a lost authenticator).
export async function resetUserMfa(authUserId: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reset-user-mfa`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ auth_user_id: authUserId }),
    }
  );
  const json = await res.json();
  if (json.error) throw new Error(json.error);
}

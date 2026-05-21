import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { ErpUser, UserPermissionGrant } from '../types/auth';

interface PermissionContextValue {
  erpUser: ErpUser | null;
  grants: UserPermissionGrant[];
  moduleAccess: string[];
  loading: boolean;
  /** Check if current user has a specific permission */
  can: (module: string, resource: string, permission: string) => boolean;
  /** Check if current user has access to a module */
  canAccessModule: (module: string) => boolean;
  /** Get approval limit for a permission (null = unlimited) */
  approvalLimit: (module: string, resource: string, permission: string) => number | null;
  /** Reload permissions (call after saving changes to own permissions) */
  reload: () => Promise<void>;
}

const PermissionContext = createContext<PermissionContextValue>({
  erpUser: null, grants: [], moduleAccess: [], loading: true,
  can: () => false, canAccessModule: () => false,
  approvalLimit: () => null, reload: async () => {},
});

export function PermissionProvider({ authUserId, children }: { authUserId: string; children: React.ReactNode }) {
  const [erpUser, setErpUser] = useState<ErpUser | null>(null);
  const [grants, setGrants] = useState<UserPermissionGrant[]>([]);
  const [moduleAccess, setModuleAccess] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    // Find erp_user linked to this auth account
    const { data: rpcData } = await supabase.rpc('list_erp_users');
    const rows = (rpcData ?? []) as Array<{
      erp_user_id: string; auth_user_id: string | null; email: string;
      full_name: string; department: string | null;
      manager_id: string | null; manager_name: string | null;
      is_active: boolean; created_at: string;
    }>;
    const row = rows.find(r => r.auth_user_id === authUserId);
    if (!row) { setLoading(false); return; }

    const user: ErpUser = {
      id: row.erp_user_id,
      auth_user_id: row.auth_user_id,
      full_name: row.full_name,
      email: row.email,
      role: (row as any).role ?? null,
      department: row.department,
      manager_id: row.manager_id,
      is_active: row.is_active,
      created_at: row.created_at,
    };

    const [{ data: accessData }, { data: grantsData }] = await Promise.all([
      supabase.from('user_module_access').select('module_id').eq('user_id', row.erp_user_id),
      supabase.from('user_permission_grant').select('*').eq('user_id', row.erp_user_id),
    ]);

    setErpUser(user);
    setModuleAccess((accessData ?? []).map((r: any) => r.module_id));
    setGrants(grantsData ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [authUserId]);

  function can(module: string, resource: string, permission: string): boolean {
    return grants.some(g =>
      g.module_id === module && g.resource === resource && g.permission === permission
    );
  }

  function canAccessModule(module: string): boolean {
    return moduleAccess.includes(module);
  }

  function approvalLimit(module: string, resource: string, permission: string): number | null {
    return grants.find(g =>
      g.module_id === module && g.resource === resource && g.permission === permission
    )?.approval_limit ?? null;
  }

  return (
    <PermissionContext.Provider value={{ erpUser, grants, moduleAccess, loading, can, canAccessModule, approvalLimit, reload: load }}>
      {children}
    </PermissionContext.Provider>
  );
}

export function usePermissions() {
  return useContext(PermissionContext);
}

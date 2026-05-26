export interface ErpUser {
  id: string;
  auth_user_id?: string | null;
  full_name: string;
  email: string;
  role: string | null;
  department: string | null;
  manager_id: string | null;
  manager?: Pick<ErpUser, 'id' | 'full_name'>;
  is_active: boolean;
  created_at: string;
  module_access?: string[];
}

export interface UserPermissionGrant {
  id: number;
  user_id: string;
  module_id: string;
  resource: string;
  permission: string;
  approval_limit: number | null;
  granted_at: string;
  granted_by_id: string | null;
  user?: Pick<ErpUser, 'id' | 'full_name' | 'email' | 'department'>;
}

export interface NotificationType {
  key: string;
  module_id: string;
  label: string;
  description: string | null;
  sort_order: number;
}

export interface UserNotificationSetting {
  user_id: string;
  type_key: string;
  admin_enabled: boolean;
  user_overridable: boolean;
  user_enabled: boolean | null;
  updated_at?: string;
}

export interface PermissionDef {
  id: string;
  label: string;
  prereq: string | null;
  hasLimit?: boolean;
}

export interface ResourceDef {
  label: string;
  permissions: PermissionDef[];
}

export interface ModuleDef {
  label: string;
  resources: Record<string, ResourceDef>;
}

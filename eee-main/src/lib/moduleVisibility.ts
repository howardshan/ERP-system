import { supabase } from './supabase';

/** All frontend modules that the developer superuser panel can show/hide.
 *  `id` matches the module keys used by App routing, HomePage cards and
 *  PERMISSION_STRUCTURE. */
export interface ModuleInfo { id: string; label: string }

export const ALL_MODULES: ModuleInfo[] = [
  { id: 'finance',    label: '财务管理' },
  { id: 'warehouse',  label: '仓储与库存' },
  { id: 'production', label: '生产制造' },
  { id: 'qc',         label: '质量控制' },
  { id: 'packaging',  label: '包装' },
  { id: 'hr',         label: '人力资源' },
  { id: 'workflow',   label: '工作流' },
  { id: 'docs',       label: '文档' },
  { id: 'auth',       label: '用户与权限' },
  { id: 'sales',      label: '销售与分销' },
  { id: 'logs',       label: '日志与审计' },
  { id: 'faq',        label: '常见问题' },
];

/** Global list of HIDDEN module ids (read by every client). Returns [] if the
 *  config table doesn't exist yet / on any error → fail-open (all visible). */
export async function fetchHiddenModules(): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('app_module_visibility')
      .select('hidden_modules')
      .eq('id', 1)
      .maybeSingle();
    if (error || !data) return [];
    return (data.hidden_modules as string[] | null) ?? [];
  } catch {
    return [];
  }
}

/** Persist the hidden-module list. `secret` = the developer superuser password,
 *  verified server-side by the set_module_visibility RPC. */
export async function saveHiddenModules(hidden: string[], secret: string): Promise<void> {
  const { error } = await supabase.rpc('set_module_visibility', { p_hidden: hidden, p_secret: secret });
  if (error) throw new Error(error.message);
}

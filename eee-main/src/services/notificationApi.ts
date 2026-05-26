import { supabase } from '../lib/supabase';
import type { NotificationType, UserNotificationSetting } from '../types/auth';

/** All notification types, ordered for per-module grouping. */
export async function getNotificationTypes(): Promise<NotificationType[]> {
  const { data, error } = await supabase
    .from('notification_type')
    .select('*')
    .order('module_id', { ascending: true })
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** A user's saved notification settings (rows may be absent → caller applies defaults). */
export async function getUserNotificationSettings(userId: string): Promise<UserNotificationSetting[]> {
  const { data, error } = await supabase
    .from('user_notification_setting')
    .select('*')
    .eq('user_id', userId);
  if (error) throw error;
  return data ?? [];
}

/** Upsert one (user, type) setting. Pass only the fields you mean to change; the rest keep their values. */
export async function setUserNotificationSetting(
  userId: string,
  typeKey: string,
  patch: { admin_enabled?: boolean; user_overridable?: boolean; user_enabled?: boolean | null },
): Promise<void> {
  const { error } = await supabase
    .from('user_notification_setting')
    .upsert(
      {
        user_id: userId,
        type_key: typeKey,
        ...patch,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,type_key' },
    );
  if (error) throw error;
}

/**
 * Effective on/off for a setting (mirrors the SQL rule in notification_recipients):
 *   user_overridable AND user_enabled IS NOT NULL → user_enabled
 *   otherwise                                      → admin_enabled
 */
export function effectiveEnabled(s: Pick<UserNotificationSetting, 'admin_enabled' | 'user_overridable' | 'user_enabled'>): boolean {
  if (s.user_overridable && s.user_enabled !== null && s.user_enabled !== undefined) return s.user_enabled;
  return s.admin_enabled;
}

/** Group notification types by their module_id, preserving order. */
export function groupByModule(types: NotificationType[]): Record<string, NotificationType[]> {
  const out: Record<string, NotificationType[]> = {};
  for (const t of types) (out[t.module_id] ??= []).push(t);
  return out;
}

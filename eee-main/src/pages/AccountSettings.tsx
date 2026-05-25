import React, { useEffect, useState } from 'react';
import { ArrowLeft, Bell, Lock, Loader2, User as UserIcon } from 'lucide-react';
import { usePermissions } from '../contexts/PermissionContext';
import { PERMISSION_STRUCTURE } from '../lib/permissionStructure';
import {
  getNotificationTypes,
  getUserNotificationSettings,
  setUserNotificationSetting,
  effectiveEnabled,
  groupByModule,
} from '../services/notificationApi';
import type { NotificationType, UserNotificationSetting } from '../types/auth';

interface Props {
  onHome: () => void;
}

function moduleLabel(moduleId: string): string {
  return PERMISSION_STRUCTURE[moduleId]?.label ?? moduleId.toUpperCase();
}

export default function AccountSettings({ onHome }: Props) {
  const { erpUser, loading: permLoading } = usePermissions();
  const [types, setTypes] = useState<NotificationType[]>([]);
  const [settings, setSettings] = useState<Record<string, UserNotificationSetting>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    if (permLoading) return;
    if (!erpUser) { setLoading(false); return; }
    Promise.all([getNotificationTypes(), getUserNotificationSettings(erpUser.id)]).then(([ts, ss]) => {
      setTypes(ts);
      const map: Record<string, UserNotificationSetting> = {};
      for (const s of ss) map[s.type_key] = s;
      setSettings(map);
      setLoading(false);
    });
  }, [erpUser, permLoading]);

  async function toggle(typeKey: string, next: boolean) {
    if (!erpUser) return;
    const prev = settings[typeKey];
    if (!prev) return;
    setSavingKey(typeKey);
    // optimistic
    setSettings(s => ({ ...s, [typeKey]: { ...prev, user_enabled: next } }));
    try {
      await setUserNotificationSetting(erpUser.id, typeKey, { user_enabled: next });
    } catch {
      setSettings(s => ({ ...s, [typeKey]: prev })); // rollback
    }
    setSavingKey(null);
  }

  // Only types that have a saved setting for this user are shown; group by module.
  const visibleTypes = types.filter(t => settings[t.key]);
  const grouped = groupByModule(visibleTypes);

  return (
    <div className="min-h-screen bg-[#faf8f5] flex flex-col">
      {/* Header */}
      <header className="px-12 pt-10 pb-6 flex items-end justify-between">
        <div>
          <button
            onClick={onHome}
            className="flex items-center gap-1.5 text-slate-500 hover:text-slate-900 text-xs font-bold transition-colors mb-4"
          >
            <ArrowLeft size={14} /> Back to Home
          </button>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Account Settings</h1>
          <p className="text-slate-500 text-sm mt-2">Manage your account and notification preferences</p>
        </div>
      </header>

      <div className="mx-12 h-px bg-slate-200 mb-8" />

      <main className="flex-1 px-12 pb-12 max-w-2xl">
        {loading || permLoading ? (
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : !erpUser ? (
          <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-slate-500">
            No ERP profile is linked to your account.
          </div>
        ) : (
          <div className="space-y-8">
            {/* Account info */}
            <section className="bg-white border border-slate-200 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <UserIcon size={15} className="text-slate-500" />
                <h2 className="text-sm font-bold text-slate-900">Account</h2>
              </div>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Name</dt>
                  <dd className="font-medium text-slate-900">{erpUser.full_name}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Email</dt>
                  <dd className="font-medium text-slate-900">{erpUser.email}</dd>
                </div>
                {erpUser.role && (
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Role</dt>
                    <dd className="font-medium text-slate-900">{erpUser.role}</dd>
                  </div>
                )}
                {erpUser.department && (
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Department</dt>
                    <dd className="font-medium text-slate-900">{erpUser.department}</dd>
                  </div>
                )}
              </dl>
            </section>

            {/* Notification settings */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Bell size={15} className="text-slate-500" />
                <h2 className="text-sm font-bold text-slate-900">Notification Settings</h2>
              </div>

              {visibleTypes.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-slate-500">
                  You have no notification settings yet. Your administrator manages which
                  notifications you receive.
                </div>
              ) : (
                <div className="space-y-5">
                  {Object.entries(grouped).map(([moduleId, modTypes]) => (
                    <div key={moduleId} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                      <div className="px-5 py-3 bg-slate-50 border-b border-slate-200">
                        <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                          {moduleLabel(moduleId)}
                        </p>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {modTypes.map(t => {
                          const s = settings[t.key];
                          const locked = !s.user_overridable;
                          const on = effectiveEnabled(s);
                          return (
                            <div key={t.key} className="px-5 py-4 flex items-start gap-4">
                              <div className="flex-1">
                                <p className="text-sm font-medium text-slate-800">{t.label}</p>
                                {t.description && (
                                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{t.description}</p>
                                )}
                                {locked && (
                                  <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                                    <Lock size={11} /> Managed by your administrator
                                  </p>
                                )}
                              </div>
                              {locked ? (
                                <span className={`text-[11px] font-bold px-2 py-1 rounded-full shrink-0 ${
                                  on ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                                }`}>
                                  {on ? 'On' : 'Off'}
                                </span>
                              ) : (
                                <button
                                  onClick={() => toggle(t.key, !on)}
                                  disabled={savingKey === t.key}
                                  className={`w-9 h-5 rounded-full transition-colors shrink-0 relative ${
                                    on ? 'bg-blue-600' : 'bg-slate-300'
                                  } disabled:opacity-50`}
                                  title={on ? 'Turn off' : 'Turn on'}
                                >
                                  <div className={`w-4 h-4 bg-white rounded-full shadow absolute top-0.5 transition-all ${
                                    on ? 'left-4' : 'left-0.5'
                                  }`} />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

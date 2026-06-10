import React, { useEffect, useState } from 'react';
import { ArrowLeft, Save, Loader2, KeyRound, Eye, EyeOff, CheckCircle2, AlertCircle, ShieldCheck, Bell } from 'lucide-react';
import { getUser, getUsers, getUserPermissions, setPermission, setModuleAccess, updateUser, resetUserPassword } from '../../services/authApi';
import {
  getNotificationTypes,
  getUserNotificationSettings,
  setUserNotificationSetting,
  groupByModule,
} from '../../services/notificationApi';
import { PERMISSION_STRUCTURE } from '../../lib/permissionStructure';
import type { ErpUser, UserPermissionGrant, NotificationType, UserNotificationSetting } from '../../types/auth';
import { usePermissions } from '../../contexts/PermissionContext';
import { useTranslation } from 'react-i18next';

interface Props {
  userId: string;
  onBack: () => void;
}

type LeftPanel = 'account' | string; // 'account' or a module id

export default function UserDetail({ userId, onBack }: Props) {
  const { reload: reloadPermissions } = usePermissions();
  const { t } = useTranslation('auth');
  const [user, setUser] = useState<ErpUser | null>(null);
  const [grants, setGrants] = useState<UserPermissionGrant[]>([]);
  const [selectedPanel, setSelectedPanel] = useState<LeftPanel>('account');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [deactivating, setDeactivating] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  // Reset password
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetMsg, setResetMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Permission local state
  const [localModules, setLocalModules] = useState<Set<string>>(new Set());
  const [localGrants, setLocalGrants] = useState<Map<string, number | null>>(new Map());
  const [removedGrants, setRemovedGrants] = useState<Set<string>>(new Set());

  // Notification settings state
  const [notifTypes, setNotifTypes] = useState<NotificationType[]>([]);
  const [notifSettings, setNotifSettings] = useState<Record<string, UserNotificationSetting>>({});
  const [localNotif, setLocalNotif] = useState<Map<string, { admin_enabled: boolean; user_overridable: boolean }>>(new Map());

  useEffect(() => {
    Promise.all([
      getUser(userId),
      getUserPermissions(userId),
      getNotificationTypes(),
      getUserNotificationSettings(userId),
    ]).then(([u, g, ts, ss]) => {
      setUser(u);
      setGrants(g);
      setLocalModules(new Set(u.module_access ?? []));
      setNotifTypes(ts);
      const m: Record<string, UserNotificationSetting> = {};
      for (const s of ss) m[s.type_key] = s;
      setNotifSettings(m);
      setLoading(false);
    });
  }, [userId]);

  // ── Notification helpers ────────────────────────────────────────────────

  function getNotif(typeKey: string): { admin_enabled: boolean; user_overridable: boolean } {
    if (localNotif.has(typeKey)) return localNotif.get(typeKey)!;
    const s = notifSettings[typeKey];
    return { admin_enabled: s?.admin_enabled ?? false, user_overridable: s?.user_overridable ?? false };
  }

  function setNotif(typeKey: string, patch: Partial<{ admin_enabled: boolean; user_overridable: boolean }>) {
    setLocalNotif(prev => {
      const cur = prev.get(typeKey) ?? getNotif(typeKey);
      const next = new Map(prev);
      next.set(typeKey, { ...cur, ...patch });
      return next;
    });
  }

  // ── Permission helpers ──────────────────────────────────────────────

  function grantKey(module: string, resource: string, perm: string) {
    return `${module}|${resource}|${perm}`;
  }

  function hasGrant(module: string, resource: string, perm: string): boolean {
    const key = grantKey(module, resource, perm);
    if (removedGrants.has(key)) return false;
    if (localGrants.has(key)) return true;
    return grants.some(g => g.module_id === module && g.resource === resource && g.permission === perm);
  }

  function getLimit(module: string, resource: string, perm: string): number | null {
    const key = grantKey(module, resource, perm);
    if (localGrants.has(key)) return localGrants.get(key) ?? null;
    return grants.find(g => g.module_id === module && g.resource === resource && g.permission === perm)?.approval_limit ?? null;
  }

  function toggleGrant(module: string, resource: string, perm: string, prereq: string | null) {
    if (prereq && !hasGrant(module, resource, prereq)) return;
    const key = grantKey(module, resource, perm);
    if (hasGrant(module, resource, perm)) {
      setRemovedGrants(prev => new Set([...prev, key]));
      setLocalGrants(prev => { const m = new Map(prev); m.delete(key); return m; });
      const moduleDef = PERMISSION_STRUCTURE[module];
      if (moduleDef) {
        for (const [, resDef] of Object.entries(moduleDef.resources)) {
          for (const p of resDef.permissions) {
            if (p.prereq === perm) {
              setRemovedGrants(prev => new Set([...prev, grantKey(module, resource, p.id)]));
            }
          }
        }
      }
    } else {
      setRemovedGrants(prev => { const s = new Set(prev); s.delete(key); return s; });
      setLocalGrants(prev => new Map([...prev, [key, null]]));
    }
  }

  function setApprovalLimit(module: string, resource: string, perm: string, val: string) {
    const key = grantKey(module, resource, perm);
    const num = val === '' ? null : parseFloat(val);
    setLocalGrants(prev => new Map([...prev, [key, isNaN(num as number) ? null : num]]));
    setRemovedGrants(prev => { const s = new Set(prev); s.delete(key); return s; });
  }

  function toggleAllInScope(keys: string[]) {
    if (keys.length === 0) return;
    const allGranted = keys.every(k => {
      if (removedGrants.has(k)) return false;
      if (localGrants.has(k)) return true;
      const [m, r, p] = k.split('|');
      return grants.some(g => g.module_id === m && g.resource === r && g.permission === p);
    });
    if (allGranted) {
      setRemovedGrants(prev => new Set([...prev, ...keys]));
      setLocalGrants(prev => { const m = new Map(prev); for (const k of keys) m.delete(k); return m; });
    } else {
      setLocalGrants(prev => {
        const m = new Map(prev);
        for (const k of keys) if (!m.has(k)) m.set(k, null);
        return m;
      });
      setRemovedGrants(prev => {
        const s = new Set(prev);
        for (const k of keys) s.delete(k);
        return s;
      });
    }
  }

  function moduleKeys(moduleId: string): string[] {
    const def = PERMISSION_STRUCTURE[moduleId];
    if (!def) return [];
    const keys: string[] = [];
    for (const [resId, resDef] of Object.entries(def.resources)) {
      for (const p of resDef.permissions) keys.push(grantKey(moduleId, resId, p.id));
    }
    return keys;
  }

  function resourceKeys(moduleId: string, resId: string): string[] {
    const def = PERMISSION_STRUCTURE[moduleId];
    const resDef = def?.resources[resId];
    if (!resDef) return [];
    return resDef.permissions.map(p => grantKey(moduleId, resId, p.id));
  }

  function allKeysGranted(keys: string[]): boolean {
    if (keys.length === 0) return false;
    return keys.every(k => {
      if (removedGrants.has(k)) return false;
      if (localGrants.has(k)) return true;
      const [m, r, p] = k.split('|');
      return grants.some(g => g.module_id === m && g.resource === r && g.permission === p);
    });
  }

  // ── Save (module access + permissions only) ───────────────────────────

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      await setModuleAccess(userId, [...localModules]);
      for (const [key, limit] of localGrants) {
        const [mod, res, perm] = key.split('|');
        await setPermission(userId, mod, res, perm, true, limit);
      }
      for (const key of removedGrants) {
        const [mod, res, perm] = key.split('|');
        await setPermission(userId, mod, res, perm, false);
      }
      // Notification settings (admin-side: admin_enabled + user_overridable)
      for (const [typeKey, v] of localNotif) {
        await setUserNotificationSetting(userId, typeKey, {
          admin_enabled: v.admin_enabled,
          user_overridable: v.user_overridable,
        });
      }

      const [u, g, ss] = await Promise.all([
        getUser(userId),
        getUserPermissions(userId),
        getUserNotificationSettings(userId),
      ]);
      for (const key of removedGrants) {
        const [mod, res, perm] = key.split('|');
        const stillExists = g.some(gr => gr.module_id === mod && gr.resource === res && gr.permission === perm);
        if (stillExists) throw new Error(`Failed to remove permission: ${mod}.${res}.${perm}`);
      }
      setUser(u); setGrants(g);
      setLocalGrants(new Map()); setRemovedGrants(new Set());
      setLocalModules(new Set(u.module_access ?? []));
      const m: Record<string, UserNotificationSetting> = {};
      for (const s of ss) m[s.type_key] = s;
      setNotifSettings(m);
      setLocalNotif(new Map());
      setSaveMsg({ type: 'ok', text: t('userDetail.saved') });
      setTimeout(() => setSaveMsg(null), 2500);
      await reloadPermissions();
    } catch (e: any) {
      setSaveMsg({ type: 'err', text: e?.message ?? t('userDetail.error') });
    }
    setSaving(false);
  }

  // ── Deactivate ────────────────────────────────────────────────────────

  async function handleToggleActive() {
    if (!user) return;
    if (user.is_active && !confirmDeactivate) {
      setConfirmDeactivate(true);
      setTimeout(() => setConfirmDeactivate(false), 3000);
      return;
    }
    setDeactivating(true);
    setConfirmDeactivate(false);
    await updateUser(userId, { is_active: !user.is_active });
    const u = await getUser(userId);
    setUser(u);
    setDeactivating(false);
  }

  // ── Reset password ────────────────────────────────────────────────────

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!user?.auth_user_id || newPassword !== confirmPassword || newPassword.length < 6) return;
    setResetting(true);
    setResetMsg(null);
    try {
      await resetUserPassword(user.auth_user_id, newPassword);
      setNewPassword(''); setConfirmPassword('');
      setResetMsg({ type: 'ok', text: t('userDetail.passwordUpdated') });
    } catch (err: any) {
      setResetMsg({ type: 'err', text: err?.message ?? t('userDetail.failed') });
    }
    setResetting(false);
    setTimeout(() => setResetMsg(null), 4000);
  }

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading || !user) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-slate-400" />
      </div>
    );
  }

  const moduleDef = selectedPanel !== 'account' ? PERMISSION_STRUCTURE[selectedPanel] : null;
  const pwMismatch = confirmPassword && newPassword !== confirmPassword;
  const pwCanSubmit = user.auth_user_id && newPassword.length >= 6 && newPassword === confirmPassword;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-8 py-4 bg-white border-b border-slate-200 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="text-slate-500 hover:text-slate-900 text-xs font-bold transition-colors flex items-center gap-1.5">
            <ArrowLeft size={14} /> {t('userDetail.allUsers')}
          </button>
          <div className="w-px h-5 bg-slate-200" />
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
              {user.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">{user.full_name}</h2>
              <p className="text-[11px] text-slate-400">{user.email}</p>
            </div>
            <span className={`ml-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
              user.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
            }`}>
              {user.is_active ? t('userDetail.active') : t('userDetail.inactive')}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {saveMsg && (
            <span className={`text-xs font-bold ${saveMsg.type === 'ok' ? 'text-emerald-600' : 'text-red-500'}`}>
              {saveMsg.text}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors"
          >
            <Save size={13} /> {saving ? t('userDetail.saving') : t('userDetail.saveChanges')}
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar */}
        <nav className="w-56 bg-[#faf8f5] border-r border-slate-200 flex flex-col py-3 overflow-y-auto shrink-0">
          {/* Account */}
          <button
            onClick={() => setSelectedPanel('account')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-bold transition-colors ${
              selectedPanel === 'account'
                ? 'text-blue-700 bg-blue-50 border-r-2 border-blue-600'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <ShieldCheck size={14} /> {t('userDetail.account')}
          </button>

          {/* Notifications */}
          <button
            onClick={() => setSelectedPanel('notifications')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-bold transition-colors ${
              selectedPanel === 'notifications'
                ? 'text-blue-700 bg-blue-50 border-r-2 border-blue-600'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Bell size={14} /> {t('userDetail.notifications')}
          </button>

          <div className="mx-4 my-2 h-px bg-slate-200" />

          <div className="px-4 mb-2 flex items-center justify-between">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t('userDetail.moduleAccess')}</p>
            <button
              type="button"
              onClick={() => {
                const allOn = localModules.size === Object.keys(PERMISSION_STRUCTURE).length;
                if (allOn) {
                  setLocalModules(new Set());
                  if (selectedPanel !== 'account') setSelectedPanel('account');
                } else {
                  setLocalModules(new Set(Object.keys(PERMISSION_STRUCTURE)));
                }
              }}
              className="text-[9px] font-bold px-2 py-0.5 rounded border border-slate-200 hover:border-blue-400 hover:text-blue-700 text-slate-500 uppercase tracking-widest transition-colors"
            >
              {localModules.size === Object.keys(PERMISSION_STRUCTURE).length ? t('userDetail.none') : t('userDetail.all')}
            </button>
          </div>
          {Object.entries(PERMISSION_STRUCTURE).map(([modId, mod]) => {
            const enabled = localModules.has(modId);
            return (
              <div key={modId} className="flex items-center gap-2 px-3 py-1.5">
                <button
                  onClick={() => {
                    const next = new Set(localModules);
                    if (enabled) {
                      next.delete(modId);
                      if (selectedPanel === modId) setSelectedPanel('account');
                    } else {
                      next.add(modId);
                    }
                    setLocalModules(next);
                    if (!enabled) setSelectedPanel(modId);
                  }}
                  className={`w-8 h-4 rounded-full transition-colors shrink-0 ${enabled ? 'bg-blue-600' : 'bg-slate-300'}`}
                >
                  <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${enabled ? 'translate-x-2' : '-translate-x-1'}`} />
                </button>
                <button
                  onClick={() => { if (enabled) setSelectedPanel(modId); }}
                  className={`flex-1 text-left text-xs py-1 transition-colors ${
                    selectedPanel === modId ? 'text-blue-700 font-bold' : enabled ? 'text-slate-700 hover:text-slate-900' : 'text-slate-400'
                  }`}
                >
                  {mod.label}
                </button>
              </div>
            );
          })}
        </nav>

        {/* Right panel */}
        <main className="flex-1 overflow-y-auto p-8">
          {selectedPanel === 'account' ? (
            <div className="max-w-lg space-y-6">
              {/* Account Status */}
              <div className="bg-white border border-slate-200 rounded-xl p-6">
                <h3 className="text-sm font-bold text-slate-900 mb-1">{t('userDetail.accountStatus')}</h3>
                <p className="text-xs text-slate-500 mb-4">
                  {user.is_active
                    ? t('userDetail.accountActiveDesc')
                    : t('userDetail.accountInactiveDesc')}
                </p>
                <button
                  onClick={handleToggleActive}
                  disabled={deactivating}
                  className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-colors ${
                    user.is_active
                      ? confirmDeactivate
                        ? 'bg-red-600 hover:bg-red-500 text-white'
                        : 'bg-red-50 hover:bg-red-100 text-red-600 border border-red-200'
                      : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200'
                  }`}
                >
                  {deactivating ? <Loader2 size={13} className="animate-spin" /> : null}
                  {user.is_active
                    ? confirmDeactivate ? t('userDetail.confirmDeactivate') : t('userDetail.deactivateAccount')
                    : t('userDetail.reactivateAccount')}
                </button>
              </div>

              {/* Reset password */}
              {user.auth_user_id ? (
                <div className="bg-white border border-slate-200 rounded-xl p-6">
                  <div className="flex items-center gap-2 mb-1">
                    <KeyRound size={14} className="text-slate-500" />
                    <h3 className="text-sm font-bold text-slate-900">{t('userDetail.resetPassword')}</h3>
                  </div>
                  <p className="text-xs text-slate-500 mb-4">{t('userDetail.resetPasswordDesc')}</p>
                  <form onSubmit={handleResetPassword} className="space-y-3">
                    <div className="relative">
                      <input
                        type={showPw ? 'text' : 'password'}
                        value={newPassword}
                        onChange={e => setNewPassword(e.target.value)}
                        placeholder={t('userDetail.newPasswordPlaceholder')}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 pr-10 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                        {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      placeholder={t('userDetail.confirmPasswordPlaceholder')}
                      className={`w-full bg-slate-50 border rounded-lg px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:border-transparent ${
                        pwMismatch ? 'border-red-300 focus:ring-red-400' : 'border-slate-200 focus:ring-blue-500'
                      }`}
                    />
                    {pwMismatch && <p className="text-[11px] text-red-500">{t('userDetail.passwordsDoNotMatch')}</p>}
                    {resetMsg && (
                      <div className={`flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg ${
                        resetMsg.type === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                      }`}>
                        {resetMsg.type === 'ok' ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                        {resetMsg.text}
                      </div>
                    )}
                    <button
                      type="submit"
                      disabled={!pwCanSubmit || resetting}
                      className="flex items-center gap-1.5 px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg transition-colors"
                    >
                      {resetting ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}
                      {resetting ? t('userDetail.updating') : t('userDetail.updatePassword')}
                    </button>
                  </form>
                </div>
              ) : (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
                  <p className="text-xs text-slate-400">
                    {t('userDetail.noAuthAccount')}
                  </p>
                </div>
              )}
            </div>
          ) : selectedPanel === 'notifications' ? (
            <div className="max-w-3xl space-y-6">
              <div>
                <h3 className="text-base font-bold text-slate-900">{t('userDetail.notificationSettings')}</h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  {t('userDetail.notifIntro1')} <span className="font-semibold text-slate-700">{t('userDetail.receive')}</span> {t('userDetail.notifIntro2')} <span className="font-semibold text-slate-700">{t('userDetail.userSelfManage')}</span> {t('userDetail.notifIntro3')}
                </p>
              </div>
              {notifTypes.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
                  {t('userDetail.noNotificationTypes')}
                </div>
              ) : (
                Object.entries(groupByModule(notifTypes)).map(([moduleId, modTypes]) => (
                  <div key={moduleId} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div className="px-5 py-3 bg-slate-50 border-b border-slate-200">
                      <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                        {PERMISSION_STRUCTURE[moduleId]?.label ?? moduleId.toUpperCase()}
                      </p>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {modTypes.map(nt => {
                        const n = getNotif(nt.key);
                        return (
                          <div key={nt.key} className="px-5 py-4 flex items-start gap-4">
                            <div className="flex-1">
                              <p className="text-sm font-medium text-slate-800">{nt.label}</p>
                              {nt.description && (
                                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{nt.description}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-5 shrink-0 pt-0.5">
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={n.admin_enabled}
                                  onChange={() => setNotif(nt.key, { admin_enabled: !n.admin_enabled })}
                                  className="w-4 h-4 rounded accent-blue-600 cursor-pointer"
                                />
                                <span className="text-xs text-slate-600">{t('userDetail.receive')}</span>
                              </label>
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={n.user_overridable}
                                  onChange={() => setNotif(nt.key, { user_overridable: !n.user_overridable })}
                                  className="w-4 h-4 rounded accent-blue-600 cursor-pointer"
                                />
                                <span className="text-xs text-slate-600">{t('userDetail.userSelfManage')}</span>
                              </label>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : !moduleDef ? (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
              {t('userDetail.enableModuleHint')}
            </div>
          ) : (
            <div className="max-w-3xl space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-900">{t('userDetail.modulePermissions', { module: moduleDef.label })}</h3>
                <button
                  type="button"
                  onClick={() => toggleAllInScope(moduleKeys(selectedPanel))}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200 hover:border-blue-400 hover:text-blue-700 text-slate-700 transition-colors"
                >
                  {allKeysGranted(moduleKeys(selectedPanel)) ? t('userDetail.deselectAllInModule') : t('userDetail.selectAllInModule')}
                </button>
              </div>
              {Object.entries(moduleDef.resources).map(([resId, resDef]) => (
                <div key={resId} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">{resDef.label}</p>
                    <button
                      type="button"
                      onClick={() => toggleAllInScope(resourceKeys(selectedPanel, resId))}
                      className="text-[10px] font-bold px-2 py-0.5 rounded border border-slate-200 hover:border-blue-400 hover:text-blue-700 text-slate-500 uppercase tracking-wider transition-colors"
                    >
                      {allKeysGranted(resourceKeys(selectedPanel, resId)) ? t('userDetail.deselectAll') : t('userDetail.selectAll')}
                    </button>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {resDef.permissions.map(permDef => {
                      const checked = hasGrant(selectedPanel, resId, permDef.id);
                      const prereqMet = !permDef.prereq || hasGrant(selectedPanel, resId, permDef.prereq);
                      const limit = getLimit(selectedPanel, resId, permDef.id);
                      return (
                        <div key={permDef.id} className={`px-5 py-3 flex items-center gap-4 ${!prereqMet ? 'opacity-40' : ''}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!prereqMet}
                            onChange={() => toggleGrant(selectedPanel, resId, permDef.id, permDef.prereq)}
                            className="w-4 h-4 rounded accent-blue-600 cursor-pointer"
                          />
                          <div className="flex-1">
                            <span className="text-sm font-medium text-slate-800">{permDef.label}</span>
                            {permDef.prereq && (
                              <span className="ml-2 text-[10px] text-slate-400">{t('userDetail.requires', { prereq: permDef.prereq })}</span>
                            )}
                          </div>
                          {permDef.hasLimit && checked && (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-slate-500">{t('userDetail.approvalLimit')}</span>
                              <div className="relative">
                                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
                                <input
                                  type="number" min={0}
                                  value={limit ?? ''}
                                  onChange={e => setApprovalLimit(selectedPanel, resId, permDef.id, e.target.value)}
                                  placeholder={t('userDetail.unlimited')}
                                  className="w-32 pl-6 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

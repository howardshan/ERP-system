import React, { useEffect, useState } from 'react';
import { ArrowLeft, Save, Loader2, UserCircle, KeyRound, Eye, EyeOff, CheckCircle2, AlertCircle } from 'lucide-react';
import { getUser, getUsers, getUserPermissions, setPermission, setModuleAccess, updateUser, resetUserPassword } from '../../services/authApi';
import { PERMISSION_STRUCTURE } from '../../lib/permissionStructure';
import type { ErpUser, UserPermissionGrant } from '../../types/auth';

interface Props {
  userId: string;
  onBack: () => void;
}

type LeftPanel = 'profile' | string; // 'profile' or a module id

export default function UserDetail({ userId, onBack }: Props) {
  const [user, setUser] = useState<ErpUser | null>(null);
  const [allUsers, setAllUsers] = useState<ErpUser[]>([]);
  const [grants, setGrants] = useState<UserPermissionGrant[]>([]);
  const [selectedPanel, setSelectedPanel] = useState<LeftPanel>('profile');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Profile edits
  const [profileEdits, setProfileEdits] = useState<{ full_name: string; department: string; manager_id: string }>({
    full_name: '', department: '', manager_id: '',
  });
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

  useEffect(() => {
    Promise.all([getUser(userId), getUserPermissions(userId), getUsers()]).then(([u, g, all]) => {
      setUser(u);
      setGrants(g);
      setAllUsers(all.filter(a => a.id !== userId));
      setLocalModules(new Set(u.module_access ?? []));
      setProfileEdits({
        full_name: u.full_name ?? '',
        department: u.department ?? '',
        manager_id: u.manager_id ?? '',
      });
      setLoading(false);
    });
  }, [userId]);

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

  // ── Save ─────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      // Profile
      await updateUser(userId, {
        full_name: profileEdits.full_name || undefined,
        department: profileEdits.department || null,
        manager_id: profileEdits.manager_id || null,
      });
      // Module access
      await setModuleAccess(userId, [...localModules]);
      // Permission grants
      for (const [key, limit] of localGrants) {
        const [mod, res, perm] = key.split('|');
        await setPermission(userId, mod, res, perm, true, limit);
      }
      for (const key of removedGrants) {
        const [mod, res, perm] = key.split('|');
        await setPermission(userId, mod, res, perm, false);
      }
      const [u, g] = await Promise.all([getUser(userId), getUserPermissions(userId)]);
      setUser(u); setGrants(g);
      setLocalGrants(new Map()); setRemovedGrants(new Set());
      setLocalModules(new Set(u.module_access ?? []));
      setProfileEdits({ full_name: u.full_name ?? '', department: u.department ?? '', manager_id: u.manager_id ?? '' });
      setSaveMsg({ type: 'ok', text: 'Saved' });
      setTimeout(() => setSaveMsg(null), 2500);
    } catch (e: any) {
      setSaveMsg({ type: 'err', text: e?.message ?? 'Error' });
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
      setResetMsg({ type: 'ok', text: 'Password updated successfully.' });
    } catch (err: any) {
      setResetMsg({ type: 'err', text: err?.message ?? 'Failed' });
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

  const moduleDef = selectedPanel !== 'profile' ? PERMISSION_STRUCTURE[selectedPanel] : null;
  const pwMismatch = confirmPassword && newPassword !== confirmPassword;
  const pwCanSubmit = user.auth_user_id && newPassword.length >= 6 && newPassword === confirmPassword;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-8 py-4 bg-white border-b border-slate-200 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="text-slate-500 hover:text-slate-900 text-xs font-bold transition-colors flex items-center gap-1.5">
            <ArrowLeft size={14} /> All Users
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
              {user.is_active ? 'Active' : 'Inactive'}
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
            <Save size={13} /> {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar */}
        <nav className="w-56 bg-[#faf8f5] border-r border-slate-200 flex flex-col py-3 overflow-y-auto shrink-0">
          {/* Profile */}
          <button
            onClick={() => setSelectedPanel('profile')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-bold transition-colors ${
              selectedPanel === 'profile'
                ? 'text-blue-700 bg-blue-50 border-r-2 border-blue-600'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <UserCircle size={14} /> Profile
          </button>

          <div className="mx-4 my-2 h-px bg-slate-200" />

          <p className="px-4 mb-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Module Access</p>
          {Object.entries(PERMISSION_STRUCTURE).map(([modId, mod]) => {
            const enabled = localModules.has(modId);
            return (
              <div key={modId} className="flex items-center gap-2 px-3 py-1.5">
                <button
                  onClick={() => {
                    const next = new Set(localModules);
                    if (enabled) {
                      next.delete(modId);
                      if (selectedPanel === modId) setSelectedPanel('profile');
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
          {selectedPanel === 'profile' ? (
            <div className="max-w-lg space-y-6">
              {/* Profile fields */}
              <div className="bg-white border border-slate-200 rounded-xl p-6">
                <h3 className="text-sm font-bold text-slate-900 mb-4">Profile Information</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Full Name</label>
                    <input
                      value={profileEdits.full_name}
                      onChange={e => setProfileEdits(p => ({ ...p, full_name: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Email</label>
                    <input
                      value={user.email}
                      disabled
                      className="w-full bg-slate-100 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm text-slate-400 cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Department</label>
                    <input
                      value={profileEdits.department}
                      onChange={e => setProfileEdits(p => ({ ...p, department: e.target.value }))}
                      placeholder="e.g. Finance"
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Manager</label>
                    <select
                      value={profileEdits.manager_id}
                      onChange={e => setProfileEdits(p => ({ ...p, manager_id: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="">No manager</option>
                      {allUsers.map(u => (
                        <option key={u.id} value={u.id}>{u.full_name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Deactivate */}
              <div className="bg-white border border-slate-200 rounded-xl p-6">
                <h3 className="text-sm font-bold text-slate-900 mb-1">Account Status</h3>
                <p className="text-xs text-slate-500 mb-4">
                  {user.is_active
                    ? 'This account is active. Deactivating will prevent the user from logging in.'
                    : 'This account is inactive. Reactivating will restore login access.'}
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
                    ? confirmDeactivate ? 'Confirm Deactivate' : 'Deactivate Account'
                    : 'Reactivate Account'}
                </button>
              </div>

              {/* Reset password */}
              {user.auth_user_id ? (
                <div className="bg-white border border-slate-200 rounded-xl p-6">
                  <div className="flex items-center gap-2 mb-1">
                    <KeyRound size={14} className="text-slate-500" />
                    <h3 className="text-sm font-bold text-slate-900">Reset Password</h3>
                  </div>
                  <p className="text-xs text-slate-500 mb-4">Set a new password for this user. They will need to use this password on their next login.</p>
                  <form onSubmit={handleResetPassword} className="space-y-3">
                    <div className="relative">
                      <input
                        type={showPw ? 'text' : 'password'}
                        value={newPassword}
                        onChange={e => setNewPassword(e.target.value)}
                        placeholder="New password (min 6 chars)"
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
                      placeholder="Confirm new password"
                      className={`w-full bg-slate-50 border rounded-lg px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:border-transparent ${
                        pwMismatch ? 'border-red-300 focus:ring-red-400' : 'border-slate-200 focus:ring-blue-500'
                      }`}
                    />
                    {pwMismatch && <p className="text-[11px] text-red-500">Passwords do not match</p>}
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
                      {resetting ? 'Updating…' : 'Update Password'}
                    </button>
                  </form>
                </div>
              ) : (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
                  <p className="text-xs text-slate-400">
                    This user has no linked Supabase Auth account. Password reset is not available.
                  </p>
                </div>
              )}
            </div>
          ) : !moduleDef ? (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
              Enable a module on the left to configure permissions
            </div>
          ) : (
            <div className="max-w-3xl space-y-6">
              <h3 className="text-base font-bold text-slate-900">{moduleDef.label} Permissions</h3>
              {Object.entries(moduleDef.resources).map(([resId, resDef]) => (
                <div key={resId} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-5 py-3 bg-slate-50 border-b border-slate-200">
                    <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">{resDef.label}</p>
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
                              <span className="ml-2 text-[10px] text-slate-400">requires {permDef.prereq}</span>
                            )}
                          </div>
                          {permDef.hasLimit && checked && (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-slate-500">Approval limit</span>
                              <div className="relative">
                                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
                                <input
                                  type="number" min={0}
                                  value={limit ?? ''}
                                  onChange={e => setApprovalLimit(selectedPanel, resId, permDef.id, e.target.value)}
                                  placeholder="unlimited"
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

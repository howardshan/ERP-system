import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { getPermissionHolders, getUsers, setPermission } from '../../services/authApi';
import { PERMISSION_STRUCTURE } from '../../lib/permissionStructure';
import type { UserPermissionGrant, ErpUser } from '../../types/auth';
import { usePermissions } from '../../contexts/PermissionContext';
import { useModuleVisibility } from '../../contexts/ModuleVisibilityContext';

export default function PermissionBrowser() {
  const { t } = useTranslation('auth');
  const { can } = usePermissions();
  const { isVisible } = useModuleVisibility();
  const canManageRoles = can('auth', 'roles', 'manage');
  const [selectedModule, setSelectedModule] = useState('');
  const [selectedResource, setSelectedResource] = useState('');
  const [selectedPerm, setSelectedPerm] = useState('');
  const [holders, setHolders] = useState<UserPermissionGrant[]>([]);
  const [allUsers, setAllUsers] = useState<ErpUser[]>([]);
  const [loadingHolders, setLoadingHolders] = useState(false);
  const [showAddUser, setShowAddUser] = useState(false);
  const [addLimit, setAddLimit] = useState('');
  const [selectedAddUserId, setSelectedAddUserId] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => { getUsers().then(setAllUsers); }, []);

  async function loadHolders(mod: string, res: string, perm: string) {
    setLoadingHolders(true);
    setHolders(await getPermissionHolders(mod, res, perm).catch(() => []));
    setLoadingHolders(false);
  }

  function selectPerm(mod: string, res: string, perm: string) {
    setSelectedModule(mod); setSelectedResource(res); setSelectedPerm(perm);
    setShowAddUser(false); setSelectedAddUserId(''); setAddLimit('');
    loadHolders(mod, res, perm);
  }

  const permDef = selectedModule && selectedResource && selectedPerm
    ? PERMISSION_STRUCTURE[selectedModule]?.resources[selectedResource]?.permissions.find(p => p.id === selectedPerm)
    : null;

  // Users eligible to add: have the prereq permission, not already holders
  const holderIds = new Set(holders.map(h => h.user_id));
  const eligibleUsers = allUsers.filter(u => {
    if (holderIds.has(u.id)) return false;
    if (!permDef?.prereq) return true;
    // has the prereq permission for this module/resource
    return u.module_access?.includes(selectedModule); // simplified check
  });

  async function handleAddUser() {
    if (!selectedAddUserId || !selectedModule || !selectedResource || !selectedPerm) return;
    setAdding(true);
    const limit = addLimit ? parseFloat(addLimit) : null;
    await setPermission(selectedAddUserId, selectedModule, selectedResource, selectedPerm, true, limit);
    await loadHolders(selectedModule, selectedResource, selectedPerm);
    setShowAddUser(false); setSelectedAddUserId(''); setAddLimit('');
    setAdding(false);
  }

  async function handleRemove(grant: UserPermissionGrant) {
    await setPermission(grant.user_id, grant.module_id, grant.resource, grant.permission, false);
    await loadHolders(selectedModule, selectedResource, selectedPerm);
  }

  const [collapsedModules, setCollapsedModules] = useState<Set<string>>(new Set());
  const [collapsedResources, setCollapsedResources] = useState<Set<string>>(new Set());

  function toggleModule(modId: string) {
    setCollapsedModules(prev => {
      const next = new Set(prev);
      next.has(modId) ? next.delete(modId) : next.add(modId);
      return next;
    });
  }

  function toggleResource(key: string) {
    setCollapsedResources(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left: module tree */}
      <nav className="w-64 bg-[#faf8f5] border-r border-slate-200 overflow-y-auto py-3">
        <p className="px-4 mb-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t('permissionBrowser.modulesAndPermissions')}</p>
        {Object.entries(PERMISSION_STRUCTURE).filter(([modId]) => isVisible(modId)).map(([modId, mod]) => {
          const modCollapsed = collapsedModules.has(modId);
          return (
            <div key={modId} className="mb-1">
              <button
                onClick={() => toggleModule(modId)}
                className="w-full flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-bold text-slate-600 uppercase tracking-wider hover:bg-slate-100 transition-colors"
              >
                {modCollapsed ? <ChevronRight size={12} className="shrink-0" /> : <ChevronDown size={12} className="shrink-0" />}
                {mod.label}
              </button>
              {!modCollapsed && Object.entries(mod.resources).map(([resId, resDef]) => {
                const resKey = `${modId}:${resId}`;
                const resCollapsed = collapsedResources.has(resKey);
                return (
                  <div key={resId} className="ml-2">
                    <button
                      onClick={() => toggleResource(resKey)}
                      className="w-full flex items-center gap-1.5 px-3 py-1 text-[10px] text-slate-500 font-semibold hover:bg-slate-100 hover:text-slate-700 transition-colors"
                    >
                      {resCollapsed ? <ChevronRight size={10} className="shrink-0" /> : <ChevronDown size={10} className="shrink-0" />}
                      {resDef.label}
                    </button>
                    {!resCollapsed && resDef.permissions.map(p => {
                      const active = selectedModule === modId && selectedResource === resId && selectedPerm === p.id;
                      return (
                        <button
                          key={p.id}
                          onClick={() => selectPerm(modId, resId, p.id)}
                          className={`w-full text-left px-5 py-1.5 text-xs transition-colors ${
                            active ? 'bg-blue-50 text-blue-700 font-bold border-r-2 border-blue-600' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                          }`}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Right: permission holders */}
      <main className="flex-1 overflow-y-auto p-8">
        {!selectedPerm ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-slate-400">
            <p className="text-sm">{t('permissionBrowser.selectPermissionHint')}</p>
          </div>
        ) : (
          <div className="max-w-2xl">
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
                  {PERMISSION_STRUCTURE[selectedModule]?.label} · {PERMISSION_STRUCTURE[selectedModule]?.resources[selectedResource]?.label}
                </p>
                <h3 className="text-lg font-bold text-slate-900 mt-0.5">
                  {t('permissionBrowser.permissionTitle', { label: permDef?.label })}
                </h3>
                {permDef?.prereq && (
                  <p className="text-xs text-slate-400 mt-1">{t('permissionBrowser.prerequisite')}: <span className="font-semibold">{permDef.prereq}</span></p>
                )}
              </div>
              {canManageRoles && (
                <button
                  onClick={() => setShowAddUser(v => !v)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition-colors"
                >
                  <Plus size={13} /> {t('permissionBrowser.addUser')}
                </button>
              )}
            </div>

            {/* Add user panel */}
            {showAddUser && canManageRoles && (
              <div className="mb-5 p-4 bg-blue-50 border border-blue-200 rounded-xl flex items-end gap-3">
                <div className="flex-1">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">{t('permissionBrowser.user')}</label>
                  <select
                    value={selectedAddUserId}
                    onChange={e => setSelectedAddUserId(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">{t('permissionBrowser.selectUserPlaceholder')}</option>
                    {eligibleUsers.map(u => (
                      <option key={u.id} value={u.id}>{u.full_name} ({u.department ?? t('permissionBrowser.noDept')})</option>
                    ))}
                  </select>
                  {eligibleUsers.length === 0 && (
                    <p className="text-[10px] text-slate-400 mt-1">{t('permissionBrowser.noEligibleUsers')}</p>
                  )}
                </div>
                {permDef?.hasLimit && (
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">{t('permissionBrowser.approvalLimit')}</label>
                    <input
                      type="number" min={0} value={addLimit}
                      onChange={e => setAddLimit(e.target.value)}
                      placeholder={t('permissionBrowser.unlimitedPlaceholder')}
                      className="w-28 bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                )}
                <button
                  onClick={handleAddUser}
                  disabled={!selectedAddUserId || adding}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors"
                >
                  {adding ? t('permissionBrowser.adding') : t('permissionBrowser.confirm')}
                </button>
                <button onClick={() => setShowAddUser(false)} className="p-2 text-slate-400 hover:text-slate-700">
                  <X size={15} />
                </button>
              </div>
            )}

            {/* Holders table */}
            {loadingHolders ? (
              <div className="flex items-center gap-2 text-slate-400 py-8">
                <Loader2 size={16} className="animate-spin" /> {t('permissionBrowser.loading')}
              </div>
            ) : holders.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-sm bg-white border border-slate-200 rounded-xl">
                {t('permissionBrowser.noHolders')}
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-5 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">{t('permissionBrowser.name')}</th>
                      <th className="px-5 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">{t('permissionBrowser.department')}</th>
                      {permDef?.hasLimit && (
                        <th className="px-5 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">{t('permissionBrowser.limit')}</th>
                      )}
                      <th className="px-5 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">{t('permissionBrowser.granted')}</th>
                      <th className="px-3 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {holders.map(h => (
                      <tr key={h.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-5 py-3 font-medium text-slate-900">
                          {(h.user as any)?.full_name ?? h.user_id}
                        </td>
                        <td className="px-5 py-3 text-slate-500">
                          {(h.user as any)?.department ?? '—'}
                        </td>
                        {permDef?.hasLimit && (
                          <td className="px-5 py-3 text-slate-600 font-mono text-xs">
                            {h.approval_limit != null ? `$${h.approval_limit.toLocaleString()}` : t('permissionBrowser.unlimited')}
                          </td>
                        )}
                        <td className="px-5 py-3 text-slate-400 text-xs">
                          {new Date(h.granted_at).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-3">
                          {canManageRoles && (
                            <button
                              onClick={() => handleRemove(h)}
                              className="p-1 text-slate-300 hover:text-red-500 transition-colors"
                            >
                              <X size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

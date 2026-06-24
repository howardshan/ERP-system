import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Users, Shield, Loader2, CheckCircle2, UserPlus, History, Search, Filter, X } from 'lucide-react';
import { getUsers } from '../../services/authApi';
import { usePermissions } from '../../contexts/PermissionContext';
import { PERMISSION_STRUCTURE } from '../../lib/permissionStructure';
import type { ErpUser } from '../../types/auth';
import UserDetail from './UserDetail';
import PermissionBrowser from './PermissionBrowser';
import ITPanel from './ITPanel';
import UserAuditLog from './UserAuditLog';

interface Props {
  onHome: () => void;
}

type View = 'users' | 'permissions' | 'it' | 'audit';

export default function UserManagement({ onHome }: Props) {
  const { t } = useTranslation('auth');
  const { can } = usePermissions();
  const canCreateUser = can('auth', 'users', 'create');
  const canViewAudit = can('auth', 'audit_log', 'view');
  const [view, setView] = useState<View>('users');
  const [users, setUsers] = useState<ErpUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [moduleFilter, setModuleFilter] = useState('');

  async function load() {
    setLoading(true);
    setUsers(await getUsers().catch(() => []));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // Search (name / email / role / department) + status + module-access filters.
  const q = query.trim().toLowerCase();
  const filteredUsers = users.filter(u => {
    if (statusFilter === 'active' && !u.is_active) return false;
    if (statusFilter === 'inactive' && u.is_active) return false;
    if (moduleFilter && !(u.module_access ?? []).includes(moduleFilter)) return false;
    if (q) {
      const hay = [u.full_name, u.email, u.role, u.department].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const hasFilters = q !== '' || statusFilter !== 'all' || moduleFilter !== '';

  if (selectedUserId) {
    return (
      <div className="min-h-screen bg-[#faf8f5] flex flex-col">
        <div className="h-12 bg-white border-b border-slate-200 flex items-center px-5">
          <button onClick={onHome} className="text-slate-500 hover:text-slate-900 text-xs font-bold transition-colors">
            ← {t('userManagement.allModules')}
          </button>
        </div>
        <div className="flex-1 flex flex-col overflow-hidden">
          <UserDetail userId={selectedUserId} onBack={() => { setSelectedUserId(null); load(); }} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#faf8f5] flex flex-col">
      {/* Top bar */}
      <div className="h-12 bg-white border-b border-slate-200 flex items-center px-5 gap-3 shrink-0">
        <button onClick={onHome} className="text-slate-500 hover:text-slate-900 text-xs font-bold transition-colors flex items-center gap-1.5">
          <ArrowLeft size={14} /> {t('userManagement.allModules')}
        </button>
        <div className="w-px h-5 bg-slate-200" />
        <span className="text-sm font-bold text-slate-700">{t('userManagement.usersAndAuth')}</span>
      </div>

      {/* Page header */}
      <div className="px-10 pt-8 pb-5 flex items-end justify-between border-b border-slate-200 bg-white">
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{t('userManagement.administration')}</p>
          <h1 className="text-2xl font-bold text-slate-900">{t('userManagement.title')}</h1>
        </div>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => setView('users')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                view === 'users' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Users size={13} /> {t('userManagement.byUser')}
            </button>
            <button
              onClick={() => setView('permissions')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                view === 'permissions' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Shield size={13} /> {t('userManagement.byPermission')}
            </button>
            {canCreateUser && (
              <button
                onClick={() => setView('it')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                  view === 'it' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <UserPlus size={13} /> {t('userManagement.addUser')}
              </button>
            )}
            {canViewAudit && (
              <button
                onClick={() => setView('audit')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                  view === 'audit' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <History size={13} /> {t('userManagement.activityLog')}
              </button>
            )}
          </div>
        </div>
      </div>

      {view === 'audit' ? (
        <div className="flex-1 flex overflow-hidden">
          <UserAuditLog />
        </div>
      ) : view === 'it' ? (
        <div className="flex-1 flex overflow-hidden">
          <ITPanel />
        </div>
      ) : view === 'permissions' ? (
        <div className="flex-1 flex overflow-hidden">
          <PermissionBrowser />
        </div>
      ) : (
        <main className="flex-1 overflow-y-auto px-10 py-7">
          {/* Search + filters */}
          {!loading && users.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap mb-4">
              <div className="relative flex-1 min-w-[14rem] max-w-md">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="search"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder={t('userManagement.searchPlaceholder')}
                  className="w-full text-sm border border-slate-200 rounded-lg pl-9 pr-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 placeholder:text-slate-400"
                  spellCheck={false}
                />
              </div>
              <Filter size={14} className="text-slate-400 shrink-0" />
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
                className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700"
              >
                <option value="all">{t('userManagement.statusAll')}</option>
                <option value="active">{t('userManagement.active')}</option>
                <option value="inactive">{t('userManagement.inactive')}</option>
              </select>
              <select
                value={moduleFilter}
                onChange={e => setModuleFilter(e.target.value)}
                className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 max-w-[14rem]"
              >
                <option value="">{t('userManagement.moduleAll')}</option>
                {Object.entries(PERMISSION_STRUCTURE).map(([id, mod]) => (
                  <option key={id} value={id}>{mod.label}</option>
                ))}
              </select>
              {hasFilters && (
                <button
                  type="button"
                  onClick={() => { setQuery(''); setStatusFilter('all'); setModuleFilter(''); }}
                  className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-700 px-2 py-1.5"
                >
                  <X size={12} /> {t('userManagement.clearFilters')}
                </button>
              )}
              <span className="ml-auto text-xs text-slate-400">
                {t('userManagement.resultsCount', { shown: filteredUsers.length, total: users.length })}
              </span>
            </div>
          )}

          {/* User table */}
          {loading ? (
            <div className="flex items-center gap-2 text-slate-400 py-16 justify-center">
              <Loader2 size={18} className="animate-spin" /> {t('userManagement.loadingUsers')}
            </div>
          ) : users.length === 0 ? (
            <div className="py-20 text-center text-slate-400 text-sm">{t('userManagement.noUsers')}</div>
          ) : filteredUsers.length === 0 ? (
            <div className="py-20 text-center text-slate-400 text-sm">{t('userManagement.noMatches')}</div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    {[
                      { key: 'name', label: t('userManagement.colName') },
                      { key: 'role', label: t('userManagement.colRole') },
                      { key: 'department', label: t('userManagement.colDepartment') },
                      { key: 'manager', label: t('userManagement.colManager') },
                      { key: 'moduleAccess', label: t('userManagement.colModuleAccess') },
                      { key: 'status', label: t('userManagement.colStatus') },
                    ].map(h => (
                      <th key={h.key} className="px-5 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">{h.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredUsers.map(u => (
                    <tr
                      key={u.id}
                      onClick={() => setSelectedUserId(u.id)}
                      className="hover:bg-blue-50 cursor-pointer transition-colors"
                    >
                      <td className="px-5 py-3.5 font-semibold text-slate-900 text-sm">{u.full_name}</td>
                      <td className="px-5 py-3.5 text-slate-500 text-sm">{u.role ?? '—'}</td>
                      <td className="px-5 py-3.5 text-slate-500 text-sm">{u.department ?? '—'}</td>
                      <td className="px-5 py-3.5 text-slate-500 text-sm">{(u.manager as any)?.full_name ?? '—'}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex flex-wrap gap-1">
                          {(u.module_access ?? []).length === 0 ? (
                            <span className="text-slate-400 text-xs">{t('userManagement.none')}</span>
                          ) : (u.module_access ?? []).map(m => (
                            <span key={m} className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold rounded-full">
                              {PERMISSION_STRUCTURE[m]?.label.split(' ')[0] ?? m}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        {u.is_active ? (
                          <span className="flex items-center gap-1 text-emerald-600 text-xs font-bold">
                            <CheckCircle2 size={12} /> {t('userManagement.active')}
                          </span>
                        ) : (
                          <span className="text-slate-400 text-xs">{t('userManagement.inactive')}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>
      )}
    </div>
  );
}

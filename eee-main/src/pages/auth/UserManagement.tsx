import React, { useEffect, useState } from 'react';
import { ArrowLeft, Users, Shield, Loader2, CheckCircle2, MonitorCog } from 'lucide-react';
import { getUsers } from '../../services/authApi';
import { usePermissions } from '../../contexts/PermissionContext';
import { PERMISSION_STRUCTURE } from '../../lib/permissionStructure';
import type { ErpUser } from '../../types/auth';
import UserDetail from './UserDetail';
import PermissionBrowser from './PermissionBrowser';
import ITPanel from './ITPanel';

interface Props {
  onHome: () => void;
}

type View = 'users' | 'permissions' | 'it';

export default function UserManagement({ onHome }: Props) {
  const { can } = usePermissions();
  const [view, setView] = useState<View>('users');
  const [users, setUsers] = useState<ErpUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setUsers(await getUsers().catch(() => []));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  if (selectedUserId) {
    return (
      <div className="min-h-screen bg-[#faf8f5] flex flex-col">
        <div className="h-12 bg-white border-b border-slate-200 flex items-center px-5">
          <button onClick={onHome} className="text-slate-500 hover:text-slate-900 text-xs font-bold transition-colors">
            ← All Modules
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
          <ArrowLeft size={14} /> All Modules
        </button>
        <div className="w-px h-5 bg-slate-200" />
        <span className="text-sm font-bold text-slate-700">Users & Authentication</span>
      </div>

      {/* Page header */}
      <div className="px-10 pt-8 pb-5 flex items-end justify-between border-b border-slate-200 bg-white">
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Administration</p>
          <h1 className="text-2xl font-bold text-slate-900">User Management</h1>
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
              <Users size={13} /> By User
            </button>
            <button
              onClick={() => setView('permissions')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                view === 'permissions' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Shield size={13} /> By Permission
            </button>
            <button
              onClick={() => setView('it')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                view === 'it' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <MonitorCog size={13} /> IT
            </button>
          </div>
          {view === 'users' && can('auth', 'users', 'create') && (
            <button
              onClick={() => setView('it')}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition-colors"
            >
              <MonitorCog size={13} /> Add User (IT)
            </button>
          )}
        </div>
      </div>

      {view === 'it' ? (
        <div className="flex-1 flex overflow-hidden">
          <ITPanel />
        </div>
      ) : view === 'permissions' ? (
        <div className="flex-1 flex overflow-hidden">
          <PermissionBrowser />
        </div>
      ) : (
        <main className="flex-1 overflow-y-auto px-10 py-7">
          {/* User table */}
          {loading ? (
            <div className="flex items-center gap-2 text-slate-400 py-16 justify-center">
              <Loader2 size={18} className="animate-spin" /> Loading users…
            </div>
          ) : users.length === 0 ? (
            <div className="py-20 text-center text-slate-400 text-sm">No users yet. Add the first one above.</div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    {['Name', 'Email', 'Department', 'Manager', 'Module Access', 'Status'].map(h => (
                      <th key={h} className="px-5 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map(u => (
                    <tr
                      key={u.id}
                      onClick={() => setSelectedUserId(u.id)}
                      className="hover:bg-blue-50 cursor-pointer transition-colors"
                    >
                      <td className="px-5 py-3.5 font-semibold text-slate-900 text-sm">{u.full_name}</td>
                      <td className="px-5 py-3.5 text-slate-500 text-sm">{u.email}</td>
                      <td className="px-5 py-3.5 text-slate-500 text-sm">{u.department ?? '—'}</td>
                      <td className="px-5 py-3.5 text-slate-500 text-sm">{(u.manager as any)?.full_name ?? '—'}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex flex-wrap gap-1">
                          {(u.module_access ?? []).length === 0 ? (
                            <span className="text-slate-400 text-xs">None</span>
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
                            <CheckCircle2 size={12} /> Active
                          </span>
                        ) : (
                          <span className="text-slate-400 text-xs">Inactive</span>
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

import React, { useState } from 'react';
import { UserPlus, CheckCircle2, AlertCircle, Loader2, Eye, EyeOff, ShieldOff } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { usePermissions } from '../../contexts/PermissionContext';

interface CreateResult {
  type: 'success' | 'error';
  message: string;
}

export default function ITPanel() {
  const { can } = usePermissions();
  const canCreate = can('auth', 'users', 'create');

  const [form, setForm] = useState({ full_name: '', email: '', password: '', confirm: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<CreateResult | null>(null);

  function setField(key: string, value: string) {
    setForm(prev => ({ ...prev, [key]: value }));
    setResult(null);
  }

  const passwordMismatch = form.confirm && form.password !== form.confirm;
  const canSubmit = form.email && form.password && form.password === form.confirm && form.password.length >= 6 && !creating;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setCreating(true);
    setResult(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-auth-user`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            email: form.email,
            password: form.password,
            full_name: form.full_name || undefined,
          }),
        }
      );
      const json = await res.json();
      if (json.error) {
        setResult({ type: 'error', message: json.error });
      } else {
        setResult({ type: 'success', message: `Account created for ${form.email}. They can now sign in.` });
        setForm({ full_name: '', email: '', password: '', confirm: '' });
      }
    } catch (err) {
      setResult({ type: 'error', message: String(err) });
    }
    setCreating(false);
  }

  if (!canCreate) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
        <ShieldOff size={32} className="text-slate-300" />
        <p className="text-sm font-medium">You don't have permission to create users.</p>
        <p className="text-xs">Required: Users & Authentication → User Accounts → Create User</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-10">
      <div className="max-w-lg">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center">
              <UserPlus size={18} className="text-violet-600" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">IT Administration</p>
              <h2 className="text-lg font-bold text-slate-900">Create New Account</h2>
            </div>
          </div>
          <p className="text-sm text-slate-500 mt-3">
            New accounts can only be created here by an IT administrator. Users cannot self-register.
          </p>
        </div>

        {/* Form */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6">
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                Full Name
              </label>
              <input
                value={form.full_name}
                onChange={e => setField('full_name', e.target.value)}
                placeholder="Jane Smith"
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                Email Address <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                value={form.email}
                onChange={e => setField('email', e.target.value)}
                placeholder="jane@company.com"
                required
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                Password <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={e => setField('password', e.target.value)}
                  placeholder="Minimum 6 characters"
                  required
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 pr-10 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {form.password && form.password.length < 6 && (
                <p className="text-[11px] text-amber-600 mt-1">At least 6 characters required</p>
              )}
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                Confirm Password <span className="text-red-500">*</span>
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={form.confirm}
                onChange={e => setField('confirm', e.target.value)}
                placeholder="Re-enter password"
                required
                className={`w-full bg-slate-50 border rounded-lg px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:border-transparent transition ${
                  passwordMismatch ? 'border-red-300 focus:ring-red-400' : 'border-slate-200 focus:ring-violet-500'
                }`}
              />
              {passwordMismatch && (
                <p className="text-[11px] text-red-500 mt-1">Passwords do not match</p>
              )}
            </div>

            {/* Result banner */}
            {result && (
              <div className={`flex items-start gap-2.5 px-4 py-3 rounded-lg text-sm ${
                result.type === 'success'
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                  : 'bg-red-50 border border-red-200 text-red-700'
              }`}>
                {result.type === 'success'
                  ? <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
                  : <AlertCircle size={16} className="shrink-0 mt-0.5" />}
                <span>{result.message}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg transition-colors mt-2"
            >
              {creating
                ? <><Loader2 size={15} className="animate-spin" /> Creating Account…</>
                : <><UserPlus size={15} /> Create Account</>}
            </button>
          </form>
        </div>

        <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <p className="text-xs text-amber-700 font-medium">
            <strong>Note:</strong> After creating the account, go to the <strong>By User</strong> tab to assign module access and permissions to the new user.
          </p>
        </div>
      </div>
    </div>
  );
}

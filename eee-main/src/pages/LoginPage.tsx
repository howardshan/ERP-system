import React, { useState } from 'react';
import { BarChart3, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { logAuthAction } from '../services/authApi';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

export default function LoginPage() {
  const { t } = useTranslation('app');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
    } else if (data.user) {
      // login_success only — login_failed can't be logged (user isn't
      // authenticated at that point, RLS would reject the insert). M-153.
      void logAuthAction({
        action: 'login_success',
        target_auth_id: data.user.id,
        target_email: data.user.email ?? email,
        target_name: (data.user.user_metadata?.full_name as string) ?? data.user.email ?? email,
        description: 'Signed in',
      });
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-[#faf8f5] flex items-center justify-center">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-sm px-4">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8 gap-3">
          <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center shadow-md">
            <BarChart3 size={24} className="text-white" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">PetFood ERP</h1>
            <p className="text-slate-500 text-sm mt-0.5">{t('loginPage.subtitle')}</p>
          </div>
        </div>

        {/* Card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                {t('loginPage.email')}
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                autoFocus
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                {t('loginPage.password')}
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
              />
            </div>

            {error && (
              <div className="px-3.5 py-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 font-medium">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg transition-colors mt-2"
            >
              {loading ? <><Loader2 size={15} className="animate-spin" /> {t('loginPage.signingIn')}</> : t('loginPage.signIn')}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          {t('loginPage.contactAdmin')}
        </p>
      </div>
    </div>
  );
}

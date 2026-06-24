import React, { useEffect, useState } from 'react';
import { ShieldCheck, Loader2, LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { logAuthAction } from '../services/authApi';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

interface Props {
  userId: string;
  userName: string;
  userEmail: string;
  /** Called after the session is elevated to aal2 — App re-checks AAL. */
  onVerified: () => void;
  onSignOut: () => void;
}

type Mode = 'loading' | 'challenge' | 'enroll';

export default function MfaGate({ userId, userName, userEmail, onVerified, onSignOut }: Props) {
  const { t } = useTranslation('auth');
  const [mode, setMode] = useState<Mode>('loading');
  const [factorId, setFactorId] = useState('');
  const [qr, setQr] = useState('');        // enroll: QR code SVG data-URI
  const [secret, setSecret] = useState(''); // enroll: text secret for manual entry
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // On mount: a verified TOTP factor → challenge; otherwise → forced enrollment.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: listErr } = await supabase.auth.mfa.listFactors();
      if (cancelled) return;
      if (listErr) { setError(listErr.message); await startEnroll(); return; }
      const verified = data?.totp ?? [];
      if (verified.length > 0) {
        setFactorId(verified[0].id);
        setMode('challenge');
      } else {
        await startEnroll();
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startEnroll() {
    setError('');
    // Remove any stale, never-verified factors so enroll doesn't pile them up.
    const { data: list } = await supabase.auth.mfa.listFactors();
    for (const f of list?.all ?? []) {
      if (f.status !== 'verified') {
        await supabase.auth.mfa.unenroll({ factorId: f.id }).catch(() => {});
      }
    }
    const { data, error: enrollErr } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
    if (enrollErr || !data) { setError(enrollErr?.message ?? 'Enroll failed'); return; }
    setFactorId(data.id);
    setQr(data.totp.qr_code);
    setSecret(data.totp.secret);
    setMode('enroll');
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    const c = code.trim();
    if (c.length < 6 || busy || !factorId) return;
    setBusy(true);
    setError('');
    const { error: verifyErr } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: c });
    if (verifyErr) {
      setError(verifyErr.message);
      setCode('');
      setBusy(false);
      return;
    }
    if (mode === 'enroll') {
      void logAuthAction({
        action: 'mfa_enrolled',
        target_auth_id: userId,
        target_email: userEmail,
        target_name: userName,
        description: 'Enabled two-factor authentication',
      });
    }
    // Session is now aal2 — let App re-check and render the app.
    onVerified();
  }

  return (
    <div className="min-h-screen bg-[#faf8f5] flex items-center justify-center">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-sm px-4">
        <div className="flex flex-col items-center mb-8 gap-3">
          <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center shadow-md">
            <ShieldCheck size={24} className="text-white" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              {mode === 'enroll' ? t('mfaGate.enrollTitle') : t('mfaGate.challengeTitle')}
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              {mode === 'enroll' ? t('mfaGate.enrollSubtitle') : t('mfaGate.challengeSubtitle')}
            </p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
          {mode === 'loading' ? (
            <div className="flex items-center justify-center py-8 text-slate-400">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : (
            <>
              {mode === 'enroll' && (
                <div className="mb-5">
                  {qr ? (
                    <div className="flex flex-col items-center gap-3">
                      <img src={qr} alt="TOTP QR code" className="w-44 h-44 rounded-lg border border-slate-200 bg-white p-1" />
                      <div className="w-full text-center">
                        <p className="text-[11px] text-slate-500 mb-1">{t('mfaGate.manualEntry')}</p>
                        <code className="text-xs font-mono break-all bg-slate-50 border border-slate-200 rounded px-2 py-1 inline-block text-slate-700">
                          {secret}
                        </code>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-6 text-slate-400"><Loader2 size={18} className="animate-spin" /></div>
                  )}
                </div>
              )}

              <form onSubmit={handleVerify} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                    {t('mfaGate.codeLabel')}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    value={code}
                    onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                    placeholder="123456"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-center text-lg font-mono tracking-[0.3em] text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                  />
                </div>

                {error && (
                  <div className="px-3.5 py-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 font-medium">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy || code.trim().length < 6}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg transition-colors"
                >
                  {busy ? <><Loader2 size={15} className="animate-spin" /> {t('mfaGate.verifying')}</> : t('mfaGate.verify')}
                </button>
              </form>
            </>
          )}
        </div>

        <button
          onClick={onSignOut}
          className="mx-auto mt-6 flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors"
        >
          <LogOut size={13} /> {t('mfaGate.signOut')}
        </button>
      </div>
    </div>
  );
}

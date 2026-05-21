import { FormEvent, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api, saveAuth } from '../api/client';
import { ShellAccentProvider } from '../context/ShellAccentContext';
import { DemoBanner } from '../components/DemoBanner';
import { Alert, Button, Card, Field, Input } from '../components/ui';

const DEMO_ACCOUNTS = [
  { username: 'qc', password: 'demo123', label: 'QC Operator' },
  { username: 'manager', password: 'demo123', label: 'Quality Manager' },
] as const;

export function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('qc');
  const [password, setPassword] = useState('demo123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await api.login(username, password);
      saveAuth({
        token: res.access_token,
        role: res.role,
        username: res.username,
        displayName: res.display_name,
      });
      navigate(res.role === 'manager' ? '/admin' : '/qc');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ShellAccentProvider accent="admin">
      <div className="min-h-screen flex flex-col bg-slate-50">
        <DemoBanner />
        <div className="flex-1 flex items-center justify-center p-4">
          <Card variant="elevated" className="w-full max-w-md p-8 shadow-lg">
            <div className="flex flex-col items-center text-center mb-6">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-white mb-4">
                <ClipboardCheck className="h-8 w-8" aria-hidden />
              </div>
              <h1 className="text-2xl font-bold text-slate-900">QC Demo</h1>
              <p className="text-sm text-slate-600 mt-1">Post-dry inspection & batch trace</p>
            </div>

            <div className="flex flex-wrap gap-2 justify-center mb-6">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.username}
                  type="button"
                  onClick={() => {
                    setUsername(acc.username);
                    setPassword(acc.password);
                    setError('');
                  }}
                  className={cnChip(username === acc.username)}
                >
                  {acc.label}
                </button>
              ))}
            </div>

            <form onSubmit={submit} className="space-y-4">
              {error && <Alert variant="error">{error}</Alert>}
              <Field label="Username">
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                />
              </Field>
              <Field label="Password">
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </Field>
              <Button type="submit" variant="primary" tone="admin" fullWidth loading={loading} size="lg">
                Sign in
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </ShellAccentProvider>
  );
}

function cnChip(active: boolean) {
  return active
    ? 'text-xs font-medium px-3 py-1.5 rounded-full bg-indigo-600 text-white'
    : 'text-xs font-medium px-3 py-1.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200';
}

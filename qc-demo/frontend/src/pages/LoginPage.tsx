import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, saveAuth } from '../api/client';
import { DemoBanner } from '../components/DemoBanner';

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
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <DemoBanner />
      <div className="flex-1 flex items-center justify-center p-4">
        <form onSubmit={submit} className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-md space-y-4">
          <h1 className="text-2xl font-bold text-center">QC Demo 登录</h1>
          <p className="text-sm text-slate-500 text-center">qc / manager · 密码 demo123</p>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <label className="block">
            <span className="text-sm font-medium">用户名</span>
            <input
              className="mt-1 w-full border rounded-lg px-3 py-3 min-h-[44px]"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">密码</span>
            <input
              type="password"
              className="mt-1 w-full border rounded-lg px-3 py-3 min-h-[44px]"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl min-h-[48px] disabled:opacity-50"
          >
            {loading ? '登录中…' : '登录'}
          </button>
        </form>
      </div>
    </div>
  );
}

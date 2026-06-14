import React, { useEffect, useState } from 'react';
import { ShieldAlert, Eye, EyeOff, LogOut, Loader2, Check } from 'lucide-react';
import { ALL_MODULES, fetchHiddenModules, saveHiddenModules } from '../../lib/moduleVisibility';

// ─────────────────────────────────────────────────────────────────────────────
// 开发者超级面板,位于 /superuser。由一对硬编码账号守卫(不在用户表里)。
// 控制全站前端显示哪些模块(写入 app_module_visibility,经 RPC 校验密钥)。
//
// 注意:这是前端闸门,密码在打包产物里可见。它只控制模块的外观显隐,真正的
// 数据访问权限始终由服务端逐权限 RBAC 把关。请把它当开发工具,而非安全边界。
// ─────────────────────────────────────────────────────────────────────────────

const SUPERUSER_EMAIL = 'ysha@smu.edu';
const SUPERUSER_PASSWORD = 'Sa697296!';
const AUTH_KEY = 'erp_superuser_authed';

export function SuperuserApp() {
  const [authed, setAuthed] = useState(() => sessionStorage.getItem(AUTH_KEY) === '1');
  // 登录后把密码留在内存里——保存时 RPC 需要它作为密钥。
  const [secret, setSecret] = useState('');

  if (!authed) {
    return <SuperuserLogin onSuccess={(pw) => { setSecret(pw); setAuthed(true); sessionStorage.setItem(AUTH_KEY, '1'); }} />;
  }
  return <Dashboard secret={secret} onLogout={() => { sessionStorage.removeItem(AUTH_KEY); setAuthed(false); setSecret(''); }} />;
}

function SuperuserLogin({ onSuccess }: { onSuccess: (password: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim().toLowerCase() === SUPERUSER_EMAIL && password === SUPERUSER_PASSWORD) {
      onSuccess(password);
    } else {
      setError('账号或密码错误');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6 gap-2">
          <div className="w-12 h-12 rounded-2xl bg-rose-600 flex items-center justify-center shadow-lg">
            <ShieldAlert size={24} className="text-white" />
          </div>
          <h1 className="text-lg font-bold text-white">超级管理面板</h1>
          <p className="text-[11px] text-slate-400 uppercase tracking-widest font-bold">仅限开发者</p>
        </div>
        <form onSubmit={submit} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-3">
          <input
            type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="邮箱" autoFocus autoComplete="off"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500"
          />
          <input
            type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="密码" autoComplete="off"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500"
          />
          {error && <p className="text-xs text-rose-400 bg-rose-950/50 border border-rose-900 rounded px-3 py-2">{error}</p>}
          <button type="submit" className="w-full py-2.5 bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold rounded-lg transition-colors">
            进入
          </button>
        </form>
        <p className="text-center text-[11px] text-slate-600 mt-4">/superuser · ERP 开发者控制台</p>
      </div>
    </div>
  );
}

function Dashboard({ secret, onLogout }: { secret: string; onLogout: () => void }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetchHiddenModules().then(list => { setHidden(new Set(list)); setLoading(false); });
  }, []);

  const toggle = (id: string) => {
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setMsg('');
  };

  const save = async () => {
    setSaving(true); setMsg('');
    try {
      await saveHiddenModules([...hidden], secret);
      setMsg('✓ 已保存——其他用户刷新页面后全站生效。');
    } catch (e) {
      setMsg(`❌ 保存失败:${e instanceof Error ? e.message : String(e)}`);
    }
    setSaving(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between sticky top-0 bg-slate-950 z-10">
        <div className="flex items-center gap-2">
          <ShieldAlert size={18} className="text-rose-500" />
          <div>
            <h1 className="text-sm font-bold text-white">超级管理 · 模块显隐</h1>
            <p className="text-[11px] text-slate-500">控制全站显示哪些模块(以及对应的权限开关)。</p>
          </div>
        </div>
        <button onClick={onLogout} className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-white px-3 py-1.5 rounded-lg hover:bg-slate-800">
          <LogOut size={14} /> 退出
        </button>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8">
        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 text-sm"><Loader2 size={16} className="animate-spin" /> 加载中…</div>
        ) : (
          <>
            <ul className="space-y-2">
              {ALL_MODULES.map(m => {
                const visible = !hidden.has(m.id);
                return (
                  <li key={m.id} className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
                    <div>
                      <p className="text-sm font-bold text-white">{m.label}</p>
                      <p className="text-[11px] text-slate-500 font-mono">{m.id}</p>
                    </div>
                    <button
                      onClick={() => toggle(m.id)}
                      className={
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ' +
                        (visible ? 'bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30' : 'bg-slate-800 text-slate-500 hover:bg-slate-700')
                      }
                    >
                      {visible ? <Eye size={14} /> : <EyeOff size={14} />}
                      {visible ? '显示' : '隐藏'}
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={save}
                disabled={saving}
                className="flex items-center gap-1.5 px-5 py-2.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg transition-colors"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                {saving ? '保存中…' : '保存'}
              </button>
              {msg && <span className={'text-xs font-medium ' + (msg.startsWith('❌') ? 'text-rose-400' : 'text-emerald-400')}>{msg}</span>}
            </div>
            <p className="mt-4 text-[11px] text-slate-600 leading-relaxed">
              被隐藏的模块会从首页入口消失、无法直接导航进入,其权限开关也会从用户权限页移除。真正的数据访问仍由服务端 RBAC 控制。
            </p>
          </>
        )}
      </main>
    </div>
  );
}

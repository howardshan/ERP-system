import React, { useEffect, useRef, useState } from 'react';
import { Printer, Search, Check, X, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { getSavedPrinter, savePrinter, clearPrinter } from '../lib/printerConfig';

export function PrinterSettingsPopover() {
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  const [open, setOpen]         = useState(false);
  const [saved, setSaved]       = useState<string | null>(() => getSavedPrinter());
  const [printers, setPrinters] = useState<string[]>([]);
  const [manual, setManual]     = useState('');
  const [busy, setBusy]         = useState(false);
  const [msg, setMsg]           = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3000); };

  const search = async () => {
    if (!isTauri) { flash('需要桌面应用'); return; }
    setBusy(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const list = await invoke<string[]>('list_printers');
      setPrinters(list);
      if (list.length === 0) flash('未找到打印机，请检查 CUPS 是否已安装');
      else flash(`找到 ${list.length} 台打印机`);
    } catch (e) {
      flash(`搜索失败: ${e instanceof Error ? e.message : String(e)}`);
    }
    setBusy(false);
  };

  const select = (name: string) => {
    savePrinter(name);
    setSaved(name);
    flash('已保存 ✓');
  };

  const saveManual = () => {
    const v = manual.trim();
    if (!v) return;
    savePrinter(v);
    setSaved(v);
    setManual('');
    flash('已保存 ✓');
  };

  const clear = () => {
    clearPrinter();
    setSaved(null);
    setPrinters([]);
    flash('已清除');
  };

  return (
    <div className="relative" ref={ref}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title="标签打印机设置"
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
          saved
            ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
            : 'text-amber-600 bg-amber-50 hover:bg-amber-100',
        )}
      >
        <Printer size={14} />
        <span className="hidden sm:inline font-mono max-w-[160px] truncate">
          {saved ?? '未设置打印机'}
        </span>
        <ChevronDown size={11} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {/* Popover */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-slate-700">标签打印机</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-slate-400 hover:text-slate-600"
            >
              <X size={13} />
            </button>
          </div>

          {/* Current printer */}
          <div className={cn(
            'rounded-lg border px-3 py-2 text-xs font-mono mb-3',
            saved
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-slate-50 border-slate-200 text-slate-400 italic',
          )}>
            {saved ?? '尚未配置'}
          </div>

          {/* Search button */}
          {isTauri && (
            <button
              type="button"
              onClick={search}
              disabled={busy}
              className="w-full mb-2 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium disabled:opacity-50"
            >
              <Search size={12} />
              {busy ? '搜索中…' : '搜索 CUPS 打印机'}
            </button>
          )}

          {/* Printer list */}
          {printers.length > 0 && (
            <div className="mb-3 rounded-lg border border-slate-200 overflow-hidden">
              {printers.map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => select(p)}
                  className={cn(
                    'w-full flex items-center justify-between px-3 py-2 text-xs font-mono text-left transition-colors',
                    saved === p
                      ? 'bg-emerald-50 text-emerald-800'
                      : 'hover:bg-slate-50 text-slate-700',
                    'border-b border-slate-100 last:border-0',
                  )}
                >
                  <span className="truncate">{p}</span>
                  {saved === p && <Check size={12} className="text-emerald-600 shrink-0 ml-2" />}
                </button>
              ))}
            </div>
          )}

          {/* Manual entry */}
          <div className="flex gap-1.5 mb-2">
            <input
              type="text"
              value={manual}
              onChange={e => setManual(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveManual()}
              placeholder="手动输入队列名…"
              className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-blue-400"
            />
            <button
              type="button"
              onClick={saveManual}
              disabled={!manual.trim()}
              className="px-2.5 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-xs disabled:opacity-40"
            >
              保存
            </button>
          </div>

          {/* Clear */}
          {saved && (
            <button
              type="button"
              onClick={clear}
              className="text-[11px] text-slate-400 hover:text-red-500 transition-colors"
            >
              清除已保存的打印机
            </button>
          )}

          {/* Feedback */}
          {msg && (
            <p className="mt-2 text-[11px] text-slate-500 bg-slate-50 rounded px-2 py-1">{msg}</p>
          )}
        </div>
      )}
    </div>
  );
}

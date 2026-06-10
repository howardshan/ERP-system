import React, { useEffect, useRef, useState } from 'react';
import { Printer, Search, Check, X, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { getSavedPrinter, savePrinter, clearPrinter, getSavedDpi, saveDpi, LABEL_DPIS, LabelDpi } from '../lib/printerConfig';

const PRINT_BRIDGE = 'http://127.0.0.1:6543';

// Installer bundles are served from the website (public/print-bridge/).
function osBridgeDownload(): { href: string; label: string } | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;
  if (/Win/i.test(ua)) return { href: '/print-bridge/erp-print-bridge-windows.zip', label: '下载 Windows 打印助手' };
  if (/Mac/i.test(ua)) return { href: '/print-bridge/erp-print-bridge-macos.zip',   label: '下载 macOS 打印助手' };
  return null;
}

function osKind(): 'win' | 'mac' | 'other' {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;
  if (/Win/i.test(ua)) return 'win';
  if (/Mac/i.test(ua)) return 'mac';
  return 'other';
}

/** Collapsible "如何安装？" step-by-step guide, tailored to the visitor's OS. */
function InstallGuide() {
  const [show, setShow] = useState(false);
  const os = osKind();
  const installerName = os === 'win' ? 'install-windows.bat' : 'install-macos.command';
  const warn = os === 'win'
    ? 'SmartScreen 提示时点「更多信息」→「仍要运行」'
    : '若提示「无法验证开发者」：右键点该文件 →「打开」→ 再点「打开」';
  const settingsPath = os === 'win' ? '设置 - 打印机和扫描仪' : '系统设置 - 打印机与扫描仪';
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setShow(v => !v)}
        className="flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:underline"
      >
        <ChevronDown size={11} className={cn('transition-transform', !show && '-rotate-90')} />
        如何安装？
      </button>
      {show && (
        <ol className="mt-1.5 pl-4 list-decimal space-y-1 text-[11px] text-slate-600 leading-relaxed">
          <li>点上方下载链接，<b>解压</b>下载的压缩包</li>
          <li>双击 <code className="font-mono bg-slate-100 px-1 rounded">{installerName}</code>（{warn}）</li>
          <li>到「{settingsPath}」把标签机默认纸张设为 <b>4×3 英寸</b></li>
          <li>回到本窗口点「搜索打印机」，选中本机打印机</li>
          <li>完成 ✓ 之后打印即<b>静默出纸</b>，无需对话框</li>
        </ol>
      )}
    </div>
  );
}

/** "还没装打印助手？下载…" hint shown under the bridge search button. */
function BridgeDownloadHint() {
  const dl = osBridgeDownload();
  return (
    <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">
      还没装打印助手？{dl ? (
        <a href={dl.href} download className="text-blue-600 hover:underline font-medium">{dl.label}</a>
      ) : (
        <>下载 <a href="/print-bridge/erp-print-bridge-macos.zip" download className="text-blue-600 hover:underline">macOS</a>
        {' / '}<a href="/print-bridge/erp-print-bridge-windows.zip" download className="text-blue-600 hover:underline">Windows</a></>
      )}，双击安装后即可静默打印。
    </p>
  );
}

function fetchBridge(url: string, timeoutMs: number): Promise<Response> {
  if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
    return fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  }
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(id));
}

export function PrinterSettingsPopover() {
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  const [open, setOpen]         = useState(false);
  const [saved, setSaved]       = useState<string | null>(() => getSavedPrinter());
  const [dpi, setDpi]           = useState<LabelDpi>(() => getSavedDpi());
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

  // Tauri: search CUPS printers via Rust
  const searchTauri = async () => {
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

  // Browser: list printers via the local print bridge (打印助手)
  const searchBridge = async () => {
    setBusy(true);
    try {
      const r = await fetchBridge(`${PRINT_BRIDGE}/printers`, 2000);
      if (!r.ok) throw new Error('打印助手未运行');
      const data = await r.json() as string[] | { printers?: string[] };
      const list = Array.isArray(data) ? data : (data.printers ?? []);
      setPrinters(list);
      if (list.length === 0) flash('未找到打印机，请检查系统打印队列');
      else flash(`找到 ${list.length} 台打印机`);
    } catch (e) {
      flash(`搜索失败: ${e instanceof Error ? e.message : String(e)}。请先安装打印助手（见下方下载链接）`);
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

  const selectDpi = (d: LabelDpi) => {
    saveDpi(d);
    setDpi(d);
    flash(`分辨率 ${d} dpi ✓`);
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
            <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600">
              <X size={13} />
            </button>
          </div>

          {/* Currently saved printer */}
          <div className={cn(
            'rounded-lg border px-3 py-2 text-xs font-mono mb-3',
            saved
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-slate-50 border-slate-200 text-slate-400 italic',
          )}>
            {saved ?? '尚未配置'}
          </div>

          <button
            type="button"
            onClick={isTauri ? searchTauri : searchBridge}
            disabled={busy}
            className="w-full mb-2 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium disabled:opacity-50"
          >
            <Search size={12} />
            {busy ? '搜索中…' : '搜索打印机'}
          </button>

          {!isTauri && (
            <>
              <BridgeDownloadHint />
              <InstallGuide />
            </>
          )}

          {printers.length > 0 && (
            <div className="my-3 rounded-lg border border-slate-200 overflow-hidden max-h-40 overflow-y-auto">
              {printers.map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => select(p)}
                  className={cn(
                    'w-full flex items-center justify-between px-3 py-2 text-xs font-mono text-left transition-colors',
                    saved === p ? 'bg-emerald-50 text-emerald-800' : 'hover:bg-slate-50 text-slate-700',
                    'border-b border-slate-100 last:border-0',
                  )}
                >
                  <span className="truncate">{p}</span>
                  {saved === p && <Check size={12} className="text-emerald-600 shrink-0 ml-2" />}
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-1.5 mb-2 mt-3">
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

          {/* Printer resolution (per machine) */}
          <div className="mt-3 pt-3 border-t border-slate-100">
            <p className="text-[11px] font-bold text-slate-600 mb-1.5">
              打印机分辨率 (dpi)
            </p>
            <div className="flex gap-1.5">
              {LABEL_DPIS.map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => selectDpi(d)}
                  className={cn(
                    'flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                    dpi === d
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50',
                  )}
                >
                  {d}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-slate-400 leading-relaxed">
              选成跟这台打印机一致的分辨率，标签最锐（多数热敏机 203，部分 300/600）。
            </p>
          </div>

          {saved && (
            <button
              type="button"
              onClick={clear}
              className="mt-3 text-[11px] text-slate-400 hover:text-red-500 transition-colors"
            >
              清除已保存的打印机
            </button>
          )}

          {msg && (
            <p className="mt-2 text-[11px] text-slate-500 bg-slate-50 rounded px-2 py-1">{msg}</p>
          )}
        </div>
      )}
    </div>
  );
}

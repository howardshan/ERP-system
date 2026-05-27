import React, { useEffect, useRef, useState } from 'react';
import { Printer, Search, Check, X, ChevronDown, Usb } from 'lucide-react';
import { cn } from '../lib/utils';
import { getSavedPrinter, savePrinter, clearPrinter } from '../lib/printerConfig';
import { isWebUsbSupported, openUsbPrinter } from '../lib/usbPrint';

const PRINT_BRIDGE = 'http://127.0.0.1:6543';

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
  const isWebUsb = !isTauri && isWebUsbSupported();
  const isBrowserCups = !isTauri && !isWebUsb;

  const [open, setOpen]         = useState(false);
  const [saved, setSaved]       = useState<string | null>(() => getSavedPrinter());
  const [printers, setPrinters] = useState<string[]>([]);
  const [usbDevice, setUsbDevice] = useState<string | null>(null);
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

  // Check for already-authorised USB device on open
  useEffect(() => {
    if (!open || !isWebUsb) return;
    navigator.usb.getDevices().then(devices => {
      const printer = devices.find(d =>
        d.configurations.some(c =>
          c.interfaces.some(i => i.alternates.some(a => a.interfaceClass === 7)),
        ),
      );
      setUsbDevice(printer ? `${printer.manufacturerName ?? ''} ${printer.productName ?? ''}`.trim() : null);
    });
  }, [open, isWebUsb]);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3000); };

  // WebUSB: prompt device picker
  const connectUsb = async () => {
    setBusy(true);
    try {
      const device = await openUsbPrinter();
      const name = `${device.manufacturerName ?? ''} ${device.productName ?? ''}`.trim() || 'USB 打印机';
      setUsbDevice(name);
      flash(`已连接: ${name} ✓`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('No device selected') && !msg.includes('cancelled')) {
        flash(`连接失败: ${msg}`);
      }
    }
    setBusy(false);
  };

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

  // Browser: list CUPS queues via local print bridge
  const searchBridge = async () => {
    setBusy(true);
    try {
      const r = await fetchBridge(`${PRINT_BRIDGE}/printers`, 2000);
      if (!r.ok) throw new Error('print bridge 未运行');
      const data = await r.json() as string[] | { printers?: string[] };
      const list = Array.isArray(data) ? data : (data.printers ?? []);
      setPrinters(list);
      if (list.length === 0) flash('未找到打印机，请检查 CUPS 队列');
      else flash(`找到 ${list.length} 台打印机`);
    } catch (e) {
      flash(`搜索失败: ${e instanceof Error ? e.message : String(e)}。请先运行 python3 print_server.py`);
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
          (isWebUsb ? (saved || usbDevice) : saved)
            ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
            : 'text-amber-600 bg-amber-50 hover:bg-amber-100',
        )}
      >
        {isWebUsb ? <Usb size={14} /> : <Printer size={14} />}
        <span className="hidden sm:inline font-mono max-w-[160px] truncate">
          {isWebUsb
            ? (saved ?? usbDevice ?? '未设置打印机')
            : (saved ?? '未设置打印机')}
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

          {/* ── WebUSB mode ── */}
          {isWebUsb ? (
            <>
              <div className={cn(
                'rounded-lg border px-3 py-2 text-xs font-mono mb-3',
                usbDevice
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-slate-50 border-slate-200 text-slate-400 italic',
              )}>
                {usbDevice ?? '尚未授权 USB 设备'}
              </div>
              <button
                type="button"
                onClick={connectUsb}
                disabled={busy}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium disabled:opacity-50"
              >
                <Usb size={12} />
                {busy ? '连接中…' : (usbDevice ? '重新选择 USB 打印机' : '连接 USB 打印机')}
              </button>
              <p className="mt-2 text-[11px] text-slate-400 leading-relaxed">
                点击打印时浏览器会记住已授权设备，无需每次重新选择。仅支持 Chrome / Edge。
              </p>

              <div className="mt-4 pt-3 border-t border-slate-100">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                  CUPS（Mac + print bridge）
                </p>
                <div className={cn(
                  'rounded-lg border px-3 py-2 text-xs font-mono mb-2',
                  saved
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-slate-50 border-slate-200 text-slate-400 italic',
                )}>
                  {saved ?? '未设置队列名'}
                </div>
                <button
                  type="button"
                  onClick={searchBridge}
                  disabled={busy}
                  className="w-full mb-2 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-xs font-medium disabled:opacity-50"
                >
                  <Search size={12} />
                  {busy ? '搜索中…' : '搜索 CUPS 打印机'}
                </button>
                {printers.length > 0 && (
                  <div className="mb-2 rounded-lg border border-slate-200 overflow-hidden max-h-32 overflow-y-auto">
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
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={manual}
                    onChange={e => setManual(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && saveManual()}
                    placeholder="Gprinter_GP_1324D"
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
              </div>
            </>
          ) : (
            <>
              {/* ── Tauri / CUPS mode ── */}
              <div className={cn(
                'rounded-lg border px-3 py-2 text-xs font-mono mb-3',
                saved
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-slate-50 border-slate-200 text-slate-400 italic',
              )}>
                {saved ?? '尚未配置'}
              </div>

              {(isTauri || isBrowserCups) && (
                <button
                  type="button"
                  onClick={isTauri ? searchTauri : searchBridge}
                  disabled={busy}
                  className="w-full mb-2 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium disabled:opacity-50"
                >
                  <Search size={12} />
                  {busy ? '搜索中…' : (isBrowserCups ? '搜索 CUPS 打印机 (bridge)' : '搜索 CUPS 打印机')}
                </button>
              )}

              {printers.length > 0 && (
                <div className="mb-3 rounded-lg border border-slate-200 overflow-hidden">
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

              {saved && (
                <button
                  type="button"
                  onClick={clear}
                  className="text-[11px] text-slate-400 hover:text-red-500 transition-colors"
                >
                  清除已保存的打印机
                </button>
              )}
            </>
          )}

          {msg && (
            <p className="mt-2 text-[11px] text-slate-500 bg-slate-50 rounded px-2 py-1">{msg}</p>
          )}
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer, Search, Check, X, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { getSavedPrinter, savePrinter, clearPrinter, getSavedDpi, saveDpi, LABEL_DPIS, LabelDpi } from '../lib/printerConfig';

const PRINT_BRIDGE = 'http://127.0.0.1:6543';

// Installer bundles are served from the website (public/print-bridge/).
function osBridgeDownload(): { href: string; labelKey: string } | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;
  if (/Win/i.test(ua)) return { href: '/print-bridge/erp-print-bridge-windows.zip', labelKey: 'printerSettingsPopover.downloadWindows' };
  if (/Mac/i.test(ua)) return { href: '/print-bridge/erp-print-bridge-macos.zip',   labelKey: 'printerSettingsPopover.downloadMacos' };
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
  const { t } = useTranslation('ui');
  const [show, setShow] = useState(false);
  const os = osKind();
  const installerName = os === 'win' ? 'install-windows.bat' : 'install-macos.command';
  const warn = os === 'win'
    ? t('printerSettingsPopover.warnWin')
    : t('printerSettingsPopover.warnMac');
  const settingsPath = os === 'win' ? t('printerSettingsPopover.settingsPathWin') : t('printerSettingsPopover.settingsPathMac');
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setShow(v => !v)}
        className="flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:underline"
      >
        <ChevronDown size={11} className={cn('transition-transform', !show && '-rotate-90')} />
        {t('printerSettingsPopover.howToInstall')}
      </button>
      {show && (
        <ol className="mt-1.5 pl-4 list-decimal space-y-1 text-[11px] text-slate-600 leading-relaxed">
          <li>{t('printerSettingsPopover.step1Prefix')}<b>{t('printerSettingsPopover.step1Bold')}</b>{t('printerSettingsPopover.step1Suffix')}</li>
          <li>{t('printerSettingsPopover.step2Prefix')}<code className="font-mono bg-slate-100 px-1 rounded">{installerName}</code>{t('printerSettingsPopover.step2Open')}{warn}{t('printerSettingsPopover.step2Close')}</li>
          <li>{t('printerSettingsPopover.step3Prefix', { path: settingsPath })}<b>{t('printerSettingsPopover.step3Bold')}</b></li>
          <li>{t('printerSettingsPopover.step4')}</li>
          <li>{t('printerSettingsPopover.step5Prefix')}<b>{t('printerSettingsPopover.step5Bold')}</b>{t('printerSettingsPopover.step5Suffix')}</li>
        </ol>
      )}
    </div>
  );
}

/** "还没装打印助手？下载…" hint shown under the bridge search button. */
function BridgeDownloadHint() {
  const { t } = useTranslation('ui');
  const dl = osBridgeDownload();
  return (
    <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">
      {t('printerSettingsPopover.notInstalledYet')}{dl ? (
        <a href={dl.href} download className="text-blue-600 hover:underline font-medium">{t(dl.labelKey)}</a>
      ) : (
        <>{t('printerSettingsPopover.downloadPrefix')}<a href="/print-bridge/erp-print-bridge-macos.zip" download className="text-blue-600 hover:underline">macOS</a>
        {' / '}<a href="/print-bridge/erp-print-bridge-windows.zip" download className="text-blue-600 hover:underline">Windows</a></>
      )}{t('printerSettingsPopover.installHintSuffix')}
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
  const { t } = useTranslation('ui');
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
      if (list.length === 0) flash(t('printerSettingsPopover.noPrintersCups'));
      else flash(t('printerSettingsPopover.foundPrinters', { count: list.length }));
    } catch (e) {
      flash(t('printerSettingsPopover.searchFailed', { error: e instanceof Error ? e.message : String(e) }));
    }
    setBusy(false);
  };

  // Browser: list printers via the local print bridge (打印助手)
  const searchBridge = async () => {
    setBusy(true);
    try {
      // 8s, not 2s: /printers shells out to `Get-Printer` (PowerShell), whose
      // cold start can take several seconds on the first call after boot.
      const r = await fetchBridge(`${PRINT_BRIDGE}/printers`, 8000);
      if (!r.ok) throw new Error(t('printerSettingsPopover.bridgeNotRunning'));
      const data = await r.json() as string[] | { printers?: string[] };
      const list = Array.isArray(data) ? data : (data.printers ?? []);
      setPrinters(list);
      if (list.length === 0) flash(t('printerSettingsPopover.noPrintersQueue'));
      else flash(t('printerSettingsPopover.foundPrinters', { count: list.length }));
    } catch (e) {
      flash(t('printerSettingsPopover.searchFailedBridge', { error: e instanceof Error ? e.message : String(e) }));
    }
    setBusy(false);
  };

  const select = (name: string) => {
    savePrinter(name);
    setSaved(name);
    flash(t('printerSettingsPopover.saved'));
  };

  const saveManual = () => {
    const v = manual.trim();
    if (!v) return;
    savePrinter(v);
    setSaved(v);
    setManual('');
    flash(t('printerSettingsPopover.saved'));
  };

  const clear = () => {
    clearPrinter();
    setSaved(null);
    setPrinters([]);
    flash(t('printerSettingsPopover.cleared'));
  };

  const selectDpi = (d: LabelDpi) => {
    saveDpi(d);
    setDpi(d);
    flash(t('printerSettingsPopover.dpiSet', { dpi: d }));
  };

  return (
    <div className="relative" ref={ref}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title={t('printerSettingsPopover.triggerTitle')}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
          saved
            ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
            : 'text-amber-600 bg-amber-50 hover:bg-amber-100',
        )}
      >
        <Printer size={14} />
        <span className="hidden sm:inline font-mono max-w-[160px] truncate">
          {saved ?? t('printerSettingsPopover.noPrinterSet')}
        </span>
        <ChevronDown size={11} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {/* Popover */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-slate-700">{t('printerSettingsPopover.title')}</p>
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
            {saved ?? t('printerSettingsPopover.notConfigured')}
          </div>

          <button
            type="button"
            onClick={isTauri ? searchTauri : searchBridge}
            disabled={busy}
            className="w-full mb-2 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium disabled:opacity-50"
          >
            <Search size={12} />
            {busy ? t('printerSettingsPopover.searching') : t('printerSettingsPopover.searchPrinter')}
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
              placeholder={t('printerSettingsPopover.manualPlaceholder')}
              className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-blue-400"
            />
            <button
              type="button"
              onClick={saveManual}
              disabled={!manual.trim()}
              className="px-2.5 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-xs disabled:opacity-40"
            >
              {t('printerSettingsPopover.save')}
            </button>
          </div>

          {/* Printer resolution (per machine) */}
          <div className="mt-3 pt-3 border-t border-slate-100">
            <p className="text-[11px] font-bold text-slate-600 mb-1.5">
              {t('printerSettingsPopover.resolutionLabel')}
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
              {t('printerSettingsPopover.resolutionHint')}
            </p>
          </div>

          {saved && (
            <button
              type="button"
              onClick={clear}
              className="mt-3 text-[11px] text-slate-400 hover:text-red-500 transition-colors"
            >
              {t('printerSettingsPopover.clearSaved')}
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

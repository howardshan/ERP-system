import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import JsBarcode from 'jsbarcode';
import { SubLot } from '../../../services/qcApi';
import { getSavedPrinter } from '../../../lib/printerConfig';
import { isWebUsbSupported, openUsbPrinter, printCanvasUsb, testPrintUsb } from '../../../lib/usbPrint';

interface Props {
  carts: SubLot[];
  workOrderBarcode: string;
  skuCode: string | null;
  skuName: string;
  onClose: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Physical label: 4 × 6 inch (w4h6).  The GP-1324D feeds labels portrait
// (short side across the print head).  Our sticker design is LANDSCAPE.
//
// Print path:
//   renderPrintPng rotates the landscape 1218×812 canvas 90° CCW to produce
//   a portrait 812×1218 PNG, then submits it with `lp -o media=w4h6`.
//   CUPS fills the full 4×6 label.  Peel and apply the label, then rotate it
//   90° CW — the design reads normally (barcode on left, fields on right).
//
// Prerequisite (run once per machine):
//   lpoptions -p <printer_name> -o PageSize=w4h6
// ─────────────────────────────────────────────────────────────────────────────

const DESIGN_W_IN = 6;   // design canvas width  in inches (landscape)
const DESIGN_H_IN = 4;   // design canvas height in inches (landscape)
const PREVIEW_DPI = 203; // screen preview
// GP-1324D CUPS/TSPL raster caps at ~609 dots/label height; 203×6"=1218 → only ~top half prints.
const PRINT_DPI   = 101; // 6"×101 ≈ 606 dots — fits full 4×6 label

/**
 * Draw the sticker design onto a canvas and return the LANDSCAPE canvas
 * at the given DPI (preview 203, print 101).
 */
function drawStickerCanvas(
  c: SubLot,
  workOrderBarcode: string,
  skuCode: string | null,
  skuName: string,
  dpi: number,
): Promise<HTMLCanvasElement> {
  return new Promise((resolve) => {
    const mm = (v: number) => Math.round(v * dpi / 25.4);

    const W = Math.round(DESIGN_W_IN * dpi);
    const H = Math.round(DESIGN_H_IN * dpi);
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d')!;

    // ── Background ────────────────────────────────────────────────────────
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);

    const P  = mm(4);   // outer padding
    const LW = mm(40);  // left column width
    const G  = mm(4);   // gap between columns
    const RX = P + LW + G;
    const RW = W - RX - P;
    const lw = Math.max(1, mm(0.25));

    // ── Left column border ────────────────────────────────────────────────
    ctx.strokeStyle = '#000'; ctx.lineWidth = lw * 2;
    ctx.strokeRect(P, P, LW, H - 2 * P);

    // "CART #" header
    ctx.fillStyle = '#000'; ctx.textAlign = 'center';
    ctx.font = `bold ${mm(4)}px Arial, sans-serif`;
    ctx.fillText('CART #', P + LW / 2, P + mm(7));

    // sub_lot_code — shrink font until it fits inside the column
    const maxCodeW = LW - mm(2);   // 1 mm margin each side
    let codeFontPx = mm(4.2);
    ctx.font = `bold ${codeFontPx}px "Courier New", monospace`;
    while (ctx.measureText(c.sub_lot_code).width > maxCodeW && codeFontPx > mm(2)) {
      codeFontPx -= 1;
      ctx.font = `bold ${codeFontPx}px "Courier New", monospace`;
    }
    ctx.fillText(c.sub_lot_code, P + LW / 2, P + mm(14));

    // Barcode — rendered landscape then rotated −90° into the left column.
    // Center the barcode vertically in the remaining column space (below the text).
    const textBottom = P + mm(17);                        // approximate bottom of text
    const colBottom  = H - P;                             // bottom of left-column border
    const bcCY       = (textBottom + colBottom) / 2;      // vertical centre for barcode
    const bcMaxLen   = (colBottom - textBottom) * 0.90;   // 90 % of available space
    const bcH        = mm(18);                            // barcode bar height (= width after rotate)
    try {
      const bc = document.createElement('canvas');
      JsBarcode(bc, c.sub_lot_code, {
        format: 'CODE128', displayValue: false,
        margin: 0, height: mm(18), width: 2,
      });
      const cx = P + LW / 2;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.translate(cx, bcCY);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(bc, -bcMaxLen / 2, -bcH / 2, bcMaxLen, bcH);
      ctx.restore();
    } catch { /* skip on bad barcode value */ }

    // ── Right column ─────────────────────────────────────────────────────
    let y = P;
    ctx.textAlign = 'left'; ctx.fillStyle = '#000'; ctx.lineWidth = lw;

    // Header
    ctx.font = `bold ${mm(3.5)}px Arial, sans-serif`;
    ctx.fillText(`WT# ${workOrderBarcode}`, RX, y + mm(5));
    ctx.fillText(`Item: ${skuCode ?? '—'}`, RX, y + mm(10));
    ctx.font = `${mm(3)}px Arial, sans-serif`;
    const skuDisplay = skuName.length > 55 ? skuName.slice(0, 55) + '…' : skuName;
    ctx.fillText(skuDisplay, RX, y + mm(14.5));
    y += mm(17);

    const hdrH = mm(4.5);
    const drawHdr = (text: string, x: number, w: number) => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(x, y, w, hdrH);
      ctx.strokeStyle = '#000'; ctx.lineWidth = lw;
      ctx.strokeRect(x, y, w, hdrH);
      ctx.fillStyle = '#000';
      ctx.font = `bold ${mm(3.2)}px Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(text, x + w / 2, y + mm(3.4));
      ctx.textAlign = 'left';
    };

    // MC/AW Test | Date
    const mcW = Math.round(RW * 0.6), dtW = RW - mcW;
    const stampH = mm(16);
    drawHdr('MC/AW Test', RX, mcW);
    drawHdr('Date', RX + mcW, dtW);
    ctx.strokeStyle = '#000'; ctx.lineWidth = lw;
    ctx.strokeRect(RX, y + hdrH, mcW, stampH);
    ctx.strokeRect(RX + mcW, y + hdrH, dtW, stampH);
    y += hdrH + stampH + mm(2);

    // QC Inspection Notes
    const notesH = mm(10);
    drawHdr('QC Inspection Notes', RX, RW);
    ctx.strokeRect(RX, y + hdrH, RW, notesH);
    y += hdrH + notesH + mm(2);

    // 4 × 2 form grid
    const seq = c.sub_lot_code.match(/(\d{3})$/)?.[1] ?? '';
    const rows: [string, string, string, string][] = [
      ['Batch#', '',  'MFG',    ''],
      ['Cart#',  seq, 'Shift/M',''],
      ['Tray#',  '',  'DR in',  ''],
      ['Qty',    '',  'DR out', ''],
    ];
    const rowH = mm(7.5), cw = Math.round(RW / 2);
    ctx.lineWidth = lw;
    for (const [l1, v1, l2, v2] of rows) {
      ctx.strokeStyle = '#000';
      ctx.strokeRect(RX,      y, cw,  rowH);
      ctx.strokeRect(RX + cw, y, cw,  rowH);
      ctx.fillStyle = '#000';
      ctx.font = `bold ${mm(3)}px Arial, sans-serif`;
      ctx.fillText(l1, RX      + mm(1.5), y + mm(5.5));
      ctx.fillText(l2, RX + cw + mm(1.5), y + mm(5.5));
      if (v1) {
        ctx.font = `bold ${mm(4.8)}px "Courier New", monospace`;
        ctx.fillText(v1, RX      + mm(12), y + mm(5.8));
      }
      if (v2) {
        ctx.font = `bold ${mm(4.8)}px "Courier New", monospace`;
        ctx.fillText(v2, RX + cw + mm(12), y + mm(5.8));
      }
      y += rowH;
    }

    // ── Threshold to pure B/W ─────────────────────────────────────────────
    const imgData = ctx.getImageData(0, 0, W, H);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const luma = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const bw = luma < 180 ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = bw; d[i + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    resolve(canvas);
  });
}

/**
 * Preview PNG: landscape at PREVIEW_DPI (sharp on screen).
 */
async function renderPreviewPng(
  c: SubLot, workOrderBarcode: string, skuCode: string | null, skuName: string,
): Promise<string> {
  const canvas = await drawStickerCanvas(c, workOrderBarcode, skuCode, skuName, PREVIEW_DPI);
  return canvas.toDataURL('image/png').split(',')[1];
}

const PRINT_BRIDGE = 'http://127.0.0.1:6543';
const BRIDGE_CACHE_MS = 5_000;
let bridgeHealthCache: { at: number; ok: boolean } | null = null;

function fetchWithTimeout(url: string, options: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs = 800, ...init } = options;
  if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
    return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  }
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(id));
}

/** Probes local print bridge. Connection refused is normal when the server is not running. */
async function checkPrintBridge(): Promise<boolean> {
  if (bridgeHealthCache && Date.now() - bridgeHealthCache.at < BRIDGE_CACHE_MS) {
    return bridgeHealthCache.ok;
  }
  let ok = false;
  try {
    const r = await fetchWithTimeout(`${PRINT_BRIDGE}/health`, { timeoutMs: 800 });
    if (r.ok) {
      const data = await r.json().catch(() => null) as { ok?: boolean } | null;
      ok = data?.ok === true;
    }
  } catch {
    ok = false;
  }
  bridgeHealthCache = { at: Date.now(), ok };
  return ok;
}

async function hasAuthorizedUsbPrinter(): Promise<boolean> {
  if (!isWebUsbSupported()) return false;
  const devices = await navigator.usb.getDevices();
  return devices.some(d =>
    d.configurations.some(c =>
      c.interfaces.some(i => i.alternates.some(a => a.interfaceClass === 7)),
    ),
  );
}

/**
 * Portrait 812×1218 canvas (landscape design rotated 90° CCW).
 * Used by CUPS bridge, Tauri lp, and WebUSB TSPL paths.
 */
async function renderPrintCanvas(
  c: SubLot, workOrderBarcode: string, skuCode: string | null, skuName: string,
): Promise<HTMLCanvasElement> {
  const landscape = await drawStickerCanvas(c, workOrderBarcode, skuCode, skuName, PRINT_DPI);
  const W = landscape.width;   // 1218
  const H = landscape.height;  // 812
  const rot = document.createElement('canvas');
  rot.width  = H;  // 812
  rot.height = W;  // 1218
  const rctx = rot.getContext('2d')!;
  rctx.translate(H, 0);
  rctx.rotate(Math.PI / 2);   // +90° CW (fixes upside-down output)
  rctx.imageSmoothingEnabled = false;
  rctx.drawImage(landscape, 0, 0);

  // Pre-invert colors: the GP-1324D CUPS driver on macOS outputs a negative
  // of the input image, so we invert here to cancel it out.
  const imgData = rctx.getImageData(0, 0, rot.width, rot.height);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i]   = 255 - d[i];
    d[i+1] = 255 - d[i+1];
    d[i+2] = 255 - d[i+2];
  }
  rctx.putImageData(imgData, 0, 0);

  return rot;
}

/** Base64 PNG for CUPS / print bridge. */
async function renderPrintPng(
  c: SubLot, workOrderBarcode: string, skuCode: string | null, skuName: string,
): Promise<string> {
  const canvas = await renderPrintCanvas(c, workOrderBarcode, skuCode, skuName);
  return canvas.toDataURL('image/png').split(',')[1];
}

async function postPrintToBridge(pngBase64: string, printer: string): Promise<void> {
  const r = await fetchWithTimeout(`${PRINT_BRIDGE}/print`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ png: pngBase64, printer: printer || undefined, media: 'w4h6' }),
    timeoutMs: 30_000,
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: r.statusText })) as { error?: string };
    throw new Error(err.error ?? r.statusText);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Preview component — shows the LANDSCAPE PNG so the operator sees the final
// sticker appearance (the printer takes care of the orientation).
// ─────────────────────────────────────────────────────────────────────────────
function StickerPreview({
  cart, workOrderBarcode, skuCode, skuName, onLoaded,
}: {
  cart: SubLot;
  workOrderBarcode: string;
  skuCode: string | null;
  skuName: string;
  onLoaded?: () => void;
}) {
  const [dataUrl, setDataUrl] = useState<string>('');

  useEffect(() => {
    setDataUrl('');
    let cancelled = false;
    renderPreviewPng(cart, workOrderBarcode, skuCode, skuName).then(b64 => {
      if (cancelled) return;
      setDataUrl('data:image/png;base64,' + b64);
      onLoaded?.();
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.id, workOrderBarcode, skuCode, skuName]);

  return (
    <div
      className="sticker-page"
      style={{
        width:  `${DESIGN_W_IN}in`,
        height: `${DESIGN_H_IN}in`,
        display: 'block',
        background: '#fff',
        overflow: 'hidden',
      }}
    >
      {dataUrl
        ? (
          <img
            src={dataUrl}
            alt={cart.sub_lot_code}
            style={{ width: '100%', height: '100%', display: 'block', imageRendering: 'pixelated' }}
          />
        )
        : (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#aaa', fontSize: '10pt',
          }}>
            Rendering…
          </div>
        )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export function CartStickerSheet({
  carts, workOrderBarcode, skuCode, skuName, onClose,
}: Props) {
  const [printing, setPrinting] = useState(false);
  const [printStatus, setPrintStatus] = useState('');
  // Browser: inferred from USB auth only (no network probe — avoids console noise when bridge is off).
  const [usbReady, setUsbReady] = useState(false);
  const [previewsReady, setPreviewsReady] = useState(false);
  const [loadedCount, setLoadedCount] = useState(0);
  const loadedPreviewIds = useRef(new Set<string>());

  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  useEffect(() => {
    loadedPreviewIds.current.clear();
    setLoadedCount(0);
    setPreviewsReady(carts.length === 0);
  }, [carts]);

  const onPreviewLoaded = useCallback((cartId: string) => {
    if (loadedPreviewIds.current.has(cartId)) return;
    loadedPreviewIds.current.add(cartId);
    const n = loadedPreviewIds.current.size;
    setLoadedCount(n);
    if (n >= carts.length) setPreviewsReady(true);
  }, [carts.length]);

  const handleBrowserPrint = () => {
    if (!previewsReady) {
      setPrintStatus('⚠ 标签图片仍在生成，请稍候再打印');
      return;
    }
    window.print();
  };

  useEffect(() => {
    if (isTauri) return;
    let cancelled = false;
    hasAuthorizedUsbPrinter().then(ok => {
      if (!cancelled) setUsbReady(ok);
    });
    return () => { cancelled = true; };
  }, [isTauri]);

  const doPrint = async () => {
    if (printing) return;
    setPrinting(true);
    setPrintStatus('');

    const t0 = performance.now();
    const log = (msg: string) => {
      console.log(`[Print +${(performance.now()-t0).toFixed(0)}ms] ${msg}`);
    };

    log(`START isTauri=${isTauri} carts=${carts.length}`);

    try {
      let printer = getSavedPrinter() ?? '';
      log(`savedPrinter="${printer || '(none)'}"`);

      // ── Path 1: Tauri desktop app ──────────────────────────────────────────
      if (isTauri) {
        const { invoke } = await import('@tauri-apps/api/core');
        if (!printer) {
          try {
            const dp = await invoke<string>('get_default_printer');
            if (dp?.trim()) printer = dp.trim();
            log(`get_default_printer → "${printer}"`);
          } catch (e) { log(`get_default_printer error: ${e}`); }
        }
        printer = printer || 'Gprinter_GP_1324D';
        log(`using printer (Tauri): "${printer}"`);
        for (let i = 0; i < carts.length; i++) {
          const c = carts[i];
          setPrintStatus(`正在打印 ${i + 1} / ${carts.length}：${c.sub_lot_code}…`);
          const pngBase64 = await renderPrintPng(c, workOrderBarcode, skuCode, skuName);
          const result = await invoke<string>('print_png', { pngBase64, printer });
          log(`print_png → ${result}`);
        }
        setPrintStatus(`✓ 已打印 ${carts.length} 张标签`);
        log('ALL DONE ✓ (Tauri)');
        return;
      }

      // ── Path 2: WebUSB (skip bridge probe when USB already authorised) ───────
      const tryWebUsbPrint = async (forcePicker = false): Promise<boolean> => {
        if (!isWebUsbSupported()) return false;
        if (!forcePicker) {
          const hasUsb = usbReady || await hasAuthorizedUsbPrinter();
          if (!hasUsb) return false;
        }

        log(forcePicker ? 'WebUSB (device picker)' : 'WebUSB');
        setPrintStatus('正在连接 USB 打印机…');
        const device = await openUsbPrinter();
        for (let i = 0; i < carts.length; i++) {
          const c = carts[i];
          setPrintStatus(`正在打印 ${i + 1} / ${carts.length}：${c.sub_lot_code}…`);
          const canvas = await renderPrintCanvas(c, workOrderBarcode, skuCode, skuName);
          await printCanvasUsb(canvas, device);
          log(`✓ USB ${c.sub_lot_code}`);
        }
        setPrintStatus(`✓ 已打印 ${carts.length} 张标签 (USB)`);
        setUsbReady(true);
        log('ALL DONE ✓ (WebUSB)');
        return true;
      };

      // ── Path 2: CUPS via print bridge (preferred when queue name saved) ────
      const tryBridgePrint = async (): Promise<boolean> => {
        const bridgeOk = await checkPrintBridge();
        if (!bridgeOk) return false;
        const queue = printer || 'Gprinter_GP_1324D';
        log(`bridge → lp -d "${queue}"`);
        for (let i = 0; i < carts.length; i++) {
          const c = carts[i];
          setPrintStatus(`正在打印 ${i + 1} / ${carts.length}：${c.sub_lot_code}…`);
          const pngBase64 = await renderPrintPng(c, workOrderBarcode, skuCode, skuName);
          try {
            await postPrintToBridge(pngBase64, queue);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (msg.includes('abort') || msg.includes('AbortError')) {
              throw new Error('打印服务无响应，请确认 print bridge 已启动');
            }
            throw e;
          }
          log(`✓ ${c.sub_lot_code}`);
        }
        setPrintStatus(`✓ 已打印 ${carts.length} 张标签 (CUPS: ${queue})`);
        log('ALL DONE ✓ (bridge)');
        return true;
      };

      // Saved CUPS queue → always try bridge before WebUSB
      if (printer && (await tryBridgePrint())) return;

      // ── Path 3: WebUSB ─────────────────────────────────────────────────────
      if (await tryWebUsbPrint()) return;

      if (await tryBridgePrint()) return;

      if (isWebUsbSupported()) {
        log('bridge unavailable → prompting WebUSB');
        setPrintStatus('正在连接 USB 打印机…');
        if (await tryWebUsbPrint(true)) return;
      }

      setPrintStatus(
        '❌ 无法打印：请启动 print bridge（python3 print_server.py），或在页面右上角连接 USB 打印机，或使用「浏览器打印」',
      );
      log('no bridge, no WebUSB');

    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`ERROR: ${msg}`);
      if (msg.includes('abort') || msg.includes('AbortError')) {
        setPrintStatus('❌ 打印服务无响应，请确认 print bridge 已启动');
      } else if (msg.includes('No device selected') || msg.includes('cancelled')) {
        setPrintStatus('❌ 未选择 USB 打印机。请在页面右上角「标签打印机」中连接设备');
      } else {
        setPrintStatus(`❌ 打印失败: ${msg}`);
      }
    } finally {
      setPrinting(false);
    }
  };

  const modal = (
    <div className="cart-print-root fixed inset-0 z-50 flex flex-col bg-slate-900/70">
      {/* ── Toolbar ── */}
      <div className="no-print sticky top-0 z-10 bg-white border-b border-slate-200 shrink-0">
        {!isTauri && !usbReady && (
          <div className="px-5 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-800">
            打印前请任选其一：① 本机运行{' '}
            <code className="font-mono text-[11px]">python3 print_server.py</code>
            {' '}后点 Print（CUPS）；② 在右上角「标签打印机」连接 USB 后点 Print；③ 使用「浏览器打印…」。
          </div>
        )}
        <div className="px-5 py-3 flex items-center gap-3 flex-wrap">
          <h2 className="text-sm font-bold text-slate-900">
            Print stickers · {carts.length} cart{carts.length === 1 ? '' : 's'}
          </h2>
          {printStatus ? (
            <span className={`text-xs font-medium ${printStatus.startsWith('❌') ? 'text-red-600' : printStatus.startsWith('⚠') ? 'text-amber-600' : printStatus.startsWith('✓') ? 'text-emerald-600' : 'text-blue-600'}`}>
              {printStatus}
            </span>
          ) : (
            <span className="text-xs text-slate-500">
              {previewsReady
                ? '浏览器/PDF：6×4 in 横版，每车一页'
                : `生成预览中… (${loadedCount}/${carts.length})`}
            </span>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={doPrint}
            disabled={printing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-60 disabled:cursor-wait"
          >
            {printing ? (
              <svg className="animate-spin" width={12} height={12} viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
            ) : (
              <Printer size={12} />
            )}
            {printing ? '打印中…' : 'Print'}
          </button>
          <button
            type="button"
            disabled={printing || !previewsReady}
            onClick={handleBrowserPrint}
            title={previewsReady ? '在打印对话框中选 6×4 英寸横版' : '等待预览生成完成'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold bg-slate-600 hover:bg-slate-500 text-white disabled:opacity-50"
          >
            浏览器打印…
          </button>
          {isWebUsbSupported() && (
            <button
              type="button"
              disabled={printing}
              onClick={async () => {
                setPrinting(true);
                setPrintStatus('正在连接…');
                try {
                  const dev = await openUsbPrinter();
                  setPrintStatus('发送测试指令…');
                  await testPrintUsb(dev);
                  setPrintStatus('✓ 测试指令已发送（查看打印机是否出纸）');
                  setUsbReady(true);
                } catch (e) {
                  setPrintStatus(`❌ 测试失败: ${e instanceof Error ? e.message : String(e)}`);
                } finally {
                  setPrinting(false);
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold bg-amber-500 hover:bg-amber-400 text-white disabled:opacity-50"
            >
              Test USB
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700"
          >
            <X size={12} /> Close
          </button>
        </div>
      </div>

      {/* ── Preview area ── */}
      <div className="flex-1 overflow-auto p-6 print-stickers bg-slate-100">
        <div className="flex flex-wrap gap-6 justify-center">
          {carts.map(c => (
            <StickerPreview
              key={c.id}
              cart={c}
              workOrderBarcode={workOrderBarcode}
              skuCode={skuCode}
              skuName={skuName}
              onLoaded={() => onPreviewLoaded(c.id)}
            />
          ))}
        </div>
      </div>

      <style>{`
        /* ── Print / Save as PDF (matches on-screen 6×4 in landscape design) ── */
        @media print {
          @page {
            size: ${DESIGN_W_IN}in ${DESIGN_H_IN}in;
            margin: 0;
          }
          html, body {
            width: ${DESIGN_W_IN}in !important;
            height: auto !important;
            background: white !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
          }
          body > *:not(.cart-print-root) { display: none !important; }
          .cart-print-root {
            position: static !important;
            inset: auto !important;
            width: auto !important;
            height: auto !important;
            min-height: 0 !important;
            background: white !important;
            display: block !important;
            overflow: visible !important;
            z-index: auto !important;
          }
          .cart-print-root .no-print { display: none !important; }
          .cart-print-root .print-stickers {
            position: static !important;
            display: block !important;
            flex: none !important;
            overflow: visible !important;
            padding: 0 !important;
            margin: 0 !important;
            background: white !important;
            height: auto !important;
            min-height: 0 !important;
          }
          .cart-print-root .print-stickers > div {
            display: block !important;
            flex: none !important;
            gap: 0 !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          .sticker-page {
            transform: none !important;
            box-shadow: none !important;
            border: none !important;
            margin: 0 !important;
            padding: 0 !important;
            page-break-after: always;
            break-after: page;
            width: ${DESIGN_W_IN}in !important;
            height: ${DESIGN_H_IN}in !important;
            overflow: hidden !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .sticker-page:last-child { page-break-after: auto; break-after: auto; }
          .sticker-page img {
            width: 100% !important;
            height: 100% !important;
            display: block !important;
            object-fit: fill !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }

        /* ── Screen preview ─────────────────────────────────────── */
        @media screen {
          .sticker-page {
            transform: scale(0.6);
            transform-origin: top left;
            /* collapse the space scale() leaves behind */
            margin-right:  -${(DESIGN_W_IN * 0.4 * 25.4).toFixed(1)}mm;
            margin-bottom: -${(DESIGN_H_IN * 0.4 * 25.4).toFixed(1)}mm;
            box-shadow: 0 2px 10px rgba(0,0,0,0.25);
          }
        }
      `}</style>
    </div>
  );

  return createPortal(modal, document.body);
}

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Printer, X } from 'lucide-react';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import { SubLot } from '../../../services/qcApi';
import { getSavedPrinter, getSavedDpi } from '../../../lib/printerConfig';

interface Props {
  carts: SubLot[];
  workOrderBarcode: string;
  skuCode: string | null;
  skuName: string;
  onClose: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Label: 4 × 3 inch, LANDSCAPE (4" wide × 3" tall) = 101.6 × 76.2 mm.
//
// Print path (web): browser builds a VECTOR PDF (jsPDF) → POST /print { pdf }
//   → bridge prints it (macOS `lp file.pdf`, Windows SumatraPDF). Text & lines
//   stay vector and are rasterised by the printer driver at its native dpi, so
//   edges are crisp on any model (no fixed-resolution bitmap, no aliasing).
//
// The barcode is drawn as VECTOR bars (CODE128 module pattern → filled rects).
// Tauri desktop still uses a PNG canvas (its Rust `print_png` command).
// ─────────────────────────────────────────────────────────────────────────────

const MM_W = 101.6;   // 4 inch
const MM_H = 76.2;    // 3 inch
const ptFromMm = (mm: number) => mm / 0.352777;   // jsPDF font size is in pt

// ── QR code as a crisp 1-bit PNG ──────────────────────────────────────────────
// QR uses large modules + error correction, so it survives thermal dot gain far
// better than a 1D barcode's narrow bars, and it's orientation-independent.
// Modules are drawn as integer-aligned black squares (no AA → pure 1-bit), at
// the printer's native dpi so CUPS prints it 1:1 with no resampling.
// NOTE: requires a 2-D (imager) scanner — a 1-D laser scanner cannot read QR.
function qrDataUrl(value: string, dpi: number, sizeMm: number): string | null {
  try {
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    const data = qr.modules.data;          // Uint8Array, 1 = dark
    const quiet = 4;                        // quiet-zone modules each side
    const totalModules = n + quiet * 2;
    const sizePx = Math.round(sizeMm * dpi / 25.4);
    const mpx = sizePx / totalModules;      // px per module (float)
    const canvas = document.createElement('canvas');
    canvas.width = sizePx; canvas.height = sizePx;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, sizePx, sizePx);
    ctx.fillStyle = '#000';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!data[r * n + c]) continue;
        // round each edge to integer px → crisp, gap-free modules
        const x = Math.round((quiet + c) * mpx);
        const y = Math.round((quiet + r) * mpx);
        const w = Math.round((quiet + c + 1) * mpx) - x;
        const h = Math.round((quiet + r + 1) * mpx) - y;
        ctx.fillRect(x, y, w, h);
      }
    }
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

function drawStickerPdfPage(
  doc: jsPDF, c: SubLot, workOrderBarcode: string, skuCode: string | null, skuName: string, dpi: number,
) {
  const P = 3, LW = 30, G = 3, RX = P + LW + G, RW = MM_W - RX - P;
  doc.setDrawColor(0, 0, 0); doc.setTextColor(0, 0, 0); doc.setFillColor(0, 0, 0);

  // Left column border
  doc.setLineWidth(0.4);
  doc.rect(P, P, LW, MM_H - 2 * P);

  // QR code — robust on thermal, orientation-independent. The QR + CART#/code
  // block is vertically centered within the left column (no top-heavy gap).
  const qrSize = Math.min(LW - 2, 27);
  const qrX = P + (LW - qrSize) / 2;
  const blockH = qrSize + 14.5;          // QR + gap + CART# line + code line
  const colInnerH = MM_H - 2 * P;
  const qrY = P + Math.max(2, (colInnerH - blockH) / 2);
  const qrImg = qrDataUrl(c.sub_lot_code, dpi, qrSize);
  if (qrImg) {
    doc.addImage(qrImg, 'PNG', qrX, qrY, qrSize, qrSize, undefined, 'NONE');
  }

  // CART # + sub_lot_code — below the QR (human-readable)
  const textTop = qrY + qrSize + 4;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(ptFromMm(3.5));
  doc.text('CART #', P + LW / 2, textTop + 4, { align: 'center' });

  let fs = ptFromMm(3.5);
  doc.setFont('courier', 'bold'); doc.setFontSize(fs);
  while (doc.getTextWidth(c.sub_lot_code) > LW - 2 && fs > ptFromMm(2)) { fs -= 0.5; doc.setFontSize(fs); }
  doc.text(c.sub_lot_code, P + LW / 2, textTop + 9, { align: 'center' });

  // Right column header
  doc.setLineWidth(0.2);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(ptFromMm(3.5));
  doc.text(`WT# ${workOrderBarcode}`, RX, P + 5);
  doc.text(`Item: ${skuCode ?? '—'}`, RX, P + 10);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(ptFromMm(3));
  doc.text(skuName.length > 55 ? skuName.slice(0, 55) + '…' : skuName, RX, P + 14.5);

  let y = P + 16;
  const hdrH = 5;
  const drawHdr = (text: string, x: number, w: number) => {
    doc.setLineWidth(0.2);
    doc.rect(x, y, w, hdrH);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(ptFromMm(3.2));
    doc.text(text, x + w / 2, y + 3.6, { align: 'center' });
  };

  // MC/AW Test | Date
  const mcW = RW * 0.6, dtW = RW - mcW, stampH = 12;
  drawHdr('MC/AW Test', RX, mcW);
  drawHdr('Date', RX + mcW, dtW);
  doc.rect(RX, y + hdrH, mcW, stampH);
  doc.rect(RX + mcW, y + hdrH, dtW, stampH);
  y += hdrH + stampH + 2;

  // QC Inspection Notes
  const notesH = 9;
  drawHdr('QC Inspection Notes', RX, RW);
  doc.rect(RX, y + hdrH, RW, notesH);
  y += hdrH + notesH + 2;

  // 4 × 2 form grid
  const seq = c.sub_lot_code.match(/(\d{3})$/)?.[1] ?? '';
  const rows: [string, string, string, string][] = [
    ['Batch#', '',  'MFG',     ''],
    ['Cart#',  seq, 'Shift/M', ''],
    ['Tray#',  '',  'DR in',   ''],
    ['Qty',    '',  'DR out',  ''],
  ];
  const rowH = 4.5, cw = RW / 2;
  for (const [l1, v1, l2, v2] of rows) {
    doc.setLineWidth(0.2);
    doc.rect(RX, y, cw, rowH);
    doc.rect(RX + cw, y, cw, rowH);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(ptFromMm(2.6));
    doc.text(l1, RX + 1.2, y + 3.2);
    doc.text(l2, RX + cw + 1.2, y + 3.2);
    if (v1) { doc.setFont('courier', 'bold'); doc.setFontSize(ptFromMm(3.5)); doc.text(v1, RX + 10, y + 3.4); }
    if (v2) { doc.setFont('courier', 'bold'); doc.setFontSize(ptFromMm(3.5)); doc.text(v2, RX + cw + 10, y + 3.4); }
    y += rowH;
  }
}

/** Build a multi-page vector PDF — one 4"×3" landscape page per cart. */
function buildStickerPdf(
  carts: SubLot[], workOrderBarcode: string, skuCode: string | null, skuName: string, dpi: number,
): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [MM_W, MM_H] });
  carts.forEach((c, i) => {
    if (i > 0) doc.addPage([MM_W, MM_H], 'landscape');
    drawStickerPdfPage(doc, c, workOrderBarcode, skuCode, skuName, dpi);
  });
  return doc;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tauri-only PNG renderer (the desktop app's Rust `print_png` command).
// ─────────────────────────────────────────────────────────────────────────────
function drawStickerCanvas(
  c: SubLot, workOrderBarcode: string, skuCode: string | null, skuName: string, dpi: number,
): Promise<HTMLCanvasElement> {
  return new Promise((resolve) => {
    const mm = (v: number) => Math.round(v * dpi / 25.4);
    const W = Math.round((MM_W / 25.4) * dpi);
    const H = Math.round((MM_H / 25.4) * dpi);
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);

    const P = mm(3), LW = mm(30), G = mm(3), RX = P + LW + G, RW = W - RX - P;
    const lw = Math.max(1, mm(0.2));

    ctx.strokeStyle = '#000'; ctx.lineWidth = lw * 2;
    ctx.strokeRect(P, P, LW, H - 2 * P);

    const bcTopMargin = mm(2), bcMaxLen = (H - 2 * P) * 0.57, bcH = mm(16);
    const bcCY = P + bcTopMargin + bcMaxLen / 2;
    try {
      const bc = document.createElement('canvas');
      JsBarcode(bc, c.sub_lot_code, { format: 'CODE128', displayValue: false, margin: 0, height: mm(16), width: 2 });
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.translate(P + LW / 2, bcCY);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(bc, -bcMaxLen / 2, -bcH / 2, bcMaxLen, bcH);
      ctx.restore();
    } catch { /* skip on bad barcode */ }

    const textTop = P + bcTopMargin + bcMaxLen + mm(4);
    ctx.fillStyle = '#000'; ctx.textAlign = 'center';
    ctx.font = `bold ${mm(4)}px Arial, sans-serif`;
    ctx.fillText('CART #', P + LW / 2, textTop + mm(5));
    let codeFontPx = mm(4.5);
    ctx.font = `bold ${codeFontPx}px "Courier New", monospace`;
    while (ctx.measureText(c.sub_lot_code).width > LW - mm(2) && codeFontPx > mm(2)) {
      codeFontPx -= 1; ctx.font = `bold ${codeFontPx}px "Courier New", monospace`;
    }
    ctx.fillText(c.sub_lot_code, P + LW / 2, textTop + mm(11));

    let y = P;
    ctx.textAlign = 'left'; ctx.fillStyle = '#000'; ctx.lineWidth = lw;
    ctx.font = `bold ${mm(3.5)}px Arial, sans-serif`;
    ctx.fillText(`WT# ${workOrderBarcode}`, RX, y + mm(5));
    ctx.fillText(`Item: ${skuCode ?? '—'}`, RX, y + mm(10));
    ctx.font = `${mm(3)}px Arial, sans-serif`;
    ctx.fillText(skuName.length > 55 ? skuName.slice(0, 55) + '…' : skuName, RX, y + mm(14.5));
    y += mm(16);

    const hdrH = mm(5);
    const drawHdr = (text: string, x: number, w: number) => {
      ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, hdrH);
      ctx.strokeStyle = '#000'; ctx.lineWidth = lw; ctx.strokeRect(x, y, w, hdrH);
      ctx.fillStyle = '#000'; ctx.font = `bold ${mm(3.2)}px Arial, sans-serif`;
      ctx.textAlign = 'center'; ctx.fillText(text, x + w / 2, y + mm(3.6)); ctx.textAlign = 'left';
    };
    const mcW = Math.round(RW * 0.6), dtW = RW - mcW, stampH = mm(12);
    drawHdr('MC/AW Test', RX, mcW); drawHdr('Date', RX + mcW, dtW);
    ctx.strokeStyle = '#000'; ctx.lineWidth = lw;
    ctx.strokeRect(RX, y + hdrH, mcW, stampH); ctx.strokeRect(RX + mcW, y + hdrH, dtW, stampH);
    y += hdrH + stampH + mm(2);

    const notesH = mm(9);
    drawHdr('QC Inspection Notes', RX, RW);
    ctx.strokeRect(RX, y + hdrH, RW, notesH);
    y += hdrH + notesH + mm(2);

    const seq = c.sub_lot_code.match(/(\d{3})$/)?.[1] ?? '';
    const rows: [string, string, string, string][] = [
      ['Batch#', '', 'MFG', ''], ['Cart#', seq, 'Shift/M', ''],
      ['Tray#', '', 'DR in', ''], ['Qty', '', 'DR out', ''],
    ];
    const rowH = mm(4.5), cw = Math.round(RW / 2);
    ctx.lineWidth = lw;
    for (const [l1, v1, l2, v2] of rows) {
      ctx.strokeStyle = '#000';
      ctx.strokeRect(RX, y, cw, rowH); ctx.strokeRect(RX + cw, y, cw, rowH);
      ctx.fillStyle = '#000'; ctx.font = `bold ${mm(2.6)}px Arial, sans-serif`;
      ctx.fillText(l1, RX + mm(1.2), y + mm(3.2)); ctx.fillText(l2, RX + cw + mm(1.2), y + mm(3.2));
      if (v1) { ctx.font = `bold ${mm(3.5)}px "Courier New", monospace`; ctx.fillText(v1, RX + mm(10), y + mm(3.4)); }
      if (v2) { ctx.font = `bold ${mm(3.5)}px "Courier New", monospace`; ctx.fillText(v2, RX + cw + mm(10), y + mm(3.4)); }
      y += rowH;
    }

    const imgData = ctx.getImageData(0, 0, W, H);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const bw = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < 180 ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = bw; d[i + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    resolve(canvas);
  });
}

async function renderPrintPng(
  c: SubLot, workOrderBarcode: string, skuCode: string | null, skuName: string, dpi: number,
): Promise<string> {
  const canvas = await drawStickerCanvas(c, workOrderBarcode, skuCode, skuName, dpi);
  return canvas.toDataURL('image/png').split(',')[1];
}

// ── Print bridge ──────────────────────────────────────────────────────────────
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

async function checkPrintBridge(): Promise<boolean> {
  if (bridgeHealthCache && Date.now() - bridgeHealthCache.at < BRIDGE_CACHE_MS) return bridgeHealthCache.ok;
  let ok = false;
  try {
    const r = await fetchWithTimeout(`${PRINT_BRIDGE}/health`, { timeoutMs: 800 });
    if (r.ok) ok = ((await r.json().catch(() => null)) as { ok?: boolean } | null)?.ok === true;
  } catch { ok = false; }
  bridgeHealthCache = { at: Date.now(), ok };
  return ok;
}

/** Send the whole batch as ONE vector PDF → bridge prints it as a single job. */
async function postPrintPdfToBridge(pdfBase64: string, printer: string): Promise<void> {
  const r = await fetchWithTimeout(`${PRINT_BRIDGE}/print`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pdf: pdfBase64, printer: printer || undefined }),
    timeoutMs: 120_000,
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: r.statusText })) as { error?: string };
    throw new Error(err.error ?? r.statusText);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export function CartStickerSheet({
  carts, workOrderBarcode, skuCode, skuName, onClose,
}: Props) {
  const { t } = useTranslation('qc');
  const [printing, setPrinting] = useState(false);
  const [printStatus, setPrintStatus] = useState('');
  const [pdfUrl, setPdfUrl] = useState('');
  const pdfB64Ref = useRef<string>('');

  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  // Build the vector PDF once per prop change — used for both preview and print.
  useEffect(() => {
    if (carts.length === 0) { setPdfUrl(''); pdfB64Ref.current = ''; return; }
    let url = '';
    try {
      const doc = buildStickerPdf(carts, workOrderBarcode, skuCode, skuName, getSavedDpi());
      pdfB64Ref.current = doc.output('datauristring').split('base64,')[1] ?? '';
      url = URL.createObjectURL(doc.output('blob'));
      setPdfUrl(url);
    } catch (e) {
      setPrintStatus(`❌ ${t('cartStickerSheet.previewFailed')}: ${e instanceof Error ? e.message : String(e)}`);
    }
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [carts, workOrderBarcode, skuCode, skuName]);

  const doPrint = async () => {
    if (printing) return;
    setPrinting(true);
    setPrintStatus('');
    try {
      const printer = getSavedPrinter() || 'Gprinter_GP_1324D';

      // ── Tauri desktop app (silent, PNG via Rust) ─────────────────────────
      if (isTauri) {
        const dpi = getSavedDpi();
        const { invoke } = await import('@tauri-apps/api/core');
        for (let i = 0; i < carts.length; i++) {
          setPrintStatus(t('cartStickerSheet.printingProgress', { current: i + 1, total: carts.length }));
          const pngBase64 = await renderPrintPng(carts[i], workOrderBarcode, skuCode, skuName, dpi);
          await invoke<string>('print_png', { pngBase64, printer });
        }
        setPrintStatus(`✓ ${t('cartStickerSheet.printed', { count: carts.length })}`);
        return;
      }

      // ── Web: silent bridge prints the vector PDF as one job ───────────────
      if (await checkPrintBridge()) {
        if (!pdfB64Ref.current) throw new Error(t('cartStickerSheet.pdfNotReady'));
        setPrintStatus(t('cartStickerSheet.printingCount', { count: carts.length }));
        await postPrintPdfToBridge(pdfB64Ref.current, printer);
        setPrintStatus(`✓ ${t('cartStickerSheet.printed', { count: carts.length })}`);
        return;
      }

      // ── Fallback (no bridge): open the PDF so the user can print it ───────
      if (pdfUrl) window.open(pdfUrl, '_blank');
      setPrintStatus(t('cartStickerSheet.noBridgeFallback'));

    } catch (e) {
      setPrintStatus(`❌ ${t('cartStickerSheet.printFailed')}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPrinting(false);
    }
  };

  const modal = (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/70">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 bg-white border-b border-slate-200 shrink-0">
        <div className="px-5 py-3 flex items-center gap-3 flex-wrap">
          <h2 className="text-sm font-bold text-slate-900">
            {t('cartStickerSheet.title', { count: carts.length })}
          </h2>
          {printStatus ? (
            <span className={`text-xs font-medium ${printStatus.startsWith('❌') ? 'text-red-600' : printStatus.startsWith('✓') ? 'text-emerald-600' : 'text-blue-600'}`}>
              {printStatus}
            </span>
          ) : (
            <span className="text-xs text-slate-500">
              {pdfUrl ? t('cartStickerSheet.labelsClickToPrint', { count: carts.length }) : t('cartStickerSheet.generatingPreview')}
            </span>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={doPrint}
            disabled={printing || !pdfUrl}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-60 disabled:cursor-wait"
          >
            {printing ? (
              <svg className="animate-spin" width={12} height={12} viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
            ) : (
              <Printer size={12} />
            )}
            {printing ? t('cartStickerSheet.printingButton') : t('cartStickerSheet.printButton')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700"
          >
            <X size={12} /> {t('cartStickerSheet.close')}
          </button>
        </div>
      </div>

      {/* Preview — the actual PDF that will be printed */}
      <div className="flex-1 overflow-hidden p-4 bg-slate-100">
        {pdfUrl ? (
          <iframe title="labels" src={pdfUrl} className="w-full h-full rounded border border-slate-300 bg-white" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">
            {t('cartStickerSheet.generatingPreview')}
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

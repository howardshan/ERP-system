import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Printer, X } from 'lucide-react';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import { SubLot } from '../../../services/qcApi';
import { getSavedPrinter, getSavedDpi, LabelDpi } from '../../../lib/printerConfig';

function isWindowsBrowser(): boolean {
  return typeof navigator !== 'undefined' && /Win/i.test(navigator.userAgent);
}

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
// Print path (web): browser builds a VECTOR PDF (jsPDF) → POST /print
//   macOS: { pdf } → lp
//   Windows: rasterize PDF in-browser → { pngs, dpi } → PrintDocument 4×3
//   (avoids SumatraPDF fit auto-rotate that clips landscape labels).
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
  // LW = left (QR) column width, G = gap. Column widened to hold a larger QR;
  // the right table still has ample width (RW ≈ 62mm).
  const P = 3, LW = 32, G = 1.5, RX = P + LW + G, RW = MM_W - RX - P;
  doc.setDrawColor(0, 0, 0); doc.setTextColor(0, 0, 0); doc.setFillColor(0, 0, 0);

  // Left column border
  doc.setLineWidth(0.4);
  doc.rect(P, P, LW, MM_H - 2 * P);

  const cxL = P + LW / 2;

  // Wrap `text` into `maxW`, breaking onto up to `maxLines` lines; a single line
  // still too wide (e.g. an unbreakable long number) is shrunk to fit. Returns
  // the y just below the last line.
  const wrapText = (
    text: string, x: number, yTop: number, maxW: number,
    baseMm: number, minMm: number, lhMm: number, align: 'left' | 'center', maxLines: number,
  ): number => {
    doc.setFontSize(ptFromMm(baseMm));
    let lines = doc.splitTextToSize(text, maxW) as string[];
    if (lines.length > maxLines) lines = lines.slice(0, maxLines);
    let yy = yTop;
    for (const ln of lines) {
      let f = ptFromMm(baseMm);
      doc.setFontSize(f);
      while (doc.getTextWidth(ln) > maxW && f > ptFromMm(minMm)) { f -= 0.3; doc.setFontSize(f); }
      doc.text(ln, x, yy, { align });
      yy += lhMm;
    }
    return yy;
  };

  // WT# + Item# — above the QR; a long work-order number wraps instead of clipping.
  doc.setFont('helvetica', 'bold');
  let yL = wrapText(`WT# ${workOrderBarcode}`, cxL, P + 3.5, LW - 2, 3, 1.8, 3.4, 'center', 2);
  yL = wrapText(`Item: ${skuCode ?? '—'}`, cxL, yL + 0.3, LW - 2, 3, 1.8, 3.4, 'center', 1);

  // QR — below the header, horizontally centered. Robust on thermal, orientation-independent.
  const qrSize = Math.min(LW - 2, 30);
  const qrX = P + (LW - qrSize) / 2;
  const qrY = yL + 1;
  const qrImg = qrDataUrl(c.sub_lot_code, dpi, qrSize);
  if (qrImg) {
    doc.addImage(qrImg, 'PNG', qrX, qrY, qrSize, qrSize, undefined, 'NONE');
  }

  // CART # + sub_lot_code — below the QR (human-readable)
  const textTop = qrY + qrSize + 2;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(ptFromMm(3.2));
  doc.text('CART #', cxL, textTop + 3.5, { align: 'center' });

  let fs = ptFromMm(4);
  doc.setFont('courier', 'bold'); doc.setFontSize(fs);
  while (doc.getTextWidth(c.sub_lot_code) > LW - 2 && fs > ptFromMm(2)) { fs -= 0.5; doc.setFontSize(fs); }
  doc.text(c.sub_lot_code, cxL, textTop + 8.5, { align: 'center' });

  // Right column — product name at the top; wraps to up to 2 lines.
  doc.setLineWidth(0.2);
  doc.setFont('helvetica', 'bold');
  let y = wrapText(skuName, RX, P + 3, RW, 3.4, 2.4, 3.5, 'left', 2) + 0.8;

  const hdrH = 5;
  const drawHdr = (text: string, x: number, w: number) => {
    doc.setLineWidth(0.2);
    doc.rect(x, y, w, hdrH);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(ptFromMm(3.2));
    doc.text(text, x + w / 2, y + 3.6, { align: 'center' });
  };

  // MC/AW Test | Date
  const mcW = RW * 0.6, dtW = RW - mcW, stampH = 10;
  drawHdr('MC/AW Test', RX, mcW);
  drawHdr('Date', RX + mcW, dtW);
  doc.rect(RX, y + hdrH, mcW, stampH);
  doc.rect(RX + mcW, y + hdrH, dtW, stampH);
  y += hdrH + stampH + 1.5;

  // QC Inspection Notes
  const notesH = 8;
  drawHdr('QC Inspection Notes', RX, RW);
  doc.rect(RX, y + hdrH, RW, notesH);
  y += hdrH + notesH + 1.5;

  // 4 × 2 form grid — enlarged (taller rows + bigger fonts)
  const seq = c.sub_lot_code.match(/(\d{3})$/)?.[1] ?? '';
  const rows: [string, string, string, string][] = [
    ['Batch#', '',  'MFG',     ''],
    ['Cart#',  seq, 'Shift/M', ''],
    ['Tray#',  '',  'DR in',   ''],
    ['Qty',    '',  'DR out',  ''],
  ];
  const rowH = 7, cw = RW / 2;
  for (const [l1, v1, l2, v2] of rows) {
    doc.setLineWidth(0.2);
    doc.rect(RX, y, cw, rowH);
    doc.rect(RX + cw, y, cw, rowH);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(ptFromMm(3.8));
    doc.text(l1, RX + 1.5, y + 4.6);
    doc.text(l2, RX + cw + 1.5, y + 4.6);
    if (v1) { doc.setFont('courier', 'bold'); doc.setFontSize(ptFromMm(5)); doc.text(v1, RX + 14, y + 4.8); }
    if (v2) { doc.setFont('courier', 'bold'); doc.setFontSize(ptFromMm(5)); doc.text(v2, RX + cw + 14, y + 4.8); }
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
    const cxL = P + LW / 2;

    ctx.strokeStyle = '#000'; ctx.lineWidth = lw * 2;
    ctx.strokeRect(P, P, LW, H - 2 * P);

    // Wrap `text` into `maxW`, breaking on spaces onto up to `maxLines` lines;
    // an unbreakable line still too wide is shrunk to fit. Returns y below the last line.
    const wrapText = (
      text: string, x: number, yTop: number, maxW: number,
      baseMm: number, minMm: number, lhMm: number, align: CanvasTextAlign, maxLines: number,
    ): number => {
      ctx.textAlign = align;
      ctx.font = `bold ${mm(baseMm)}px Arial, sans-serif`;
      const words = text.split(' ');
      const lines: string[] = [];
      let cur = '';
      for (const w of words) {
        const test = cur ? `${cur} ${w}` : w;
        if (!cur || ctx.measureText(test).width <= maxW) cur = test;
        else { lines.push(cur); cur = w; }
      }
      if (cur) lines.push(cur);
      let yy = yTop;
      for (const ln of lines.slice(0, maxLines)) {
        let f = mm(baseMm);
        ctx.font = `bold ${f}px Arial, sans-serif`;
        while (ctx.measureText(ln).width > maxW && f > mm(minMm)) { f -= 1; ctx.font = `bold ${f}px Arial, sans-serif`; }
        ctx.fillText(ln, x, yy);
        yy += mm(lhMm);
      }
      return yy;
    };

    // WT# + Item# above the barcode; a long work-order number wraps instead of clipping.
    ctx.fillStyle = '#000';
    let yL = wrapText(`WT# ${workOrderBarcode}`, cxL, P + mm(4), LW - mm(2), 3, 1.8, 3.4, 'center', 2);
    yL = wrapText(`Item: ${skuCode ?? '—'}`, cxL, yL + mm(0.3), LW - mm(2), 3, 1.8, 3.4, 'center', 1);

    // Vertical barcode below the header.
    const bcTop = yL + mm(1), bcMaxLen = (H - 2 * P) * 0.42, bcH = mm(16);
    const bcCY = bcTop + bcMaxLen / 2;
    try {
      const bc = document.createElement('canvas');
      JsBarcode(bc, c.sub_lot_code, { format: 'CODE128', displayValue: false, margin: 0, height: mm(16), width: 2 });
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.translate(cxL, bcCY);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(bc, -bcMaxLen / 2, -bcH / 2, bcMaxLen, bcH);
      ctx.restore();
    } catch { /* skip on bad barcode */ }

    const textTop = bcTop + bcMaxLen + mm(3);
    ctx.fillStyle = '#000'; ctx.textAlign = 'center';
    ctx.font = `bold ${mm(3.8)}px Arial, sans-serif`;
    ctx.fillText('CART #', cxL, textTop + mm(4));
    let codeFontPx = mm(4.5);
    ctx.font = `bold ${codeFontPx}px "Courier New", monospace`;
    while (ctx.measureText(c.sub_lot_code).width > LW - mm(2) && codeFontPx > mm(2)) {
      codeFontPx -= 1; ctx.font = `bold ${codeFontPx}px "Courier New", monospace`;
    }
    ctx.fillText(c.sub_lot_code, cxL, textTop + mm(10));

    // Right column — product name at the top; wraps to up to 2 lines.
    ctx.fillStyle = '#000'; ctx.lineWidth = lw;
    let y = wrapText(skuName, RX, P + mm(3), RW, 3.4, 2.4, 3.5, 'left', 2) + mm(0.8);

    const hdrH = mm(5);
    const drawHdr = (text: string, x: number, w: number) => {
      ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, hdrH);
      ctx.strokeStyle = '#000'; ctx.lineWidth = lw; ctx.strokeRect(x, y, w, hdrH);
      ctx.fillStyle = '#000'; ctx.font = `bold ${mm(3.2)}px Arial, sans-serif`;
      ctx.textAlign = 'center'; ctx.fillText(text, x + w / 2, y + mm(3.6)); ctx.textAlign = 'left';
    };
    const mcW = Math.round(RW * 0.6), dtW = RW - mcW, stampH = mm(10);
    drawHdr('MC/AW Test', RX, mcW); drawHdr('Date', RX + mcW, dtW);
    ctx.strokeStyle = '#000'; ctx.lineWidth = lw;
    ctx.strokeRect(RX, y + hdrH, mcW, stampH); ctx.strokeRect(RX + mcW, y + hdrH, dtW, stampH);
    y += hdrH + stampH + mm(1.5);

    const notesH = mm(8);
    drawHdr('QC Inspection Notes', RX, RW);
    ctx.strokeRect(RX, y + hdrH, RW, notesH);
    y += hdrH + notesH + mm(1.5);

    const seq = c.sub_lot_code.match(/(\d{3})$/)?.[1] ?? '';
    const rows: [string, string, string, string][] = [
      ['Batch#', '', 'MFG', ''], ['Cart#', seq, 'Shift/M', ''],
      ['Tray#', '', 'DR in', ''], ['Qty', '', 'DR out', ''],
    ];
    const rowH = mm(7), cw = Math.round(RW / 2);
    ctx.lineWidth = lw;
    for (const [l1, v1, l2, v2] of rows) {
      ctx.strokeStyle = '#000';
      ctx.strokeRect(RX, y, cw, rowH); ctx.strokeRect(RX + cw, y, cw, rowH);
      ctx.fillStyle = '#000'; ctx.font = `bold ${mm(3.8)}px Arial, sans-serif`;
      ctx.fillText(l1, RX + mm(1.5), y + mm(4.6)); ctx.fillText(l2, RX + cw + mm(1.5), y + mm(4.6));
      if (v1) { ctx.font = `bold ${mm(5)}px "Courier New", monospace`; ctx.fillText(v1, RX + mm(14), y + mm(4.8)); }
      if (v2) { ctx.font = `bold ${mm(5)}px "Courier New", monospace`; ctx.fillText(v2, RX + cw + mm(14), y + mm(4.8)); }
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

/** macOS: send vector PDF as one job. */
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

/** Windows: PNG batch → PrintDocument PaperSize 4×3 (no Sumatra auto-rotate). */
async function postPrintPngsToBridge(pngs: string[], printer: string, dpi: LabelDpi): Promise<void> {
  const r = await fetchWithTimeout(`${PRINT_BRIDGE}/print`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pngs, dpi, printer: printer || undefined }),
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
  const previewRef = useRef<HTMLIFrameElement>(null);

  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  const handleBrowserPrint = () => {
    const w = previewRef.current?.contentWindow;
    if (w) w.print();
    else if (pdfUrl) window.open(pdfUrl, '_blank');
  };

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

      // ── Web: silent bridge ───────────────────────────────────────────────
      if (await checkPrintBridge()) {
        if (!pdfB64Ref.current) throw new Error(t('cartStickerSheet.pdfNotReady'));
        setPrintStatus(t('cartStickerSheet.printingCount', { count: carts.length }));
        if (isWindowsBrowser()) {
          // Canvas PNG at native dpi (not PDF→pdfjs) — matches 4×3 landscape pixels
          // exactly; avoids pdf.js viewport rotation and missing PNG DPI metadata.
          const dpi = getSavedDpi();
          const pngs = await Promise.all(
            carts.map(c => renderPrintPng(c, workOrderBarcode, skuCode, skuName, dpi)),
          );
          await postPrintPngsToBridge(pngs, printer, dpi);
        } else {
          await postPrintPdfToBridge(pdfB64Ref.current, printer);
        }
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
            disabled={printing || !pdfUrl}
            onClick={handleBrowserPrint}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold bg-slate-600 hover:bg-slate-500 text-white disabled:opacity-50"
          >
            {t('cartStickerSheet.browserPrintButton')}
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
          <iframe ref={previewRef} title="labels" src={pdfUrl} className="w-full h-full rounded border border-slate-300 bg-white" />
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

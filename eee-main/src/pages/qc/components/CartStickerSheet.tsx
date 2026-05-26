import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import JsBarcode from 'jsbarcode';
import { SubLot } from '../../../services/qcApi';
import { getSavedPrinter } from '../../../lib/printerConfig';

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
const PRINT_DPI   = 203; // GP-1324D native DPI — render directly at this res

/**
 * Draw the sticker design onto a canvas and return the LANDSCAPE 203-DPI
 * downscaled canvas (1218 × 812 px).  Called by both preview and print paths.
 */
function drawStickerCanvas(
  c: SubLot,
  workOrderBarcode: string,
  skuCode: string | null,
  skuName: string,
): Promise<HTMLCanvasElement> {
  return new Promise((resolve) => {
    const mm = (v: number) => Math.round(v * PRINT_DPI / 25.4);

    const W = Math.round(DESIGN_W_IN * PRINT_DPI);  // 1218
    const H = Math.round(DESIGN_H_IN * PRINT_DPI);  // 812
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
    resolve(canvas);  // 1218 × 812 landscape canvas at native 203 DPI
  });
}

/**
 * Preview PNG: landscape 1218×812.
 * What the operator sees on screen — the finished sticker appearance.
 */
async function renderPreviewPng(
  c: SubLot, workOrderBarcode: string, skuCode: string | null, skuName: string,
): Promise<string> {
  const canvas = await drawStickerCanvas(c, workOrderBarcode, skuCode, skuName);
  return canvas.toDataURL('image/png').split(',')[1];
}

/**
 * Print PNG: portrait 812×1218 (landscape design rotated 90° CCW).
 * Submitted to CUPS with -o media=w4h6.  Peel the label and rotate it 90° CW
 * to read the design correctly.
 */
async function renderPrintPng(
  c: SubLot, workOrderBarcode: string, skuCode: string | null, skuName: string,
): Promise<string> {
  const landscape = await drawStickerCanvas(c, workOrderBarcode, skuCode, skuName);
  const W = landscape.width;   // 1218
  const H = landscape.height;  // 812
  const rot = document.createElement('canvas');
  rot.width  = H;  // 812
  rot.height = W;  // 1218
  const rctx = rot.getContext('2d')!;
  rctx.translate(0, W);
  rctx.rotate(-Math.PI / 2);  // 90° CCW
  rctx.imageSmoothingEnabled = false;
  rctx.drawImage(landscape, 0, 0);
  return rot.toDataURL('image/png').split(',')[1];
}

// ─────────────────────────────────────────────────────────────────────────────
// Preview component — shows the LANDSCAPE PNG so the operator sees the final
// sticker appearance (the printer takes care of the orientation).
// ─────────────────────────────────────────────────────────────────────────────
function StickerPreview({
  cart, workOrderBarcode, skuCode, skuName,
}: {
  cart: SubLot;
  workOrderBarcode: string;
  skuCode: string | null;
  skuName: string;
}) {
  const [dataUrl, setDataUrl] = useState<string>('');

  useEffect(() => {
    setDataUrl('');
    renderPreviewPng(cart, workOrderBarcode, skuCode, skuName).then(b64 => {
      setDataUrl('data:image/png;base64,' + b64);
    });
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
  const doPrint = async () => {
    const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    const t0 = performance.now();
    const log = (msg: string) => console.log(`[Print +${(performance.now()-t0).toFixed(0)}ms] ${msg}`);

    log(`START isTauri=${isTauri} carts=${carts.length}`);

    if (isTauri) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        // Use the printer saved on the dashboard; fall back to auto-detect then hardcoded default.
        let printer = getSavedPrinter();
        log(`savedPrinter="${printer ?? '(none)'}"`);
        if (!printer) {
          try {
            const dp = await invoke<string>('get_default_printer');
            if (dp?.trim()) printer = dp.trim();
            log(`get_default_printer → "${printer}"`);
          } catch (e) {
            log(`get_default_printer error: ${e}`);
          }
        }
        printer = printer || 'Gprinter_GP_1324D';
        log(`using printer: "${printer}"`);

        for (const c of carts) {
          log(`rendering ${c.sub_lot_code}…`);
          const pngBase64 = await renderPrintPng(c, workOrderBarcode, skuCode, skuName);
          log(`rendered (${pngBase64.length} chars) — invoking print_png…`);
          const result = await invoke<string>('print_png', { pngBase64, printer });
          log(`print_png returned: "${result}"`);
        }
        log('ALL DONE ✓');
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`ERROR: ${msg}`);
        alert(`打印失败: ${msg}\n\n请确认打印机已连接，然后重试。`);
        return;
      }
    }

    log('not Tauri → window.print()');
    window.print();
  };

  const modal = (
    <div className="cart-print-root fixed inset-0 z-50 flex flex-col bg-slate-900/70">
      {/* ── Toolbar ── */}
      <div className="no-print sticky top-0 z-10 bg-white border-b border-slate-200 px-5 py-3 flex items-center gap-3 shrink-0">
        <h2 className="text-sm font-bold text-slate-900">
          Print stickers · {carts.length} cart{carts.length === 1 ? '' : 's'}
        </h2>
        <span className="text-xs text-slate-500">4×6 in label (w4h6), one per cart</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={doPrint}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white"
        >
          <Printer size={12} /> Print
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700"
        >
          <X size={12} /> Close
        </button>
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
            />
          ))}
        </div>
      </div>

      <style>{`
        /* ── Print ───────────────────────────────────────────────── */
        @media print {
          @page { size: 4in 6in; margin: 0; }
          html, body { background: white !important; margin: 0 !important; padding: 0 !important; }
          body > *:not(.cart-print-root) { display: none !important; }
          .cart-print-root {
            position: static !important; background: white !important; display: block !important;
          }
          .cart-print-root .no-print { display: none !important; }
          .cart-print-root .print-stickers {
            position: static !important; overflow: visible !important;
            padding: 0 !important; margin: 0 !important; background: white !important;
          }
          .cart-print-root .print-stickers > div { display: block !important; }
          .sticker-page {
            transform: none !important;
            box-shadow: none !important; border: none !important; margin: 0 !important;
            page-break-after: always; break-after: page;
            width: ${DESIGN_W_IN}in !important; height: ${DESIGN_H_IN}in !important;
          }
          .sticker-page:last-child { page-break-after: auto; break-after: auto; }
          .sticker-page img { width: 100% !important; height: 100% !important; display: block !important; }
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

/**
 * Rasterize a multi-page label PDF to PNG base64 strings at the printer's native DPI.
 * Used on Windows so print-bridge can send PNGs through PrintDocument (PaperSize 4×3)
 * instead of SumatraPDF, which auto-rotates/scales PDFs incorrectly.
 */
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorker;

const MM_W = 101.6; // 4 inch
const MM_H = 76.2;  // 3 inch

function labelPixelSize(dpi: number): { width: number; height: number } {
  return {
    width: Math.round((MM_W / 25.4) * dpi),
    height: Math.round((MM_H / 25.4) * dpi),
  };
}

/** Each page → base64 PNG (no data: prefix). */
export async function rasterizePdfToPngs(pdfBytes: Uint8Array, dpi: number): Promise<string[]> {
  const { width: targetW, height: targetH } = labelPixelSize(dpi);
  const pdf = await getDocument({ data: pdfBytes }).promise;
  const pngs: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const baseVp = page.getViewport({ scale: 1 });
    const scale = Math.min(targetW / baseVp.width, targetH / baseVp.height);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, targetW, targetH);

    const offsetX = (targetW - viewport.width) / 2;
    const offsetY = (targetH - viewport.height) / 2;
    ctx.save();
    ctx.translate(offsetX, offsetY);

    await page.render({
      canvasContext: ctx,
      viewport,
    }).promise;

    ctx.restore();
    pngs.push(canvas.toDataURL('image/png').split(',')[1] ?? '');
  }

  return pngs;
}

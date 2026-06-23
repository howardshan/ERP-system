// M-151: jsPDF builder for the QC Daily Test Report.
// Portrait A4, hand-drawn table (no autotable plugin in this project), with a
// signature block at the end. Back-signed reports print the reason inline so
// the archived PDF is self-describing.
import { jsPDF } from 'jspdf';
import type { DailyTestRow } from '../../services/qcApi';

export interface DailyReportPdfInput {
  date: string;                 // YYYY-MM-DD (business day)
  rows: DailyTestRow[];
  signerName: string;
  signedAt: string;             // ISO
  signatureImg: string;         // PNG data URL (typed rendered, or drawn)
  backdateReason?: string | null;
}

// A4 portrait in mm
const PAGE_W = 210;
const PAGE_H = 297;
const M = 14;                   // page margin
const CONTENT_W = PAGE_W - 2 * M;

// Column layout (mm), must sum to CONTENT_W (182)
const COLS = [
  { key: 'sample',    label: 'Sample',     w: 26 },
  { key: 'cart',      label: 'Cart',       w: 26 },
  { key: 'sku',       label: 'Product',    w: 40 },
  { key: 'readings',  label: 'Readings',   w: 38 },
  { key: 'result',    label: 'Result',     w: 16 },
  { key: 'time',      label: 'Time',       w: 18 },
  { key: 'inspector', label: 'Inspector',  w: 18 },
] as const;

const ROW_H = 7;
const HEADER_H = 8;

function fmtTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
  } catch { return iso; }
}

function fmtDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
  } catch { return iso; }
}

function readingsText(r: DailyTestRow): string {
  if (!r.readings || r.readings.length === 0) return '—';
  return r.readings
    .map(x => `${x.item_name}: ${x.value}${x.unit ? ` ${x.unit}` : ''}`)
    .join('  ');
}

function cellText(r: DailyTestRow, key: string): string {
  switch (key) {
    case 'sample':    return r.sample_id ?? '—';
    case 'cart':      return r.sub_lot_code;
    case 'sku':       return r.sku_name ?? '—';
    case 'readings':  return readingsText(r);
    case 'result':    return r.result === 'pass' ? 'PASS' : 'FAIL';
    case 'time':      return fmtTime(r.submitted_at);
    case 'inspector': return r.inspector ?? '—';
    default:          return '';
  }
}

function drawTableHeader(doc: jsPDF, y: number): number {
  doc.setFillColor(30, 41, 59);            // slate-800
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.rect(M, y, CONTENT_W, HEADER_H, 'F');
  let x = M;
  for (const c of COLS) {
    doc.text(c.label, x + 1.5, y + HEADER_H - 2.5);
    x += c.w;
  }
  return y + HEADER_H;
}

/** Build the report PDF. Returns the jsPDF doc (caller uses .output('blob')). */
export function buildDailyReportPdf(input: DailyReportPdfInput): jsPDF {
  const { date, rows, signerName, signedAt, signatureImg, backdateReason } = input;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // ── Title block ──────────────────────────────────────────────────────────
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('QC Daily Test Report', M, M + 4);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Report date: ${date}`, M, M + 11);

  const passCount = rows.filter(r => r.result === 'pass').length;
  const failCount = rows.filter(r => r.result === 'fail').length;
  doc.text(
    `Total tests: ${rows.length}    Pass: ${passCount}    Fail: ${failCount}`,
    M, M + 16.5,
  );

  let y = M + 23;

  // ── Table ────────────────────────────────────────────────────────────────
  y = drawTableHeader(doc, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);

  if (rows.length === 0) {
    doc.setTextColor(100, 116, 139);
    doc.text('No tests recorded for this day.', M + 2, y + 5);
    y += ROW_H;
  }

  rows.forEach((r, i) => {
    // page break — keep room for the signature block on the final page later
    if (y + ROW_H > PAGE_H - M) {
      doc.addPage();
      y = M;
      y = drawTableHeader(doc, y);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
    }
    if (i % 2 === 1) {
      doc.setFillColor(241, 245, 249);     // slate-100 zebra
      doc.rect(M, y, CONTENT_W, ROW_H, 'F');
    }
    let x = M;
    for (const c of COLS) {
      const raw = cellText(r, c.key);
      if (c.key === 'result') {
        doc.setTextColor(r.result === 'pass' ? 22 : 220, r.result === 'pass' ? 163 : 38, r.result === 'pass' ? 74 : 38);
        doc.setFont('helvetica', 'bold');
      } else {
        doc.setTextColor(15, 23, 42);
        doc.setFont('helvetica', 'normal');
      }
      const fitted = doc.splitTextToSize(raw, c.w - 3)[0] ?? raw;
      doc.text(String(fitted), x + 1.5, y + ROW_H - 2.3);
      x += c.w;
    }
    // bottom rule
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.1);
    doc.line(M, y + ROW_H, M + CONTENT_W, y + ROW_H);
    y += ROW_H;
  });

  // ── Signature block ────────────────────────────────────────────────────────
  const SIG_BLOCK_H = 56;
  if (y + SIG_BLOCK_H > PAGE_H - M) {
    doc.addPage();
    y = M;
  } else {
    y += 8;
  }

  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.3);
  doc.rect(M, y, CONTENT_W, SIG_BLOCK_H);

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Signed off by', M + 4, y + 7);

  // signature image
  try {
    doc.addImage(signatureImg, 'PNG', M + 4, y + 10, 70, 24, undefined, 'FAST');
  } catch {
    // ignore bad image data — text fields below still convey the sign-off
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Name: ${signerName}`, M + 4, y + 42);
  doc.text(`Signed at: ${fmtDateTime(signedAt)}`, M + 4, y + 48);

  if (backdateReason && backdateReason.trim()) {
    doc.setTextColor(180, 83, 9);          // amber-700
    doc.setFont('helvetica', 'bold');
    doc.text('Back-signed', PAGE_W - M - 4, y + 7, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const reasonLines = doc.splitTextToSize(`Reason: ${backdateReason.trim()}`, CONTENT_W / 2 - 6);
    doc.text(reasonLines, PAGE_W - M - 4, y + 13, { align: 'right' });
  }

  return doc;
}

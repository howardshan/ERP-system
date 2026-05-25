import React, { useMemo } from 'react';
import { Printer, X } from 'lucide-react';
import { SubLot } from '../../../services/qcApi';

interface Props {
  carts: SubLot[];           // sub_lots to print, one sticker per cart
  workOrderBarcode: string;  // WT# header (= production_lot.work_order_barcode)
  skuCode: string | null;    // Item # on sticker
  skuName: string;           // Product name
  onClose: () => void;
}

/**
 * Print-only sticker sheet for production carts.  Each cart → one 4 × 6 inch
 * page.  The barcode that used to occupy the left column on legacy stickers
 * is replaced by the cart's sub_lot_code (big bold text).  All other form
 * fields stay blank for the operator to handwrite, matching the existing
 * paper template.
 *
 * Cart # is pre-filled from the cart's sequence (last 3 digits of the
 * sub_lot_code).  Everything else (Batch#, Tray#, Qty, MFG Date,
 * Shift/Machine, DR in/out, QC inspection notes, MC/AW test) is blank.
 */
export function CartStickerSheet({
  carts, workOrderBarcode, skuCode, skuName, onClose,
}: Props) {
  const doPrint = () => window.print();

  // Pull the 3-digit sequence from sub_lot_code (format: "<wo>-NNN")
  const cartSeq = (code: string) => {
    const m = code.match(/(\d{3})$/);
    return m ? m[1] : '';
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/70">
      {/* Sticky toolbar (hidden when printing) */}
      <div className="no-print sticky top-0 z-10 bg-white border-b border-slate-200 px-5 py-3 flex items-center gap-3 shrink-0">
        <h2 className="text-sm font-bold text-slate-900">
          Print stickers · {carts.length} cart{carts.length === 1 ? '' : 's'}
        </h2>
        <span className="text-xs text-slate-500">4×6 in, one per cart</span>
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

      {/* Preview area (scaled-down on screen, full-size when printing) */}
      <div className="flex-1 overflow-auto p-6 print-stickers bg-slate-100">
        <div className="flex flex-wrap gap-4 justify-center">
          {carts.map(c => (
            <Sticker
              key={c.id}
              subLotCode={c.sub_lot_code}
              cartSeq={cartSeq(c.sub_lot_code)}
              workOrder={workOrderBarcode}
              skuCode={skuCode}
              skuName={skuName}
            />
          ))}
        </div>
      </div>

      {/* Print rules — 4×6 portrait, one sticker per page */}
      <style>{`
        @media print {
          @page { size: 4in 6in; margin: 0; }
          html, body { background: white !important; }
          body * { visibility: hidden; }
          .print-stickers, .print-stickers * { visibility: visible; }
          .print-stickers {
            position: absolute !important;
            inset: 0 !important;
            padding: 0 !important;
            margin: 0 !important;
            background: white !important;
            overflow: visible !important;
          }
          .print-stickers > div {
            display: block !important;
            gap: 0 !important;
            padding: 0 !important;
            margin: 0 !important;
            justify-content: flex-start !important;
          }
          .sticker-page {
            transform: none !important;
            box-shadow: none !important;
            margin: 0 !important;
            page-break-after: always;
            page-break-inside: avoid;
            break-after: page;
            break-inside: avoid;
          }
          .sticker-page:last-child { page-break-after: auto; break-after: auto; }
          .no-print { display: none !important; }
        }

        /* On-screen preview: shrink the sticker so multiple fit per row */
        @media screen {
          .sticker-page {
            transform: scale(0.6);
            transform-origin: top left;
            margin-right: -1.6in; /* 4in × 0.4 ≈ space saved */
            margin-bottom: -2.4in;
          }
        }

        /* Form row: strip the right border on the rightmost field */
        .sticker-row > div:last-child { border-right: none !important; }
      `}</style>
    </div>
  );
}

interface StickerProps {
  subLotCode: string;
  cartSeq: string;
  workOrder: string;
  skuCode: string | null;
  skuName: string;
}

function Sticker({ subLotCode, cartSeq, workOrder, skuCode, skuName }: StickerProps) {
  return (
    <div
      className="sticker-page bg-white border border-slate-300"
      style={{ width: '4in', height: '6in', padding: '0.15in', boxSizing: 'border-box' }}
    >
      {/* Cart code — replaces the legacy barcode column.  Big, monospace,
          centered so it's the first thing a forklift driver sees. */}
      <div
        style={{
          border: '2px solid #000',
          padding: '0.1in',
          textAlign: 'center',
          marginBottom: '0.1in',
        }}
      >
        <div style={{ fontSize: '10pt', fontWeight: 'bold', letterSpacing: '0.05em' }}>
          CART #
        </div>
        <div
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: '28pt',
            fontWeight: 900,
            lineHeight: 1,
            marginTop: '0.05in',
            wordBreak: 'break-all',
          }}
        >
          {subLotCode}
        </div>
      </div>

      {/* WT# + Item + Product name */}
      <div style={{ fontSize: '11pt', lineHeight: 1.3, marginBottom: '0.1in' }}>
        <div><strong>WT#</strong> {workOrder}</div>
        <div><strong>Item:</strong> {skuCode ?? '—'}</div>
        <div style={{ fontSize: '10pt', marginTop: '0.05in' }}>{skuName}</div>
      </div>

      {/* QC Inspection Notes box */}
      <Box label="QC Inspection Notes" heightIn={0.9} />

      {/* MC/AW Test + Date */}
      <Row>
        <Field label="MC/AW Test" widthPct={60} />
        <Field label="Date" widthPct={40} />
      </Row>

      {/* Batch# + MFG Date */}
      <Row>
        <Field label="Batch#" widthPct={50} />
        <Field label="MFG Date" widthPct={50} />
      </Row>

      {/* Cart# (pre-filled) + Shift/Machine */}
      <Row>
        <Field label="Cart#" widthPct={50} value={cartSeq} />
        <Field label="Shift/Machine" widthPct={50} />
      </Row>

      {/* Tray# + DR in Date */}
      <Row>
        <Field label="Tray#" widthPct={50} />
        <Field label="DR in Date" widthPct={50} />
      </Row>

      {/* Qty + DR Out Date */}
      <Row>
        <Field label="Qty" widthPct={50} />
        <Field label="DR Out Date" widthPct={50} />
      </Row>
    </div>
  );
}

function Box({ label, heightIn }: { label: string; heightIn: number }) {
  return (
    <div style={{ border: '1px solid #000', marginBottom: '0.06in' }}>
      <div
        style={{
          fontSize: '8pt',
          fontWeight: 'bold',
          textAlign: 'center',
          borderBottom: '1px solid #000',
          padding: '0.02in 0',
          background: '#f3f3f3',
        }}
      >
        {label}
      </div>
      <div style={{ height: `${heightIn}in` }} />
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticker-row" style={{ display: 'flex', borderBottom: '1px solid #000' }}>
      {children}
    </div>
  );
}

function Field({ label, widthPct, value }: { label: string; widthPct: number; value?: string }) {
  return (
    <div
      style={{
        width: `${widthPct}%`,
        padding: '0.04in 0.06in',
        borderRight: '1px solid #000',
        display: 'flex',
        alignItems: 'baseline',
        gap: '0.04in',
        minHeight: '0.32in',
        boxSizing: 'border-box',
      }}
    >
      <span style={{ fontSize: '8pt', fontWeight: 'bold' }}>{label}</span>
      <span
        style={{
          flex: 1,
          fontSize: '11pt',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
      >
        {value ?? ''}
      </span>
    </div>
  );
}

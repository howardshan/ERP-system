import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, History, Plus, Printer } from 'lucide-react';
import { productionLotDetail, ProductionLotDetail, formatQcDateTime, SubLot } from '../../services/qcApi';
import { QcStatusBadge } from './components/QcStatusBadge';
import { PermissionDenied } from './components/PermissionDenied';
import { AddCartsDialog } from './components/AddCartsDialog';
import { ReprintPickerDialog } from './components/ReprintPickerDialog';
import { CartStickerSheet } from './components/CartStickerSheet';
import { cn } from '../../lib/utils';
import { usePermissions } from '../../contexts/PermissionContext';

function parseSeq(code: string): number {
  const m = code.match(/(\d{3})$/);
  return m ? parseInt(m[1], 10) : 0;
}

const FAIL_EVENTS = new Set(['inspection_failed_hold', 'displaced']);

interface Props {
  lotId: string;
  onBack: () => void;
  onOpenHistory?: (subLotId: string) => void;
}

export default function TracePage({ lotId, onBack, onOpenHistory }: Props) {
  const { can } = usePermissions();
  const canView = can('production', 'trace', 'view');
  const canAddCarts = can('production', 'trace', 'add_carts');
  const canReprint = can('production', 'trace', 'reprint_sticker');
  const [detail, setDetail] = useState<ProductionLotDetail | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  // Dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [reprintOpen, setReprintOpen] = useState(false);
  const [printCarts, setPrintCarts] = useState<SubLot[] | null>(null);
  // After "Add carts" succeeds we stash the newly-added subset here, then
  // pop a Yes/No confirm asking the operator whether to print stickers for
  // them right away.  Decoupled from `printCarts` so the user can decline
  // without losing the option to reprint later via the dedicated button.
  const [postAddPrompt, setPostAddPrompt] = useState<SubLot[] | null>(null);

  const loadDetail = () => {
    if (!lotId) return;
    productionLotDetail(lotId)
      .then(setDetail)
      .catch((e) => setError(e.message));
  };

  useEffect(() => { loadDetail(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [lotId]);

  const maxSeq = useMemo(
    () => (detail ? detail.sub_lots.reduce((m, s) => Math.max(m, parseSeq(s.sub_lot_code)), 0) : 0),
    [detail],
  );

  if (!canView) {
    return <PermissionDenied permission="production.trace.view" feature="Batch Trace" />;
  }

  if (!detail) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <button onClick={onBack} className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-900 mb-4">
          <ArrowLeft size={14} /> Back to trace list
        </button>
        {error ? <p className="text-red-600 text-sm">{error}</p> : <p className="text-slate-400 text-sm">Loading…</p>}
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <button onClick={onBack} className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-900 mb-4">
        <ArrowLeft size={14} /> Back to trace list
      </button>

      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Trace · {detail.lot.lot_number}</h1>
          <p className="text-slate-600 mt-1 text-sm">{detail.lot.sku_name}</p>
        </div>
        <div className="flex items-center gap-2">
          {canAddCarts && (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white"
            >
              <Plus size={12} /> Add carts
            </button>
          )}
          {canReprint && (
            <button
              type="button"
              onClick={() => setReprintOpen(true)}
              disabled={detail.sub_lots.length === 0}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-white disabled:opacity-40"
            >
              <Printer size={12} /> Reprint sticker
            </button>
          )}
        </div>
      </div>

      {msg && <p className="text-emerald-700 bg-emerald-50 p-2 rounded-lg mb-3 text-sm">{msg}</p>}

      <h2 className="font-semibold mb-2 text-slate-900 text-sm">Drying sub-lots</h2>
      <ul className="space-y-2 mb-6">
        {detail.sub_lots.map((s) => (
          <li key={s.id} className="bg-white border rounded-xl p-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => onOpenHistory?.(s.id)}
              disabled={!onOpenHistory}
              className="flex-1 text-left min-w-0 group"
            >
              <div className="flex justify-between items-center mb-1">
                <span className={cn('font-mono font-medium', onOpenHistory ? 'text-blue-700 group-hover:underline' : 'text-slate-900')}>
                  {s.sub_lot_code}
                </span>
                <QcStatusBadge status={s.status} />
              </div>
              <p className="text-xs text-slate-600">
                In {formatQcDateTime(s.in_time)} · Out {formatQcDateTime(s.out_time)}
              </p>
            </button>
            {onOpenHistory && (
              <button
                type="button"
                onClick={() => onOpenHistory(s.id)}
                title="View full history"
                className="text-[10px] font-bold px-2 py-1 rounded border border-slate-200 hover:border-blue-400 hover:text-blue-700 text-slate-500 flex items-center gap-1 shrink-0"
              >
                <History size={10} /> History
              </button>
            )}
          </li>
        ))}
      </ul>

      <h2 className="font-semibold mb-2 text-slate-900 text-sm">Quality events</h2>
      <ul className="space-y-2">
        {detail.events.map((ev) => (
          <li
            key={ev.id}
            className={cn(
              'rounded-xl border p-3',
              FAIL_EVENTS.has(ev.event_type) ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200',
            )}
          >
            <p className={cn(
              'font-medium leading-snug text-sm',
              FAIL_EVENTS.has(ev.event_type) ? 'text-red-900' : 'text-slate-800',
            )}>
              {ev.summary}
            </p>
            <p className="text-[11px] text-slate-500 mt-1.5">{formatQcDateTime(ev.created_at)}</p>
          </li>
        ))}
        {detail.events.length === 0 && <p className="text-slate-500 text-sm">No events</p>}
      </ul>

      <AddCartsDialog
        open={addOpen}
        lotId={detail.lot.id}
        lotBarcode={detail.lot.work_order_barcode}
        existingMaxSeq={maxSeq}
        onClose={() => setAddOpen(false)}
        onSuccess={async (res) => {
          setMsg(`Added ${res.added_count} cart(s) (${detail.lot.work_order_barcode}-${String(res.start_seq).padStart(3, '0')} … -${String(res.end_seq).padStart(3, '0')})`);
          setAddOpen(false);
          // Reload detail synchronously so we can locate the just-created
          // carts and feed them into the print-confirm prompt.
          const refreshed = await productionLotDetail(detail.lot.id).catch(() => null);
          if (refreshed) {
            setDetail(refreshed);
            const newCarts = refreshed.sub_lots.filter(s => {
              const n = parseSeq(s.sub_lot_code);
              return n >= res.start_seq && n <= res.end_seq;
            });
            // Print prompt fires whenever the operator has add_carts — the
            // post-create print is part of the "add" workflow, not a reprint.
            if (newCarts.length > 0) {
              setPostAddPrompt(newCarts);
            }
          }
        }}
      />

      {postAddPrompt && (
        <PrintConfirmPrompt
          count={postAddPrompt.length}
          workOrder={detail.lot.work_order_barcode}
          onYes={() => {
            setPrintCarts(postAddPrompt);
            setPostAddPrompt(null);
          }}
          onNo={() => setPostAddPrompt(null)}
        />
      )}

      <ReprintPickerDialog
        open={reprintOpen}
        subLots={detail.sub_lots}
        onClose={() => setReprintOpen(false)}
        onConfirm={(picked) => {
          setReprintOpen(false);
          setPrintCarts(picked);
        }}
      />

      {printCarts && (
        <CartStickerSheet
          carts={printCarts}
          workOrderBarcode={detail.lot.work_order_barcode}
          skuCode={detail.lot.sku_code}
          skuName={detail.lot.sku_name ?? ''}
          onClose={() => setPrintCarts(null)}
        />
      )}
    </div>
  );
}

/** Small Yes/No dialog asked right after "Add carts" succeeds, so the
 *  operator can immediately fire the sticker print job without hunting for
 *  the Reprint button. */
function PrintConfirmPrompt({
  count, workOrder, onYes, onNo,
}: {
  count: number;
  workOrder: string;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        onClick={onNo}
        aria-label="Skip printing"
      />
      <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl">
        <header className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
            <Printer size={18} />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Print stickers?</p>
            <h2 className="text-base font-bold text-slate-900 font-mono">{workOrder}</h2>
          </div>
        </header>
        <div className="px-5 py-4 text-sm text-slate-700">
          Added <strong>{count}</strong> cart{count === 1 ? '' : 's'}. Print sticker{count === 1 ? '' : 's'} now?
          <p className="text-xs text-slate-500 mt-2">
            You can also reprint later via the <em>Reprint sticker</em> button.
          </p>
        </div>
        <footer className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2 bg-slate-50 rounded-b-2xl">
          <button
            type="button"
            onClick={onNo}
            className="px-4 py-2 rounded-lg text-xs font-bold border border-slate-300 text-slate-700 hover:bg-white"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={onYes}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white"
          >
            <Printer size={13} /> Print {count} sticker{count === 1 ? '' : 's'}
          </button>
        </footer>
      </div>
    </div>
  );
}

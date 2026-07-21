import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, History, Plus, Printer, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { productionLotDetail, ProductionLotDetail, formatQcDateTime, SubLot, listSubLotsForLot, deleteProductionLot } from '../../services/qcApi';
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

interface Props {
  lotId: string;
  onBack: () => void;
  onOpenHistory?: (subLotId: string) => void;
}

export default function TracePage({ lotId, onBack, onOpenHistory }: Props) {
  const { t } = useTranslation('qc');
  const { can } = usePermissions();
  const canView = can('production', 'trace', 'view');
  const canAddCarts = can('production', 'trace', 'add_carts');
  const canReprint = can('production', 'trace', 'reprint_sticker');
  const canDelete = can('production', 'trace', 'delete_work_order');
  const [detail, setDetail] = useState<ProductionLotDetail | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  // Dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [reprintOpen, setReprintOpen] = useState(false);
  const [allSubLots, setAllSubLots] = useState<SubLot[]>([]);
  const [printCarts, setPrintCarts] = useState<SubLot[] | null>(null);
  // After "Add carts" succeeds we stash the newly-added subset here, then
  // pop a Yes/No confirm asking the operator whether to print stickers for
  // them right away.  Decoupled from `printCarts` so the user can decline
  // without losing the option to reprint later via the dedicated button.
  const [postAddPrompt, setPostAddPrompt] = useState<SubLot[] | null>(null);

  // Delete-work-order dialog. Operator must type DELETE to confirm; only
  // available before production starts (no cart scanned into a dryer).
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState('');

  const loadDetail = () => {
    if (!lotId) return;
    productionLotDetail(lotId)
      .then(setDetail)
      .catch((e) => setError(e.message));
  };

  useEffect(() => { loadDetail(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [lotId]);

  // Prefer the server-computed max_seq; fall back to scanning visible
  // sub_lots if the RPC didn't emit it (e.g. stale build before M-099).
  const maxSeq = useMemo(() => {
    if (!detail) return 0;
    if (typeof detail.lot.max_seq === 'number') return detail.lot.max_seq;
    return detail.sub_lots.reduce((m, s) => Math.max(m, parseSeq(s.sub_lot_code)), 0);
  }, [detail]);

  // "Not started" = no cart has been scanned into a dryer yet. The RPC enforces
  // the full invariant (all carts 'created', no groups/samples/inspections); this
  // is the front-end gate for showing the Delete button.
  const notStarted = (detail?.lot.scanned_count ?? 0) === 0;

  const handleDelete = async () => {
    if (!detail || deleteText.trim().toUpperCase() !== 'DELETE') return;
    setDeleting(true);
    setDeleteErr('');
    try {
      await deleteProductionLot(detail.lot.id);
      setDeleteOpen(false);
      onBack();                       // back to the (freshly reloaded) trace list
    } catch (e) {
      setDeleteErr(e instanceof Error ? e.message : t('tracePage.deleteFailed'));
      setDeleting(false);
    }
  };

  if (!canView) {
    return <PermissionDenied permission="production.trace.view" feature={t('tracePage.featureBatchTrace')} />;
  }

  if (!detail) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <button onClick={onBack} className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-900 mb-4">
          <ArrowLeft size={14} /> {t('tracePage.backToTraceList')}
        </button>
        {error ? <p className="text-red-600 text-sm">{error}</p> : <p className="text-slate-400 text-sm">{t('tracePage.loading')}</p>}
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <button onClick={onBack} className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-900 mb-4">
        <ArrowLeft size={14} /> {t('tracePage.backToTraceList')}
      </button>

      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {t('tracePage.titlePrefix')} · {detail.lot.lot_number}
            {typeof detail.lot.scanned_count === 'number' && typeof detail.lot.total_count === 'number' && (
              <span
                className={
                  'ml-2 align-middle text-xs font-bold font-mono px-2 py-0.5 rounded ' +
                  (detail.lot.total_count > 0 && detail.lot.scanned_count >= detail.lot.total_count
                    ? 'bg-slate-100 text-slate-500'
                    : 'bg-amber-100 text-amber-800')
                }
                title={
                  detail.lot.scanned_count >= detail.lot.total_count
                    ? t('tracePage.allCartsScannedIn')
                    : t('tracePage.cartsStillOnFloor', { count: detail.lot.total_count - detail.lot.scanned_count })
                }
              >
                {detail.lot.scanned_count}/{detail.lot.total_count}
              </span>
            )}
          </h1>
          <p className="text-slate-600 mt-1 text-sm">{detail.lot.sku_name}</p>
        </div>
        <div className="flex items-center gap-2">
          {canAddCarts && (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white"
            >
              <Plus size={12} /> {t('tracePage.addCarts')}
            </button>
          )}
          {canReprint && (
            <button
              type="button"
              onClick={async () => {
                const lots = await listSubLotsForLot(detail.lot.id).catch(() => detail.sub_lots);
                setAllSubLots(lots.length > 0 ? lots : detail.sub_lots);
                setReprintOpen(true);
              }}
              disabled={maxSeq === 0}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-white disabled:opacity-40"
            >
              <Printer size={12} /> {t('tracePage.reprintSticker')}
            </button>
          )}
          {canDelete && notStarted && (
            <button
              type="button"
              onClick={() => { setDeleteText(''); setDeleteErr(''); setDeleteOpen(true); }}
              title={t('tracePage.deleteWorkOrderHint')}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded bg-white border border-red-200 text-red-600 hover:bg-red-50"
            >
              <Trash2 size={12} /> {t('tracePage.deleteWorkOrder')}
            </button>
          )}
        </div>
      </div>

      {msg && <p className="text-emerald-700 bg-emerald-50 p-2 rounded-lg mb-3 text-sm">{msg}</p>}

      {/*
        M-152: Drying sub-lots is the single timeline entry point for Batch
        Trace. ALL carts on the WO are listed (including those not yet scanned
        — their status badge reads "Created"). Per-cart events live in the
        History drawer, so the page no longer renders a separate Quality
        events list.
      */}
      <h2 className="font-semibold mb-2 text-slate-900 text-sm">{t('tracePage.dryingSubLots')}</h2>
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
                {t('tracePage.inLabel')} {formatQcDateTime(s.in_time)} · {t('tracePage.outLabel')} {formatQcDateTime(s.out_time)}
              </p>
            </button>
            {onOpenHistory && (
              <button
                type="button"
                onClick={() => onOpenHistory(s.id)}
                title={t('tracePage.viewFullHistory')}
                className="text-[10px] font-bold px-2 py-1 rounded border border-slate-200 hover:border-blue-400 hover:text-blue-700 text-slate-500 flex items-center gap-1 shrink-0"
              >
                <History size={10} /> {t('tracePage.history')}
              </button>
            )}
          </li>
        ))}
      </ul>

      {deleteOpen && detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <AlertTriangle size={18} className="text-red-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">{t('tracePage.deleteWorkOrder')}</h3>
                <p className="text-sm text-slate-600 mt-0.5">
                  {t('tracePage.deleteConfirmBody', { wo: detail.lot.work_order_barcode, count: detail.lot.total_count ?? 0 })}
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-500 mb-2">
              {t('tracePage.deleteTypePrompt')} <span className="font-mono font-bold text-slate-700">DELETE</span>
            </p>
            <input
              type="text"
              autoFocus
              value={deleteText}
              onChange={(e) => setDeleteText(e.target.value)}
              placeholder="DELETE"
              className="w-full h-9 px-3 rounded-lg border border-slate-300 text-sm focus:outline-none focus:border-red-400 mb-3"
            />

            {deleteErr && <p className="text-red-600 text-xs mb-3">{deleteErr}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setDeleteOpen(false); setDeleteText(''); setDeleteErr(''); }}
                disabled={deleting}
                className="px-3 py-1.5 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                {t('tracePage.cancel')}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting || deleteText.trim().toUpperCase() !== 'DELETE'}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold bg-red-600 text-white hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                {t('tracePage.deleteWorkOrder')}
              </button>
            </div>
          </div>
        </div>
      )}

      <AddCartsDialog
        open={addOpen}
        lotId={detail.lot.id}
        lotBarcode={detail.lot.work_order_barcode}
        existingMaxSeq={maxSeq}
        onClose={() => setAddOpen(false)}
        onSuccess={async (res) => {
          setMsg(t('tracePage.addedCartsMsg', { count: res.added_count, start: `${detail.lot.work_order_barcode}-${String(res.start_seq).padStart(3, '0')}`, end: `-${String(res.end_seq).padStart(3, '0')}` }));
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
        subLots={allSubLots}
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
  const { t } = useTranslation('qc');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        onClick={onNo}
        aria-label={t('tracePage.skipPrinting')}
      />
      <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl">
        <header className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
            <Printer size={18} />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{t('tracePage.printStickersTitle')}</p>
            <h2 className="text-base font-bold text-slate-900 font-mono">{workOrder}</h2>
          </div>
        </header>
        <div className="px-5 py-4 text-sm text-slate-700">
          {t('tracePage.printConfirmBody', { count })}
          <p className="text-xs text-slate-500 mt-2">
            {t('tracePage.reprintLaterHint')}
          </p>
        </div>
        <footer className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2 bg-slate-50 rounded-b-2xl">
          <button
            type="button"
            onClick={onNo}
            className="px-4 py-2 rounded-lg text-xs font-bold border border-slate-300 text-slate-700 hover:bg-white"
          >
            {t('tracePage.skip')}
          </button>
          <button
            type="button"
            onClick={onYes}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white"
          >
            <Printer size={13} /> {t('tracePage.printNStickers', { count })}
          </button>
        </footer>
      </div>
    </div>
  );
}

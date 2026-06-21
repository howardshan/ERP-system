import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, AlertTriangle, CheckCircle2, LogOut, FlaskConical, RefreshCw } from 'lucide-react';
import { checkOutSubLotsBulk, SubLot, BulkCheckOutResult, SamplingMethod } from '../../../services/qcApi';
import { planSamplingGroups, championOf, PlannedGroup } from '../../../lib/qcSampling';
import { cn } from '../../../lib/utils';

interface Props {
  open: boolean;
  selectedSubLots: SubLot[];       // eligible drying carts the user picked
  ineligibleSubLots?: SubLot[];    // carts that failed scan/eligibility checks
  onClose: () => void;
  onSuccess: (result: BulkCheckOutResult) => void;
}

interface PreviewBucket {
  key: string;
  productLotLabel: string;
  skuName: string;
  sampleN: number;
  isRedry: boolean;
  originalGroupLabel?: string;
  groups: PlannedGroup<SubLot>[];
  cartCount: number;
}

const METHOD_OPTIONS: { value: SamplingMethod; titleKey: string; descriptionKey: string }[] = [
  {
    value: 'method_2',
    titleKey: 'bulkCheckOutDialog.method2Title',
    descriptionKey: 'bulkCheckOutDialog.method2Description',
  },
  {
    value: 'method_1',
    titleKey: 'bulkCheckOutDialog.method1Title',
    descriptionKey: 'bulkCheckOutDialog.method1Description',
  },
];

export function BulkCheckOutDialog({
  open, selectedSubLots, ineligibleSubLots = [], onClose, onSuccess,
}: Props) {
  const { t } = useTranslation('qc');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [samplingMethod, setSamplingMethod] = useState<SamplingMethod>('method_2');

  // Classify carts
  const freshCarts  = useMemo(() => selectedSubLots.filter(s => !s.test_group_id), [selectedSubLots]);
  const redryCarts  = useMemo(() => selectedSubLots.filter(s => !!s.test_group_id), [selectedSubLots]);
  const hasMix      = freshCarts.length > 0 && redryCarts.length > 0;
  const hasRedry    = redryCarts.length > 0;

  // Build group preview by bucket. Buckets mirror the SQL's GROUP BY:
  //   • fresh  → production_lot_id
  //   • redry  → (production_lot_id, original test_group_id)
  // Within each bucket we sort by sub_lot_code ascending then run
  // planSamplingGroups (mirrors qc_check_out_sub_lots_bulk in M-110).
  const previewBuckets = useMemo<PreviewBucket[]>(() => {
    const bucketMap = new Map<string, { carts: SubLot[]; meta: Omit<PreviewBucket, 'groups' | 'cartCount'> }>();

    const addCart = (key: string, cart: SubLot, mk: () => PreviewBucket) => {
      const existing = bucketMap.get(key);
      if (existing) {
        existing.carts.push(cart);
      } else {
        const base = mk();
        bucketMap.set(key, {
          carts: [cart],
          meta: {
            key: base.key,
            productLotLabel: base.productLotLabel,
            skuName: base.skuName,
            sampleN: base.sampleN,
            isRedry: base.isRedry,
            originalGroupLabel: base.originalGroupLabel,
          },
        });
      }
    };

    for (const s of freshCarts) {
      const key = `fresh:${s.production_lot_id}`;
      addCart(key, s, () => ({
        key,
        productLotLabel: s.lot_number ?? s.lot_barcode ?? '—',
        skuName: s.sku_name ?? '—',
        sampleN: Math.max(1, s.sample_every_n_carts ?? 1),
        isRedry: false,
        groups: [],
        cartCount: 0,
      }));
    }
    for (const s of redryCarts) {
      const key = `redry:${s.production_lot_id}:${s.test_group_id}`;
      addCart(key, s, () => ({
        key,
        productLotLabel: s.lot_number ?? s.lot_barcode ?? '—',
        skuName: s.sku_name ?? '—',
        sampleN: Math.max(1, s.sample_every_n_carts ?? 1),
        isRedry: true,
        originalGroupLabel: t('bulkCheckOutDialog.groupNumber', { n: s.test_group_sequence ?? '?' }),
        groups: [],
        cartCount: 0,
      }));
    }

    const out: PreviewBucket[] = [];
    for (const { carts, meta } of bucketMap.values()) {
      const asc = carts.slice().sort((a, b) => a.sub_lot_code.localeCompare(b.sub_lot_code));
      let groups: PlannedGroup<SubLot>[];
      if (meta.isRedry) {
        // Redry keeps the original champion (whichever cart was sampled before),
        // as one group — no re-chunking. Mirrors Step 2b in the SQL.
        const desc = asc.slice().reverse();
        const ci = Math.max(0, desc.findIndex(c => c.is_test_champion));
        groups = [{ members: desc, championIndex: ci }];
      } else {
        groups = planSamplingGroups(asc, meta.sampleN, samplingMethod);
      }
      out.push({ ...meta, cartCount: asc.length, groups });
    }
    return out.sort((a, b) => {
      if (a.isRedry !== b.isRedry) return a.isRedry ? 1 : -1;
      return a.productLotLabel.localeCompare(b.productLotLabel);
    });
  }, [freshCarts, redryCarts, samplingMethod]);

  // Dialog stays mounted across open/close — reset transient state on reopen so
  // a leftover busy=true (success path doesn't reset it) can't freeze the next
  // check-out on the spinner.
  useEffect(() => {
    if (open) { setBusy(false); setError(''); }
  }, [open]);

  if (!open) return null;

  const total = selectedSubLots.length;
  const brokenCount = ineligibleSubLots.length;
  const totalChampions = previewBuckets.reduce((s, b) => s + b.groups.length, 0);

  const confirm = async () => {
    if (busy || total === 0) return;
    setBusy(true);
    setError('');
    try {
      const result = await checkOutSubLotsBulk({
        sub_lot_ids: selectedSubLots.map(s => s.id),
        sampling_method: samplingMethod,
      });
      setBusy(false);
      onSuccess(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('bulkCheckOutDialog.errorFallback'));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-label={t('bulkCheckOutDialog.close')}
      />
      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl max-h-[90vh] flex flex-col">
        <header className="px-5 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <LogOut size={18} />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{t('bulkCheckOutDialog.confirmBulkCheckOut')}</p>
              <h2 className="text-base font-bold text-slate-900">{t('bulkCheckOutDialog.cartsToTestingQueue', { count: total })}</h2>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100" aria-label={t('bulkCheckOutDialog.close')}>
            <X size={16} />
          </button>
        </header>

        <div className="px-5 py-4 space-y-3 overflow-y-auto">

          {/* ── Mixed fresh + redry warning ───────────────────────────────── */}
          {hasMix && (
            <div className="rounded-xl p-3 border-2 border-amber-400 bg-amber-50 flex gap-2">
              <AlertTriangle size={18} className="text-amber-700 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-bold text-amber-900">{t('bulkCheckOutDialog.mixedSelection')}</p>
                <p className="text-amber-800 text-[12px] mt-0.5">
                  <strong>{freshCarts.length}</strong> {t('bulkCheckOutDialog.newCarts', { count: freshCarts.length })} {t('bulkCheckOutDialog.and')}{' '}
                  <strong>{redryCarts.length}</strong> {t('bulkCheckOutDialog.reDriedCarts', { count: redryCarts.length })} {t('bulkCheckOutDialog.areSelectedTogether')}{' '}
                  {t('bulkCheckOutDialog.theyWillBeGrouped')} <strong>{t('bulkCheckOutDialog.separately')}</strong> {t('bulkCheckOutDialog.reDriedFormOwnGroup')}
                </p>
              </div>
            </div>
          )}

          {/* ── Redry-only notice ─────────────────────────────────────────── */}
          {!hasMix && hasRedry && (
            <div className="rounded-xl p-3 border-2 border-blue-300 bg-blue-50 flex gap-2">
              <RefreshCw size={16} className="text-blue-600 shrink-0 mt-0.5" />
              <p className="text-[12px] text-blue-900">
                <strong>{t('bulkCheckOutDialog.reDriedCartsTitle')}</strong> {t('bulkCheckOutDialog.reDriedCartsNotice')}
              </p>
            </div>
          )}

          {/* ── Totals card ───────────────────────────────────────────────── */}
          <div className={cn(
            'rounded-xl p-4 border-2',
            total === 0 ? 'border-slate-200 bg-slate-50' : 'border-emerald-300 bg-emerald-50',
          )}>
            <div className="flex items-baseline justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-wider font-bold text-emerald-700">{t('bulkCheckOutDialog.totalCarts')}</p>
                <p className="text-3xl font-bold tabular-nums text-slate-900 mt-1">{total}</p>
                {hasRedry && (
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {t('bulkCheckOutDialog.newCount', { count: freshCarts.length })} · <span className="text-blue-600">{t('bulkCheckOutDialog.reDryCount', { count: redryCarts.length })}</span>
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wider font-bold text-emerald-700 flex items-center gap-1">
                  <FlaskConical size={11} /> {t('bulkCheckOutDialog.samplesToTest')}
                </p>
                <p className="text-3xl font-bold tabular-nums text-slate-900 mt-1">{totalChampions}</p>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              {t('bulkCheckOutDialog.totalsHelp')}
            </p>
          </div>

          {/* ── Ineligible carts warning ──────────────────────────────────── */}
          {brokenCount > 0 && (
            <div className="rounded-xl p-3 border-2 border-amber-300 bg-amber-50 flex gap-2">
              <AlertTriangle size={18} className="text-amber-700 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-amber-900">
                  {t('bulkCheckOutDialog.cartsSkipped', { count: brokenCount })}
                </p>
                <ul className="mt-1 space-y-0.5 max-h-32 overflow-auto text-[11px] font-mono">
                  {ineligibleSubLots.map(s => (
                    <li key={s.id} className="text-amber-900">
                      {s.sub_lot_code} <span className="text-amber-600">({s.status})</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* ── Sampling method picker ────────────────────────────────────── */}
          <section className="space-y-1.5">
            <h3 className="text-[10px] uppercase tracking-wider font-bold text-slate-600">{t('bulkCheckOutDialog.samplingMethod')}</h3>
            <ul className="space-y-2">
              {METHOD_OPTIONS.map(o => {
                const selected = samplingMethod === o.value;
                return (
                  <li key={o.value}>
                    <label className={cn(
                      'flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors',
                      selected ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 hover:border-slate-300',
                    )}>
                      <input
                        type="radio"
                        name="sampling-method"
                        checked={selected}
                        onChange={() => setSamplingMethod(o.value)}
                        className="mt-1 accent-emerald-600"
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-900">{t(o.titleKey)}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">{t(o.descriptionKey)}</div>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* ── Group preview ─────────────────────────────────────────────── */}
          {previewBuckets.length > 0 && (
            <section className="border border-slate-200 rounded-lg p-3">
              <h3 className="text-[10px] uppercase tracking-wider font-bold text-slate-600 mb-2 flex items-center gap-1.5">
                {t('bulkCheckOutDialog.groupPreview')}
                <span className="text-slate-400 font-normal">{t('bulkCheckOutDialog.championsHighlighted')}</span>
              </h3>
              <div className="space-y-2">
                {previewBuckets.map(b => (
                  <div key={b.key} className="border border-slate-100 rounded-md overflow-hidden">
                    <div className={cn(
                      'flex items-center gap-2 px-2 py-1.5 text-xs',
                      b.isRedry ? 'bg-blue-50' : 'bg-slate-50',
                    )}>
                      {b.isRedry
                        ? <RefreshCw size={11} className="text-blue-500 shrink-0" />
                        : <FlaskConical size={11} className="text-emerald-600 shrink-0" />
                      }
                      <span className="font-mono font-bold text-slate-800 truncate">{b.productLotLabel}</span>
                      {b.isRedry && b.originalGroupLabel && (
                        <span className="text-[10px] text-blue-600 font-mono">{b.originalGroupLabel} {t('bulkCheckOutDialog.reDrySuffix')}</span>
                      )}
                      <span className="text-[10px] text-slate-500 truncate">{b.skuName}</span>
                      <span className="ml-auto text-[10px] font-mono text-slate-700 shrink-0">
                        {t('bulkCheckOutDialog.cartGroupSummary', { carts: b.cartCount, groups: b.groups.length, n: b.sampleN })}
                      </span>
                    </div>
                    <ul className="divide-y divide-slate-100">
                      {b.groups.map((g, gi) => {
                        const champion = championOf(g);
                        return (
                          <li key={gi} className="px-2 py-1.5">
                            <div className="flex items-center gap-1.5 mb-1 text-[11px]">
                              <span className="text-[9px] uppercase tracking-wider font-bold text-slate-500">{t('bulkCheckOutDialog.groupNumber', { n: gi + 1 })}</span>
                              <span className="text-slate-400">·</span>
                              <span className="text-slate-600">{t('bulkCheckOutDialog.cartCount', { count: g.members.length })}</span>
                              <span className="text-slate-400">·</span>
                              <span className="text-[10px] text-slate-500">{t('bulkCheckOutDialog.champion')}</span>
                              <span className={cn(
                                'font-mono font-bold',
                                b.isRedry ? 'text-blue-700' : 'text-emerald-700',
                              )}>
                                {champion.sub_lot_code}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {g.members.map(m => (
                                <span key={m.id} className={cn(
                                  'font-mono text-[10px] px-1.5 py-0.5 rounded',
                                  m.id === champion.id
                                    ? (b.isRedry
                                        ? 'bg-blue-100 text-blue-800 font-bold'
                                        : 'bg-emerald-100 text-emerald-800 font-bold')
                                    : 'bg-slate-100 text-slate-600',
                                )}>
                                  {m.sub_lot_code}
                                </span>
                              ))}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}

          {error && (
            <p className="text-xs bg-red-50 border border-red-100 text-red-700 rounded p-2">{error}</p>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2 bg-slate-50 rounded-b-2xl shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-bold border border-slate-300 text-slate-700 hover:bg-white"
          >
            {t('bulkCheckOutDialog.cancel')}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy || total === 0}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <CheckCircle2 size={13} />
            {busy ? t('bulkCheckOutDialog.checkingOut') : t('bulkCheckOutDialog.confirmCheckOut', { count: total })}
          </button>
        </footer>
      </div>
    </div>
  );
}

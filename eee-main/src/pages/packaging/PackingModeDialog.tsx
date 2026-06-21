import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, QrCode, CheckCircle2, AlertTriangle, RotateCcw, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { findSubLotByCode } from '../../services/qcApi';
import { dispatchCarts } from '../../services/pkgApi';

// ─────────────────────────────────────────────────────────────────────────────
// Packing mode — camera (phone / tablet) continuous QR scanning.
//  1. Scan the Work Order QR  →  captured as the packing WO.
//  2. Continuously scan cart QRs; each successful scan dispatches that cart to
//     the WO, shows a 1-second success flash, then keeps scanning.
//
// NOTE: the dedicated packing-WO number/field is not built yet (its generation
// is a later step). For now the scanned WO string is recorded on each dispatch
// via the existing `pkg_dispatch_carts` note. Swap to the real field later.
// ─────────────────────────────────────────────────────────────────────────────

type Phase = 'wo' | 'carts';
type Flash = { kind: 'ok' | 'warn' | 'err'; title: string; sub?: string } | null;

const SCANNER_ID = 'packing-qr-reader';

export function PackingModeDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('packaging');
  const [phase, setPhase] = useState<Phase>('wo');
  const [wo, setWo] = useState('');
  const [count, setCount] = useState(0);
  const [recent, setRecent] = useState<{ code: string; ok: boolean }[]>([]);
  const [flash, setFlash] = useState<Flash>(null);
  const [camError, setCamError] = useState('');

  // Refs hold mutable scan state so the (stable) scan callback always reads fresh values.
  const phaseRef = useRef<Phase>('wo');
  const woRef = useRef('');
  const busyRef = useRef(false);              // ignore frames while processing / flashing
  const handledRef = useRef<Set<string>>(new Set());  // codes already dispatched this session
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showFlash = useCallback((f: Flash, holdMs: number) => {
    setFlash(f);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => {
      setFlash(null);
      busyRef.current = false;   // resume scanning after the flash clears
    }, holdMs);
  }, []);

  const onScan = useCallback(async (raw: string) => {
    if (busyRef.current) return;
    const code = raw.trim();
    if (!code) return;
    busyRef.current = true;

    // ── Phase 1: capture the Work Order ──────────────────────────────────────
    if (phaseRef.current === 'wo') {
      woRef.current = code;
      setWo(code);
      phaseRef.current = 'carts';
      setPhase('carts');
      showFlash({ kind: 'ok', title: t('packing.woCaptured'), sub: code }, 900);
      return;
    }

    // ── Phase 2: dispatch each scanned cart ──────────────────────────────────
    if (handledRef.current.has(code)) {
      showFlash({ kind: 'warn', title: t('packing.alreadyScanned'), sub: code }, 1000);
      return;
    }
    try {
      const sl = await findSubLotByCode(code);
      if (!sl) {
        showFlash({ kind: 'err', title: t('packing.notFound'), sub: code }, 1500);
        return;
      }
      await dispatchCarts([sl.id], `packing-wo:${woRef.current}`);
      handledRef.current.add(code);
      setCount(c => c + 1);
      setRecent(r => [{ code: sl.sub_lot_code, ok: true }, ...r].slice(0, 8));
      showFlash({ kind: 'ok', title: t('packing.dispatched'), sub: sl.sub_lot_code }, 1000);
    } catch (e) {
      setRecent(r => [{ code, ok: false }, ...r].slice(0, 8));
      showFlash({ kind: 'err', title: t('packing.dispatchFailed'), sub: e instanceof Error ? e.message : String(e) }, 1800);
    }
  }, [showFlash, t]);

  // Start the camera scanner (lazy-load the library so it stays out of the main bundle).
  useEffect(() => {
    let cancelled = false;
    let instance: { stop: () => Promise<void>; clear: () => void } | null = null;

    (async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (cancelled) return;
        const h5 = new Html5Qrcode(SCANNER_ID, { verbose: false });
        instance = h5 as unknown as { stop: () => Promise<void>; clear: () => void };
        scannerRef.current = instance;
        await h5.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decoded: string) => { void onScan(decoded); },
          () => { /* per-frame decode failure — ignore */ },
        );
      } catch (e) {
        if (!cancelled) setCamError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      if (flashTimer.current) clearTimeout(flashTimer.current);
      const inst = scannerRef.current;
      if (inst) { inst.stop().then(() => inst.clear()).catch(() => {}); }
    };
  }, [onScan]);

  const rescanWo = () => {
    busyRef.current = false;
    woRef.current = '';
    setWo('');
    handledRef.current.clear();
    setCount(0);
    setRecent([]);
    phaseRef.current = 'wo';
    setPhase('wo');
    setFlash(null);
  };

  const flashColor = flash?.kind === 'ok' ? 'bg-emerald-500' : flash?.kind === 'warn' ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2">
          <QrCode size={18} className="text-orange-400" />
          <div>
            <p className="text-sm font-bold">{t('packing.title')}</p>
            <p className="text-[11px] text-slate-400">
              {phase === 'wo' ? t('packing.stepScanWo') : `${t('packing.woLabel')}: ${wo}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {phase === 'carts' && (
            <button onClick={rescanWo} className="flex items-center gap-1 text-xs font-bold text-slate-300 hover:text-white px-2 py-1.5 rounded-lg hover:bg-white/10">
              <RotateCcw size={13} /> {t('packing.changeWo')}
            </button>
          )}
          <button onClick={onClose} className="flex items-center gap-1 text-xs font-bold text-slate-300 hover:text-white px-2 py-1.5 rounded-lg hover:bg-white/10">
            <X size={14} /> {t('packing.exit')}
          </button>
        </div>
      </header>

      {/* Camera viewport */}
      <div className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden">
        <div id={SCANNER_ID} className="w-full h-full [&_video]:w-full [&_video]:h-full [&_video]:object-cover" />

        {camError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center bg-slate-950">
            <AlertTriangle size={28} className="text-amber-400" />
            <p className="text-sm font-bold">{t('packing.cameraError')}</p>
            <p className="text-[11px] text-slate-400">{camError}</p>
            <p className="text-[11px] text-slate-500">{t('packing.cameraHint')}</p>
          </div>
        )}

        {/* aiming frame */}
        {!camError && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="w-60 h-60 rounded-2xl border-2 border-white/70 shadow-[0_0_0_9999px_rgba(2,6,23,.45)]" />
          </div>
        )}

        {/* success / error flash */}
        {flash && (
          <div className="absolute inset-0 flex items-center justify-center px-8">
            <div className={`flex flex-col items-center gap-2 ${flashColor} text-white rounded-2xl px-8 py-6 shadow-2xl animate-in fade-in zoom-in duration-150`}>
              {flash.kind === 'ok' ? <CheckCircle2 size={44} /> : flash.kind === 'warn' ? <AlertTriangle size={44} /> : <AlertTriangle size={44} />}
              <p className="text-lg font-bold">{flash.title}</p>
              {flash.sub && <p className="text-sm font-mono opacity-90 max-w-[80vw] truncate">{flash.sub}</p>}
            </div>
          </div>
        )}
      </div>

      {/* Footer: running tally + recent */}
      <footer className="shrink-0 border-t border-white/10 px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-slate-400">
            {phase === 'wo' ? t('packing.waitingWo') : t('packing.keepScanning')}
          </span>
          <span className="text-sm font-bold">
            {t('packing.dispatchedCount', { count })}
          </span>
        </div>
        <div className="flex gap-1.5 overflow-x-auto">
          {recent.map((r, i) => (
            <span key={i} className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-mono ${r.ok ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}`}>
              {r.ok ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}{r.code}
            </span>
          ))}
        </div>
      </footer>
    </div>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Type, PenLine, Eraser } from 'lucide-react';
import { cn } from '../../../lib/utils';

export type SignatureMode = 'typed' | 'drawn';

export interface SignatureValue {
  type: SignatureMode;
  /** PNG data URL — typed names are rendered to an image too, so consumers (PDF) stay uniform. */
  dataUrl: string;
}

interface Props {
  /** Default full name to pre-fill the typed signature. */
  defaultName: string;
  /** Fires whenever a usable signature exists, or null when cleared/empty. */
  onChange: (value: SignatureValue | null) => void;
  disabled?: boolean;
}

// Render area (CSS px); the canvas backing store is 2× for crispness.
const W = 460;
const H = 150;
const SCALE = 2;

/**
 * Dual-mode signature capture for the QC daily report.
 *  - Typed: full name auto-rendered in a cursive font → PNG.
 *  - Drawn: hand signature via pointer events (Tauri-WebView safe — no banned APIs).
 */
export function SignaturePad({ defaultName, onChange, disabled }: Props) {
  const { t } = useTranslation('qc');
  const [mode, setMode] = useState<SignatureMode>('typed');
  const [typedName, setTypedName] = useState(defaultName);
  const typedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const hasStroke = useRef(false);

  // ── Typed: render name to its canvas whenever name/mode changes ────────────
  useEffect(() => {
    if (mode !== 'typed') return;
    const c = typedCanvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    const name = typedName.trim();
    if (!name) { onChange(null); return; }
    ctx.fillStyle = '#0f172a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `italic ${44 * SCALE}px "Brush Script MT", "Segoe Script", "Snell Roundhand", cursive`;
    ctx.fillText(name, c.width / 2, c.height / 2);
    onChange({ type: 'typed', dataUrl: c.toDataURL('image/png') });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typedName, mode]);

  // ── Drawn: white background once on mount/mode switch ──────────────────────
  useEffect(() => {
    if (mode !== 'drawn') return;
    const c = drawCanvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.lineWidth = 3 * SCALE;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';
    hasStroke.current = false;
    onChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const pointPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = drawCanvasRef.current!;
    const rect = c.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * c.width,
      y: ((e.clientY - rect.top) / rect.height) * c.height,
    };
  };

  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    const ctx = drawCanvasRef.current?.getContext('2d');
    if (!ctx) return;
    drawing.current = true;
    const p = pointPos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
  };

  const moveDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = drawCanvasRef.current?.getContext('2d');
    if (!ctx) return;
    const p = pointPos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    hasStroke.current = true;
  };

  const endDraw = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const c = drawCanvasRef.current;
    if (c && hasStroke.current) {
      onChange({ type: 'drawn', dataUrl: c.toDataURL('image/png') });
    }
  };

  const clearDrawn = () => {
    const c = drawCanvasRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    hasStroke.current = false;
    onChange(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setMode('typed')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-colors',
            mode === 'typed' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
          )}
        >
          <Type size={12} /> {t('dailyTestReport.sigTyped')}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setMode('drawn')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-colors',
            mode === 'drawn' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
          )}
        >
          <PenLine size={12} /> {t('dailyTestReport.sigDrawn')}
        </button>
      </div>

      {mode === 'typed' ? (
        <div className="space-y-2">
          <input
            type="text"
            value={typedName}
            disabled={disabled}
            onChange={e => setTypedName(e.target.value)}
            placeholder={t('dailyTestReport.sigNamePlaceholder')}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <canvas
            ref={typedCanvasRef}
            width={W * SCALE}
            height={H * SCALE}
            style={{ width: W, height: H }}
            className="border-2 border-dashed border-slate-300 rounded-lg bg-white max-w-full"
          />
        </div>
      ) : (
        <div className="space-y-2">
          <canvas
            ref={drawCanvasRef}
            width={W * SCALE}
            height={H * SCALE}
            style={{ width: W, height: H, touchAction: 'none' }}
            className="border-2 border-dashed border-slate-300 rounded-lg bg-white max-w-full cursor-crosshair"
            onPointerDown={startDraw}
            onPointerMove={moveDraw}
            onPointerUp={endDraw}
            onPointerLeave={endDraw}
          />
          <button
            type="button"
            disabled={disabled}
            onClick={clearDrawn}
            className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            <Eraser size={12} /> {t('dailyTestReport.sigClear')}
          </button>
        </div>
      )}
    </div>
  );
}

// Web Audio beep helper for QR-scan warnings (BR-Q34).
//
// We construct a short oscillator burst on demand instead of loading an audio
// file — works offline, no asset bundling needed, and survives autoplay rules
// because it fires in direct response to a user gesture (scan event).
//
// Browsers that block AudioContext outside of user gestures will silently
// no-op; the dialog still shows.

let cachedCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (cachedCtx) return cachedCtx;
  const Ctor = typeof window !== 'undefined'
    ? (window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
    : undefined;
  if (!Ctor) return null;
  try {
    cachedCtx = new Ctor();
  } catch {
    cachedCtx = null;
  }
  return cachedCtx;
}

export function beep(opts: { frequency?: number; durationMs?: number; volume?: number } = {}): void {
  const ctx = getCtx();
  if (!ctx) return;
  const { frequency = 880, durationMs = 220, volume = 0.25 } = opts;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = frequency;
    gain.gain.value = volume;
    osc.connect(gain).connect(ctx.destination);
    const now = ctx.currentTime;
    osc.start(now);
    osc.stop(now + durationMs / 1000);
    // Gentle release tail so the beep doesn't click.
    gain.gain.setValueAtTime(volume, now + (durationMs - 30) / 1000);
    gain.gain.linearRampToValueAtTime(0, now + durationMs / 1000);
  } catch {
    // Best-effort — silently ignore if the audio path fails.
  }
}

// Double-beep — used specifically for duplicate-scan warnings to be unmistakable.
export function warnBeep(): void {
  beep({ frequency: 880, durationMs: 180 });
  setTimeout(() => beep({ frequency: 660, durationMs: 220 }), 200);
}

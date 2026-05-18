import { useEffect, useRef } from 'react';

export function usePolling(callback: () => void | Promise<void>, intervalMs: number, enabled = true) {
  const saved = useRef(callback);
  saved.current = callback;

  useEffect(() => {
    if (!enabled) return;
    const tick = () => void saved.current();
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
}

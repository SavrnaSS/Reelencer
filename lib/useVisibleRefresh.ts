"use client";

import { useEffect } from "react";

/** One request at a time; hidden tabs pause and focus only refreshes overdue data. */
export function useVisibleRefresh(refresh: () => Promise<unknown>, intervalMs: number | null) {
  useEffect(() => {
    let disposed = false;
    let running = false;
    let lastStarted = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      clearTimeout(timer);
      if (disposed || document.hidden || running) return;
      if (intervalMs === null && lastStarted) return;
      const remaining = (intervalMs ?? 0) - (Date.now() - lastStarted);
      if (remaining > 0) {
        timer = setTimeout(() => void tick(), remaining);
        return;
      }
      running = true;
      lastStarted = Date.now();
      try { await refresh(); } catch { /* Keep saved data on a background failure. */ }
      finally {
        running = false;
        if (!disposed && !document.hidden && intervalMs !== null) timer = setTimeout(() => void tick(), Math.max(1, intervalMs - (Date.now() - lastStarted)));
      }
    };
    const wake = () => { void tick(); };
    queueMicrotask(wake);
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [refresh, intervalMs]);
}

"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Mount nearby content once, preserving its state when it scrolls out of view. */
export default function DeferredPayoutContent({ children, fallback, eager = false }: { children: ReactNode; fallback: ReactNode; eager?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(eager);

  useEffect(() => {
    if (visible) return;
    let disposed = false;
    let observer: IntersectionObserver | undefined;
    const reveal = () => {
      if (disposed) return;
      observer?.disconnect();
      setVisible(true);
    };

    if (eager || typeof window.IntersectionObserver !== "function" || !container.current) {
      queueMicrotask(reveal);
    } else {
      observer = new window.IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) reveal();
      }, { rootMargin: "240px" });
      observer.observe(container.current);
    }

    return () => {
      disposed = true;
      observer?.disconnect();
    };
  }, [eager, visible]);

  return <div ref={container}>{visible ? children : fallback}</div>;
}

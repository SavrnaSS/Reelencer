"use client";

import { useEffect, useRef, type ReactNode } from "react";

export default function AdminNavigationDrawer({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus({ preventScroll: true });
    });
    const desktop = window.matchMedia("(min-width: 1024px)");
    const resize = () => { if (desktop.matches) onClose(); };
    desktop.addEventListener("change", resize);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      desktop.removeEventListener("change", resize);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] lg:hidden">
      <div aria-hidden="true" className="absolute inset-0 bg-[#0f1411]/45 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={panelRef}
        id="admin-navigation-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Admin navigation"
        tabIndex={-1}
        className="absolute inset-y-0 left-0 w-[min(320px,90vw)] shadow-xl outline-none"
        style={{ paddingTop: "env(safe-area-inset-top)", height: "100dvh" }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
          if (event.key !== "Tab") return;
          const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), [tabindex="0"]') ?? [])
            .filter((item) => item.getClientRects().length > 0);
          const first = items[0];
          const last = items[items.length - 1];
          if (!first) { event.preventDefault(); panelRef.current?.focus(); return; }
          if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
            event.preventDefault(); last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first.focus();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}

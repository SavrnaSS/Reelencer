"use client";

import { useEffect, useState } from "react";

type Item = { id: string; title: string };

/**
 * Contents for the privacy policy: a sticky list beside the text on large screens and a collapsible
 * "On this page" menu above it on phones. The section in view is highlighted, and a thin bar shows reading progress.
 */
export default function PrivacyToc({ items }: { items: Item[] }) {
  const [active, setActive] = useState(items[0]?.id ?? "");
  const [progress, setProgress] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const sections = items.map((item) => document.getElementById(item.id)).filter((el): el is HTMLElement => !!el);
    // The last heading above the upper third of the screen is the one being read.
    const update = () => {
      const line = window.innerHeight * 0.3;
      let current = sections[0]?.id ?? "";
      for (const section of sections) if (section.getBoundingClientRect().top <= line) current = section.id;
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      setActive(atEnd ? sections[sections.length - 1]?.id ?? current : current);
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [items]);

  const activeIndex = Math.max(0, items.findIndex((item) => item.id === active));
  const list = (onPick?: () => void) => (
    <ol className="grid gap-0.5">
      {items.map((item, index) => {
        const current = item.id === active;
        return (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              onClick={onPick}
              aria-current={current ? "location" : undefined}
              className={`group flex items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] leading-5 transition ${
                current ? "bg-[#e8f3ea] font-semibold text-[#173d2a]" : "text-[#5b665f] hover:bg-[#f1f4f0] hover:text-[#1a201c]"
              }`}
            >
              <span className={`mt-px w-5 shrink-0 text-right text-[11px] tabular-nums ${current ? "text-[#2e7d4f]" : "text-[#a3aaa4]"}`}>{index + 1}</span>
              <span className="min-w-0">{item.title}</span>
            </a>
          </li>
        );
      })}
    </ol>
  );

  return (
    <>
      <div aria-hidden="true" className="fixed inset-x-0 top-0 z-50 h-[3px] bg-transparent print:hidden">
        <div className="h-full origin-left bg-[#58b52d] transition-transform duration-150" style={{ transform: `scaleX(${progress})` }} />
      </div>

      {/* Phones and tablets: a sticky bar that opens the full list. */}
      <div className="sticky top-0 z-40 -mx-4 border-b border-[#e3e7e2] bg-white/90 px-4 backdrop-blur sm:-mx-6 sm:px-6 lg:hidden print:hidden">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="privacy-toc-mobile"
          className="flex min-h-12 w-full items-center gap-3 text-left"
        >
          <span className="shrink-0 rounded-md bg-[#e8f3ea] px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-[#2e7d4f]">
            {activeIndex + 1}/{items.length}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-[#1a201c]">{items[activeIndex]?.title}</span>
          <span className="shrink-0 text-[12px] font-medium text-[#5b665f]">{open ? "Close" : "Contents"}</span>
          <svg viewBox="0 0 20 20" className={`h-4 w-4 shrink-0 text-[#5b665f] transition ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="m5 7.5 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {open ? (
          <nav id="privacy-toc-mobile" aria-label="Privacy policy contents" className="max-h-[60vh] overflow-y-auto pb-3">
            {list(() => setOpen(false))}
          </nav>
        ) : null}
      </div>

      {/* Large screens: sticky beside the text. */}
      <nav aria-label="Privacy policy contents" className="sticky top-8 hidden max-h-[calc(100vh-4rem)] overflow-y-auto pr-2 lg:block print:hidden">
        <div className="mb-2 px-2.5 text-[11px] font-bold uppercase tracking-[0.16em] text-[#8a928c]">On this page</div>
        {list()}
        <div className="mx-2.5 mt-4 h-1 overflow-hidden rounded-full bg-[#eef1ed]">
          <div className="h-full rounded-full bg-[#2e7d4f] transition-[width] duration-150" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <div className="mt-1.5 px-2.5 text-[11px] tabular-nums text-[#8a928c]">{Math.round(progress * 100)}% read</div>
      </nav>
    </>
  );
}

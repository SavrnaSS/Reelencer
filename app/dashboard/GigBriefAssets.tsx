"use client";

/* eslint-disable @next/next/no-img-element -- Admin uploads may use any media host; preserve the original image without an optimizer allowlist. */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { parseGigBriefAssets, type GigBriefAsset } from "@/lib/gigBriefMedia";
import { buttonClassName, cx, Icon } from "./dashboardUi";

const assetLabel = (asset: GigBriefAsset, index: number) => `${asset.kind === "image" ? "Picture" : asset.kind === "video" ? "Video" : "File"} ${index + 1}`;

function MediaGlyph({ video = false, className = "h-6 w-6" }: { video?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {video ? <path d="m9 5 10 7-10 7V5Z" /> : <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 3-3 6 6" /></>}
    </svg>
  );
}

function AssetPreview({ asset, label }: { asset: GigBriefAsset; label: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-[#f2f4ef]">
      {asset.kind === "image" && !failed ? (
        <img src={asset.url} alt={label} loading="lazy" decoding="async" onError={() => setFailed(true)} className="h-full w-full object-contain p-2 transition-transform duration-200 motion-safe:group-hover:scale-[1.02]" />
      ) : (
        <div className="flex flex-col items-center gap-2 px-4 text-center text-[#41695a]">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-white shadow-sm"><MediaGlyph video={asset.kind === "video"} /></span>
          <span className="text-[12px]">{failed ? "Preview unavailable" : asset.kind === "video" ? "Play reference video" : "Open reference file"}</span>
        </div>
      )}
      <span className="absolute right-2 top-2 rounded-md bg-white/95 p-1.5 text-[#2b5d4a] shadow-sm" aria-hidden="true">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="h-3.5 w-3.5"><path d="M7 3H3v4m10-4h4v4M3 13v4h4m10-4v4h-4" /></svg>
      </span>
    </div>
  );
}

/** Native modal supplies focus containment, an inert background and Escape support, including on mobile. */
function AssetViewer({ assets, index, onIndex, onClose }: { assets: GigBriefAsset[]; index: number; onIndex: (index: number) => void; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const headingId = useId();
  const asset = assets[index];
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const go = (delta: number) => onIndex((index + delta + assets.length) % assets.length);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    return () => { dialog?.close(); document.body.style.overflow = previousOverflow; };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      onCancel={event => { event.preventDefault(); onClose(); }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Tab" && !event.ctrlKey && !event.altKey && !event.metaKey) {
          const controls = [...event.currentTarget.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), video[controls]")].filter(control => control.getClientRects().length > 0);
          const first = controls[0], last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          return;
        }
        // Preserve native seeking/volume keys while a video control has focus.
        if ((event.target as HTMLElement).tagName === "VIDEO" || assets.length < 2 || event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); go(event.key === "ArrowRight" ? 1 : -1); }
      }}
      className="fixed inset-0 m-0 h-[100dvh] max-h-none w-screen max-w-none border-0 bg-[#0d1510] p-0 text-white backdrop:bg-black/80"
    >
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6">
          <div className="min-w-0 flex-1">
            <h3 id={headingId} className="text-[14px] font-semibold">{assetLabel(asset, index)} <span className="font-normal text-white/60">of {assets.length}</span></h3>
            <p className="mt-0.5 truncate text-[12px] text-white/60" title={asset.name}>{asset.name}</p>
          </div>
          <a href={asset.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold text-white transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white">
            Open original <Icon.External className="h-3.5 w-3.5" />
          </a>
          <button type="button" autoFocus onClick={onClose} aria-label="Close reference viewer" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white"><Icon.Close className="h-5 w-5" /></button>
        </header>

        <div
          className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3 sm:p-6"
          onTouchStart={event => {
            touchStart.current = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
          }}
          onTouchEnd={event => {
            const start = touchStart.current, end = event.changedTouches[0];
            touchStart.current = null;
            if (asset.kind !== "image" || !start || !end || assets.length < 2) return;
            const dx = end.clientX - start.x, dy = end.clientY - start.y;
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
          }}
        >
          {failedUrl === asset.url ? (
            <p role="status" className="max-w-sm text-center text-[14px] leading-6 text-white/75">This preview could not load. Use Open original to view the file.</p>
          ) : asset.kind === "image" ? (
            <img key={asset.url} src={asset.url} alt={`${assetLabel(asset, index)}: ${asset.name}`} onError={() => setFailedUrl(asset.url)} className="max-h-full max-w-full object-contain" />
          ) : (
            <video key={asset.url} src={asset.url} controls playsInline preload="metadata" onError={() => setFailedUrl(asset.url)} className="max-h-full max-w-full rounded-lg" />
          )}
        </div>

        <footer className="shrink-0 border-t border-white/10 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
          <div className="flex items-center justify-center gap-4">
            {assets.length > 1 ? <button type="button" onClick={() => go(-1)} aria-label="Previous reference" className="grid h-11 w-11 place-items-center rounded-full bg-white/10 hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white"><Icon.ChevronLeft className="h-5 w-5" /></button> : null}
            <p aria-live="polite" aria-atomic="true" className="min-w-16 text-center text-[13px] tabular-nums">{index + 1} / {assets.length}</p>
            {assets.length > 1 ? <button type="button" onClick={() => go(1)} aria-label="Next reference" className="grid h-11 w-11 place-items-center rounded-full bg-white/10 hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white"><Icon.ChevronRight className="h-5 w-5" /></button> : null}
          </div>
          {assets.length > 1 ? <p className="mt-2 text-center text-[11px] text-white/50">Use the arrows or swipe pictures to browse</p> : null}
        </footer>
      </div>
    </dialog>
  );
}

/** Approved-only brief assets, distinct from the public sample reels. The caller controls approval access. */
export default function GigBriefAssets({ requirements, company, forReels = false, embedded = false }: { requirements: string[]; company?: string; forReels?: boolean; embedded?: boolean }) {
  const assets = useMemo(() => parseGigBriefAssets(requirements), [requirements]);
  const previewable = useMemo(() => assets.filter(asset => asset.kind !== "file"), [assets]);
  const [openUrl, setOpenUrl] = useState<string | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const headingId = useId();
  const openIndex = previewable.findIndex(asset => asset.url === openUrl);
  const close = useCallback(() => {
    setOpenUrl(null);
    requestAnimationFrame(() => triggerRef.current?.isConnected && triggerRef.current.focus());
  }, []);
  if (!assets.length) return null;
  const pictures = assets.filter(asset => asset.kind === "image").length;
  const description = forReels
    ? pictures
      ? "Show these pictures in your reel as described in the brief. Open a preview to see every detail."
      : "Follow these references when making your reel. Open a preview or the original file for the full details."
    : "Review the files shared for your approved gig. Open a preview or the original file for the full details.";

  return (
    <section aria-labelledby={headingId} className={cx("min-w-0 bg-white p-4 sm:p-5", embedded ? "border-b border-[#e3efe0]" : "gig-detail-card")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#2e7d4f]">Shared by {company || "the hiring team"}</div>
          <h3 id={headingId} className="text-[16px] font-semibold text-[#1a201c]">{forReels ? "References for your reel" : "Your reference files"}</h3>
        </div>
        <span className="rounded-full bg-[#eef6ec] px-2.5 py-1 text-[11.5px] font-semibold text-[#2b5d4a]">{pictures ? `${pictures} ${pictures === 1 ? "picture" : "pictures"}${assets.length > pictures ? ` · ${assets.length - pictures} more` : ""}` : `${assets.length} ${assets.length === 1 ? "file" : "files"}`}</span>
      </div>
      <p className="mt-1.5 max-w-[65ch] text-[13px] leading-5 text-[#616a64]">{description}</p>
      <ul aria-label="Gig reference files" className="mt-4 grid min-w-0 gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 13rem), 1fr))" }}>
        {assets.map((asset, index) => (
          <li key={asset.url} className="group min-w-0 overflow-hidden rounded-xl border border-[#e3e7df]">
            {asset.kind === "file" ? (
              <a href={asset.url} target="_blank" rel="noopener noreferrer" className="block w-full text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#2e7d4f]" aria-label={`Open ${assetLabel(asset, index)}: ${asset.name}`}>
                <AssetPreview asset={asset} label={assetLabel(asset, index)} />
              </a>
            ) : (
              <button type="button" onClick={event => { triggerRef.current = event.currentTarget; setOpenUrl(asset.url); }} aria-label={`View ${assetLabel(asset, index).toLowerCase()}: ${asset.name}`} aria-haspopup="dialog" className="block w-full text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#2e7d4f]">
                <AssetPreview asset={asset} label={assetLabel(asset, index)} />
              </button>
            )}
            <div className="flex min-w-0 items-center justify-between gap-2 border-t border-[#e3e7df] px-3 py-2.5">
              <div className="min-w-0"><div className="text-[12px] font-semibold text-[#1a201c]">{assetLabel(asset, index)}</div><div className="mt-0.5 truncate text-[11px] text-[#7a827c]" title={asset.name}>{asset.name}</div></div>
              <a href={asset.url} target="_blank" rel="noopener noreferrer" className={buttonClassName("plain", "sm", "min-h-11 min-w-11 shrink-0")} aria-label={`Open original ${assetLabel(asset, index).toLowerCase()}`} title="Open original"><Icon.External className="h-4 w-4" /></a>
            </div>
          </li>
        ))}
      </ul>
      {/* A removed asset or changed approval unmounts the viewer instead of retaining stale media. */}
      {openIndex >= 0 ? createPortal(<AssetViewer assets={previewable} index={openIndex} onIndex={index => setOpenUrl(previewable[index].url)} onClose={close} />, document.body) : null}
    </section>
  );
}

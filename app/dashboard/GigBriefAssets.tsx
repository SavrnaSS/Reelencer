"use client";

/* eslint-disable @next/next/no-img-element -- Admin uploads may use any media host; preserve the original image without an optimizer allowlist. */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { briefAssetDownloadUrl, describeAssetShape, parseGigBriefAssets, type GigBriefAsset, type ReelExample } from "@/lib/gigBriefMedia";
import { parseReelKit } from "@/lib/reelKit";
import { buttonClassName, cx, Icon } from "./dashboardUi";
import BriefUsageGuide from "./BriefUsageGuide";
import ReelKitPanel from "./ReelKitPanel";

type Size = { width: number; height: number };
type ViewMode = "original" | "reel";

const assetLabel = (asset: GigBriefAsset, index: number) => `${asset.kind === "image" ? "Picture" : asset.kind === "video" ? "Video" : "File"} ${index + 1}`;

function shapeLabel(size?: Size) {
  const shape = size && describeAssetShape(size.width, size.height);
  if (!shape) return null;
  return `${shape.orientation}${shape.ratio ? ` ${shape.ratio}` : ""} · ${size.width} × ${size.height}`;
}

/** What a creator should expect when this picture goes into a vertical reel. */
function reelFitTip(size?: Size) {
  const shape = size && describeAssetShape(size.width, size.height);
  if (!shape) return "Preview how this sits in a vertical reel.";
  if (shape.ratio === "9:16") return "Fills the reel edge to edge.";
  if (shape.orientation === "Vertical") return "Almost full screen, with slim bars.";
  if (shape.orientation === "Square") return "Sits mid-screen with space above and below.";
  return "Small in a vertical reel. Zoom in or pan across so the details are readable.";
}

function MediaGlyph({ video = false, className = "h-6 w-6" }: { video?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {video ? <path d="m9 5 10 7-10 7V5Z" /> : <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 3-3 6 6" /></>}
    </svg>
  );
}

const DownloadGlyph = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M10 3v10m-4-4 4 4 4-4M4 16h12" />
  </svg>
);

const ExpandGlyph = ({ className = "h-3.5 w-3.5" }: { className?: string }) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className={className} aria-hidden="true">
    <path d="M7 3H3v4m10-4h4v4M3 13v4h4m10-4v4h-4" />
  </svg>
);

/** Downloads where the host allows it (Supabase attachments); otherwise opens the original in a new tab. */
function DownloadLink({ asset, index, className, children }: { asset: GigBriefAsset; index: number; className: string; children: ReactNode }) {
  const href = briefAssetDownloadUrl(asset);
  return (
    <a
      href={href ?? asset.url}
      {...(href ? { download: asset.name } : { target: "_blank", rel: "noopener noreferrer" })}
      aria-label={`${href ? "Download" : "Open original"} ${assetLabel(asset, index).toLowerCase()}: ${asset.name}`}
      className={className}
    >
      {children}
    </a>
  );
}

/**
 * A 9:16 phone frame showing how the picture lands in a reel. "Fit" keeps the whole picture over a blurred copy
 * (the usual edit for landscape screenshots); "fill" shows what a full-screen crop would cut. Shaded bands mark
 * where reel captions and buttons usually cover the video.
 */
function ReelFrame({ src, alt, fill = false, guides = true, className }: { src: string; alt: string; fill?: boolean; guides?: boolean; className?: string }) {
  return (
    <div className={cx("relative isolate aspect-[9/16] overflow-hidden rounded-[1.1rem] bg-[#101814] shadow-[0_10px_30px_-14px_rgba(16,24,20,0.6)] ring-1 ring-black/10", className)}>
      {fill ? null : <img src={src} alt="" aria-hidden="true" loading="lazy" decoding="async" className="absolute inset-0 -z-10 h-full w-full scale-125 object-cover opacity-70 blur-xl" />}
      <img src={src} alt={alt} loading="lazy" decoding="async" className={cx("absolute inset-0 h-full w-full", fill ? "object-cover" : "object-contain")} />
      {guides ? (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute inset-x-0 top-0 h-[11%] border-b border-dashed border-white/40 bg-black/25" />
          <div className="absolute inset-x-0 bottom-0 h-[20%] border-t border-dashed border-white/40 bg-gradient-to-t from-black/60 to-black/20">
            <div className="absolute bottom-[22%] left-[7%] w-[48%] space-y-[6%]">
              <div className="flex items-center gap-[6%]"><span className="aspect-square w-[16%] rounded-full bg-white/80" /><span className="h-1 flex-1 rounded-full bg-white/80" /></div>
              <span className="block h-1 w-[85%] rounded-full bg-white/55" />
            </div>
          </div>
          <div className="absolute bottom-[23%] right-[5%] flex w-[9%] flex-col gap-[0.35rem]">
            {[0, 1, 2].map((dot) => <span key={dot} className="aspect-square w-full rounded-full bg-white/75" />)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The hiring team's own example of the picture inside a reel. Shown as uploaded (no blur or guides): it already is
 * the reel. Gallery cards show a still frame of video examples; the viewer plays them.
 */
function ExampleFrame({ example, alt, company, play = false, className }: { example: ReelExample; alt: string; company: string; play?: boolean; className?: string }) {
  return (
    <div className={cx("relative isolate aspect-[9/16] overflow-hidden rounded-[1.1rem] bg-[#101814] shadow-[0_10px_30px_-14px_rgba(16,24,20,0.6)] ring-1 ring-black/10", className)}>
      {example.kind === "video" ? (
        play ? (
          <video key={example.url} src={example.url} controls autoPlay muted loop playsInline preload="metadata" aria-label={alt} className="absolute inset-0 h-full w-full object-contain" />
        ) : (
          <>
            <video src={`${example.url}#t=0.5`} preload="metadata" muted playsInline disablePictureInPicture tabIndex={-1} aria-hidden="true" className="absolute inset-0 h-full w-full object-contain" />
            <span className="absolute left-1/2 top-1/2 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-[#101814] shadow-lg" aria-hidden="true"><MediaGlyph video className="ml-0.5 h-5 w-5" /></span>
          </>
        )
      ) : (
        <img key={example.url} src={example.url} alt={alt} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-contain" />
      )}
      {play && example.kind === "video" ? null : (
        <span className="absolute bottom-2 left-1/2 max-w-[calc(100%-1rem)] -translate-x-1/2 truncate rounded-full bg-black/65 px-2 py-0.5 text-[10.5px] font-semibold text-white backdrop-blur-sm" title={`Example by ${company}`}>Example</span>
      )}
    </div>
  );
}

function SegmentedToggle<T extends string>({ label, value, options, onChange, dark = false }: { label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void; dark?: boolean }) {
  return (
    <div role="group" aria-label={label} className={cx("inline-flex shrink-0 rounded-lg p-0.5", dark ? "bg-white/10" : "bg-[#eef1ed]")}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cx(
              "min-h-9 rounded-md px-3 text-[12px] font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-1 sm:min-h-8",
              dark
                ? active ? "bg-white text-[#101814]" : "text-white/75 hover:text-white focus-visible:outline-white"
                : active ? "bg-white text-[#1a201c] shadow-[0_1px_2px_rgba(26,32,28,0.12)]" : "text-[#616a64] hover:text-[#1a201c] focus-visible:outline-[#2e7d4f]"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function AssetPreview({ asset, label, mode, featured, company, onSize }: { asset: GigBriefAsset; label: string; mode: ViewMode; featured: boolean; company: string; onSize: (size: Size) => void }) {
  const [failed, setFailed] = useState(false);
  const picture = asset.kind === "image" && !failed;
  const clip = asset.kind === "video" && !failed;
  const framed = mode === "reel" && (picture || clip);
  // Server-rendered images can finish loading before hydration attaches onLoad, so also measure on mount.
  const measure = (image: HTMLImageElement | null) => {
    if (image?.complete && image.naturalWidth) onSize({ width: image.naturalWidth, height: image.naturalHeight });
  };
  return (
    <div
      className={cx(
        "relative flex items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_50%_40%,#f7f9f5,#e9eee6)]",
        framed ? (featured ? "h-full p-4 sm:p-6" : "p-4") : featured ? "h-[clamp(13rem,48vw,26rem)] p-3 sm:p-5" : "aspect-[4/3] p-3"
      )}
    >
      {picture && mode === "reel" && asset.reelExample ? (
        <ExampleFrame example={asset.reelExample} alt={`${label} as it should look in your reel`} company={company} className={cx("w-full", featured ? "max-w-[15rem]" : "max-w-[11.5rem]")} />
      ) : picture && mode === "reel" ? (
        <ReelFrame src={asset.url} alt={label} className={cx("w-full", featured ? "max-w-[15rem]" : "max-w-[11.5rem]")} />
      ) : picture ? (
        <img
          src={asset.url}
          alt={label}
          loading="lazy"
          decoding="async"
          ref={measure}
          onLoad={(event) => measure(event.currentTarget)}
          onError={() => setFailed(true)}
          className="max-h-full max-w-full rounded-md object-contain shadow-[0_1px_2px_rgba(26,32,28,0.08),0_8px_24px_-12px_rgba(26,32,28,0.35)] ring-1 ring-black/5 transition-transform duration-300 motion-safe:group-hover:scale-[1.015]"
        />
      ) : clip ? (
        // Metadata only: the "#t=0.5" frame stands in for a poster without downloading the whole clip.
        <span className={cx("relative grid place-items-center overflow-hidden", mode === "reel" ? "aspect-[9/16] w-full max-w-[11.5rem] rounded-[1.1rem] bg-[#101814] shadow-[0_10px_30px_-14px_rgba(16,24,20,0.6)]" : "h-full w-full")}>
          <video src={`${asset.url}#t=0.5`} preload="metadata" muted playsInline disablePictureInPicture tabIndex={-1} aria-hidden="true" onError={() => setFailed(true)} className={cx("max-h-full max-w-full object-contain", mode === "reel" ? "h-full w-full" : "rounded-md shadow-[0_8px_24px_-12px_rgba(26,32,28,0.35)]")} />
          <span className="absolute grid h-11 w-11 place-items-center rounded-full bg-white/90 text-[#101814] shadow-lg transition-transform duration-300 motion-safe:group-hover:scale-110" aria-hidden="true"><MediaGlyph video className="ml-0.5 h-5 w-5" /></span>
        </span>
      ) : (
        <div className="flex flex-col items-center gap-2 px-4 text-center text-[#41695a]">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-white shadow-sm"><MediaGlyph video={asset.kind === "video"} /></span>
          <span className="text-[12px] font-medium">{failed ? "Preview unavailable" : asset.kind === "video" ? "Play reference video" : "Open reference file"}</span>
        </div>
      )}
      {/* Hidden probe keeps the size label available while the gallery shows reel frames. */}
      {picture && mode === "reel" ? <img src={asset.url} alt="" aria-hidden="true" ref={measure} onLoad={(event) => measure(event.currentTarget)} onError={() => setFailed(true)} className="hidden" /> : null}
      {asset.kind !== "file" ? (
        <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-white/95 px-1.5 py-1 text-[11px] font-semibold text-[#2b5d4a] shadow-sm" aria-hidden="true">
          <ExpandGlyph /><span className="hidden sm:inline">{asset.kind === "video" ? "Play" : "Preview"}</span>
        </span>
      ) : null}
    </div>
  );
}

/** Native modal supplies focus containment, an inert background and Escape support, including on mobile. */
function AssetViewer({ assets, index, sizes, forReels, company, initialMode, onIndex, onClose }: { assets: GigBriefAsset[]; index: number; sizes: Record<string, Size>; forReels: boolean; company: string; initialMode: ViewMode; onIndex: (index: number) => void; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const headingId = useId();
  const asset = assets[index];
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>(initialMode);
  const [fill, setFill] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const go = (delta: number) => { setZoomed(false); onIndex((index + delta + assets.length) % assets.length); };
  const showReel = forReels && mode === "reel" && asset.kind === "image" && failedUrl !== asset.url;
  const shape = shapeLabel(sizes[asset.url]);
  const example = showReel ? asset.reelExample : undefined;

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    return () => { dialog?.close(); document.body.style.overflow = previousOverflow; };
  }, []);

  // Keep the active thumbnail visible in the strip as creators page through.
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    stripRef.current?.querySelector<HTMLElement>("[aria-current='true']")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [index]);

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
        <header className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:gap-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <h3 id={headingId} className="text-[14px] font-semibold">{assetLabel(asset, index)} <span className="font-normal text-white/60">of {assets.length}</span></h3>
            <p className="mt-0.5 truncate text-[12px] text-white/60" title={asset.name}>{shape ?? asset.name}</p>
          </div>
          <DownloadLink asset={asset} index={index} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 text-[12.5px] font-semibold text-[#101814] transition hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
            {briefAssetDownloadUrl(asset) ? <DownloadGlyph /> : <Icon.External className="h-4 w-4" />}
            <span className="hidden min-[400px]:inline">{briefAssetDownloadUrl(asset) ? "Download" : "Open original"}</span>
          </DownloadLink>
          <button type="button" autoFocus onClick={onClose} aria-label="Close reference viewer" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white"><Icon.Close className="h-5 w-5" /></button>
        </header>

        {forReels && asset.kind === "image" && failedUrl !== asset.url ? (
          <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-b border-white/10 px-3 py-2">
            <SegmentedToggle dark label="Preview style" value={mode} onChange={(next) => { setMode(next); setZoomed(false); }} options={[{ value: "original", label: "Original" }, { value: "reel", label: "In a reel" }]} />
            {showReel && !example ? <SegmentedToggle dark label="Reel framing" value={fill ? "fill" : "fit"} onChange={(next) => setFill(next === "fill")} options={[{ value: "fit", label: "Fit" }, { value: "fill", label: "Fill screen" }]} /> : null}
          </div>
        ) : null}

        <div
          className={cx("relative min-h-0 flex-1 p-3 sm:p-6", zoomed ? "overflow-auto" : "flex flex-col items-center justify-center overflow-hidden")}
          onTouchStart={event => {
            touchStart.current = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
          }}
          onTouchEnd={event => {
            const start = touchStart.current, end = event.changedTouches[0];
            touchStart.current = null;
            if (asset.kind !== "image" || zoomed || !start || !end || assets.length < 2) return;
            const dx = end.clientX - start.x, dy = end.clientY - start.y;
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
          }}
        >
          {failedUrl === asset.url ? (
            <p role="status" className="max-w-sm text-center text-[14px] leading-6 text-white/75">This preview could not load. Use {briefAssetDownloadUrl(asset) ? "Download" : "Open original"} to get the file.</p>
          ) : example ? (
            <>
              <ExampleFrame example={example} alt={`${assetLabel(asset, index)} as it should look in your reel`} company={company} play className="max-h-[44rem] min-h-0 w-auto max-w-full flex-1" />
              <p className="mt-3 max-w-sm shrink-0 text-center text-[12px] leading-5 text-white/65">
                {company}&apos;s example of how this picture should look in your reel. Match it in your edit, using the original file for sharp quality.
              </p>
            </>
          ) : showReel ? (
            <>
              <ReelFrame key={asset.url} src={asset.url} alt={`${assetLabel(asset, index)} in a 9:16 reel frame`} fill={fill} className="max-h-[44rem] min-h-0 w-auto max-w-full flex-1" />
              <p className="mt-3 max-w-sm shrink-0 text-center text-[12px] leading-5 text-white/65">
                {fill ? "Filling the screen crops the edges. Keep the important part in the middle." : reelFitTip(sizes[asset.url])} Shaded areas are usually covered by captions and buttons.
              </p>
            </>
          ) : asset.kind === "image" ? (
            <button
              type="button"
              onClick={() => setZoomed(value => !value)}
              aria-pressed={zoomed}
              aria-label={zoomed ? "Fit picture to screen" : "Zoom to full size"}
              className={cx("focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white", zoomed ? "m-auto block cursor-zoom-out" : "flex h-full w-full cursor-zoom-in items-center justify-center")}
            >
              <img key={asset.url} src={asset.url} alt={`${assetLabel(asset, index)}: ${asset.name}`} onError={() => setFailedUrl(asset.url)} className={zoomed ? "block max-w-none" : "max-h-full max-w-full object-contain"} />
            </button>
          ) : (
            <video key={asset.url} src={asset.url} controls playsInline preload="metadata" onError={() => setFailedUrl(asset.url)} className="max-h-full max-w-full rounded-lg" />
          )}
        </div>

        <footer className="shrink-0 border-t border-white/10 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
          {asset.note ? (
            <p className="mx-auto mb-3 line-clamp-3 max-w-xl text-center text-[12.5px] leading-5 text-white/80"><span className="font-semibold text-white">What to show: </span>{asset.note}</p>
          ) : null}
          {assets.length > 1 ? (
            <div ref={stripRef} className="mx-auto mb-3 flex max-w-full gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none] sm:justify-center">
              {assets.map((item, itemIndex) => (
                <button
                  key={item.url}
                  type="button"
                  onClick={() => { setZoomed(false); onIndex(itemIndex); }}
                  aria-current={itemIndex === index ? "true" : undefined}
                  aria-label={`Show ${assetLabel(item, itemIndex).toLowerCase()}`}
                  className={cx("grid h-12 w-16 shrink-0 place-items-center overflow-hidden rounded-md bg-white/10 ring-2 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white", itemIndex === index ? "ring-white" : "opacity-60 ring-transparent hover:opacity-100")}
                >
                  {item.kind === "image" ? <img src={item.url} alt="" loading="lazy" className="h-full w-full object-cover" /> : <MediaGlyph video className="h-5 w-5" />}
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex items-center justify-center gap-4">
            {assets.length > 1 ? <button type="button" onClick={() => go(-1)} aria-label="Previous reference" className="grid h-11 w-11 place-items-center rounded-full bg-white/10 hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white"><Icon.ChevronLeft className="h-5 w-5" /></button> : null}
            <p aria-live="polite" aria-atomic="true" className="min-w-16 text-center text-[13px] tabular-nums">{index + 1} / {assets.length}</p>
            {assets.length > 1 ? <button type="button" onClick={() => go(1)} aria-label="Next reference" className="grid h-11 w-11 place-items-center rounded-full bg-white/10 hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white"><Icon.ChevronRight className="h-5 w-5" /></button> : null}
          </div>
          <p className="mt-2 text-center text-[11px] text-white/50">
            {asset.kind === "image" && !showReel ? "Tap the picture to zoom to full size" : ""}
            {asset.kind === "image" && !showReel && assets.length > 1 ? " · " : ""}
            {assets.length > 1 ? "Use the arrows or swipe to browse" : ""}
          </p>
        </footer>
      </div>
    </dialog>
  );
}

/** Approved-only brief assets, distinct from the public sample reels. The caller controls approval access. */
export default function GigBriefAssets({ requirements, company, creatorName, gigId, forReels = false, embedded = false }: { requirements: string[]; company?: string; creatorName?: string; gigId?: string; forReels?: boolean; embedded?: boolean }) {
  const assets = useMemo(() => parseGigBriefAssets(requirements), [requirements]);
  const kit = useMemo(() => (forReels ? parseReelKit(requirements) : null), [forReels, requirements]);
  const previewable = useMemo(() => assets.filter(asset => asset.kind !== "file"), [assets]);
  const [openUrl, setOpenUrl] = useState<string | null>(null);
  const hasExamples = forReels && assets.some(asset => asset.reelExample);
  // When the hiring team has shown how pictures should look in the reel, lead with that.
  const [mode, setMode] = useState<ViewMode>(hasExamples ? "reel" : "original");
  const [openMode, setOpenMode] = useState<ViewMode>("original");
  const [sizes, setSizes] = useState<Record<string, Size>>({});
  const triggerRef = useRef<HTMLElement | null>(null);
  const headingId = useId();
  const openIndex = previewable.findIndex(asset => asset.url === openUrl);
  const close = useCallback(() => {
    setOpenUrl(null);
    requestAnimationFrame(() => triggerRef.current?.isConnected && triggerRef.current.focus());
  }, []);
  const recordSize = useCallback((url: string, size: Size) => {
    if (size.width > 0 && size.height > 0) setSizes(previous => previous[url]?.width === size.width && previous[url]?.height === size.height ? previous : { ...previous, [url]: size });
  }, []);
  if (!assets.length && !kit) return null;

  const pictures = assets.filter(asset => asset.kind === "image").length;
  const featured = assets.length === 1;
  const reelView = forReels && pictures > 0 && mode === "reel";
  const side = featured && reelView;
  const team = company || "the hiring team";
  const open = (url: string, trigger: HTMLElement, viewMode: ViewMode) => { triggerRef.current = trigger; setOpenMode(viewMode); setOpenUrl(url); };
  const kitExample: ReelExample | undefined = kit?.example
    ? { url: kit.example, kind: /\.(mp4|m4v|mov|webm|ogv)$/i.test(new URL(kit.example).pathname) ? "video" : "image" }
    : assets.find(asset => asset.reelExample)?.reelExample;
  const allDownloadable = assets.length > 1 && assets.every(asset => briefAssetDownloadUrl(asset));
  const description = forReels
    ? pictures
      ? `Show ${pictures === 1 ? "this picture" : "these pictures"} in your reel as described in the brief. Download the original for full quality in your editor.`
      : "Follow these references when making your reel. Open a preview or download the original for the full details."
    : "Review the files shared for your approved gig. Open a preview or download the original for the full details.";

  const downloadAll = () => {
    // Staggered so browsers treat them as separate downloads; each URL is served as an attachment.
    assets.forEach((asset, index) => {
      window.setTimeout(() => {
        const link = document.createElement("a");
        link.href = briefAssetDownloadUrl(asset)!;
        link.download = asset.name;
        document.body.append(link);
        link.click();
        link.remove();
      }, index * 400);
    });
  };

  return (
    <section aria-labelledby={kit && !assets.length ? undefined : headingId} aria-label={kit && !assets.length ? "Reel kit" : undefined} className={cx("min-w-0 bg-white p-4 sm:p-5", embedded ? "border-b border-[#e3efe0]" : "gig-detail-card")}>
      {kit ? <ReelKitPanel kit={kit} example={kitExample} company={team} creatorName={creatorName} storageId={gigId ?? kit.caption} /> : null}
      {assets.length ? <div className={kit ? "mt-6" : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-[1_1_18rem]">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#2e7d4f]">Shared by {team}</span>
            <span className="rounded-full bg-[#eef6ec] px-2 py-0.5 text-[11px] font-semibold text-[#2b5d4a]">{pictures ? `${pictures} ${pictures === 1 ? "picture" : "pictures"}${assets.length > pictures ? ` · ${assets.length - pictures} more` : ""}` : `${assets.length} ${assets.length === 1 ? "file" : "files"}`}</span>
          </div>
          <h3 id={headingId} className="text-[16px] font-semibold text-[#1a201c]">{forReels ? "Pictures to show in your reel" : "Your reference files"}</h3>
          <p className="mt-1 max-w-[62ch] text-[13px] leading-5 text-[#616a64]">{description}</p>
        </div>
        {(forReels && pictures > 0) || allDownloadable ? (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            {forReels && pictures > 0 ? <SegmentedToggle label="Gallery view" value={mode} onChange={setMode} options={[{ value: "original", label: "Original" }, { value: "reel", label: "In a reel" }]} /> : null}
            {allDownloadable ? (
              <button type="button" onClick={downloadAll} className={buttonClassName("secondary", "sm", "h-9 sm:h-8")}>
                <DownloadGlyph className="h-3.5 w-3.5" /> Download all
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {reelView ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-[#f4f8f1] px-3 py-2 text-[12px] leading-5 text-[#3b443e]">
          <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-[3px] border border-dashed border-[#6b756e] bg-[#1a201c]/20" aria-hidden="true" />
          {hasExamples
            ? assets.every(asset => asset.kind !== "image" || asset.reelExample)
              ? `${team} shows how each picture should look in your reel. Download the originals and match these in your edit.`
              : `Pictures marked "Example by ${team}" show exactly how they should look in your reel. The others are previews in a 9:16 frame, where shaded areas are usually covered by captions and buttons.`
            : "A preview of each picture in a 9:16 reel. Shaded areas are usually covered by captions and buttons, so keep key details between them."}
        </p>
      ) : null}

      {forReels && pictures > 0 && !featured ? (
        <details open className="group/guide mt-4 rounded-xl border border-[#e3e7df] bg-[#fafbf9] [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-2.5 text-[13.5px] font-semibold text-[#1a201c] focus-visible:outline-2 focus-visible:outline-[#2e7d4f]">
            How to use these pictures
            <Icon.ChevronDown className="h-4 w-4 shrink-0 text-[#7a827c] transition-transform group-open/guide:rotate-180" />
          </summary>
          <BriefUsageGuide
            plural
            team={team}
            hasKit={Boolean(kit)}
            size={sizes[assets.find(asset => asset.kind === "image")?.url ?? ""]}
            storageKey={assets.map(asset => asset.url).join(",").slice(0, 400)}
            download={allDownloadable ? { attachment: true, onClick: downloadAll } : undefined}
            onOpenFullScreen={event => open(previewable[0].url, event.currentTarget, "original")}
            onShowInReel={() => setMode("reel")}
            className="border-t border-[#ebedea] px-4 pb-4 pt-3"
          />
        </details>
      ) : null}

      <ul
        aria-label="Gig reference files"
        className="mt-4 grid min-w-0 gap-3"
        // Reel frames stay phone-sized; original pictures share the row and a single picture gets the full width.
        style={{ gridTemplateColumns: side ? "minmax(0, 1fr)" : reelView ? "repeat(auto-fill, minmax(min(100%, 9rem), 1fr))" : `repeat(auto-fit, minmax(min(100%, ${featured ? "100%" : "14rem"}), 1fr))` }}
      >
        {assets.map((asset, index) => {
          const label = assetLabel(asset, index);
          const shape = asset.kind === "image" ? shapeLabel(sizes[asset.url]) : null;
          const preview = <AssetPreview asset={asset} label={label} mode={reelView ? "reel" : "original"} featured={featured} company={team} onSize={size => recordSize(asset.url, size)} />;
          const downloadable = Boolean(briefAssetDownloadUrl(asset));
          return (
            <li key={asset.url} className={cx("group flex min-w-0 flex-col overflow-hidden rounded-xl border border-[#e3e7df] bg-white transition hover:border-[#cdd9c9] hover:shadow-[0_6px_20px_-14px_rgba(26,32,28,0.45)]", side && "sm:flex-row")}>
              {asset.kind === "file" ? (
                <a href={asset.url} target="_blank" rel="noopener noreferrer" className="block w-full text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#2e7d4f]" aria-label={`Open ${label}: ${asset.name}`}>
                  {preview}
                </a>
              ) : (
                <button type="button" onClick={event => open(asset.url, event.currentTarget, reelView ? "reel" : "original")} aria-label={`View ${label.toLowerCase()}${reelView && asset.reelExample ? " as it should look in your reel" : ""}: ${asset.name}`} aria-haspopup="dialog" className={cx("block w-full cursor-zoom-in text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#2e7d4f]", side && "sm:w-[19rem] sm:shrink-0")}>
                  {preview}
                </button>
              )}
              {side ? (
                <div className="flex min-w-0 flex-1 flex-col gap-4 border-t border-[#e3e7df] p-4 sm:border-l sm:border-t-0 sm:p-5">
                  <div>
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                      <span className="text-[14px] font-semibold text-[#1a201c]">{label}</span>
                      {shape ? <span className="text-[12px] text-[#616a64]">{shape}</span> : null}
                    </div>
                    <p className="mt-1 text-[13px] leading-5 text-[#3b443e]">
                      {asset.reelExample ? `This is how ${team} wants the picture to look in your reel. Match it in your edit.` : reelFitTip(sizes[asset.url])}
                    </p>
                  </div>
                  {asset.note ? (
                    <figure className="rounded-lg border-l-4 border-[#2e7d4f] bg-[#f1f8ef] px-3 py-2">
                      <figcaption className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#2e7d4f]">What to show</figcaption>
                      <blockquote className="mt-0.5 text-[13px] leading-5 text-[#1a201c]">{asset.note}</blockquote>
                    </figure>
                  ) : null}
                  <ul className="space-y-2 text-[12.5px] leading-5 text-[#616a64]">
                    {[
                      "Keep key details clear of the caption and button areas at the top and bottom.",
                      "Hold it on screen long enough for viewers to read it.",
                      "Edit with the downloaded original so it stays sharp.",
                    ].map(tip => (
                      <li key={tip} className="flex gap-2"><Icon.Check className="mt-1 h-3 w-3 shrink-0 text-[#2e7d4f]" />{tip}</li>
                    ))}
                  </ul>
                  {asset.kind === "image" ? (
                    <button
                      type="button"
                      onClick={event => open(asset.url, event.currentTarget, "original")}
                      aria-haspopup="dialog"
                      className="flex min-w-0 items-center gap-3 rounded-lg border border-[#e3e7df] bg-[#fafbf9] p-2 text-left transition hover:border-[#cdd9c9] hover:bg-white focus-visible:outline-2 focus-visible:outline-[#2e7d4f]"
                    >
                      <img src={asset.url} alt="" loading="lazy" decoding="async" className="h-12 w-20 shrink-0 rounded-md bg-[#e9eee6] object-contain ring-1 ring-black/5" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] font-semibold text-[#1a201c]">View original picture</span>
                        <span className="block truncate text-[11.5px] text-[#7a827c]" title={asset.name}>{asset.name}</span>
                      </span>
                      <Icon.ChevronRight className="h-4 w-4 shrink-0 text-[#7a827c]" />
                    </button>
                  ) : null}
                  <DownloadLink asset={asset} index={index} className={buttonClassName("primary", "md", "mt-auto h-11 w-full sm:h-9 sm:w-auto sm:self-start")}>
                    {downloadable ? <DownloadGlyph className="h-4 w-4" /> : <Icon.External className="h-4 w-4" />}
                    {downloadable ? "Download original" : "Open original"}
                  </DownloadLink>
                </div>
              ) : (
                <div className={cx("mt-auto flex min-w-0 gap-2 border-t border-[#e3e7df] px-3 py-2.5", reelView ? "flex-col" : "items-center")}>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="shrink-0 text-[12.5px] font-semibold text-[#1a201c]">{label}</span>
                      {shape && !reelView ? <span className="truncate text-[11.5px] text-[#616a64]">{shape}</span> : null}
                    </div>
                    {reelView && asset.kind === "image" ? <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-[#616a64]">{asset.reelExample ? `Example by ${team}. Match it in your edit.` : reelFitTip(sizes[asset.url])}</div> : asset.note && !featured ? <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-4 text-[#3b443e]" title={asset.note}><span className="font-semibold text-[#2e7d4f]">Show: </span>{asset.note}</div> : <div className="mt-0.5 truncate text-[11px] text-[#7a827c]" title={asset.name}>{asset.name}</div>}
                  </div>
                  <DownloadLink asset={asset} index={index} className={buttonClassName(featured && !reelView ? "primary" : "secondary", "sm", cx("h-10 sm:h-8", reelView ? "w-full" : "min-w-10 px-2.5 sm:px-3"))}>
                    {downloadable ? <DownloadGlyph className="h-3.5 w-3.5" /> : <Icon.External className="h-3.5 w-3.5" />}
                    <span className={reelView || featured ? "" : "hidden min-[420px]:inline"}>{downloadable ? "Download" : "Open"}</span>
                  </DownloadLink>
                </div>
              )}
              {featured && !reelView && forReels && asset.kind !== "file" ? (
                <BriefUsageGuide
                  team={team}
                  note={asset.note}
                  size={sizes[asset.url]}
                  hasKit={Boolean(kit)}
                  storageKey={asset.url}
                  download={{ href: briefAssetDownloadUrl(asset) ?? asset.url, name: asset.name, attachment: downloadable }}
                  onOpenFullScreen={event => open(asset.url, event.currentTarget, "original")}
                  onShowInReel={asset.kind === "image" ? () => setMode("reel") : undefined}
                  className="border-t border-[#e3e7df] bg-[#fafbf9] p-4 sm:p-5"
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      </div> : null}
      {/* A removed asset or changed approval unmounts the viewer instead of retaining stale media. */}
      {openIndex >= 0 ? createPortal(<AssetViewer assets={previewable} index={openIndex} sizes={sizes} forReels={forReels} company={team} initialMode={openMode} onIndex={index => setOpenUrl(previewable[index].url)} onClose={close} />, document.body) : null}
    </section>
  );
}

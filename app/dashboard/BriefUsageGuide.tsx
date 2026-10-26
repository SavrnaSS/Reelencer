"use client";

import { useId, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { describeAssetShape } from "@/lib/gigBriefMedia";
import { buttonClassName, cx, Icon } from "./dashboardUi";

/*
 * Explains how to use reference pictures in a reel: the hiring team's note, three ways to feature the picture
 * (tuned to its shape) with a one-tap action each, and a pre-post checklist remembered in this browser.
 * Lays out by its own width, so it reads well in the narrow approval column, on phones and full width.
 */

type Action = { label: string; onClick?: (event: MouseEvent<HTMLButtonElement>) => void; href?: string; download?: string; external?: boolean };

const CHECK_EVENT = "reelencer:brief-checklist";
const subscribeChecks = (listener: () => void) => {
  window.addEventListener("storage", listener);
  window.addEventListener(CHECK_EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(CHECK_EVENT, listener);
  };
};
const readStorage = (key: string) => {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
};

/** Ticks are a per-viewer convenience; without storage the checklist still works for the visit. */
function useChecklist(storageKey: string) {
  const raw = useSyncExternalStore(subscribeChecks, () => readStorage(storageKey), () => "");
  const checked = new Set(raw ? raw.split("|") : []);
  const toggle = (item: string) => {
    const next = new Set(checked);
    if (next.has(item)) next.delete(item);
    else next.add(item);
    try {
      window.localStorage.setItem(storageKey, [...next].join("|"));
    } catch {
      /* Storage unavailable (private mode): nothing to remember. */
    }
    window.dispatchEvent(new Event(CHECK_EVENT));
  };
  return [checked, toggle] as const;
}

const MethodIcons = {
  film: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
      <rect x="2.5" y="4" width="13" height="9" rx="1.5" /><path d="M1.5 15.5h15" /><rect x="15.5" y="8" width="6" height="12" rx="1.5" /><path d="M18.5 17.5h.01" />
    </svg>
  ),
  edit: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
      <rect x="7" y="2.5" width="10" height="19" rx="2" /><path d="M3 9h18M3 15h18" strokeDasharray="2 2" /><path d="m10.5 10.5 3 1.5-3 1.5z" fill="currentColor" />
    </svg>
  ),
  green: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2.5" /><circle cx="12" cy="11" r="3" /><path d="M6.5 21c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5" />
    </svg>
  ),
};

function ActionButton({ action, primary }: { action: Action; primary: boolean }) {
  const className = buttonClassName(primary ? "primary" : "secondary", "sm", "mt-3 h-10 w-full sm:h-9");
  if (action.href) {
    return (
      <a
        href={action.href}
        className={className}
        {...(action.download ? { download: action.download } : {})}
        {...(action.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {action.label}
        {action.external ? <Icon.External className="h-3.5 w-3.5" /> : null}
      </a>
    );
  }
  return <button type="button" onClick={action.onClick} className={className}>{action.label}</button>;
}

function Method({ icon, title, tag, children, action, primary = false }: { icon: ReactNode; title: string; tag?: string; children: ReactNode; action?: Action; primary?: boolean }) {
  return (
    <li className={cx("flex min-w-0 flex-col rounded-xl border bg-white p-3.5", primary ? "border-[#b9d5c0] shadow-[0_6px_18px_-14px_rgba(46,125,79,0.6)]" : "border-[#e3e7df]")}>
      <div className="flex items-start gap-2.5">
        <span className={cx("grid h-9 w-9 shrink-0 place-items-center rounded-lg", primary ? "bg-[#2e7d4f] text-white" : "bg-[#eef1ed] text-[#41695b]")}>{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <h5 className="text-[13px] font-semibold text-[#1a201c]">{title}</h5>
            {tag ? <span className="rounded-full bg-[#eef6ec] px-1.5 py-0.5 text-[10px] font-semibold text-[#2b5d4a]">{tag}</span> : null}
          </div>
          <p className="mt-1 text-[12px] leading-[1.15rem] text-[#616a64]">{children}</p>
        </div>
      </div>
      {action ? <div className="mt-auto"><ActionButton action={action} primary={primary} /></div> : null}
    </li>
  );
}

export default function BriefUsageGuide({
  team,
  note,
  size,
  plural = false,
  hasKit = false,
  storageKey,
  download,
  onOpenFullScreen,
  onShowInReel,
  className,
}: {
  team: string;
  note?: string;
  size?: { width: number; height: number };
  plural?: boolean;
  /** The gig has a reel kit: filming points to its live recording screen instead of the static picture. */
  hasKit?: boolean;
  storageKey: string;
  /** One file: a link (attachment or original). Several: `onClick` downloads them all. */
  download?: { href?: string; name?: string; attachment: boolean; onClick?: () => void };
  onOpenFullScreen?: (event: MouseEvent<HTMLButtonElement>) => void;
  onShowInReel?: () => void;
  className?: string;
}) {
  const headingId = useId();
  const shape = size ? describeAssetShape(size.width, size.height) : null;
  const landscape = !shape || shape.orientation === "Landscape";
  const it = plural ? "them" : "it";
  const picture = plural ? "the pictures" : "the picture";
  const checks = [
    `${plural ? "Each picture stays" : "It stays"} on screen long enough to read, about 2–3 seconds.`,
    "Numbers and text are sharp when you watch it back on a phone.",
    "Nothing important is hidden under the caption or the reel buttons.",
    note ? `It shows what ${team} asked for above.` : "It appears where the brief describes.",
  ];
  const [checked, toggle] = useChecklist(`reelencer:brief-check:${storageKey}`);
  const done = checks.filter((item) => checked.has(item)).length;

  const filmAction: Action | undefined = hasKit
    ? { label: "Go to recording screen", href: "#reel-kit" }
    : onOpenFullScreen ? { label: "Open full screen", onClick: onOpenFullScreen } : undefined;
  const editAction: Action | undefined = download
    ? download.onClick
      ? { label: "Download all", onClick: download.onClick }
      : { label: download.attachment ? "Download original" : "Open original", href: download.href, download: download.attachment ? download.name ?? "" : undefined, external: !download.attachment }
    : undefined;

  return (
    <section aria-labelledby={headingId} className={cx("@container min-w-0", className)}>
      {note ? (
        <figure className="mb-4 rounded-xl border-l-4 border-[#2e7d4f] bg-[#f1f8ef] px-4 py-3">
          <figcaption className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#2e7d4f]">What to show · from {team}</figcaption>
          <blockquote className="mt-1 text-[14px] font-medium leading-6 text-[#1a201c]">{note}</blockquote>
        </figure>
      ) : null}

      <h4 id={headingId} className="text-[14px] font-semibold text-[#1a201c]">Ways to feature {it} in your reel</h4>
      <p className="mt-0.5 text-[12.5px] leading-5 text-[#616a64]">
        Pick one. {shape ? (landscape ? `${plural ? "Wide pictures" : "This is a wide picture, so it"} will look small on a vertical phone screen unless you film or zoom in.` : `${plural ? "Tall pictures fill" : "It's tall, so it fills"} most of a vertical reel.`) : "All three work with any reel style."}
      </p>
      <ul className="mt-3 grid gap-3 @xl:grid-cols-3">
        <Method icon={MethodIcons.film} title="Film it on a screen" tag="Most natural" primary action={filmAction}>
          {hasKit
            ? "Use the live recording screen above. It counts the figures up and ends on a payout alert, ready to film."
            : `Open ${picture} full screen on a ${landscape ? "laptop" : "laptop or tablet"}, then record it with your phone held upright, slightly angled.`}
        </Method>
        <Method icon={MethodIcons.edit} title="Add it in your editor" action={editAction}>
          {landscape
            ? `Download ${it}, place ${it} on a 9:16 timeline, zoom until ${it} ${plural ? "fill" : "fills"} the height and pan slowly across the key numbers.`
            : `Download ${it} and use ${it} as a full-screen shot on a 9:16 timeline in CapCut, InShot or Instagram.`}
        </Method>
        <Method icon={MethodIcons.green} title="Talk in front of it" action={onShowInReel ? { label: "Preview in a reel frame", onClick: onShowInReel } : undefined}>
          {`Use the green screen effect in Instagram or CapCut to appear in front of ${picture} while you explain ${it}.`}
        </Method>
      </ul>

      <div className="mt-4 rounded-xl border border-[#e3e7df] bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-[#ebedea] px-3.5 py-2.5">
          <h5 className="text-[13px] font-semibold text-[#1a201c]">Before you post</h5>
          <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", done === checks.length ? "bg-[#2e7d4f] text-white" : "bg-[#eef1ed] text-[#4b544e]")}>
            {done === checks.length ? "Ready to post" : `${done}/${checks.length} checked`}
          </span>
        </div>
        <ul className="divide-y divide-[#f0f1ef]">
          {checks.map((item) => {
            const on = checked.has(item);
            return (
              <li key={item}>
                <label className="flex min-h-11 cursor-pointer items-start gap-3 px-3.5 py-2.5 transition hover:bg-[#fafbf9]">
                  <input type="checkbox" checked={on} onChange={() => toggle(item)} className="mt-0.5 h-4 w-4 shrink-0 accent-[#2e7d4f]" />
                  <span className={cx("text-[12.5px] leading-5", on ? "text-[#7a827c] line-through decoration-[#a3aaa4]" : "text-[#3b443e]")}>{item}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

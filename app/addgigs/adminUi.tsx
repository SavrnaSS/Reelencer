"use client";

import React, { useEffect } from "react";

// Shared building blocks for the /addgigs admin views.
// Colours use arbitrary values on purpose: the global `.ops-dashboard-skin` rules override
// slate/emerald/rose utilities and `rounded-full.border`, so those classes don't render as written here.

export const ICONS = {
  refresh: "M15.5 8A6 6 0 0 0 4.6 6.5M4.5 3.5v3h3M4.5 12a6 6 0 0 0 10.9 1.5M15.5 16.5v-3h-3",
  search: "M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM17 17l-3.8-3.8",
  check: "m4.5 10.5 3.5 3.5 7.5-8",
  x: "M5.5 5.5l9 9M14.5 5.5l-9 9",
  copy: "M7 7V4.5h8.5V13H13M4.5 7H13v8.5H4.5z",
  alert: "M10 3.5 17.5 16.5h-15L10 3.5ZM10 8.5v3.2M10 14.1v.2",
  open: "M11.5 4.5h4v4M15.5 4.5 9 11M8 5.5H4.5v10h10V12",
  download: "M10 3.5v9M6 9l4 4 4-4M4 16.5h12",
  clock: "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM10 6.5V10l2.5 1.5",
  id: "M3.5 5h13v10h-13zM6.5 12.5h3M6.5 9.5h5",
  phone: "M5 3.5h3l1.5 3.5-2 1.2a8 8 0 0 0 4.3 4.3l1.2-2 3.5 1.5v3a1.5 1.5 0 0 1-1.6 1.5A13 13 0 0 1 3.5 5.1 1.5 1.5 0 0 1 5 3.5Z",
  pin: "M10 17s5-4.4 5-8.5a5 5 0 0 0-10 0C5 12.6 10 17 10 17ZM10 10.2a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4Z",
  user: "M10 10a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM4 16.5c.8-2.6 3.2-4 6-4s5.2 1.4 6 4",
  image: "M3.5 4.5h13v11h-13zM3.5 13l4-4 3.5 3.5 2-2 3.5 3.5M12.5 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  shield: "M10 3.5 15.5 5.5v4c0 3.4-2.3 6-5.5 7-3.2-1-5.5-3.6-5.5-7v-4L10 3.5Z",
  lock: "M6.5 9V7a3.5 3.5 0 0 1 7 0v2M5 9h10v7.5H5z",
  mail: "M3.5 5h13v10h-13zM3.5 5.5 10 11l6.5-5.5",
  eye: "M2.5 10s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5ZM10 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  eyeOff: "M3.5 3.5l13 13M8.6 8.6a2 2 0 0 0 2.8 2.8M6.2 6.3C4 7.6 2.5 10 2.5 10s2.8 5 7.5 5c1.4 0 2.6-.4 3.7-1M10 5c4.7 0 7.5 5 7.5 5s-.6 1.1-1.7 2.3",
  chevronLeft: "m12 5-5 5 5 5",
  chevronRight: "m8 5 5 5-5 5",
  chevronDown: "m5 8 5 5 5-5",
  list: "M5 5.5h10M5 10h10M5 14.5h6",
  briefcase: "M3.5 7h13v8.5h-13zM7.5 7V5h5v2M3.5 11h13",
  chat: "M4 4.5h12v8.5H9l-3.5 3v-3H4z",
  wallet: "M3.5 6h13v9.5h-13zM3.5 6l9-2.5V6M13 10.5h1.5",
  pause: "M7.5 5v10M12.5 5v10",
  save: "M4.5 4.5h9l2 2v9h-11zM7 4.5v4h5v-4M7 15.5v-4h6v4",
  rows: "M3.5 5h13M3.5 10h13M3.5 15h13",
  cards: "M3.5 3.5h13v5.5h-13zM3.5 11h13v5.5h-13z",
  send: "M3.5 10 16.5 4l-4 12.5-3-5.5-6-1Z",
  trash: "M4 6h12M8 6V4.5h4V6M5.8 6l.8 10h6.8l.8-10M8.6 9v4.5M11.4 9v4.5",
  undo: "M7.5 5.5 4 9l3.5 3.5M4 9h8a4 4 0 0 1 0 8H9.5",
};

export const Icon = ({ d, className = "h-4 w-4" }: { d: string; className?: string }) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
    <path d={d} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const Spinner = ({ className = "border-[#fff]/40 border-t-[#fff]" }: { className?: string }) => (
  <span className={`h-3.5 w-3.5 animate-spin rounded-full border-2 ${className}`} aria-hidden="true" />
);

export const btnBase =
  "inline-flex items-center justify-center gap-1.5 rounded-[10px] text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40 disabled:cursor-not-allowed disabled:opacity-50";
export const btnGhost = `${btnBase} h-9 border border-[#d9ddd8] bg-[#fff] px-3 text-[#1a201c] shadow-[0_1px_2px_rgba(26,32,28,0.06)] hover:bg-[#f7f8f6]`;
export const btnPrimary = `${btnBase} h-9 bg-[#1f2b24] px-3.5 text-[#fff] shadow-[0_1px_2px_rgba(0,0,0,0.2)] hover:bg-[#2b3a31]`;
export const btnDanger = `${btnBase} h-9 border border-[#f0c6c1] bg-[#fff] px-3.5 text-[#b42318] hover:bg-[#fdf0ef]`;
export const btnIcon =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] text-[#4b544e] transition hover:bg-[#f1f3f0] hover:text-[#1a201c] disabled:cursor-not-allowed disabled:opacity-40";
export const fieldClass =
  "w-full rounded-[10px] border bg-[#fff] px-3 text-[13.5px] text-[#1a201c] placeholder:text-[#8a928c]";
export const cardClass = "rounded-[16px] border border-[#e3e5e1] bg-[#fff] shadow-[0_1px_2px_rgba(26,32,28,0.05)]";

export type Tone = "warning" | "success" | "danger" | "info" | "neutral";

const TONES: Record<Tone, { chip: string; dot: string }> = {
  warning: { chip: "bg-[#fff6e5] text-[#9a5b00] ring-[#f3dcae]", dot: "bg-[#e29a1b]" },
  success: { chip: "bg-[#ebf5ee] text-[#226b40] ring-[#c9e3d2]", dot: "bg-[#2e7d4f]" },
  danger: { chip: "bg-[#fdf0ef] text-[#b42318] ring-[#f4cdc9]", dot: "bg-[#d4483b]" },
  info: { chip: "bg-[#eef4fc] text-[#1f5fa8] ring-[#cfe0f5]", dot: "bg-[#2a78d6]" },
  neutral: { chip: "bg-[#f1f3f0] text-[#4b544e] ring-[#e3e5e1]", dot: "bg-[#8a928c]" },
};

const STATUS_TONE: Record<string, Tone> = {
  pending: "warning",
  applied: "info",
  submitted: "info",
  assigned: "neutral",
  approved: "success",
  accepted: "success",
  rejected: "danger",
  withdrawn: "neutral",
};

export const toneFor = (status?: string): Tone => STATUS_TONE[String(status ?? "").toLowerCase()] ?? "neutral";
export const toneDot = (tone: Tone) => TONES[tone].dot;
export const toneChip = (tone: Tone) => TONES[tone].chip;

export const statusLabel = (status?: string) => {
  const s = String(status ?? "").trim();
  if (!s) return "Unknown";
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export function StatusChip({ status, label, tone, size = "sm" }: { status?: string; label?: string; tone?: Tone; size?: "sm" | "md" }) {
  const t = TONES[tone ?? toneFor(status)];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-[999px] font-semibold ring-1 ring-inset ${t.chip} ${
        size === "md" ? "px-2.5 py-1 text-[12.5px]" : "px-2 py-0.5 text-[11.5px]"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
      {label ?? statusLabel(status)}
    </span>
  );
}

export function Banner({ tone, children, onDismiss }: { tone: "success" | "danger"; children: React.ReactNode; onDismiss?: () => void }) {
  const ok = tone === "success";
  return (
    <div
      role="status"
      className={`flex items-start gap-2.5 rounded-[12px] border px-3.5 py-2.5 text-[13px] ${
        ok ? "border-[#c9e3d2] bg-[#ebf5ee] text-[#1d5c37]" : "border-[#f4cdc9] bg-[#fdf0ef] text-[#912018]"
      }`}
    >
      <Icon d={ok ? ICONS.check : ICONS.x} className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 break-words">{children}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="shrink-0 text-[12px] font-semibold underline-offset-2 hover:underline">
          Dismiss
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, body, dashed = true }: { icon: string; title: string; body?: string; dashed?: boolean }) {
  return (
    <div
      className={`flex flex-col items-center rounded-[16px] border bg-[#fff] px-6 py-12 text-center ${
        dashed ? "border-dashed border-[#d9ddd8]" : "border-[#e3e5e1]"
      }`}
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-[#f1f3f0] text-[#616a64]">
        <Icon d={icon} className="h-5 w-5" />
      </span>
      <div className="mt-3 text-[14px] font-semibold text-[#1a201c]">{title}</div>
      {body && <p className="mt-1 max-w-sm text-[13px] text-[#7a827c]">{body}</p>}
    </div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[#8a928c]">{children}</div>;
}

export function Avatar({ name, className = "size-10 text-[13px]" }: { name: string; className?: string }) {
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full bg-[#1f2b24] font-semibold text-[#fff] ${className}`}>
      {initials(name)}
    </span>
  );
}

export const initials = (name: string) => {
  const words = String(name ?? "").split("@")[0].trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "?";
  return (words[0][0] + words[1][0]).toUpperCase();
};

export const formatDateTime = (value?: string) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

export const formatDate = (value?: string) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
};

export const formatRelative = (value?: string) => {
  if (!value) return "";
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return "";
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.round(day / 30);
  return mo < 12 ? `${mo}mo ago` : `${Math.round(mo / 12)}y ago`;
};

export function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active, onEscape]);
}

export function Overlay({
  children,
  onClose,
  labelledBy,
  side,
  dark,
}: {
  children: React.ReactNode;
  onClose: () => void;
  labelledBy: string;
  side?: boolean;
  dark?: boolean;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className={`fixed inset-0 z-[60] flex ${
        dark
          ? "items-center justify-center bg-[#0b0f0c]/85 p-4"
          : side
            ? "items-end justify-center bg-[#0f1411]/40 sm:items-stretch sm:justify-end"
            : "items-end justify-center bg-[#0f1411]/40 sm:items-center sm:p-4"
      }`}
    >
      {children}
    </div>
  );
}

export function CopyButton({ value, label = "Copy", className = "" }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
      className={`inline-flex shrink-0 items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[11.5px] font-semibold text-[#2b5d4a] hover:bg-[#ebf5ee] ${className}`}
      aria-label={copied ? "Copied" : label || "Copy"}
      title={label ? undefined : "Copy"}
    >
      <Icon d={copied ? ICONS.check : ICONS.copy} className="h-3.5 w-3.5" />
      {label ? (copied ? "Copied" : label) : null}
    </button>
  );
}

/** Runs `fn` over `items` with at most `limit` in flight, reporting progress after each item. */
export async function runPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>, onProgress?: (done: number) => void): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
      done += 1;
      onProgress?.(done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export type BulkProgress = { label: string; done: number; total: number } | null;

/** Checkbox that supports the indeterminate (partially selected) state. */
export function SelectAllCheckbox({ checked, indeterminate, onChange, label }: { checked: boolean; indeterminate: boolean; onChange: () => void; label: string }) {
  const ref = React.useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);
  return <input ref={ref} type="checkbox" checked={checked} onChange={onChange} aria-label={label} className="h-4 w-4 shrink-0 cursor-pointer rounded" />;
}

/**
 * Floating selection bar for bulk actions. Pinned to the bottom of the viewport on every
 * breakpoint so actions stay reachable while scrolling a long queue.
 */
export function BulkBar({
  count,
  total,
  onSelectAll,
  onClear,
  progress,
  children,
}: {
  count: number;
  total: number;
  onSelectAll?: () => void;
  onClear: () => void;
  progress?: BulkProgress;
  children: React.ReactNode;
}) {
  if (count === 0 && !progress) return null;
  const pct = progress ? Math.round((progress.done / Math.max(progress.total, 1)) * 100) : 0;
  return (
    <>
      {/* Spacer so the bar never covers the last row */}
      <div aria-hidden="true" className="h-24 sm:h-20" />
      <div
        role="region"
        aria-label="Bulk actions"
        className="fixed inset-x-2 bottom-2 z-50 sm:inset-x-auto sm:bottom-5 sm:left-1/2 sm:w-[min(920px,calc(100vw-2rem))] sm:-translate-x-1/2"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="overflow-hidden rounded-[16px] border border-[#2b3a31] bg-[#1a201c] text-[#fff] shadow-[0_20px_50px_-12px_rgba(10,14,12,0.55)]">
          {progress ? (
            <div className="px-4 py-3" aria-live="polite">
              <div className="flex items-center justify-between gap-3 text-[13px] font-semibold">
                <span className="flex items-center gap-2">
                  <Spinner />
                  {progress.label}
                </span>
                <span className="tabular-nums text-[#fff]/70">
                  {progress.done} / {progress.total}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#fff]/15">
                <div className="h-full rounded-full bg-[#7bd389] transition-[width] duration-300" style={{ width: `${pct}%` }} />
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 p-2 sm:flex-row sm:items-center sm:gap-3 sm:pl-4">
              <div className="flex items-center justify-between gap-2 px-2 pt-1 sm:p-0" aria-live="polite">
                <span className="text-[13.5px] font-semibold tabular-nums">
                  {count} selected
                  <span className="font-normal text-[#fff]/60"> of {total}</span>
                </span>
                <span className="flex items-center gap-1">
                  {onSelectAll && count < total && (
                    <button type="button" onClick={onSelectAll} className="rounded-[8px] px-2 py-1 text-[12.5px] font-semibold text-[#9fe0aa] hover:bg-[#fff]/10">
                      Select all {total}
                    </button>
                  )}
                  <button type="button" onClick={onClear} className="rounded-[8px] px-2 py-1 text-[12.5px] font-semibold text-[#fff]/70 hover:bg-[#fff]/10 hover:text-[#fff]">
                    Clear
                  </button>
                </span>
              </div>
              <div className="grid auto-cols-fr grid-flow-col gap-1.5 sm:ml-auto sm:flex sm:flex-wrap sm:justify-end">{children}</div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const bulkBtnBase =
  "inline-flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-[10px] px-3 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 sm:h-9";
export const bulkBtn = {
  ghost: `${bulkBtnBase} bg-[#fff]/10 text-[#fff] hover:bg-[#fff]/20`,
  danger: `${bulkBtnBase} bg-[#fff]/10 text-[#ffb4ab] hover:bg-[#d4483b]/30`,
  primary: `${bulkBtnBase} bg-[#fff] text-[#1a201c] hover:bg-[#e9f5ec]`,
};

/** Generic confirmation dialog. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  tone = "primary",
  icon,
  busy,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  icon: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}) {
  useEscape(!busy, onCancel);
  return (
    <Overlay onClose={() => !busy && onCancel()} labelledBy="confirm-dialog-title">
      <div className="w-full max-w-md rounded-t-[18px] bg-[#fff] p-5 shadow-[0_24px_64px_-16px_rgba(15,20,17,0.4)] sm:rounded-[18px]">
        <div className="flex items-start gap-3">
          <span
            className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
              tone === "danger" ? "bg-[#fdf0ef] text-[#b42318]" : "bg-[#ebf5ee] text-[#226b40]"
            }`}
          >
            <Icon d={icon} className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 id="confirm-dialog-title" className="text-[15px] font-semibold text-[#1a201c]">
              {title}
            </h3>
            <div className="mt-0.5 text-[13px] text-[#616a64]">{body}</div>
          </div>
        </div>
        {children}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={btnGhost} disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={tone === "danger" ? `${btnBase} h-9 bg-[#b42318] px-4 text-[#fff] hover:bg-[#9a1d14]` : btnPrimary}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? <Spinner /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/** Small persisted per-viewer preference (falls back silently when storage is unavailable). */
export function usePersistedState<T extends string>(key: string, initial: T, allowed: readonly T[]) {
  const [value, setValue] = React.useState<T>(initial);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key) as T | null;
      if (stored && allowed.includes(stored)) setValue(stored);
    } catch {
      /* storage unavailable */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const update = React.useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        /* storage unavailable */
      }
    },
    [key],
  );
  return [value, update] as const;
}

export function ViewToggle<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: string; icon: string }[] }) {
  return (
    <div className="inline-flex h-10 shrink-0 items-center rounded-[10px] border border-[#d9ddd8] bg-[#fff] p-0.5" role="radiogroup" aria-label="View">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          role="radio"
          aria-checked={value === opt.id}
          onClick={() => onChange(opt.id)}
          title={opt.label}
          className={`inline-flex h-full items-center gap-1.5 rounded-[8px] px-2.5 text-[12.5px] font-semibold transition ${
            value === opt.id ? "bg-[#1f2b24] text-[#fff]" : "text-[#616a64] hover:bg-[#f1f3f0]"
          }`}
        >
          <Icon d={opt.icon} className="h-4 w-4" />
          <span className="hidden md:inline">{opt.label}</span>
        </button>
      ))}
    </div>
  );
}

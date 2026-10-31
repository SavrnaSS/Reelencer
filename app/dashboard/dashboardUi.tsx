"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { formatMoney as formatRupees } from "@/lib/money";

/*
 * Shared building blocks for the creator dashboard.
 * One visual system: neutral canvas, white cards with hairline borders,
 * near-black primary actions, green reserved for success/brand accents.
 */

export function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export function safeTime(value?: string | null) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

const inrCompact = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  notation: "compact",
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

/** "₹49" for whole rupees, "₹12.30" with paise (never "₹12.3"). */
export function formatMoney(value: number) {
  return formatRupees(value);
}

export function formatMoneyCompact(value: number) {
  return value < 10000 ? formatMoney(value) : inrCompact.format(value);
}

export function formatRelative(value?: string | null) {
  const time = safeTime(value);
  if (!time) return "—";
  const diff = Date.now() - time;
  if (diff < 60 * 1000) return "Just now";
  if (diff < 60 * 60 * 1000) return `${Math.round(diff / (60 * 1000))}m ago`;
  if (diff < DAY_MS) return `${Math.round(diff / (60 * 60 * 1000))}h ago`;
  if (diff < 7 * DAY_MS) return `${Math.round(diff / DAY_MS)}d ago`;
  return new Date(time).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function formatDate(value?: string | null) {
  const time = safeTime(value);
  if (!time) return "—";
  return new Date(time).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function getInitials(value: string) {
  const words = value.trim().split(/[\s_-]+/).filter(Boolean);
  const parts = words.length > 1 ? words : words[0]?.match(/[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])/g) ?? words;
  const [first = "", second = ""] = parts;
  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase() || "R";
}

/* ------------------------------------------------------------------ */
/* Status                                                             */
/* ------------------------------------------------------------------ */

export type BadgeTone = "success" | "info" | "attention" | "critical" | "neutral";

export function statusTone(status: string): BadgeTone {
  const value = status.toLowerCase();
  if (["accepted", "paid", "approved", "completed", "credited", "connected", "complete", "assigned"].includes(value)) return "success";
  if (["submitted", "processing", "in screening"].includes(value)) return "info";
  if (["rejected", "failed", "blocked", "closed", "not selected"].includes(value)) return "critical";
  if (["withdrawn", "cancelled", "guest", "ready", "draft"].includes(value)) return "neutral";
  return "attention";
}

const BADGE_CLASSES: Record<BadgeTone, { wrap: string; dot: string }> = {
  success: { wrap: "bg-[#e3f1df] text-[#1f5131]", dot: "bg-[#2e7d4f]" },
  info: { wrap: "bg-[#e0ecf8] text-[#1f4a73]", dot: "bg-[#2a78d6]" },
  attention: { wrap: "bg-[#fdf0d2] text-[#6b4a05]", dot: "bg-[#d99a06]" },
  critical: { wrap: "bg-[#fde4e1] text-[#8e1f1a]", dot: "bg-[#d03b3b]" },
  neutral: { wrap: "bg-[#eceeeb] text-[#4b544e]", dot: "bg-[#8a938d]" },
};

export function StatusBadge({ status, tone }: { status: string; tone?: BadgeTone }) {
  const classes = BADGE_CLASSES[tone ?? statusTone(status)];
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-medium", classes.wrap)}>
      <span className={cx("h-1.5 w-1.5 rounded-full", classes.dot)} aria-hidden="true" />
      {status}
    </span>
  );
}

export function JobPayout({ gig, stacked = false, className }: { gig: { payout: string; payoutType?: string } | null; stacked?: boolean; className?: string }) {
  const amount = gig?.payout.trim();
  const type = amount ? String(gig?.payoutType ?? "").trim().toLowerCase() : "";
  const unit = type === "per 1k views" ? "per 1K views" : type === "monthly" ? "per month" : type;

  return (
    <span className={cx("inline-flex min-w-0 max-w-full gap-x-1 leading-5", stacked ? "flex-col items-end" : "flex-wrap items-baseline", className)}>
      <span className="min-w-0 break-words font-semibold tabular-nums">{amount || "—"}</span>
      {unit ? <>{" "}<span className="text-[11px] font-medium text-[#616a64]">{unit}</span></> : null}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Icons                                                              */
/* ------------------------------------------------------------------ */

type IconProps = { className?: string };

export const Icon = {
  ChevronRight: ({ className = "h-4 w-4" }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="m8 5 5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  ChevronLeft: ({ className = "h-4 w-4" }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="m12 5-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  ChevronDown: ({ className = "h-4 w-4" }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="m5 8 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  ArrowUp: ({ className = "h-3.5 w-3.5" }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden="true">
      <path d="M10 15V5m0 0-4.5 4.5M10 5l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  ArrowDown: ({ className = "h-3.5 w-3.5" }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden="true">
      <path d="M10 5v10m0 0 4.5-4.5M10 15l-4.5-4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  External: ({ className = "h-3.5 w-3.5" }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="M11 4h5v5M16 4l-7 7M8 5H5.5A1.5 1.5 0 0 0 4 6.5v8A1.5 1.5 0 0 0 5.5 16h8a1.5 1.5 0 0 0 1.5-1.5V12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Check: ({ className = "h-3.5 w-3.5" }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" className={className} aria-hidden="true">
      <path d="m5 10.5 3.2 3.2L15 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Close: ({ className = "h-3.5 w-3.5" }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden="true">
      <path d="m6 6 8 8M14 6l-8 8" strokeLinecap="round" />
    </svg>
  ),
  Search: ({ className = "h-4 w-4" }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <circle cx="9" cy="9" r="5.5" />
      <path d="m13.5 13.5 3 3" strokeLinecap="round" />
    </svg>
  ),
  Inbox: ({ className = "h-4 w-4" }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className={className} aria-hidden="true">
      <path d="M3 11.5 5 4.5h10l2 7v4H3v-4Z" strokeLinejoin="round" />
      <path d="M3 11.5h4l1 2h4l1-2h4" strokeLinejoin="round" />
    </svg>
  ),
  Briefcase: ({ className = "h-4 w-4" }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className={className} aria-hidden="true">
      <rect x="3" y="6" width="14" height="10" rx="2" />
      <path d="M7.5 6V4.5h5V6M3 10.5h14" strokeLinejoin="round" />
    </svg>
  ),
  Clipboard: ({ className = "h-4 w-4" }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className={className} aria-hidden="true">
      <rect x="4.5" y="4" width="11" height="13" rx="2" />
      <path d="M7.5 4V3h5v1M7.5 9h5M7.5 12.5h3.5" strokeLinecap="round" />
    </svg>
  ),
  Wallet: ({ className = "h-4 w-4" }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className={className} aria-hidden="true">
      <path d="M3.5 6.5A2 2 0 0 1 5.5 4.5h9v2" strokeLinejoin="round" />
      <rect x="3.5" y="6.5" width="13" height="9.5" rx="2" />
      <circle cx="13.25" cy="11.25" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  User: ({ className = "h-4 w-4" }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className={className} aria-hidden="true">
      <circle cx="10" cy="7" r="3" />
      <path d="M4.5 16.5c.8-2.8 3-4.3 5.5-4.3s4.7 1.5 5.5 4.3" strokeLinecap="round" />
    </svg>
  ),
  Video: ({ className = "h-4 w-4" }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className={className} aria-hidden="true">
      <rect x="3" y="5.5" width="10" height="9" rx="2" />
      <path d="m13 9 4-2.5v7L13 11" strokeLinejoin="round" />
    </svg>
  ),
  Shield: ({ className = "h-4 w-4" }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className={className} aria-hidden="true">
      <path d="M10 3.5 15.5 5.5v4c0 3.4-2.3 6-5.5 7-3.2-1-5.5-3.6-5.5-7v-4L10 3.5Z" strokeLinejoin="round" />
    </svg>
  ),
  Table: ({ className = "h-4 w-4" }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className={className} aria-hidden="true">
      <rect x="3" y="4" width="14" height="12" rx="1.5" />
      <path d="M3 8h14M3 12h14M8 4v12" />
    </svg>
  ),
  Chart: ({ className = "h-4 w-4" }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className={className} aria-hidden="true">
      <path d="M4 16V9M8.5 16V5M13 16v-5M17 16H3" strokeLinecap="round" />
    </svg>
  ),
  Sort: ({ className = "h-4 w-4" }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className={className} aria-hidden="true">
      <path d="M6.5 4v12m0 0L4 13.5M6.5 16 9 13.5M13.5 16V4m0 0L11 6.5M13.5 4 16 6.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

/* ------------------------------------------------------------------ */
/* Layout primitives                                                  */
/* ------------------------------------------------------------------ */

export function Card({
  children,
  className,
  as: Tag = "section",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "article" | "div" | "aside";
  id?: string;
  "aria-labelledby"?: string;
  "aria-label"?: string;
}) {
  return (
    <Tag
      className={cx(
        "min-w-0 rounded-xl border border-[#e3e5e1] bg-white shadow-[0_1px_0_rgba(26,32,28,0.04),0_1px_2px_rgba(26,32,28,0.06)]",
        className
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({ id, title, description, action }: { id?: string; title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 pt-4 sm:px-5">
      <div className="min-w-0">
        <h2 id={id} className="text-[14px] font-semibold text-[#1a201c]">
          {title}
        </h2>
        {description ? <p className="mt-0.5 text-[12.5px] leading-5 text-[#616a64]">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  back,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { label: string; onClick: () => void };
  meta?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="flex min-w-0 items-start gap-2">
        {back ? (
          <button
            type="button"
            onClick={back.onClick}
            aria-label={back.label}
            title={back.label}
            className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#4b544e] transition hover:bg-[#e9ebe7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40"
          >
            <Icon.ChevronLeft className="h-5 w-5" />
          </button>
        ) : null}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-[#1a201c] sm:text-[22px]">{title}</h2>
            {meta}
          </div>
          {description ? <p className="mt-0.5 max-w-[70ch] text-[13px] leading-5 text-[#616a64]">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "plain" | "critical";

const BUTTON_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-[#1f2b24] text-white shadow-[0_1px_0_rgba(255,255,255,0.12)_inset,0_1px_2px_rgba(0,0,0,0.2)] hover:bg-[#2b3a31] disabled:bg-[#a9b0aa]",
  secondary: "border border-[#d9ddd8] bg-white text-[#1a201c] shadow-[0_1px_2px_rgba(26,32,28,0.06)] hover:bg-[#f7f8f6] disabled:text-[#a3aaa4]",
  plain: "text-[#2b5d4a] hover:bg-[#eef1ed] disabled:text-[#a3aaa4]",
  critical: "border border-[#f1c9c4] bg-white text-[#b42318] hover:bg-[#fdf2f1] disabled:text-[#e0a39d]",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" | "lg"; fullWidth?: boolean }
>(function Button({ variant = "secondary", size = "md", fullWidth, className, type = "button", children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/45 focus-visible:ring-offset-1 disabled:cursor-not-allowed",
        size === "sm" ? "h-8 px-3 text-[12.5px]" : size === "lg" ? "h-11 px-5 text-[14px]" : "h-9 px-3.5 text-[13px]",
        fullWidth && "w-full",
        BUTTON_CLASSES[variant],
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

export const buttonClassName = (variant: ButtonVariant = "secondary", size: "sm" | "md" | "lg" = "md", extra?: string) =>
  cx(
    "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/45 focus-visible:ring-offset-1",
    size === "sm" ? "h-8 px-3 text-[12.5px]" : size === "lg" ? "h-11 px-5 text-[14px]" : "h-9 px-3.5 text-[13px]",
    BUTTON_CLASSES[variant],
    extra
  );

export function LinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-1 text-[12.5px] font-semibold text-[#2b5d4a] transition hover:bg-[#f1f4f1] hover:text-[#1d4536] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40"
    >
      {children}
    </button>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span className={cx("block animate-pulse rounded-md bg-[#eceeea]", className)} aria-hidden="true" />;
}

export function SearchField({
  value,
  onChange,
  placeholder,
  label,
  id,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  label: string;
  id?: string;
  className?: string;
}) {
  return (
    <label className={cx("relative block min-w-0", className)} htmlFor={id}>
      <span className="sr-only">{label}</span>
      <Icon.Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a928c]" />
      <input
        id={id}
        type="search"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        enterKeyHint="search"
        className="h-9 w-full rounded-lg border border-[#d9ddd8] bg-white pl-9 pr-8 text-[16px] text-[#1a201c] shadow-[0_1px_2px_rgba(26,32,28,0.04)] outline-none transition placeholder:text-[#8a928c] focus:border-[#7fa58c] focus:ring-2 focus:ring-[#2e7d4f]/20 sm:text-[13px]"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-[#7a827c] hover:bg-[#f1f3f0] hover:text-[#1a201c]"
        >
          <Icon.Close />
        </button>
      ) : null}
    </label>
  );
}

export function FilterTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: Array<{ id: T; label: string; count?: number }>;
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="dashboard-chip-scroller -mb-px flex gap-1 overflow-x-auto">
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cx(
              "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40",
              active ? "bg-[#e9ebe7] text-[#1a201c]" : "text-[#616a64] hover:bg-[#f1f3f0] hover:text-[#1a201c]"
            )}
          >
            {tab.label}
            {typeof tab.count === "number" ? (
              <span className={cx("rounded-full px-1.5 text-[11px] leading-[18px] tabular-nums", active ? "bg-white text-[#1a201c]" : "bg-[#eef0ed] text-[#616a64]")}>
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col items-center px-6 py-12 text-center", className)}>
      {icon ? <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#eef1ed] text-[#5b665f]">{icon}</span> : null}
      <div className="mt-3 text-[14.5px] font-semibold text-[#1a201c]">{title}</div>
      {description ? <p className="mt-1 max-w-[46ch] text-[13px] leading-5 text-[#616a64]">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function MetricTile({
  label,
  value,
  caption,
  onClick,
  loading,
  trailing,
  active,
}: {
  label: string;
  value: string;
  caption?: ReactNode;
  onClick?: () => void;
  loading?: boolean;
  trailing?: ReactNode;
  /** Highlights the tile whose filter is currently applied. */
  active?: boolean;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[12.5px] font-medium text-[#616a64]">{label}</span>
        {onClick ? <Icon.ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#a3aaa4] transition group-hover:translate-x-0.5 group-hover:text-[#616a64]" /> : null}
      </div>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
      ) : (
        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0">
            <div className="break-words text-[20px] font-semibold leading-tight tracking-[-0.01em] text-[#1a201c] tabular-nums sm:text-[22px]">{value}</div>
            {caption ? <div className="mt-1 text-[12px] text-[#7a827c]">{caption}</div> : null}
          </div>
          {trailing}
        </div>
      )}
    </>
  );
  const shell =
    "group flex min-w-0 flex-col justify-between gap-3 rounded-xl border border-[#e3e5e1] bg-white p-3.5 text-left shadow-[0_1px_0_rgba(26,32,28,0.04),0_1px_2px_rgba(26,32,28,0.06)] sm:p-4";
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active ?? undefined}
      className={cx(
        shell,
        "transition hover:border-[#cfd5cf] hover:shadow-[0_4px_14px_-6px_rgba(26,32,28,0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40",
        active && "border-[#2e7d4f]/45 bg-[#f6faf5] ring-1 ring-[#2e7d4f]/25"
      )}
    >
      {body}
    </button>
  ) : (
    <div className={shell}>{body}</div>
  );
}

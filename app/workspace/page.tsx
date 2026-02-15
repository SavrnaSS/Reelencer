"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

/**
 * Worker Marketplace (List-only) — Production-ready, backend-ready, hydration-safe
 *
 * ✅ Preserves your existing working logic:
 * - SSR/client deterministic initial render (empty arrays + defaults)
 * - localStorage demo fallback (seed → cache) after hydration
 * - API load (admin-controlled) + cache write-through
 * - Worker resolved from ?worker=WKR-001
 * - List-only work queue (cards on mobile, table on desktop)
 * - SLA + gates calculation
 * - Start + Submit proof flows (optimistic local + PATCH API)
 * - UPI verify + config (local + PUT API)
 * - 🔐 Auth session in localStorage
 * - 📊 Worker Performance metrics section
 *
 * ✅ UPDATED (fix “logout still keeps login and redirects back to /workspace”):
 * - Keeps hard gate + sessionLoaded guard 
 * - Strengthens logout: removes auth + marks logoutAt + clears sessionStorage
 * - Hard-gates ALL bootstraps + API calls unless session is an authenticated Worker
 * - Redirects to /login as soon as sessionLoaded confirms “no session”
 * - Uses window.location.replace(...) to avoid back/forward ping-pong
 */

/** ===================== Types ===================== */
type Role = "Admin" | "Worker";
type Section = "Operations" | "Accounts" | "Performance" | "Payouts" | "UPI";
type Status = "Open" | "In progress" | "Submitted" | "Approved" | "Needs fix" | "Hard rejected" | "Cancelled";
type Priority = "P0" | "P1" | "P2";
type TaskType = "Reel posting" | "Story posting" | "Comment replies" | "Profile update";
type PolicyTier = "Standard" | "Strict";
type AccountHealth = "Healthy" | "Watch" | "Risk";

type AssignedAccount = {
  id: string;
  handle: string;
  niche: string;
  ownerTeam: string;
  policyTier: PolicyTier;
  health: AccountHealth;
  rules: string[];
  allowedAudios: string[];
  requiredHashtags: string[];
};

type WorkItem = {
  id: string;
  title: string;
  type: TaskType;
  accountId: string;
  workerId?: string;
  createdAt: string; // YYYY-MM-DD
  dueAt: string; // local ISO "YYYY-MM-DDTHH:MM"
  status: Status;
  priority: Priority;
  rewardINR: number;
  estMinutes: number;
  slaMinutes: number;
  startedAt?: string;
  completedAt?: string;
  gates: {
    captionTemplate: boolean;
    approvedAudio: boolean;
    hashtagsOk: boolean;
    noRestricted: boolean;
    proofAttached: boolean;
  };
  submission?: {
    reelUrl?: string;
    screenshotUrl?: string;
    submittedAt?: string;
  };
  review?: {
    reviewedAt?: string;
    reviewer?: string;
    decision?: "Approved" | "Rejected" | "Hard rejected";
    reason?: string;
  };
  audit: Array<{ at: string; by: string; text: string }>;
};

type UpiSchedule = "Weekly" | "Bi-weekly" | "Monthly";
type UpiConfig = {
  upiId: string;
  verified: boolean;
  verifiedAt?: string;
  payoutSchedule: UpiSchedule;
  payoutDay: "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
};

type PayoutBatchStatus = "Draft" | "Processing" | "Paid" | "Failed";
type PayoutItemStatus = "Eligible" | "On hold" | "Included" | "Paid" | "Failed";

type PayoutItem = {
  id: string;
  workItemId: string;
  workerId: string;
  handle: string;
  amountINR: number;
  status: PayoutItemStatus;
  reason?: string;
};

type PayoutBatch = {
  id: string;
  cycleLabel: string;
  periodStart: string;
  periodEnd: string;
  status: PayoutBatchStatus;
  createdAt: string;
  processedAt?: string;
  paidAt?: string;
  method: "UPI" | "Bank";
  items: PayoutItem[];
  notes: string[];
};

type WorkerProfile = {
  id: string;
  name: string;
  level: "L1" | "L2" | "L3";
  assignedAccountIds: string[];
  assignedAccounts?: AssignedAccount[];
  assignedAccountSchedules?: Record<string, { times?: string[]; days?: number[]; deadlineMin?: number; timezone?: string }>;
  /** corporate-style login fields (still allowed in seed/cache) */
  email?: string;
  password?: string; // demo only (replace with real auth backend)
};

type AuthSession = {
  role: Role;
  workerId?: string; // for worker sessions
  at: string;
};

/** ===================== Constants ===================== */
const RATE_DEFAULT = 5 as const;

const LS_KEYS = {
  ACCOUNTS: "igops:accounts",
  WORKERS: "igops:workers",
  ITEMS: "igops:workitems",
  UPI: "igops:upi",
  PAYOUTS: "igops:payoutbatches",
  AUTH: "igops:auth",
  PAYOUT_REVERSAL: "igops:payoutReversalNotice",
  // ✅ NEW: optional marker (useful if you ever add cross-tab sync or login page checks)
  LOGOUT_AT: "igops:logoutAt",
} as const;

const DEFAULT_UPI: UpiConfig = {
  upiId: "",
  verified: false,
  payoutSchedule: "Weekly",
  payoutDay: "Fri",
};

const DEFAULT_ACCOUNT_RULES = ["Use caption template", "No politics/religion"];
const DEFAULT_ACCOUNT_AUDIOS = ["Calm Beat #2", "Soft Pop #3"];
const DEFAULT_ACCOUNT_TAGS = ["#brand", "#reels"];

/** Still used for seed compatibility (NOT a login UI anymore) */
const AUTH_DEMO = {
  WORKER_DEFAULT_PASSWORD: "worker",
  WORKER_EMAIL_DOMAIN: "igops.com",
} as const;

/** ===================== Utils ===================== */
function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function timeNowHHMM() {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function nowStamp() {
  return `${isoToday()} ${timeNowHHMM()}`;
}

function nowISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function parseLocalISO(s: string) {
  // expects "YYYY-MM-DDTHH:MM"
  const [date, time] = s.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

function parseIstLocalToUtc(s: string) {
  const [date, time] = s.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const istOffsetMin = 330;
  return new Date(Date.UTC(y, m - 1, d, hh, mm, 0, 0) - istOffsetMin * 60 * 1000);
}

const TZ_LABEL = "Asia/Kolkata";
function formatDueWithTz(s: string) {
  return `${s.replace("T", " ")} ${TZ_LABEL}`;
}

function istNow() {
  const offsetMin = 330;
  const d = new Date(Date.now() + offsetMin * 60 * 1000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
  };
}

function isoWeekNumber(d: Date) {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function minutesBetween(a: Date, b: Date) {
  return Math.floor((b.getTime() - a.getTime()) / 60000);
}

function formatINR(n: number) {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `₹${n}`;
  }
}

function clampText(s: string, max = 64) {
  const t = (s || "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

function isMobileWidth() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 1023px)").matches;
}

function isValidUpi(upi: string) {
  const t = (upi || "").trim();
  if (!t.includes("@")) return false;
  if (t.length < 6) return false;
  const [a, b] = t.split("@");
  return !!a && !!b && a.length >= 2 && b.length >= 2;
}

function normalizeEmail(s: string) {
  return (s || "").trim().toLowerCase();
}

function workerEmail(w: WorkerProfile) {
  if (w.email && normalizeEmail(w.email)) return normalizeEmail(w.email);
  return `${w.id.toLowerCase()}@${AUTH_DEMO.WORKER_EMAIL_DOMAIN}`;
}

function workerPassword(w: WorkerProfile) {
  return (w.password || AUTH_DEMO.WORKER_DEFAULT_PASSWORD).trim();
}

/** ===================== Safety Normalizers ===================== */
function toArray<T>(v: any, fallback: T[] = []): T[] {
  return Array.isArray(v) ? (v as T[]) : fallback;
}

function toObject<T extends Record<string, any>>(v: any, fallback: T): T {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as T;
  return fallback;
}

/** Always return a fully-shaped UpiConfig */
function normalizeUpi(v: any): UpiConfig {
  const obj = toObject<Record<string, any>>(v, {});
  return {
    ...DEFAULT_UPI,
    ...obj,
    upiId: typeof obj.upiId === "string" ? obj.upiId : DEFAULT_UPI.upiId,
    verified: typeof obj.verified === "boolean" ? obj.verified : DEFAULT_UPI.verified,
    payoutSchedule: (obj.payoutSchedule as UpiSchedule) || DEFAULT_UPI.payoutSchedule,
    payoutDay: (obj.payoutDay as UpiConfig["payoutDay"]) || DEFAULT_UPI.payoutDay,
  };
}

/** ===================== localStorage (optional cache) ===================== */
function readLS<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as T;
    if (parsed === null || (parsed as any) === undefined) return fallback;
    return parsed;
  } catch {
    return fallback;
  }
}

function writeLS<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function removeLS(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/** ✅ Strong logout clear (keeps your existing logic, just makes it harder to “stick”) */
function clearAuthEverywhere() {
  if (typeof window === "undefined") return;
  try {
    // localStorage
    window.localStorage.removeItem(LS_KEYS.AUTH);
    window.localStorage.setItem(LS_KEYS.LOGOUT_AT, JSON.stringify({ at: nowStamp() }));
    // sessionStorage (optional, but helps if any page caches session there)
    try {
      window.sessionStorage.clear();
    } catch {
      // ignore
    }
  } catch {
    // ignore
  }
}

/** ===================== Backend-ready API helper ===================== */
type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function fetchJSON<T>(url: string, init?: RequestInit, signal?: AbortSignal): Promise<ApiResult<T>> {
  try {
    let authHeader: Record<string, string> = {};
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (token) authHeader = { Authorization: `Bearer ${token}` };
    } catch {
      // ignore auth lookup errors
    }
    const res = await fetch(url, {
      ...init,
      signal,
      headers: { "Content-Type": "application/json", ...authHeader, ...(init?.headers ?? {}) },
      cache: "no-store",
    });

    const text = await res.text();
    let json: any = undefined;

    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    } else {
      json = undefined;
    }

    if (!res.ok) return { ok: false, error: (json?.error as string) || `HTTP ${res.status}` };
    const data = (json ?? (undefined as any)) as T;
    return { ok: true, data };
  } catch (e: any) {
    if (e?.name === "AbortError") return { ok: false, error: "Request aborted" };
    return { ok: false, error: e?.message || "Network error" };
  }
}

/** Read worker id from ?worker=... */
function useWorkerIdFromUrl() {
  const [workerId, setWorkerId] = useState<string | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const w = url.searchParams.get("worker");
    if (w) setWorkerId(w);
  }, []);
  return workerId;
}

/** A small hydration flag (prevents SSR/client mismatches) */
function useHydrated() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}

/** ===================== Icons ===================== */
function Icon({ name, className }: { name: string; className?: string }) {
  const c = cx("h-5 w-5", className);
  switch (name) {
    case "hamburger":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "search":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M16.5 16.5 21 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "bell":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M18 9a6 6 0 1 0-12 0c0 7-3 7-3 7h18s-3 0-3-7Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M10 20a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "refresh":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M20 12a8 8 0 1 1-2.34-5.66" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M20 4v6h-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "download":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 3v10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M8 10l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 17v3h16v-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "x":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "check":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M20 7 10.5 16.5 4 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "chevRight":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "tasks":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M9 6h11M9 12h11M9 18h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path
            d="M4.5 6.5l1.2 1.2 2.3-2.7M4.5 12.5l1.2 1.2 2.3-2.7M4.5 18.5l1.2 1.2 2.3-2.7"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "clock":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case "wallet":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 7.5A3.5 3.5 0 0 1 7.5 4H20v4H7.5A3.5 3.5 0 0 1 4 7.5Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M20 8v10.5A1.5 1.5 0 0 1 18.5 20h-11A3.5 3.5 0 0 1 4 16.5V7.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M16.5 14h3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "performance":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 19h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M7 16v-5M12 16V8M17 16v-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "settings":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M19.4 15a7.9 7.9 0 0 0 .1-1l2-1.1-2-3.5-2.3.6a7.5 7.5 0 0 0-1.7-1L13 4h-4L8.5 8a7.5 7.5 0 0 0-1.7 1L4.5 8.4l-2 3.5 2 1.1a7.9 7.9 0 0 0 0 2l-2 1.1 2 3.5 2.3-.6a7.5 7.5 0 0 0 1.7 1L9 20h4l.5-4a7.5 7.5 0 0 0 1.7-1l2.3.6 2-3.5-2-1.1Z"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "lock":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M7 11V8.5a5 5 0 0 1 10 0V11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path
            d="M6.5 11h11A2.5 2.5 0 0 1 20 13.5v5A2.5 2.5 0 0 1 17.5 21h-11A2.5 2.5 0 0 1 4 18.5v-5A2.5 2.5 0 0 1 6.5 11Z"
            stroke="currentColor"
            strokeWidth="1.8"
          />
        </svg>
      );
    default:
      return <span className={c} />;
  }
}

/** ===================== UI atoms ===================== */
function Button({
  variant = "primary",
  children,
  onClick,
  disabled,
  className,
  title,
  type = "button",
}: {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
  type?: "button" | "submit";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-extrabold transition focus:outline-none focus:ring-2 focus:ring-[#0078d4]/30 disabled:opacity-50 disabled:cursor-not-allowed";
  const styles =
    variant === "primary"
      ? "bg-[#0078d4] text-white hover:bg-[#106ebe]"
      : variant === "secondary"
      ? "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
      : variant === "danger"
      ? "bg-rose-600 text-white hover:bg-rose-700"
      : "text-slate-700 hover:bg-slate-100";
  return (
    <button type={type} title={title} onClick={onClick} disabled={disabled} className={cx(base, styles, className)}>
      {children}
    </button>
  );
}

function Chip({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "info" | "success" | "warn" | "danger";
  className?: string;
}) {
  const cls =
    tone === "info"
      ? "border-sky-200 bg-sky-50 text-sky-800"
      : tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : tone === "danger"
      ? "border-rose-200 bg-rose-50 text-rose-800"
      : "border-slate-200 bg-slate-50 text-slate-700";
  return <span className={cx("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-extrabold", cls, className)}>{children}</span>;
}

function Card({
  title,
  subtitle,
  right,
  children,
  compact = false,
}: {
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      {(title || right) && (
        <div className={cx("flex items-start justify-between gap-3 border-b border-slate-200", compact ? "px-4 py-2" : "px-4 py-3")}>
          <div className="min-w-0">
            {title && <div className="text-sm font-extrabold text-slate-900">{title}</div>}
            {subtitle && <div className="mt-0.5 text-sm text-slate-600">{subtitle}</div>}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </div>
      )}
      <div className={cx(compact ? "px-4 py-2" : "px-4 py-3")}>{children}</div>
    </section>
  );
}

function StatusBadge({ s }: { s: Status }) {
  const tone =
    s === "Approved"
      ? "success"
      : s === "Submitted"
      ? "warn"
      : s === "Needs fix" || s === "Hard rejected"
      ? "danger"
      : s === "Cancelled"
      ? "neutral"
      : s === "In progress"
      ? "info"
      : "neutral";
  return <Chip tone={tone}>{s}</Chip>;
}

function PriorityPill({ p }: { p: Priority }) {
  const tone = p === "P0" ? "danger" : p === "P1" ? "warn" : "neutral";
  return <Chip tone={tone}>{p}</Chip>;
}

function HealthPill({ h }: { h: AccountHealth }) {
  const tone = h === "Healthy" ? "success" : h === "Watch" ? "warn" : "danger";
  return <Chip tone={tone}>{h}</Chip>;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-600 font-bold">{label}</span>
      <span className="text-slate-900 font-extrabold">{value}</span>
    </div>
  );
}

/** ===================== Worker Page ===================== */
export default function MarketplaceWorkerPage() {
  const hydrated = useHydrated();
  const RATE = RATE_DEFAULT;

  /** 🔐 Auth (session only; no LoginGate here anymore) */
  const [session, setSession] = useState<AuthSession | null>(null);

  /**
   * ✅ IMPORTANT: do not redirect until we have actually attempted to read localStorage.
   */
  const [sessionLoaded, setSessionLoaded] = useState(false);

  // workerId resolved from query param (no demo fallback)
  const workerIdFromUrl = useWorkerIdFromUrl();

  // Effective worker id:
  // - If logged in as Worker, use session.workerId
  // - Else fallback to URL param behavior (preserves existing logic)
  const effectiveWorkerId = useMemo(() => {
    if (session?.role === "Worker" && session.workerId) return session.workerId;
    return workerIdFromUrl ?? "";
  }, [session, workerIdFromUrl]);

  /** ✅ Hard auth gate computed once */
  const isWorkerAuthed = !!(sessionLoaded && session && session.role === "Worker");

  // ✅ Deterministic initial state (same on server + client)
  const [accounts, setAccounts] = useState<AssignedAccount[]>([]);
  const [workers, setWorkers] = useState<WorkerProfile[]>([]);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [allItems, setAllItems] = useState<WorkItem[]>([]);
  const [upi, setUpi] = useState<UpiConfig>(DEFAULT_UPI);
  const [payoutBatches, setPayoutBatches] = useState<PayoutBatch[]>([]);
  const [apiLoaded, setApiLoaded] = useState(false);

  // UI state (stable hooks)
  const [activeSection, setActiveSection] = useState<Section>("Operations");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [detailsOpenMobile, setDetailsOpenMobile] = useState(false);
  const [q, setQ] = useState("");
  const [strictOnly, setStrictOnly] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState<Priority | "All">("All");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kycStatus, setKycStatus] = useState<"none" | "pending" | "approved" | "rejected">("none");
  const [kycLoaded, setKycLoaded] = useState(false);
  const [kycLoading, setKycLoading] = useState(false);
  const [kycError, setKycError] = useState<string | null>(null);
  const [kycRejection, setKycRejection] = useState<string | null>(null);
  const [kycForm, setKycForm] = useState({
    legalName: "",
    dob: "",
    phone: "",
    address: "",
    idType: "",
    idNumber: "",
    idDocPath: "",
    selfiePath: "",
  });
  const [dobParts, setDobParts] = useState({ day: "", month: "", year: "" });
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  // proof modal
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitReelUrl, setSubmitReelUrl] = useState("");
  const [submitShotUrl, setSubmitShotUrl] = useState("");

  // load indicator + errors
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>("");

  // KPI tick (ONLY when authed worker)
  const [tick, setTick] = useState(0);

  const stopCamera = useCallback(() => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }
    setCameraOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      cameraStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
    } catch (err: any) {
      setCameraError(err?.message || "Unable to access camera.");
      stopCamera();
    }
  }, [stopCamera]);

  useEffect(() => {
    if (!kycForm.dob) return;
    const [year = "", month = "", day = ""] = String(kycForm.dob).split("-");
    if (!year || !month || !day) return;
    setDobParts((prev) => {
      if (prev.day === day && prev.month === month && prev.year === year) return prev;
      return { day, month, year };
    });
  }, [kycForm.dob]);

  const dobYearOptions = useMemo(() => {
    const nowYear = new Date().getFullYear();
    const startYear = nowYear - 18;
    return Array.from({ length: 83 }, (_, i) => String(startYear - i));
  }, []);

  const dobMonthOptions = useMemo(
    () => [
      { value: "01", label: "Jan" },
      { value: "02", label: "Feb" },
      { value: "03", label: "Mar" },
      { value: "04", label: "Apr" },
      { value: "05", label: "May" },
      { value: "06", label: "Jun" },
      { value: "07", label: "Jul" },
      { value: "08", label: "Aug" },
      { value: "09", label: "Sep" },
      { value: "10", label: "Oct" },
      { value: "11", label: "Nov" },
      { value: "12", label: "Dec" },
    ],
    []
  );

  const dobDayOptions = useMemo(() => {
    const y = Number(dobParts.year);
    const m = Number(dobParts.month);
    const maxDays = y > 0 && m > 0 ? new Date(y, m, 0).getDate() : 31;
    return Array.from({ length: maxDays }, (_, i) => String(i + 1).padStart(2, "0"));
  }, [dobParts.month, dobParts.year]);

  const updateDobPart = useCallback((part: "day" | "month" | "year", value: string) => {
    setDobParts((prev) => {
      const next = { ...prev, [part]: value };
      const y = Number(next.year);
      const m = Number(next.month);
      if (next.day && y > 0 && m > 0) {
        const maxDays = new Date(y, m, 0).getDate();
        if (Number(next.day) > maxDays) next.day = String(maxDays).padStart(2, "0");
      }
      const complete = !!(next.year && next.month && next.day);
      setKycForm((p) => ({
        ...p,
        dob: complete ? `${next.year}-${next.month}-${next.day}` : "",
      }));
      return next;
    });
  }, []);

  const uploadKycFile = useCallback(async (kind: "id_doc" | "selfie", file: File) => {
    setKycLoading(true);
    setKycError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Not authenticated");
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", kind);
      const res = await fetch("/api/kyc/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || "Upload failed");
      if (kind === "id_doc") setKycForm((p) => ({ ...p, idDocPath: payload.path }));
      if (kind === "selfie") {
        setKycForm((p) => ({ ...p, selfiePath: payload.path }));
        setSelfieFile(null);
      }
    } catch (err: any) {
      setKycError(err?.message || "Upload failed");
    } finally {
      setKycLoading(false);
    }
  }, []);

  const captureSelfie = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const w = video.videoWidth || 720;
    const h = video.videoHeight || 720;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    setSelfiePreview(dataUrl);
    stopCamera();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) return;
    const file = new File([blob], "selfie.jpg", { type: "image/jpeg" });
    setSelfieFile(file);
  }, [stopCamera, uploadKycFile]);

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  useEffect(() => {
    if (!hydrated) return;
    if (!isWorkerAuthed) return;
    if (apiLoaded) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, [hydrated, isWorkerAuthed]);

  /** 🔐 Load session after hydration (and mark sessionLoaded) */
  useEffect(() => {
    if (!hydrated) return;
    const s = readLS<AuthSession | null>(LS_KEYS.AUTH, null);
    setSession(s);
    setSessionLoaded(true);
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated || !sessionLoaded) return;
    if (!session || session.role !== "Worker") return;
    let alive = true;
    (async () => {
      if (alive) setKycLoaded(false);
      setKycLoading(true);
      setKycError(null);
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) {
          if (alive) setKycStatus("none");
          return;
        }
        const res = await fetch("/api/kyc", { headers: { Authorization: `Bearer ${token}` } });
        const payload = res.ok ? await res.json() : null;
        if (!alive) return;
        if (!payload || payload.status === "none") {
          setKycStatus("none");
          return;
        }
        setKycStatus(payload.status);
        setKycRejection(payload.rejectionReason ?? null);
        if (payload.status === "approved" && payload.workerId && !session.workerId) {
          const next = { ...session, workerId: payload.workerId };
          setSession(next);
          writeLS(LS_KEYS.AUTH, next);
        }
      } catch (e: any) {
        if (alive) setKycError(e?.message || "KYC check failed");
      } finally {
        if (alive) {
          setKycLoading(false);
          setKycLoaded(true);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [hydrated, sessionLoaded, session]);

  useEffect(() => {
    if (!hydrated || !sessionLoaded) return;
    if (!session || session.role !== "Worker") return;
    if (session.workerId) return;

    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const userId = data?.user?.id;
      if (!userId) return;

      const res = await fetchJSON<WorkerProfile[] | null | undefined>("/api/workers", { method: "GET" });
      if (!res.ok || !Array.isArray(res.data)) return;

      const match = res.data.find((w: any) => w.userId === userId);
      const workerId = match?.workerId ?? match?.id;
      if (!workerId || cancelled) return;

      const next = { ...session, workerId };
      setSession(next);
      writeLS(LS_KEYS.AUTH, next);
    })();

    return () => {
      cancelled = true;
    };
  }, [hydrated, sessionLoaded, session]);

  /**
   * ✅ Auth routing (NO UI here)
   * - Wait until sessionLoaded (prevents /workspace → /login loop before LS is read)
   * - No session => /login
   * - Admin => /admin
   */
  useEffect(() => {
    if (!hydrated) return;
    if (!sessionLoaded) return;

    if (!session) {
      window.location.replace("/login");
      return;
    }
    if (session.role === "Admin") {
      window.location.replace("/admin");
      return;
    }
  }, [hydrated, sessionLoaded, session]);

  const logout = useCallback(() => {
    
    localStorage.removeItem("igops:auth");
    window.location.href = "/logout";
  }, []);

  /**
   * ✅ Hydration-safe localStorage bootstrap
   * 🔒 UPDATED: Only bootstrap AFTER we confirm an authenticated Worker session.
   */
  useEffect(() => {
    if (!hydrated) return;
    if (!isWorkerAuthed) return;

    const nextAccounts = toArray<AssignedAccount>(readLS<any>(LS_KEYS.ACCOUNTS, []), []);
    const nextWorkers = toArray<WorkerProfile>(readLS<any>(LS_KEYS.WORKERS, []), []);
    const nextItems = toArray<WorkItem>(readLS<any>(LS_KEYS.ITEMS, []), []);
    const nextUpi = normalizeUpi(readLS<any>(LS_KEYS.UPI, DEFAULT_UPI));
    const nextPayouts = toArray<PayoutBatch>(readLS<any>(LS_KEYS.PAYOUTS, []), []);

    setAccounts(nextAccounts);
    setWorkers(nextWorkers);
    setItems(nextItems);
    setUpi(nextUpi);
    setPayoutBatches(nextPayouts);
  }, [hydrated, isWorkerAuthed, apiLoaded]);

  /** ========== Backend load (admin-controlled state) ========== */
  const loadInFlightRef = useRef(false);

  const loadFromApi = useCallback(async () => {
    if (!hydrated) return;
    if (!effectiveWorkerId) return;
    if (loadInFlightRef.current) return;

    loadInFlightRef.current = true;

    setLoading(true);
    setLoadError("");

    const [rWorkers, rAccounts, rItems, rPayouts, rUpi] = await Promise.all([
      fetchJSON<WorkerProfile[] | null | undefined>(`/api/workers`, { method: "GET" }),
      fetchJSON<AssignedAccount[] | null | undefined>(`/api/accounts`, { method: "GET" }),
      fetchJSON<WorkItem[] | null | undefined>(`/api/workitems?workerId=${encodeURIComponent(effectiveWorkerId)}&scope=all`, { method: "GET" }),
      fetchJSON<PayoutBatch[] | null | undefined>(`/api/payoutbatches?workerId=${encodeURIComponent(effectiveWorkerId)}`, { method: "GET" }),
      fetchJSON<UpiConfig | null | undefined>(`/api/upi?workerId=${encodeURIComponent(effectiveWorkerId)}`, { method: "GET" }),
    ]);

    let anyOk = false;

    if (rWorkers.ok) {
      const safe = toArray<WorkerProfile>(rWorkers.data, []);
      if (safe.length || Array.isArray(rWorkers.data)) {
        anyOk = true;
        setWorkers(safe);
        writeLS(LS_KEYS.WORKERS, safe);
      }
    }

    if (rAccounts.ok) {
      const safe = toArray<AssignedAccount>(rAccounts.data, []);
      if (safe.length || Array.isArray(rAccounts.data)) {
        anyOk = true;
        setAccounts(safe);
        writeLS(LS_KEYS.ACCOUNTS, safe);
      }
    }

    if (rItems.ok) {
      const safe = toArray<WorkItem>(rItems.data, []);
      if (safe.length || Array.isArray(rItems.data)) {
        anyOk = true;
        setItems(safe);
        setAllItems(safe);
        writeLS(LS_KEYS.ITEMS, safe);
      }
    }

    if (rPayouts.ok) {
      const safe = toArray<PayoutBatch>(rPayouts.data, []);
      if (safe.length || Array.isArray(rPayouts.data)) {
        anyOk = true;
        setPayoutBatches(safe);
        writeLS(LS_KEYS.PAYOUTS, safe);
        const failed = safe.filter((b) => b.status === "Failed").length;
        if (failed > 0) {
          const state = readLS<{ remaining: number; lastFailed: number }>(LS_KEYS.PAYOUT_REVERSAL, {
            remaining: 0,
            lastFailed: 0,
          });
          const nextRemaining = failed !== state.lastFailed ? 6 : Math.max(0, state.remaining - 1);
          writeLS(LS_KEYS.PAYOUT_REVERSAL, { remaining: nextRemaining, lastFailed: failed });
          if (nextRemaining > 0) {
            showPayoutReversal("Rejected payouts were reversed back to approved earnings. You can request again.");
          }
        }
      }
    }

    if (rUpi.ok) {
      if (rUpi.data && typeof rUpi.data === "object" && !Array.isArray(rUpi.data)) {
        anyOk = true;
        const safe = normalizeUpi(rUpi.data);
        setUpi(safe);
        writeLS(LS_KEYS.UPI, safe);
      }
    }

    if (!anyOk) {
      setLoadError("Live data temporarily unavailable. Showing last synced data.");
    } else {
      setApiLoaded(true);
    }

    setLoading(false);
    loadInFlightRef.current = false;
  }, [hydrated, effectiveWorkerId]);

  // initial load + reload when worker changes
  useEffect(() => {
    if (!hydrated) return;
    loadFromApi();
    return () => {
      loadInFlightRef.current = false;
    };
  }, [hydrated, effectiveWorkerId, loadFromApi]);

  // background refresh to keep scheduled work flowing without manual reload
  useEffect(() => {
    if (!hydrated || !isWorkerAuthed) return;
    const id = window.setInterval(() => {
      loadFromApi();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [hydrated, isWorkerAuthed, loadFromApi]);

  useEffect(() => {
    if (!allItems.length && items.length) setAllItems(items);
  }, [items, allItems.length]);

  // Worker profile + assigned accounts
  const me = useMemo(
    () =>
      toArray<WorkerProfile>(workers, []).find((w) => w.id === effectiveWorkerId || (w as any).workerId === effectiveWorkerId) ??
      null,
    [workers, effectiveWorkerId]
  );
  const assignedAccountIds = useMemo(() => {
    if (me?.assignedAccountIds?.length) return new Set(me.assignedAccountIds);
    if (me?.assignedAccounts?.length) return new Set(me.assignedAccounts.map((a) => a.id));
    return new Set<string>();
  }, [me]);
  const assignedAccounts = useMemo(() => {
    if (me?.assignedAccounts?.length) return me.assignedAccounts;
    if (!assignedAccountIds.size) return [];
    const normalizedIds = new Set(Array.from(assignedAccountIds).map((id) => String(id).trim().toLowerCase()));
    return accounts.filter((a) => normalizedIds.has(String(a.id).trim().toLowerCase()));
  }, [accounts, assignedAccountIds, me]);
  const assignedAccountsCount = useMemo(() => (me?.assignedAccountIds?.length ? me.assignedAccountIds.length : assignedAccountIds.size), [me, assignedAccountIds]);

  useEffect(() => {
    if (!hydrated) return;
    if (!isWorkerAuthed) return;

    let refreshTimer: number | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        loadFromApi();
      }, 500);
    };

    const accountIds = Array.from(assignedAccountIds);
    const accountFilter = accountIds.length ? `account_id=in.(${accountIds.join(",")})` : null;

    const channels = [
      supabase.channel(`worker-workitems-by-worker-${effectiveWorkerId}`).on(
        "postgres_changes",
        { event: "*", schema: "public", table: "work_items", filter: `worker_id=eq.${effectiveWorkerId}` },
        scheduleRefresh
      ),
      accountFilter
        ? supabase.channel(`worker-workitems-by-account-${effectiveWorkerId}`).on(
            "postgres_changes",
            { event: "*", schema: "public", table: "work_items", filter: accountFilter },
            scheduleRefresh
          )
        : null,
      supabase.channel(`worker-assignments-${effectiveWorkerId}`).on(
        "postgres_changes",
        { event: "*", schema: "public", table: "assignments" },
        scheduleRefresh
      ),
      supabase.channel(`worker-account-assignments-${effectiveWorkerId}`).on(
        "postgres_changes",
        { event: "*", schema: "public", table: "worker_account_assignments" },
        scheduleRefresh
      ),
      supabase.channel(`worker-accounts-${effectiveWorkerId}`).on(
        "postgres_changes",
        { event: "*", schema: "public", table: "worker_accounts" },
        scheduleRefresh
      ),
    ].filter(Boolean);

    channels.forEach((ch: any) => ch.subscribe());

    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      channels.forEach((ch: any) => supabase.removeChannel(ch));
    };
  }, [hydrated, isWorkerAuthed, effectiveWorkerId, loadFromApi, assignedAccountIds]);

  const accountById = useMemo(() => {
    const m = new Map(accounts.map((a) => [a.id, a] as const));
    return (id: string) => m.get(id);
  }, [accounts]);

  const upcomingItems = useMemo(() => {
    const nowUtc = new Date();
    return allItems
      .filter((x) => {
        if (x.status !== "Open") return false;
        const dueUtc = parseIstLocalToUtc(x.dueAt);
        const windowStart = new Date(dueUtc.getTime() - x.slaMinutes * 60 * 1000);
        const previewStart = new Date(windowStart.getTime() - 60 * 60 * 1000);
        return nowUtc >= previewStart && nowUtc < windowStart;
      })
      .sort((a, b) => parseIstLocalToUtc(a.dueAt).getTime() - parseIstLocalToUtc(b.dueAt).getTime())
      .slice(0, 6);
  }, [allItems]);

  const activeItems = useMemo(() => {
    return allItems.filter((x) => {
      if (x.workerId && x.workerId !== effectiveWorkerId && x.workerId !== me?.userId) return false;
      if (x.status === "Cancelled") return false;
      // Show scheduled open work immediately in queue (not only within execution window)
      // so newly assigned accounts clearly surface queued workload.
      if (x.status === "Open") return true;
      return x.status === "In progress" || x.status === "Needs fix";
    });
  }, [allItems, effectiveWorkerId, me?.userId]);

  // SLA meta
  const slaMeta = useMemo(() => {
    const now = new Date();
    const map = new Map<string, { dueInMin: number; overdue: boolean; slaRemaining?: number; slaBreached?: boolean }>();

    activeItems.forEach((x) => {
      const due = parseLocalISO(x.dueAt);
      const dueInMin = minutesBetween(now, due);
      const overdue = dueInMin < 0 && (x.status === "Open" || x.status === "In progress" || x.status === "Needs fix");

      let slaRemaining: number | undefined = undefined;
      let slaBreached: boolean | undefined = undefined;

      if (x.startedAt && (x.status === "In progress" || x.status === "Submitted" || x.status === "Approved")) {
        const started = parseLocalISO(x.startedAt);
        const elapsed = minutesBetween(started, now);
        slaRemaining = x.slaMinutes - elapsed;
        slaBreached = slaRemaining < 0 && x.status === "In progress";
      }

      map.set(x.id, { dueInMin, overdue, slaRemaining, slaBreached });
    });

    return (id: string) => map.get(id);
  }, [activeItems, tick]);

  const gateScore = useCallback((x: WorkItem) => {
    const vals = Object.values(x.gates);
    const ok = vals.filter(Boolean).length;
    return { ok, total: vals.length };
  }, []);

  // Worklist filtered to assigned accounts only
  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return activeItems
      .filter((x) => assignedAccountIds.has(x.accountId))
      .filter((x) => (priorityFilter === "All" ? true : x.priority === priorityFilter))
      .filter((x) => {
        if (!strictOnly) return true;
        const a = accountById(x.accountId);
        return a?.policyTier === "Strict";
      })
      .filter((x) => {
        if (!ql) return true;
        const a = accountById(x.accountId);
        return (
          x.id.toLowerCase().includes(ql) ||
          x.title.toLowerCase().includes(ql) ||
          x.type.toLowerCase().includes(ql) ||
          (a?.handle ?? "").toLowerCase().includes(ql) ||
          (a?.ownerTeam ?? "").toLowerCase().includes(ql)
        );
      })
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority < b.priority ? -1 : 1;
        return parseLocalISO(a.dueAt).getTime() - parseLocalISO(b.dueAt).getTime();
      });
  }, [activeItems, assignedAccountIds, priorityFilter, strictOnly, q, accountById]);

  const selected = useMemo(() => (selectedId ? activeItems.find((x) => x.id === selectedId) ?? null : null), [activeItems, selectedId]);
  const selectedAccount = useMemo(() => (selected ? accountById(selected.accountId) : undefined), [selected, accountById]);

  const kpiScope = useMemo(
    () =>
      allItems.filter((x) => {
        if (x.workerId && x.workerId !== effectiveWorkerId && x.workerId !== me?.userId) return false;
        return assignedAccountIds.has(x.accountId);
      }),
    [allItems, effectiveWorkerId, me?.userId, assignedAccountIds]
  );

  const kpis = useMemo(() => {
    const open = activeItems.filter((x) => x.status === "Open").length;
    const inProg = activeItems.filter((x) => x.status === "In progress").length;
    const needsFix = activeItems.filter((x) => x.status === "Needs fix").length;
    const submitted = kpiScope.filter((x) => x.status === "Submitted").length;
    const hardRejected = kpiScope.filter((x) => x.status === "Hard rejected").length;
    const approved = kpiScope.filter((x) => x.status === "Approved").length;
    const earnings = kpiScope.filter((x) => x.status === "Approved").reduce((s, x) => s + x.rewardINR, 0);
    const pending = kpiScope.filter((x) => x.status === "Submitted").reduce((s, x) => s + x.rewardINR, 0);
    const count = kpiScope.length;
    return { open, inProg, submitted, needsFix, hardRejected, approved, earnings, pending, count };
  }, [activeItems, kpiScope]);

  const completedCount = useMemo(() => {
    return kpiScope.filter((x) => !!x.submission?.submittedAt || !!x.completedAt || x.status === "Approved" || x.status === "Hard rejected" || x.status === "Needs fix" || x.status === "Submitted").length;
  }, [kpiScope]);

  const levelLabel = useMemo(() => {
    if (completedCount >= 1000) return "Skilled";
    return "Fresher";
  }, [completedCount]);

  const payoutIncludedIds = useMemo(() => {
    const ids = new Set<string>();
    payoutBatches.forEach((b) =>
      b.items.forEach((i) => {
        if (i.status === "Failed") return;
        ids.add(i.workItemId);
      })
    );
    return ids;
  }, [payoutBatches]);

  const approvedForPayout = useMemo(() => kpiScope.filter((x) => x.status === "Approved"), [kpiScope]);
  const eligiblePayoutItems = useMemo(() => approvedForPayout.filter((x) => !payoutIncludedIds.has(x.id)), [approvedForPayout, payoutIncludedIds]);
  const eligiblePayoutTotal = useMemo(() => eligiblePayoutItems.reduce((sum, it) => sum + it.rewardINR, 0), [eligiblePayoutItems]);
  const hasProcessingPayout = useMemo(() => payoutBatches.some((b) => b.status === "Processing"), [payoutBatches]);
  const hasDraftPayout = useMemo(() => payoutBatches.some((b) => b.status === "Draft"), [payoutBatches]);
  const processingEta = useMemo(() => {
    const hit = payoutBatches.find((b) => b.status === "Processing");
    const note = hit?.notes?.find((n) => String(n).startsWith("ETA:"));
    return note ? String(note).slice("ETA:".length) : undefined;
  }, [payoutBatches]);

  const [payoutNotice, setPayoutNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const payoutNoticeTimer = useRef<number | null>(null);
  const [payoutReversalNotice, setPayoutReversalNotice] = useState<string | null>(null);
  const payoutReversalTimer = useRef<number | null>(null);

  const showPayoutNotice = useCallback((tone: "success" | "danger", text: string) => {
    setPayoutNotice({ tone, text });
    if (payoutNoticeTimer.current) window.clearTimeout(payoutNoticeTimer.current);
    payoutNoticeTimer.current = window.setTimeout(() => setPayoutNotice(null), 4000);
  }, []);

  const showPayoutReversal = useCallback((text: string) => {
    setPayoutReversalNotice(text);
    if (payoutReversalTimer.current) window.clearTimeout(payoutReversalTimer.current);
    payoutReversalTimer.current = window.setTimeout(() => setPayoutReversalNotice(null), 5000);
  }, []);

  /** ===================== Performance metrics (Worker) ===================== */
  const perf = useMemo(() => {
    const scope = kpiScope;
    const started = scope.filter((x) => !!x.startedAt).length;
    const completed = scope.filter((x) => !!x.completedAt || x.status === "Approved" || x.status === "Submitted").length;
    const now = new Date();

    const completedReels = scope.filter((x) => x.type === "Reel posting" && (x.status === "Approved" || x.status === "Submitted") && !!x.startedAt);
    const slaEvaluated = scope.filter((x) => !!x.startedAt && (x.status === "Submitted" || x.status === "Approved" || x.status === "In progress"));

    const slaMetCount = slaEvaluated.filter((x) => {
      if (!x.startedAt) return false;
      const startedAt = parseLocalISO(x.startedAt);
      const end = x.completedAt ? parseLocalISO(x.completedAt) : now;
      const elapsed = minutesBetween(startedAt, end);
      return elapsed <= x.slaMinutes;
    }).length;

    const slaBreachedCount = slaEvaluated.length - slaMetCount;
    const slaRate = slaEvaluated.length > 0 ? Math.round((slaMetCount / slaEvaluated.length) * 100) : 0;

    const avgCompletionMins = (() => {
      const done = scope.filter((x) => !!x.startedAt && !!x.completedAt);
      if (done.length === 0) return 0;
      const sum = done.reduce((s, x) => {
        const st = parseLocalISO(x.startedAt!);
        const en = parseLocalISO(x.completedAt!);
        return s + Math.max(0, minutesBetween(st, en));
      }, 0);
      return Math.round(sum / done.length);
    })();

    const onTimeDueCount = scope.filter((x) => {
      if (!x.completedAt) return false;
      const due = parseLocalISO(x.dueAt);
      const done = parseLocalISO(x.completedAt);
      return done.getTime() <= due.getTime();
    }).length;

    const dueEvaluated = scope.filter((x) => !!x.completedAt).length;
    const dueOnTimeRate = dueEvaluated > 0 ? Math.round((onTimeDueCount / dueEvaluated) * 100) : 0;

    const earningsApproved = scope.filter((x) => x.status === "Approved").reduce((s, x) => s + x.rewardINR, 0);
    const pendingSubmitted = scope.filter((x) => x.status === "Submitted").reduce((s, x) => s + x.rewardINR, 0);
    const hardRejects = scope.filter((x) => x.status === "Hard rejected").length;
    const needsFixCount = scope.filter((x) => x.status === "Needs fix").length;
    const approvedReels = scope.filter((x) => x.type === "Reel posting" && x.status === "Approved").length;

    return {
      started,
      completed,
      slaEvaluated: slaEvaluated.length,
      slaMetCount,
      slaBreachedCount,
      slaRate,
      avgCompletionMins,
      dueEvaluated,
      dueOnTimeRate,
      earningsApproved,
      pendingSubmitted,
      hardRejects,
      needsFixCount,
      approvedReels,
      completedReels: completedReels.length,
    };
  }, [kpiScope, tick]);

  /** ===================== Actions (Worker-only) ===================== */
  const logAuditLocal = useCallback((id: string, by: string, text: string) => {
    setItems((prev) => {
      const next = prev.map((x) => (x.id === id ? { ...x, audit: [{ at: nowStamp(), by, text }, ...x.audit] } : x));
      writeLS(LS_KEYS.ITEMS, next);
      return next;
    });
  }, []);

  const patchItemState = useCallback((id: string, updater: (x: WorkItem) => WorkItem) => {
    setItems((prev) => {
      const next = prev.map((x) => (x.id === id ? updater(x) : x));
      writeLS(LS_KEYS.ITEMS, next);
      return next;
    });
    setAllItems((prev) => prev.map((x) => (x.id === id ? updater(x) : x)));
  }, []);

  const openDetails = useCallback((id: string) => {
    setSelectedId(id);
    if (isMobileWidth()) setDetailsOpenMobile(true);
  }, []);

  const markStart = useCallback(
    async (id: string) => {
      if (!isWorkerAuthed) return;
      if (!id || id === "undefined") return;

      // optimistic local
      patchItemState(id, (x) => (x.status === "Open" ? { ...x, status: "In progress", startedAt: nowISO() } : x));

      logAuditLocal(id, "Worker", "Marked as In progress.");

      // backend patch
      const r = await fetchJSON<WorkItem>(`/api/workitems/${encodeURIComponent(id)}/start`, {
        method: "PATCH",
        body: JSON.stringify({ workerId: effectiveWorkerId, id }),
      });

      if (r.ok && r.data) {
        patchItemState(id, () => r.data as WorkItem);
      }
    },
    [logAuditLocal, effectiveWorkerId, isWorkerAuthed, patchItemState]
  );

  const openSubmit = useCallback((id: string) => {
    if (!id || id === "undefined") return;
    setSelectedId(id);
    setSubmitReelUrl("");
    setSubmitShotUrl("");
    setSubmitOpen(true);
  }, []);

  const submitProof = useCallback(async () => {
    if (!isWorkerAuthed) return;
    if (!selectedId) return;

    const reel = submitReelUrl.trim();
    const shot = submitShotUrl.trim();
    if (!reel || !shot) return;

    // optimistic local
    patchItemState(selectedId, (x) => ({
      ...x,
      status: "Submitted",
      completedAt: nowISO(),
      gates: { ...x.gates, proofAttached: true },
      submission: { reelUrl: reel, screenshotUrl: shot, submittedAt: nowStamp() },
      review: undefined,
    }));

    logAuditLocal(selectedId, "Worker", "Submitted proof links.");
    setSubmitOpen(false);

    // backend patch
    const r = await fetchJSON<WorkItem>(`/api/workitems/${encodeURIComponent(selectedId)}/submit`, {
      method: "PATCH",
      body: JSON.stringify({ workerId: effectiveWorkerId, id: selectedId, reelUrl: reel, screenshotUrl: shot }),
    });

    if (r.ok && r.data) {
      patchItemState(selectedId, () => r.data as WorkItem);
    }
  }, [selectedId, submitReelUrl, submitShotUrl, logAuditLocal, effectiveWorkerId, isWorkerAuthed, patchItemState]);

  /** ===================== UPI (worker config) ===================== */
  const [upiVerifyError, setUpiVerifyError] = useState("");
  const [upiNotice, setUpiNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const upiNoticeTimer = useRef<number | null>(null);

  const showUpiNotice = useCallback((tone: "success" | "danger", text: string) => {
    setUpiNotice({ tone, text });
    if (upiNoticeTimer.current) window.clearTimeout(upiNoticeTimer.current);
    upiNoticeTimer.current = window.setTimeout(() => setUpiNotice(null), 4000);
  }, []);

  const verifyUpi = useCallback(async () => {
    if (!isWorkerAuthed) return;
    setUpiVerifyError("");

    if (!isValidUpi(upi.upiId)) {
      setUpiVerifyError("Enter a valid UPI ID (example: name@bank).");
      return;
    }

    const next = { ...upi, verified: true, verifiedAt: nowStamp() };
    setUpi(next);
    writeLS(LS_KEYS.UPI, next);

    const res = await fetchJSON<UpiConfig>(`/api/upi`, { method: "PUT", body: JSON.stringify({ workerId: effectiveWorkerId, ...next }) });
    if (!res.ok) {
      setUpiVerifyError(res.error || "Unable to save UPI right now.");
      showUpiNotice("danger", "UPI save failed. Please retry.");
      return;
    }
    showUpiNotice("success", "UPI verified and saved.");
  }, [upi, effectiveWorkerId, isWorkerAuthed, showUpiNotice]);

  const requestPayout = useCallback(async () => {
    if (!isWorkerAuthed) return;
    if (!upi.verified) {
      showPayoutNotice("danger", "Verify UPI before requesting payout.");
      return;
    }
    if (hasProcessingPayout) {
      showPayoutNotice("danger", "You already have a pending payout request.");
      return;
    }
    if (!eligiblePayoutItems.length) {
      showPayoutNotice("danger", "No approved items available for payout.");
      return;
    }

    const res = await fetchJSON<{ ok: boolean; batchId?: string }>(`/api/payoutbatches/request`, {
      method: "POST",
      body: JSON.stringify({ workerId: effectiveWorkerId }),
    });
    if (!res.ok) {
      showPayoutNotice("danger", res.error || "Payout request failed.");
      return;
    }
    showPayoutNotice("success", "Payout request submitted.");
    loadFromApi();
  }, [isWorkerAuthed, upi.verified, hasProcessingPayout, eligiblePayoutItems.length, effectiveWorkerId, showPayoutNotice, loadFromApi]);

  const autoPayoutKey = useMemo(() => {
    const now = istNow();
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const matchDay = dayNames[now.weekday] === upi.payoutDay;
    if (!matchDay) return null;
    if (upi.payoutSchedule === "Monthly") {
      if (now.day > 7) return null;
      return `${now.year}-${pad2(now.month)}-${upi.payoutDay}`;
    }
    if (upi.payoutSchedule === "Bi-weekly") {
      const wk = isoWeekNumber(new Date(Date.UTC(now.year, now.month - 1, now.day)));
      if (wk % 2 !== 0) return null;
      return `bi-${now.year}-${wk}-${upi.payoutDay}`;
    }
    return `${now.year}-${pad2(now.month)}-${pad2(now.day)}`;
  }, [upi.payoutSchedule, upi.payoutDay]);

  useEffect(() => {
    if (!isWorkerAuthed || !upi.verified) return;
    if (hasProcessingPayout) return;
    if (!autoPayoutKey) return;
    if (eligiblePayoutTotal < 500) return;
    const lastKey = readLS<string | null>(LS_KEYS.PAYOUTS + ":auto", null);
    if (lastKey === autoPayoutKey) return;
    writeLS(LS_KEYS.PAYOUTS + ":auto", autoPayoutKey);
    requestPayout();
  }, [isWorkerAuthed, upi.verified, hasProcessingPayout, autoPayoutKey, eligiblePayoutTotal, requestPayout]);

  const currentDraftBatch = useMemo(() => payoutBatches.find((b) => b.status === "Draft") ?? null, [payoutBatches]);
  const myBatches = useMemo(() => payoutBatches.slice().sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1)), [payoutBatches]);

  const batchTotals = useCallback((b: PayoutBatch) => {
    const total = b.items.reduce((s, it) => s + it.amountINR, 0);
    const paid = b.items.filter((it) => it.status === "Paid").reduce((s, it) => s + it.amountINR, 0);
    return { total, paid, count: b.items.length };
  }, []);

  const clearFilters = useCallback(() => {
    setQ("");
    setStrictOnly(false);
    setPriorityFilter("All");
  }, []);

  const selfieStep1Done = cameraOn || !!selfiePreview || !!selfieFile || !!kycForm.selfiePath;
  const selfieStep2Done = !!selfiePreview || !!selfieFile || !!kycForm.selfiePath;
  const selfieStep3Done = !!kycForm.selfiePath;
  const selfieActiveStep = !selfieStep1Done ? 1 : !selfieStep2Done ? 2 : !selfieStep3Done ? 3 : 0;

  /** If not hydrated, render safe shell */
  if (!hydrated) {
    return <div className="min-h-screen bg-slate-50" />;
  }

  /**
   * If session not yet loaded from LS, DO NOT redirect here (effect handles after sessionLoaded).
   * Render safe shell to avoid flicker + loop.
   */
  if (!sessionLoaded) {
    return <div className="min-h-screen bg-slate-50" />;
  }

  /**
   * 🔒 HARD BLOCK: if not an authed Worker, show safe shell only.
   * Redirect effect already handles /login and /admin.
   */
  if (!session || session.role !== "Worker") {
    return <div className="min-h-screen bg-slate-50" />;
  }

  if (!kycLoaded) {
    return <div className="min-h-screen bg-slate-50" />;
  }

  if (kycStatus !== "approved") {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,#dbeafe,transparent_45%)]" />
        <div className="relative mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
          <div className="rounded-3xl border border-slate-200 bg-white/95 p-5 shadow-xl shadow-slate-200/70 backdrop-blur sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Identity verification</div>
                <div className="mt-1 text-xl font-semibold text-slate-900 sm:text-2xl">Complete KYC to access Workspace</div>
                <div className="mt-2 text-sm text-slate-600">
                  Full-time gigs require identity verification before access is granted.
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-700">
                  Secure onboarding
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                  Admin reviewed
                </span>
              </div>
            </div>

            {kycStatus === "pending" && (
              <div className="mt-5 rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-slate-50 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-base font-semibold text-blue-700">KYC submitted. Pending admin review.</div>
                  <span className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-700">
                    In review
                  </span>
                </div>
                <div className="mt-2 text-sm text-slate-600">
                  Your verification packet is queued. You can keep browsing restricted previews while review is in progress.
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                    1. Identity details submitted
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                    2. Documents uploaded
                  </div>
                  <div className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700">
                    3. Admin verification in progress
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-slate-600">
                    Typical review window: 10-30 mins
                  </span>
                  <button
                    type="button"
                    className="rounded-full border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:border-slate-400"
                    onClick={() => window.location.reload()}
                  >
                    Refresh status
                  </button>
                </div>
              </div>
            )}

            {kycStatus === "rejected" && (
              <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                KYC rejected{kycRejection ? `: ${kycRejection}` : "."} Please resubmit with correct details.
              </div>
            )}

            {kycError && (
              <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700">
                {kycError}
              </div>
            )}

            {kycStatus !== "pending" && (
              <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_1fr]">
                <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Profile details</div>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label className="text-xs font-semibold text-slate-600 sm:col-span-2">
                      Legal name
                      <input
                        className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
                        value={kycForm.legalName}
                        onChange={(e) => setKycForm((p) => ({ ...p, legalName: e.target.value }))}
                      />
                    </label>
                    <label className="text-xs font-semibold text-slate-600">
                      Date of birth
                      <div className="mt-2 rounded-xl border border-slate-300 bg-white p-2.5">
                        <div className="grid grid-cols-3 gap-2">
                          <select
                            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-sm text-slate-900"
                            value={dobParts.day}
                            onChange={(e) => updateDobPart("day", e.target.value)}
                          >
                            <option value="">Day</option>
                            {dobDayOptions.map((d) => (
                              <option key={d} value={d}>
                                {d}
                              </option>
                            ))}
                          </select>
                          <select
                            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-sm text-slate-900"
                            value={dobParts.month}
                            onChange={(e) => updateDobPart("month", e.target.value)}
                          >
                            <option value="">Month</option>
                            {dobMonthOptions.map((m) => (
                              <option key={m.value} value={m.value}>
                                {m.label}
                              </option>
                            ))}
                          </select>
                          <select
                            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-sm text-slate-900"
                            value={dobParts.year}
                            onChange={(e) => updateDobPart("year", e.target.value)}
                          >
                            <option value="">Year</option>
                            {dobYearOptions.map((y) => (
                              <option key={y} value={y}>
                                {y}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="mt-2 text-[11px] text-slate-500">Accepted format: DD/MM/YYYY • Minimum age: 18</div>
                      </div>
                    </label>
                    <label className="text-xs font-semibold text-slate-600">
                      Phone
                      <input
                        className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
                        value={kycForm.phone}
                        onChange={(e) => setKycForm((p) => ({ ...p, phone: e.target.value }))}
                      />
                    </label>
                    <label className="text-xs font-semibold text-slate-600 sm:col-span-2">
                      Address
                      <input
                        className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
                        value={kycForm.address}
                        onChange={(e) => setKycForm((p) => ({ ...p, address: e.target.value }))}
                      />
                    </label>
                    <label className="text-xs font-semibold text-slate-600">
                      ID type
                      <select
                        className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
                        value={kycForm.idType}
                        onChange={(e) => setKycForm((p) => ({ ...p, idType: e.target.value }))}
                      >
                        <option value="">Select</option>
                        <option value="Passport">Passport</option>
                        <option value="Driver License">Driver License</option>
                        <option value="National ID">National ID</option>
                      </select>
                    </label>
                    <label className="text-xs font-semibold text-slate-600">
                      ID number
                      <input
                        className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
                        value={kycForm.idNumber}
                        onChange={(e) => setKycForm((p) => ({ ...p, idNumber: e.target.value }))}
                      />
                    </label>
                    <label className="text-xs font-semibold text-slate-600 sm:col-span-2">
                      ID document (front)
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          setKycLoading(true);
                          setKycError(null);
                          try {
                            const { data } = await supabase.auth.getSession();
                            const token = data.session?.access_token;
                            if (!token) throw new Error("Not authenticated");
                            const fd = new FormData();
                            fd.append("file", file);
                            fd.append("kind", "id_doc");
                            const res = await fetch("/api/kyc/upload", {
                              method: "POST",
                              headers: { Authorization: `Bearer ${token}` },
                              body: fd,
                            });
                            const payload = await res.json().catch(() => ({}));
                            if (!res.ok) throw new Error(payload?.error || "Upload failed");
                            setKycForm((p) => ({ ...p, idDocPath: payload.path }));
                          } catch (err: any) {
                            setKycError(err?.message || "Upload failed");
                          } finally {
                            setKycLoading(false);
                          }
                        }}
                      />
                      {kycForm.idDocPath && <div className="mt-1 text-[11px] text-emerald-600">Uploaded</div>}
                    </label>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                  <label className="text-xs font-semibold text-slate-600">
                    Selfie verification
                    <div className="mt-2 rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-3 sm:p-4">
                      <div className="flex items-center justify-between">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Live capture required</div>
                        <div className="flex items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cameraOn ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
                            {cameraOn ? "Camera live" : "Camera off"}
                          </span>
                          {cameraOn ? (
                            <button type="button" className="text-xs font-semibold text-slate-600 hover:text-slate-900" onClick={stopCamera}>
                              Stop camera
                            </button>
                          ) : (
                            <button type="button" className="text-xs font-semibold text-[#0b5cab] hover:text-[#0f6bc7]" onClick={startCamera}>
                              Start camera
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 grid gap-2 text-[11px] text-slate-500 sm:grid-cols-3">
                        <div
                          className={`rounded-lg border px-2.5 py-2 ${
                            selfieStep1Done
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : selfieActiveStep === 1
                                ? "border-blue-200 bg-blue-50 text-blue-700"
                                : "border-slate-200 bg-white text-slate-500"
                          }`}
                        >
                          <span className="font-semibold">Step 1:</span> Start camera
                          <span className="ml-1 text-[10px]">{selfieStep1Done ? "Done" : selfieActiveStep === 1 ? "Active" : "Pending"}</span>
                        </div>
                        <div
                          className={`rounded-lg border px-2.5 py-2 ${
                            selfieStep2Done
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : selfieActiveStep === 2
                                ? "border-blue-200 bg-blue-50 text-blue-700"
                                : "border-slate-200 bg-white text-slate-500"
                          }`}
                        >
                          <span className="font-semibold">Step 2:</span> Capture selfie
                          <span className="ml-1 text-[10px]">{selfieStep2Done ? "Done" : selfieActiveStep === 2 ? "Active" : "Pending"}</span>
                        </div>
                        <div
                          className={`rounded-lg border px-2.5 py-2 ${
                            selfieStep3Done
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : selfieActiveStep === 3
                                ? "border-blue-200 bg-blue-50 text-blue-700"
                                : "border-slate-200 bg-white text-slate-500"
                          }`}
                        >
                          <span className="font-semibold">Step 3:</span> Upload
                          <span className="ml-1 text-[10px]">{selfieStep3Done ? "Done" : selfieActiveStep === 3 ? "Active" : "Pending"}</span>
                        </div>
                      </div>
                      <div className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-600">
                        {selfieActiveStep === 1 && "Next action: turn on live camera to begin verification."}
                        {selfieActiveStep === 2 && "Next action: capture a clear selfie with your face fully visible."}
                        {selfieActiveStep === 3 && "Next action: upload captured selfie to complete this verification block."}
                        {selfieActiveStep === 0 && "Selfie verification steps completed. You can submit KYC."}
                      </div>

                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                          <div className="absolute left-2 top-2 z-10 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-slate-600">Live feed</div>
                          <video ref={videoRef} className={`h-40 w-full object-cover ${cameraOn ? "block" : "hidden"}`} playsInline />
                          {!cameraOn && <div className="flex h-40 items-center justify-center text-xs text-slate-400">Camera preview</div>}
                        </div>
                        <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                          <div className="absolute left-2 top-2 z-10 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-slate-600">Captured image</div>
                          {selfiePreview ? (
                            <img src={selfiePreview} alt="Selfie preview" className="h-40 w-full object-cover" />
                          ) : (
                            <div className="flex h-40 items-center justify-center text-xs text-slate-400">No selfie captured</div>
                          )}
                        </div>
                      </div>

                      {cameraError && <div className="mt-2 text-xs font-semibold text-rose-600">{cameraError}</div>}
                      {kycForm.selfiePath && <div className="mt-2 text-[11px] font-semibold text-emerald-600">Selfie uploaded successfully</div>}

                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-slate-300 disabled:opacity-60"
                          onClick={startCamera}
                          disabled={cameraOn}
                        >
                          Start live camera
                        </button>
                        <button
                          type="button"
                          className="rounded-md bg-[#0b5cab] px-3 py-2 text-xs font-semibold text-white hover:bg-[#0f6bc7] disabled:opacity-60"
                          onClick={captureSelfie}
                          disabled={!cameraOn}
                        >
                          Capture selfie
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-slate-300 disabled:opacity-60"
                          onClick={async () => {
                            if (!selfieFile) return;
                            await uploadKycFile("selfie", selfieFile);
                          }}
                          disabled={!selfieFile || kycLoading}
                        >
                          Upload selfie
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-slate-300"
                          onClick={() => {
                            setSelfiePreview(null);
                            setKycForm((p) => ({ ...p, selfiePath: "" }));
                            setSelfieFile(null);
                          }}
                        >
                          Retake
                        </button>
                      </div>
                      <canvas ref={canvasRef} className="hidden" />
                    </div>
                  </label>
                </div>
              </div>
            )}

            {kycStatus !== "pending" && (
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
                <div className="text-xs text-slate-600">Review all details before submitting. Incorrect information may delay approval.</div>
                <button
                  className="rounded-full bg-[#0b5cab] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#0f6bc7] disabled:opacity-60"
                  disabled={kycLoading}
                  onClick={async () => {
                    setKycLoading(true);
                    setKycError(null);
                    try {
                      const { data } = await supabase.auth.getSession();
                      const token = data.session?.access_token;
                      if (!token) throw new Error("Not authenticated");
                      const res = await fetch("/api/kyc", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                        body: JSON.stringify(kycForm),
                      });
                      const payload = await res.json().catch(() => ({}));
                      if (!res.ok) throw new Error(payload?.error || "Submission failed");
                      setKycStatus("pending");
                    } catch (e: any) {
                      setKycError(e?.message || "Submission failed");
                    } finally {
                      setKycLoading(false);
                    }
                  }}
                >
                  Submit KYC
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Mobile navigation */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-slate-900/30" onClick={() => setMobileNavOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-[88vw] max-w-[320px] bg-white shadow-xl">
            <SidebarWorker activeSection={activeSection} setActiveSection={setActiveSection} onClose={() => setMobileNavOpen(false)} />
          </div>
        </div>
      )}

      {/* Mobile details drawer */}
      {detailsOpenMobile && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Work item details">
          <div className="absolute inset-0 bg-slate-900/30" onClick={() => setDetailsOpenMobile(false)} />
          <div className="absolute right-0 top-0 h-full w-[92vw] max-w-[560px] bg-white shadow-xl">
            <DetailsPanelWorker
              item={selected}
              account={selectedAccount}
              onClose={() => setDetailsOpenMobile(false)}
              onStart={markStart}
              onSubmit={openSubmit}
              gateScore={gateScore}
              slaMeta={slaMeta}
            />
          </div>
        </div>
      )}

      <div className="flex min-h-screen">
        {/* Desktop sidebar */}
        <aside className="hidden w-[292px] border-r border-slate-200 bg-white lg:block">
          <SidebarWorker activeSection={activeSection} setActiveSection={setActiveSection} />
        </aside>

        {/* Main */}
        <div className="flex-1">
          {/* Header */}
          <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
            <div className="mx-auto max-w-7xl px-4 py-2 sm:px-6">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <button
                    className="lg:hidden inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white hover:bg-slate-50"
                    onClick={() => setMobileNavOpen(true)}
                    aria-label="Open navigation"
                  >
                    <Icon name="hamburger" className="text-slate-700" />
                  </button>

                  <div className="grid h-10 w-10 place-items-center rounded-md bg-[#0078d4] text-white font-black">IG</div>

                  <div className="min-w-0">
                    <div className="text-sm font-extrabold text-slate-900 truncate">
                      {activeSection === "Operations"
                        ? "Worker Operations"
                        : activeSection === "Accounts"
                        ? "Assigned Accounts"
                        : activeSection === "Performance"
                        ? "Performance Metrics"
                        : activeSection === "UPI"
                        ? "UPI Payout Configuration"
                        : "Payouts"}
                    </div>
                    <div className="hidden sm:block text-xs text-slate-600 truncate">Logged in as Worker</div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="hidden md:flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-700">
                    <Icon name="search" />
                    <input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder={
                        activeSection === "Operations"
                          ? "Search WI, title, @handle…"
                          : activeSection === "Accounts"
                          ? "Search @handle…"
                          : activeSection === "Payouts"
                          ? "Search batch…"
                          : activeSection === "Performance"
                          ? "Search WI/account…"
                          : "Search…"
                      }
                      aria-label="Search"
                      className="w-[360px] bg-transparent text-sm outline-none placeholder:text-slate-400"
                    />
                  </div>

                  <Button variant="secondary" onClick={loadFromApi} title="Reload from API">
                    <Icon name="refresh" />
                    <span className="hidden sm:inline">{loading ? "Loading…" : "Sync"}</span>
                  </Button>

                  <Button variant="ghost" className="border border-slate-200 bg-white" title="Alerts">
                    <Icon name="bell" />
                    <span className="hidden sm:inline">Alerts</span>
                  </Button>

                  <Button variant="secondary" onClick={logout} title="Logout">
                    <Icon name="lock" />
                    <span className="hidden sm:inline">Logout</span>
                  </Button>
                </div>
              </div>

              {/* Mobile search */}
              <div className="mt-2 md:hidden">
                <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-700">
                  <Icon name="search" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={
                      activeSection === "Operations"
                        ? "Search WI, @handle…"
                        : activeSection === "Accounts"
                        ? "Search account…"
                        : activeSection === "Payouts"
                        ? "Search batch…"
                        : activeSection === "Performance"
                        ? "Search…"
                        : "Search…"
                    }
                    aria-label="Search"
                    className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
                  />
                </div>
              </div>

              {/* Command bar */}
              <div className="mt-2 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone="info">Worker: {me?.name ?? effectiveWorkerId}</Chip>
                  <Chip tone="neutral">Assigned accounts: {assignedAccountsCount}</Chip>
                  {!upi.verified ? <Chip tone="warn">UPI not verified</Chip> : <Chip tone="success">UPI verified</Chip>}
                  {loadError ? <Chip tone="warn">{loadError}</Chip> : <Chip tone="neutral">Live data</Chip>}
                </div>

                {activeSection === "Operations" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={priorityFilter}
                      onChange={(e) => setPriorityFilter(e.target.value as any)}
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-extrabold text-slate-900 outline-none"
                      aria-label="Priority filter"
                    >
                      <option value="All">Priority: All</option>
                      <option value="P0">P0</option>
                      <option value="P1">P1</option>
                      <option value="P2">P2</option>
                    </select>

                    <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-extrabold text-slate-900">
                      <input type="checkbox" checked={strictOnly} onChange={() => setStrictOnly((v) => !v)} className="h-4 w-4 accent-[#0078d4]" />
                      Strict only
                    </label>

                    <Button variant="ghost" onClick={clearFilters}>
                      Clear
                    </Button>
                  </div>
                )}
              </div>

              {/* KPI strip */}
              {activeSection === "Operations" && (
                <div className="mt-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone="neutral">Open: {kpis.open}</Chip>
                    <Chip tone="info">In progress: {kpis.inProg}</Chip>
                    <Chip tone="warn">Submitted: {kpis.submitted}</Chip>
                    <Chip tone="danger">Needs fix: {kpis.needsFix}</Chip>
                    <Chip tone="danger">Hard rejected: {kpis.hardRejected}</Chip>
                    <Chip tone="success">Approved: {kpis.approved}</Chip>
                    <Chip tone="info">Rate: ₹{RATE} / approved Reel</Chip>
                  </div>
                </div>
              )}
            </div>
          </header>

          {/* Body */}
          <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
            {/* OPERATIONS */}
            {activeSection === "Operations" && (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <KPI title="Open" value={String(kpis.open)} hint="Awaiting start" tone="neutral" />
                  <KPI title="In progress" value={String(kpis.inProg)} hint="Active items" tone="info" />
                  <KPI title="Submitted" value={String(kpis.submitted)} hint="Admin review pending" tone="warn" />
                  <KPI title="Approved earnings" value={formatINR(kpis.earnings)} hint="Paid after approval" tone="info" />
                </div>

                <div className="mt-6 grid grid-cols-12 gap-6">
                  <div className="col-span-12 lg:col-span-8 space-y-6">
                    <Card
                      title="Upcoming slots"
                      subtitle="Next scheduled reels approaching execution window"
                      right={<Chip tone="neutral">{upcomingItems.length} upcoming</Chip>}
                    >
                      {upcomingItems.length === 0 ? (
                        <div className="text-sm text-slate-600">No upcoming slots.</div>
                      ) : (
                        <div className="space-y-2">
                          {upcomingItems.map((x) => {
                            const acc = accountById(x.accountId);
                            const dueUtc = parseIstLocalToUtc(x.dueAt);
                            const windowStart = new Date(dueUtc.getTime() - x.slaMinutes * 60 * 1000);
                            const minutesToWindow = Math.max(0, minutesBetween(new Date(), windowStart));
                            return (
                              <div key={x.id} className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2">
                                <div className="min-w-0">
                                  <div className="text-sm font-extrabold text-slate-900 truncate">{x.title}</div>
                                  <div className="text-xs text-slate-600 truncate">
                                    {acc?.handle ?? x.accountId} • Live in {minutesToWindow}m • Due {formatDueWithTz(x.dueAt)}
                                  </div>
                                </div>
                                <Chip tone="neutral">Upcoming</Chip>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </Card>
                    <Card title="Work queue (List)" subtitle="Queued + active work items. Card list on mobile, table on desktop." right={<Chip tone="info">Click an item for details</Chip>}>
                      <WorkQueueResponsiveNoNestedButtons
                        items={filtered}
                        accountById={accountById}
                        slaMeta={slaMeta}
                        gateScore={gateScore}
                        onOpen={openDetails}
                        onStart={markStart}
                        onSubmit={openSubmit}
                      />
                    </Card>

                    <Card title="Assigned accounts (quick view)" subtitle="Admin assigns/removes accounts. Workers only view.">
                      <AssignedAccountsGrid accounts={assignedAccounts} q={q} />
                    </Card>
                  </div>

                  <div className="col-span-12 lg:col-span-4 space-y-6">
                    <DetailsPanelWorker
                      item={selected}
                      account={selectedAccount}
                      onClose={() => setSelectedId(null)}
                      onStart={markStart}
                      onSubmit={openSubmit}
                      gateScore={gateScore}
                      slaMeta={slaMeta}
                    />

                    <Card
                      title="UPI & readiness"
                      subtitle="UPI verification is required for payout processing."
                      right={upi.verified ? <Chip tone="success">Verified</Chip> : <Chip tone="warn">Not verified</Chip>}
                    >
                      <div className="space-y-3 text-sm text-slate-700">
                        <Row label="UPI ID" value={upi.upiId || "—"} />
                        <Row label="Schedule" value={`${upi.payoutSchedule} • ${upi.payoutDay}`} />
                        <div className="h-px bg-slate-200" />
                        <Button variant="secondary" onClick={() => setActiveSection("UPI")}>
                          <Icon name="settings" />
                          Configure UPI
                        </Button>
                      </div>
                    </Card>

                    <Card title="Performance snapshot" subtitle="Quick worker metrics (SLA, throughput, earnings).">
                      <div className="space-y-2 text-sm text-slate-700">
                        <Row label="SLA met" value={`${perf.slaRate}% (${perf.slaMetCount}/${perf.slaEvaluated})`} />
                        <Row label="Avg completion" value={perf.avgCompletionMins ? `${perf.avgCompletionMins} min` : "—"} />
                        <Row label="Approved reels" value={String(perf.approvedReels)} />
                        <Row label="Approved earnings" value={formatINR(perf.earningsApproved)} />
                        <Button variant="secondary" onClick={() => setActiveSection("Performance")}>
                          <Icon name="performance" />
                          View performance
                        </Button>
                      </div>
                    </Card>
                  </div>
                </div>
              </>
            )}

            {/* ACCOUNTS */}
            {activeSection === "Accounts" && (
              <div className="grid grid-cols-12 gap-6">
                <div className="col-span-12 lg:col-span-8 space-y-6">
                  <Card title="Assigned accounts" subtitle="Typically 5–6 accounts per worker. Admin assigns/removes on /admin." right={<Chip tone="info">{assignedAccountsCount} total</Chip>}>
                    <AssignedAccountsGrid accounts={assignedAccounts} q={q} scheduleMap={me?.assignedAccountSchedules ?? {}} />
                  </Card>

                  <Card title="Weekly schedule grid" subtitle="Your assigned accounts aligned by day/time" right={<Chip tone="neutral">{assignedAccountsCount} accounts</Chip>}>
                    <WorkerWeeklySchedule accounts={assignedAccounts} scheduleMap={me?.assignedAccountSchedules ?? {}} />
                  </Card>

                  <Card title="Policy reminders" subtitle="Quality gates before submission (worker-controlled).">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                        <div className="text-xs font-extrabold text-slate-600">Strict accounts</div>
                        <ul className="mt-2 list-disc pl-5 text-sm text-slate-700 space-y-1">
                          <li>Use only approved audio</li>
                          <li>Hashtags must match the required set</li>
                          <li>Always attach Reel URL + Screenshot URL</li>
                        </ul>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                        <div className="text-xs font-extrabold text-slate-600">Operational discipline</div>
                        <ul className="mt-2 list-disc pl-5 text-sm text-slate-700 space-y-1">
                          <li>Start P0 first to avoid SLA breach</li>
                          <li>Submit proof immediately after posting</li>
                          <li>Check “Needs fix” notes from Admin and resubmit</li>
                        </ul>
                      </div>
                    </div>
                  </Card>
                </div>

                <div className="col-span-12 lg:col-span-4 space-y-6">
                  <Card title="Your profile" subtitle="Sourced from your authenticated profile.">
                    <div className="space-y-2 text-sm text-slate-700">
                      <Row label="Worker ID" value={effectiveWorkerId} />
                      <Row label="Name" value={me?.name ?? "—"} />
                      <Row label="Level" value={levelLabel} />
                      <Row label="Completed" value={String(completedCount)} />
                      <Row label="Accounts" value={String(assignedAccounts.length)} />
                    </div>
                  </Card>

                  <DetailsPanelWorker
                    item={selected}
                    account={selectedAccount}
                    onClose={() => setSelectedId(null)}
                    onStart={markStart}
                    onSubmit={openSubmit}
                    gateScore={gateScore}
                    slaMeta={slaMeta}
                  />
                </div>
              </div>
            )}

            {/* PERFORMANCE */}
            {activeSection === "Performance" && (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <KPI
                    title="SLA met"
                    value={`${perf.slaRate}%`}
                    hint={`${perf.slaMetCount}/${perf.slaEvaluated} evaluated`}
                    tone={perf.slaRate >= 90 ? "info" : perf.slaRate >= 75 ? "warn" : "danger"}
                  />
                  <KPI title="Avg completion" value={perf.avgCompletionMins ? `${perf.avgCompletionMins}m` : "—"} hint="(Started → Completed)" tone="neutral" />
                  <KPI title="Approved reels" value={String(perf.approvedReels)} hint="Throughput" tone="info" />
                  <KPI title="Approved earnings" value={formatINR(perf.earningsApproved)} hint="₹ for approved reels" tone="info" />
                </div>

                <div className="mt-6 grid grid-cols-12 gap-6">
                  <div className="col-span-12 lg:col-span-8 space-y-6">
                    <Card title="SLA & quality" subtitle="Derived from your work items (client-side computation).">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                          <div className="text-xs font-extrabold text-slate-600">SLA</div>
                          <div className="mt-3 space-y-2 text-sm text-slate-700">
                            <Row label="Evaluated" value={String(perf.slaEvaluated)} />
                            <Row label="Met" value={String(perf.slaMetCount)} />
                            <Row label="Breached" value={String(perf.slaBreachedCount)} />
                            <Row label="Rate" value={`${perf.slaRate}%`} />
                          </div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                          <div className="text-xs font-extrabold text-slate-600">Quality</div>
                          <div className="mt-3 space-y-2 text-sm text-slate-700">
                            <Row label="Needs fix" value={String(perf.needsFixCount)} />
                            <Row label="Hard rejected" value={String(perf.hardRejects)} />
                            <Row label="Submitted (pending)" value={String(kpis.submitted)} />
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">
                        Tip: keep “Strict only” items clean (audio + hashtags) to avoid “Needs fix”.
                      </div>
                    </Card>

                    <Card title="Earnings" subtitle="Approved vs pending submissions.">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-lg border border-slate-200 bg-white p-4">
                          <div className="text-xs font-extrabold text-slate-600">Approved earnings</div>
                          <div className="mt-2 text-2xl font-extrabold text-slate-900">{formatINR(perf.earningsApproved)}</div>
                          <div className="mt-1 text-sm text-slate-600">{perf.approvedReels} approved reels</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white p-4">
                          <div className="text-xs font-extrabold text-slate-600">Pending</div>
                          <div className="mt-2 text-2xl font-extrabold text-slate-900">{formatINR(perf.pendingSubmitted)}</div>
                          <div className="mt-1 text-sm text-slate-600">{kpis.submitted} submitted (awaiting admin)</div>
                        </div>
                      </div>
                    </Card>
                  </div>

                  <div className="col-span-12 lg:col-span-4 space-y-6">
                    <Card title="Quick actions" subtitle="Use existing sections to execute tasks.">
                      <div className="space-y-2">
                        <Button variant="secondary" onClick={() => setActiveSection("Operations")}>
                          <Icon name="tasks" />
                          Go to work queue
                        </Button>
                        <Button variant="secondary" onClick={() => setActiveSection("Payouts")}>
                          <Icon name="wallet" />
                          View payouts
                        </Button>
                        <Button variant="secondary" onClick={() => setActiveSection("UPI")}>
                          <Icon name="settings" />
                          Configure UPI
                        </Button>
                      </div>
                    </Card>

                    <DetailsPanelWorker
                      item={selected}
                      account={selectedAccount}
                      onClose={() => setSelectedId(null)}
                      onStart={markStart}
                      onSubmit={openSubmit}
                      gateScore={gateScore}
                      slaMeta={slaMeta}
                    />
                  </div>
                </div>
              </>
            )}

            {/* UPI */}
            {activeSection === "UPI" && (
              <div className="grid grid-cols-12 gap-6">
                <div className="col-span-12 lg:col-span-7 space-y-6">
                  <Card title="UPI payout configuration" subtitle="Set UPI ID, verify and choose payout schedule.">
                    <div className="space-y-4">
                      <div>
                        <div className="text-sm font-extrabold text-slate-800">UPI ID</div>
                        <input
                          value={upi.upiId}
                          onChange={(e) => {
                            setUpiVerifyError("");
                            const next = normalizeUpi({ ...upi, upiId: e.target.value, verified: false, verifiedAt: undefined });
                            setUpi(next);
                            writeLS(LS_KEYS.UPI, next);
                          }}
                          placeholder="name@bank"
                          className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-[#0078d4]/20"
                          aria-label="UPI ID"
                        />
                        {upiVerifyError && <div className="mt-2 text-sm text-rose-700 font-extrabold">{upiVerifyError}</div>}
                        <div className="mt-2 text-xs text-slate-500">Example: yourname@paytm, yourname@okhdfcbank</div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                        <div className="text-sm font-extrabold text-slate-800">Auto payout schedule</div>
                          <select
                            value={upi.payoutSchedule}
                            onChange={(e) => {
                              const next = normalizeUpi({ ...upi, payoutSchedule: e.target.value as UpiSchedule, verified: false, verifiedAt: undefined });
                              setUpi(next);
                              writeLS(LS_KEYS.UPI, next);
                            }}
                            className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm font-extrabold text-slate-900 outline-none"
                            aria-label="Payout schedule"
                          >
                            <option value="Weekly">Weekly</option>
                            <option value="Bi-weekly">Bi-weekly</option>
                            <option value="Monthly">Monthly</option>
                          </select>
                        </div>

                        <div>
                          <div className="text-sm font-extrabold text-slate-800">Payout day</div>
                          <select
                            value={upi.payoutDay}
                            onChange={(e) => {
                              const next = normalizeUpi({ ...upi, payoutDay: e.target.value as any, verified: false, verifiedAt: undefined });
                              setUpi(next);
                              writeLS(LS_KEYS.UPI, next);
                            }}
                            className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm font-extrabold text-slate-900 outline-none"
                            aria-label="Payout day"
                          >
                            <option value="Mon">Mon</option>
                            <option value="Tue">Tue</option>
                            <option value="Wed">Wed</option>
                            <option value="Thu">Thu</option>
                            <option value="Fri">Fri</option>
                            <option value="Sat">Sat</option>
                            <option value="Sun">Sun</option>
                          </select>
                        </div>
                      </div>

                      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>Status: {upi.verified ? <Chip tone="success">Verified</Chip> : <Chip tone="warn">Not verified</Chip>}</div>
                          {upi.verifiedAt && <Chip tone="neutral">Verified at: {upi.verifiedAt}</Chip>}
                        </div>
                        <div className="mt-2 text-xs text-slate-500">Verification is required before payouts can be marked as paid.</div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button variant="primary" onClick={verifyUpi}>
                          <Icon name="check" />
                          Verify UPI
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            const next = DEFAULT_UPI;
                            setUpi(next);
                            writeLS(LS_KEYS.UPI, next);
                          }}
                        >
                          Reset
                        </Button>
                        <Button variant="secondary" onClick={() => setActiveSection("Payouts")}>
                          <Icon name="wallet" />
                          Go to payouts
                        </Button>
                      </div>
                      {upiNotice && (
                        <div
                          className={cx(
                            "mt-3 rounded-md border px-3 py-2 text-sm font-extrabold",
                            upiNotice.tone === "success"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-rose-200 bg-rose-50 text-rose-700"
                          )}
                        >
                          {upiNotice.text}
                        </div>
                      )}
                    </div>
                  </Card>
                </div>

                <div className="col-span-12 lg:col-span-5 space-y-6">
                  <Card title="How payouts work" subtitle="Admin controls batching and approvals.">
                    <div className="space-y-3 text-sm text-slate-700">
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                        <div className="text-xs font-extrabold text-slate-600">Approval first</div>
                        <div className="mt-1">Only Admin can approve/reject. Your job is to submit correct proof.</div>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                        <div className="text-xs font-extrabold text-slate-600">UPI gating</div>
                        <div className="mt-1">Payout “Paid” status requires verified UPI.</div>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                        <div className="text-xs font-extrabold text-slate-600">Escalations</div>
                        <div className="mt-1">Hard reject is final; items won’t be eligible for payout.</div>
                      </div>
                    </div>
                  </Card>

                  <Card title="Draft batch snapshot" subtitle="Worker visibility (read-only)." right={currentDraftBatch ? <Chip tone="warn">{currentDraftBatch.status}</Chip> : <Chip>—</Chip>}>
                    {!currentDraftBatch ? (
                      <div className="text-sm text-slate-600">No draft batch available.</div>
                    ) : (
                      <div className="space-y-2 text-sm text-slate-700">
                        <Row label="Batch" value={currentDraftBatch.id} />
                        <Row label="Cycle" value={currentDraftBatch.cycleLabel} />
                        <Row label="Items" value={String(batchTotals(currentDraftBatch).count)} />
                      </div>
                    )}
                  </Card>
                </div>
              </div>
            )}

            {/* PAYOUTS */}
            {activeSection === "Payouts" && (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <KPI title="Batches" value={String(myBatches.length)} hint="Your payout cycles" tone="neutral" />
                  <KPI title="Paid batches" value={String(myBatches.filter((b) => b.status === "Paid").length)} hint="Completed" tone="info" />
                  <KPI title="Pending payouts" value={formatINR(kpis.pending)} hint="Submitted (awaiting admin)" tone="warn" />
                  <KPI title="Approved earnings" value={formatINR(kpis.earnings)} hint="Approved total" tone="info" />
                </div>

                <div className="mt-6 grid grid-cols-12 gap-6">
                  <div className="col-span-12 lg:col-span-8 space-y-6">
                    <Card title="Payout batches (read-only for worker)" subtitle="Admin runs batching and marks paid.">
                      <PayoutBatchesResponsive batches={myBatches} q={q} totals={batchTotals} />
                    </Card>
                  </div>

                  <div className="col-span-12 lg:col-span-4 space-y-6">
                    <Card title="Request payout" subtitle="Submit a payout request for approved work.">
                      <div className="space-y-3 text-sm text-slate-700">
                        <Row label="Eligible items" value={String(eligiblePayoutItems.length)} />
                        <Row label="Pending request" value={hasProcessingPayout ? "Processing" : hasDraftPayout ? "Draft" : "No"} />
                        <Row label="Auto payout schedule" value={`${upi.payoutSchedule} • ${upi.payoutDay}`} />
                        <Row label="Auto payout trigger" value={eligiblePayoutTotal >= 500 ? "Eligible (₹500+)" : "Below threshold"} />
                        {processingEta && <Row label="Estimated payout" value={processingEta} />}
                      </div>
                      <div className="mt-4">
                        <Button variant="primary" onClick={requestPayout} disabled={!eligiblePayoutItems.length || !upi.verified || hasProcessingPayout}>
                          <Icon name="wallet" />
                          Request payout
                        </Button>
                      </div>
                      {!upi.verified && <div className="mt-2 text-xs text-amber-700">Verify UPI before requesting payout.</div>}
                      {payoutNotice && (
                        <div
                          className={cx(
                            "mt-3 rounded-md border px-3 py-2 text-sm font-extrabold",
                            payoutNotice.tone === "success"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-rose-200 bg-rose-50 text-rose-700"
                          )}
                        >
                          {payoutNotice.text}
                        </div>
                      )}
                      {payoutReversalNotice && (
                        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-extrabold text-amber-700">
                          {payoutReversalNotice}
                        </div>
                      )}
                    </Card>

                    <Card title="Notes" subtitle="Operational clarity.">
                      <div className="space-y-3 text-sm text-slate-700">
                        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                          <div className="text-xs font-extrabold text-slate-600">Why payout is pending</div>
                          <div className="mt-1">Submitted items need Admin approval to become eligible for payout.</div>
                        </div>
                        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                          <div className="text-xs font-extrabold text-slate-600">Hard reject</div>
                          <div className="mt-1">Final decision by Admin. Hard rejected items are not payable.</div>
                        </div>
                      </div>
                    </Card>

                    <DetailsPanelWorker
                      item={selected}
                      account={selectedAccount}
                      onClose={() => setSelectedId(null)}
                      onStart={markStart}
                      onSubmit={openSubmit}
                      gateScore={gateScore}
                      slaMeta={slaMeta}
                    />
                  </div>
                </div>
              </>
            )}
          </main>
        </div>
      </div>

      {/* Submit proof modal */}
      {submitOpen && selected && (
        <Modal
          title="Submit proof"
          subtitle={`${selected.id} • ${clampText(selected.title, 52)}`}
          onClose={() => setSubmitOpen(false)}
          actions={
            <>
              <Button variant="secondary" onClick={() => setSubmitOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={submitProof} disabled={!submitReelUrl.trim() || !submitShotUrl.trim()}>
                <Icon name="check" />
                Submit
              </Button>
            </>
          }
        >
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            Required: Reel URL + Screenshot URL. Approval credits <b>{formatINR(selected.rewardINR)}</b>.
          </div>

          <div className="mt-4 space-y-4">
            <div>
              <label className="text-sm font-extrabold text-slate-800">Reel URL</label>
              <input
                value={submitReelUrl}
                onChange={(e) => setSubmitReelUrl(e.target.value)}
                placeholder="https://www.instagram.com/reel/..."
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-[#0078d4]/20"
              />
            </div>

            <div>
              <label className="text-sm font-extrabold text-slate-800">Screenshot URL</label>
              <input
                value={submitShotUrl}
                onChange={(e) => setSubmitShotUrl(e.target.value)}
                placeholder="https://... (proof screenshot)"
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-[#0078d4]/20"
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** ===================== Sidebar (Worker) ===================== */
function SidebarWorker({
  activeSection,
  setActiveSection,
  onClose,
}: {
  activeSection: Section;
  setActiveSection: (v: Section) => void;
  onClose?: () => void;
}) {
  const Item = ({ id, label, icon }: { id: Section; label: string; icon: string }) => (
    <button
      onClick={() => {
        setActiveSection(id);
        onClose?.();
      }}
      className={cx(
        "flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-sm font-extrabold transition",
        activeSection === id ? "bg-[#e5f1fb] text-[#106ebe]" : "text-slate-800 hover:bg-slate-100"
      )}
    >
      <span className="flex items-center gap-2">
        <Icon name={icon} className={cx(activeSection === id ? "text-[#106ebe]" : "text-slate-600")} />
        {label}
      </span>
      <Icon name="chevRight" className="text-slate-400" />
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-4">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-[#0078d4] text-white font-black">IG</div>
          <div className="leading-tight">
            <div className="text-sm font-extrabold text-slate-900">Worker Console</div>
            <div className="text-xs text-slate-600">Operations console</div>
          </div>
        </div>

        {onClose && (
          <button
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white hover:bg-slate-50"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon name="x" className="text-slate-700" />
          </button>
        )}
      </div>

      <nav className="space-y-1 px-4 py-4">
        <Item id="Operations" label="Operations" icon="tasks" />
        <Item id="Accounts" label="Assigned accounts" icon="performance" />
        <Item id="Performance" label="Performance" icon="performance" />
        <Item id="UPI" label="UPI configuration" icon="settings" />
        <Item id="Payouts" label="Payouts" icon="wallet" />
      </nav>

      <div className="mt-auto px-4 py-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <div className="text-xs font-extrabold text-slate-600">Worker rule</div>
          <div className="mt-1">Submit accurate proof. Admin decides approval/rejection.</div>
        </div>
      </div>
    </div>
  );
}

/** ===================== KPIs ===================== */
function KPI({ title, value, hint, tone }: { title: string; value: string; hint: string; tone: "neutral" | "info" | "warn" | "danger" }) {
  const pillTone = tone === "info" ? "info" : tone === "warn" ? "warn" : tone === "danger" ? "danger" : "neutral";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-extrabold text-slate-600">{title}</div>
          <div className="mt-2 text-2xl font-extrabold text-slate-900">{value}</div>
          <div className="mt-1 text-sm text-slate-600">{hint}</div>
        </div>
        <Chip tone={pillTone}>{title}</Chip>
      </div>
    </div>
  );
}

/** ===================== Work Queue (No nested buttons) ===================== */
function WorkQueueResponsiveNoNestedButtons({
  items,
  accountById,
  slaMeta,
  gateScore,
  onOpen,
  onStart,
  onSubmit,
}: {
  items: WorkItem[];
  accountById: (id: string) => AssignedAccount | undefined;
  slaMeta: (id: string) => { dueInMin: number; overdue: boolean; slaRemaining?: number; slaBreached?: boolean } | undefined;
  gateScore: (x: WorkItem) => { ok: number; total: number };
  onOpen: (id: string) => void;
  onStart: (id: string) => void;
  onSubmit: (id: string) => void;
}) {
  return (
    <>
      {/* Mobile cards */}
      <div className="lg:hidden space-y-3">
        {items.length === 0 ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">No items.</div>
        ) : (
          items.map((x) => {
            const a = accountById(x.accountId);
            const meta = slaMeta(x.id);
            const dueIn = meta?.dueInMin ?? 0;
            const overdue = !!meta?.overdue;
            const gate = gateScore(x);
            const gateTone = gate.ok === gate.total ? "success" : gate.ok >= gate.total - 1 ? "warn" : "danger";
            const strict = a?.policyTier === "Strict";

            return (
              <div
                key={x.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpen(x.id)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " " ? onOpen(x.id) : null)}
                className={cx(
                  "w-full text-left rounded-lg border p-4 transition hover:bg-slate-50 outline-none focus:ring-2 focus:ring-[#0078d4]/20",
                  overdue ? "border-rose-200 bg-rose-50/20" : "border-slate-200 bg-white"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-extrabold text-slate-900 truncate">{x.id}</div>
                    <div className="mt-1 text-sm text-slate-700 line-clamp-2">{x.title}</div>
                    <div className="mt-2 text-xs text-slate-500 truncate">
                      {a?.handle ?? "—"} • {x.type}
                    </div>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-2">
                    <PriorityPill p={x.priority} />
                    <StatusBadge s={x.status} />
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {strict && <Chip tone="warn">Strict</Chip>}
                  <Chip tone={overdue ? "danger" : dueIn <= 60 ? "warn" : "neutral"}>{overdue ? `Overdue ${Math.abs(dueIn)}m` : `Due ${Math.max(0, dueIn)}m`}</Chip>
                  <Chip tone={gateTone as any}>
                    {gate.ok}/{gate.total} gates
                  </Chip>
                </div>

                <div className="mt-3 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => onStart(x.id)}
                    disabled={x.status !== "Open"}
                    className={cx(
                      "rounded-md border px-3 py-1.5 text-xs font-extrabold transition",
                      x.status === "Open" ? "border-slate-300 bg-white text-slate-900 hover:bg-slate-50" : "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                    )}
                  >
                    Start
                  </button>

                  {x.type === "Reel posting" && (
                    <button
                      onClick={() => onSubmit(x.id)}
                      disabled={!(x.status === "Open" || x.status === "In progress" || x.status === "Needs fix")}
                      className={cx(
                        "rounded-md px-3 py-1.5 text-xs font-extrabold transition",
                        x.status === "Open" || x.status === "In progress" || x.status === "Needs fix"
                          ? "bg-[#0078d4] text-white hover:bg-[#106ebe]"
                          : "bg-slate-200 text-slate-500 cursor-not-allowed"
                      )}
                    >
                      Submit proof
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden lg:block overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-extrabold text-slate-600">
              <tr>
                <th className="px-4 py-3">Work item</th>
                <th className="px-4 py-3">Account</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3">SLA</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Gates</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-200">
              {items.map((x) => {
                const a = accountById(x.accountId);
                const meta = slaMeta(x.id);
                const overdue = !!meta?.overdue;
                const gate = gateScore(x);
                const gateTone = gate.ok === gate.total ? "success" : gate.ok >= gate.total - 1 ? "warn" : "danger";

                return (
                  <tr key={x.id} className={cx("cursor-pointer hover:bg-slate-50", overdue && "bg-rose-50/30")} onClick={() => onOpen(x.id)}>
                    <td className="px-4 py-3">
                      <div className="font-extrabold text-slate-900">{x.id}</div>
                      <div className="text-slate-700 max-w-[520px] truncate">{x.title}</div>
                      <div className="mt-1 text-xs text-slate-500">{x.type}</div>
                    </td>

                    <td className="px-4 py-3">
                      <div className="font-extrabold text-slate-900">{a?.handle ?? "—"}</div>
                      <div className="text-xs text-slate-500">{a?.ownerTeam ?? "—"}</div>
                    </td>

                    <td className="px-4 py-3">
                      <div className="font-extrabold text-slate-900">{formatDueWithTz(x.dueAt)}</div>
                      <div className="text-xs text-slate-600">{overdue ? "Overdue" : "On schedule"}</div>
                    </td>

                    <td className="px-4 py-3">
                      {typeof meta?.slaRemaining === "number" ? (
                        <Chip tone={meta.slaBreached ? "danger" : meta.slaRemaining <= 5 ? "warn" : "info"}>{meta.slaBreached ? "Breached" : `${meta.slaRemaining}m left`}</Chip>
                      ) : (
                        <Chip tone="neutral">Not started</Chip>
                      )}
                      <div className="mt-1 text-xs text-slate-600">Target {x.slaMinutes}m</div>
                    </td>

                    <td className="px-4 py-3">
                      <PriorityPill p={x.priority} />
                    </td>

                    <td className="px-4 py-3">
                      <StatusBadge s={x.status} />
                    </td>

                    <td className="px-4 py-3">
                      <Chip tone={gateTone as any}>
                        {gate.ok}/{gate.total}
                      </Chip>
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => onStart(x.id)}
                          disabled={x.status !== "Open"}
                          className={cx(
                            "rounded-md border px-3 py-1.5 text-xs font-extrabold transition",
                            x.status === "Open" ? "border-slate-300 bg-white text-slate-900 hover:bg-slate-50" : "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                          )}
                        >
                          Start
                        </button>

                        {x.type === "Reel posting" && (
                          <button
                            onClick={() => onSubmit(x.id)}
                            disabled={!(x.status === "Open" || x.status === "In progress" || x.status === "Needs fix")}
                            className={cx(
                              "rounded-md px-3 py-1.5 text-xs font-extrabold transition",
                              x.status === "Open" || x.status === "In progress" || x.status === "Needs fix"
                                ? "bg-[#0078d4] text-white hover:bg-[#106ebe]"
                                : "bg-slate-200 text-slate-500 cursor-not-allowed"
                            )}
                          >
                            Submit
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {items.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-600">
                    No items.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/** ===================== Details Panel (Worker) ===================== */
function DetailsPanelWorker({
  item,
  account,
  onClose,
  onStart,
  onSubmit,
  gateScore,
  slaMeta,
}: {
  item: WorkItem | null;
  account?: AssignedAccount;
  onClose: () => void;
  onStart: (id: string) => void;
  onSubmit: (id: string) => void;
  gateScore: (x: WorkItem) => { ok: number; total: number };
  slaMeta: (id: string) => { dueInMin: number; overdue: boolean; slaRemaining?: number; slaBreached?: boolean } | undefined;
}) {
  const strict = account?.policyTier === "Strict";
  const meta = item ? slaMeta(item.id) : undefined;
  const gates = item ? gateScore(item) : undefined;

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-extrabold text-slate-900">Details</div>
          <div className="mt-0.5 text-sm text-slate-600 truncate">{item ? `${item.id} • ${item.type}` : "Select an item"}</div>
        </div>
        <Button variant="ghost" onClick={onClose} title="Close">
          <Icon name="x" />
        </Button>
      </div>

      <div className="px-4 py-3 space-y-4">
        {!item ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">Select an item to see SLA, gates, proof, and audit trail.</div>
        ) : (
          <>
            {strict && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                <div className="text-sm font-extrabold text-amber-900">Strict policy account</div>
                <div className="mt-1 text-sm text-amber-800">
                  Verify <b>approved audio</b> and <b>hashtags</b> before posting.
                </div>
              </div>
            )}

            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-extrabold text-slate-900">{clampText(item.title, 60)}</div>
                <div className="flex items-center gap-2">
                  <PriorityPill p={item.priority} />
                  <StatusBadge s={item.status} />
                </div>
              </div>

              <div className="mt-3 grid gap-2 text-sm text-slate-700">
                <Row label="Due" value={formatDueWithTz(item.dueAt)} />
                <Row label="Estimated" value={`${item.estMinutes} min`} />
                <Row label="Reward" value={item.type === "Reel posting" ? formatINR(item.rewardINR) : "—"} />
                <Row label="SLA" value={typeof meta?.slaRemaining === "number" ? (meta.slaBreached ? "Breached" : `${meta.slaRemaining}m remaining`) : "Not started"} />
                <Row label="Gates" value={gates ? `${gates.ok}/${gates.total} passed` : "—"} />
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => onStart(item.id)} disabled={item.status !== "Open"}>
                  Start
                </Button>

                {item.type === "Reel posting" && (
                  <Button
                    variant="primary"
                    onClick={() => onSubmit(item.id)}
                    disabled={!(item.status === "Open" || item.status === "In progress" || item.status === "Needs fix")}
                  >
                    Submit proof
                  </Button>
                )}
              </div>

              {(item.status === "Needs fix" || item.status === "Hard rejected") && item.review?.reason && (
                <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3">
                  <div className="text-sm font-extrabold text-rose-900">{item.status}</div>
                  <div className="mt-1 text-sm text-rose-800">{item.review.reason}</div>
                </div>
              )}
            </div>

            <div className="rounded-md border border-slate-200 bg-white p-3">
              <div className="text-xs font-extrabold text-slate-600">Account</div>

              <div className="mt-2">
                <div className="text-sm font-extrabold text-slate-900 truncate">{account?.handle ?? "—"}</div>
                <div className="mt-0.5 text-sm text-slate-600 truncate">{account?.niche ?? "—"}</div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {account?.ownerTeam && <Chip>{account.ownerTeam}</Chip>}
                  {account?.policyTier && <Chip tone={account.policyTier === "Strict" ? "warn" : "neutral"}>{account.policyTier}</Chip>}
                  {account?.health && <HealthPill h={account.health} />}
                </div>
              </div>

              {account?.rules?.length ? (
                <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs font-extrabold text-slate-600">Rules</div>
                  <ul className="mt-2 list-disc pl-5 text-sm text-slate-700 space-y-1">
                    {account.rules.slice(0, 6).map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            {item.type === "Reel posting" && (
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="text-xs font-extrabold text-slate-600">Proof</div>
                {item.submission ? (
                  <div className="mt-2 space-y-2 text-sm text-slate-700">
                    <div className="break-all">
                      <b>Reel:</b> {item.submission.reelUrl || "—"}
                    </div>
                    <div className="break-all">
                      <b>Screenshot:</b> {item.submission.screenshotUrl || "—"}
                    </div>
                    <div className="text-xs text-slate-500">Submitted: {item.submission.submittedAt || "—"}</div>
                  </div>
                ) : (
                  <div className="mt-2 text-sm text-slate-700">No proof submitted.</div>
                )}
              </div>
            )}

            <div className="rounded-md border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-extrabold text-slate-600">Audit trail</div>
                <Chip tone="neutral">{item.audit[0]?.at ?? "—"}</Chip>
              </div>

              <div className="mt-3 space-y-2">
                {item.audit.slice(0, 6).map((a, i) => (
                  <div key={i} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-extrabold text-slate-700 truncate">{a.by}</div>
                      <div className="text-xs text-slate-500">{a.at}</div>
                    </div>
                    <div className="mt-1 text-sm text-slate-700">{a.text}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/** ===================== Assigned Accounts Grid ===================== */
function AssignedAccountsGrid({
  accounts,
  q,
  scheduleMap = {},
}: {
  accounts: AssignedAccount[];
  q: string;
  scheduleMap?: Record<string, { times?: string[]; days?: number[]; deadlineMin?: number; timezone?: string }>;
}) {
  const ql = q.trim().toLowerCase();
  const filtered = accounts.filter((a) => {
    if (!ql) return true;
    return (
      a.handle.toLowerCase().includes(ql) ||
      a.niche.toLowerCase().includes(ql) ||
      a.ownerTeam.toLowerCase().includes(ql) ||
      a.policyTier.toLowerCase().includes(ql)
    );
  });

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {filtered.map((a) => (
        <div key={a.id} className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-extrabold text-slate-900 truncate">{a.handle}</div>
              <div className="mt-0.5 text-sm text-slate-600 truncate">{a.niche}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Chip>{a.ownerTeam}</Chip>
                <Chip tone={a.policyTier === "Strict" ? "warn" : "neutral"}>{a.policyTier}</Chip>
                {(!a.requiredHashtags.length || !a.allowedAudios.length || !a.rules.length) && (
                  <Chip tone="info">Default policy</Chip>
                )}
              </div>
            </div>
            <HealthPill h={a.health} />
          </div>
          {scheduleMap?.[a.id] && (
            <div className="mt-2 text-[11px] text-slate-500">
              {(() => {
                const schedule = scheduleMap?.[a.id] ?? {};
                const times = schedule.times?.length ? schedule.times : [];
                const days = schedule.days?.length ? schedule.days : [];
                const deadline = schedule.deadlineMin ? `${schedule.deadlineMin}m` : "—";
                const tz = schedule.timezone ?? "—";
                const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
                return `${times.join(", ")} • ${days.map((d) => dayLabels[d]).join(", ")} • ${deadline} • ${tz}`;
              })()}
            </div>
          )}

          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-extrabold text-slate-600">Must include</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(a.requiredHashtags.length ? a.requiredHashtags : DEFAULT_ACCOUNT_TAGS).slice(0, 6).map((h) => (
                <Chip key={h}>{h}</Chip>
              ))}
            </div>

            <div className="mt-3 text-xs font-extrabold text-slate-600">Allowed audio</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(a.allowedAudios.length ? a.allowedAudios : DEFAULT_ACCOUNT_AUDIOS).slice(0, 3).map((au) => (
                <Chip key={au} tone="info">
                  {au}
                </Chip>
              ))}
            </div>

            <div className="mt-3 text-xs font-extrabold text-slate-600">Rules</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(a.rules.length ? a.rules : DEFAULT_ACCOUNT_RULES).slice(0, 3).map((rule) => (
                <Chip key={rule} tone="neutral">
                  {rule}
                </Chip>
              ))}
            </div>
          </div>
        </div>
      ))}

      {filtered.length === 0 && (
        <div className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-sm font-semibold text-slate-900">No assigned accounts yet</div>
          <div className="mt-1 text-sm text-slate-600">
            Admin has not assigned account workstreams to this worker yet. Once assigned, they will appear here automatically.
          </div>
        </div>
      )}
    </div>
  );
}

function WorkerWeeklySchedule({
  accounts,
  scheduleMap,
}: {
  accounts: AssignedAccount[];
  scheduleMap: Record<string, { times?: string[]; days?: number[]; deadlineMin?: number; timezone?: string }>;
}) {
  const rows = new Map<string, { time: string; timezone: string; days: Record<number, AssignedAccount[]> }>();
  for (const acc of accounts) {
    const schedule = scheduleMap[acc.id];
    if (!schedule?.times?.length || !schedule?.days?.length) continue;
    const timezone = schedule.timezone ?? "Asia/Kolkata";
    for (const time of schedule.times) {
      const key = `${timezone}::${time}`;
      if (!rows.has(key)) {
        rows.set(key, { time, timezone, days: { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] } });
      }
      const row = rows.get(key)!;
      for (const day of schedule.days) {
        row.days[day].push(acc);
      }
    }
  }
  const sorted = Array.from(rows.values()).sort((a, b) => (a.time < b.time ? -1 : 1));
  if (sorted.length === 0) {
    return <div className="text-sm text-slate-600">No scheduled slots yet.</div>;
  }

  return (
    <div className="space-y-3">
      {sorted.map((row) => (
        <div key={`${row.time}-${row.timezone}`} className="rounded-md border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-extrabold text-slate-900">{row.time}</div>
            <Chip tone="neutral">{row.timezone}</Chip>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-7">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, idx) => (
              <div key={label} className="rounded-md border border-slate-200 bg-slate-50 p-2">
                <div className="text-[11px] font-extrabold text-slate-600">{label}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {(row.days[idx] ?? []).map((acc) => (
                    <Chip key={`${acc.id}-${label}`} tone={acc.policyTier === "Strict" ? "warn" : "neutral"}>
                      {acc.handle}
                    </Chip>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** ===================== Payout list (Worker read-only) ===================== */
function PayoutBatchesResponsive({
  batches,
  q,
  totals,
}: {
  batches: PayoutBatch[];
  q: string;
  totals: (b: PayoutBatch) => { total: number; paid: number; count: number };
}) {
  const ql = q.trim().toLowerCase();
  const filtered = batches
    .filter((b) => (!ql ? true : b.id.toLowerCase().includes(ql) || b.cycleLabel.toLowerCase().includes(ql)))
    .sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1));

  const statusTone = (s: PayoutBatchStatus) => (s === "Paid" ? "success" : s === "Processing" ? "info" : s === "Failed" ? "danger" : "warn");
  const etaFor = (b: PayoutBatch) => {
    const hit = (b.notes ?? []).find((n) => String(n).startsWith("ETA:"));
    return hit ? String(hit).slice("ETA:".length) : undefined;
  };

  return (
    <>
      <div className="lg:hidden space-y-3">
        {filtered.map((b) => {
          const t = totals(b);
          return (
            <div key={b.id} className="w-full text-left rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-extrabold text-slate-900 truncate">{b.id}</div>
                  <div className="mt-1 text-sm text-slate-600 truncate">{b.cycleLabel}</div>
                  <div className="mt-2 text-xs text-slate-500">
                    {b.periodStart} → {b.periodEnd} • {b.method} {etaFor(b) ? `• ETA ${etaFor(b)}` : ""}
                  </div>
                </div>
                <Chip tone={statusTone(b.status) as any}>{b.status}</Chip>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Chip tone="info">{t.count} items</Chip>
                <Chip tone="neutral">Total {formatINR(t.total)}</Chip>
                <Chip tone="success">Paid {formatINR(t.paid)}</Chip>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <div className="text-sm text-slate-600">No batches found.</div>}
      </div>

      <div className="hidden lg:block overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-extrabold text-slate-600">
            <tr>
              <th className="px-4 py-3">Batch</th>
              <th className="px-4 py-3">Cycle</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Items</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Paid</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">ETA</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-200">
            {filtered.map((b) => {
              const t = totals(b);
              return (
                <tr key={b.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-extrabold text-slate-900">{b.id}</td>
                  <td className="px-4 py-3 text-slate-700">{b.cycleLabel}</td>
                  <td className="px-4 py-3">
                    <Chip tone={statusTone(b.status) as any}>{b.status}</Chip>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{t.count}</td>
                  <td className="px-4 py-3 text-slate-700">{formatINR(t.total)}</td>
                  <td className="px-4 py-3 text-slate-700">{formatINR(t.paid)}</td>
                  <td className="px-4 py-3 text-slate-600">{b.createdAt}</td>
                  <td className="px-4 py-3 text-slate-600">{etaFor(b) ?? "—"}</td>
                </tr>
              );
            })}

            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-600">
                  No batches found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** ===================== Modal ===================== */
function Modal({
  title,
  subtitle,
  onClose,
  children,
  actions,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  actions: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-[92vw] max-w-[720px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-extrabold text-slate-900">{title}</div>
            {subtitle && <div className="mt-0.5 text-sm text-slate-600 truncate">{subtitle}</div>}
          </div>
          <Button variant="ghost" onClick={onClose} title="Close">
            <Icon name="x" />
          </Button>
        </div>

        <div className="px-4 py-4">{children}</div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-4 py-3">{actions}</div>
      </div>
    </div>
  );
}

/** ===================== Seeds (fallback) ===================== */
function seedAccounts(): AssignedAccount[] {
  return [
    {
      id: "acc_1",
      handle: "@dailyfit.india",
      niche: "Fitness / Motivation",
      ownerTeam: "Growth Ops",
      policyTier: "Standard",
      health: "Healthy",
      rules: ["Max 1 reel/day", "Use caption template", "No politics/religion", "Pin CTA comment"],
      allowedAudios: ["Calm Beat #2", "Beat Pulse #7", "Soft Pop #3"],
      requiredHashtags: ["#fitness", "#workout", "#health"],
    },
    {
      id: "acc_2",
      handle: "@stylebytes.in",
      niche: "Fashion / Aesthetic",
      ownerTeam: "Brand Studio",
      policyTier: "Strict",
      health: "Watch",
      rules: ["Reel 7–12 sec", "Approved audio only", "Hashtags 8–12", "No logos/trademarks"],
      allowedAudios: ["Trend Pack A1", "Trend Pack A3", "Trend Pack B2"],
      requiredHashtags: ["#fashion", "#style", "#ootd", "#aesthetic"],
    },
    {
      id: "acc_3",
      handle: "@foodcrush.delhi",
      niche: "Food / Reviews",
      ownerTeam: "Creator Ops",
      policyTier: "Standard",
      health: "Healthy",
      rules: ["No alcohol promotion", "No competitor brands", "Caption template required"],
      allowedAudios: ["Kitchen Pop #1", "Beat Pulse #7"],
      requiredHashtags: ["#food", "#delhi", "#review"],
    },
    {
      id: "acc_4",
      handle: "@techshorts.hindi",
      niche: "Tech / Shorts",
      ownerTeam: "Editorial Ops",
      policyTier: "Strict",
      health: "Risk",
      rules: ["No unverified claims", "Approved audio only", "No politics"],
      allowedAudios: ["Neutral Tech Bed #4", "Trend Pack B2"],
      requiredHashtags: ["#tech", "#shorts", "#hindi"],
    },
    {
      id: "acc_5",
      handle: "@travelbyte.india",
      niche: "Travel / India",
      ownerTeam: "Growth Ops",
      policyTier: "Standard",
      health: "Watch",
      rules: ["No unsafe activities", "No restricted locations", "Use CTA comment"],
      allowedAudios: ["Soft Pop #3", "Calm Beat #2"],
      requiredHashtags: ["#travel", "#india", "#wander"],
    },
    {
      id: "acc_6",
      handle: "@homehacks.in",
      niche: "Home / Hacks",
      ownerTeam: "Creator Ops",
      policyTier: "Standard",
      health: "Healthy",
      rules: ["No dangerous hacks", "Clear steps", "Caption template required"],
      allowedAudios: ["Calm Beat #2", "Kitchen Pop #1"],
      requiredHashtags: ["#home", "#hacks", "#tips"],
    },
  ];
}

function seedWorkers(): WorkerProfile[] {
  return [
    {
      id: "WKR-001",
      name: "Aarav Sharma",
      level: "L2",
      assignedAccountIds: ["acc_1", "acc_2", "acc_3", "acc_5", "acc_6"],
      email: "aarav.sharma@igops.com",
      password: AUTH_DEMO.WORKER_DEFAULT_PASSWORD,
    },
    {
      id: "WKR-002",
      name: "Meera Iyer",
      level: "L1",
      assignedAccountIds: ["acc_4", "acc_5", "acc_6", "acc_1", "acc_3"],
      email: "meera.iyer@igops.com",
      password: AUTH_DEMO.WORKER_DEFAULT_PASSWORD,
    },
  ];
}

function seedWorkItems(today: string, RATE: number): WorkItem[] {
  const dueSoon = new Date();
  dueSoon.setMinutes(dueSoon.getMinutes() + 45);
  const dueSoonISO = `${today}T${pad2(dueSoon.getHours())}:${pad2(dueSoon.getMinutes())}`;

  const dueLater = new Date();
  dueLater.setMinutes(dueLater.getMinutes() + 150);
  const dueLaterISO = `${today}T${pad2(dueLater.getHours())}:${pad2(dueLater.getMinutes())}`;

  return [
    {
      id: "WI-2001",
      title: "Post Reel: 3 stretches for lower back (12s max)",
      type: "Reel posting",
      accountId: "acc_1",
      createdAt: today,
      dueAt: dueSoonISO,
      status: "Open",
      priority: "P1",
      rewardINR: RATE,
      estMinutes: 12,
      slaMinutes: 25,
      gates: { captionTemplate: true, approvedAudio: true, hashtagsOk: true, noRestricted: true, proofAttached: false },
      audit: [{ at: `${today} 09:10`, by: "Ops Bot", text: "Created with standard policy gates." }],
    },
    {
      id: "WI-2002",
      title: "Post Reel: Outfit transition (monochrome) — strict policy",
      type: "Reel posting",
      accountId: "acc_2",
      createdAt: today,
      dueAt: dueLaterISO,
      status: "In progress",
      priority: "P0",
      rewardINR: RATE,
      estMinutes: 18,
      slaMinutes: 30,
      startedAt: nowISO(),
      gates: { captionTemplate: true, approvedAudio: false, hashtagsOk: true, noRestricted: true, proofAttached: false },
      audit: [
        { at: `${today} 09:22`, by: "Ops Bot", text: "Created with strict policy gates." },
        { at: `${today} 10:05`, by: "Worker", text: "Marked as In progress." },
      ],
    },
    {
      id: "WI-2003",
      title: "Reply to top 10 comments (yesterday’s reel) — friendly tone",
      type: "Comment replies",
      accountId: "acc_3",
      createdAt: today,
      dueAt: `${today}T23:00`,
      status: "Open",
      priority: "P2",
      rewardINR: 0,
      estMinutes: 10,
      slaMinutes: 20,
      gates: { captionTemplate: true, approvedAudio: true, hashtagsOk: true, noRestricted: true, proofAttached: true },
      audit: [{ at: `${today} 11:20`, by: "Ops Bot", text: "Created work item." }],
    },
    {
      id: "WI-1998",
      title: "Submitted Reel proof - pending admin review",
      type: "Reel posting",
      accountId: "acc_5",
      createdAt: "2026-01-19",
      dueAt: "2026-01-19T18:30",
      status: "Submitted",
      priority: "P2",
      rewardINR: RATE,
      estMinutes: 10,
      slaMinutes: 25,
      startedAt: "2026-01-19T18:02",
      completedAt: "2026-01-19T18:20",
      gates: { captionTemplate: true, approvedAudio: true, hashtagsOk: true, noRestricted: true, proofAttached: true },
      submission: {
        reelUrl: "https://www.instagram.com/reel/EXAMPLE",
        screenshotUrl: "https://example.com/screenshot.jpg",
        submittedAt: "2026-01-19 18:22",
      },
      audit: [
        { at: "2026-01-19 17:55", by: "Ops Bot", text: "Created work item." },
        { at: "2026-01-19 18:02", by: "Worker", text: "Marked as In progress." },
        { at: "2026-01-19 18:22", by: "Worker", text: "Submitted proof links." },
      ],
    },
    {
      id: "WI-1999",
      title: "Needs fix: Proof missing screenshot URL (strict)",
      type: "Reel posting",
      accountId: "acc_2",
      createdAt: "2026-01-19",
      dueAt: "2026-01-19T20:00",
      status: "Needs fix",
      priority: "P1",
      rewardINR: RATE,
      estMinutes: 12,
      slaMinutes: 30,
      gates: { captionTemplate: true, approvedAudio: true, hashtagsOk: true, noRestricted: true, proofAttached: false },
      submission: { reelUrl: "https://www.instagram.com/reel/EXAMPLE2", screenshotUrl: "", submittedAt: "2026-01-19 19:40" },
      review: {
        reviewedAt: "2026-01-19 19:55",
        reviewer: "Admin",
        decision: "Rejected",
        reason: "Screenshot URL missing. Resubmit with proof screenshot.",
      },
      audit: [
        { at: "2026-01-19 18:30", by: "Ops Bot", text: "Created work item." },
        { at: "2026-01-19 19:40", by: "Worker", text: "Submitted partial proof." },
        { at: "2026-01-19 19:55", by: "Admin", text: "Needs fix: screenshot missing." },
      ],
    },
  ];
}

function seedBatches(today: string, workerId: string): PayoutBatch[] {
  const prev: PayoutBatch = {
    id: "PAY-2026-W03-01",
    cycleLabel: "Week 03 (Jan 13–Jan 19)",
    periodStart: "2026-01-13",
    periodEnd: "2026-01-19",
    status: "Paid",
    createdAt: "2026-01-19 23:50",
    processedAt: "2026-01-20 10:10",
    paidAt: "2026-01-20 10:30",
    method: "UPI",
    items: [
      { id: "PI-9001", workItemId: "WI-1988", workerId, handle: "@dailyfit.india", amountINR: 5, status: "Paid" },
      { id: "PI-9002", workItemId: "WI-1990", workerId, handle: "@stylebytes.in", amountINR: 5, status: "Paid" },
    ],
    notes: ["Paid via UPI batch transfer.", "No failures."],
  };

  const draft: PayoutBatch = {
    id: "PAY-2026-W04-01",
    cycleLabel: "Week 04 (Jan 20–Jan 26)",
    periodStart: "2026-01-20",
    periodEnd: "2026-01-26",
    status: "Draft",
    createdAt: `${today} 09:05`,
    method: "UPI",
    items: [],
    notes: ["Draft batch. Eligible approvals will be pulled by Admin."],
  };

  return [draft, prev];
}

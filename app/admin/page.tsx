"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import AdminNavigationDrawer from "./AdminNavigationDrawer";
import WorkerAccessPanel from "./WorkerAccessPanel";
import AdminOverview from "./AdminOverview";
import WorkerDirectory from "./WorkerDirectory";
import WorkerWorkspace, { WorkerDetailTabs, WorkerGlyph, WorkerProfileHeader } from "./WorkerWorkspace";
import workerWorkspaceStyles from "./WorkerWorkspace.module.css";
import AdminSectionLoading from "@/app/_components/AdminSectionLoading";
import { BrandLogo } from "@/app/_components/BrandLogo";
import ViewPayoutClaims from "@/app/_components/ViewPayoutClaims";
import { apiFetch as fetch } from "@/lib/api/client";
// app/admin/page.tsx
import React, { Suspense, useEffect, useMemo, useState, useCallback, useRef } from "react";
import { getMyRole } from "@/lib/role";
import { buildFeedbackSubject, feedbackCategoryLabel } from "@/lib/feedback";
import { supabase } from "@/lib/supabaseClient";
import { useAdminLive, type AdminLiveKind } from "@/lib/useAdminLive";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ADMIN_NAV_GROUPS, adminSectionHref, parseAdminSection, isGigAdminSection, type AdminSection, type GigAdminView } from "@/lib/adminNavigation";
import { bindAdminCacheIdentity } from "@/lib/adminCacheIdentity";
import { invalidateAdminUpiQueue } from "@/lib/adminUpiCache";
import { currentWorkerRecords, workerAccessStatus } from "@/lib/adminWorkerDirectory";
import { useAdminCachedResource } from "@/lib/useAdminCachedResource";
import { ADMIN_OVERVIEW_CACHE_KEY, isAdminOverviewCounts, type AdminOverviewCounts } from "@/lib/adminOverview";

const GigAdminConsole = dynamic(() => import("@/app/addgigs/GigAdminConsole"), {
  loading: () => <AdminSectionLoading />,
});

const LS_KEYS = {
  AUTH: "igops:auth",
  SCHEDULE: "igops:schedule",
} as const;

function readLS<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
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

function devAdminHeaders(): Record<string, string> {
  return {};
}

function hasDevAdminBypassSession() {
  return devAdminHeaders()["x-dev-bypass"] === "1";
}

function buildAdminHeaders(token?: string | null, initHeaders?: HeadersInit) {
  const headers = new Headers(initHeaders);
  headers.set("Content-Type", "application/json");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  } else {
    Object.entries(devAdminHeaders()).forEach(([key, value]) => headers.set(key, value));
  }
  return headers;
}

async function getAdminAccessToken() {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function getAdminRequestHeaders(initHeaders?: HeadersInit) {
  const token = await getAdminAccessToken();
  const headers = buildAdminHeaders(token, initHeaders);
  return {
    headers,
    authorized: !!token || headers.get("x-dev-bypass") === "1",
  };
}

/** ===================== Types ===================== */
type PolicyTier = "Standard" | "Strict";
type AccountHealth = "Healthy" | "Watch" | "Risk";
type TaskType = "Reel posting" | "Story posting" | "Comment replies" | "Profile update";
type Priority = "P0" | "P1" | "P2";
type Status = "Open" | "In progress" | "Submitted" | "Approved" | "Needs fix" | "Hard rejected" | "Cancelled";

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

type Worker = {
  // In the admin UI we want this to be WKR-### (worker_code).
  // If workers table exists, it will also be WKR-###.
  id: string;
  userId?: string; // auth user id (uuid)
  name: string;
  email: string; // may be blank if loading from profiles-only
  active: boolean;
  moderationStatus?: "active" | "suspended" | "deleted";
  deletedAt?: string;
  purgeAfter?: string;
  purgeStartedAt?: string;
  timezone?: string;
  introVideo?: {
    name: string;
    uploadedAt: string;
    previewUrl?: string;
    thumbnailUrl?: string;
    mimeType?: string;
    size?: number;
  };
};

type WorkItem = {
  id: string;
  workerId: string;
  accountId: string;
  title: string;
  type: TaskType;
  createdAt: string; // YYYY-MM-DD
  dueAt?: string; // India-local ISO; earnings records may have no deadline
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
    decision?: "Approved" | "Needs fix" | "Hard rejected";
    rejectReason?: string;
  };
  audit: Array<{ at: string; by: string; text: string }>;
};

type Assignment = {
  workerId: string;
  accountId: string;
  schedule?: AssignmentSchedule;
};

type ApiSnapshot = {
  workers: Worker[];
  accounts: AssignedAccount[];
  assignments: Assignment[];
  workItems: WorkItem[];
  upiConfigs?: UpiConfig[];
  errors?: Array<{ table?: string; message?: string }>;
};

type UpiConfig = {
  workerId: string;
  workerCode?: string;
  upiId: string;
  verified: boolean;
  verifiedAt?: string;
  payoutSchedule?: string;
  payoutDay?: string;
};

type WorkEmailSecretCode = {
  id: string;
  label?: string | null;
  code_hint: string;
  status: "active" | "blocked";
  use_count: number;
  max_uses?: number | null;
  expires_at?: string | null;
  last_used_at?: string | null;
  created_at: string;
  blocked_at?: string | null;
};

type WorkEmailManagedAccount = {
  id: string;
  ownerUserId: string;
  ownerDisplayName?: string;
  ownerWorkerCode?: string;
  ownerRole?: string;
  email: string;
  username: string;
  hasSocialPassword: boolean;
  platform: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
};

type AdminFeedbackStatus = "new" | "reviewing" | "resolved" | "closed";

type AdminFeedbackItem = {
  id: string;
  user_id?: string | null;
  worker_id?: string | null;
  profile_name?: string | null;
  profile_role?: string | null;
  section: string;
  language_code: string;
  language_name?: string | null;
  category: string;
  rating?: number | null;
  subject?: string | null;
  message: string;
  allow_contact: boolean;
  status: AdminFeedbackStatus;
  admin_note?: string | null;
  source?: string | null;
  page_url?: string | null;
  meta?: Record<string, unknown> | null;
  created_at: string;
  updated_at?: string | null;
};

type AdminPayoutItem = {
  id: string;
  workItemId: string;
  handle: string;
  amountINR: number;
  status: string;
  reason?: string;
};

type AdminPayoutBatch = {
  id: string;
  workerId: string;
  workerCode?: string;
  workerName?: string;
  cycleLabel: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  createdAt: string;
  processedAt?: string;
  paidAt?: string;
  method: string;
  notes?: string[];
  items: AdminPayoutItem[];
};

type ScheduleConfig = {
  times: string[];
  days: number[];
  deadlineMin: number;
  timezone: string;
};

type AssignmentSchedule = {
  times: string[];
  days: number[];
  deadlineMin: number;
  timezone: string;
};

/** ===================== Utils ===================== */
function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
function normalizeTimesCsv(csv: string) {
  const raw = (csv || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    if (!/^\d{2}:\d{2}$/.test(t)) continue;
    const [hh, mm] = t.split(":").map(Number);
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}
function normalizeDays(input: number[]) {
  const raw = Array.isArray(input) ? input : [];
  const out = Array.from(new Set(raw.filter((d) => d >= 0 && d <= 6))).sort((a, b) => a - b);
  return out.length ? out : [0, 1, 2, 3, 4, 5, 6];
}
function getTzParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const map: Record<string, number | string> = {};
  for (const p of parts) {
    if (p.type === "year") map.year = Number(p.value);
    if (p.type === "month") map.month = Number(p.value);
    if (p.type === "day") map.day = Number(p.value);
    if (p.type === "hour") map.hour = Number(p.value);
    if (p.type === "minute") map.minute = Number(p.value);
    if (p.type === "weekday") map.weekday = p.value;
  }
  return map as { year: number; month: number; day: number; hour: number; minute: number; weekday: string };
}
function dayOfWeekInTz(date: Date, timeZone: string) {
  const parts = getTzParts(date, timeZone);
  const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return day;
}
const TIMEZONE_OPTIONS = [
  "Asia/Kolkata",
  "UTC",
  "America/New_York",
  "Europe/London",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];
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
function isoToLocalInput(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function formatINR(n: number) {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `₹${n}`;
  }
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function feedbackStatusTone(status: AdminFeedbackStatus): "warn" | "info" | "success" | "neutral" {
  if (status === "new") return "warn";
  if (status === "reviewing") return "info";
  if (status === "resolved") return "success";
  return "neutral";
}

function splitCsvToList(s: string) {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}
function normHandle(s: string) {
  const t = s.trim();
  if (!t) return "";
  return t.startsWith("@") ? t : `@${t}`;
}

/** ===================== Icons ===================== */
function Icon({ name, className }: { name: string; className?: string }) {
  const c = cx("h-5 w-5", className);
  switch (name) {
    case "grid":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none">
          <rect x="4" y="4" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
          <rect x="13" y="4" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
          <rect x="4" y="13" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
          <rect x="13" y="13" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case "list":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none">
          <path d="M9 6h11M9 12h11M9 18h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="4.5" cy="6" r="1.2" fill="currentColor" />
          <circle cx="4.5" cy="12" r="1.2" fill="currentColor" />
          <circle cx="4.5" cy="18" r="1.2" fill="currentColor" />
        </svg>
      );
    case "mail":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none">
          <rect x="3.5" y="5.5" width="17" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" />
          <path d="m4 7 8 6 8-6" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      );
    case "clip":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none">
          <rect x="5.5" y="5" width="13" height="15.5" rx="2" stroke="currentColor" strokeWidth="1.8" />
          <path d="M9 5V3.8h6V5M9 11h6M9 15h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "link":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="m10 13 4-4M8.5 15.5l-1 1a4 4 0 0 1-5.7-5.6l4-4a4 4 0 0 1 5.7 0m1 1 1-1a4 4 0 0 1 5.7 5.6l-4 4a4 4 0 0 1-5.7 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "lock":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="5" y="10" width="14" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" />
          <path d="M8 10V7a4 4 0 1 1 8 0v3m-4 5v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "hamburger":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none">
          <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "search":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none">
          <path d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M16.5 16.5 21 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "bell":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none">
          <path d="M18 9a6 6 0 1 0-12 0c0 7-3 7-3 7h18s-3 0-3-7Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M10 20a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "refresh":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none">
          <path d="M20 12a8 8 0 1 1-2.34-5.66" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M20 4v6h-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "plus":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none">
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "x":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none">
          <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "check":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none">
          <path d="M20 7 10.5 16.5 4 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "chevRight":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none">
          <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "users":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none">
          <path d="M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M4 20a8 8 0 0 1 16 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "briefcase":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none">
          <path d="M9 6a3 3 0 0 1 6 0v2H9V6Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M4 8h16v12H4V8Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M4 13h16" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case "shield":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none">
          <path
            d="M12 3l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V7l8-4Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
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
    case "comment":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none">
          <path
            d="M5.5 6.5h13A1.5 1.5 0 0 1 20 8v7a1.5 1.5 0 0 1-1.5 1.5H9l-4 3v-3H5.5A1.5 1.5 0 0 1 4 15V8a1.5 1.5 0 0 1 1.5-1.5Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "logout":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none">
          <path
            d="M10 7V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-1"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path d="M3 12h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M7 8l-4 4 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default:
      return <span className={c} />;
  }
}

/** ===================== UI Atoms ===================== */
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
    "inline-flex min-h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-[13px] font-semibold transition [&>svg]:shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50";
  const styles =
    variant === "primary"
      ? "bg-[#1f2b24] text-white shadow-[0_1px_0_rgba(255,255,255,0.12)_inset,0_1px_2px_rgba(0,0,0,0.2)] hover:bg-[#2b3a31]"
      : variant === "secondary"
      ? "border border-[#d9ddd8] bg-white text-[#1a201c] shadow-[0_1px_2px_rgba(26,32,28,0.06)] hover:bg-[#f7f8f6]"
      : variant === "danger"
      ? "bg-[#b42318] text-white hover:bg-[#9a1d14]"
      : "text-[#4b544e] hover:bg-[#f1f3f0] hover:text-[#1a201c]";
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
      ? "bg-[#e0ecf8] text-[#1f4a73]"
      : tone === "success"
      ? "bg-[#e3f1df] text-[#1f5131]"
      : tone === "warn"
      ? "bg-[#fdf0d2] text-[#6b4a05]"
      : tone === "danger"
      ? "bg-[#fde4e1] text-[#8e1f1a]"
      : "bg-[#eceeeb] text-[#4b544e]";
  const dot =
    tone === "info" ? "bg-[#2a78d6]" : tone === "success" ? "bg-[#2e7d4f]" : tone === "warn" ? "bg-[#d99a06]" : tone === "danger" ? "bg-[#d03b3b]" : "bg-[#8a938d]";
  return (
    <span className={cx("inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium", cls, className)}>
      <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", dot)} aria-hidden="true" />
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
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
    <section className="min-w-0 rounded-xl border border-[#e3e5e1] bg-white shadow-[0_1px_0_rgba(26,32,28,0.04),0_1px_2px_rgba(26,32,28,0.06)]">
      {(title || right) && (
        <div className={cx("flex flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b border-[#ebedea]", compact ? "px-4 py-2.5" : "px-4 py-3.5 sm:px-5")}>
          <div className="min-w-0">
            {title && <h2 className="text-[14px] font-semibold text-[#1a201c]">{title}</h2>}
            {subtitle && <div className="mt-0.5 text-[12.5px] leading-5 text-[#616a64]">{subtitle}</div>}
          </div>
          {right && <div className="flex max-w-full shrink-0 flex-wrap gap-2">{right}</div>}
        </div>
      )}
      <div className={cx(compact ? "px-4 py-2.5" : "px-4 py-4 sm:px-5")}>{children}</div>
    </section>
  );
}

function AccountHealthPill({ h }: { h: AccountHealth }) {
  const tone = h === "Healthy" ? "success" : h === "Watch" ? "warn" : "danger";
  return <Chip tone={tone}>{h}</Chip>;
}

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
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-[#0f1411]/50 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="dashboard-sheet-rise relative flex max-h-[92dvh] w-full max-w-[820px] flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:max-h-[88dvh] sm:rounded-xl"
      >
        <div className="flex justify-center pt-2 sm:hidden" aria-hidden="true">
          <span className="h-1 w-9 rounded-full bg-[#d5d9d4]" />
        </div>
        <div className="flex items-start justify-between gap-3 border-b border-[#ebedea] px-4 pb-3 pt-2.5 sm:px-5 sm:pt-4">
          <div className="min-w-0">
            <div className="text-[16px] font-semibold text-[#1a201c]">{title}</div>
            {subtitle && <div className="mt-0.5 truncate text-[13px] text-[#616a64]">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
            className="-mr-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f3f4f1] text-[#1a201c] transition hover:bg-[#e9ebe7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">{children}</div>
        <div
          className="flex shrink-0 flex-col-reverse gap-2 border-t border-[#ebedea] px-4 pt-3 sm:flex-row sm:flex-wrap sm:justify-end sm:px-5 sm:pb-3 [&>button]:w-full sm:[&>button]:w-auto"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          {actions}
        </div>
      </div>
    </div>
  );
}

/** ===================== Auth fetch helper ===================== */
async function fetchWithAuth<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const { headers, authorized } = await getAdminRequestHeaders(init?.headers);
    if (!authorized) return null;
    const r = await fetch(url, {
      ...(init || {}),
      headers,
      signal: init?.signal ?? (!init?.method || init.method === "GET" ? AbortSignal.timeout(20_000) : undefined),
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

function AdminEmpty({ icon = "check", title, body }: { icon?: string; title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center px-4 py-8 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#eef1ed] text-[#5b665f]">
        <Icon name={icon} className="h-[18px] w-[18px]" />
      </span>
      <div className="mt-2.5 text-[13.5px] font-semibold text-[#1a201c]">{title}</div>
      {body ? <p className="mt-0.5 max-w-[40ch] text-[12.5px] leading-5 text-[#616a64]">{body}</p> : null}
    </div>
  );
}


/** ===================== Sidebar ===================== */
function AdminSidebar({
  active,
  onPick,
  onLogout,
  counts,
  onClose,
}: {
  active: AdminSection;
  onPick: (s: AdminSection) => void;
  onLogout: () => void;
  counts?: Partial<Record<AdminSection, number>>;
  onClose?: () => void;
}) {
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    const current = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !current) return;
    const bounds = nav.getBoundingClientRect();
    const selected = current.getBoundingClientRect();
    if (selected.top < bounds.top) nav.scrollTop -= bounds.top - selected.top + 12;
    else if (selected.bottom > bounds.bottom) nav.scrollTop += selected.bottom - bounds.bottom + 12;
  }, [active]);
  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-[60px] shrink-0 items-center justify-between gap-2 border-b border-[#ebedea] px-3 lg:h-[64px]">
        <Link href="/" className="flex min-w-0 items-center gap-2.5 rounded-lg px-1.5 py-1 transition hover:bg-[#f3f4f1]" aria-label="Reelencer home">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-[#e3e5e1] bg-white shadow-[0_1px_2px_rgba(26,32,28,0.06)]">
            <BrandLogo className="h-8 w-8" sizes="32px" />
          </span>
          <span className="min-w-0 leading-none">
            <span className="block truncate font-[Georgia,Times_New_Roman,serif] text-[17px] font-bold text-[#1a201c]">Reelencer</span>
            <span className="mt-1 flex items-center gap-1.5 text-[11.5px] font-medium text-[#7a827c]">
              <Icon name="shield" className="h-3 w-3 text-[#2e7d4f]" />
              Admin console
            </span>
          </span>
        </Link>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f3f4f1] text-[#1a201c] transition hover:bg-[#e9ebe7]"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <nav ref={navRef} aria-label="Admin sections" className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-3 py-4">
        {ADMIN_NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="px-2.5 pb-1 text-[11.5px] font-semibold text-[#7a827c]">{group.label}</div>
            <div className="grid gap-0.5">
              {group.items.map((item) => {
                const isActive = active === item.id;
                const count = counts?.[item.id] ?? 0;
                return (
                  <Link
                    key={item.id}
                    href={adminSectionHref(item.id)}
                    prefetch={false}
                    onClick={(event) => {
                      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                      event.preventDefault();
                      onPick(item.id);
                    }}
                    aria-current={isActive ? "page" : undefined}
                    className={cx(
                      "group flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40 lg:min-h-9 lg:py-1.5",
                      isActive ? "bg-[#eceeea] text-[#1a201c]" : "text-[#4b544e] hover:bg-[#f3f4f1] hover:text-[#1a201c]"
                    )}
                  >
                    <Icon name={item.icon} className={cx("h-[18px] w-[18px] shrink-0", isActive ? "text-[#1a201c]" : "text-[#7a827c] group-hover:text-[#1a201c]")} />
                    <span className="min-w-0 flex-1 leading-5">{item.label}</span>
                    {count > 0 ? (
                      <span className={cx("shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none tabular-nums", isActive ? "bg-[#1f2b24] text-white" : item.attention ? "bg-[#fdf1dc] text-[#9a5b00]" : "bg-[#eef0ed] text-[#616a64]")}>{count > 99 ? "99+" : count}<span className="sr-only"> {item.attention ?? "total"}</span></span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-[#ebedea] p-3" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
        <div className="mb-2 flex items-start gap-2 rounded-lg bg-[#fafbf9] px-3 py-2.5 text-[12px] leading-5 text-[#616a64] ring-1 ring-inset ring-[#ebedea]">
          <Icon name="shield" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#2e7d4f]" />
          Manage gigs, creators and payouts securely.
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="flex h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-semibold text-[#b42318] transition hover:bg-[#fdf2f1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b42318]/30"
        >
          <Icon name="logout" className="h-[18px] w-[18px]" />
          Sign out
        </button>
      </div>
    </div>
  );
}

/** ===================== Assignments Panels ===================== */
function AddAssignmentPanel({
  workerId,
  accounts,
  assignedIds,
  globallyAssignedIds,
  onAssign,
  onDeleteAccount,
  onCreateAccount,
  defaultTimesCsv,
  defaultDeadlineMin,
  defaultDays,
  defaultTimezone,
}: {
  workerId: string;
  accounts: AssignedAccount[];
  assignedIds: Set<string>;
  globallyAssignedIds: Set<string>;
  onAssign: (accountId: string, schedule: AssignmentSchedule) => void;
  onDeleteAccount: (accountId: string) => void;
  onCreateAccount: () => void;
  defaultTimesCsv: string;
  defaultDeadlineMin: number;
  defaultDays: number[];
  defaultTimezone: string;
}) {
  const [pick, setPick] = useState("");
  const [timesCsv, setTimesCsv] = useState(defaultTimesCsv);
  const [deadlineMin, setDeadlineMin] = useState(defaultDeadlineMin);
  const [days, setDays] = useState<number[]>(defaultDays);
  const [timezone, setTimezone] = useState(defaultTimezone);
  const available = useMemo(
    () => accounts.filter((a) => !assignedIds.has(a.id) && !globallyAssignedIds.has(a.id)),
    [accounts, assignedIds, globallyAssignedIds]
  );
  const lockedCount = useMemo(() => accounts.filter((a) => globallyAssignedIds.has(a.id)).length, [accounts, globallyAssignedIds]);

  useEffect(() => {
    setPick(available[0]?.id ?? "");
    setTimesCsv(defaultTimesCsv);
    setDeadlineMin(defaultDeadlineMin);
    setDays(defaultDays);
    setTimezone(defaultTimezone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workerId, available.length]);

  const normalizedTimes = useMemo(() => normalizeTimesCsv(timesCsv), [timesCsv]);
  const normalizedDeadline = Math.max(60, Math.min(720, Number(deadlineMin) || 180));
  const normalizedDays = useMemo(() => normalizeDays(days), [days]);

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">Add an account to this worker’s feed.</div>
      <select
        aria-label="Account to assign"
        value={pick}
        onChange={(e) => setPick(e.target.value)}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm font-extrabold text-slate-900 outline-none"
      >
        {available.map((a) => (
          <option key={a.id} value={a.id}>
            {a.handle} • {a.policyTier} • {a.ownerTeam}
          </option>
        ))}
        {available.length === 0 && <option value="">No available accounts</option>}
      </select>
      {available.length === 0 ? (
        <div className="text-xs text-amber-600">
          All accounts are assigned. Remove an existing assignment to free it for another worker.
        </div>
      ) : (
        <div className="text-xs text-slate-500">
          {lockedCount} account{lockedCount === 1 ? "" : "s"} already assigned to other workers.
        </div>
      )}
      <Button
        variant="danger"
        onClick={() => pick && onDeleteAccount(pick)}
        disabled={!pick}
        className="w-full"
      >
        <Icon name="x" />
        Delete account
      </Button>
      <div className="grid gap-2">
        <div className="text-xs font-extrabold text-slate-600">Daily times (HH:MM, comma-separated)</div>
        <input
          aria-label="Daily posting times"
          value={timesCsv}
          onChange={(e) => setTimesCsv(e.target.value)}
          placeholder="08:00, 18:00"
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
        />
        <div className="text-xs text-slate-500">Planned slots: {normalizedTimes.length || 0}</div>
      </div>
      <div className="grid gap-2">
        <div className="text-xs font-extrabold text-slate-600">Deadline (minutes)</div>
        <input
          aria-label="Deadline in minutes"
          type="number"
          min={60}
          max={720}
          value={deadlineMin}
          onChange={(e) => setDeadlineMin(Number(e.target.value))}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
        />
      </div>
      <div className="grid gap-2">
        <div className="text-xs font-extrabold text-slate-600">Days</div>
        <div className="flex flex-wrap gap-2">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, idx) => (
            <label key={label} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-extrabold text-slate-700">
              <input
                type="checkbox"
                checked={days.includes(idx)}
                onChange={(e) => {
                  setDays((prev) => (e.target.checked ? Array.from(new Set([...prev, idx])) : prev.filter((d) => d !== idx)));
                }}
              />
              {label}
            </label>
          ))}
        </div>
      </div>
      <div className="grid gap-2">
        <div className="text-xs font-extrabold text-slate-600">Timezone</div>
        <select
          aria-label="Assignment timezone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
        >
          {TIMEZONE_OPTIONS.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          variant="primary"
          onClick={() =>
            pick &&
            onAssign(pick, {
              times: normalizedTimes,
              deadlineMin: normalizedDeadline,
              days: normalizedDays,
              timezone,
            })
          }
          disabled={!pick || available.length === 0 || normalizedTimes.length === 0 || normalizedDays.length === 0}
          className="w-full"
        >
          <Icon name="plus" />
          Assign
        </Button>
        <Button variant="secondary" onClick={onCreateAccount} className="w-full">
          <Icon name="plus" />
          Create account
        </Button>
      </div>
      <div className="text-xs text-slate-500">Tip: keep 5–6+ accounts per worker for consistent throughput.</div>
    </div>
  );
}


/** ===================== Page (UI) ===================== */
function AdminConsole({ adminId }: { adminId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const today = isoToday();
  const readOverviewCounts = useCallback(async (signal: AbortSignal) => {
    const response = await fetch("/api/admin/overview", { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
    const data: unknown = await response.json();
    if (!response.ok || !isAdminOverviewCounts(data)) throw new Error("Overview totals could not be refreshed.");
    return data;
  }, []);
  const overview = useAdminCachedResource<AdminOverviewCounts>({
    scope: adminId, key: ADMIN_OVERVIEW_CACHE_KEY, load: readOverviewCounts,
    enabled: mounted, ttlMs: 15_000, persist: true, validate: isAdminOverviewCounts,
  });
  const refreshOverviewCounts = overview.refresh;
  useEffect(() => {
    const refresh = () => { void refreshOverviewCounts({ afterCurrent: true }); };
    const events = ["admin-overview-refresh", "admin-linked-accounts-refresh", "view-payout-claims-updated", "admin-refresh"];
    events.forEach(event => window.addEventListener(event, refresh));
    return () => events.forEach(event => window.removeEventListener(event, refresh));
  }, [refreshOverviewCounts]);

  // global UI
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const closeNavigation = useCallback(() => setMobileNavOpen(false), []);
  const [activeSection, setActiveSectionState] = useState<AdminSection>(() => parseAdminSection(searchParams));
  const sectionRef = useRef(activeSection);
  const [gigView, setGigView] = useState<GigAdminView | null>(() => {
    const section = parseAdminSection(searchParams);
    return isGigAdminSection(section) ? section : null;
  });
  const [gigSectionCounts, setGigSectionCounts] = useState<Partial<Record<GigAdminView, number>>>({});
  const isGigSection = isGigAdminSection(activeSection);
  const setActiveSection = useCallback((section: AdminSection) => {
    sectionRef.current = section;
    setActiveSectionState(section);
    if (isGigAdminSection(section)) setGigView(section);
    const href = adminSectionHref(section);
    if (window.location.pathname + window.location.search !== href) window.history.pushState(null, "", href);
    setMobileNavOpen(false);
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);
  // Next links, bookmarked sections and browser back/forward share the same state.
  useEffect(() => {
    const section = parseAdminSection(searchParams);
    const changed = sectionRef.current !== section;
    sectionRef.current = section;
    setActiveSectionState(section);
    if (isGigAdminSection(section)) setGigView(section);
    if (changed) setMobileNavOpen(false);
    const requestedSection = searchParams?.get("section");
    if (section === "Overview" && requestedSection && requestedSection.trim().toLowerCase() !== "overview") {
      const href = adminSectionHref("Overview", searchParams?.toString() ?? "");
      window.history.replaceState(window.history.state, "", href);
    }
  }, [searchParams]);

  const [toast, setToast] = useState<{ message: string; tone: "success" | "danger" } | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const defaultSchedule = readLS<ScheduleConfig>(LS_KEYS.SCHEDULE, {
    times: ["08:00", "18:00"],
    days: [0, 1, 2, 3, 4, 5, 6],
    deadlineMin: 180,
    timezone: "Asia/Kolkata",
  });
  const [scheduleTimesCsv, setScheduleTimesCsv] = useState((defaultSchedule.times ?? ["08:00", "18:00"]).join(", "));
  const [scheduleDays, setScheduleDays] = useState<number[]>(normalizeDays(defaultSchedule.days ?? []));
  const [scheduleDeadlineMin, setScheduleDeadlineMin] = useState(defaultSchedule.deadlineMin);
  const [scheduleTimezone, setScheduleTimezone] = useState(defaultSchedule.timezone ?? "Asia/Kolkata");

  const scheduleConfig = useMemo(
    () => ({
      times: normalizeTimesCsv(scheduleTimesCsv),
      days: normalizeDays(scheduleDays),
      deadlineMin: Math.max(60, Math.min(720, Number(scheduleDeadlineMin) || 180)),
      timezone: scheduleTimezone,
    }),
    [scheduleTimesCsv, scheduleDays, scheduleDeadlineMin, scheduleTimezone]
  );

  // data
  const [workers, setWorkers] = useState<Worker[]>([]);
  const currentWorkers = useMemo(() => currentWorkerRecords(workers), [workers]);
  const assignableWorkers = useMemo(() => currentWorkers.filter(worker => workerAccessStatus(worker) === "active"), [currentWorkers]);
  const [workerDetailOpen, setWorkerDetailOpen] = useState(false);
  const [accounts, setAccounts] = useState<AssignedAccount[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [workerDirectoryError, setWorkerDirectoryError] = useState<string | null>(null);
  const [sandboxWorkers, setSandboxWorkers] = useState<Worker[]>([]);
  const [upiConfigs, setUpiConfigs] = useState<UpiConfig[]>([]);
  const [payoutBatchesAdmin, setPayoutBatchesAdmin] = useState<AdminPayoutBatch[]>([]);
  // Rejected (Failed) requests leave the queue as soon as they're rejected; they stay reachable behind a toggle.
  const [showRejectedPayouts, setShowRejectedPayouts] = useState(false);
  const rejectedPayoutCount = useMemo(() => payoutBatchesAdmin.filter((b) => b.status === "Failed").length, [payoutBatchesAdmin]);
  const payoutQueue = useMemo(
    () => (showRejectedPayouts ? payoutBatchesAdmin : payoutBatchesAdmin.filter((b) => b.status !== "Failed")),
    [payoutBatchesAdmin, showRejectedPayouts]
  );
  const payoutActionsRunning = useRef(new Set<string>());
  const payoutVersion = useRef(0);
  const [busyPayouts, setBusyPayouts] = useState<Set<string>>(new Set());
  const [workEmailCodes, setWorkEmailCodes] = useState<WorkEmailSecretCode[]>([]);
  const [workEmailSchemaMissing, setWorkEmailSchemaMissing] = useState(false);
  const [feedbackItems, setFeedbackItems] = useState<AdminFeedbackItem[]>([]);
  const [feedbackSchemaMissing, setFeedbackSchemaMissing] = useState(false);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackSearch, setFeedbackSearch] = useState("");
  const [feedbackFilter, setFeedbackFilter] = useState<"all" | AdminFeedbackStatus>("all");
  const [selectedFeedbackId, setSelectedFeedbackId] = useState<string | null>(null);
  const [feedbackStatusDraft, setFeedbackStatusDraft] = useState<AdminFeedbackStatus>("new");
  const [feedbackNoteDraft, setFeedbackNoteDraft] = useState("");
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [newCodeLabel, setNewCodeLabel] = useState("");
  const [newCodeMaxUses, setNewCodeMaxUses] = useState<number>(0);
  const [newCodeExpiry, setNewCodeExpiry] = useState<string>("");
  const [newlyGeneratedCode, setNewlyGeneratedCode] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [copiedCodeRowId, setCopiedCodeRowId] = useState<string | null>(null);
  const [codeQuery, setCodeQuery] = useState("");
  const [codeFilter, setCodeFilter] = useState<"all" | "active" | "blocked" | "expired" | "exhausted">("all");
  const [codeSort, setCodeSort] = useState<"newest" | "oldest" | "usage-desc" | "expiry-soon">("newest");
  const [workEmailAccountsAdmin, setWorkEmailAccountsAdmin] = useState<WorkEmailManagedAccount[]>([]);
  const [workEmailAccountQuery, setWorkEmailAccountQuery] = useState("");
  const [revealedSocialPasswords, setRevealedSocialPasswords] = useState<Record<string, string>>({});
  const [revealingPasswordFor, setRevealingPasswordFor] = useState<string | null>(null);
  const [renewModalOpen, setRenewModalOpen] = useState(false);
  const [renewCodeTarget, setRenewCodeTarget] = useState<WorkEmailSecretCode | null>(null);
  const [renewExpiry, setRenewExpiry] = useState<string>("");
  const [renewResetUsage, setRenewResetUsage] = useState<boolean>(false);
  const [renewSaving, setRenewSaving] = useState(false);

  // selection / drawers
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);

  const [workerTimezoneDraft, setWorkerTimezoneDraft] = useState<string>("Asia/Kolkata");

  // modals
  const [createWorkOpen, setCreateWorkOpen] = useState(false);
  const [createWorkWorkerId, setCreateWorkWorkerId] = useState<string>("");
  const [createWorkAccountId, setCreateWorkAccountId] = useState<string>("");
  const [createWorkType, setCreateWorkType] = useState<TaskType>("Reel posting");
  const [createWorkTitle, setCreateWorkTitle] = useState<string>("");
  const [createWorkPriority, setCreateWorkPriority] = useState<Priority>("P1");
  const [createWorkReward, setCreateWorkReward] = useState<number>(5);
  const [createWorkEst, setCreateWorkEst] = useState<number>(12);
  const [createWorkSla, setCreateWorkSla] = useState<number>(30);
  const [createWorkDueHHMM, setCreateWorkDueHHMM] = useState<string>("18:00");


  const [editScheduleOpen, setEditScheduleOpen] = useState(false);
  const [editScheduleWorkerId, setEditScheduleWorkerId] = useState<string>("");
  const [editScheduleAccountId, setEditScheduleAccountId] = useState<string>("");
  const [editScheduleTimesCsv, setEditScheduleTimesCsv] = useState<string>("08:00, 18:00");
  const [editScheduleDays, setEditScheduleDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [editScheduleDeadlineMin, setEditScheduleDeadlineMin] = useState<number>(180);
  const [editScheduleTimezone, setEditScheduleTimezone] = useState<string>("Asia/Kolkata");

  // create worker + create account
  const [createWorkerOpen, setCreateWorkerOpen] = useState(false);
  const [newWorkerId, setNewWorkerId] = useState("");
  const [newWorkerName, setNewWorkerName] = useState("");
  const [newWorkerEmail, setNewWorkerEmail] = useState("");
  const [newWorkerPassword, setNewWorkerPassword] = useState("");
  const [newWorkerActive, setNewWorkerActive] = useState(true);

  const [createAccountOpen, setCreateAccountOpen] = useState(false);
  const [newAccountId, setNewAccountId] = useState("");
  const [newAccountHandle, setNewAccountHandle] = useState("");
  const [newAccountNiche, setNewAccountNiche] = useState("");
  const [newAccountOwnerTeam, setNewAccountOwnerTeam] = useState("");
  const [newAccountPolicy, setNewAccountPolicy] = useState<PolicyTier>("Standard");
  const [newAccountHealth, setNewAccountHealth] = useState<AccountHealth>("Healthy");
  const [newAccountRulesCsv, setNewAccountRulesCsv] = useState("");
  const [newAccountAudiosCsv, setNewAccountAudiosCsv] = useState("");
  const [newAccountHashtagsCsv, setNewAccountHashtagsCsv] = useState("");

  const logout = useCallback(() => {
    bindAdminCacheIdentity(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(LS_KEYS.AUTH);
    }
    void supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    setMobileNavOpen(false);
    router.replace("/login");
  }, [router]);

  const refreshLock = useRef(false);
  const snapshotRefreshPending = useRef(false);
  const [snapshotLoaded, setSnapshotLoaded] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const scheduleLock = useRef(false);
  const loadSnapshot = useCallback(async function refreshSnapshot(): Promise<void> {
    if (refreshLock.current) { snapshotRefreshPending.current = true; return; }
    refreshLock.current = true;
    const payoutVersionAtStart = payoutVersion.current;
    try {
      const workersReq = fetchWithAuth<{ ok: boolean; workers: Worker[]; error?: string }>("/api/admin/workers?includeDeleted=true", { method: "GET" });
      const upiReq = fetchWithAuth<{ ok: boolean; upiConfigs: UpiConfig[] }>("/api/admin/upi-configs", { method: "GET" });
      const payoutsReq = fetchWithAuth<{ ok: boolean; payoutBatches: AdminPayoutBatch[] }>("/api/admin/payoutbatches", { method: "GET" });
      // 1) try API snapshot first (kept)
      const snap = await fetchWithAuth<ApiSnapshot>("/api/admin/snapshot", { method: "GET" });
      setSnapshotError(snap ? null : "Some admin records could not be refreshed. Try again.");
      if (snap) {
        const snapErrors = snap.errors;
        const accountsErrored = !!snapErrors?.some((e) => e.table === "accounts");
        if (!accountsErrored) {
          setAccounts(snap.accounts);
        }
        setAssignments(snap.assignments);
        setWorkItems(snap.workItems);
        const upiRes = await upiReq;
        if (upiRes?.ok && Array.isArray(upiRes.upiConfigs)) {
          setUpiConfigs(upiRes.upiConfigs);
        } else {
          setUpiConfigs(snap.upiConfigs ?? []);
        }
        const payoutsRes = await payoutsReq;
        if (payoutsRes?.ok && Array.isArray(payoutsRes.payoutBatches) && !payoutActionsRunning.current.size && payoutVersion.current === payoutVersionAtStart) {
          setPayoutBatchesAdmin(payoutsRes.payoutBatches);
        }

        const workersRes = await workersReq;
        if (workersRes?.ok && Array.isArray(workersRes.workers)) {
          const canOfferSandbox = workersRes.workers.length === 0 && !!workersRes.error && hasDevAdminBypassSession() && !!snap.workers?.length;
          setSandboxWorkers(canOfferSandbox ? snap.workers : []);
          setWorkers(workersRes.workers);
          setWorkerDirectoryError(
            canOfferSandbox
              ? "Live worker directory is unavailable. Check Supabase connectivity, or use local sandbox workers for testing."
              : workersRes.error ?? null
          );
          setSelectedWorkerId((prev) => (workersRes.workers.some((worker) => worker.id === prev) ? prev : workersRes.workers.find(worker => worker.moderationStatus !== "deleted")?.id ?? null));
        } else if (snap.workers?.length) {
          setSandboxWorkers(hasDevAdminBypassSession() ? snap.workers : []);
          setWorkerDirectoryError(
            hasDevAdminBypassSession()
              ? "Live worker directory could not be refreshed. Local sandbox workers are available for testing."
              : "Live worker directory could not be refreshed."
          );
        }
        if (!scheduleLock.current) {
          scheduleLock.current = true;
          // Scheduling must not delay rendering records that have already loaded.
          void fetchWithAuth<{ ok: boolean }>("/api/admin/schedule-work", {
            method: "POST",
            body: JSON.stringify({ schedule: scheduleConfig }),
          });
        }
        return;
      }

      const workersRes = await workersReq;
      if (workersRes?.ok && Array.isArray(workersRes.workers)) {
        setSandboxWorkers([]);
        setWorkers(workersRes.workers);
        setWorkerDirectoryError(workersRes.error ?? null);
        setSelectedWorkerId((prev) => (workersRes.workers.some((worker) => worker.id === prev) ? prev : workersRes.workers.find(worker => worker.moderationStatus !== "deleted")?.id ?? null));
        const upiRes = await upiReq;
        if (upiRes?.ok && Array.isArray(upiRes.upiConfigs)) {
          setUpiConfigs(upiRes.upiConfigs);
        }
        const payoutsRes = await payoutsReq;
        if (payoutsRes?.ok && Array.isArray(payoutsRes.payoutBatches) && !payoutActionsRunning.current.size && payoutVersion.current === payoutVersionAtStart) {
          setPayoutBatchesAdmin(payoutsRes.payoutBatches);
        }
        if (!scheduleLock.current) {
          scheduleLock.current = true;
          void fetchWithAuth<{ ok: boolean }>("/api/admin/schedule-work", {
            method: "POST",
            body: JSON.stringify({ schedule: scheduleConfig }),
          });
        }
        return;
      }
      setWorkerDirectoryError("Live worker directory could not be refreshed.");
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      setToast({ message: "Live admin data unavailable. Check connectivity.", tone: "danger" });
      toastTimerRef.current = window.setTimeout(() => setToast(null), 2400);
    } finally {
      setSnapshotLoaded(true);
      if (typeof window !== "undefined") {
        window.setTimeout(() => {
          refreshLock.current = false;
          if (snapshotRefreshPending.current) {
            snapshotRefreshPending.current = false;
            void refreshSnapshot();
          }
        }, 400);
      } else {
        refreshLock.current = false;
      }
    }
  }, [scheduleConfig]);

  // initial load
  useEffect(() => {
    if (!mounted || isGigSection || activeSection === "Overview") return;
    loadSnapshot();
  }, [mounted, loadSnapshot, today, isGigSection, activeSection]);

  const loadFeedback = useCallback(async () => {
    setFeedbackLoading(true);
    const res = await fetchWithAuth<{ ok: boolean; feedbacks?: AdminFeedbackItem[]; missingSchema?: boolean }>("/api/admin/feedback", {
      method: "GET",
    });

    if (!res?.ok) {
      setFeedbackLoading(false);
      setToast({ message: "Unable to load feedback inbox.", tone: "danger" });
      return;
    }

    const nextItems = Array.isArray(res.feedbacks) ? res.feedbacks : [];
    setFeedbackItems(nextItems);
    setFeedbackSchemaMissing(!!res.missingSchema);
    setSelectedFeedbackId((prev) => (nextItems.some((item) => item.id === prev) ? prev : nextItems[0]?.id ?? null));
    setFeedbackLoading(false);
  }, []);

  // UPI list on its own (cheap), so a creator's new UPI shows up the moment it's saved.
  const upiSeenRef = useRef<Map<string, string> | null>(null);
  const loadUpiConfigs = useCallback(async () => {
    const res = await fetchWithAuth<{ ok: boolean; upiConfigs: UpiConfig[] }>("/api/admin/upi-configs", { method: "GET" });
    if (!res?.ok || !Array.isArray(res.upiConfigs)) return;
    // Announce UPIs that newly need verification (new, or changed to a different ID).
    const previous = upiSeenRef.current;
    const fresh = res.upiConfigs.filter((u) => !u.verified && u.upiId && previous && previous.get(u.workerId) !== u.upiId);
    upiSeenRef.current = new Map(res.upiConfigs.map((u) => [u.workerId, u.upiId]));
    setUpiConfigs(res.upiConfigs);
    if (fresh.length) {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      setToast({
        message: fresh.length === 1 ? `New UPI to verify: ${fresh[0].upiId}${fresh[0].workerCode ? ` (${fresh[0].workerCode})` : ""}` : `${fresh.length} new UPIs to verify`,
        tone: "success",
      });
      toastTimerRef.current = window.setTimeout(() => setToast(null), 5000);
    }
  }, []);
  useEffect(() => {
    if (upiSeenRef.current === null && upiConfigs.length) upiSeenRef.current = new Map(upiConfigs.map((u) => [u.workerId, u.upiId]));
  }, [upiConfigs]);

  const loadPayoutsAdmin = useCallback(async () => {
    if (payoutActionsRunning.current.size) return;
    const version = payoutVersion.current;
    const result = await fetchWithAuth<{ ok: boolean; payoutBatches: AdminPayoutBatch[] }>("/api/admin/payoutbatches");
    if (!payoutActionsRunning.current.size && payoutVersion.current === version && result?.ok) setPayoutBatchesAdmin(result.payoutBatches);
  }, []);

  // REALTIME: the payout tables are server-only (browsers can't subscribe to them), so the server broadcasts a
  // content-free signal on the admin-only "admin:live" topic and we re-read just what changed.
  const devBypass = mounted && hasDevAdminBypassSession();
  const adminLive = useAdminLive(mounted && !devBypass, (kinds: Set<AdminLiveKind> | null) => {
    // Overview's queue owns its refresh. Invalidating here would abort that panel's new read.
    if (activeSection !== "Overview" && (!kinds || kinds.has("upi_configs") || kinds.has("worker_moderation") || kinds.has("worker_deletion_jobs"))) invalidateAdminUpiQueue(adminId);
    if (!kinds || ["linked_social_accounts", "payout_batches", "view_payout_claims"].some(kind => kinds.has(kind as AdminLiveKind))) {
      void refreshOverviewCounts({ afterCurrent: true });
    }
    // Gig tools own their visible data; avoid loading the worker snapshot behind them.
    if (isGigSection || activeSection === "Overview") return;
    if (!kinds) {
      void loadSnapshot();
      if (activeSection === "Feedback") void loadFeedback();
      return;
    }
    if (kinds.has("upi_configs")) void loadUpiConfigs();
    if (kinds.has("payout_batches") || kinds.has("view_payout_claims")) void loadPayoutsAdmin();
    if (kinds.has("work_items") || kinds.has("worker_moderation") || kinds.has("worker_ip_blocks") || kinds.has("worker_deletion_jobs")) void loadSnapshot();
  }, { refreshOnConnect: true });
  // Local dev bypass has no realtime session: poll instead.
  useEffect(() => {
    if (!devBypass) return;
    const intervalId = window.setInterval(() => {
      void loadSnapshot();
      void refreshOverviewCounts({ afterCurrent: true });
      if (activeSection === "Feedback") void loadFeedback();
    }, 5_000);
    return () => window.clearInterval(intervalId);
  }, [activeSection, devBypass, loadFeedback, loadSnapshot, refreshOverviewCounts]);

  const refresh = () => {
    if (activeSection === "Overview") {
      window.dispatchEvent(new Event("admin-overview-refresh"));
      return;
    }
    loadSnapshot();
    void refreshOverviewCounts({ afterCurrent: true });
  };

  const workEmailAdminRequest = useCallback(async (method: "GET" | "POST" | "PATCH" | "DELETE", body?: unknown) => {
    const { headers, authorized } = await getAdminRequestHeaders();
    if (!authorized) {
      return { ok: false as const, error: "Session expired. Please sign in again." };
    }

    const res = await fetch("/api/admin/work-email-codes", {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const parsed = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false as const,
        error: String((parsed as { error?: string })?.error || `Request failed (${res.status})`),
      };
    }
    return { ok: true as const, data: parsed as Record<string, unknown> };
  }, []);

  const loadWorkEmailCodes = useCallback(async () => {
    const res = await workEmailAdminRequest("GET");
    if (!res.ok) {
      setToast({ message: res.error || "Unable to load email access codes.", tone: "danger" });
      return;
    }
    const payload = res.data as { codes?: WorkEmailSecretCode[]; missingSchema?: boolean };
    setWorkEmailCodes(Array.isArray(payload.codes) ? payload.codes : []);
    setWorkEmailSchemaMissing(!!payload.missingSchema);
  }, [workEmailAdminRequest]);

  const loadWorkEmailAccountsAdmin = useCallback(async () => {
    const { headers, authorized } = await getAdminRequestHeaders();
    if (!authorized) return;
    const res = await fetch("/api/admin/work-email-accounts", {
      method: "GET",
      headers,
    });
    const parsed = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      accounts?: WorkEmailManagedAccount[];
      missingSchema?: boolean;
      error?: string;
    };
    if (!res.ok || !parsed.ok) {
      setToast({ message: parsed.error || "Unable to load created work emails.", tone: "danger" });
      return;
    }
    setWorkEmailAccountsAdmin(Array.isArray(parsed.accounts) ? parsed.accounts : []);
    setRevealedSocialPasswords({});
    if (parsed.missingSchema) {
      setWorkEmailSchemaMissing(true);
    }
  }, []);

  const generateWorkEmailCode = useCallback(async () => {
    const payload = {
      label: newCodeLabel.trim() || null,
      maxUses: newCodeMaxUses > 0 ? newCodeMaxUses : null,
      expiresAt: newCodeExpiry || null,
    };
    const res = await workEmailAdminRequest("POST", payload);
    if (!res.ok) {
      setToast({ message: res.error || "Unable to generate code.", tone: "danger" });
      return;
    }
    const data = res.data as { code?: string };
    if (!data.code) {
      setToast({ message: "No code returned by server.", tone: "danger" });
      return;
    }
    setNewlyGeneratedCode(data.code);
    setNewCodeLabel("");
    setNewCodeMaxUses(0);
    setNewCodeExpiry("");
    setToast({ message: "Secret code generated.", tone: "success" });
    loadWorkEmailCodes();
  }, [newCodeLabel, newCodeMaxUses, newCodeExpiry, loadWorkEmailCodes, workEmailAdminRequest]);

  const updateWorkEmailCode = useCallback(
    async (
      id: string,
      action: "block" | "unblock" | "renew" | "reissue",
      opts?: { expiresAt?: string | null; resetUsage?: boolean }
    ): Promise<boolean> => {
      const res = await workEmailAdminRequest("PATCH", { id, action, ...(opts ?? {}) });
      if (!res.ok) {
        setToast({ message: res.error || "Unable to update code.", tone: "danger" });
        return false;
      }
      setToast({
        message:
          action === "block"
            ? "Code blocked."
            : action === "unblock"
            ? "Code activated."
            : action === "reissue"
            ? "Code reissued."
            : "Code renewed.",
        tone: "success",
      });
      loadWorkEmailCodes();
      return true;
    },
    [loadWorkEmailCodes, workEmailAdminRequest]
  );

  const copyFullWorkEmailCode = useCallback(
    async (row: WorkEmailSecretCode) => {
      const res = await workEmailAdminRequest("PATCH", { id: row.id, action: "reissue" });
      if (!res.ok) {
        setToast({ message: res.error || "Unable to copy full code.", tone: "danger" });
        return;
      }
      const fullCode = String((res.data as { code?: string })?.code || "");
      if (!fullCode) {
        setToast({ message: "Server did not return full code.", tone: "danger" });
        return;
      }
      try {
        await navigator.clipboard.writeText(fullCode);
      } catch {
        setToast({ message: "Unable to copy full code.", tone: "danger" });
        return;
      }
      setCopiedCode(fullCode);
      window.setTimeout(() => {
        setCopiedCode((prev) => (prev === fullCode ? null : prev));
      }, 1400);
      setCopiedCodeRowId(row.id);
      window.setTimeout(() => {
        setCopiedCodeRowId((prev) => (prev === row.id ? null : prev));
      }, 1400);
      setToast({ message: "Full code copied. Existing code was reissued.", tone: "success" });
      loadWorkEmailCodes();
    },
    [loadWorkEmailCodes, workEmailAdminRequest]
  );

  const renewWorkEmailCode = useCallback(
    (row: WorkEmailSecretCode) => {
      setRenewCodeTarget(row);
      setRenewExpiry(isoToLocalInput(row.expires_at));
      setRenewResetUsage(false);
      setRenewModalOpen(true);
    },
    []
  );

  const submitRenewCode = useCallback(async () => {
    if (!renewCodeTarget) return;
    setRenewSaving(true);
    try {
      const ok = await updateWorkEmailCode(renewCodeTarget.id, "renew", {
        expiresAt: renewExpiry.trim() || null,
        resetUsage: renewResetUsage,
      });
      if (ok) {
        setRenewModalOpen(false);
        setRenewCodeTarget(null);
      }
    } finally {
      setRenewSaving(false);
    }
  }, [renewCodeTarget, renewExpiry, renewResetUsage, updateWorkEmailCode]);

  const deleteWorkEmailCode = useCallback(
    async (id: string) => {
      const confirmed = window.confirm("Delete this secret code permanently?");
      if (!confirmed) return;
      const res = await workEmailAdminRequest("DELETE", { id });
      if (!res.ok) {
        setToast({ message: res.error || "Unable to delete code.", tone: "danger" });
        return;
      }
      setToast({ message: "Code deleted.", tone: "success" });
      loadWorkEmailCodes();
    },
    [loadWorkEmailCodes, workEmailAdminRequest]
  );

  useEffect(() => {
    if (activeSection === "Email Access") {
      void loadWorkEmailCodes();
      void loadWorkEmailAccountsAdmin();
    }
    if (activeSection === "Feedback") {
      void loadFeedback();
    }
  }, [activeSection, loadFeedback, loadWorkEmailCodes, loadWorkEmailAccountsAdmin]);

  const saveFeedbackUpdate = useCallback(async () => {
    if (!selectedFeedbackId) return;
    setFeedbackSaving(true);
    const res = await fetchWithAuth<{ ok: boolean; feedback?: AdminFeedbackItem }>("/api/admin/feedback", {
      method: "PATCH",
      body: JSON.stringify({
        id: selectedFeedbackId,
        status: feedbackStatusDraft,
        adminNote: feedbackNoteDraft,
      }),
    });

    if (!res?.ok || !res.feedback) {
      setFeedbackSaving(false);
      setToast({ message: "Unable to save feedback update.", tone: "danger" });
      return;
    }

    setFeedbackItems((prev) => prev.map((item) => (item.id === res.feedback?.id ? res.feedback : item)));
    setSelectedFeedbackId(res.feedback.id);
    setFeedbackSaving(false);
    setToast({ message: "Feedback updated.", tone: "success" });
  }, [feedbackNoteDraft, feedbackStatusDraft, selectedFeedbackId]);

  const visibleWorkEmailAccountsAdmin = useMemo(() => {
    const q = workEmailAccountQuery.trim().toLowerCase();
    if (!q) return workEmailAccountsAdmin;
    return workEmailAccountsAdmin.filter((row) => {
      const owner = `${row.ownerDisplayName || ""} ${row.ownerWorkerCode || ""} ${row.ownerUserId}`.toLowerCase();
      return (
        row.email.toLowerCase().includes(q) ||
        row.username.toLowerCase().includes(q) ||
        row.platform.toLowerCase().includes(q) ||
        owner.includes(q)
      );
    });
  }, [workEmailAccountsAdmin, workEmailAccountQuery]);

  const feedbackStats = useMemo(
    () =>
      feedbackItems.reduce(
        (sum, item) => {
          sum.total += 1;
          sum[item.status] += 1;
          return sum;
        },
        { total: 0, new: 0, reviewing: 0, resolved: 0, closed: 0 } as Record<"total" | AdminFeedbackStatus, number>
      ),
    [feedbackItems]
  );

  const visibleFeedbackItems = useMemo(() => {
    const query = feedbackSearch.trim().toLowerCase();
    return feedbackItems.filter((item) => {
      if (feedbackFilter !== "all" && item.status !== feedbackFilter) return false;
      if (!query) return true;
      const haystack = [
        item.profile_name,
        item.worker_id,
        item.profile_role,
        item.section,
        item.category,
        item.subject,
        item.message,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [feedbackFilter, feedbackItems, feedbackSearch]);

  const selectedFeedback = useMemo(
    () => (selectedFeedbackId ? feedbackItems.find((item) => item.id === selectedFeedbackId) ?? null : feedbackItems[0] ?? null),
    [feedbackItems, selectedFeedbackId]
  );

  useEffect(() => {
    if (!selectedFeedback) {
      setFeedbackStatusDraft("new");
      setFeedbackNoteDraft("");
      return;
    }
    setFeedbackStatusDraft(selectedFeedback.status);
    setFeedbackNoteDraft(selectedFeedback.admin_note ?? "");
  }, [selectedFeedback]);

  const selectedFeedbackMeta = useMemo<Record<string, unknown>>(() => {
    if (!selectedFeedback?.meta || typeof selectedFeedback.meta !== "object" || Array.isArray(selectedFeedback.meta)) {
      return {};
    }
    return selectedFeedback.meta;
  }, [selectedFeedback]);

  const revealSocialPassword = useCallback(async (id: string) => {
    const existing = revealedSocialPasswords[id];
    if (existing !== undefined) {
      setRevealedSocialPasswords((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
      return;
    }
    const { headers, authorized } = await getAdminRequestHeaders();
    if (!authorized) {
      setToast({ message: "Session expired. Please sign in again.", tone: "danger" });
      return;
    }
    setRevealingPasswordFor(id);
    try {
      const res = await fetch("/api/admin/work-email-accounts/reveal", {
        method: "POST",
        headers,
        body: JSON.stringify({ id }),
      });
      const parsed = (await res.json().catch(() => ({}))) as { ok?: boolean; password?: string; error?: string };
      if (!res.ok || !parsed.ok) {
        setToast({ message: parsed.error || "Unable to reveal password.", tone: "danger" });
        return;
      }
      setRevealedSocialPasswords((prev) => ({ ...prev, [id]: String(parsed.password ?? "") }));
    } finally {
      setRevealingPasswordFor(null);
    }
  }, [revealedSocialPasswords]);

  const copySecretCode = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedCode(value);
      window.setTimeout(() => {
        setCopiedCode((prev) => (prev === value ? null : prev));
      }, 1400);
    } catch {
      setToast({ message: "Unable to copy code.", tone: "danger" });
    }
  }, []);

  const workEmailCodeStats = useMemo(() => {
    const now = Date.now();
    let active = 0;
    let blocked = 0;
    let expired = 0;
    let exhausted = 0;
    for (const row of workEmailCodes) {
      const isExpired = !!row.expires_at && Date.parse(row.expires_at) <= now;
      const isExhausted = !!row.max_uses && row.max_uses > 0 && row.use_count >= row.max_uses;
      if (row.status === "active") active += 1;
      if (row.status === "blocked") blocked += 1;
      if (isExpired) expired += 1;
      if (isExhausted) exhausted += 1;
    }
    return { total: workEmailCodes.length, active, blocked, expired, exhausted };
  }, [workEmailCodes]);

  const visibleWorkEmailCodes = useMemo(() => {
    const now = Date.now();
    const query = codeQuery.trim().toLowerCase();
    const rows = workEmailCodes
      .map((row) => {
        const expiresAtMs = row.expires_at ? Date.parse(row.expires_at) : null;
        const isExpired = typeof expiresAtMs === "number" && Number.isFinite(expiresAtMs) ? expiresAtMs <= now : false;
        const isExhausted = !!row.max_uses && row.max_uses > 0 && row.use_count >= row.max_uses;
        const usagePct = row.max_uses && row.max_uses > 0 ? Math.min(100, Math.round((row.use_count / row.max_uses) * 100)) : null;
        return {
          ...row,
          isExpired,
          isExhausted,
          usagePct,
        };
      })
      .filter((row) => {
        if (!query) return true;
        const label = String(row.label ?? "").toLowerCase();
        return row.code_hint.toLowerCase().includes(query) || label.includes(query);
      })
      .filter((row) => {
        if (codeFilter === "all") return true;
        if (codeFilter === "active") return row.status === "active" && !row.isExpired && !row.isExhausted;
        if (codeFilter === "blocked") return row.status === "blocked";
        if (codeFilter === "expired") return row.isExpired;
        if (codeFilter === "exhausted") return row.isExhausted;
        return true;
      });

    rows.sort((a, b) => {
      if (codeSort === "oldest") return Date.parse(a.created_at) - Date.parse(b.created_at);
      if (codeSort === "usage-desc") {
        const aScore = a.usagePct ?? a.use_count;
        const bScore = b.usagePct ?? b.use_count;
        return bScore - aScore;
      }
      if (codeSort === "expiry-soon") {
        const aExp = a.expires_at ? Date.parse(a.expires_at) : Number.MAX_SAFE_INTEGER;
        const bExp = b.expires_at ? Date.parse(b.expires_at) : Number.MAX_SAFE_INTEGER;
        return aExp - bExp;
      }
      return Date.parse(b.created_at) - Date.parse(a.created_at);
    });
    return rows;
  }, [workEmailCodes, codeQuery, codeFilter, codeSort]);

  const workerById = useMemo(() => {
    const m = new Map(workers.map((w) => [w.id, w]));
    return (id: string) => m.get(id);
  }, [workers]);

  const accountById = useMemo(() => {
    const m = new Map(accounts.map((a) => [a.id, a]));
    return (id: string) => m.get(id);
  }, [accounts]);

  const accountsForWorker = useMemo(() => {
    const idByUserId = new Map<string, string>();
    workers.forEach((w) => {
      if (w.userId) idByUserId.set(w.userId, w.id);
    });
    const map = new Map<string, string[]>();
    assignments.forEach((as) => {
      const key = idByUserId.get(as.workerId) ?? as.workerId;
      const arr = map.get(key) ?? [];
      arr.push(as.accountId);
      map.set(key, arr);
    });
    return (workerId: string) => map.get(workerId) ?? [];
  }, [assignments, workers]);

  const globallyAssignedIds = useMemo(() => {
    const ids = new Set<string>();
    workers.forEach((w) => {
      accountsForWorker(w.id).forEach((aid) => ids.add(aid));
    });
    return ids;
  }, [workers, accountsForWorker]);

  const selectedWorker = useMemo(() => (selectedWorkerId ? workerById(selectedWorkerId) : null), [selectedWorkerId, workerById]);

  useEffect(() => {
    if (!selectedWorker) return;
    setWorkerTimezoneDraft(selectedWorker.timezone ?? scheduleConfig.timezone ?? "Asia/Kolkata");
  }, [selectedWorker, scheduleConfig.timezone]);


  const isCountedSubmission = useCallback(
    (item: WorkItem) =>
      !!item.submission?.submittedAt && item.review?.decision !== "Needs fix" && item.review?.decision !== "Hard rejected",
    []
  );

  const isWorkerMatch = useCallback(
    (worker: Worker, item: WorkItem) => item.workerId === worker.id || (!!worker.userId && item.workerId === worker.userId),
    []
  );

  const upiByWorkerId = useMemo(() => {
    const map = new Map<string, UpiConfig>();
    upiConfigs.forEach((cfg) => {
      if (cfg.workerId) map.set(cfg.workerId, cfg);
      if (cfg.workerCode) map.set(cfg.workerCode, cfg);
    });
    return map;
  }, [upiConfigs]);

  const getWorkerUpi = useCallback(
    (worker: Worker) => upiByWorkerId.get(worker.userId ?? "") ?? upiByWorkerId.get(worker.id) ?? null,
    [upiByWorkerId]
  );

  const getBatchUpi = useCallback(
    (batch: AdminPayoutBatch) => upiByWorkerId.get(batch.workerId) ?? (batch.workerCode ? upiByWorkerId.get(batch.workerCode) : null),
    [upiByWorkerId]
  );

  const getWorkerApprovedEarnings = useCallback(
    (worker: Worker) =>
      workItems.filter((it) => isWorkerMatch(worker, it) && it.status === "Approved").reduce((sum, it) => sum + it.rewardINR, 0),
    [workItems, isWorkerMatch]
  );

  const payoutStatusTone = useCallback(
    (s: string) => (s === "Paid" ? "success" : s === "Processing" ? "info" : s === "Failed" ? "danger" : "warn"),
    []
  );

  const payoutTotals = useCallback((b: AdminPayoutBatch) => b.items.reduce((sum, it) => sum + (it.amountINR || 0), 0), []);

  const getPayoutEta = useCallback((b: AdminPayoutBatch) => {
    const notes = Array.isArray(b.notes) ? b.notes : [];
    const hit = notes.find((n) => String(n).startsWith("ETA:"));
    return hit ? String(hit).slice("ETA:".length) : undefined;
  }, []);

  const isResubmission = useCallback((item: WorkItem) => {
    if (!item.submission?.submittedAt) return false;
    const decision = item.review?.decision;
    return decision === "Needs fix" || decision === "Hard rejected";
  }, []);

  /** ---------- Admin actions ---------- */


  const assignAccount = async (workerId: string, accountId: string, scheduleOverride?: AssignmentSchedule) => {
    const workerUuid = workerById(workerId)?.userId;
    // optimistic
    setAssignments((prev) => {
      const exists = prev.some(
        (a) =>
          a.accountId === accountId &&
          (a.workerId === workerId || (workerUuid && a.workerId === workerUuid))
      );
      if (exists) {
        return prev.map((a) =>
          a.accountId === accountId && (a.workerId === workerId || (workerUuid && a.workerId === workerUuid)) && scheduleOverride
            ? { ...a, schedule: scheduleOverride }
            : a
        );
      }
      return [...prev, { workerId, accountId, schedule: scheduleOverride }];
    });
    const res = await fetchWithAuth<{ ok: boolean }>(`/api/admin/assign-account`, {
      method: "POST",
      body: JSON.stringify({
        workerId,
        accountId,
        schedule: scheduleOverride?.times?.length
          ? {
              times: scheduleOverride.times,
              days: scheduleOverride.days,
              deadlineMin: scheduleOverride.deadlineMin,
              timezone: scheduleOverride.timezone,
            }
          : {
              times: scheduleConfig.times,
              days: scheduleConfig.days,
              deadlineMin: scheduleConfig.deadlineMin,
              timezone: scheduleConfig.timezone,
            },
        reschedule: true,
      }),
    });
    if (!res?.ok) {
      // revert
      setAssignments((prev) => prev.filter((a) => !(a.workerId === workerId && a.accountId === accountId)));
    }
  };

  const openEditSchedule = (workerId: string, accountId: string) => {
    setEditScheduleWorkerId(workerId);
    setEditScheduleAccountId(accountId);
    const existing = assignments.find((a) => a.workerId === workerId && a.accountId === accountId)?.schedule;
    setEditScheduleTimesCsv((existing?.times ?? scheduleConfig.times).join(", "));
    setEditScheduleDays(existing?.days ?? scheduleConfig.days);
    setEditScheduleDeadlineMin(existing?.deadlineMin ?? scheduleConfig.deadlineMin);
    const workerTz = workerById(workerId)?.timezone ?? scheduleConfig.timezone;
    setEditScheduleTimezone(existing?.timezone ?? workerTz ?? "Asia/Kolkata");
    setEditScheduleOpen(true);
  };

  const saveEditSchedule = async () => {
    if (!editScheduleWorkerId || !editScheduleAccountId) return;
    const schedule: AssignmentSchedule = {
      times: normalizeTimesCsv(editScheduleTimesCsv),
      days: normalizeDays(editScheduleDays),
      deadlineMin: Math.max(60, Math.min(720, Number(editScheduleDeadlineMin) || 180)),
      timezone: editScheduleTimezone,
    };
    await assignAccount(editScheduleWorkerId, editScheduleAccountId, schedule);
    setEditScheduleOpen(false);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast({ message: "Schedule saved", tone: "success" });
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2400);
  };

  const removeAssignment = async (workerId: string, accountId: string) => {
    const workerUuid = workerById(workerId)?.userId;
    // optimistic
    const before = assignments;
    setAssignments((prev) =>
      prev.filter((a) => {
        if (a.accountId !== accountId) return true;
        if (a.workerId === workerId) return false;
        if (workerUuid && a.workerId === workerUuid) return false;
        return true;
      })
    );
    const res = await fetchWithAuth<{ ok: boolean }>(`/api/admin/remove-assignment`, {
      method: "POST",
      body: JSON.stringify({ workerId, accountId }),
    });
    if (!res?.ok) {
      // revert
      setAssignments(before);
    }
  };

  const deleteAccount = async (accountId: string) => {
    const ok = window.confirm("Permanently delete this account and remove all assignments?");
    if (!ok) return;
    const prevAccounts = accounts;
    const prevAssignments = assignments;
    setAccounts((prev) => prev.filter((a) => a.id !== accountId));
    setAssignments((prev) => prev.filter((a) => a.accountId !== accountId));
    const res = await fetchWithAuth<{ ok: boolean; error?: string }>(`/api/admin/delete-account`, {
      method: "POST",
      body: JSON.stringify({ accountId }),
    });
    if (!res?.ok) {
      setAccounts(prevAccounts);
      setAssignments(prevAssignments);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      setToast({ message: res?.error || "Delete failed", tone: "danger" });
      toastTimerRef.current = window.setTimeout(() => setToast(null), 2400);
      return;
    }
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast({ message: "Account deleted", tone: "success" });
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2400);
    loadSnapshot();
  };

  const submitPayoutAction = useCallback(async (batchId: string, action: "approve" | "reject" | "mark-paid", body: Record<string, string>) => {
    if (payoutActionsRunning.current.has(batchId)) return;
    payoutActionsRunning.current.add(batchId);
    payoutVersion.current++;
    setBusyPayouts(new Set(payoutActionsRunning.current));
    try {
      const { headers, authorized } = await getAdminRequestHeaders();
      if (!authorized) throw new Error("Sign in again to update this payout.");
      headers.set("Content-Type", "application/json");
      const response = await fetch(`/api/admin/payoutbatches/${encodeURIComponent(batchId)}/${action}`, {
        method: "PATCH", headers, body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) throw new Error(result?.error || "Payout update failed. Please refresh and retry.");
      const status = action === "approve" ? "Processing" : action === "reject" ? "Failed" : "Paid";
      setPayoutBatchesAdmin((previous) => previous.map((batch) => batch.id === batchId ? {
        ...batch, status, processedAt: result.batch?.processed_at ?? batch.processedAt, paidAt: result.batch?.paid_at ?? batch.paidAt,
        notes: Array.isArray(result.batch?.notes) ? result.batch.notes : batch.notes,
        items: batch.items.map((item) => ({ ...item, ...(action !== "approve" ? { status: action === "reject" ? "Failed" : "Paid" } : {}) })),
      } : batch));
      setToast({ message: action === "approve" ? "Payout approved for processing" : action === "reject" ? "Payout rejected and removed from requests" : "Payout recorded as paid", tone: "success" });
      void refreshOverviewCounts({ afterCurrent: true });
      await loadSnapshot();
    } catch (error) {
      setToast({ message: error instanceof Error ? error.message : "Payout update failed", tone: "danger" });
      await loadSnapshot();
    } finally {
      payoutActionsRunning.current.delete(batchId);
      payoutVersion.current++;
      setBusyPayouts(new Set(payoutActionsRunning.current));
    }
  }, [loadSnapshot, refreshOverviewCounts]);

  const approvePayout = useCallback(async (batchId: string) => {
    const batch = payoutBatchesAdmin.find((b) => b.id === batchId);
    if (batch?.status !== "Draft" || payoutActionsRunning.current.has(batchId)) return;
    const upi = getBatchUpi(batch);
    const days = upi?.payoutSchedule === "Monthly" ? 30 : upi?.payoutSchedule === "Bi-weekly" ? 14 : 7;
    const defaultEta = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
    const entered = window.prompt("Estimated payout date (YYYY-MM-DD)?", defaultEta);
    if (entered === null) return;
    await submitPayoutAction(batchId, "approve", { etaDate: entered.trim() || defaultEta });
  }, [payoutBatchesAdmin, getBatchUpi, submitPayoutAction]);

  const rejectPayout = useCallback(async (batchId: string) => {
    const batch = payoutBatchesAdmin.find((b) => b.id === batchId);
    if (!batch || !["Draft", "Processing"].includes(batch.status) || payoutActionsRunning.current.has(batchId)) return;
    const reason = window.prompt("Reason for rejection?", "Rejected by Admin");
    if (reason === null) return;
    await submitPayoutAction(batchId, "reject", { reason: reason.trim() || "Rejected by Admin" });
  }, [payoutBatchesAdmin, submitPayoutAction]);

  const verifyWorkerUpi = useCallback(async (upi: UpiConfig) => {
    const res = await fetchWithAuth<{ ok: boolean; error?: string }>("/api/admin/upi-configs", {
      method: "PATCH", body: JSON.stringify({ workerId: upi.workerId, upiId: upi.upiId, verified: true }),
    });
    if (res?.ok) {
      invalidateAdminUpiQueue(adminId);
      setUpiConfigs((prev) => prev.map((u) => (u.workerId === upi.workerId && u.upiId === upi.upiId ? { ...u, verified: true, verifiedAt: new Date().toISOString() } : u)));
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      setToast({ message: `UPI ${upi.upiId} verified. The creator sees it instantly.`, tone: "success" });
      toastTimerRef.current = window.setTimeout(() => setToast(null), 3000);
      void loadUpiConfigs();
    } else setToast({ message: res?.error || "UPI verification failed", tone: "danger" });
  }, [adminId, loadUpiConfigs]);

  const markPayoutPaid = useCallback(async (batchId: string) => {
    const batch = payoutBatchesAdmin.find((b) => b.id === batchId);
    if (batch?.status !== "Processing" || payoutActionsRunning.current.has(batchId)) return;
    const paymentReference = window.prompt("Payment transaction reference (UTR)")?.trim();
    if (!paymentReference) return;
    await submitPayoutAction(batchId, "mark-paid", { paymentReference });
  }, [payoutBatchesAdmin, submitPayoutAction]);

  const createAccount = async () => {
    const id = newAccountId.trim();
    const handle = normHandle(newAccountHandle);
    const niche = newAccountNiche.trim();
    const ownerTeam = newAccountOwnerTeam.trim();
    if (!id || !handle || !niche || !ownerTeam) return;
    const acc: AssignedAccount = {
      id,
      handle,
      niche,
      ownerTeam,
      policyTier: newAccountPolicy,
      health: newAccountHealth,
      rules: splitCsvToList(newAccountRulesCsv),
      allowedAudios: splitCsvToList(newAccountAudiosCsv),
      requiredHashtags: splitCsvToList(newAccountHashtagsCsv).map((h) => (h.startsWith("#") ? h : `#${h}`)),
    };
    // optimistic
    setAccounts((prev) => [acc, ...prev]);
    setCreateAccountOpen(false);
    const res = await fetchWithAuth<{ ok: boolean; account?: AssignedAccount }>(`/api/admin/create-account`, {
      method: "POST",
      body: JSON.stringify(acc),
    });
    if (!res?.ok) {
      // revert if server rejected
      setAccounts((prev) => prev.filter((a) => a.id !== id));
    } else if (res.account) {
      // normalize server version
      setAccounts((prev) => [res.account!, ...prev.filter((a) => a.id !== res.account!.id)]);
    }
  };

  const openCreateWork = (prefillWorkerId?: string) => {
    const preferred = prefillWorkerId ?? selectedWorkerId;
    const wid = assignableWorkers.find(worker => worker.id === preferred)?.id ?? assignableWorkers[0]?.id ?? "";
    setCreateWorkWorkerId(wid);
    const firstAcc = accountsForWorker(wid)[0] ?? accounts[0]?.id ?? "";
    setCreateWorkAccountId(firstAcc);
    setCreateWorkType("Reel posting");
    setCreateWorkTitle("");
    setCreateWorkPriority("P1");
    setCreateWorkReward(5);
    setCreateWorkEst(12);
    setCreateWorkSla(30);
    setCreateWorkDueHHMM("18:00");
    setCreateWorkOpen(true);
  };

  const createWork = async () => {
    const wid = createWorkWorkerId.trim();
    const aid = createWorkAccountId.trim();
    if (!assignableWorkers.some(worker => worker.id === wid) || !aid || !createWorkTitle.trim()) return;
    const newId = `WI-${Math.floor(1000 + Math.random() * 9000)}`;
    const dueAt = `${today}T${createWorkDueHHMM}`;
    const acc = accountById(aid);
    const strict = acc?.policyTier === "Strict";
    const item: WorkItem = {
      id: newId,
      workerId: wid,
      accountId: aid,
      title: createWorkTitle.trim(),
      type: createWorkType,
      createdAt: today,
      dueAt,
      status: "Open",
      priority: createWorkPriority,
      rewardINR: Math.max(0, Number(createWorkReward) || 0),
      estMinutes: Math.max(1, Number(createWorkEst) || 10),
      slaMinutes: Math.max(5, Number(createWorkSla) || 30),
      gates: {
        captionTemplate: true,
        approvedAudio: strict ? false : true,
        hashtagsOk: true,
        noRestricted: true,
        proofAttached: false,
      },
      audit: [{ at: nowStamp(), by: "Admin", text: `Created work item for ${workerById(wid)?.name ?? wid}.` }],
    };
    setWorkItems((prev) => [item, ...prev]);
    setCreateWorkOpen(false);
    const res = await fetchWithAuth<{ ok: boolean; error?: string }>(`/api/admin/create-work`, {
      method: "POST",
      body: JSON.stringify({
        id: newId,
        workerId: wid,
        accountId: aid,
        title: createWorkTitle.trim(),
        type: createWorkType,
        dueAt,
        priority: createWorkPriority,
        rewardINR: item.rewardINR,
        estMinutes: item.estMinutes,
        slaMinutes: item.slaMinutes,
        gates: item.gates,
      }),
    });
    if (!res?.ok) {
      setWorkItems((prev) => prev.filter((x) => x.id !== newId));
    }
  };

  const backfillAccounts = async () => {
    const res = await fetchWithAuth<{ ok: boolean; updated?: number; error?: string }>(`/api/admin/backfill-accounts`, {
      method: "POST",
    });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    if (!res?.ok) {
      setToast({ message: res?.error || "Account backfill failed", tone: "danger" });
    } else {
      setToast({ message: `Account backfill complete (${res.updated ?? 0} updated)`, tone: "success" });
      loadSnapshot();
    }
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2400);
  };





  // Create worker (Supabase Auth + profile)
  const openCreateWorker = () => {
    const nextNum = workers.length + 1;
    const suggested = `WKR-${String(nextNum).padStart(3, "0")}`;
    setNewWorkerId(suggested);
    setNewWorkerName("");
    setNewWorkerEmail("");
    setNewWorkerPassword("");
    setNewWorkerActive(true);
    setCreateWorkerOpen(true);
  };

  const createWorker = async () => {
    const id = newWorkerId.trim();
    const name = newWorkerName.trim();
    const email = newWorkerEmail.trim();
    const password = newWorkerPassword;
    if (!id || !name || !email || password.length < 12) return;

    const res = await fetchWithAuth<{ ok: boolean; worker: Worker }>(`/api/admin/create-worker`, {
      method: "POST",
      body: JSON.stringify({ workerId: id, name, email, password, active: !!newWorkerActive }),
    });
    if (!res?.ok) return;
    setWorkers((prev) => [res.worker, ...prev]);
    setSelectedWorkerId(res.worker.id);
    setWorkerDetailOpen(true);
    setActiveSection("Workers");
    setCreateWorkerOpen(false);
  };

  // Create account
  const openCreateAccount = () => {
    const nextNum = accounts.length + 1;
    const suggested = `acc_${nextNum}`;
    setNewAccountId(suggested);
    setNewAccountHandle("");
    setNewAccountNiche("");
    setNewAccountOwnerTeam("");
    setNewAccountPolicy("Standard");
    setNewAccountHealth("Healthy");
    setNewAccountRulesCsv("Use caption template, No politics/religion");
    setNewAccountAudiosCsv("Calm Beat #2, Soft Pop #3");
    setNewAccountHashtagsCsv("#brand, #reels");
    setCreateAccountOpen(true);
  };

  /** ---------- Filters ---------- */

  const workerDirectoryRows = useMemo(() => workers.map(worker => {
    const upi = getWorkerUpi(worker);
    return {
      ...worker,
      accountCount: accountsForWorker(worker.id).length,
      submittedCount: workItems.filter(item => isWorkerMatch(worker, item) && isCountedSubmission(item)).length,
      resubmitCount: workItems.filter(item => isWorkerMatch(worker, item) && isResubmission(item)).length,
      approvedINR: getWorkerApprovedEarnings(worker),
      upiId: upi?.upiId,
      upiVerified: upi?.verified === true,
    };
  }), [workers, getWorkerUpi, accountsForWorker, workItems, isWorkerMatch, isCountedSubmission, isResubmission, getWorkerApprovedEarnings]);
  const selectedDirectoryWorker = workerDirectoryRows.find(worker => worker.id === selectedWorkerId);

  const scheduleRowsForSelected = useMemo(() => {
    if (!selectedWorkerId) return [];
    const today = new Date();
    const rows = new Map<string, { time: string; timezone: string; accounts: AssignedAccount[] }>();

    const workerAssignments = assignments.filter((a) => a.workerId === selectedWorkerId);
    for (const asg of workerAssignments) {
      const schedule = asg.schedule ?? scheduleConfig;
      const times = schedule.times?.length ? schedule.times : scheduleConfig.times;
      const timezone = schedule.timezone ?? scheduleConfig.timezone;
      const days = schedule.days?.length ? schedule.days : scheduleConfig.days;
      const dow = dayOfWeekInTz(today, timezone);
      if (!days.includes(dow)) continue;
      for (const time of times) {
        const key = `${timezone}::${time}`;
        const acc = accountById(asg.accountId);
        if (!acc) continue;
        if (!rows.has(key)) {
          rows.set(key, { time, timezone, accounts: [acc] });
        } else {
          rows.get(key)!.accounts.push(acc);
        }
      }
    }
    return Array.from(rows.values()).sort((a, b) => (a.time < b.time ? -1 : 1));
  }, [selectedWorkerId, assignments, scheduleConfig, accountById]);

  const weeklyScheduleGrid = useMemo(() => {
    if (!selectedWorkerId) return [];
    const rows = new Map<string, { time: string; timezone: string; days: Record<number, AssignedAccount[]> }>();
    const workerAssignments = assignments.filter((a) => a.workerId === selectedWorkerId);
    for (const asg of workerAssignments) {
      const schedule = asg.schedule ?? scheduleConfig;
      const times = schedule.times?.length ? schedule.times : scheduleConfig.times;
      const timezone = schedule.timezone ?? scheduleConfig.timezone;
      const days = schedule.days?.length ? schedule.days : scheduleConfig.days;
      const acc = accountById(asg.accountId);
      if (!acc) continue;
      for (const time of times) {
        const key = `${timezone}::${time}`;
        if (!rows.has(key)) {
          rows.set(key, { time, timezone, days: { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] } });
        }
        const row = rows.get(key)!;
        for (const day of days) {
          row.days[day].push(acc);
        }
      }
    }
    return Array.from(rows.values()).sort((a, b) => (a.time < b.time ? -1 : 1));
  }, [selectedWorkerId, assignments, scheduleConfig, accountById]);

  /** ---------- Render (UI unchanged) ---------- */
  const adminSectionCounts: Partial<Record<AdminSection, number>> = {
    ...gigSectionCounts,
    Feedback: feedbackItems.filter((item) => item.status === "new").length,
    ...(overview.data ? { Payouts: overview.data.pendingPayouts } : {}),
  };
  const adminNavItems = ADMIN_NAV_GROUPS.flatMap((group) => group.items);
  const activeSectionLabel = adminNavItems.find((item) => item.id === activeSection)?.label ?? activeSection;
  const isWorkerSection = activeSection === "Workers";

  return (
    <div className="ops-dashboard-skin min-h-screen">
      <a href="#admin-main" className="sr-only z-[90] rounded-lg bg-[#1f2b24] px-4 py-3 font-semibold text-white focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to content</a>
      {/* Mobile nav drawer */}
      {mobileNavOpen && (
        <AdminNavigationDrawer onClose={closeNavigation}>
            <AdminSidebar
              active={activeSection}
              counts={adminSectionCounts}
              onClose={closeNavigation}
              onPick={setActiveSection}
              onLogout={logout}
            />
        </AdminNavigationDrawer>
      )}

      <div className="flex min-h-screen" inert={mobileNavOpen || undefined}>
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 border-r border-[#e3e5e1] lg:block 2xl:w-[264px]">
          <AdminSidebar active={activeSection} onPick={setActiveSection} onLogout={logout} counts={adminSectionCounts} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top bar */}
          <header className="sticky top-0 z-40 border-b border-[#e3e5e1] bg-white/92 backdrop-blur-md">
            <div className="flex h-[60px] items-center gap-2 px-3.5 sm:gap-3 sm:px-5 lg:h-[64px] lg:px-6">
              <button
                type="button"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[#1a201c] transition hover:bg-[#eceeea] lg:hidden"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open navigation"
                aria-expanded={mobileNavOpen}
                aria-controls="admin-navigation-drawer"
              >
                <Icon name="hamburger" />
              </button>
              <div className="min-w-0 shrink-0">
                <div className="hidden text-[11px] font-semibold text-[#7a827c] sm:block">Admin console</div>
                <h1 className="truncate text-[16px] font-semibold text-[#1a201c] lg:text-[18px]">{activeSectionLabel}</h1>
              </div>

              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                {!devBypass ? (
                  <span
                    className={`hidden h-7 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-semibold sm:inline-flex ${
                      adminLive === "live" ? "bg-[#ebf5ee] text-[#226b40]" : adminLive === "offline" ? "bg-[#fff6e5] text-[#9a5b00]" : "bg-[#f1f3f0] text-[#7a827c]"
                    }`}
                    title={adminLive === "live" ? "UPI, KYC, payouts and claims update instantly" : adminLive === "offline" ? "Live updates unavailable; refreshing every 15 seconds" : "Connecting to live updates"}
                    aria-live="polite"
                  >
                    <span className="relative flex h-2 w-2" aria-hidden>
                      {adminLive === "live" ? <span className="absolute inline-flex h-full w-full rounded-full bg-[#4caf6e] opacity-60 motion-safe:animate-ping" /> : null}
                      <span className={`relative inline-flex h-2 w-2 rounded-full ${adminLive === "live" ? "bg-[#2e7d4f]" : adminLive === "offline" ? "bg-[#e29a1b]" : "bg-[#b9c0ba]"}`} />
                    </span>
                    {adminLive === "live" ? "Live" : adminLive === "offline" ? "Auto-refresh" : "Connecting"}
                  </span>
                ) : null}

                <button
                  type="button"
                  onClick={() => {
                    if (isGigSection) window.dispatchEvent(new CustomEvent("admin-refresh"));
                    else refresh();
                  }}
                  title="Refresh data"
                  aria-label="Refresh data"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#4b544e] transition hover:bg-[#f1f3f0] hover:text-[#1a201c] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40"
                >
                  <Icon name="refresh" className="h-[18px] w-[18px]" />
                </button>
                {!isGigSection && !isWorkerSection && activeSection !== "Overview" && <Button variant="secondary" onClick={openCreateWorker} title="Create worker" className="px-2.5 sm:px-3.5">
                  <Icon name="plus" className="h-4 w-4" />
                  <span className="hidden sm:inline">Worker</span>
                </Button>}
                {!isGigSection && !isWorkerSection && activeSection !== "Overview" && <Button variant="primary" onClick={openCreateAccount} title="Create account" className="px-2.5 sm:px-3.5">
                  <Icon name="plus" className="h-4 w-4" />
                  <span className="hidden sm:inline">Account</span>
                </Button>}
                {isGigSection && activeSection !== "create-new-gig" && (
                  <Button variant="primary" onClick={() => setActiveSection("create-new-gig")} title="Create gig" className="px-2.5 sm:px-3.5">
                    <Icon name="plus" className="h-4 w-4" />
                    <span className="hidden min-[400px]:inline">Create gig</span>
                  </Button>
                )}
              </div>
            </div>

          </header>

      {toast && (
        <div role="status" className="fixed inset-x-3 bottom-4 z-[80] rounded-xl border border-[#e3e5e1] bg-white px-4 py-3 text-[13.5px] font-semibold text-[#1a201c] shadow-lg sm:inset-x-auto sm:bottom-auto sm:right-5 sm:top-[76px]">
          <div className={`inline-flex items-center gap-2 ${toast.tone === "success" ? "text-emerald-600" : "text-rose-600"}`}>
            <span className="h-2.5 w-2.5 rounded-full bg-current" />
            {toast.message}
          </div>
        </div>
      )}

          <div className="mx-auto w-full max-w-[1440px] px-3.5 py-4 sm:px-6 sm:py-6">
          <main id="admin-main" className="min-w-0 space-y-5">
            {gigView && (
              <div hidden={!isGigSection}>
                <GigAdminConsole view={gigView} adminId={adminId} authorized active={isGigSection} onCountsChange={setGigSectionCounts} searchKey={searchParams?.toString() ?? ""} />
              </div>
            )}
            {activeSection === "Overview" && <AdminOverview
              adminId={adminId}
              counts={overview.data}
              countsUpdatedAt={overview.updatedAt}
              onCounts={overview.update}
              onRefreshCounts={() => void refreshOverviewCounts({ afterCurrent: true })}
              onNavigate={(section, workerCode) => {
                if (workerCode) { setSelectedWorkerId(workerCode); setWorkerDetailOpen(true); }
                setActiveSection(section);
              }}
            />}
            {!isGigSection && activeSection !== "Overview" && !snapshotLoaded && <AdminSectionLoading label="Loading admin records" />}
            {!isGigSection && activeSection !== "Overview" && snapshotError && (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#f3d19e] bg-[#fff8ec] px-4 py-3 text-[13px] text-[#825317]">
                <span>{snapshotError}</span>
                <button type="button" onClick={refresh} className="rounded-lg border border-current px-3 py-1.5 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current">Retry</button>
              </div>
            )}
            <div hidden={isGigSection || activeSection === "Overview" || !snapshotLoaded} className="space-y-5">
            {/* Workers */}
            {activeSection === "Workers" && (
              <>
              <WorkerWorkspace
                workers={workerDirectoryRows}
                selectedWorker={selectedDirectoryWorker}
                detailOpen={workerDetailOpen}
                onViewChange={setWorkerDetailOpen}
                onCreateWorker={openCreateWorker}
                directory={
                  <>
                    {workerDirectoryError ? (
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                        <span>{workerDirectoryError}</span>
                        {sandboxWorkers.length > 0 ? (
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setWorkers(sandboxWorkers);
                              setSelectedWorkerId((prev) =>
                                sandboxWorkers.some((worker) => worker.id === prev) ? prev : sandboxWorkers[0]?.id ?? null
                              );
                              setWorkerDirectoryError("Using local sandbox workers for testing. Live worker directory remains unavailable.");
                            }}
                          >
                            Use sandbox workers
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                    <WorkerDirectory
                      workers={workerDirectoryRows}
                      selectedWorkerId={selectedWorkerId}
                      onSelect={workerId => { setSelectedWorkerId(workerId); setWorkerDetailOpen(true); }}
                      onRefresh={loadSnapshot}
                      onVerifyUpi={workerId => {
                        const worker = workers.find(row => row.id === workerId);
                        const upi = worker ? getWorkerUpi(worker) : null;
                        if (upi) void verifyWorkerUpi(upi);
                      }}
                    />
                  </>
                }
              >
                {!selectedWorker || !selectedDirectoryWorker ? (
                  <div className={workerWorkspaceStyles.emptySelection}>
                    <WorkerGlyph name="users" />
                    <h2>Select a worker</h2>
                    <p>Open a user from the directory to manage access, accounts, and schedules.</p>
                  </div>
                ) : (
                  <>
                    <WorkerProfileHeader
                      worker={selectedDirectoryWorker}
                      onCreateAccount={openCreateAccount}
                      onCreateWork={() => openCreateWork(selectedWorker.id)}
                    />
                    <WorkerDetailTabs
                      key={selectedWorker.id}
                      accountCount={selectedDirectoryWorker.accountCount}
                      access={<WorkerAccessPanel worker={selectedWorker} onChanged={loadSnapshot} />}
                      profile={
                        <div className="space-y-4">
                          <Card title="Payment details" subtitle="UPI verification and payout preferences" compact>
                            {(() => {
                              const upi = getWorkerUpi(selectedWorker);
                              if (!upi?.upiId) return null;
                              return (
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                                  <span className="break-all">UPI: {upi.upiId}</span>
                                  <Chip tone={upi.verified ? "success" : "warn"}>{upi.verified ? "Verified" : "Unverified"}</Chip>
                                {!upi.verified && <button type="button" className="font-semibold text-sky-700 underline" onClick={(event) => { event.stopPropagation(); void verifyWorkerUpi(upi); }} onKeyDown={(event) => event.stopPropagation()}>Confirm verified UPI</button>}
                                  {upi.payoutSchedule && upi.payoutDay && (
                                    <span className="text-[11px] text-slate-400">
                                      {upi.payoutSchedule} • {upi.payoutDay}
                                    </span>
                                  )}
                                </div>
                              );
                            })()}
                            {!getWorkerUpi(selectedWorker)?.upiId ? <p className="text-sm text-slate-500">No UPI details added yet.</p> : null}
                          </Card>
                          <div className="rounded-md border border-slate-200 bg-white p-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <div className="text-sm font-extrabold text-slate-900">Presentation video</div>
                                <div className="mt-1 text-xs text-slate-500">
                                  {selectedWorker.introVideo?.uploadedAt
                                    ? `Updated ${new Date(selectedWorker.introVideo.uploadedAt).toLocaleString()}`
                                    : "No presentation video uploaded yet."}
                                </div>
                              </div>
                              {selectedWorker.introVideo?.previewUrl ? (
                                <a
                                  href={selectedWorker.introVideo.previewUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-extrabold text-slate-900 transition hover:bg-slate-50"
                                >
                                  Open
                                </a>
                              ) : null}
                            </div>

                            {selectedWorker.introVideo?.previewUrl || selectedWorker.introVideo?.thumbnailUrl ? (
                              <div className={workerWorkspaceStyles.presentationMedia}>
                                <div className="flex w-full items-center justify-center">
                                  <div className="relative w-full max-w-[220px] overflow-hidden">
                                    <div className="aspect-[9/16] w-full">
                                      {selectedWorker.introVideo?.thumbnailUrl ? (
                                        <img
                                          src={selectedWorker.introVideo.thumbnailUrl}
                                          alt={`${selectedWorker.name} presentation thumbnail`}
                                          className="h-full w-full object-cover"
                                        />
                                      ) : (
                                        <video
                                          src={selectedWorker.introVideo?.previewUrl}
                                          className="h-full w-full object-cover"
                                          preload="metadata"
                                          playsInline
                                          muted
                                        />
                                      )}
                                    </div>
                                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black/35 backdrop-blur-sm">
                                        <svg viewBox="0 0 24 24" className="ml-1 h-6 w-6 fill-white" aria-hidden="true">
                                          <path d="M8 6.5v11l9-5.5-9-5.5Z" />
                                        </svg>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                                This creator has not uploaded a presentation video yet.
                              </div>
                            )}
                          </div>
                        </div>
                      }
                      assignments={
                        <div className="space-y-4">
                          <div className={workerWorkspaceStyles.assignmentGrid}>
                            <Card title="Assigned accounts" subtitle="Remove or add accounts. Target 5–6+ per worker." compact>
                              <div className="space-y-2">
                                {accountsForWorker(selectedWorker.id).map((aid, idx) => {
                                  const acc = accountById(aid);
                                  if (!acc) return null;
                                  return (
                                    <div key={`${selectedWorker.id}-${aid}-${idx}`} className="rounded-lg border border-slate-200 bg-white p-3">
                                      <div className={workerWorkspaceStyles.assignedAccount}>
                                        <div className={workerWorkspaceStyles.assignedIdentity}>
                                          <div className="text-sm font-extrabold text-slate-900 truncate">{acc.handle}</div>
                                        <div className="text-xs text-slate-600 truncate">
                                          {acc.ownerTeam} • {acc.policyTier}
                                        </div>
                                        {(() => {
                                          const schedule = assignments.find((a) => a.workerId === selectedWorker.id && a.accountId === aid)?.schedule;
                                          if (!schedule) return null;
                                          const times = schedule.times?.length ? schedule.times : scheduleConfig.times;
                                          const days = schedule.days?.length ? schedule.days : scheduleConfig.days;
                                          const deadline = schedule.deadlineMin ?? scheduleConfig.deadlineMin;
                                          const tz = schedule.timezone ?? scheduleConfig.timezone;
                                          const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
                                          return (
                                            <div className="mt-1 text-[11px] text-slate-500">
                                              {times.join(", ")} • {days.map((d) => dayLabels[d]).join(", ")} • {deadline}m • {tz}
                                            </div>
                                          );
                                        })()}
                                        </div>
                                        <div className={workerWorkspaceStyles.assignedActions}>
                                          <AccountHealthPill h={acc.health} />
                                          <Button variant="secondary" title="Edit schedule" disabled={!selectedWorker.active} onClick={() => openEditSchedule(selectedWorker.id, aid)}>
                                            Schedule
                                          </Button>
                                          <Button variant="ghost" title="Remove" onClick={() => removeAssignment(selectedWorker.id, aid)}>
                                            <Icon name="x" />
                                          </Button>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                                {accountsForWorker(selectedWorker.id).length === 0 && <div className="text-sm text-slate-600">No accounts assigned.</div>}
                              </div>
                            </Card>

                            <Card title="Add assignment" subtitle="Assign any available account. (Create account first if needed)" compact>
                              {selectedWorker.active ? <AddAssignmentPanel
                                workerId={selectedWorker.id}
                                accounts={accounts}
                                assignedIds={new Set(accountsForWorker(selectedWorker.id))}
                                globallyAssignedIds={globallyAssignedIds}
                                onAssign={(accountId, schedule) => assignAccount(selectedWorker.id, accountId, schedule)}
                                onDeleteAccount={deleteAccount}
                                onCreateAccount={openCreateAccount}
                                defaultTimesCsv={scheduleTimesCsv}
                                defaultDeadlineMin={scheduleConfig.deadlineMin}
                                defaultDays={scheduleConfig.days}
                                defaultTimezone={selectedWorker.timezone ?? scheduleConfig.timezone}
                              /> : <p className="text-sm leading-6 text-slate-600">Restore this user’s access before adding assignments. Existing accounts and work remain available for review.</p>}
                            </Card>
                          </div>

                          <Card title="Daily schedule grid" subtitle="Assignments aligned by time (today in each timezone)" compact>
                            {scheduleRowsForSelected.length === 0 ? (
                              <div className="text-sm text-slate-600">No scheduled slots for today.</div>
                            ) : (
                              <div className="space-y-2">
                                {scheduleRowsForSelected.map((row) => (
                                  <div key={`${row.time}-${row.timezone}`} className="rounded-md border border-slate-200 bg-white p-3">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="text-sm font-extrabold text-slate-900">{row.time}</div>
                                      <Chip tone="neutral">{row.timezone}</Chip>
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      {row.accounts.map((acc) => (
                                        <Chip key={acc.id} tone={acc.policyTier === "Strict" ? "warn" : "neutral"}>
                                          {acc.handle}
                                        </Chip>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </Card>

                          <Card title="Weekly schedule grid" subtitle="Slots by weekday for this worker" compact>
                            {weeklyScheduleGrid.length === 0 ? (
                              <div className="text-sm text-slate-600">No weekly slots configured.</div>
                            ) : (
                              <div className="space-y-3">
                                {weeklyScheduleGrid.map((row) => (
                                  <div key={`${row.time}-${row.timezone}`} className="rounded-md border border-slate-200 bg-white p-3">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="text-sm font-extrabold text-slate-900">{row.time}</div>
                                      <Chip tone="neutral">{row.timezone}</Chip>
                                    </div>
                                    <div className={workerWorkspaceStyles.scheduleDays}>
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
                            )}
                          </Card>

                          <Card title="Worker timezone" subtitle="Default timezone for new schedules" compact>
                            <div className="space-y-2">
                              <select
                                aria-label="Worker timezone"
                              value={workerTimezoneDraft}
                                onChange={(e) => setWorkerTimezoneDraft(e.target.value)}
                                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
                              >
                                {TIMEZONE_OPTIONS.map((tz) => (
                                  <option key={tz} value={tz}>
                                    {tz}
                                  </option>
                                ))}
                              </select>
                              <Button
                                variant="secondary"
                                onClick={async () => {
                                  if (!selectedWorker) return;
                                  const res = await fetchWithAuth<{ ok: boolean }>(`/api/admin/worker-timezone`, {
                                    method: "POST",
                                    body: JSON.stringify({ workerId: selectedWorker.id, timezone: workerTimezoneDraft }),
                                  });
                                  if (res?.ok) {
                                    setWorkers((prev) =>
                                      prev.map((w) => (w.id === selectedWorker.id ? { ...w, timezone: workerTimezoneDraft } : w))
                                    );
                                  }
                                }}
                              >
                                Save timezone
                              </Button>
                            </div>
                          </Card>
                        </div>
                      }
                    />
                  </>
                )}
              </WorkerWorkspace>
              <details className="mt-5 overflow-hidden rounded-2xl border border-[#e3e5e1] bg-white">
                <summary className="cursor-pointer px-5 py-4 text-[13px] font-semibold text-[#47644d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]">Scheduling defaults</summary>
                <Card title="Scheduling defaults" subtitle="Daily reel slots and deadline (IST)">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <div className="text-xs font-extrabold text-slate-600">Times (HH:MM)</div>
                      <input
                        value={scheduleTimesCsv}
                        onChange={(e) => setScheduleTimesCsv(e.target.value)}
                        placeholder="08:00, 18:00"
                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
                      />
                    </div>
                    <div>
                      <div className="text-xs font-extrabold text-slate-600">Timezone</div>
                      <select
                        value={scheduleTimezone}
                        onChange={(e) => setScheduleTimezone(e.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
                      >
                        {TIMEZONE_OPTIONS.map((tz) => (
                          <option key={tz} value={tz}>
                            {tz}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div className="text-xs font-extrabold text-slate-600">Deadline (min)</div>
                      <input
                        type="number"
                        min={60}
                        max={720}
                        value={scheduleDeadlineMin}
                        onChange={(e) => setScheduleDeadlineMin(Number(e.target.value))}
                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
                      />
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, idx) => (
                      <label key={label} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-extrabold text-slate-700">
                        <input
                          type="checkbox"
                          checked={scheduleDays.includes(idx)}
                          onChange={(e) => {
                            setScheduleDays((prev) =>
                              e.target.checked ? Array.from(new Set([...prev, idx])) : prev.filter((d) => d !== idx)
                            );
                          }}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="text-xs text-slate-600">Applies to new assignments and daily scheduling. Schedule updates use POST only.</div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        onClick={async () => {
                          writeLS(LS_KEYS.SCHEDULE, scheduleConfig);
                          await fetchWithAuth<{ ok: boolean }>(`/api/admin/schedule-work`, {
                            method: "POST",
                            body: JSON.stringify({ schedule: scheduleConfig, reschedule: true, applyToAssignments: true }),
                          });
                          if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
                          setToast({ message: "Schedule applied", tone: "success" });
                          toastTimerRef.current = window.setTimeout(() => setToast(null), 2400);
                        }}
                      >
                        Apply schedule
                      </Button>
                      <Button variant="secondary" onClick={backfillAccounts}>
                        Normalize accounts
                      </Button>
                    </div>
                  </div>
                </Card>
              </details>
              </>
            )}

            {/* Payouts */}
            {activeSection === "Payouts" && (
              <div className="grid grid-cols-12 gap-6">
                <div className="col-span-12 space-y-6">
                  <ViewPayoutClaims admin />
                  <Card title="Payout requests" subtitle="Review, approve, or reject worker payout requests.">
                    {/* Phones: one card per request so amount, status and actions stay visible */}
                    <ul className="space-y-3 md:hidden">
                      {payoutQueue.map((b) => {
                        const total = payoutTotals(b);
                        const upi = getBatchUpi(b);
                        return (
                          <li key={b.id} className="rounded-xl border border-slate-200 bg-white p-3.5">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-[14px] font-semibold text-slate-900">
                                  {b.workerName ?? "Worker"} <span className="font-normal text-slate-500">({b.workerCode ?? b.workerId})</span>
                                </div>
                                <div className="mt-0.5 text-[12.5px] text-slate-600">{b.cycleLabel}</div>
                              </div>
                              <div className="shrink-0 text-right">
                                <div className="text-[15px] font-semibold tabular-nums text-slate-900">{formatINR(total)}</div>
                                <div className="mt-1">
                                  <Chip tone={payoutStatusTone(b.status)}>{b.status}</Chip>
                                </div>
                              </div>
                            </div>
                            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-lg bg-[#fafbf9] px-3 py-2.5 text-[12px]">
                              <dt className="text-slate-500">Period</dt>
                              <dd className="text-right text-slate-900">
                                {b.periodStart} → {b.periodEnd}
                              </dd>
                              <dt className="text-slate-500">Method</dt>
                              <dd className="truncate text-right text-slate-900">{b.method}</dd>
                              {upi?.upiId ? (
                                <>
                                  <dt className="text-slate-500">UPI</dt>
                                  <dd className="truncate text-right text-slate-900">
                                    {upi.upiId} · {upi.verified ? "Verified" : "Unverified"}
                                  </dd>
                                </>
                              ) : null}
                              <dt className="text-slate-500">Created</dt>
                              <dd className="text-right text-slate-900">{b.createdAt?.slice(0, 16).replace("T", " ")}</dd>
                              <dt className="text-slate-500">ETA</dt>
                              <dd className="text-right text-slate-900">{getPayoutEta(b) ?? "—"}</dd>
                            </dl>
                            <div className="mt-3 grid grid-cols-3 gap-2">
                              <Button variant="secondary" onClick={() => approvePayout(b.id)} disabled={busyPayouts.has(b.id) || b.status !== "Draft"} className="px-2">
                                Approve
                              </Button>
                              <Button variant="secondary" onClick={() => rejectPayout(b.id)} disabled={busyPayouts.has(b.id) || !["Draft", "Processing"].includes(b.status)} className="px-2">
                                Reject
                              </Button>
                              <Button variant="primary" onClick={() => markPayoutPaid(b.id)} disabled={busyPayouts.has(b.id) || b.status !== "Processing"} className="px-2">
                                Mark paid
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                      {payoutQueue.length === 0 && (
                        <li>
                          <AdminEmpty icon="wallet" title={rejectedPayoutCount ? "No open payout requests" : "No payout requests yet"} />
                        </li>
                      )}
                    </ul>
                    <div className="hidden overflow-x-auto rounded-lg border border-slate-200 md:block">
                      <table className="min-w-[980px] w-full text-left text-sm">
                        <thead className="bg-slate-50 text-xs font-extrabold text-slate-600">
                          <tr>
                            <th className="px-3 py-3">Worker</th>
                            <th className="px-3 py-3">Cycle</th>
                            <th className="px-3 py-3">Amount</th>
                            <th className="px-3 py-3">Status</th>
                            <th className="px-3 py-3">Method</th>
                            <th className="px-3 py-3">Created</th>
                            <th className="px-3 py-3">ETA</th>
                            <th className="px-3 py-3">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {payoutQueue.map((b) => {
                            const total = payoutTotals(b);
                            const upi = getBatchUpi(b);
                            return (
                              <tr key={b.id} className="bg-white">
                                <td className="px-3 py-3">
                                  <div className="text-sm font-extrabold text-slate-900">
                                    {b.workerName ?? "Worker"} ({b.workerCode ?? b.workerId})
                                  </div>
                                  {upi?.upiId && (
                                    <div className="mt-1 text-xs text-slate-500">
                                      UPI: {upi.upiId} • {upi.verified ? "Verified" : "Unverified"}
                                    </div>
                                  )}
                                </td>
                                <td className="px-3 py-3 text-slate-700">
                                  <div className="font-extrabold">{b.cycleLabel}</div>
                                  <div className="text-xs text-slate-500">
                                    {b.periodStart} → {b.periodEnd}
                                  </div>
                                </td>
                                <td className="px-3 py-3 font-extrabold">{formatINR(total)}</td>
                                <td className="px-3 py-3">
                                  <Chip tone={payoutStatusTone(b.status)}>{b.status}</Chip>
                                </td>
                                <td className="px-3 py-3 text-slate-700">{b.method}</td>
                                <td className="px-3 py-3 text-slate-600">{b.createdAt?.slice(0, 16).replace("T", " ")}</td>
                                <td className="px-3 py-3 text-slate-600">{getPayoutEta(b) ?? "—"}</td>
                                <td className="px-3 py-3">
                                  <div className="flex flex-wrap gap-2">
                                    <Button variant="secondary" onClick={() => approvePayout(b.id)} disabled={busyPayouts.has(b.id) || b.status !== "Draft"}>
                                      Approve
                                    </Button>
                                    <Button variant="secondary" onClick={() => rejectPayout(b.id)} disabled={busyPayouts.has(b.id) || !["Draft", "Processing"].includes(b.status)}>
                                      Reject
                                    </Button>
                                    <Button variant="primary" onClick={() => markPayoutPaid(b.id)} disabled={busyPayouts.has(b.id) || b.status !== "Processing"}>
                                      Mark paid
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                          {payoutQueue.length === 0 && (
                            <tr>
                              <td colSpan={7} className="px-3 py-6 text-sm text-slate-600">
                                {rejectedPayoutCount ? "No open payout requests." : "No payout requests yet."}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    {rejectedPayoutCount ? (
                      <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-200 pt-3 text-[12.5px] text-slate-500">
                        <span>
                          {showRejectedPayouts ? `Showing ${rejectedPayoutCount} rejected` : `${rejectedPayoutCount} rejected ${rejectedPayoutCount === 1 ? "request is" : "requests are"} hidden`}
                        </span>
                        <button type="button" onClick={() => setShowRejectedPayouts((v) => !v)} className="font-semibold text-sky-700 underline-offset-2 hover:underline">
                          {showRejectedPayouts ? "Hide rejected" : "Show rejected"}
                        </button>
                      </div>
                    ) : null}
                  </Card>

                  <Card title="Created work emails" subtitle="Stored credentials submitted by users before email generation.">
                    <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
                      <input
                        value={workEmailAccountQuery}
                        onChange={(e) => setWorkEmailAccountQuery(e.target.value)}
                        placeholder="Search by email, username, platform, or owner..."
                        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
                      />
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                        Passwords are encrypted at rest and revealed on demand.
                      </div>
                      <Button variant="secondary" onClick={loadWorkEmailAccountsAdmin}>
                        Refresh
                      </Button>
                    </div>
                    <ul className="space-y-3 md:hidden">
                      {visibleWorkEmailAccountsAdmin.map((row) => (
                        <li key={row.id} className="rounded-xl border border-slate-200 bg-white p-3.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-[13.5px] font-semibold text-slate-900">{row.email}</div>
                              <div className="truncate text-[12.5px] text-slate-600">
                                @{row.username} · {row.platform || "—"}
                              </div>
                            </div>
                            <span className="shrink-0 text-[11.5px] text-slate-500">{row.createdAt ? row.createdAt.slice(0, 10) : "—"}</span>
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-[#fafbf9] px-3 py-2 text-[12px]">
                            <span className="min-w-0 truncate text-slate-600">Owner: {row.ownerDisplayName || row.ownerWorkerCode || row.ownerUserId}</span>
                            {row.hasSocialPassword ? (
                              <span className="flex shrink-0 items-center gap-1.5">
                                <span className="font-mono text-[11.5px] text-slate-900">
                                  {revealedSocialPasswords[row.id] !== undefined ? revealedSocialPasswords[row.id] || "(empty)" : "••••••••"}
                                </span>
                                <Button variant="ghost" onClick={() => revealSocialPassword(row.id)} disabled={revealingPasswordFor === row.id} className="min-h-8 px-2 py-1 text-[12px]">
                                  {revealedSocialPasswords[row.id] !== undefined ? "Hide" : revealingPasswordFor === row.id ? "Revealing..." : "Reveal"}
                                </Button>
                              </span>
                            ) : null}
                          </div>
                        </li>
                      ))}
                      {visibleWorkEmailAccountsAdmin.length === 0 && (
                        <li>
                          <AdminEmpty icon="mail" title="No created work emails" />
                        </li>
                      )}
                    </ul>
                    <div className="hidden overflow-x-auto rounded-lg border border-slate-200 md:block">
                      <table className="min-w-[1040px] w-full text-left text-sm">
                        <thead className="bg-slate-50 text-xs font-extrabold text-slate-600">
                          <tr>
                            <th className="px-3 py-3">Email</th>
                            <th className="px-3 py-3">Social username</th>
                            <th className="px-3 py-3">Social password</th>
                            <th className="px-3 py-3">Platform</th>
                            <th className="px-3 py-3">Owner</th>
                            <th className="px-3 py-3">Created</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {visibleWorkEmailAccountsAdmin.map((row) => (
                            <tr key={row.id} className="bg-white">
                              <td className="px-3 py-3 font-extrabold text-slate-900">{row.email}</td>
                              <td className="px-3 py-3 text-slate-700">@{row.username}</td>
                              <td className="px-3 py-3 text-slate-700">
                                {!row.hasSocialPassword ? (
                                  "—"
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-xs">
                                      {revealedSocialPasswords[row.id] !== undefined ? revealedSocialPasswords[row.id] || "(empty)" : "••••••••"}
                                    </span>
                                    <Button
                                      variant="ghost"
                                      onClick={() => revealSocialPassword(row.id)}
                                      disabled={revealingPasswordFor === row.id}
                                    >
                                      {revealedSocialPasswords[row.id] !== undefined
                                        ? "Hide"
                                        : revealingPasswordFor === row.id
                                        ? "Revealing..."
                                        : "Reveal"}
                                    </Button>
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-3 text-slate-700">{row.platform || "—"}</td>
                              <td className="px-3 py-3 text-slate-600">
                                {row.ownerDisplayName || row.ownerWorkerCode || row.ownerUserId}
                              </td>
                              <td className="px-3 py-3 text-slate-600">{row.createdAt ? row.createdAt.slice(0, 16).replace("T", " ") : "—"}</td>
                            </tr>
                          ))}
                          {visibleWorkEmailAccountsAdmin.length === 0 && (
                            <tr>
                              <td colSpan={6} className="px-3 py-6 text-sm text-slate-600">
                                No created work emails found.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                </div>
              </div>
            )}

            {/* Feedback */}
            {activeSection === "Feedback" && (
              <div className="grid grid-cols-12 gap-6">
                <div className="col-span-12">
                  <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                    {[
                      { label: "New", value: feedbackStats.new, dot: "bg-[#d99a06]" },
                      { label: "Reviewing", value: feedbackStats.reviewing, dot: "bg-[#2a78d6]" },
                      { label: "Resolved", value: feedbackStats.resolved, dot: "bg-[#2e7d4f]" },
                      { label: "Total inbox", value: feedbackStats.total, dot: "bg-[#8a938d]" },
                    ].map((tile) => (
                      <div key={tile.label} className="rounded-xl border border-[#e3e5e1] bg-white p-3.5 shadow-[0_1px_2px_rgba(26,32,28,0.06)] sm:p-4">
                        <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-[#616a64]">
                          <span className={cx("h-2 w-2 rounded-full", tile.dot)} aria-hidden="true" />
                          {tile.label}
                        </div>
                        <div className="mt-2 text-[22px] font-semibold leading-none tabular-nums text-[#1a201c]">{tile.value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="col-span-12 xl:col-span-5 space-y-6">
                  <Card
                    title="Feedback inbox"
                    subtitle="Dashboard submissions arrive here with section and device context."
                    right={
                      <Button variant="secondary" onClick={loadFeedback}>
                        Refresh
                      </Button>
                    }
                  >
                    <div className="space-y-4">
                      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
                        <input
                          value={feedbackSearch}
                          onChange={(e) => setFeedbackSearch(e.target.value)}
                          placeholder="Search profile, worker, subject, or message..."
                          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
                        />
                        <select
                          value={feedbackFilter}
                          onChange={(e) => setFeedbackFilter(e.target.value as "all" | AdminFeedbackStatus)}
                          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
                        >
                          <option value="all">All statuses</option>
                          <option value="new">New</option>
                          <option value="reviewing">Reviewing</option>
                          <option value="resolved">Resolved</option>
                          <option value="closed">Closed</option>
                        </select>
                      </div>

                      {feedbackSchemaMissing && (
                        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                          Schema missing. Run <code>scripts/dashboard-feedback-schema.sql</code> in Supabase SQL Editor.
                        </div>
                      )}

                      {feedbackLoading && (
                        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">Loading feedback inbox…</div>
                      )}

                      <div className="space-y-3">
                        {visibleFeedbackItems.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setSelectedFeedbackId(item.id)}
                            className={cx(
                              "w-full rounded-xl border p-4 text-left transition",
                              selectedFeedback?.id === item.id ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-white hover:bg-slate-50"
                            )}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-extrabold text-slate-900">
                                  {item.profile_name || item.worker_id || "Unknown profile"}
                                </div>
                                <div className="mt-1 text-xs text-slate-500">
                                  {item.profile_role || "Creator"} • {item.worker_id || "No worker code"}
                                </div>
                              </div>
                              <Chip tone={feedbackStatusTone(item.status)}>{item.status}</Chip>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Chip tone="neutral">{feedbackCategoryLabel(item.category)}</Chip>
                              <Chip tone="info">{item.section}</Chip>
                              {item.rating ? <Chip tone="warn">{item.rating}/5</Chip> : null}
                            </div>
                            <div className="mt-3 text-sm font-extrabold text-slate-800">
                              {item.subject?.trim()
                                ? item.subject
                                : buildFeedbackSubject({ section: item.section, category: item.category, rating: item.rating })}
                            </div>
                            <div className="mt-1 line-clamp-3 text-sm leading-6 text-slate-600">{item.message}</div>
                            <div className="mt-3 text-xs text-slate-500">{formatDateTime(item.created_at)}</div>
                          </button>
                        ))}

                        {!feedbackLoading && visibleFeedbackItems.length === 0 && (
                          <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-sm text-slate-600">
                            No feedback matches the current filter.
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                </div>

                <div className="col-span-12 xl:col-span-7 space-y-6">
                  <Card title="Feedback details" subtitle="Review the submission, add notes, and update delivery status.">
                    {!selectedFeedback ? (
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                        Select a feedback item from the inbox to review it.
                      </div>
                    ) : (
                      <div className="space-y-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-xl font-black text-slate-900">
                              {selectedFeedback.subject?.trim()
                                ? selectedFeedback.subject
                                : buildFeedbackSubject({
                                    section: selectedFeedback.section,
                                    category: selectedFeedback.category,
                                    rating: selectedFeedback.rating,
                                  })}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                              <span>{selectedFeedback.profile_name || "Unknown profile"}</span>
                              <span>•</span>
                              <span>{selectedFeedback.profile_role || "Creator"}</span>
                              {selectedFeedback.worker_id ? (
                                <>
                                  <span>•</span>
                                  <span>{selectedFeedback.worker_id}</span>
                                </>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Chip tone={feedbackStatusTone(selectedFeedback.status)}>{selectedFeedback.status}</Chip>
                            <Chip tone="neutral">{feedbackCategoryLabel(selectedFeedback.category)}</Chip>
                            <Chip tone="info">{selectedFeedback.section}</Chip>
                            {selectedFeedback.rating ? <Chip tone="warn">{selectedFeedback.rating}/5</Chip> : null}
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-500">Submitted</div>
                            <div className="mt-2 text-sm font-extrabold text-slate-900">{formatDateTime(selectedFeedback.created_at)}</div>
                          </div>
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-500">Language</div>
                            <div className="mt-2 text-sm font-extrabold text-slate-900">
                              {selectedFeedback.language_name || selectedFeedback.language_code || "—"}
                            </div>
                          </div>
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-500">Contact</div>
                            <div className="mt-2 text-sm font-extrabold text-slate-900">
                              {selectedFeedback.allow_contact ? "Allowed" : "Not allowed"}
                            </div>
                          </div>
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-500">Source</div>
                            <div className="mt-2 text-sm font-extrabold text-slate-900">{selectedFeedback.source || "dashboard"}</div>
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-white p-4">
                          <div className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-500">User message</div>
                          <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">{selectedFeedback.message}</div>
                        </div>

                        <div className="grid gap-4 lg:grid-cols-2">
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                            <div className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-500">Environment</div>
                            <div className="mt-3 space-y-2 text-sm text-slate-700">
                              <div className="flex items-center justify-between gap-3">
                                <span>Path</span>
                                <span className="truncate font-extrabold text-slate-900">{String(selectedFeedbackMeta.path ?? "—")}</span>
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <span>Device</span>
                                <span className="font-extrabold text-slate-900">{String(selectedFeedbackMeta.deviceClass ?? "—")}</span>
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <span>Viewport</span>
                                <span className="font-extrabold text-slate-900">
                                  {selectedFeedbackMeta.viewportWidth != null && selectedFeedbackMeta.viewportHeight != null
                                    ? `${String(selectedFeedbackMeta.viewportWidth)} × ${String(selectedFeedbackMeta.viewportHeight)}`
                                    : "—"}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <span>Page URL</span>
                                {selectedFeedback.page_url ? (
                                  <a
                                    href={selectedFeedback.page_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="truncate font-extrabold text-sky-700 hover:text-sky-800"
                                  >
                                    Open
                                  </a>
                                ) : (
                                  <span className="font-extrabold text-slate-900">—</span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="rounded-xl border border-slate-200 bg-white p-4">
                            <div className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-500">Admin action</div>
                            <div className="mt-3 space-y-3">
                              <select
                                value={feedbackStatusDraft}
                                onChange={(e) => setFeedbackStatusDraft(e.target.value as AdminFeedbackStatus)}
                                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-extrabold text-slate-900 outline-none"
                              >
                                <option value="new">New</option>
                                <option value="reviewing">Reviewing</option>
                                <option value="resolved">Resolved</option>
                                <option value="closed">Closed</option>
                              </select>
                              <textarea
                                value={feedbackNoteDraft}
                                onChange={(e) => setFeedbackNoteDraft(e.target.value)}
                                placeholder="Internal note for follow-up, resolution, or next action..."
                                className="min-h-[160px] w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none"
                              />
                              <div className="flex flex-wrap gap-2">
                                <Button variant="primary" onClick={saveFeedbackUpdate} disabled={feedbackSaving}>
                                  {feedbackSaving ? "Saving..." : "Save update"}
                                </Button>
                                <Button variant="secondary" onClick={() => setFeedbackStatusDraft("reviewing")}>
                                  Mark reviewing
                                </Button>
                                <Button variant="secondary" onClick={() => setFeedbackStatusDraft("resolved")}>
                                  Mark resolved
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </Card>
                </div>
              </div>
            )}

            {/* Email Access */}
            {activeSection === "Email Access" && (
              <div className="grid grid-cols-12 gap-6">
                <div className="col-span-12 lg:col-span-5 space-y-6">
                  <Card title="Generate secret code" subtitle="Only admin can create code access for Work Email Creator.">
                    <div className="space-y-3">
                      <div>
                        <div className="text-xs font-extrabold text-slate-600">Label</div>
                        <input
                          value={newCodeLabel}
                          onChange={(e) => setNewCodeLabel(e.target.value)}
                          placeholder="Team A, Batch 3, Night shift..."
                          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
                        />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <div className="text-xs font-extrabold text-slate-600">Max uses (0 = unlimited)</div>
                          <input
                            value={newCodeMaxUses}
                            onChange={(e) => setNewCodeMaxUses(Number(e.target.value || 0))}
                            type="number"
                            min={0}
                            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
                          />
                        </div>
                        <div>
                          <div className="text-xs font-extrabold text-slate-600">Expires at (optional)</div>
                          <input
                            value={newCodeExpiry}
                            onChange={(e) => setNewCodeExpiry(e.target.value)}
                            type="datetime-local"
                            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
                          />
                        </div>
                      </div>
                      <Button variant="primary" onClick={generateWorkEmailCode}>
                        <Icon name="plus" />
                        Generate code
                      </Button>
                      {newlyGeneratedCode && (
                        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
                          <div className="text-xs text-emerald-700">New code (copy now):</div>
                          <div className="mt-1 text-sm font-extrabold text-emerald-900">{newlyGeneratedCode}</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button variant="secondary" onClick={() => copySecretCode(newlyGeneratedCode)}>
                              {copiedCode === newlyGeneratedCode ? "Copied" : "Copy code"}
                            </Button>
                            <Button variant="ghost" onClick={() => setNewlyGeneratedCode(null)}>
                              Hide
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </Card>
                </div>
                <div className="col-span-12 lg:col-span-7 space-y-6">
                  <Card title="Manage secret codes" subtitle="Block, activate, or delete access codes.">
                    <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-5">
                      {[
                        { label: "Total", value: workEmailCodeStats.total, dot: "bg-[#8a938d]" },
                        { label: "Active", value: workEmailCodeStats.active, dot: "bg-[#2e7d4f]" },
                        { label: "Blocked", value: workEmailCodeStats.blocked, dot: "bg-[#d03b3b]" },
                        { label: "Expired", value: workEmailCodeStats.expired, dot: "bg-[#d99a06]" },
                        { label: "Exhausted", value: workEmailCodeStats.exhausted, dot: "bg-[#2a78d6]" },
                      ].map((tile) => (
                        <div key={tile.label} className="rounded-lg border border-[#e3e5e1] bg-[#fafbf9] px-3 py-2.5">
                          <div className="flex items-center gap-1.5 text-[12px] font-medium text-[#616a64]">
                            <span className={cx("h-1.5 w-1.5 rounded-full", tile.dot)} aria-hidden="true" />
                            {tile.label}
                          </div>
                          <div className="mt-1 text-[18px] font-semibold leading-none tabular-nums text-[#1a201c]">{tile.value}</div>
                        </div>
                      ))}
                    </div>

                    <div className="mb-4 grid gap-3 sm:grid-cols-[1.4fr_0.9fr_0.9fr_auto]">
                      <input
                        value={codeQuery}
                        onChange={(e) => setCodeQuery(e.target.value)}
                        placeholder="Search by code hint or label..."
                        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
                      />
                      <select
                        value={codeFilter}
                        onChange={(e) => setCodeFilter(e.target.value as "all" | "active" | "blocked" | "expired" | "exhausted")}
                        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
                      >
                        <option value="all">All statuses</option>
                        <option value="active">Active only</option>
                        <option value="blocked">Blocked only</option>
                        <option value="expired">Expired only</option>
                        <option value="exhausted">Exhausted only</option>
                      </select>
                      <select
                        value={codeSort}
                        onChange={(e) => setCodeSort(e.target.value as "newest" | "oldest" | "usage-desc" | "expiry-soon")}
                        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
                      >
                        <option value="newest">Newest first</option>
                        <option value="oldest">Oldest first</option>
                        <option value="usage-desc">Highest usage</option>
                        <option value="expiry-soon">Expiry soon</option>
                      </select>
                      <Button variant="secondary" onClick={loadWorkEmailCodes}>
                        Refresh
                      </Button>
                    </div>

                    {workEmailSchemaMissing && (
                      <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                        Schema missing. Run <code>scripts/work-email-creator-schema.sql</code> in Supabase SQL Editor.
                      </div>
                    )}
                    <div className="md:hidden space-y-3">
                      {visibleWorkEmailCodes.map((row) => (
                        <div key={row.id} className="rounded-xl border border-slate-200 bg-white p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-extrabold text-slate-900">{row.code_hint}</div>
                              <div className="mt-1 text-xs text-slate-600">{row.label || "—"}</div>
                            </div>
                            <Button
                              variant="ghost"
                              className="!rounded-lg !px-2.5 !py-1 text-xs font-semibold"
                              onClick={() => void copyFullWorkEmailCode(row)}
                              title="Copy full code"
                            >
                              {copiedCodeRowId === row.id ? "Copied" : "Copy full"}
                            </Button>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <Chip tone={row.status === "active" ? "success" : "danger"}>{row.status}</Chip>
                            {row.isExpired && <Chip tone="warn">expired</Chip>}
                            {row.isExhausted && <Chip tone="info">limit reached</Chip>}
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                            <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-slate-700">
                              Usage: {row.use_count}
                              {row.max_uses ? ` / ${row.max_uses}` : " / unlimited"}
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-slate-700">
                              Expires: {row.expires_at ? row.expires_at.slice(0, 10) : "—"}
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-slate-700">
                              Created: {row.created_at ? row.created_at.slice(0, 10) : "—"}
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-slate-700">
                              Last used: {row.last_used_at ? row.last_used_at.slice(0, 10) : "—"}
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {(row.isExpired || row.isExhausted) && (
                              <Button variant="secondary" onClick={() => renewWorkEmailCode(row)}>
                                Renew
                              </Button>
                            )}
                            {row.status === "active" ? (
                              <Button variant="secondary" onClick={() => updateWorkEmailCode(row.id, "block")}>
                                Block
                              </Button>
                            ) : (
                              <Button variant="secondary" onClick={() => updateWorkEmailCode(row.id, "unblock")}>
                                Activate
                              </Button>
                            )}
                            <Button variant="ghost" onClick={() => deleteWorkEmailCode(row.id)}>
                              Delete
                            </Button>
                          </div>
                        </div>
                      ))}
                      {visibleWorkEmailCodes.length === 0 && (
                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-6 text-sm text-slate-600">
                          No codes match this filter.
                        </div>
                      )}
                    </div>

                    <div className="hidden md:block overflow-x-auto rounded-lg border border-slate-200">
                      <table className="min-w-[1020px] w-full text-left text-sm">
                        <thead className="bg-slate-50 text-xs font-extrabold text-slate-600">
                          <tr>
                            <th className="px-3 py-3">Code hint</th>
                            <th className="px-3 py-3">Label</th>
                            <th className="px-3 py-3">Status</th>
                            <th className="px-3 py-3">Usage</th>
                            <th className="px-3 py-3">Expires</th>
                            <th className="px-3 py-3">Created</th>
                            <th className="px-3 py-3">Last used</th>
                            <th className="px-3 py-3">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {visibleWorkEmailCodes.map((row) => (
                            <tr key={row.id} className="bg-white">
                              <td className="px-3 py-3">
                                <div className="flex items-center gap-2">
                                  <div className="font-extrabold text-slate-900">{row.code_hint}</div>
                                  <Button
                                    variant="ghost"
                                    className="!rounded-lg !px-2.5 !py-1 text-xs font-semibold"
                                    onClick={() => void copyFullWorkEmailCode(row)}
                                    title="Copy full code"
                                  >
                                    {copiedCodeRowId === row.id ? "Copied" : "Copy full"}
                                  </Button>
                                </div>
                              </td>
                              <td className="px-3 py-3 text-slate-700">{row.label || "—"}</td>
                              <td className="px-3 py-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Chip tone={row.status === "active" ? "success" : "danger"}>{row.status}</Chip>
                                  {row.isExpired && <Chip tone="warn">expired</Chip>}
                                  {row.isExhausted && <Chip tone="info">limit reached</Chip>}
                                </div>
                              </td>
                              <td className="px-3 py-3 text-slate-700">
                                <div className="min-w-[130px]">
                                  <div>
                                    {row.use_count}
                                    {row.max_uses ? ` / ${row.max_uses}` : " / unlimited"}
                                  </div>
                                  {typeof row.usagePct === "number" && (
                                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                                      <div className="h-full rounded-full bg-[#1f4f43]" style={{ width: `${row.usagePct}%` }} />
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-3 text-slate-600">{row.expires_at ? row.expires_at.slice(0, 16).replace("T", " ") : "—"}</td>
                              <td className="px-3 py-3 text-slate-600">{row.created_at ? row.created_at.slice(0, 16).replace("T", " ") : "—"}</td>
                              <td className="px-3 py-3 text-slate-600">{row.last_used_at ? row.last_used_at.slice(0, 16).replace("T", " ") : "—"}</td>
                              <td className="px-3 py-3">
                                <div className="flex flex-wrap gap-2">
                                  {(row.isExpired || row.isExhausted) && (
                                    <Button variant="secondary" onClick={() => renewWorkEmailCode(row)}>
                                      Renew
                                    </Button>
                                  )}
                                  {row.status === "active" ? (
                                    <Button variant="secondary" onClick={() => updateWorkEmailCode(row.id, "block")}>
                                      Block
                                    </Button>
                                  ) : (
                                    <Button variant="secondary" onClick={() => updateWorkEmailCode(row.id, "unblock")}>
                                      Activate
                                    </Button>
                                  )}
                                  <Button variant="ghost" onClick={() => deleteWorkEmailCode(row.id)}>
                                    Delete
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          ))}
                          {visibleWorkEmailCodes.length === 0 && (
                            <tr>
                              <td colSpan={8} className="px-3 py-6 text-sm text-slate-600">
                                No codes match this filter.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                </div>
              </div>
            )}

            </div>
          </main>
          </div>
        </div>
      </div>

      {/* Create Worker modal */}
      {createWorkerOpen && (
        <Modal
          title="Create worker profile + login"
          subtitle="Admin creates worker auth + profile in one step"
          onClose={() => setCreateWorkerOpen(false)}
          actions={
            <>
              <Button variant="secondary" onClick={() => setCreateWorkerOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={createWorker}
                disabled={!newWorkerId.trim() || !newWorkerName.trim() || !newWorkerEmail.trim() || newWorkerPassword.length < 12}
              >
                <Icon name="check" />
                Create worker
              </Button>
            </>
          }
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="text-sm font-extrabold text-slate-800">Worker ID</div>
              <input
                value={newWorkerId}
                onChange={(e) => setNewWorkerId(e.target.value)}
                placeholder="WKR-004"
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none"
              />
              <div className="mt-2 text-xs text-slate-500">Must be unique (recommended: WKR-###).</div>
            </div>

            <div>
              <div className="text-sm font-extrabold text-slate-800">Active</div>
              <label className="mt-2 inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-3 text-sm font-extrabold text-slate-900">
                <input type="checkbox" checked={newWorkerActive} onChange={() => setNewWorkerActive((v) => !v)} className="h-4 w-4 accent-[#0078d4]" />
                Active
              </label>
            </div>

            <div className="md:col-span-2">
              <div className="text-sm font-extrabold text-slate-800">Name</div>
              <input
                value={newWorkerName}
                onChange={(e) => setNewWorkerName(e.target.value)}
                placeholder="Example: Riya Patel"
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none"
              />
            </div>

            <div className="md:col-span-2">
              <div className="text-sm font-extrabold text-slate-800">Email (login)</div>
              <input
                value={newWorkerEmail}
                onChange={(e) => setNewWorkerEmail(e.target.value)}
                placeholder="riya@company.com"
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none"
              />
              <div className="mt-2 text-xs text-slate-500">Must be unique.</div>
            </div>

            <div className="md:col-span-2">
              <div className="text-sm font-extrabold text-slate-800">Password (min 12 chars)</div>
              <input
                value={newWorkerPassword}
                onChange={(e) => setNewWorkerPassword(e.target.value)}
                placeholder="Set initial password"
                type="password"
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none"
              />
            </div>
          </div>
        </Modal>
      )}

      {/* Renew Code modal */}
      {renewModalOpen && renewCodeTarget && (
        <Modal
          title="Renew secret code"
          subtitle={`Code ${renewCodeTarget.code_hint} • ${renewCodeTarget.label || "Unlabeled"}`}
          onClose={() => {
            if (renewSaving) return;
            setRenewModalOpen(false);
            setRenewCodeTarget(null);
          }}
          actions={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  if (renewSaving) return;
                  setRenewModalOpen(false);
                  setRenewCodeTarget(null);
                }}
              >
                Cancel
              </Button>
              <Button variant="primary" onClick={submitRenewCode} disabled={renewSaving}>
                <Icon name="check" />
                {renewSaving ? "Renewing..." : "Renew code"}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              Usage: {renewCodeTarget.use_count}
              {renewCodeTarget.max_uses ? ` / ${renewCodeTarget.max_uses}` : " / unlimited"}
            </div>
            <div>
              <div className="text-sm font-extrabold text-slate-800">New expiry (optional)</div>
              <input
                type="datetime-local"
                value={renewExpiry}
                onChange={(e) => setRenewExpiry(e.target.value)}
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none"
              />
              <div className="mt-2 text-xs text-slate-500">Leave empty for no expiry.</div>
            </div>
            <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800">
              <input
                type="checkbox"
                checked={renewResetUsage}
                onChange={() => setRenewResetUsage((v) => !v)}
                className="h-4 w-4 accent-[#0078d4]"
              />
              Reset usage count to zero
            </label>
          </div>
        </Modal>
      )}

      {/* Create Account modal */}
      {createAccountOpen && (
        <Modal
          title="Create account"
          subtitle="Admin registers a new account, then assigns it to workers"
          onClose={() => setCreateAccountOpen(false)}
          actions={
            <>
              <Button variant="secondary" onClick={() => setCreateAccountOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={createAccount}
                disabled={!newAccountId.trim() || !newAccountHandle.trim() || !newAccountNiche.trim() || !newAccountOwnerTeam.trim()}
              >
                <Icon name="check" />
                Create account
              </Button>
            </>
          }
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="text-sm font-extrabold text-slate-800">Account ID</div>
              <input
                value={newAccountId}
                onChange={(e) => setNewAccountId(e.target.value)}
                placeholder="acc_7"
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none"
              />
            </div>

            <div>
              <div className="text-sm font-extrabold text-slate-800">Handle</div>
              <input
                value={newAccountHandle}
                onChange={(e) => setNewAccountHandle(e.target.value)}
                placeholder="@newhandle"
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none"
              />
            </div>

            <div>
              <div className="text-sm font-extrabold text-slate-800">Niche</div>
              <input
                value={newAccountNiche}
                onChange={(e) => setNewAccountNiche(e.target.value)}
                placeholder="Example: Beauty / Tutorials"
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none"
              />
            </div>

            <div>
              <div className="text-sm font-extrabold text-slate-800">Owner team</div>
              <input
                value={newAccountOwnerTeam}
                onChange={(e) => setNewAccountOwnerTeam(e.target.value)}
                placeholder="Example: Growth Ops"
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none"
              />
            </div>

            <div>
              <div className="text-sm font-extrabold text-slate-800">Policy tier</div>
              <select
                value={newAccountPolicy}
                onChange={(e) => setNewAccountPolicy(e.target.value as PolicyTier)}
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm font-extrabold text-slate-900 outline-none"
              >
                <option value="Standard">Standard</option>
                <option value="Strict">Strict</option>
              </select>
            </div>

            <div>
              <div className="text-sm font-extrabold text-slate-800">Health</div>
              <select
                value={newAccountHealth}
                onChange={(e) => setNewAccountHealth(e.target.value as AccountHealth)}
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm font-extrabold text-slate-900 outline-none"
              >
                <option value="Healthy">Healthy</option>
                <option value="Watch">Watch</option>
                <option value="Risk">Risk</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <div className="text-sm font-extrabold text-slate-800">Rules (comma separated)</div>
              <textarea
                value={newAccountRulesCsv}
                onChange={(e) => setNewAccountRulesCsv(e.target.value)}
                placeholder="Example: Max 1 reel/day, No politics, Use caption template"
                className="mt-2 w-full min-h-[90px] rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
              />
            </div>

            <div className="md:col-span-2">
              <div className="text-sm font-extrabold text-slate-800">Allowed audios (comma separated)</div>
              <input
                value={newAccountAudiosCsv}
                onChange={(e) => setNewAccountAudiosCsv(e.target.value)}
                placeholder="Example: Trend Pack A1, Soft Pop #3"
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none"
              />
            </div>

            <div className="md:col-span-2">
              <div className="text-sm font-extrabold text-slate-800">Required hashtags (comma separated)</div>
              <input
                value={newAccountHashtagsCsv}
                onChange={(e) => setNewAccountHashtagsCsv(e.target.value)}
                placeholder="Example: #fashion, #ootd, #reels"
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none"
              />
              <div className="mt-2 text-xs text-slate-500">We auto-prefix missing # on save.</div>
            </div>
          </div>
        </Modal>
      )}

      {/* Create Work modal */}
      {createWorkOpen && (
        <Modal
          title="Create work item"
          subtitle="Admin creates a new work item for a worker + account"
          onClose={() => setCreateWorkOpen(false)}
          actions={
            <>
              <Button variant="secondary" onClick={() => setCreateWorkOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={createWork} disabled={!assignableWorkers.some(worker => worker.id === createWorkWorkerId) || !createWorkAccountId || !createWorkTitle.trim()}>
                <Icon name="check" />
                Create
              </Button>
            </>
          }
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="text-sm font-extrabold text-slate-800">Worker</div>
              <select
                aria-label="Worker for new work"
                value={assignableWorkers.some(worker => worker.id === createWorkWorkerId) ? createWorkWorkerId : ""}
                onChange={(e) => {
                  const wid = e.target.value;
                  setCreateWorkWorkerId(wid);
                  const firstAcc = accountsForWorker(wid)[0] ?? "";
                  setCreateWorkAccountId(firstAcc);
                }}
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm font-extrabold text-slate-900 outline-none"
              >
                <option value="" disabled>Choose a current worker</option>
                {assignableWorkers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.id})
                  </option>
                ))}
              </select>
              <div className="mt-2 text-xs text-slate-500">Only assigned accounts should be used for best worker UX.</div>
            </div>

            <div>
              <div className="text-sm font-extrabold text-slate-800">Account</div>
              <select
                value={createWorkAccountId}
                onChange={(e) => setCreateWorkAccountId(e.target.value)}
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm font-extrabold text-slate-900 outline-none"
              >
                {(accountsForWorker(createWorkWorkerId).length ? accountsForWorker(createWorkWorkerId) : accounts.map((a) => a.id)).map((aid) => {
                  const a = accountById(aid);
                  if (!a) return null;
                  return (
                    <option key={a.id} value={a.id}>
                      {a.handle} • {a.policyTier}
                    </option>
                  );
                })}
              </select>
              <div className="mt-2 text-xs text-slate-500">Strict accounts usually require approved audio gate.</div>
            </div>

            <div className="md:col-span-2">
              <div className="text-sm font-extrabold text-slate-800">Title</div>
              <input
                value={createWorkTitle}
                onChange={(e) => setCreateWorkTitle(e.target.value)}
                placeholder="Example: Post Reel: 3 stretches for lower back (12s max)"
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-[#0078d4]/20"
              />
            </div>

            <div>
              <div className="text-sm font-extrabold text-slate-800">Type</div>
              <select
                value={createWorkType}
                onChange={(e) => setCreateWorkType(e.target.value as TaskType)}
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm font-extrabold text-slate-900 outline-none"
              >
                <option value="Reel posting">Reel posting</option>
                <option value="Story posting">Story posting</option>
                <option value="Comment replies">Comment replies</option>
                <option value="Profile update">Profile update</option>
              </select>
            </div>

            <div>
              <div className="text-sm font-extrabold text-slate-800">Priority</div>
              <select
                value={createWorkPriority}
                onChange={(e) => setCreateWorkPriority(e.target.value as Priority)}
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm font-extrabold text-slate-900 outline-none"
              >
                <option value="P0">P0</option>
                <option value="P1">P1</option>
                <option value="P2">P2</option>
              </select>
            </div>

            <div>
              <div className="text-sm font-extrabold text-slate-800">Due (HH:MM)</div>
              <input
                value={createWorkDueHHMM}
                onChange={(e) => setCreateWorkDueHHMM(e.target.value)}
                placeholder="18:00"
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none"
              />
            </div>

            <div className="grid gap-3 md:grid-cols-3 md:col-span-2">
              <div>
                <div className="text-sm font-extrabold text-slate-800">Reward (₹)</div>
                <input
                  value={createWorkReward}
                  onChange={(e) => setCreateWorkReward(Number(e.target.value))}
                  type="number"
                  className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none"
                />
              </div>
              <div>
                <div className="text-sm font-extrabold text-slate-800">Estimated (min)</div>
                <input
                  value={createWorkEst}
                  onChange={(e) => setCreateWorkEst(Number(e.target.value))}
                  type="number"
                  className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none"
                />
              </div>
              <div>
                <div className="text-sm font-extrabold text-slate-800">SLA (min)</div>
                <input
                  value={createWorkSla}
                  onChange={(e) => setCreateWorkSla(Number(e.target.value))}
                  type="number"
                  className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none"
                />
              </div>
            </div>
          </div>
        </Modal>
      )}

      {editScheduleOpen && (
        <Modal
          title="Edit assignment schedule"
          subtitle={`${editScheduleWorkerId} • ${editScheduleAccountId}`}
          onClose={() => setEditScheduleOpen(false)}
          actions={
            <>
              <Button variant="secondary" onClick={() => setEditScheduleOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={saveEditSchedule}>
                Save schedule
              </Button>
            </>
          }
        >
          <div className="grid gap-3">
            <div>
              <div className="text-xs font-extrabold text-slate-600">Times (HH:MM)</div>
              <input
                value={editScheduleTimesCsv}
                onChange={(e) => setEditScheduleTimesCsv(e.target.value)}
                placeholder="08:00, 18:00"
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
              />
            </div>
            <div>
              <div className="text-xs font-extrabold text-slate-600">Deadline (minutes)</div>
              <input
                type="number"
                min={60}
                max={720}
                value={editScheduleDeadlineMin}
                onChange={(e) => setEditScheduleDeadlineMin(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
              />
            </div>
            <div>
              <div className="text-xs font-extrabold text-slate-600">Days</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, idx) => (
                  <label key={label} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-extrabold text-slate-700">
                    <input
                      type="checkbox"
                      checked={editScheduleDays.includes(idx)}
                      onChange={(e) => {
                        setEditScheduleDays((prev) =>
                          e.target.checked ? Array.from(new Set([...prev, idx])) : prev.filter((d) => d !== idx)
                        );
                      }}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs font-extrabold text-slate-600">Timezone</div>
              <select
                value={editScheduleTimezone}
                onChange={(e) => setEditScheduleTimezone(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
              >
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** ===================== Exported Page (Auth Gate + UI) ===================== */
export default function AdminPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [ok, setOk] = useState(false);
  const [authUserId, setAuthUserId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let version = 0;
    let verifiedUserId: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const verify = async () => {
      const request = ++version;
      const { data } = await supabase.auth.getSession();
      const role = await getMyRole();
      if (!alive || request !== version) return;
      verifiedUserId = role === "Admin" ? data.session?.user.id ?? null : null;
      bindAdminCacheIdentity(verifiedUserId);
      setAuthUserId(verifiedUserId);
      setOk(role === "Admin");
      if (role !== "Admin") router.replace(role === "Worker" ? "/dashboard" : `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    };
    void verify();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      // The explicit initial verification already covers INITIAL_SESSION; do not duplicate its API read.
      if (_event === "INITIAL_SESSION") return;
      version++;
      // INITIAL_SESSION also fires on reload: keep this admin's session cache intact.
      if (_event === "SIGNED_OUT" || (verifiedUserId && session?.user.id !== verifiedUserId)) bindAdminCacheIdentity(null);
      // A refreshed token for the same admin must not destroy in-progress forms and loaded rows.
      if (!session || session.user.id !== verifiedUserId) setOk(false);
      clearTimeout(timer);
      // Leave the Auth callback before reading the refreshed session.
      timer = setTimeout(() => { void verify(); }, 0);
    });
    const recheck = () => {
      bindAdminCacheIdentity(null);
      setOk(false);
      void verify();
    };
    window.addEventListener("admin-auth-invalidated", recheck);
    return () => {
      alive = false;
      clearTimeout(timer);
      sub.subscription.unsubscribe();
      window.removeEventListener("admin-auth-invalidated", recheck);
    };
  }, [router, pathname]);

  if (!ok || !authUserId) return <div className="ops-dashboard-skin min-h-screen p-5 sm:p-8"><AdminSectionLoading /></div>;
  return <Suspense fallback={<AdminSectionLoading />}><AdminConsole key={authUserId} adminId={authUserId} /></Suspense>;
}

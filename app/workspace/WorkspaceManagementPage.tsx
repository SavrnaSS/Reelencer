"use client";
import { apiFetch as fetch } from "@/lib/api/client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { buildPayoutReadiness, describeKycStatus } from "@/lib/payoutReadiness";
import { FIND_GIGS_HREF, findGigHref } from "@/lib/routes";
import { compareWorkDeadlines, formatWorkDeadline, getWorkTiming, parseWorkDate, workDurationMinutes, type WorkTiming } from "@/lib/workDates";

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
type Section = "Operations" | "Jobs" | "Profile" | "Accounts" | "Performance" | "Payouts" | "UPI";
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
    source?: string;
    assignmentId?: string;
    walletReleasedAt?: string;
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

type GigAssignment = {
  id?: string;
  gigId?: string;
  gig_id?: string;
  workerId?: string;
  worker_code?: string;
  status?: string;
  submittedAt?: string;
  submitted_at?: string;
  decidedAt?: string;
  decided_at?: string;
  created_at?: string;
  earningsReleaseStatus?: "none" | "queued" | "credited" | "blocked";
};

type GigSummary = {
  id: string;
  title?: string;
  company?: string;
  verified?: boolean;
  platform?: string;
  location?: string;
  workload?: string;
  payout?: string | null;
  status?: string;
  gigType?: string;
};

type GigApplication = {
  id: string;
  gigId: string;
  workerId: string;
  status: "Applied" | "Pending" | "Accepted" | "Rejected" | "Withdrawn";
  appliedAt: string;
  decidedAt?: string;
  proposal?: {
    reviewStatus?: "Pending" | "Accepted" | "Rejected";
  };
};

type WorkerProfile = {
  id: string;
  userId?: string;
  workerId?: string;
  name: string;
  headline?: string;
  city?: string;
  bio?: string;
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
  email?: string;
  at: string;
};

type IntroVideoMeta = {
  name: string;
  uploadedAt: string;
  previewUrl?: string;
  thumbnailUrl?: string;
  path?: string;
  thumbnailPath?: string;
  mimeType?: string;
  size?: number;
};

type NotificationActionKey = "payouts" | "introVideo" | "selectedItem" | "profile";

type WorkspaceNotification = {
  id: string;
  revision: string;
  title: string;
  body: string;
  icon: string;
  action: NotificationActionKey;
  accentClasses: string;
  chips?: string[];
  timestampLabel?: string;
};

/** ===================== Constants ===================== */
const RATE_DEFAULT = 5 as const;

const LS_KEYS = {
  ACCOUNTS: "igops:accounts",
  WORKERS: "igops:workers",
  ITEMS: "igops:workitems",
  UPI: "igops:upi",
  PAYOUTS: "igops:payoutbatches",
  INTRO_VIDEO: "igops:introVideo",
  NOTIFICATIONS: "igops:notificationState",
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

const MIN_PAYOUT_REQUEST_INR = 1000;

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

function parseStoredDateLike(value?: string | null) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)) {
    const [date, time] = value.split(" ");
    return parseWorkDate(`${date}T${time}`);
  }
  const direct = new Date(value);
  return Number.isNaN(direct.getTime()) ? null : direct;
}

function formatNotificationTime(value?: string | null) {
  const parsed = parseStoredDateLike(value);
  if (!parsed) return "Live";
  const diffMin = Math.max(0, Math.round((Date.now() - parsed.getTime()) / 60000));
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return `${pad2(parsed.getDate())}/${pad2(parsed.getMonth() + 1)}/${parsed.getFullYear()}`;
}

function formatDueWithTz(value?: string) {
  return formatWorkDeadline(value, true);
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

function isCredentialWalletItem(item: Pick<WorkItem, "review" | "id">) {
  return (
    String(item.review?.source ?? "") === "gig_assignment_approval" ||
    String(item.id ?? "").startsWith("GIGCRED-")
  );
}

function parsePayoutAmount(raw: unknown) {
  const text = String(raw ?? "").trim();
  if (!text) return 0;
  const normalized = text.replace(/[, ]+/g, "");
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function summarizeCredentialWallet(assignments: GigAssignment[], gigs: GigSummary[]) {
  const payoutByGigId = new Map<string, number>(
    gigs.map((gig) => [String(gig.id), parsePayoutAmount(gig.payout)])
  );

  return assignments.reduce(
    (totals, assignment) => {
      const amount = payoutByGigId.get(String(assignment.gigId ?? "")) ?? 0;
      if (!amount) return totals;

      if (assignment.earningsReleaseStatus === "credited") {
        totals.approvedCount += 1;
        totals.earnings += amount;
        return totals;
      }

      if (
        assignment.earningsReleaseStatus === "queued" ||
        ["Submitted", "Accepted", "Pending"].includes(String(assignment.status ?? ""))
      ) {
        totals.pendingCount += 1;
        totals.pending += amount;
      }

      return totals;
    },
    { approvedCount: 0, pendingCount: 0, earnings: 0, pending: 0 }
  );
}

function isWorkspaceGig(gig: Pick<GigSummary, "gigType" | "title">) {
  const raw = String(gig.gigType ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  if (raw === "workspace" || raw === "full-time" || raw === "fulltime") return true;
  return /\b(workspace|full[\s-]?time)\b/i.test(gig.title || "");
}

function normalizeApplicationStatus(status?: string) {
  const raw = String(status ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return undefined;
  if (raw === "applied") return "Applied";
  if (raw === "pending" || raw === "in review" || raw === "in-review") return "Pending";
  if (raw === "accepted" || raw === "approved") return "Accepted";
  if (raw === "rejected" || raw === "declined") return "Rejected";
  if (raw === "withdrawn") return "Withdrawn";
  return undefined;
}

function normalizeAssignmentStatus(status?: string) {
  const raw = String(status ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return undefined;
  if (raw === "assigned" || raw === "accepted" || raw === "approved") return "Assigned";
  if (raw === "submitted" || raw === "in verification" || raw === "in-verification") return "Submitted";
  if (raw === "pending" || raw === "in review" || raw === "in-review") return "Pending";
  if (raw === "rejected" || raw === "declined") return "Rejected";
  return status;
}

function isGigActive(gig: Pick<GigSummary, "status">) {
  return String(gig.status ?? "").trim().toLowerCase() === "open";
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

function looksLikeWorkerCode(value: string) {
  return /^WKR[-\s_]*\d+$/i.test(String(value ?? "").trim());
}

async function createVideoThumbnail(file: File, objectUrl: string) {
  return await new Promise<string>((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.playsInline = true;
    video.muted = true;
    video.src = objectUrl;
    let settled = false;
    const timeoutId = window.setTimeout(() => finish(), 2800);

    const finish = (value = "") => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      video.onseeked = null;
      video.onloadeddata = null;
      video.onerror = null;
      video.onloadedmetadata = null;
      video.src = "";
      resolve(value);
    };

    const drawFrame = () => {
      const canvas = document.createElement("canvas");
      const width = video.videoWidth || 720;
      const height = video.videoHeight || 1280;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        finish();
        return;
      }
      try {
        ctx.drawImage(video, 0, 0, width, height);
        finish(canvas.toDataURL("image/jpeg", 0.82));
      } catch {
        finish();
      }
    };

    video.onseeked = drawFrame;
    video.onloadeddata = () => {
      if (!video.duration || !isFinite(video.duration)) {
        drawFrame();
      }
    };

    video.onerror = () => finish();
    video.onloadedmetadata = () => {
      try {
        const targetTime = video.duration > 1 ? Math.min(1, video.duration * 0.2) : Math.min(0.15, video.duration || 0);
        video.currentTime = Math.max(0, targetTime);
      } catch {
        drawFrame();
      }
    };
  });
}

function dataUrlToFile(dataUrl: string, fallbackName: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mimeType = match[1] || "image/jpeg";
  const ext = mimeType.split("/")[1] || "jpg";
  const binary = window.atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], fallbackName.endsWith(`.${ext}`) ? fallbackName : `${fallbackName}.${ext}`, { type: mimeType });
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
    case "video":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3.5" y="6" width="12" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M15.5 10.2 20.5 7.5v9l-5-2.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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
    case "calendar":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M7 4.5v3M17 4.5v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <rect x="4" y="6.5" width="16" height="13.5" rx="3" stroke="currentColor" strokeWidth="1.8" />
          <path d="M4 10h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M9 14h2M13.5 14h1.5M9 17h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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
    case "briefcase":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M8 7V5.8A1.8 1.8 0 0 1 9.8 4h4.4A1.8 1.8 0 0 1 16 5.8V7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M5.5 7h13A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-7A2.5 2.5 0 0 1 5.5 7Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M3 12h18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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
    "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-extrabold transition focus:outline-none focus:ring-2 focus:ring-[#84d85e]/30 disabled:opacity-50 disabled:cursor-not-allowed";
  const styles =
    variant === "primary"
      ? "border border-[#3159d9] bg-[#3565f0] text-white shadow-[0_10px_22px_rgba(53,101,240,0.2)] hover:bg-[#2c58d6]"
      : variant === "secondary"
      ? "border border-[#dbe1ea] bg-white text-[#314255] hover:bg-[#f4f7fb]"
      : variant === "danger"
      ? "bg-rose-600 text-white hover:bg-rose-700"
      : "border border-[#dbe1ea] bg-white text-[#657487] hover:bg-[#f4f7fb]";
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
      ? "border-[#d3defe] bg-[#eef3ff] text-[#3350ad]"
      : tone === "success"
      ? "border-[#d6e7d6] bg-[#eff8ef] text-[#35624a]"
      : tone === "warn"
      ? "border-[#ece3b7] bg-[#fbf7e8] text-[#7a6a22]"
      : tone === "danger"
      ? "border-rose-200 bg-rose-50 text-rose-800"
      : "border-[#dbe1ea] bg-white text-[#5b6b7d]";
  return <span className={cx("inline-flex max-w-full items-center truncate whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-extrabold", cls, className)}>{children}</span>;
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
    <section className="rounded-[1.6rem] border border-[#dde4ed] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(249,251,255,0.98))] shadow-[0_14px_34px_rgba(34,54,78,0.08)]">
      {(title || right) && (
        <div className={cx("flex items-start justify-between gap-3 border-b border-[#e8edf4]", compact ? "px-4 py-2.5" : "px-5 py-4")}>
          <div className="min-w-0">
            {title && <div className="text-sm font-extrabold text-[#223142]">{title}</div>}
            {subtitle && <div className="mt-0.5 text-sm text-[#7b8896]">{subtitle}</div>}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </div>
      )}
      <div className={cx(compact ? "px-4 py-2.5" : "px-5 py-4")}>{children}</div>
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
  const [introVideo, setIntroVideo] = useState<IntroVideoMeta | null>(null);
  const [notificationReadState, setNotificationReadState] = useState<Record<string, string>>({});
  const [notificationStateLoaded, setNotificationStateLoaded] = useState(false);
  const [jobGigs, setJobGigs] = useState<GigSummary[]>([]);
  const [jobApplications, setJobApplications] = useState<GigApplication[]>([]);
  const [jobAssignments, setJobAssignments] = useState<GigAssignment[]>([]);
  const [credentialWallet, setCredentialWallet] = useState({ approvedCount: 0, pendingCount: 0, earnings: 0, pending: 0 });
  const [apiLoaded, setApiLoaded] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState("");
  const [registeredName, setRegisteredName] = useState("");
  const [introVideoUploading, setIntroVideoUploading] = useState(false);
  const [introVideoUploadProgress, setIntroVideoUploadProgress] = useState(0);
  const [introVideoPendingName, setIntroVideoPendingName] = useState("");

  // UI state (stable hooks)
  const [activeSection, setActiveSection] = useState<Section>("Operations");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [detailsOpenMobile, setDetailsOpenMobile] = useState(false);
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
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
  const introVideoInputRef = useRef<HTMLInputElement | null>(null);
  const profileNameInputRef = useRef<HTMLInputElement | null>(null);
  const notificationSyncTimer = useRef<number | null>(null);
  const introVideoUploadTimerRef = useRef<number | null>(null);
  const introVideoUploadCompleteRef = useRef<number | null>(null);

  // proof modal
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitReelUrl, setSubmitReelUrl] = useState("");
  const [submitShotUrl, setSubmitShotUrl] = useState("");
  const [profileDraft, setProfileDraft] = useState({
    name: "",
    email: "",
    headline: "",
    city: "",
    bio: "",
  });
  const [profileNotice, setProfileNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);

  // load indicator + errors
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>("");

  // KPI tick (ONLY when authed worker)
  const [tick, setTick] = useState(0);

  useEffect(() => {
    return () => {
      if (introVideo?.previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(introVideo.previewUrl);
      }
      if (introVideoUploadTimerRef.current) window.clearInterval(introVideoUploadTimerRef.current);
      if (introVideoUploadCompleteRef.current) window.clearTimeout(introVideoUploadCompleteRef.current);
    };
  }, [introVideo?.previewUrl]);

  const stopCamera = useCallback(() => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }
    setCameraOn(false);
  }, []);

  // Live-selfie capture session (see lib/kycSelfie): the upload must carry it, and its challenge is shown on screen.
  const selfieSessionRef = useRef<{ token: string; expiresAt: number } | null>(null);
  const [selfieChallenge, setSelfieChallenge] = useState<string | null>(null);
  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Not authenticated");
      const [stream, sessionRes] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        }),
        fetch("/api/kyc/selfie-session", { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } }),
      ]);
      const session = await sessionRes.json().catch(() => null);
      if (!sessionRes.ok || !session?.token) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error(session?.error || "Unable to start the selfie session.");
      }
      selfieSessionRef.current = { token: String(session.token), expiresAt: Date.parse(session.expiresAt) || Date.now() + 5 * 60_000 };
      setSelfieChallenge(String(session.challenge?.text ?? ""));
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
      if (kind === "selfie") {
        const session = selfieSessionRef.current;
        if (!session || session.expiresAt < Date.now()) throw new Error("The camera session expired. Start the live camera and capture again.");
        fd.append("session", session.token);
      }
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
        if (payload.profile) {
          setKycForm((prev) => ({
            ...prev,
            legalName: String(payload.profile.legalName ?? prev.legalName ?? ""),
            dob: String(payload.profile.dob ?? prev.dob ?? ""),
            phone: String(payload.profile.phone ?? prev.phone ?? ""),
            address: String(payload.profile.address ?? prev.address ?? ""),
            idType: String(payload.profile.idType ?? prev.idType ?? ""),
            idNumber: String(payload.profile.idNumber ?? prev.idNumber ?? ""),
            idDocPath: String(payload.profile.idDocPath ?? prev.idDocPath ?? ""),
            selfiePath: String(payload.profile.selfiePath ?? prev.selfiePath ?? ""),
          }));
        }
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
    if (!hydrated || !sessionLoaded || !isWorkerAuthed) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const email = data?.user?.email ?? "";
      const userMeta = data?.user?.user_metadata ?? {};
      const fallbackName =
        String(userMeta?.display_name ?? userMeta?.full_name ?? userMeta?.name ?? "").trim() ||
        (email ? email.split("@")[0] : "");
      if (!cancelled) {
        setRegisteredEmail(email);
        setRegisteredName(fallbackName);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, sessionLoaded, isWorkerAuthed]);

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
    const nextWorkers = toArray<WorkerProfile>(readLS<any>(LS_KEYS.WORKERS, []), []).map((worker) =>
      worker.id === effectiveWorkerId || worker.workerId === effectiveWorkerId
        ? {
            ...worker,
            email: worker.email || registeredEmail,
            name:
              !String(worker.name ?? "").trim() || looksLikeWorkerCode(String(worker.name ?? ""))
                ? registeredName || worker.name
                : worker.name,
          }
        : worker
    );
    const nextItems = toArray<WorkItem>(readLS<any>(LS_KEYS.ITEMS, []), []);
    const nextUpi = normalizeUpi(readLS<any>(LS_KEYS.UPI, DEFAULT_UPI));
    const nextPayouts = toArray<PayoutBatch>(readLS<any>(LS_KEYS.PAYOUTS, []), []);

    setAccounts(nextAccounts);
    setWorkers(nextWorkers);
    setItems(nextItems);
    setUpi(nextUpi);
    setPayoutBatches(nextPayouts);
    setIntroVideo(readLS<IntroVideoMeta | null>(LS_KEYS.INTRO_VIDEO, null));
    setNotificationReadState(readLS<Record<string, string>>(LS_KEYS.NOTIFICATIONS, {}));
  }, [hydrated, isWorkerAuthed, apiLoaded, effectiveWorkerId, registeredEmail, registeredName]);

  useEffect(() => {
    if (!hydrated || !isWorkerAuthed) return;
    writeLS(LS_KEYS.NOTIFICATIONS, notificationReadState);
  }, [hydrated, isWorkerAuthed, notificationReadState]);

  useEffect(() => {
    if (!hydrated || !sessionLoaded || !isWorkerAuthed) return;
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) {
          if (alive) setNotificationStateLoaded(true);
          return;
        }
        const res = await fetchJSON<{ readState?: Record<string, string> }>("/api/me/notifications", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!alive) return;
        if (res.ok && res.data?.readState && typeof res.data.readState === "object") {
          setNotificationReadState(res.data.readState);
          writeLS(LS_KEYS.NOTIFICATIONS, res.data.readState);
        }
      } finally {
        if (alive) setNotificationStateLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [hydrated, sessionLoaded, isWorkerAuthed]);

  useEffect(() => {
    if (!hydrated || !sessionLoaded || !isWorkerAuthed) return;
    let alive = true;
    (async () => {
      const res = await fetchJSON<{ ok: true; introVideo: IntroVideoMeta | null }>("/api/me/presentation-video", {
        method: "GET",
      });
      if (!alive || !res.ok) return;
      setIntroVideo(res.data.introVideo ?? null);
      if (res.data.introVideo) writeLS(LS_KEYS.INTRO_VIDEO, res.data.introVideo);
      else removeLS(LS_KEYS.INTRO_VIDEO);
    })();
    return () => {
      alive = false;
    };
  }, [hydrated, sessionLoaded, isWorkerAuthed]);

  useEffect(() => {
    if (!hydrated || !isWorkerAuthed || !notificationStateLoaded) return;
    if (notificationSyncTimer.current) window.clearTimeout(notificationSyncTimer.current);
    notificationSyncTimer.current = window.setTimeout(async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      await fetchJSON("/api/me/notifications", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ readState: notificationReadState }),
      });
    }, 320);
    return () => {
      if (notificationSyncTimer.current) window.clearTimeout(notificationSyncTimer.current);
    };
  }, [hydrated, isWorkerAuthed, notificationReadState, notificationStateLoaded]);

  /** ========== Backend load (admin-controlled state) ========== */
  const loadInFlightRef = useRef(false);

  const loadFromApi = useCallback(async () => {
    if (!hydrated) return;
    if (!effectiveWorkerId) return;
    if (loadInFlightRef.current) return;

    loadInFlightRef.current = true;

    setLoading(true);
    setLoadError("");

    const [rWorkers, rAccounts, rItems, rPayouts, rUpi, rAssignments, rGigs, rApplications] = await Promise.all([
      fetchJSON<WorkerProfile[] | null | undefined>(`/api/workers`, { method: "GET" }),
      fetchJSON<AssignedAccount[] | null | undefined>(`/api/accounts`, { method: "GET" }),
      fetchJSON<WorkItem[] | null | undefined>(`/api/workitems?workerId=${encodeURIComponent(effectiveWorkerId)}&scope=all`, { method: "GET" }),
      fetchJSON<PayoutBatch[] | null | undefined>(`/api/payoutbatches?workerId=${encodeURIComponent(effectiveWorkerId)}`, { method: "GET" }),
      fetchJSON<UpiConfig | null | undefined>(`/api/upi?workerId=${encodeURIComponent(effectiveWorkerId)}`, { method: "GET" }),
      fetchJSON<GigAssignment[] | null | undefined>(`/api/gig-assignments?workerId=${encodeURIComponent(effectiveWorkerId)}`, { method: "GET" }),
      fetchJSON<GigSummary[] | null | undefined>(`/api/gigs`, { method: "GET" }),
      fetchJSON<GigApplication[] | null | undefined>(`/api/gig-applications?workerId=${encodeURIComponent(effectiveWorkerId)}`, { method: "GET" }),
    ]);

    let anyOk = false;

    if (rWorkers.ok) {
      const safe = toArray<WorkerProfile>(rWorkers.data, []).map((worker) =>
        worker.id === effectiveWorkerId || worker.workerId === effectiveWorkerId
          ? {
              ...worker,
              email: worker.email || registeredEmail,
              name:
                !String(worker.name ?? "").trim() || looksLikeWorkerCode(String(worker.name ?? ""))
                  ? registeredName || worker.name
                  : worker.name,
            }
          : worker
      );
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

    if (rGigs.ok) {
      const safeGigs = toArray<GigSummary>(rGigs.data, []);
      setJobGigs(safeGigs);
    }

    if (rApplications.ok) {
      const safeApps = toArray<GigApplication>(rApplications.data, []);
      setJobApplications(safeApps);
    }

    if (rAssignments.ok) {
      const safeAssignments = toArray<GigAssignment>(rAssignments.data, []);
      setJobAssignments(safeAssignments);
    }

    if (rAssignments.ok && rGigs.ok) {
      const safeAssignments = toArray<GigAssignment>(rAssignments.data, []);
      const safeGigs = toArray<GigSummary>(rGigs.data, []);
      setCredentialWallet(summarizeCredentialWallet(safeAssignments, safeGigs));
    } else {
      setCredentialWallet({ approvedCount: 0, pendingCount: 0, earnings: 0, pending: 0 });
    }

    if (!anyOk) {
      setLoadError("Live data temporarily unavailable. Showing last synced data.");
    } else {
      setApiLoaded(true);
    }

    setLoading(false);
    loadInFlightRef.current = false;
  }, [hydrated, effectiveWorkerId, registeredEmail, registeredName]);

  // initial load + reload when worker changes
  useEffect(() => {
    if (!hydrated) return;
    loadFromApi();
    return () => {
      loadInFlightRef.current = false;
    };
  }, [hydrated, effectiveWorkerId, loadFromApi]);

  // Authenticated refresh also updates payout statuses and balance when server-only tables cannot emit client events.
  useEffect(() => {
    if (!hydrated || !isWorkerAuthed) return;
    const refresh = () => { if (!document.hidden) void loadFromApi(); };
    const timer = window.setInterval(refresh, 10_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [hydrated, isWorkerAuthed, loadFromApi]);

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
  const creatorDisplayName = useMemo(() => {
    const candidate = String(me?.name ?? "").trim();
    if (candidate && !looksLikeWorkerCode(candidate)) return candidate;
    return registeredName || candidate || effectiveWorkerId || "Creator";
  }, [me?.name, registeredName, effectiveWorkerId]);
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
    if (!me && !creatorDisplayName && !registeredEmail) return;
    setProfileDraft({
      name: creatorDisplayName,
      email: me?.email ?? registeredEmail,
      headline: me?.headline ?? "Verified creator profile",
      city: me?.city ?? "",
      bio: me?.bio ?? "",
    });
  }, [me, registeredEmail, creatorDisplayName]);

  const profileBaseline = useMemo(
    () => ({
      name: creatorDisplayName,
      email: me?.email ?? registeredEmail,
      headline: me?.headline ?? "Verified creator profile",
      city: me?.city ?? "",
      bio: me?.bio ?? "",
    }),
    [me, registeredEmail, creatorDisplayName]
  );

  const personalInfoDirty = useMemo(() => profileDraft.name.trim() !== profileBaseline.name.trim(), [profileDraft.name, profileBaseline.name]);
  const profileDirty = personalInfoDirty;
  const hasPersistedIntroVideo = useMemo(
    () => !!(introVideo && (introVideo.previewUrl || introVideo.thumbnailUrl || introVideo.path || introVideo.name)),
    [introVideo]
  );
  const hasRenderableIntroMedia = useMemo(
    () => !!(introVideo && (introVideo.thumbnailUrl || introVideo.previewUrl)),
    [introVideo]
  );

  useEffect(() => {
    if (!hydrated || !sessionLoaded || !isWorkerAuthed) return;
    if (!hasPersistedIntroVideo || hasRenderableIntroMedia) return;

    let alive = true;
    let attempts = 0;

    const refreshPresentationVideo = async () => {
      const res = await fetchJSON<{ ok: true; introVideo: IntroVideoMeta | null }>("/api/me/presentation-video", {
        method: "GET",
      });
      if (!alive || !res.ok) return;
      const nextVideo = res.data.introVideo ?? null;
      if (nextVideo) {
        setIntroVideo(nextVideo);
        writeLS(LS_KEYS.INTRO_VIDEO, nextVideo);
      }
    };

    const intervalId = window.setInterval(() => {
      attempts += 1;
      void refreshPresentationVideo();
      if (attempts >= 8) {
        window.clearInterval(intervalId);
      }
    }, 2500);

    void refreshPresentationVideo();

    return () => {
      alive = false;
      window.clearInterval(intervalId);
    };
  }, [hydrated, sessionLoaded, isWorkerAuthed, hasPersistedIntroVideo, hasRenderableIntroMedia]);

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
        const dueUtc = parseWorkDate(x.dueAt);
        if (!dueUtc) return false;
        const windowStart = new Date(dueUtc.getTime() - x.slaMinutes * 60 * 1000);
        const previewStart = new Date(windowStart.getTime() - 60 * 60 * 1000);
        return nowUtc >= previewStart && nowUtc < windowStart;
      })
      .sort((a, b) => compareWorkDeadlines(a.dueAt, b.dueAt))
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
    const map = new Map<string, WorkTiming>();

    activeItems.forEach((x) => {
      map.set(x.id, getWorkTiming(x, now));
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
        return compareWorkDeadlines(a.dueAt, b.dueAt);
      });
  }, [activeItems, assignedAccountIds, priorityFilter, strictOnly, q, accountById]);

  const selected = useMemo(() => (selectedId ? activeItems.find((x) => x.id === selectedId) ?? null : null), [activeItems, selectedId]);
  const selectedAccount = useMemo(() => (selected ? accountById(selected.accountId) : undefined), [selected, accountById]);

  const kpiScope = useMemo(
    () =>
      allItems.filter((x) => {
        if (x.workerId && x.workerId !== effectiveWorkerId && x.workerId !== me?.userId) return false;
        return assignedAccountIds.has(x.accountId) || isCredentialWalletItem(x);
      }),
    [allItems, effectiveWorkerId, me?.userId, assignedAccountIds]
  );

  const operationalKpiScope = useMemo(
    () => kpiScope.filter((x) => !isCredentialWalletItem(x)),
    [kpiScope]
  );

  const kpis = useMemo(() => {
    const open = activeItems.filter((x) => x.status === "Open").length;
    const inProg = activeItems.filter((x) => x.status === "In progress").length;
    const needsFix = activeItems.filter((x) => x.status === "Needs fix").length;
    const submitted = operationalKpiScope.filter((x) => x.status === "Submitted").length + credentialWallet.pendingCount;
    const hardRejected = kpiScope.filter((x) => x.status === "Hard rejected").length;
    const approved = operationalKpiScope.filter((x) => x.status === "Approved").length + credentialWallet.approvedCount;
    const earnings = operationalKpiScope.filter((x) => x.status === "Approved").reduce((s, x) => s + x.rewardINR, 0) + credentialWallet.earnings;
    const pending = operationalKpiScope.filter((x) => x.status === "Submitted").reduce((s, x) => s + x.rewardINR, 0) + credentialWallet.pending;
    const count = kpiScope.length;
    return { open, inProg, submitted, needsFix, hardRejected, approved, earnings, pending, count };
  }, [activeItems, credentialWallet, kpiScope.length, operationalKpiScope]);

  const completedCount = useMemo(() => {
    return (
      operationalKpiScope.filter((x) => !!x.submission?.submittedAt || !!x.completedAt || x.status === "Approved" || x.status === "Hard rejected" || x.status === "Needs fix" || x.status === "Submitted").length +
      credentialWallet.approvedCount +
      credentialWallet.pendingCount
    );
  }, [credentialWallet.approvedCount, credentialWallet.pendingCount, operationalKpiScope]);

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
  const kycMeta = useMemo(() => describeKycStatus(kycStatus, kycRejection), [kycStatus, kycRejection]);
  const payoutReadiness = useMemo(
    () =>
      buildPayoutReadiness({
        kycStatus,
        kycRejectionReason: kycRejection,
        upiVerified: upi.verified,
        hasActiveBatch: hasProcessingPayout || hasDraftPayout,
        eligibleItemCount: eligiblePayoutItems.length,
        eligibleAmount: eligiblePayoutTotal,
        minimumAmount: MIN_PAYOUT_REQUEST_INR,
      }),
    [kycStatus, kycRejection, upi.verified, hasProcessingPayout, hasDraftPayout, eligiblePayoutItems.length, eligiblePayoutTotal]
  );
  const processingEta = useMemo(() => {
    const hit = payoutBatches.find((b) => b.status === "Processing");
    const note = hit?.notes?.find((n) => String(n).startsWith("ETA:"));
    return note ? String(note).slice("ETA:".length) : undefined;
  }, [payoutBatches]);
  const workspaceKycChipLabel =
    kycStatus === "approved"
      ? "KYC approved"
      : kycStatus === "pending"
        ? "KYC pending"
        : kycStatus === "rejected"
          ? "KYC action needed"
        : "KYC not started";

  const markNotificationRead = useCallback((id: string, revision: string) => {
    setNotificationReadState((prev) => (prev[id] === revision ? prev : { ...prev, [id]: revision }));
  }, []);

  const markAllNotificationsRead = useCallback((items: WorkspaceNotification[]) => {
    setNotificationReadState((prev) => {
      const next = { ...prev };
      items.forEach((item) => {
        next[item.id] = item.revision;
      });
      return next;
    });
  }, []);

  const markAllNotificationsUnread = useCallback((items: WorkspaceNotification[]) => {
    setNotificationReadState((prev) => {
      const next = { ...prev };
      items.forEach((item) => {
        if (next[item.id] === item.revision) {
          delete next[item.id];
        }
      });
      return next;
    });
  }, []);

  const notificationFeed = useMemo<WorkspaceNotification[]>(() => {
    const feed: WorkspaceNotification[] = [];

    if (kycStatus !== "approved") {
      feed.push({
        id: "compliance",
        revision: `compliance|${kycStatus}|${kycRejection ?? ""}`,
        title: "Compliance update",
        body: kycMeta.description,
        icon: "settings",
        action: "profile",
        accentClasses: "bg-[#fff3d8] text-[#c08a14]",
        chips: [workspaceKycChipLabel],
        timestampLabel:
          kycStatus === "pending"
            ? "Awaiting review"
            : kycStatus === "rejected"
              ? "Needs resubmission"
              : "Action required",
      });
    }

    feed.push({
      id: "intro-video",
      revision: `intro|${introVideo?.name ?? "missing"}|${introVideo?.uploadedAt ?? "none"}`,
      title: introVideo ? "Presentation media updated" : "Presentation media required",
      body: introVideo
        ? "Your presentation video is saved and available for profile review."
        : "Add a short presentation video so brands can review your profile faster.",
      icon: "video",
      action: "profile",
      accentClasses: "bg-[#eef2ff] text-[#5a73d0]",
      chips: introVideo ? ["media ready"] : ["action needed"],
      timestampLabel: introVideo ? "Profile updated" : "Pending",
    });

    feed.push({
      id: "payout-readiness",
      revision: `payout|${payoutReadiness.ready}|${payoutReadiness.primaryBlocker?.detail ?? "clear"}|${eligiblePayoutTotal}|${upi.verified}|${hasProcessingPayout}|${processingEta ?? ""}`,
      title: "Payout readiness",
      body: hasProcessingPayout
        ? `Release is processing${processingEta ? ` • ETA ${processingEta}` : ""}.`
        : payoutReadiness.primaryBlocker
          ? payoutReadiness.primaryBlocker.detail
          : "All checks are clear for the next release.",
      icon: "wallet",
      action: "payouts",
      accentClasses: "bg-[#edf6f0] text-[#5e866b]",
      chips: [upi.verified ? "UPI ready" : "UPI pending", `${formatINR(eligiblePayoutTotal)} eligible`],
      timestampLabel: hasProcessingPayout ? "Processing" : payoutReadiness.ready ? "Ready" : "Blocked",
    });

    if (selected) {
      feed.push({
        id: "selected-item",
        revision: `selected|${selected.id}|${selected.status}|${selected.review?.reviewedAt ?? ""}|${selected.submission?.submittedAt ?? ""}`,
        title: "Selected work item",
        body: selected.title,
        icon: "tasks",
        action: "selectedItem",
        accentClasses: "bg-[#eef4f2] text-[#537260]",
        chips: [selected.status],
        timestampLabel: selected.submission?.submittedAt ? formatNotificationTime(selected.submission.submittedAt) : "In focus",
      });
    }

    return feed;
  }, [
    eligiblePayoutTotal,
    hasProcessingPayout,
    introVideo,
    kycMeta.description,
    kycRejection,
    kycStatus,
    payoutReadiness,
    processingEta,
    selected,
    upi.verified,
    workspaceKycChipLabel,
  ]);

  const unreadNotificationCount = useMemo(
    () => notificationFeed.filter((item) => notificationReadState[item.id] !== item.revision).length,
    [notificationFeed, notificationReadState]
  );
  const actionRequiredNotificationCount = useMemo(
    () =>
      notificationFeed.filter((item) => {
        if (item.id === "compliance") return true;
        if (item.id === "intro-video") return !introVideo;
        if (item.id === "payout-readiness") return !payoutReadiness.ready;
        return false;
      }).length,
    [introVideo, notificationFeed, payoutReadiness.ready]
  );
  const canMarkAllRead = unreadNotificationCount > 0;
  const canMarkAllUnread = notificationFeed.length > 0 && unreadNotificationCount < notificationFeed.length;

  const jobGigById = useMemo(() => {
    const map = new Map<string, GigSummary>();
    jobGigs.forEach((gig) => map.set(String(gig.id), gig));
    return map;
  }, [jobGigs]);

  const assignedJobCards = useMemo(
    () =>
      jobAssignments
        .map((assignment) => {
          const gigId = String(assignment.gigId ?? assignment.gig_id ?? "").trim();
          if (!gigId) return null;
          const gig = jobGigById.get(gigId);
          if (!gig) return null;
          return {
            assignment,
            gig,
            status: normalizeAssignmentStatus(assignment.status) ?? "Assigned",
          };
        })
        .filter((entry): entry is { assignment: GigAssignment; gig: GigSummary; status: string } => Boolean(entry)),
    [jobAssignments, jobGigById]
  );

  const appliedJobCards = useMemo(
    () =>
      jobApplications
        .map((application) => {
          const gig = jobGigById.get(String(application.gigId));
          if (!gig) return null;
          const proposalStatus = normalizeApplicationStatus(application.proposal?.reviewStatus);
          return {
            application,
            gig,
            status: proposalStatus ?? normalizeApplicationStatus(application.status) ?? "Pending",
          };
        })
        .filter((entry): entry is { application: GigApplication; gig: GigSummary; status: string } => Boolean(entry)),
    [jobApplications, jobGigById]
  );

  const browseableJobs = useMemo(
    () =>
      jobGigs
        .filter((gig) => isGigActive(gig) && !isWorkspaceGig(gig))
        .sort((a, b) => parsePayoutAmount(b.payout) - parsePayoutAmount(a.payout)),
    [jobGigs]
  );

  const jobsOverview = useMemo(
    () => ({
      assigned: assignedJobCards.length,
      applied: appliedJobCards.length,
      open: browseableJobs.length,
    }),
    [assignedJobCards.length, appliedJobCards.length, browseableJobs.length]
  );

  const showOperationsEmptyState = useMemo(
    () =>
      assignedJobCards.length === 0 &&
      assignedAccounts.length === 0 &&
      filtered.length === 0 &&
      upcomingItems.length === 0 &&
      kpis.count === 0,
    [assignedAccounts.length, assignedJobCards.length, filtered.length, kpis.count, upcomingItems.length]
  );

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
    const scope = operationalKpiScope;
    const started = scope.filter((x) => !!x.startedAt).length;
    const completed = scope.filter((x) => !!x.completedAt || x.status === "Approved" || x.status === "Submitted").length;
    const now = new Date();

    const completedReels = scope.filter((x) => x.type === "Reel posting" && (x.status === "Approved" || x.status === "Submitted") && !!x.startedAt);
    const slaEvaluated = scope.filter((x) => !!parseWorkDate(x.startedAt) && x.slaMinutes > 0 &&
      (!x.completedAt || workDurationMinutes(x.startedAt, x.completedAt) !== undefined) &&
      (x.status === "Submitted" || x.status === "Approved" || x.status === "In progress"));

    const slaMetCount = slaEvaluated.filter((x) => {
      if (!x.startedAt) return false;
      const startedAt = parseWorkDate(x.startedAt);
      if (!startedAt) return false;
      const end = parseWorkDate(x.completedAt) ?? now;
      const elapsed = minutesBetween(startedAt, end);
      return elapsed <= x.slaMinutes;
    }).length;

    const slaBreachedCount = slaEvaluated.length - slaMetCount;
    const slaRate = slaEvaluated.length > 0 ? Math.round((slaMetCount / slaEvaluated.length) * 100) : 0;

    const avgCompletionMins = (() => {
      const done = scope.map((x) => workDurationMinutes(x.startedAt, x.completedAt)).filter((duration): duration is number => duration !== undefined);
      if (done.length === 0) return 0;
      const sum = done.reduce((sum, duration) => sum + duration, 0);
      return Math.round(sum / done.length);
    })();

    const onTimeDueCount = scope.filter((x) => {
      if (!x.completedAt) return false;
      const due = parseWorkDate(x.dueAt);
      const done = parseWorkDate(x.completedAt);
      return !!due && !!done && done.getTime() <= due.getTime();
    }).length;

    const dueEvaluated = scope.filter((x) => !!parseWorkDate(x.completedAt) && !!parseWorkDate(x.dueAt)).length;
    const dueOnTimeRate = dueEvaluated > 0 ? Math.round((onTimeDueCount / dueEvaluated) * 100) : 0;

    const earningsApproved = scope.filter((x) => x.status === "Approved").reduce((s, x) => s + x.rewardINR, 0) + credentialWallet.earnings;
    const pendingSubmitted = scope.filter((x) => x.status === "Submitted").reduce((s, x) => s + x.rewardINR, 0) + credentialWallet.pending;
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
  }, [credentialWallet.earnings, credentialWallet.pending, operationalKpiScope, tick]);

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

    const next = { ...upi, verified: false, verifiedAt: undefined };

    const res = await fetchJSON<UpiConfig>(`/api/upi`, { method: "PUT", body: JSON.stringify({ workerId: effectiveWorkerId, ...next }) });
    if (!res.ok) {
      setUpiVerifyError(res.error || "Unable to save UPI right now.");
      showUpiNotice("danger", "UPI save failed. Please retry.");
      return;
    }
    setUpi(res.data);
    writeLS(LS_KEYS.UPI, res.data);
    showUpiNotice("success", res.data.verified ? "UPI saved." : "UPI saved. Administrator verification is pending.");
  }, [upi, effectiveWorkerId, isWorkerAuthed, showUpiNotice]);

  const submitKyc = useCallback(async () => {
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
      setKycRejection(null);
    } catch (e: any) {
      setKycError(e?.message || "Submission failed");
    } finally {
      setKycLoading(false);
    }
  }, [kycForm]);

  const openIntroVideoPicker = useCallback(() => {
    introVideoInputRef.current?.click();
  }, []);

  const saveProfileDraft = useCallback(async () => {
    if (!me) return;
    if (profileSaving) return;
    if (!personalInfoDirty) {
      setProfileNotice({ tone: "success", text: "No unsaved changes." });
      window.setTimeout(() => setProfileNotice(null), 2200);
      return;
    }
    setProfileSaving(true);
    const res = await fetchJSON<{ ok: true; worker: Partial<WorkerProfile> & { workerId?: string; userId?: string } }>("/api/workers", {
      method: "PATCH",
      body: JSON.stringify({
        workerId: effectiveWorkerId,
        // Headline, location and bio are edited on the dashboard profile; resending the stored (or placeholder)
        // values from here would overwrite them.
        name: profileDraft.name.trim(),
      }),
    });
    if (!res.ok) {
      setProfileSaving(false);
      setProfileNotice({ tone: "danger", text: res.error || "Unable to save profile." });
      window.setTimeout(() => setProfileNotice(null), 3200);
      return;
    }

    const nextWorkers = workers.map((worker) =>
      worker.id === me.id || worker.workerId === me.workerId
        ? {
            ...worker,
            ...res.data.worker,
            id: worker.id,
            workerId: worker.workerId ?? effectiveWorkerId,
            email: worker.email,
          }
        : worker
    );
    setWorkers(nextWorkers);
    writeLS(LS_KEYS.WORKERS, nextWorkers);
    setProfileSaving(false);
    setProfileNotice({ tone: "success", text: "Profile changes saved." });
    window.setTimeout(() => setProfileNotice(null), 3200);
  }, [effectiveWorkerId, me, personalInfoDirty, profileDraft.name, profileSaving, workers]);

  const focusNotifications = useCallback(() => {
    setNotificationCenterOpen(true);
  }, []);

  const onIntroVideoSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 200 * 1024 * 1024) {
      setProfileNotice({ tone: "danger", text: "Presentation video must be 200MB or smaller." });
      window.setTimeout(() => setProfileNotice(null), 3200);
      event.target.value = "";
      return;
    }
    if (introVideoUploadTimerRef.current) window.clearInterval(introVideoUploadTimerRef.current);
    if (introVideoUploadCompleteRef.current) window.clearTimeout(introVideoUploadCompleteRef.current);
    setIntroVideoUploading(true);
    setIntroVideoUploadProgress(8);
    setIntroVideoPendingName(file.name);
    setProfileNotice(null);

    introVideoUploadTimerRef.current = window.setInterval(() => {
      setIntroVideoUploadProgress((prev) => (prev >= 92 ? prev : prev + Math.max(4, Math.round((100 - prev) * 0.12))));
    }, 120);

    try {
      const tempObjectUrl = URL.createObjectURL(file);
      const thumbnailPromise = createVideoThumbnail(file, tempObjectUrl)
        .catch(() => "")
        .finally(() => URL.revokeObjectURL(tempObjectUrl));

      const formData = new FormData();
      formData.append("file", file);

      const thumbnailDataUrl = await thumbnailPromise;
      const thumbnailFile = thumbnailDataUrl ? dataUrlToFile(thumbnailDataUrl, `${file.name.replace(/\.[^.]+$/, "")}-thumbnail`) : null;
      if (thumbnailFile) formData.append("thumbnail", thumbnailFile);

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Session expired. Please sign in again.");

      const uploadRes = await fetch("/api/me/presentation-video", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const payload = await uploadRes.json().catch(() => ({}));
      if (!uploadRes.ok || !payload?.ok) {
        throw new Error(payload?.error || "Unable to upload presentation video.");
      }

      const refreshed = await fetchJSON<{ ok: true; introVideo: IntroVideoMeta | null }>("/api/me/presentation-video", {
        method: "GET",
      });

      if (introVideoUploadTimerRef.current) {
        window.clearInterval(introVideoUploadTimerRef.current);
        introVideoUploadTimerRef.current = null;
      }
      setIntroVideoUploadProgress(100);
      introVideoUploadCompleteRef.current = window.setTimeout(() => {
        const nextMeta = (refreshed.ok ? refreshed.data.introVideo : payload?.introVideo ?? null) as IntroVideoMeta | null;
        setIntroVideo(nextMeta);
        setIntroVideoUploading(false);
        setIntroVideoPendingName("");
        setIntroVideoUploadProgress(0);
        if (nextMeta) writeLS(LS_KEYS.INTRO_VIDEO, nextMeta);
        else removeLS(LS_KEYS.INTRO_VIDEO);
      }, 220);
    } catch (err: unknown) {
      if (introVideoUploadTimerRef.current) {
        window.clearInterval(introVideoUploadTimerRef.current);
        introVideoUploadTimerRef.current = null;
      }
      if (introVideoUploadCompleteRef.current) {
        window.clearTimeout(introVideoUploadCompleteRef.current);
        introVideoUploadCompleteRef.current = null;
      }
      setIntroVideoUploading(false);
      setIntroVideoPendingName("");
      setIntroVideoUploadProgress(0);
      setProfileNotice({ tone: "danger", text: err instanceof Error ? err.message : "Unable to upload presentation video." });
      window.setTimeout(() => setProfileNotice(null), 3600);
    }
    event.target.value = "";
  }, []);


  const openNotification = useCallback(
    (notification: WorkspaceNotification) => {
      setNotificationCenterOpen(false);
      markNotificationRead(notification.id, notification.revision);
      if (notification.action === "introVideo" || notification.action === "profile") {
        setActiveSection("Profile");
        return;
      }
      if (notification.action === "selectedItem" && selected) {
        openDetails(selected.id);
        return;
      }
      setActiveSection("Payouts");
    },
    [markNotificationRead, openDetails, selected]
  );

  const payoutRequestRunning = useRef(false);
  const requestPayout = useCallback(async () => {
    if (!isWorkerAuthed || payoutRequestRunning.current) return;
    if (!payoutReadiness.ready) {
      showPayoutNotice("danger", payoutReadiness.primaryBlocker?.detail || "Payout request is blocked.");
      return;
    }

    payoutRequestRunning.current = true;
    try {
    const res = await fetchJSON<{ ok: boolean; batchId?: string }>(`/api/payoutbatches/request`, {
      method: "POST",
      body: JSON.stringify({ workerId: effectiveWorkerId }),
    });
    if (!res.ok) {
      showPayoutNotice("danger", res.error || "Payout request failed.");
      return;
    }
    showPayoutNotice("success", "Payout request submitted.");
    await loadFromApi();
    } finally { payoutRequestRunning.current = false; }
  }, [isWorkerAuthed, payoutReadiness, effectiveWorkerId, showPayoutNotice, loadFromApi]);

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
    if (!isWorkerAuthed || !payoutReadiness.ready) return;
    if (!autoPayoutKey) return;
    const lastKey = readLS<string | null>(LS_KEYS.PAYOUTS + ":auto", null);
    if (lastKey === autoPayoutKey) return;
    writeLS(LS_KEYS.PAYOUTS + ":auto", autoPayoutKey);
    requestPayout();
  }, [isWorkerAuthed, payoutReadiness.ready, autoPayoutKey, requestPayout]);

  const currentDraftBatch = useMemo(() => payoutBatches.find((b) => b.status === "Draft") ?? null, [payoutBatches]);
  const myBatches = useMemo(() => payoutBatches.slice().sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1)), [payoutBatches]);

  const batchTotals = useCallback((b: PayoutBatch) => {
    const total = b.items.reduce((s, it) => s + it.amountINR, 0);
    const paid = b.items.filter((it) => it.status === "Paid").reduce((s, it) => s + it.amountINR, 0);
    return { total, paid, count: b.items.length };
  }, []);

  const selfieStep1Done = cameraOn || !!selfiePreview || !!selfieFile || !!kycForm.selfiePath;
  const selfieStep2Done = !!selfiePreview || !!selfieFile || !!kycForm.selfiePath;
  const selfieStep3Done = !!kycForm.selfiePath;
  const selfieActiveStep = !selfieStep1Done ? 1 : !selfieStep2Done ? 2 : !selfieStep3Done ? 3 : 0;
  const renderKycManagementPanel = () => (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#d9e4de] bg-[#f7fbf8] px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#738476]">KYC status</div>
            <div className="mt-1 text-lg font-semibold text-[#234538]">{kycMeta.label}</div>
            <div className="mt-1 text-sm leading-6 text-[#617166]">{kycMeta.description}</div>
          </div>
          <span
            className={cx(
              "rounded-full px-3 py-1 text-xs font-semibold",
              kycMeta.tone === "success"
                ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                : kycMeta.tone === "warn"
                  ? "border border-amber-200 bg-amber-50 text-amber-700"
                  : kycMeta.tone === "danger"
                    ? "border border-rose-200 bg-rose-50 text-rose-700"
                    : "border border-slate-200 bg-white text-slate-600"
            )}
          >
            {kycMeta.label}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-[#d9e4de] bg-white px-3 py-1.5 text-[#617166]">Workspace access remains active</span>
          <span className="rounded-full border border-[#d9e4de] bg-white px-3 py-1.5 text-[#617166]">Payout release requires approved KYC</span>
        </div>
        {kycStatus === "pending" && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={loadFromApi}>
              <Icon name="refresh" />
              Refresh KYC status
            </Button>
          </div>
        )}
      </div>

      {kycError && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{kycError}</div>}

      {kycStatus !== "pending" && (
        <>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
            <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Identity profile</div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-12">
                <label className="text-xs font-semibold text-slate-600 xl:col-span-4">
                  Legal name
                  <input
                    className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
                    value={kycForm.legalName}
                    onChange={(e) => setKycForm((p) => ({ ...p, legalName: e.target.value }))}
                  />
                </label>
                <label className="text-xs font-semibold text-slate-600 xl:col-span-4">
                  Date of birth
                  <div className="mt-2 rounded-xl border border-slate-300 bg-white p-2.5">
                    <div className="grid grid-cols-[minmax(0,0.95fr)_minmax(0,1.15fr)_minmax(0,0.95fr)] gap-2">
                      <select className="min-w-0 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2.5 pr-8 text-xs font-semibold text-slate-900 md:text-sm" value={dobParts.day} onChange={(e) => updateDobPart("day", e.target.value)}>
                        <option value="">Day</option>
                        {dobDayOptions.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                      <select className="min-w-0 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2.5 pr-8 text-xs font-semibold text-slate-900 md:text-sm" value={dobParts.month} onChange={(e) => updateDobPart("month", e.target.value)}>
                        <option value="">Month</option>
                        {dobMonthOptions.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                      <select className="min-w-0 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2.5 pr-8 text-xs font-semibold text-slate-900 md:text-sm" value={dobParts.year} onChange={(e) => updateDobPart("year", e.target.value)}>
                        <option value="">Year</option>
                        {dobYearOptions.map((y) => (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="mt-2 text-[11px] leading-4 text-slate-500">DD/MM/YYYY • 18+</div>
                  </div>
                </label>
                <label className="text-xs font-semibold text-slate-600 xl:col-span-4">
                  Phone
                  <input className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900" value={kycForm.phone} onChange={(e) => setKycForm((p) => ({ ...p, phone: e.target.value }))} />
                </label>
                <label className="text-xs font-semibold text-slate-600 md:col-span-2 xl:col-span-12">
                  Address
                  <input className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900" value={kycForm.address} onChange={(e) => setKycForm((p) => ({ ...p, address: e.target.value }))} />
                </label>
                <label className="text-xs font-semibold text-slate-600 xl:col-span-4">
                  ID type
                  <select className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900" value={kycForm.idType} onChange={(e) => setKycForm((p) => ({ ...p, idType: e.target.value }))}>
                    <option value="">Select</option>
                    <option value="Passport">Passport</option>
                    <option value="Driver License">Driver License</option>
                    <option value="National ID">National ID</option>
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-600 xl:col-span-8">
                  ID number
                  <input className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900" value={kycForm.idNumber} onChange={(e) => setKycForm((p) => ({ ...p, idNumber: e.target.value }))} />
                </label>
                <label className="text-xs font-semibold text-slate-600 md:col-span-2 xl:col-span-12">
                  ID document (front)
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        await uploadKycFile("id_doc", file);
                      }}
                    />
                    <span className={cx("shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold", kycForm.idDocPath ? "border border-emerald-200 bg-emerald-50 text-emerald-700" : "border border-slate-200 bg-white text-slate-500")}>
                      {kycForm.idDocPath ? "Document uploaded" : "Awaiting document"}
                    </span>
                  </div>
                </label>
              </div>
            </div>

            <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Selfie verification</div>
              <div className="mt-4 rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Live capture required</div>
                    <div className="mt-1 text-sm text-slate-500">Quick live selfie required for payout approval.</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cameraOn ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
                      {cameraOn ? "Camera live" : "Camera off"}
                    </span>
                    {cameraOn ? (
                      <button type="button" className="text-xs font-semibold text-slate-600 hover:text-slate-900" onClick={stopCamera}>
                        Stop camera
                      </button>
                    ) : (
                      <button type="button" className="text-xs font-semibold text-[#1f4f43] hover:text-[#2d6b5a]" onClick={startCamera}>
                        Start camera
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid gap-2 md:grid-cols-3 text-[11px] text-slate-500">
                  <div className={`rounded-xl border px-3 py-2.5 ${selfieStep1Done ? "border-emerald-200 bg-emerald-50 text-emerald-700" : selfieActiveStep === 1 ? "border-[#bcd6c9] bg-[#edf5ef] text-[#2f6655]" : "border-slate-200 bg-white text-slate-500"}`}>
                    <div className="font-semibold uppercase tracking-[0.12em]">Step 1</div>
                    <div className="mt-1 text-xs normal-case tracking-normal">Start camera</div>
                  </div>
                  <div className={`rounded-xl border px-3 py-2.5 ${selfieStep2Done ? "border-emerald-200 bg-emerald-50 text-emerald-700" : selfieActiveStep === 2 ? "border-[#bcd6c9] bg-[#edf5ef] text-[#2f6655]" : "border-slate-200 bg-white text-slate-500"}`}>
                    <div className="font-semibold uppercase tracking-[0.12em]">Step 2</div>
                    <div className="mt-1 text-xs normal-case tracking-normal">Capture selfie</div>
                  </div>
                  <div className={`rounded-xl border px-3 py-2.5 ${selfieStep3Done ? "border-emerald-200 bg-emerald-50 text-emerald-700" : selfieActiveStep === 3 ? "border-[#bcd6c9] bg-[#edf5ef] text-[#2f6655]" : "border-slate-200 bg-white text-slate-500"}`}>
                    <div className="font-semibold uppercase tracking-[0.12em]">Step 3</div>
                    <div className="mt-1 text-xs normal-case tracking-normal">Upload proof</div>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                    <div className="absolute left-2 top-2 z-10 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-slate-600">Live feed</div>
                    {cameraOn && selfieChallenge ? (
                      <div className="absolute inset-x-2 bottom-2 z-10 rounded-lg bg-white/95 px-2 py-1 text-center text-[11px] font-semibold text-slate-800 shadow">Before capturing: {selfieChallenge}</div>
                    ) : null}
                    <video ref={videoRef} className={`h-36 w-full object-cover ${cameraOn ? "block" : "hidden"}`} playsInline />
                    {!cameraOn && <div className="flex h-36 items-center justify-center text-sm text-slate-400">Camera preview</div>}
                  </div>
                  <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                    <div className="absolute left-2 top-2 z-10 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-slate-600">Captured image</div>
                    {selfiePreview ? <img src={selfiePreview} alt="Selfie preview" className="h-36 w-full object-cover" /> : <div className="flex h-36 items-center justify-center text-sm text-slate-400">No selfie captured</div>}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {cameraError && <div className="text-xs font-semibold text-rose-600">{cameraError}</div>}
                  {kycForm.selfiePath && <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700">Selfie uploaded</div>}
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <button type="button" className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-300 disabled:opacity-60" onClick={startCamera} disabled={cameraOn}>
                    Start live camera
                  </button>
                  <button type="button" className="rounded-xl bg-[#1f4f43] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#2d6b5a] disabled:opacity-60" onClick={captureSelfie} disabled={!cameraOn}>
                    Capture selfie
                  </button>
                  <button type="button" className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-300 disabled:opacity-60" onClick={async () => {
                    if (!selfieFile) return;
                    await uploadKycFile("selfie", selfieFile);
                  }} disabled={!selfieFile || kycLoading}>
                    Upload selfie
                  </button>
                  <button type="button" className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-300" onClick={() => {
                    setSelfiePreview(null);
                    setKycForm((p) => ({ ...p, selfiePath: "" }));
                    setSelfieFile(null);
                  }}>
                    Retake
                  </button>
                </div>
                <canvas ref={canvasRef} className="hidden" />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-slate-600">Review every field before submitting. Workspace stays available, but payouts stay locked until admin approval.</div>
            <button className="rounded-full bg-[#1f4f43] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#2d6b5a] disabled:opacity-60 sm:shrink-0" disabled={kycLoading} onClick={submitKyc}>
              {kycLoading ? "Submitting..." : "Submit KYC"}
            </button>
          </div>
        </>
      )}
    </div>
  );

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

  return (
    <div className="ops-dashboard-skin min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_top,#f7f9fd_0%,#eef2f8_38%,#e9edf4_100%)]">
      {/* Mobile navigation */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-slate-900/30" onClick={() => setMobileNavOpen(false)} />
          <div className="absolute left-2 top-1.5 h-[calc(100%-0.75rem)] w-[92vw] max-w-[352px] overflow-hidden rounded-[24px] bg-[#f8fbff] shadow-[0_20px_48px_rgba(34,54,78,0.18)] sm:left-0 sm:top-0 sm:h-full sm:w-[88vw] sm:max-w-[320px] sm:rounded-none sm:shadow-xl">
            <SidebarWorker activeSection={activeSection} setActiveSection={setActiveSection} onClose={() => setMobileNavOpen(false)} workerName={creatorDisplayName} workerLevel={levelLabel} />
          </div>
        </div>
      )}

      {/* Mobile details drawer */}
      {detailsOpenMobile && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Work item details">
          <div className="absolute inset-0 bg-slate-900/30" onClick={() => setDetailsOpenMobile(false)} />
          <div className="absolute right-0 top-0 h-full w-[92vw] max-w-[560px] bg-[#f8fbff] shadow-xl">
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

      <div className="flex min-h-screen w-full overflow-x-hidden bg-transparent">
        {/* Desktop sidebar */}
        <aside className="hidden w-[236px] shrink-0 px-3 py-3 lg:block xl:w-[244px] xl:px-4 2xl:w-[248px]">
          <div className="sticky top-3 h-[calc(100vh-1.5rem)]">
            <div className="mx-auto h-full max-w-[244px]">
              <SidebarWorker activeSection={activeSection} setActiveSection={setActiveSection} workerName={creatorDisplayName} workerLevel={levelLabel} />
            </div>
          </div>
        </aside>

        {/* Main */}
        <div className="min-w-0 flex-1">
          {/* Header */}
          <header className="sticky top-0 z-40 border-b border-[#e2e8f0]/80 bg-[rgba(248,250,254,0.9)] backdrop-blur-xl">
            <div className="mx-auto max-w-[1440px] px-3 py-3 sm:px-6 lg:px-8">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 xl:flex-nowrap">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <button
                    className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[#dde4ed] bg-white shadow-[0_10px_20px_rgba(34,54,78,0.06)] hover:bg-[#f3f7fb] lg:hidden"
                    onClick={() => setMobileNavOpen(true)}
                    aria-label="Open navigation"
                  >
                    <Icon name="hamburger" className="text-slate-700" />
                  </button>

                  <div className="min-w-0">
                    <div className="truncate text-[1.22rem] font-black tracking-[-0.05em] text-[#1b2d41] sm:text-[1.42rem] lg:text-[1.7rem]">
                      {activeSection === "Operations"
                        ? "Dashboard"
                        : activeSection === "Jobs"
                          ? "Jobs"
                        : activeSection === "Profile"
                          ? "Edit profile"
                        : activeSection === "Accounts"
                          ? "Accounts"
                          : activeSection === "Payouts"
                            ? "Payouts"
                            : activeSection === "Performance"
                              ? "Insights"
                              : "Payment setup"}
                    </div>
                  </div>
                </div>

                <div className="flex max-w-full flex-wrap items-center justify-end gap-2 sm:gap-3">
                  <Button variant="secondary" onClick={loadFromApi} title="Reload from API" className="min-w-[52px] rounded-[1.2rem] px-2.5 py-2 text-[#3c4c5f] shadow-[0_10px_22px_rgba(34,54,78,0.05)] sm:min-w-[118px] sm:px-4 sm:py-2.5">
                    <Icon name="refresh" />
                    <span className="hidden sm:inline">{loading ? "Syncing…" : "Sync"}</span>
                  </Button>

                  <Button variant="ghost" onClick={focusNotifications} className="relative min-w-[52px] rounded-[1.2rem] px-2.5 py-2 text-slate-700 sm:min-w-[116px] sm:px-4 sm:py-2.5" title="Alerts">
                    <Icon name="bell" />
                    {unreadNotificationCount > 0 && (
                      <span className="absolute -right-1 -top-1 inline-flex h-[1.25rem] min-w-[1.25rem] items-center justify-center rounded-full border-2 border-white bg-[#3565f0] px-1 text-[9px] font-black leading-none text-white shadow-[0_6px_14px_rgba(53,101,240,0.22)] sm:right-1 sm:top-1 sm:h-[1.15rem] sm:min-w-[1.15rem] sm:border sm:px-1">
                        {Math.min(unreadNotificationCount, 9)}
                      </span>
                    )}
                    <span className="hidden sm:inline">Alerts</span>
                  </Button>

                  <Button variant="secondary" onClick={logout} title="Logout" className="min-w-[52px] rounded-[1.2rem] px-2.5 py-2 text-[#3c4c5f] shadow-[0_10px_22px_rgba(34,54,78,0.05)] sm:min-w-[118px] sm:px-4 sm:py-2.5">
                    <Icon name="lock" />
                    <span className="hidden sm:inline">Logout</span>
                  </Button>
                </div>
              </div>
            </div>
          </header>

          {/* Body */}
          <main className="mx-auto max-w-[1440px] px-3 py-5 sm:px-6 sm:py-6 lg:px-8">
            <input ref={introVideoInputRef} type="file" accept="video/*" className="hidden" onChange={onIntroVideoSelected} />
            {kycStatus !== "approved" && activeSection !== "Operations" && activeSection !== "Profile" && (
              <div className="mb-5 rounded-[1.35rem] border border-[#dfe6ef] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(245,248,253,0.96))] px-4 py-3.5 shadow-[0_14px_30px_rgba(34,54,78,0.06)]">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#eef3ff] text-[#3d5ec2]">
                      <Icon name="settings" className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[0.66rem] font-black uppercase tracking-[0.18em] text-[#8a95a3]">Compliance update</div>
                      <div className="mt-1 text-[0.98rem] font-black tracking-[-0.03em] text-[#223142] sm:text-[1.04rem]">
                        Payout requests are gated by KYC approval.
                      </div>
                      <div className="mt-1 text-sm text-[#748292]">
                        {kycMeta.description}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <button
                      type="button"
                      onClick={() => setActiveSection("Payouts")}
                      className="inline-flex items-center gap-2 rounded-full border border-[#dbe2ec] bg-white px-3.5 py-2 text-sm font-black text-[#314255] transition hover:bg-[#f4f7fb]"
                    >
                      <Icon name="wallet" />
                      <span>Compliance</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveSection("UPI")}
                      className="inline-flex items-center gap-2 rounded-full border border-[#dbe2ec] bg-white px-3.5 py-2 text-sm font-black text-[#314255] transition hover:bg-[#f4f7fb]"
                    >
                      <Icon name="settings" />
                      <span>UPI setup</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* OPERATIONS */}
            {activeSection === "Operations" && (
              <>
                <section className="mx-auto max-w-[1120px]">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setActiveSection("Jobs")}
                      className="group flex w-full items-center justify-between gap-3 rounded-[1.8rem] border border-[#e6e0d4] bg-white px-5 py-5 text-left shadow-[0_18px_36px_rgba(30,44,35,0.05)] transition hover:-translate-y-[1px] hover:bg-[#fffefb] sm:px-6 sm:py-6"
                    >
                      <div className="flex min-w-0 items-center gap-4">
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1rem] bg-[#fff4cb] text-[#b37c1d]">
                          <Icon name="tasks" className="h-5 w-5" />
                        </span>
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <span className="text-[2rem] font-black leading-none tracking-[-0.05em] text-[#223142]">{jobsOverview.applied}</span>
                            <span className="text-[1rem] font-bold text-[#6d716b]">applications</span>
                          </span>
                          <span className="mt-1 block text-[0.95rem] text-[#7b8796]">View your applications</span>
                        </span>
                      </div>
                      <span className="text-[#b0a48e] transition group-hover:translate-x-[1px]">
                        <Icon name="chevRight" />
                      </span>
                    </button>

                    <Link
                      href={FIND_GIGS_HREF}
                      className="group flex w-full items-center justify-between gap-3 rounded-[1.8rem] border border-[#e6e0d4] bg-white px-5 py-5 text-left shadow-[0_18px_36px_rgba(30,44,35,0.05)] transition hover:-translate-y-[1px] hover:bg-[#fffefb] sm:px-6 sm:py-6"
                    >
                      <span className="flex min-w-0 items-center gap-4">
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1rem] bg-[#edf7ee] text-[#3f6658]">
                          <Icon name="briefcase" className="h-5 w-5" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[1.08rem] font-black tracking-[-0.03em] text-[#223142]">Jobs available</span>
                          <span className="mt-1 block text-[0.95rem] text-[#7b8796]">
                            {browseableJobs.length > 0 ? "Find more opportunities" : "Opportunity feed will appear here"}
                          </span>
                        </span>
                      </span>
                      <span className="text-[#b0a48e] transition group-hover:translate-x-[1px]">
                        <Icon name="chevRight" />
                      </span>
                    </Link>
                  </div>
                </section>

                {showOperationsEmptyState ? (
                  <section className="mx-auto mt-6 max-w-[1120px] overflow-hidden rounded-[1.95rem] border border-[#dce5db] bg-[radial-gradient(circle_at_top,rgba(240,245,236,0.92),transparent_34%),linear-gradient(180deg,#fffdf9,#fbfcf8)] shadow-[0_22px_50px_rgba(22,58,46,0.06)]">
                    <div className="relative overflow-hidden px-5 py-12 sm:px-8 sm:py-14 lg:px-10 lg:py-16">
                      <div className="absolute left-[-56px] top-[-72px] h-40 w-40 rounded-full bg-[#eef4ea] blur-3xl" />
                      <div className="absolute bottom-[-58px] right-[10%] h-36 w-36 rounded-full bg-[#f4f0dc] blur-3xl" />

                      <div className="relative mx-auto flex max-w-[54rem] flex-col items-center text-center">
                        <div className="relative flex h-24 w-24 items-center justify-center sm:h-28 sm:w-28" aria-hidden="true">
                          <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_35%_26%,#ffffff_0%,#f3f8ef_34%,#e7f0e3_100%)] shadow-[0_28px_52px_rgba(36,67,54,0.14),inset_0_1px_0_rgba(255,255,255,0.95),inset_0_-18px_30px_rgba(104,129,112,0.08)]" />
                          <div className="absolute inset-[9px] rounded-full border border-white/80 bg-[radial-gradient(circle_at_42%_28%,rgba(255,255,255,0.76),transparent_34%)]" />
                          <div className="absolute bottom-1 h-5 w-16 rounded-full bg-[#9fac9f]/24 blur-xl" />
                          <svg className="relative h-14 w-14 drop-shadow-[0_16px_18px_rgba(57,83,71,0.22)] sm:h-16 sm:w-16" viewBox="0 0 96 96" fill="none">
                            <defs>
                              <linearGradient id="workspaceBriefcaseTop" x1="48" y1="18" x2="48" y2="80" gradientUnits="userSpaceOnUse">
                                <stop stopColor="#aebcaf" />
                                <stop offset="0.48" stopColor="#8fa194" />
                                <stop offset="1" stopColor="#73877d" />
                              </linearGradient>
                              <linearGradient id="workspaceBriefcaseFace" x1="27" y1="35" x2="70" y2="75" gradientUnits="userSpaceOnUse">
                                <stop stopColor="#f8fbf5" />
                                <stop offset="0.54" stopColor="#dce7dc" />
                                <stop offset="1" stopColor="#9daf9f" />
                              </linearGradient>
                              <linearGradient id="workspaceBriefcaseRim" x1="48" y1="27" x2="48" y2="76" gradientUnits="userSpaceOnUse">
                                <stop stopColor="#8fa092" />
                                <stop offset="1" stopColor="#63786f" />
                              </linearGradient>
                            </defs>
                            <path d="M32 33.5v-6.2c0-5.1 4.1-9.3 9.3-9.3h13.4c5.2 0 9.3 4.2 9.3 9.3v6.2" stroke="url(#workspaceBriefcaseTop)" strokeWidth="8" strokeLinecap="round" />
                            <path d="M24.8 35.5h46.4c6.8 0 12.3 5.5 12.3 12.3v21c0 6.8-5.5 12.3-12.3 12.3H24.8c-6.8 0-12.3-5.5-12.3-12.3v-21c0-6.8 5.5-12.3 12.3-12.3Z" fill="url(#workspaceBriefcaseFace)" />
                            <path d="M24.8 35.5h46.4c6.8 0 12.3 5.5 12.3 12.3v21c0 6.8-5.5 12.3-12.3 12.3H24.8c-6.8 0-12.3-5.5-12.3-12.3v-21c0-6.8 5.5-12.3 12.3-12.3Z" stroke="url(#workspaceBriefcaseRim)" strokeWidth="6" />
                            <path d="M17 54.5h62" stroke="#7f9186" strokeWidth="5" strokeLinecap="round" opacity="0.78" />
                            <path d="M34 38.5h28" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" opacity="0.78" />
                            <path d="M30 72h36" stroke="#6f8378" strokeWidth="4" strokeLinecap="round" opacity="0.42" />
                            <path d="M26 41.5h44" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity="0.45" />
                          </svg>
                        </div>

                        <h2 className="mt-6 text-[2rem] font-black leading-[0.96] tracking-[-0.06em] text-[#173028] sm:text-[2.5rem] lg:text-[3rem]">
                          Ready to start?
                        </h2>
                        <p className="mt-3 max-w-[34rem] text-[0.98rem] leading-7 text-[#6e7d72] sm:text-[1.08rem]">
                          Browse available jobs and start applying.
                        </p>

                        <Link
                          href={FIND_GIGS_HREF}
                          className="mt-7 inline-flex min-h-[54px] w-full max-w-[240px] items-center justify-center gap-3 rounded-[1.1rem] bg-[#2f5d52] px-6 py-3 text-[0.98rem] font-black text-white shadow-[0_18px_32px_rgba(47,93,82,0.2)] transition hover:translate-y-[-1px] hover:bg-[#274d44] hover:shadow-[0_22px_36px_rgba(47,93,82,0.24)] sm:min-h-[58px] sm:px-7 sm:py-3.5 sm:text-[1rem]"
                        >
                          <span>Browse Jobs</span>
                          <Icon name="chevRight" className="h-5 w-5" />
                        </Link>

                        <div className="mt-8 grid w-full max-w-[70rem] grid-cols-1 gap-3 min-[520px]:grid-cols-3 sm:mt-10 sm:gap-4">
                          <div className="rounded-[1.35rem] border border-[#e2e7d8] bg-[linear-gradient(180deg,#fffefb,#fcfaf2)] px-5 py-4 shadow-[0_10px_24px_rgba(22,58,46,0.03)]">
                            <div className="text-[0.72rem] font-black uppercase tracking-[0.22em] text-[#ab9d86]">Open roles</div>
                            <div className="mt-2 text-[2rem] font-black leading-none tracking-[-0.05em] text-[#21362f]">{jobsOverview.open}</div>
                          </div>
                          <div className="rounded-[1.35rem] border border-[#e2e7d8] bg-[linear-gradient(180deg,#fffefb,#fcfaf2)] px-5 py-4 shadow-[0_10px_24px_rgba(22,58,46,0.03)]">
                            <div className="text-[0.72rem] font-black uppercase tracking-[0.22em] text-[#ab9d86]">Unread updates</div>
                            <div className="mt-2 text-[2rem] font-black leading-none tracking-[-0.05em] text-[#21362f]">{unreadNotificationCount}</div>
                          </div>
                          <div className="rounded-[1.35rem] border border-[#e2e7d8] bg-[linear-gradient(180deg,#fffefb,#fcfaf2)] px-5 py-4 shadow-[0_10px_24px_rgba(22,58,46,0.03)]">
                            <div className="text-[0.72rem] font-black uppercase tracking-[0.22em] text-[#ab9d86]">Pending payout</div>
                            <div className="mt-2 text-[2rem] font-black leading-none tracking-[-0.05em] text-[#21362f]">{formatINR(eligiblePayoutTotal)}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>
                ) : (
                  <>
                    <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                      <KPI title="Open" value={String(kpis.open)} hint="Awaiting start" tone="neutral" />
                      <KPI title="In progress" value={String(kpis.inProg)} hint="Running now" tone="info" />
                      <KPI title="Submitted" value={String(kpis.submitted)} hint="Under review" tone="warn" />
                      <KPI title="Approved earnings" value={formatINR(kpis.earnings)} hint="Ready value" tone="info" />
                    </div>

                    <div className="mt-6 grid grid-cols-12 gap-5 lg:gap-6">
                      <div className="col-span-12 space-y-5 lg:col-span-8 lg:space-y-6">
                        <Card title="Queue" subtitle="Open and active work" right={<Chip tone="info">Tap to open</Chip>}>
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

                        {upcomingItems.length > 0 && (
                          <Card
                            title="Upcoming"
                            subtitle="Next reel windows"
                            right={<Chip tone="neutral">{upcomingItems.length}</Chip>}
                          >
                            <div className="space-y-2">
                              {upcomingItems.map((x) => {
                                const acc = accountById(x.accountId);
                                const dueUtc = parseWorkDate(x.dueAt);
                                if (!dueUtc) return null;
                                const windowStart = new Date(dueUtc.getTime() - x.slaMinutes * 60 * 1000);
                                const minutesToWindow = Math.max(0, minutesBetween(new Date(), windowStart));
                                return (
                                  <div key={x.id} className="flex items-center justify-between rounded-2xl border border-[#dde5de] bg-[linear-gradient(180deg,#ffffff,#f6faf3)] px-3.5 py-3">
                                    <div className="min-w-0">
                                      <div className="text-sm font-extrabold text-slate-900 truncate">{x.title}</div>
                                      <div className="text-xs text-slate-600 truncate">
                                        {acc?.handle ?? x.accountId} • {minutesToWindow}m • {formatDueWithTz(x.dueAt)}
                                      </div>
                                    </div>
                                    <Chip tone="neutral">Soon</Chip>
                                  </div>
                                );
                              })}
                            </div>
                          </Card>
                        )}

                        {assignedAccounts.length > 0 ? (
                          <Card title="Assigned accounts" subtitle="Your live handles" right={<Chip tone="neutral">{assignedAccounts.length}</Chip>}>
                            <AssignedAccountsGrid accounts={assignedAccounts} q={q} />
                          </Card>
                        ) : (
                          <Card title="Account coverage" subtitle="Assignment status">
                            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-700">
                              No account workstreams are assigned yet. Once admin links handles to this worker, they will appear here.
                            </div>
                          </Card>
                        )}
                      </div>

                      <div className="col-span-12 space-y-5 lg:col-span-4 lg:space-y-6">
                        <Card
                          title="Workspace status"
                          subtitle="Readiness and quick actions"
                          right={payoutReadiness.ready ? <Chip tone="success">Ready</Chip> : <Chip tone="warn">Blocked</Chip>}
                        >
                          <div className="space-y-4 text-sm text-slate-700">
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                                <div className="text-[0.68rem] font-black uppercase tracking-[0.16em] text-slate-500">KYC</div>
                                <div className="mt-2 text-base font-black text-slate-900">{kycMeta.label}</div>
                              </div>
                              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                                <div className="text-[0.68rem] font-black uppercase tracking-[0.16em] text-slate-500">UPI</div>
                                <div className="mt-2 text-base font-black text-slate-900">{upi.verified ? "Verified" : "Pending"}</div>
                              </div>
                              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                                <div className="text-[0.68rem] font-black uppercase tracking-[0.16em] text-slate-500">Eligible</div>
                                <div className="mt-2 text-base font-black text-slate-900">{formatINR(eligiblePayoutTotal)}</div>
                              </div>
                              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                                <div className="text-[0.68rem] font-black uppercase tracking-[0.16em] text-slate-500">SLA met</div>
                                <div className="mt-2 text-base font-black text-slate-900">{perf.slaRate}%</div>
                              </div>
                            </div>
                            {payoutReadiness.primaryBlocker ? (
                              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
                                {payoutReadiness.primaryBlocker.detail}
                              </div>
                            ) : (
                              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                                All checks clear. Ready for the next release.
                              </div>
                            )}
                            <div className="flex flex-wrap gap-2">
                              <Button variant="secondary" onClick={() => setActiveSection("Payouts")}>
                                <Icon name="wallet" />
                                Open payouts
                              </Button>
                              <Button variant="secondary" onClick={() => setActiveSection("UPI")}>
                                <Icon name="settings" />
                                Configure UPI
                              </Button>
                              <Button variant="secondary" onClick={() => setActiveSection("Performance")}>
                                <Icon name="performance" />
                                View performance
                              </Button>
                            </div>
                          </div>
                        </Card>

                        {selected && (
                          <DetailsPanelWorker
                            item={selected}
                            account={selectedAccount}
                            onClose={() => setSelectedId(null)}
                            onStart={markStart}
                            onSubmit={openSubmit}
                            gateScore={gateScore}
                            slaMeta={slaMeta}
                          />
                        )}
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

            {/* JOBS */}
            {activeSection === "Jobs" && (
              <>
                <section className="rounded-[1.9rem] border border-[#dbe3d8] bg-[radial-gradient(circle_at_top,rgba(237,244,235,0.72),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(249,251,247,0.97))] p-5 shadow-[0_18px_42px_rgba(22,58,46,0.05)] sm:p-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="text-[0.7rem] font-black uppercase tracking-[0.2em] text-[#7b8e84]">Jobs</div>
                      <h1 className="mt-2.5 text-[1.48rem] font-black tracking-[-0.055em] text-[#172d25] sm:text-[1.82rem]">
                        Assigned and applied work
                      </h1>
                    </div>
                    <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
                      <div className="min-w-[92px] rounded-[1.25rem] border border-[#dfe7dc] bg-white/92 px-4 py-3.5 text-center shadow-[0_8px_18px_rgba(22,58,46,0.03)]">
                        <div className="text-[0.66rem] font-black uppercase tracking-[0.17em] text-[#809288]">Assigned</div>
                        <div className="mt-1.5 text-[1.34rem] font-black tracking-[-0.05em] text-[#173028]">{jobsOverview.assigned}</div>
                      </div>
                      <div className="min-w-[92px] rounded-[1.25rem] border border-[#dfe7dc] bg-white/92 px-4 py-3.5 text-center shadow-[0_8px_18px_rgba(22,58,46,0.03)]">
                        <div className="text-[0.66rem] font-black uppercase tracking-[0.17em] text-[#809288]">Applied</div>
                        <div className="mt-1.5 text-[1.34rem] font-black tracking-[-0.05em] text-[#173028]">{jobsOverview.applied}</div>
                      </div>
                      <div className="min-w-[92px] rounded-[1.25rem] border border-[#dfe7dc] bg-white/92 px-4 py-3.5 text-center shadow-[0_8px_18px_rgba(22,58,46,0.03)]">
                        <div className="text-[0.66rem] font-black uppercase tracking-[0.17em] text-[#809288]">Open</div>
                        <div className="mt-1.5 text-[1.34rem] font-black tracking-[-0.05em] text-[#173028]">{jobsOverview.open}</div>
                      </div>
                    </div>
                  </div>
                </section>

                {assignedJobCards.length === 0 && appliedJobCards.length === 0 ? (
                  <div className="mt-7 rounded-[1.85rem] border border-[#dce4da] bg-[linear-gradient(180deg,#ffffff,#f8fbf6)] px-6 py-14 text-center shadow-[0_10px_24px_rgba(22,58,46,0.04)]">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#f1f4ee] text-[#94a09a] shadow-inner">
                      <Icon name="search" className="h-8 w-8" />
                    </div>
                    <div className="mt-5 text-[1.5rem] font-black tracking-[-0.04em] text-[#172d25]">No campaigns yet</div>
                    <div className="mt-2 text-sm text-[#6c8075]">Find campaigns to apply to and start earning.</div>
                    <Link
                      href={FIND_GIGS_HREF}
                      className="mt-6 inline-flex items-center justify-center rounded-[1rem] bg-[#3565f0] px-5 py-3 text-sm font-black text-white shadow-[0_14px_28px_rgba(53,101,240,0.22)] transition hover:bg-[#2a57d7]"
                    >
                      Find campaigns
                    </Link>
                  </div>
                ) : (
                    <div className="mt-6 grid gap-4.5 xl:grid-cols-[1fr_1fr]">
                      <div className="rounded-[1.55rem] border border-[#dce4da] bg-[linear-gradient(180deg,#ffffff,#f9fbf7)] p-5 shadow-[0_8px_18px_rgba(22,58,46,0.03)]">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[1.05rem] font-black tracking-[-0.03em] text-[#172d25]">Assigned jobs</div>
                        <span className="rounded-full border border-[#d9e3d8] bg-white px-3 py-1.5 text-[11px] font-black text-[#52685d]">
                          {assignedJobCards.length}
                        </span>
                      </div>
                      {assignedJobCards.length === 0 ? (
                        <div className="mt-4 rounded-[1.25rem] border border-dashed border-[#d9e3d6] bg-white px-5 py-6 text-sm text-[#6a7d73]">
                          No assigned jobs yet.
                        </div>
                      ) : (
                        <div className="mt-4 space-y-3">
                          {assignedJobCards.slice(0, 3).map(({ assignment, gig, status }) => (
                            <div key={`job-assigned-${assignment.id ?? gig.id}`} className="rounded-[1.25rem] border border-[#dce4da] bg-white px-4 py-3.5">
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0">
                                  <div className="truncate text-[0.98rem] font-black tracking-[-0.03em] text-[#172d25]">{gig.title ?? "Assigned campaign"}</div>
                                  <div className="mt-1 truncate text-[0.88rem] text-[#6d8075]">
                                    {gig.company ?? "Verified brand"} • {gig.platform ?? "Campaign"}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2.5">
                                  <span className="rounded-full border border-[#dbe5da] bg-[#fafcf9] px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.15em] text-[#4f665b]">
                                    {status}
                                  </span>
                                  <Link
                                    href={findGigHref(String(gig.id))}
                                    className="inline-flex items-center rounded-full border border-[#dbe5da] bg-white px-3 py-1.5 text-xs font-black text-[#27493d] transition hover:bg-[#f0f6ec]"
                                  >
                                    Open
                                  </Link>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="rounded-[1.55rem] border border-[#dce4da] bg-[linear-gradient(180deg,#ffffff,#f9fbf7)] p-5 shadow-[0_8px_18px_rgba(22,58,46,0.03)]">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[1.05rem] font-black tracking-[-0.03em] text-[#172d25]">Applications</div>
                        <span className="rounded-full border border-[#d9e3d8] bg-white px-3 py-1.5 text-[11px] font-black text-[#52685d]">
                          {appliedJobCards.length}
                        </span>
                      </div>
                      {appliedJobCards.length === 0 ? (
                        <div className="mt-4 rounded-[1.25rem] border border-dashed border-[#d9e3d6] bg-white px-5 py-6 text-sm text-[#6a7d73]">
                          No applications yet.
                        </div>
                      ) : (
                        <div className="mt-4 space-y-3">
                          {appliedJobCards.slice(0, 4).map(({ application, gig, status }) => (
                            <div key={`job-app-${application.id}`} className="rounded-[1.25rem] border border-[#dce4da] bg-white px-4 py-3.5">
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0">
                                  <div className="truncate text-[0.98rem] font-black tracking-[-0.03em] text-[#172d25]">{gig.title ?? "Campaign"}</div>
                                  <div className="mt-1 truncate text-[0.88rem] text-[#6d8075]">
                                    {gig.company ?? "Brand"} • {gig.platform ?? "Platform"}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2.5">
                                  <span className="rounded-full border border-[#dbe5da] bg-[#fafcf9] px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.15em] text-[#4f665b]">
                                    {status}
                                  </span>
                                  <Link
                                    href={findGigHref(String(gig.id))}
                                    className="inline-flex items-center rounded-full border border-[#dbe5da] bg-white px-3 py-1.5 text-xs font-black text-[#27493d] transition hover:bg-[#f0f6ec]"
                                  >
                                    Review
                                  </Link>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="xl:col-span-2 rounded-[1.55rem] border border-[#dce4da] bg-[linear-gradient(180deg,#ffffff,#f9fbf7)] p-5 shadow-[0_8px_18px_rgba(22,58,46,0.03)]">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="text-[1.05rem] font-black tracking-[-0.03em] text-[#172d25]">Browse more jobs</div>
                          <div className="mt-1 text-sm text-[#6c8075]">Open the marketplace when you want wider discovery.</div>
                        </div>
                        <Link
                          href={FIND_GIGS_HREF}
                          className="inline-flex items-center justify-center rounded-full border border-[#d9e3d8] bg-white px-5 py-2.5 text-sm font-black text-[#27493d] transition hover:bg-[#eef5ea]"
                        >
                          Open marketplace
                        </Link>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* PROFILE */}
            {activeSection === "Profile" && (
              <>
                <section className="rounded-[1.5rem] border border-[#dde4ee] bg-[linear-gradient(180deg,#f8faff_0%,#eef3fb_62%,#edf2f8_100%)] p-3 shadow-[0_24px_52px_rgba(34,54,78,0.08)] sm:rounded-[1.8rem] sm:p-6">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-[1rem] font-black tracking-[-0.03em] text-[#223142] sm:text-[1.08rem]">Edit Profile</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cx(
                          "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em]",
                          profileDirty ? "border-[#eadfb5] bg-[#fbf7e8] text-[#7a6a22]" : "border-[#d9e7da] bg-[#eff8ef] text-[#35624a]"
                        )}
                      >
                        {profileDirty ? "Unsaved changes" : "All changes saved"}
                      </span>
                      <span className="inline-flex items-center rounded-full border border-[#dde5ec] bg-white px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-[#6c7b8c]">
                        Worker ID {effectiveWorkerId}
                      </span>
                    </div>
                  </div>

                  {profileNotice ? (
                    <div
                      className={cx(
                        "mt-4 rounded-[1.1rem] border px-4 py-3 text-sm font-bold shadow-[0_10px_22px_rgba(34,54,78,0.04)]",
                        profileNotice.tone === "danger"
                          ? "border-[#f1d7d7] bg-[linear-gradient(180deg,#fff7f7_0%,#fff1f1_100%)] text-[#8a3535]"
                          : "border-[#d8eadc] bg-[linear-gradient(180deg,#f5fff6_0%,#eefaf0_100%)] text-[#2f6843]"
                      )}
                    >
                      {profileNotice.text}
                    </div>
                  ) : null}

                  <div className="mt-4 rounded-[1.5rem] border border-[#e3e8f0] bg-white shadow-[0_18px_38px_rgba(34,54,78,0.06)] sm:mt-5 sm:rounded-[1.8rem]">
                    <div className="border-b border-[#edf1f6] px-4 py-5 sm:px-6 sm:py-6 xl:px-8 xl:py-7">
                      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
                        <div className="flex h-[82px] w-[82px] shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#d9dfd6] bg-[linear-gradient(180deg,#ffffff_0%,#fbfcfa_100%)] text-[1.7rem] font-black text-[#24493d] shadow-[0_10px_24px_rgba(34,54,78,0.08),inset_0_1px_0_rgba(255,255,255,0.9)] sm:h-[96px] sm:w-[96px] sm:text-[2rem]">
                          <span>{(profileDraft.name || creatorDisplayName || "C").slice(0, 1).toUpperCase()}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[1.18rem] font-black tracking-[-0.04em] text-[#223142] sm:text-[1.42rem]">
                            {profileDraft.name || creatorDisplayName || "Creator profile"}
                          </div>
                          <div className="mt-1.5 text-sm leading-6 text-[#6a7787] sm:text-[0.97rem]">Fresher creator</div>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 px-4 py-4 sm:gap-5 sm:px-6 sm:py-6 xl:px-8 xl:py-7 2xl:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
                      <div className="space-y-4">
                        <div className="rounded-[1.2rem] border border-[#e6ebf2] bg-[linear-gradient(180deg,#ffffff_0%,#fcfdff_100%)] p-4 shadow-[0_10px_22px_rgba(34,54,78,0.04)] sm:rounded-[1.4rem] sm:p-5">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <div className="text-[1.12rem] font-black tracking-[-0.03em] text-[#223142]">Personal Info</div>
                              <div className="mt-1 text-sm leading-6 text-[#798698]">Basic account details.</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => profileNameInputRef.current?.focus()}
                              className="inline-flex w-full items-center justify-center gap-2 rounded-[1rem] border border-[#e3e9f1] bg-white px-3.5 py-2 text-sm font-black text-[#334255] transition hover:bg-[#f7f9fc] sm:w-auto sm:justify-start"
                            >
                              <Icon name="settings" className="h-4 w-4" />
                              Edit
                            </button>
                          </div>
                          <div className="mt-5 grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                            <label className="text-sm font-bold text-[#223142]">
                              <span className="text-xs font-black uppercase tracking-[0.14em] text-[#9aa6b4]">Full Name</span>
                              <input
                                ref={profileNameInputRef}
                                value={profileDraft.name || creatorDisplayName}
                                onChange={(e) => setProfileDraft((prev) => ({ ...prev, name: e.target.value }))}
                                placeholder="Enter full name"
                                className="mt-2 w-full rounded-[1rem] border border-[#dde4ee] bg-[#fdfefe] px-4 py-3 text-sm font-semibold text-[#223142] outline-none transition focus:border-[#8aa4ff] focus:bg-white focus:ring-2 focus:ring-[#8aa4ff]/20"
                              />
                            </label>
                            <div className="text-sm font-bold text-[#223142]">
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-xs font-black uppercase tracking-[0.14em] text-[#9aa6b4]">Email</span>
                                <span className="inline-flex items-center rounded-full border border-[#dde5ec] bg-[linear-gradient(180deg,#ffffff_0%,#f5f8fb_100%)] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#788799]">
                                  System managed
                                </span>
                              </div>
                              <div className="mt-2 flex min-h-[52px] items-center rounded-[1rem] border border-[#d9e2e8] bg-[linear-gradient(180deg,#f8fbfd_0%,#f2f6f9_100%)] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.95)]">
                                <span className="truncate text-sm font-semibold text-[#223142]">
                                  {profileDraft.email || registeredEmail || "No registered email"}
                                </span>
                              </div>
                            </div>
                            <div className="text-sm font-bold text-[#223142]">
                              <div className="text-xs font-black uppercase tracking-[0.14em] text-[#9aa6b4]">Worker ID</div>
                              <div className="mt-2 rounded-[1rem] border border-[#e3e9f1] bg-[linear-gradient(180deg,#f9fbff_0%,#f5f8fd_100%)] px-4 py-3 text-sm font-semibold text-[#344458]">
                                {effectiveWorkerId}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-[1.2rem] border border-[#e6ebf2] bg-[linear-gradient(180deg,#ffffff_0%,#fbfdff_100%)] p-4 shadow-[0_10px_22px_rgba(34,54,78,0.04)] sm:rounded-[1.4rem] sm:p-5">
                          <div className="flex items-center gap-2.5 text-[#223142]">
                            <Icon name="video" className="h-5 w-5" />
                            <div className="text-[1.08rem] font-black tracking-[-0.03em]">Presentation Video</div>
                          </div>

                          {introVideoUploading ? (
                            <div className="mt-5 animate-[sidebarCardEnter_320ms_cubic-bezier(0.22,1,0.36,1)]">
                              <div className="overflow-hidden rounded-[1.35rem] border border-[#c8d9ff] bg-[linear-gradient(180deg,#f7f9ff_0%,#eef3ff_100%)] p-5 shadow-[0_18px_36px_rgba(34,54,78,0.08)] sm:p-6">
                                <div className="flex min-h-[260px] flex-col items-center justify-center text-center sm:min-h-[300px]">
                                  <div className="relative flex h-[86px] w-[86px] items-center justify-center rounded-full bg-[#dfe8ff] text-[#4878e6]">
                                    <div className="absolute inset-0 rounded-full border-2 border-[#89a7ff]/40 border-t-[#4f7df0] animate-spin" />
                                    <Icon name="video" className="h-8 w-8" />
                                  </div>
                                  <div className="mt-6 text-[1.28rem] font-black tracking-[-0.04em] text-[#31425c] sm:text-[1.45rem]">
                                    Uploading Video
                                  </div>
                                  <div className="mt-2 max-w-[420px] text-sm leading-6 text-[#738092] sm:text-[0.95rem]">
                                    {introVideoPendingName || "Preparing your presentation video preview"}
                                  </div>
                                  <div className="mt-6 w-full max-w-[420px]">
                                    <div className="h-3 overflow-hidden rounded-full bg-white/80 shadow-[inset_0_1px_2px_rgba(34,54,78,0.08)]">
                                      <div
                                        className="h-full rounded-full bg-[linear-gradient(90deg,#6e93ff_0%,#8fb1ff_60%,#b6c9ff_100%)] transition-[width] duration-300"
                                        style={{ width: `${introVideoUploadProgress}%` }}
                                      />
                                    </div>
                                    <div className="mt-3 flex items-center justify-between text-[11px] font-black uppercase tracking-[0.16em] text-[#7a8899]">
                                      <span>Processing</span>
                                      <span>{introVideoUploadProgress}%</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : hasPersistedIntroVideo && introVideo ? (
                            <div className="mt-5 animate-[sidebarCardEnter_420ms_cubic-bezier(0.22,1,0.36,1)]">
                              <div className="overflow-hidden rounded-[1.35rem] border border-[#cad8f8] bg-[linear-gradient(180deg,#fafcff_0%,#f3f7ff_100%)] shadow-[0_18px_36px_rgba(34,54,78,0.06)]">
                                <div className="px-4 pb-5 pt-4 sm:px-6 sm:pb-6 sm:pt-5">
                                  {hasRenderableIntroMedia ? (
                                    <div className="relative overflow-hidden rounded-[1.35rem] bg-[#a3a3a6] px-4 py-3 sm:px-5 sm:py-4">
                                      <div className="flex min-h-[520px] items-center justify-center sm:min-h-[540px]">
                                        <div className="relative w-full max-w-[322px] overflow-hidden sm:max-w-[324px]">
                                          <div className="aspect-[9/16] w-full">
                                            {introVideo.thumbnailUrl ? (
                                              <img
                                                src={introVideo.thumbnailUrl}
                                                alt={`${introVideo.name} thumbnail`}
                                                className="h-full w-full object-cover"
                                              />
                                            ) : (
                                              <video
                                                src={introVideo.previewUrl}
                                                className="h-full w-full object-cover"
                                                playsInline
                                                preload="metadata"
                                              />
                                            )}
                                          </div>
                                          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                            <div className="flex h-[86px] w-[86px] items-center justify-center rounded-full bg-[rgba(55,39,41,0.42)] shadow-[0_12px_24px_rgba(0,0,0,0.18)] backdrop-blur-[2px]">
                                              <svg viewBox="0 0 24 24" className="ml-1 h-9 w-9 fill-white/95" aria-hidden="true">
                                                <path d="M8 6.5v11l9-5.5-9-5.5Z" />
                                              </svg>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex min-h-[260px] flex-col items-center justify-center rounded-[1.35rem] border border-[#d8e3f6] bg-[linear-gradient(180deg,#f7f9ff_0%,#edf2fb_100%)] px-5 py-8 text-center sm:min-h-[300px]">
                                      <div className="flex h-[78px] w-[78px] items-center justify-center rounded-full bg-[#dfe8ff] text-[#4878e6]">
                                        <Icon name="video" className="h-8 w-8" />
                                      </div>
                                      <div className="mt-5 text-[1.22rem] font-black tracking-[-0.04em] text-[#31425c]">
                                        Preview processing
                                      </div>
                                      <div className="mt-2 max-w-[420px] text-sm leading-6 text-[#738092]">
                                        Your presentation video is saved. The preview will appear as soon as media processing finishes.
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                  <Button variant="secondary" onClick={openIntroVideoPicker} className="w-full sm:w-auto">
                                    <Icon name="video" />
                                    Change Video
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    className="w-full sm:w-auto"
                                    onClick={async () => {
                                      const { data } = await supabase.auth.getSession();
                                      const token = data.session?.access_token;
                                      if (!token) {
                                        setProfileNotice({ tone: "danger", text: "Session expired. Please sign in again." });
                                        window.setTimeout(() => setProfileNotice(null), 3200);
                                        return;
                                      }
                                      const res = await fetch("/api/me/presentation-video", {
                                        method: "DELETE",
                                        headers: { Authorization: `Bearer ${token}` },
                                      });
                                      const payload = await res.json().catch(() => ({}));
                                      if (!res.ok || !payload?.ok) {
                                        setProfileNotice({ tone: "danger", text: payload?.error || "Unable to remove presentation video." });
                                        window.setTimeout(() => setProfileNotice(null), 3200);
                                        return;
                                      }
                                      setIntroVideo(null);
                                      removeLS(LS_KEYS.INTRO_VIDEO);
                                    }}
                                  >
                                    Remove
                                  </Button>
                                </div>
                                <div className="min-w-0 text-sm text-[#738092] sm:text-right">
                                  Updated {formatNotificationTime(introVideo.uploadedAt)}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={openIntroVideoPicker}
                              className="mt-5 flex min-h-[260px] w-full flex-col items-center justify-center rounded-[1.35rem] border border-[#c8d9ff] bg-[linear-gradient(180deg,#f7f9ff_0%,#f4f7ff_100%)] px-5 py-8 text-center transition hover:border-[#9bb8ff] hover:bg-[linear-gradient(180deg,#f4f7ff_0%,#eef3ff_100%)] sm:min-h-[300px] sm:px-8"
                            >
                              <div className="flex h-[74px] w-[74px] items-center justify-center rounded-full bg-[#dfe8ff] text-[#4878e6] sm:h-[86px] sm:w-[86px]">
                                <Icon name="video" className="h-8 w-8 sm:h-9 sm:w-9" />
                              </div>
                              <div className="mt-6 text-[1.35rem] font-black tracking-[-0.04em] text-[#31425c] sm:text-[1.55rem]">Add Video</div>
                              <div className="mt-2 max-w-[360px] text-sm leading-6 text-[#738092] sm:text-[0.95rem]">MP4, MOV or WebM • Max 200MB</div>
                            </button>
                          )}
                        </div>

                      </div>

                      <div className="space-y-4 2xl:sticky 2xl:top-6">
                        <div className="rounded-[1.2rem] border border-[#e6ebf2] bg-[linear-gradient(180deg,#fcfdff_0%,#f8fbff_100%)] p-4 shadow-[0_10px_22px_rgba(34,54,78,0.04)] sm:rounded-[1.4rem] sm:p-5">
                          <div className="text-[1.08rem] font-black tracking-[-0.03em] text-[#223142]">Verification Overview</div>
                          <div className="mt-5 space-y-3 text-sm text-slate-700">
                            <Row label="Workspace profile" value={profileDraft.name.trim() ? "Ready" : "Missing"} />
                            <Row label="KYC status" value={kycMeta.label} />
                            <Row label="UPI setup" value={upi.verified ? "Verified" : "Pending"} />
                            <Row label="Payout release" value={payoutReadiness.ready ? "Eligible" : "Blocked"} />
                          </div>
                        </div>

                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-col gap-3 rounded-[1.2rem] border border-[#e2e8f1] bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(247,250,255,0.88))] p-3 shadow-[0_10px_24px_rgba(34,54,78,0.04)] sm:flex-row sm:items-center sm:justify-between sm:p-4">
                    <div className="text-sm leading-6 text-[#6c7b8c]">
                      Update creator identity details here. System-managed fields stay locked.
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button
                        variant="ghost"
                        disabled={!profileDirty || profileSaving}
                        onClick={() =>
                          setProfileDraft({
                            name: profileBaseline.name,
                            email: profileBaseline.email,
                            headline: profileBaseline.headline,
                            city: profileBaseline.city,
                            bio: profileBaseline.bio,
                          })
                        }
                        className="w-full sm:w-auto"
                      >
                        Reset all
                      </Button>
                      <Button variant="primary" disabled={!profileDirty || profileSaving} onClick={saveProfileDraft} className="w-full sm:w-auto">
                        {profileSaving ? "Saving..." : "Save all changes"}
                      </Button>
                    </div>
                  </div>
                </section>

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
                      <Row label="Name" value={creatorDisplayName || "—"} />
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
                        <div className="text-xs font-extrabold text-slate-600">KYC gating</div>
                        <div className="mt-1">Workers can use workspace before KYC approval, but payout requests are locked until KYC is approved.</div>
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

                {kycStatus !== "approved" && (
                  <div className="mt-6">
                    <Card title="KYC compliance center" subtitle="Manage the verification packet that now gates payout requests.">
                      {renderKycManagementPanel()}
                    </Card>
                  </div>
                )}

                <div className="mt-6 grid grid-cols-12 gap-6">
                  <div className="col-span-12 xl:col-span-8 space-y-6">
                    <Card title="Payout batches (read-only for worker)" subtitle="Admin runs batching and marks paid.">
                      <PayoutBatchesResponsive batches={myBatches} q={q} totals={batchTotals} />
                    </Card>

                    <div className="grid gap-6 lg:grid-cols-2">
                      <Card title="Notes" subtitle="Operational clarity.">
                        <div className="space-y-3 text-sm text-slate-700">
                          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                            <div className="text-xs font-extrabold text-slate-600">Why payout is pending</div>
                            <div className="mt-1">Submitted items need Admin approval, and approved earnings must reach at least {formatINR(MIN_PAYOUT_REQUEST_INR)} before payout can be requested.</div>
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

                  <div className="col-span-12 xl:col-span-4 space-y-6 xl:sticky xl:top-24 self-start">
                    <Card title="Request payout" subtitle="Submit a payout request for approved work.">
                      <div className="space-y-3 text-sm text-slate-700">
                        <Row label="Compliance state" value={payoutReadiness.ready ? "Ready" : "Blocked"} />
                        <Row label="KYC review" value={kycMeta.label} />
                        <Row label="UPI verification" value={upi.verified ? "Verified" : "Pending"} />
                        <Row label="Eligible items" value={String(eligiblePayoutItems.length)} />
                        <Row label="Pending request" value={hasProcessingPayout ? "Processing" : hasDraftPayout ? "Draft" : "No"} />
                        <Row label="Auto payout schedule" value={`${upi.payoutSchedule} • ${upi.payoutDay}`} />
                        <Row
                          label="Auto payout trigger"
                          value={eligiblePayoutTotal >= MIN_PAYOUT_REQUEST_INR ? `Eligible (${formatINR(MIN_PAYOUT_REQUEST_INR)}+)` : "Below threshold"}
                        />
                        {processingEta && <Row label="Estimated payout" value={processingEta} />}
                      </div>
                      <div className="mt-4">
                        <Button
                          variant="primary"
                          onClick={requestPayout}
                          disabled={!payoutReadiness.ready}
                        >
                          <Icon name="wallet" />
                          Request payout
                        </Button>
                      </div>
                      {payoutReadiness.blockers.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {payoutReadiness.blockers.map((blocker) => (
                            <div key={blocker.code} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                              <div className="text-xs font-extrabold uppercase tracking-[0.14em] text-amber-700">{blocker.title}</div>
                              <div className="mt-1 text-xs text-amber-800">{blocker.detail}</div>
                            </div>
                          ))}
                        </div>
                      )}
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

                    <Card title="Release conditions" subtitle="Checks before money moves.">
                      <div className="space-y-3 text-sm text-slate-700">
                        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                          <div className="text-xs font-extrabold text-slate-600">1. Approval</div>
                          <div className="mt-1">Approved work must exist before a payout request can be created.</div>
                        </div>
                        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                          <div className="text-xs font-extrabold text-slate-600">2. Compliance</div>
                          <div className="mt-1">KYC approval and verified UPI are both required before release.</div>
                        </div>
                        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                          <div className="text-xs font-extrabold text-slate-600">3. Threshold</div>
                          <div className="mt-1">Approved earnings need to reach at least {formatINR(MIN_PAYOUT_REQUEST_INR)} to become payable.</div>
                        </div>
                      </div>
                    </Card>
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

      {notificationCenterOpen && (
        <Modal
          title="Notification center"
          subtitle={unreadNotificationCount > 0 ? `${unreadNotificationCount} unread updates` : "All caught up"}
          onClose={() => setNotificationCenterOpen(false)}
          panelClassName="flex h-[88vh] w-[96vw] max-w-[1040px] flex-col overflow-hidden rounded-[1.2rem] border-[#dfe6ef] bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] shadow-[0_28px_64px_rgba(34,54,78,0.16)] sm:h-[84vh] sm:w-[92vw] sm:rounded-[1.6rem]"
          bodyClassName="min-h-0 flex-1 overflow-hidden px-4 py-4 sm:px-6 sm:py-5"
          actionsClassName="px-4 py-3 sm:px-6 sm:py-4"
          actions={
            <>
              <Button variant="ghost" onClick={() => markAllNotificationsUnread(notificationFeed)} disabled={!canMarkAllUnread}>
                Mark all unread
              </Button>
              <Button variant="ghost" onClick={() => markAllNotificationsRead(notificationFeed)} disabled={!canMarkAllRead}>
                Mark all read
              </Button>
              <Button variant="secondary" onClick={() => setNotificationCenterOpen(false)}>
                Close
              </Button>
            </>
          }
        >
          <div className="flex h-full min-h-0 flex-col gap-3 lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-4">
            <aside className="rounded-[1.3rem] border border-[#e7edf4] bg-[linear-gradient(180deg,#f8fbff_0%,#f3f7f2_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] lg:flex lg:min-h-0 lg:flex-col lg:rounded-[1.45rem] lg:p-3.5">
              <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2.5 sm:gap-3 lg:grid-cols-1 lg:gap-3">
                <div className="rounded-[1rem] border border-[#e5ebf3] bg-white px-3 py-2.5 shadow-[0_8px_18px_rgba(34,54,78,0.035)] sm:rounded-[1.2rem] sm:px-4 sm:py-3">
                  <div className="text-[0.6rem] font-black uppercase tracking-[0.16em] text-[#91a0ae] sm:text-[0.68rem] sm:tracking-[0.18em]">Total</div>
                  <div className="mt-1.5 text-[1.1rem] font-black leading-none tracking-[-0.04em] text-[#223142] sm:mt-2 sm:text-[1.45rem]">{notificationFeed.length}</div>
                  <div className="mt-1 text-[0.72rem] leading-4 text-[#7b8796] sm:text-sm">Events</div>
                </div>
                <div className="rounded-[1rem] border border-[#e5ebf3] bg-white px-3 py-2.5 shadow-[0_8px_18px_rgba(34,54,78,0.035)] sm:rounded-[1.2rem] sm:px-4 sm:py-3">
                  <div className="text-[0.6rem] font-black uppercase tracking-[0.16em] text-[#91a0ae] sm:text-[0.68rem] sm:tracking-[0.18em]">Unread</div>
                  <div className="mt-1.5 text-[1.1rem] font-black leading-none tracking-[-0.04em] text-[#223142] sm:mt-2 sm:text-[1.45rem]">{unreadNotificationCount}</div>
                  <div className="mt-1 text-[0.72rem] leading-4 text-[#7b8796] sm:text-sm">Unread items</div>
                </div>
                <div className="rounded-[1rem] border border-[#e5ebf3] bg-white px-3 py-2.5 shadow-[0_8px_18px_rgba(34,54,78,0.035)] sm:rounded-[1.2rem] sm:px-4 sm:py-3">
                  <div className="text-[0.6rem] font-black uppercase tracking-[0.16em] text-[#91a0ae] sm:text-[0.68rem] sm:tracking-[0.18em]">Actionable</div>
                  <div className="mt-1.5 text-[1.1rem] font-black leading-none tracking-[-0.04em] text-[#223142] sm:mt-2 sm:text-[1.45rem]">{actionRequiredNotificationCount}</div>
                  <div className="mt-1 text-[0.72rem] leading-4 text-[#7b8796] sm:text-sm">Open actions</div>
                </div>
              </div>

              </div>
            </aside>

            <section className="min-h-0 rounded-[1.2rem] border border-[#e5ebf3] bg-[linear-gradient(180deg,#ffffff_0%,#fbfdff_100%)] p-2 shadow-[0_10px_26px_rgba(34,54,78,0.04)] sm:rounded-[1.35rem] sm:p-3">
              <div className="flex h-full min-h-0 flex-col">
                <div className="flex items-center justify-between gap-3 border-b border-[#e7edf4] px-2.5 pb-2.5 sm:px-3 sm:pb-3">
                  <div>
                    <div className="text-[0.72rem] font-black uppercase tracking-[0.16em] text-[#93a0ae]">Inbox</div>
                    <div className="mt-1 text-sm font-semibold text-[#5f6e7d] sm:text-[0.95rem]">Operational events, review prompts, and payout blockers.</div>
                  </div>
                  <div className="rounded-full border border-[#dde5ef] bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-[#7f8d9b] sm:text-[11px]">
                    {notificationFeed.length} items
                  </div>
                </div>

                <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-0.5 sm:mt-3 sm:pr-1">
                  <div className="space-y-2.5 sm:space-y-3">
                    {notificationFeed.length === 0 ? (
                      <div className="rounded-[1.2rem] border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center">
                        <div className="text-base font-extrabold text-slate-900">No notifications</div>
                        <div className="mt-2 text-sm text-slate-600">New compliance, payout, and workspace events will appear here.</div>
                      </div>
                    ) : (
                      notificationFeed.map((notification) => {
                        const unread = notificationReadState[notification.id] !== notification.revision;
                        return (
                          <button
                            key={notification.id}
                            type="button"
                            onClick={() => openNotification(notification)}
                            className="group flex w-full items-center gap-3 rounded-[1.15rem] border border-[#e7ebf3] bg-white px-3.5 py-3 text-left shadow-[0_8px_18px_rgba(34,54,78,0.04)] transition hover:-translate-y-[1px] hover:bg-[#fcfdff] sm:gap-4 sm:rounded-[1.35rem] sm:px-4 sm:py-4 sm:shadow-[0_10px_24px_rgba(34,54,78,0.045)]"
                          >
                            <div className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-[0.95rem] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] sm:h-12 sm:w-12 sm:rounded-[1.1rem]", notification.accentClasses)}>
                              <Icon name={notification.icon} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-[0.92rem] font-black leading-5 text-[#223142] sm:text-[1rem]">{notification.title}</div>
                                  <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#95a1ae] sm:text-[11px] sm:tracking-[0.12em]">
                                    {notification.timestampLabel}
                                  </div>
                                </div>
                                {unread && <span className="mt-1 inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-[#3565f0]" />}
                              </div>
                              <div className="mt-1 text-[0.84rem] leading-5 text-[#7b8796] sm:mt-1.5 sm:text-[0.9rem] sm:leading-6">{notification.body}</div>
                              {notification.chips?.length ? (
                                <div className="mt-2 flex flex-wrap gap-1.5 sm:mt-2.5 sm:gap-2">
                                  {notification.chips.map((chip) => (
                                    <span key={chip} className="rounded-full border border-[#dbe2ec] bg-[#f8fbff] px-2 py-1 text-[8px] font-black uppercase tracking-[0.12em] text-[#7c8a98] sm:px-2.5 sm:text-[9px] sm:tracking-[0.14em]">
                                      {chip}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#e2e8f0] bg-[#ffffff] text-[#97a2af] transition group-hover:text-[#6f7b88] sm:h-8 sm:w-8">
                              <Icon name="chevRight" />
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </Modal>
      )}

    </div>
  );
}

/** ===================== Sidebar (Worker) ===================== */
function SidebarNavItem({
  id,
  label,
  icon,
  activeSection,
  setActiveSection,
  onClose,
  delayMs = 0,
}: {
  id: Section;
  label: string;
  icon: string;
  activeSection: Section;
  setActiveSection: (v: Section) => void;
  onClose?: () => void;
  delayMs?: number;
}) {
  return (
    <button
      onClick={() => {
        setActiveSection(id);
        onClose?.();
      }}
      style={{ animationDelay: `${delayMs}ms` }}
      className={cx(
        "sidebar-item-enter flex w-full items-center justify-between gap-3 rounded-[0.9rem] px-3 py-3 text-left text-[0.88rem] font-bold transition duration-200 active:translate-y-0 sm:px-3.5 sm:text-sm lg:px-3 lg:py-3 lg:text-[0.86rem]",
        activeSection === id
          ? "bg-[#ddef92] text-[#2c493d] shadow-[inset_0_0_0_1px_rgba(123,150,73,0.1)]"
          : "bg-transparent text-[#61584c] hover:bg-[#f4f1e8] hover:text-[#2c342f]"
      )}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span
          className={cx(
            "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.7rem] sm:h-9 sm:w-9 lg:h-8 lg:w-8",
            activeSection === id
              ? "bg-white/72 text-[#355548]"
              : "bg-transparent text-[#8d8374]"
          )}
        >
          <Icon name={icon} className="h-4 w-4 sm:h-5 sm:w-5 lg:h-4 lg:w-4" />
        </span>
        <span className="truncate">{label}</span>
      </span>
      <Icon name="chevRight" className={cx("h-4 w-4 shrink-0 sm:h-5 sm:w-5 lg:h-4 lg:w-4", activeSection === id ? "text-[#6d806f]" : "text-[#b2a797]")} />
    </button>
  );
}

function SidebarWorker({
  activeSection,
  setActiveSection,
  onClose,
  workerName,
  workerLevel,
}: {
  activeSection: Section;
  setActiveSection: (v: Section) => void;
  onClose?: () => void;
  workerName?: string;
  workerLevel?: string;
}) {
  return (
    <div className="sidebar-scrollbar sidebar-panel-enter flex h-full flex-col overflow-y-auto rounded-[18px] border border-[#e6e1d5] bg-[#fbfaf4] text-[#223143] shadow-[0_18px_40px_rgba(30,44,35,0.05)] sm:rounded-[22px]">
      {onClose && (
        <div className="flex justify-end px-3 pb-1 pt-2.5 lg:hidden">
          <button
            className="inline-flex h-8 w-8 items-center justify-center rounded-[0.7rem] border border-[#e5e0d4] bg-white shadow-[0_6px_14px_rgba(32,44,35,0.04)] hover:bg-[#f8f5ec]"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon name="x" className="h-4 w-4 text-[#6e756d]" />
          </button>
        </div>
      )}

      <div className="px-3 pt-0 sm:px-4 sm:pt-3 lg:px-4 lg:pt-4 xl:px-5">
        <div className="sidebar-card-enter flex items-start gap-3 border-b border-[#ece6d8] px-1 pb-4">
          <div className="flex h-[46px] w-[46px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#ece8df] text-[0.96rem] font-black text-[#4f4a41] sm:h-[48px] sm:w-[48px]">
            <span>{(workerName ?? "W").slice(0, 1).toUpperCase()}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="break-words text-[0.98rem] font-black leading-[1.08] tracking-[-0.04em] text-[#332d24] sm:text-[1.02rem]">
              {workerName ?? "Worker"}
            </div>
            <div className="mt-1 break-words text-[0.82rem] leading-5 text-[#766f63] sm:text-[0.86rem]">
              {workerLevel ?? "Level"} creator
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setActiveSection("Profile");
              onClose?.();
            }}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#7c7468] transition hover:bg-[#f2eee4]"
            aria-label="Edit profile"
          >
            <Icon name="settings" className="h-4 w-4" />
          </button>
        </div>
      </div>

      <nav className="space-y-1 px-3 py-4 sm:px-4 sm:py-4 lg:space-y-1.5 lg:px-4 lg:py-5 xl:px-5">
        <SidebarNavItem id="Operations" label="Dashboard" icon="tasks" activeSection={activeSection} setActiveSection={setActiveSection} onClose={onClose} delayMs={90} />
        <SidebarNavItem id="Jobs" label="Jobs" icon="briefcase" activeSection={activeSection} setActiveSection={setActiveSection} onClose={onClose} delayMs={140} />
        <SidebarNavItem id="Accounts" label="My Accounts" icon="performance" activeSection={activeSection} setActiveSection={setActiveSection} onClose={onClose} delayMs={190} />
        <SidebarNavItem id="Performance" label="Insights" icon="performance" activeSection={activeSection} setActiveSection={setActiveSection} onClose={onClose} delayMs={240} />
        <SidebarNavItem id="UPI" label="Payment Setup" icon="settings" activeSection={activeSection} setActiveSection={setActiveSection} onClose={onClose} delayMs={290} />
        <SidebarNavItem id="Payouts" label="Payouts" icon="wallet" activeSection={activeSection} setActiveSection={setActiveSection} onClose={onClose} delayMs={340} />
      </nav>
    </div>
  );
}

/** ===================== KPIs ===================== */
function KPI({ title, value, hint, tone }: { title: string; value: string; hint: string; tone: "neutral" | "info" | "warn" | "danger" }) {
  const iconWrap =
    tone === "info"
      ? "bg-[#eaf0ff] text-[#4d69c8]"
      : tone === "warn"
        ? "bg-[#fff5d9] text-[#b1841d]"
        : tone === "danger"
          ? "bg-rose-50 text-rose-700"
          : "bg-[#f4ebdf] text-[#8b6a45]";
  const iconName: string =
    title === "Open"
      ? "wallet"
      : title === "In progress"
        ? "tasks"
        : title === "Submitted"
          ? "calendar"
          : "performance";
  const badgeTone =
    tone === "info"
      ? "bg-[#eef5f0] text-[#355548]"
      : tone === "warn"
        ? "bg-[#f7f3e7] text-[#6d5b25]"
        : tone === "danger"
          ? "bg-rose-50 text-rose-700"
          : "bg-[#f3efe6] text-[#4d5d55]";
  const badgeLabel =
    title === "In progress"
      ? "In Progress"
      : title === "Approved earnings"
        ? "Approved"
        : title;
  return (
    <div className="rounded-[24px] border border-[#dde4ed] bg-[linear-gradient(180deg,#ffffff_0%,#f7faff_100%)] p-4 shadow-[0_14px_30px_rgba(34,54,78,0.065)] sm:rounded-[26px] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[0.66rem] font-black uppercase tracking-[0.18em] text-[#8491a0] sm:text-[0.7rem] sm:tracking-[0.22em]">{title}</div>
          <div className="mt-2.5 text-[2rem] font-black leading-none tracking-[-0.045em] text-[#223142] sm:mt-3 sm:text-[2.15rem]">{value}</div>
          <div className="mt-2 text-[0.92rem] font-medium leading-6 text-[#798695] sm:text-sm">{hint}</div>
        </div>
        <div className="flex flex-col items-end gap-2.5 sm:gap-3">
          <div className={cx("flex h-10 w-10 items-center justify-center rounded-[0.95rem] sm:h-11 sm:w-11 sm:rounded-[1rem]", iconWrap)}>
            <Icon name={iconName} />
          </div>
          <div className={cx("inline-flex max-w-[102px] items-center justify-center rounded-full px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.1em] text-center leading-tight sm:max-w-[108px] sm:py-2 sm:text-[11px] sm:tracking-[0.12em]", badgeTone)}>
            <span className="line-clamp-2 break-words">{badgeLabel}</span>
          </div>
        </div>
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
  slaMeta: (id: string) => WorkTiming | undefined;
  gateScore: (x: WorkItem) => { ok: number; total: number };
  onOpen: (id: string) => void;
  onStart: (id: string) => void;
  onSubmit: (id: string) => void;
}) {
  return (
    <>
      {/* Mobile cards */}
      <div className="lg:hidden space-y-3.5">
        {items.length === 0 ? (
          <div className="rounded-[1.4rem] border border-[#d9e3d6] bg-[linear-gradient(180deg,#ffffff,#f6faf3)] p-4 text-sm text-slate-700">
            No items.
          </div>
        ) : (
          items.map((x) => {
            const a = accountById(x.accountId);
            const meta = slaMeta(x.id);
            const dueIn = meta?.dueInMin;
            const overdue = !!meta?.overdue;
            const gate = gateScore(x);
            const gateTone: "success" | "warn" | "danger" = gate.ok === gate.total ? "success" : gate.ok >= gate.total - 1 ? "warn" : "danger";
            const strict = a?.policyTier === "Strict";
            const canSubmit = x.status === "Open" || x.status === "In progress" || x.status === "Needs fix";

            return (
              <div
                key={x.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpen(x.id)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " " ? onOpen(x.id) : null)}
                className={cx(
                  "w-full text-left rounded-[1.7rem] border p-4 transition outline-none focus:ring-2 focus:ring-[#84d85e]/20",
                  overdue
                    ? "border-rose-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(255,244,244,0.98))]"
                    : "border-[#d9e3d6] bg-[linear-gradient(180deg,#ffffff,#f5faf2)] shadow-[0_18px_38px_rgba(22,58,46,0.07)]"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex max-w-full rounded-full bg-[#edf5ef] px-2.5 py-1 text-[0.68rem] font-black uppercase tracking-[0.14em] text-[#476257]">
                        {a?.handle ?? "No handle"}
                      </span>
                      <span className="text-[0.68rem] font-bold uppercase tracking-[0.14em] text-[#809388]">{x.id}</span>
                    </div>
                    <div className="mt-3 text-[1rem] font-black leading-6 tracking-[-0.03em] text-[#172d25] line-clamp-2">
                      {x.title}
                    </div>
                    <div className="mt-2 text-[0.8rem] font-medium text-[#6b7d73]">
                      {x.type}
                    </div>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-2">
                    <PriorityPill p={x.priority} />
                    <span className={cx(
                      "inline-flex rounded-full px-2.5 py-1 text-[0.68rem] font-black uppercase tracking-[0.14em]",
                      overdue ? "bg-rose-50 text-rose-700" : typeof dueIn === "number" && dueIn <= 60 ? "bg-[#f8f3df] text-[#6d5b25]" : "bg-[#eff3ea] text-[#3f554a]"
                    )}>
                      {typeof dueIn !== "number" ? "No deadline" : overdue ? `${Math.abs(dueIn)}m late` : `${Math.max(0, dueIn)}m`}
                    </span>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2.5">
                  <div className="rounded-[1rem] border border-[#dde6df] bg-white/88 px-3 py-2.5">
                    <div className="text-[0.62rem] font-black uppercase tracking-[0.16em] text-[#7a8d82]">Status</div>
                    <div className="mt-1.5"><StatusBadge s={x.status} /></div>
                  </div>
                  <div className="rounded-[1rem] border border-[#dde6df] bg-white/88 px-3 py-2.5">
                    <div className="text-[0.62rem] font-black uppercase tracking-[0.16em] text-[#7a8d82]">Due</div>
                    <div className="mt-1.5 text-sm font-bold text-[#183128]">{typeof dueIn !== "number" ? "No deadline" : overdue ? "Overdue" : "On track"}</div>
                  </div>
                  <div className="rounded-[1rem] border border-[#dde6df] bg-white/88 px-3 py-2.5">
                    <div className="text-[0.62rem] font-black uppercase tracking-[0.16em] text-[#7a8d82]">Gates</div>
                    <div className="mt-1.5"><Chip tone={gateTone}>{gate.ok}/{gate.total}</Chip></div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {strict && <Chip tone="warn">Strict</Chip>}
                  <Chip tone="neutral">{formatDueWithTz(x.dueAt)}</Chip>
                </div>

                <div className="mt-4 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => onStart(x.id)}
                    disabled={x.status !== "Open"}
                    className={cx(
                      "rounded-xl border px-3.5 py-2 text-xs font-extrabold transition",
                      x.status === "Open"
                        ? "border-[#d6ded6] bg-white text-[#1a332b] hover:bg-[#f2f7ef]"
                        : "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                    )}
                  >
                    Start
                  </button>

                  {x.type === "Reel posting" && (
                    <button
                      onClick={() => onSubmit(x.id)}
                      disabled={!canSubmit}
                      className={cx(
                        "rounded-xl px-3.5 py-2 text-xs font-extrabold transition",
                        canSubmit
                          ? "bg-[linear-gradient(180deg,#244d40,#17372d)] text-white shadow-[0_12px_24px_rgba(23,55,45,0.16)] hover:bg-[linear-gradient(180deg,#2b5a4b,#1b4135)]"
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

      {/* Desktop cards */}
      <div className="hidden lg:grid lg:grid-cols-2 lg:gap-4 2xl:grid-cols-3">
        {items.length === 0 ? (
          <div className="col-span-full rounded-[1.5rem] border border-[#d9e3d6] bg-[linear-gradient(180deg,#ffffff,#f6faf3)] p-6 text-sm text-slate-700">
            No items.
          </div>
        ) : (
          items.map((x) => {
            const a = accountById(x.accountId);
            const meta = slaMeta(x.id);
            const dueIn = meta?.dueInMin;
            const overdue = !!meta?.overdue;
            const gate = gateScore(x);
            const gateTone: "success" | "warn" | "danger" = gate.ok === gate.total ? "success" : gate.ok >= gate.total - 1 ? "warn" : "danger";
            const strict = a?.policyTier === "Strict";
            const canSubmit = x.status === "Open" || x.status === "In progress" || x.status === "Needs fix";
            return (
              <div
                key={x.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpen(x.id)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " " ? onOpen(x.id) : null)}
                className={cx(
                  "rounded-[1.8rem] border p-4 transition outline-none focus:ring-2 focus:ring-[#84d85e]/20",
                  overdue
                    ? "border-rose-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(255,244,244,0.98))]"
                    : "border-[#d9e3d6] bg-[linear-gradient(180deg,#ffffff,#f5faf2)] shadow-[0_18px_38px_rgba(22,58,46,0.07)] hover:shadow-[0_24px_48px_rgba(22,58,46,0.1)]"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex rounded-full bg-[#edf5ef] px-2.5 py-1 text-[0.68rem] font-black uppercase tracking-[0.14em] text-[#476257]">
                        {a?.handle ?? "No handle"}
                      </span>
                      <span className="text-[0.68rem] font-bold uppercase tracking-[0.14em] text-[#809388]">{x.id}</span>
                    </div>
                    <div className="mt-3 text-[1.02rem] font-black leading-6 tracking-[-0.03em] text-[#172d25] line-clamp-2">
                      {x.title}
                    </div>
                    <div className="mt-1.5 text-sm font-medium text-[#6b7d73]">{x.type}</div>
                  </div>
                  <PriorityPill p={x.priority} />
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-[1rem] border border-[#dde6df] bg-white/88 px-3 py-3">
                    <div className="text-[0.62rem] font-black uppercase tracking-[0.16em] text-[#7a8d82]">Status</div>
                    <div className="mt-2"><StatusBadge s={x.status} /></div>
                  </div>
                  <div className="rounded-[1rem] border border-[#dde6df] bg-white/88 px-3 py-3">
                    <div className="text-[0.62rem] font-black uppercase tracking-[0.16em] text-[#7a8d82]">Timing</div>
                    <div className="mt-2 text-sm font-bold text-[#183128]">{typeof dueIn !== "number" ? "No deadline" : overdue ? `${Math.abs(dueIn)}m late` : `${Math.max(0, dueIn)}m left`}</div>
                    <div className="mt-1 text-[0.76rem] text-[#6c7f74]">{typeof meta?.slaRemaining === "number" ? `${meta.slaRemaining}m SLA` : "Not started"}</div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {strict && <Chip tone="warn">Strict</Chip>}
                  <Chip tone={gateTone}>{gate.ok}/{gate.total} gates</Chip>
                  <Chip tone="neutral">{formatDueWithTz(x.dueAt)}</Chip>
                </div>

                <div className="mt-4 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => onStart(x.id)}
                    disabled={x.status !== "Open"}
                    className={cx(
                      "rounded-xl border px-3.5 py-2 text-xs font-extrabold transition",
                      x.status === "Open"
                        ? "border-[#d6ded6] bg-white text-[#1a332b] hover:bg-[#f2f7ef]"
                        : "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                    )}
                  >
                    Start
                  </button>
                  {x.type === "Reel posting" && (
                    <button
                      onClick={() => onSubmit(x.id)}
                      disabled={!canSubmit}
                      className={cx(
                        "rounded-xl px-3.5 py-2 text-xs font-extrabold transition",
                        canSubmit
                          ? "bg-[linear-gradient(180deg,#244d40,#17372d)] text-white shadow-[0_12px_24px_rgba(23,55,45,0.16)] hover:bg-[linear-gradient(180deg,#2b5a4b,#1b4135)]"
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
  slaMeta: (id: string) => WorkTiming | undefined;
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

  const statusTone = (s: PayoutBatchStatus): "success" | "info" | "danger" | "warn" =>
    s === "Paid" ? "success" : s === "Processing" ? "info" : s === "Failed" ? "danger" : "warn";
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
                <Chip tone={statusTone(b.status)}>{b.status}</Chip>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Chip tone="info">{t.count} items</Chip>
                <Chip tone="neutral">Total {formatINR(t.total)}</Chip>
                <Chip tone="success">Paid {formatINR(t.paid)}</Chip>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
            <div className="text-sm font-semibold text-slate-800">No payout batches yet</div>
            <div className="mt-1 text-sm text-slate-500">Approved work will appear here once admin creates a payout cycle.</div>
          </div>
        )}
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
                    <Chip tone={statusTone(b.status)}>{b.status}</Chip>
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
                <td colSpan={8} className="px-6 py-14">
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center">
                    <div className="text-base font-semibold text-slate-800">No payout batches yet</div>
                    <div className="mt-2 text-sm text-slate-500">Approved work will appear here after admin creates and processes a payout cycle.</div>
                  </div>
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
  panelClassName,
  bodyClassName,
  actionsClassName,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  actions: React.ReactNode;
  panelClassName?: string;
  bodyClassName?: string;
  actionsClassName?: string;
}) {
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <div className={cx("absolute left-1/2 top-1/2 w-[92vw] max-w-[720px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-slate-200 bg-white shadow-xl", panelClassName)}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-extrabold text-slate-900">{title}</div>
            {subtitle && <div className="mt-0.5 text-sm text-slate-600 truncate">{subtitle}</div>}
          </div>
          <Button variant="ghost" onClick={onClose} title="Close">
            <Icon name="x" />
          </Button>
        </div>

        <div className={cx("px-4 py-4", bodyClassName)}>{children}</div>
        <div className={cx("flex flex-wrap justify-end gap-2 border-t border-slate-200 px-4 py-3", actionsClassName)}>{actions}</div>
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

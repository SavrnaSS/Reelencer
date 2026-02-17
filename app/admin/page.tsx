// app/admin/page.tsx
"use client";

import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import { usePathname, useRouter } from "next/navigation";

/** Keep in sync with workspace page */
type Role = "Admin" | "Worker";
type AuthSession = {
  role: Role;
  workerId?: string;
  at: string;
};

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
  timezone?: string;
};

type WorkItem = {
  id: string;
  workerId: string;
  accountId: string;
  title: string;
  type: TaskType;
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
function nowISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function isoToLocalInput(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function parseLocalISO(s: string) {
  const [date, time] = s.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
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
function clampText(s: string, max = 72) {
  const t = s.trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}
function isMobileWidth() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 1023px)").matches;
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
  return (
    <span className={cx("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-extrabold", cls, className)}>
      {children}
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

function PriorityPill({ p }: { p: Priority }) {
  const tone = p === "P0" ? "danger" : p === "P1" ? "warn" : "neutral";
  return <Chip tone={tone}>{p}</Chip>;
}
function AccountHealthPill({ h }: { h: AccountHealth }) {
  const tone = h === "Healthy" ? "success" : h === "Watch" ? "warn" : "danger";
  return <Chip tone={tone}>{h}</Chip>;
}
function WorkStatusBadge({ s }: { s: Status }) {
  const tone =
    s === "Approved"
      ? "success"
      : s === "Submitted"
      ? "warn"
      : s === "Needs fix"
      ? "danger"
      : s === "Hard rejected"
      ? "danger"
      : s === "Cancelled"
      ? "neutral"
      : s === "In progress"
      ? "info"
      : "neutral";
  return <Chip tone={tone}>{s}</Chip>;
}
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-600 font-bold">{label}</span>
      <span className="text-slate-900 font-extrabold">{value}</span>
    </div>
  );
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
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-[92vw] max-w-[820px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-slate-200 bg-white shadow-xl">
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

/** ===================== Auth fetch helper ===================== */
async function fetchWithAuth<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const r = await fetch(url, {
      ...(init || {}),
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

/** ===================== Work Table & Review List ===================== */
function AdminWorkTable({
  items,
  workerById,
  accountById,
  metaOf,
  onOpen,
  onReview,
}: {
  items: WorkItem[];
  workerById: (id: string) => Worker | undefined;
  accountById: (id: string) => AssignedAccount | undefined;
  metaOf: (id: string) => { dueInMin: number; overdue: boolean; slaRemaining?: number; slaBreached?: boolean } | undefined;
  onOpen: (id: string) => void;
  onReview: (id: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-[980px] w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-extrabold text-slate-600">
            <tr>
              <th className="px-4 py-3">Work</th>
              <th className="px-4 py-3">Worker</th>
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3">Due</th>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {items.map((x) => {
              const wk = workerById(x.workerId);
              const acc = accountById(x.accountId);
              const meta = metaOf(x.id);
              const overdue = !!meta?.overdue;
              return (
                <tr key={x.id} className={cx("cursor-pointer hover:bg-slate-50", overdue && "bg-rose-50/30")} onClick={() => onOpen(x.id)}>
                  <td className="px-4 py-3">
                    <div className="font-extrabold text-slate-900">{x.id}</div>
                    <div className="text-slate-700 max-w-[520px] truncate">{x.title}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {x.type} • Reward {formatINR(x.rewardINR)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-extrabold text-slate-900">{wk?.name ?? x.workerId}</div>
                    <div className="text-xs text-slate-500">{wk?.email ? wk.email : "—"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-extrabold text-slate-900">{acc?.handle ?? x.accountId}</div>
                    <div className="text-xs text-slate-500">
                      {acc?.ownerTeam ?? "—"} • {acc?.policyTier ?? "—"}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-extrabold text-slate-900">{x.dueAt.replace("T", " ")}</div>
                    <div className="text-xs text-slate-600">{overdue ? "Overdue" : "On schedule"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <PriorityPill p={x.priority} />
                  </td>
                  <td className="px-4 py-3">
                    <WorkStatusBadge s={x.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                      <Button variant="secondary" onClick={() => onOpen(x.id)}>
                        Open
                      </Button>
                      {x.status === "Submitted" && (
                        <Button variant="primary" onClick={() => onReview(x.id)}>
                          Review
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-600">
                  No work items.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdminReviewList({
  items,
  workerById,
  accountById,
  metaOf,
  onOpen,
  onReview,
}: {
  items: WorkItem[];
  workerById: (id: string) => Worker | undefined;
  accountById: (id: string) => AssignedAccount | undefined;
  metaOf: (id: string) => { dueInMin: number; overdue: boolean; slaRemaining?: number; slaBreached?: boolean } | undefined;
  onOpen: (id: string) => void;
  onReview: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      {items.map((x) => {
        const wk = workerById(x.workerId);
        const acc = accountById(x.accountId);
        const meta = metaOf(x.id);
        const overdue = !!meta?.overdue;
        return (
          <div key={x.id} className={cx("rounded-lg border p-3", overdue ? "border-rose-200 bg-rose-50/20" : "border-slate-200 bg-white")}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-extrabold text-slate-900 truncate">
                  {x.id} • {wk?.name ?? x.workerId}
                </div>
                <div className="mt-1 text-sm text-slate-700 line-clamp-2">{x.title}</div>
                <div className="mt-2 text-xs text-slate-500 truncate">
                  {acc?.handle ?? x.accountId} • Due {x.dueAt.replace("T", " ")}
                </div>
              </div>
              <div className="shrink-0 flex flex-col items-end gap-2">
                <WorkStatusBadge s={x.status} />
                <PriorityPill p={x.priority} />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {overdue ? <Chip tone="danger">Overdue</Chip> : <Chip tone="neutral">On schedule</Chip>}
              <Chip tone="info">Reward {formatINR(x.rewardINR)}</Chip>
              <Chip tone="neutral">{x.type}</Chip>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => onOpen(x.id)}>
                Open
              </Button>
              <Button variant="primary" onClick={() => onReview(x.id)} disabled={x.status !== "Submitted"}>
                Review
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** ===================== Sidebar ===================== */
type AdminSection = "Overview" | "Workers" | "Assignments" | "Work" | "Reviews" | "Payouts" | "Gigs" | "Email Access";

function AdminSidebar({
  active,
  onPick,
  onLogout,
}: {
  active: AdminSection;
  onPick: (s: AdminSection) => void;
  onLogout: () => void;
}) {
  const renderItem = (id: AdminSection, label: string, icon: string) => (
    <button
      key={id}
      onClick={() => onPick(id)}
      className={cx(
        "flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-sm font-extrabold transition",
        active === id ? "bg-[#e5f1fb] text-[#106ebe]" : "text-slate-800 hover:bg-slate-100"
      )}
    >
      <span className="flex items-center gap-2">
        <Icon name={icon} className={cx(active === id ? "text-[#106ebe]" : "text-slate-600")} />
        {label}
      </span>
      <Icon name="chevRight" className="text-slate-400" />
    </button>
  );

  return (
    <div className="flex h-full flex-col rounded-lg border border-slate-200 bg-white shadow-sm lg:sticky lg:top-[92px]">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-4">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-[#0078d4] text-white font-black">AD</div>
          <div className="leading-tight">
            <div className="text-sm font-extrabold text-slate-900">Admin Center</div>
            <div className="text-xs text-slate-600">Full control</div>
          </div>
        </div>
        <Chip tone="info">
          <span className="inline-flex items-center gap-2">
            <Icon name="shield" />
            Admin
          </span>
        </Chip>
      </div>
      <nav className="space-y-1 px-4 py-4">
        {renderItem("Overview", "Overview", "briefcase")}
        {renderItem("Workers", "Workers", "users")}
        {renderItem("Assignments", "Assignments", "briefcase")}
        {renderItem("Work", "Work items", "briefcase")}
        {renderItem("Reviews", "Reviews", "shield")}
        {renderItem("Payouts", "Payouts", "wallet")}
        {renderItem("Gigs", "Gigs", "briefcase")}
        {renderItem("Email Access", "Email access", "shield")}
      </nav>
      <div className="mt-auto px-4 py-4 space-y-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <div className="text-xs font-extrabold text-slate-600">Enforcement</div>
          <div className="mt-1">Only Admin can approve / reject / hard reject.</div>
        </div>
        <Button variant="secondary" onClick={onLogout} className="w-full" title="Logout">
          <Icon name="logout" />
          Logout
        </Button>
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

function AssignmentsMatrix({
  workers,
  accounts,
  assignments,
  onAssign,
  onRemove,
}: {
  workers: Worker[];
  accounts: AssignedAccount[];
  assignments: Assignment[];
  onAssign: (workerId: string, accountId: string) => void;
  onRemove: (workerId: string, accountId: string) => void;
}) {
  const assignedMap = useMemo(() => {
    const s = new Set(assignments.map((a) => `${a.workerId}::${a.accountId}`));
    return (w: string, a: string) => s.has(`${w}::${a}`);
  }, [assignments]);

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-[900px] w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-extrabold text-slate-600">
            <tr>
              <th className="px-4 py-3">Worker</th>
              {accounts.map((a) => (
                <th key={a.id} className="px-4 py-3">
                  {a.handle}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {workers.map((w) => (
              <tr key={w.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="font-extrabold text-slate-900">{w.name}</div>
                  <div className="text-xs text-slate-600">{w.id}</div>
                </td>
                {accounts.map((a) => {
                  const ok = assignedMap(w.id, a.id);
                  return (
                    <td key={a.id} className="px-4 py-3">
                      {ok ? (
                        <div className="flex items-center gap-2">
                          <Chip tone="success">Assigned</Chip>
                          <Button variant="ghost" title="Remove assignment" onClick={() => onRemove(w.id, a.id)}>
                            <Icon name="x" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Chip tone="neutral">—</Chip>
                          <Button variant="secondary" onClick={() => onAssign(w.id, a.id)} title="Assign this account to worker">
                            <Icon name="plus" />
                            Assign
                          </Button>
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {workers.length === 0 && (
              <tr>
                <td className="px-4 py-10 text-center text-sm text-slate-600" colSpan={1 + accounts.length}>
                  No workers found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** ===================== Work Details ===================== */
function AdminWorkDetails({
  item,
  worker,
  account,
  meta,
  onClose,
  onReview,
}: {
  item: WorkItem | null;
  worker?: Worker;
  account?: AssignedAccount;
  meta?: { dueInMin: number; overdue: boolean; slaRemaining?: number; slaBreached?: boolean };
  onClose: () => void;
  onReview: () => void;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-extrabold text-slate-900">Work details</div>
          <div className="mt-0.5 text-sm text-slate-600 truncate">{item ? `${item.id} • ${item.type}` : "Select a work item"}</div>
        </div>
        <Button variant="ghost" onClick={onClose} title="Close">
          <Icon name="x" />
        </Button>
      </div>
      <div className="px-4 py-3 space-y-4">
        {!item ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">Select a work item to see full details.</div>
        ) : (
          <>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-extrabold text-slate-900">{clampText(item.title, 72)}</div>
                <div className="flex items-center gap-2">
                  <PriorityPill p={item.priority} />
                  <WorkStatusBadge s={item.status} />
                </div>
              </div>
              <div className="mt-3 grid gap-2 text-sm text-slate-700">
                <Row label="Worker" value={<span>{worker?.name ?? item.workerId}</span>} />
                <Row label="Account" value={<span>{account?.handle ?? item.accountId}</span>} />
                <Row label="Due" value={<span>{item.dueAt.replace("T", " ")}</span>} />
                <Row label="Reward" value={<span>{formatINR(item.rewardINR)}</span>} />
                <Row label="SLA" value={<span>{item.slaMinutes} min</span>} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {meta?.overdue ? (
                  <Chip tone="danger">Overdue {Math.abs(meta.dueInMin)}m</Chip>
                ) : (
                  <Chip tone={typeof meta?.dueInMin === "number" && meta.dueInMin <= 60 ? "warn" : "neutral"}>
                    Due {Math.max(0, meta?.dueInMin ?? 0)}m
                  </Chip>
                )}
                {typeof meta?.slaRemaining === "number" ? (
                  <Chip tone={meta.slaBreached ? "danger" : meta.slaRemaining <= 5 ? "warn" : "info"}>
                    {meta.slaBreached ? "SLA breached" : `${meta.slaRemaining}m SLA left`}
                  </Chip>
                ) : (
                  <Chip tone="neutral">SLA: not started</Chip>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={onReview} disabled={item.status !== "Submitted"}>
                  Review (Approve / Reject)
                </Button>
              </div>
            </div>

            <div className="rounded-md border border-slate-200 bg-white p-3">
              <div className="text-xs font-extrabold text-slate-600">Submission</div>
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
                <div className="mt-2 text-sm text-slate-700">No submission available.</div>
              )}
              {item.review?.rejectReason && (
                <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3">
                  <div className="text-sm font-extrabold text-rose-900">{item.review.decision}</div>
                  <div className="mt-1 text-sm text-rose-800">{item.review.rejectReason}</div>
                </div>
              )}
            </div>

            <div className="rounded-md border border-slate-200 bg-white p-3">
              <div className="text-xs font-extrabold text-slate-600">Account policy</div>
              {account ? (
                <div className="mt-2 space-y-2 text-sm text-slate-700">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip>{account.ownerTeam}</Chip>
                    <Chip tone={account.policyTier === "Strict" ? "warn" : "neutral"}>{account.policyTier}</Chip>
                    <AccountHealthPill h={account.health} />
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs font-extrabold text-slate-600">Rules</div>
                    <ul className="mt-2 list-disc pl-5 space-y-1">
                      {account.rules.slice(0, 6).map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : (
                <div className="mt-2 text-sm text-slate-700">—</div>
              )}
            </div>

            <div className="rounded-md border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-extrabold text-slate-600">Audit trail</div>
                <Chip tone="neutral">{item.audit[0]?.at ?? "—"}</Chip>
              </div>
              <div className="mt-3 space-y-2">
                {item.audit.slice(0, 8).map((a, i) => (
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

/** ===================== Page (UI) ===================== */
function AdminConsole() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const today = isoToday();

  // global UI
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<AdminSection>("Overview");
  const [q, setQ] = useState("");
  const [tick, setTick] = useState(0);
  const [showCancelled, setShowCancelled] = useState(false);
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
  const [accounts, setAccounts] = useState<AssignedAccount[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [upiConfigs, setUpiConfigs] = useState<UpiConfig[]>([]);
  const [payoutBatchesAdmin, setPayoutBatchesAdmin] = useState<AdminPayoutBatch[]>([]);
  const [workEmailCodes, setWorkEmailCodes] = useState<WorkEmailSecretCode[]>([]);
  const [workEmailSchemaMissing, setWorkEmailSchemaMissing] = useState(false);
  const [newCodeLabel, setNewCodeLabel] = useState("");
  const [newCodeMaxUses, setNewCodeMaxUses] = useState<number>(0);
  const [newCodeExpiry, setNewCodeExpiry] = useState<string>("");
  const [newlyGeneratedCode, setNewlyGeneratedCode] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
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
  const [deleteWorkerModalOpen, setDeleteWorkerModalOpen] = useState(false);
  const [deleteWorkerTarget, setDeleteWorkerTarget] = useState<Worker | null>(null);
  const [deleteWorkerConfirmText, setDeleteWorkerConfirmText] = useState("");
  const [deleteWorkerSaving, setDeleteWorkerSaving] = useState(false);

  // selection / drawers
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null);
  const [detailsOpenMobile, setDetailsOpenMobile] = useState(false);
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

  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewReason, setReviewReason] = useState("");

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

  /** ✅ Logout (kept + practical) */
  const logout = useCallback(async () => {
    try {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(LS_KEYS.AUTH);
      }
      await supabase.auth.signOut();
    } catch {
      // ignore and still redirect
    } finally {
      setMobileNavOpen(false);
      setDetailsOpenMobile(false);
      router.replace("/login");
    }
  }, [router]);

  const refreshLock = useRef(false);
  const scheduleLock = useRef(false);
  const loadSnapshot = useCallback(async () => {
    if (refreshLock.current) return;
    refreshLock.current = true;
    try {
      const workersReq = fetchWithAuth<{ ok: boolean; workers: Worker[] }>("/api/admin/workers", { method: "GET" });
      const upiReq = fetchWithAuth<{ ok: boolean; upiConfigs: UpiConfig[] }>("/api/admin/upi-configs", { method: "GET" });
      const payoutsReq = fetchWithAuth<{ ok: boolean; payoutBatches: AdminPayoutBatch[] }>("/api/admin/payoutbatches", { method: "GET" });
      // 1) try API snapshot first (kept)
      const snap = await fetchWithAuth<ApiSnapshot>("/api/admin/snapshot", { method: "GET" });
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
        if (payoutsRes?.ok && Array.isArray(payoutsRes.payoutBatches)) {
          setPayoutBatchesAdmin(payoutsRes.payoutBatches);
        }

        const workersRes = await workersReq;
        if (workersRes?.ok && workersRes.workers?.length) {
          setWorkers(workersRes.workers);
          setSelectedWorkerId((prev) => prev ?? workersRes.workers[0]?.id ?? null);
        } else if (snap.workers?.length) {
          setWorkers(snap.workers);
          setSelectedWorkerId((prev) => prev ?? snap.workers[0]?.id ?? null);
        }
        if (!scheduleLock.current) {
          scheduleLock.current = true;
          await fetchWithAuth<{ ok: boolean }>("/api/admin/schedule-work", {
            method: "POST",
            body: JSON.stringify({ schedule: scheduleConfig }),
          });
        }
        return;
      }

      const workersRes = await workersReq;
      if (workersRes?.ok && workersRes.workers?.length) {
        setWorkers(workersRes.workers);
        setSelectedWorkerId((prev) => prev ?? workersRes.workers[0]?.id ?? null);
        const upiRes = await upiReq;
        if (upiRes?.ok && Array.isArray(upiRes.upiConfigs)) {
          setUpiConfigs(upiRes.upiConfigs);
        }
        const payoutsRes = await payoutsReq;
        if (payoutsRes?.ok && Array.isArray(payoutsRes.payoutBatches)) {
          setPayoutBatchesAdmin(payoutsRes.payoutBatches);
        }
        if (!scheduleLock.current) {
          scheduleLock.current = true;
          await fetchWithAuth<{ ok: boolean }>("/api/admin/schedule-work", {
            method: "POST",
            body: JSON.stringify({ schedule: scheduleConfig }),
          });
        }
        return;
      }
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      setToast({ message: "Live admin data unavailable. Check connectivity.", tone: "danger" });
      toastTimerRef.current = window.setTimeout(() => setToast(null), 2400);
    } finally {
      if (typeof window !== "undefined") {
        window.setTimeout(() => {
          refreshLock.current = false;
        }, 400);
      } else {
        refreshLock.current = false;
      }
    }
  }, [scheduleConfig]);

  // initial load
  useEffect(() => {
    if (!mounted) return;
    loadSnapshot();
  }, [mounted, loadSnapshot, today]);

  // tick for SLA / due meta
  useEffect(() => {
    if (!mounted) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, [mounted]);

  // REALTIME: refresh snapshot on changes
  useEffect(() => {
    if (!mounted) return;
    const channel = supabase
      .channel("admin-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "work_items" }, () => loadSnapshot())
      .on("postgres_changes", { event: "*", schema: "public", table: "assignments" }, () => loadSnapshot())
      .on("postgres_changes", { event: "*", schema: "public", table: "accounts" }, () => loadSnapshot())
      .on("postgres_changes", { event: "*", schema: "public", table: "workers" }, () => loadSnapshot())
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => loadSnapshot())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [mounted, loadSnapshot]);

  const refresh = () => {
    setTick((t) => t + 1);
    loadSnapshot();
  };

  const workEmailAdminRequest = useCallback(async (method: "GET" | "POST" | "PATCH" | "DELETE", body?: unknown) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { ok: false as const, error: "Session expired. Please sign in again." };

    const res = await fetch("/api/admin/work-email-codes", {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
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
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    const res = await fetch("/api/admin/work-email-accounts", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
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
      action: "block" | "unblock" | "renew",
      opts?: { expiresAt?: string | null; resetUsage?: boolean }
    ): Promise<boolean> => {
      const res = await workEmailAdminRequest("PATCH", { id, action, ...(opts ?? {}) });
      if (!res.ok) {
        setToast({ message: res.error || "Unable to update code.", tone: "danger" });
        return false;
      }
      setToast({
        message: action === "block" ? "Code blocked." : action === "unblock" ? "Code activated." : "Code renewed.",
        tone: "success",
      });
      loadWorkEmailCodes();
      return true;
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

  const openDeleteWorkerModal = useCallback((worker: Worker) => {
    setDeleteWorkerTarget(worker);
    setDeleteWorkerConfirmText("");
    setDeleteWorkerModalOpen(true);
  }, []);

  const deleteWorker = useCallback(
    async (worker: Worker) => {
      setDeleteWorkerSaving(true);
      const res = await fetchWithAuth<{ ok: boolean; error?: string }>("/api/admin/delete-worker", {
        method: "POST",
        body: JSON.stringify({ workerId: worker.id }),
      });
      if (!res?.ok) {
        setToast({ message: res?.error || "Unable to delete worker.", tone: "danger" });
        setDeleteWorkerSaving(false);
        return;
      }

      setWorkers((prev) => prev.filter((w) => w.id !== worker.id && w.userId !== worker.userId));
      setAssignments((prev) => prev.filter((a) => a.workerId !== worker.id && a.workerId !== (worker.userId ?? "")));
      setWorkItems((prev) => prev.filter((w) => w.workerId !== worker.id && w.workerId !== (worker.userId ?? "")));
      setUpiConfigs((prev) => prev.filter((u) => u.workerId !== worker.id && u.workerId !== (worker.userId ?? "")));
      setSelectedWorkerId((prev) => (prev === worker.id ? null : prev));
      setToast({ message: "Worker deleted.", tone: "success" });
      setDeleteWorkerModalOpen(false);
      setDeleteWorkerTarget(null);
      setDeleteWorkerConfirmText("");
      setDeleteWorkerSaving(false);
      loadSnapshot();
    },
    [loadSnapshot]
  );

  useEffect(() => {
    if (activeSection === "Email Access") {
      void loadWorkEmailCodes();
      void loadWorkEmailAccountsAdmin();
    }
  }, [activeSection, loadWorkEmailCodes, loadWorkEmailAccountsAdmin]);

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
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setToast({ message: "Session expired. Please sign in again.", tone: "danger" });
      return;
    }
    setRevealingPasswordFor(id);
    try {
      const res = await fetch("/api/admin/work-email-accounts/reveal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
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

  const selectedWork = useMemo(
    () => (selectedWorkId ? workItems.find((w) => w.id === selectedWorkId) ?? null : null),
    [workItems, selectedWorkId]
  );

  const dueMeta = useMemo<(
    id: string
  ) => { dueInMin: number; overdue: boolean; slaRemaining?: number; slaBreached?: boolean } | undefined>(() => {
    if (!mounted) {
      return () => undefined;
    }
    const now = new Date();
    const map = new Map<string, { dueInMin: number; overdue: boolean; slaRemaining?: number; slaBreached?: boolean }>();
    workItems.forEach((x) => {
      const due = parseLocalISO(x.dueAt);
      const dueInMin = minutesBetween(now, due);
      const overdue =
        dueInMin < 0 &&
        (x.status === "Open" || x.status === "In progress" || x.status === "Needs fix" || x.status === "Submitted");
      let slaRemaining: number | undefined = undefined;
      let slaBreached: boolean | undefined = undefined;
      if (x.startedAt && (x.status === "In progress" || x.status === "Submitted" || x.status === "Approved" || x.status === "Needs fix")) {
        const started = parseLocalISO(x.startedAt);
        const elapsed = minutesBetween(started, now);
        slaRemaining = x.slaMinutes - elapsed;
        slaBreached = slaRemaining < 0 && x.status === "In progress";
      }
      map.set(x.id, { dueInMin, overdue, slaRemaining, slaBreached });
    });
    return (id: string) => map.get(id);
  }, [workItems, tick, mounted]);

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

  const kpis = useMemo(() => {
    if (!mounted) {
      return { submitted: 0, needsFix: 0, approved: 0, hardRejected: 0, open: 0, inProg: 0, breaches: 0 };
    }
    const scoped = showCancelled ? workItems : workItems.filter((w) => w.status !== "Cancelled");
    const submitted = scoped.filter((w) => isCountedSubmission(w)).length;
    const needsFix = scoped.filter((w) => w.status === "Needs fix").length;
    const approved = scoped.filter((w) => w.status === "Approved").length;
    const hardRejected = scoped.filter((w) => w.status === "Hard rejected").length;
    const open = scoped.filter((w) => w.status === "Open").length;
    const inProg = scoped.filter((w) => w.status === "In progress").length;
    const breaches = scoped.filter((w) => !!dueMeta(w.id)?.overdue || !!dueMeta(w.id)?.slaBreached).length;
    return { submitted, needsFix, approved, hardRejected, open, inProg, breaches };
  }, [workItems, dueMeta, mounted, showCancelled, isCountedSubmission]);

  /** ---------- Admin actions ---------- */
  const logAudit = (id: string, by: string, text: string) => {
    setWorkItems((prev) => prev.map((x) => (x.id === id ? { ...x, audit: [{ at: nowStamp(), by, text }, ...x.audit] } : x)));
  };

  const openWorkDetails = (id: string) => {
    setSelectedWorkId(id);
    if (isMobileWidth()) setDetailsOpenMobile(true);
  };

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

  const approvePayout = useCallback(
    async (batchId: string) => {
      const batch = payoutBatchesAdmin.find((b) => b.id === batchId);
      const upi = batch ? getBatchUpi(batch) : null;
      const days = upi?.payoutSchedule === "Monthly" ? 30 : upi?.payoutSchedule === "Bi-weekly" ? 14 : 7;
      const defaultEta = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const etaDate = window.prompt("Estimated payout date (YYYY-MM-DD)?", defaultEta)?.trim() || defaultEta;
      const res = await fetchWithAuth<{ ok: boolean }>(`/api/admin/payoutbatches/${encodeURIComponent(batchId)}/approve`, {
        method: "PATCH",
        body: JSON.stringify({ etaDate }),
      });
      if (res?.ok) loadSnapshot();
    },
    [loadSnapshot, payoutBatchesAdmin, getBatchUpi]
  );

  const rejectPayout = useCallback(
    async (batchId: string) => {
      const reason = window.prompt("Reason for rejection?", "Rejected by Admin") || "Rejected by Admin";
      const res = await fetchWithAuth<{ ok: boolean }>(`/api/admin/payoutbatches/${encodeURIComponent(batchId)}/reject`, {
        method: "PATCH",
        body: JSON.stringify({ reason }),
      });
      if (res?.ok) loadSnapshot();
    },
    [loadSnapshot]
  );

  const markPayoutPaid = useCallback(
    async (batchId: string) => {
      const res = await fetchWithAuth<{ ok: boolean }>(`/api/admin/payoutbatches/${encodeURIComponent(batchId)}/mark-paid`, {
        method: "PATCH",
      });
      if (res?.ok) loadSnapshot();
    },
    [loadSnapshot]
  );

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
    const wid = prefillWorkerId ?? selectedWorkerId ?? workers[0]?.id ?? "";
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
    if (!wid || !aid || !createWorkTitle.trim()) return;
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

  const setWorkStatus = async (id: string, status: Status, review?: WorkItem["review"]) => {
    const completedAt = status === "Approved" || status === "Hard rejected" ? nowISO() : null;
    const prev = workItems;
    setWorkItems((prev) =>
      prev.map((x) =>
        x.id !== id
          ? x
          : {
              ...x,
              status,
              review: review ?? x.review,
              completedAt: completedAt ?? x.completedAt,
            }
      )
    );
    const res = await fetchWithAuth<{ ok: boolean; error?: string }>(`/api/admin/review`, {
      method: "POST",
      body: JSON.stringify({ id, status, review }),
    });
    if (!res?.ok) {
      setWorkItems(prev);
    }
  };

  const approve = async (id: string) => {
    await setWorkStatus(id, "Approved", { reviewedAt: nowStamp(), reviewer: "Admin", decision: "Approved" });
    logAudit(id, "Admin", "Approved submission.");
    setReviewModalOpen(false);
  };

  const needsFix = async (id: string, reason: string) => {
    const r = reason.trim() || "Needs fix (no reason)";
    await setWorkStatus(id, "Needs fix", { reviewedAt: nowStamp(), reviewer: "Admin", decision: "Needs fix", rejectReason: r });
    logAudit(id, "Admin", `Needs fix: ${r}`);
    setReviewModalOpen(false);
  };

  const hardReject = async (id: string, reason: string) => {
    const r = reason.trim() || "Hard rejected (no reason)";
    await setWorkStatus(id, "Hard rejected", { reviewedAt: nowStamp(), reviewer: "Admin", decision: "Hard rejected", rejectReason: r });
    logAudit(id, "Admin", `Hard rejected: ${r}`);
    setReviewModalOpen(false);
  };

  const openReviewModal = (id: string) => {
    setSelectedWorkId(id);
    setReviewReason("");
    setReviewModalOpen(true);
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
    if (!id || !name || !email || password.length < 6) return;

    const res = await fetchWithAuth<{ ok: boolean; worker: Worker }>(`/api/admin/create-worker`, {
      method: "POST",
      body: JSON.stringify({ workerId: id, name, email, password, active: !!newWorkerActive }),
    });
    if (!res?.ok) return;
    setWorkers((prev) => [res.worker, ...prev]);
    setSelectedWorkerId(res.worker.id);
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
  const ql = q.trim().toLowerCase();
  const visibleWorkers = useMemo(() => {
    if (!ql) return workers;
    return workers.filter(
      (w) => w.id.toLowerCase().includes(ql) || w.name.toLowerCase().includes(ql) || (w.email ?? "").toLowerCase().includes(ql)
    );
  }, [workers, ql]);

  const workForSelectedWorker = useMemo(() => {
    if (!selectedWorkerId) return [];
    let arr = workItems.filter((w) => w.workerId === selectedWorkerId);
    if (!showCancelled) arr = arr.filter((w) => w.status !== "Cancelled");
    if (ql) {
      arr = arr.filter((w) => {
        const acc = accountById(w.accountId);
        return (
          w.id.toLowerCase().includes(ql) ||
          w.title.toLowerCase().includes(ql) ||
          w.type.toLowerCase().includes(ql) ||
          w.status.toLowerCase().includes(ql) ||
          (acc?.handle ?? "").toLowerCase().includes(ql)
        );
      });
    }
    return arr.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority < b.priority ? -1 : 1;
      return parseLocalISO(a.dueAt).getTime() - parseLocalISO(b.dueAt).getTime();
    });
  }, [workItems, selectedWorkerId, ql, accountById]);

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

  const reviewQueue = useMemo(() => {
    let arr = workItems.filter((w) => w.status === "Submitted");
    if (!showCancelled) arr = arr.filter((w) => w.status !== "Cancelled");
    if (ql) {
      arr = arr.filter((w) => {
        const wk = workerById(w.workerId);
        const acc = accountById(w.accountId);
        return (
          w.id.toLowerCase().includes(ql) ||
          w.title.toLowerCase().includes(ql) ||
          (wk?.name ?? "").toLowerCase().includes(ql) ||
          (acc?.handle ?? "").toLowerCase().includes(ql)
        );
      });
    }
    return arr.sort((a, b) => parseLocalISO(a.dueAt).getTime() - parseLocalISO(b.dueAt).getTime());
  }, [workItems, ql, workerById, accountById]);

  /** ---------- Render (UI unchanged) ---------- */
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Mobile nav overlay */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/30" onClick={() => setMobileNavOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-[88vw] max-w-[320px] bg-white shadow-xl">
            <AdminSidebar
              active={activeSection}
              onPick={(s) => {
                setActiveSection(s);
                setMobileNavOpen(false);
              }}
              onLogout={logout}
            />
          </div>
        </div>
      )}

      {/* Mobile details drawer */}
      {detailsOpenMobile && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/30" onClick={() => setDetailsOpenMobile(false)} />
          <div className="absolute right-0 top-0 h-full w-[92vw] max-w-[560px] bg-white shadow-xl">
            <AdminWorkDetails
              item={selectedWork}
              worker={selectedWork ? workerById(selectedWork.workerId) : undefined}
              account={selectedWork ? accountById(selectedWork.accountId) : undefined}
              meta={selectedWork ? dueMeta(selectedWork.id) : undefined}
              onClose={() => setDetailsOpenMobile(false)}
              onReview={() => selectedWork && openReviewModal(selectedWork.id)}
            />
          </div>
        </div>
      )}

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
              <div className="grid h-10 w-10 place-items-center rounded-md bg-[#0078d4] text-white font-black">AD</div>
              <div className="min-w-0">
                <div className="text-sm font-extrabold text-slate-900 truncate">Admin Control Center</div>
                <div className="hidden sm:block text-xs text-slate-600 truncate">
                  Full control • Assignments • Work creation • Reviews • Create workers/accounts
                </div>
              </div>
            </div>

              <div className="flex items-center gap-2">
                <div className="hidden md:flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-700">
                  <Icon name="search" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search workers, accounts, work IDs, handles…"
                    className="w-[380px] bg-transparent text-sm outline-none placeholder:text-slate-400"
                  />
                </div>
                <label className="hidden md:flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-600">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300"
                    checked={showCancelled}
                    onChange={(e) => setShowCancelled(e.target.checked)}
                  />
                  Show cancelled
                </label>
              <Button variant="secondary" onClick={refresh} title="Refresh">
                <Icon name="refresh" />
                Refresh
              </Button>
              <Button variant="secondary" onClick={openCreateWorker} title="Create worker">
                <Icon name="plus" />
                <span className="hidden sm:inline">Worker</span>
              </Button>
              <Button variant="secondary" onClick={openCreateAccount} title="Create account">
                <Icon name="plus" />
                <span className="hidden sm:inline">Account</span>
              </Button>
              <Button variant="ghost" className="border border-slate-200 bg-white" title="Alerts">
                <Icon name="bell" />
                <span className="hidden sm:inline">Alerts</span>
              </Button>
              <Button variant="secondary" onClick={logout} title="Logout">
                <Icon name="logout" />
                <span className="hidden sm:inline">Logout</span>
              </Button>
            </div>
          </div>

          {/* Mobile search */}
          <div className="mt-2 md:hidden">
            <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-700">
              <Icon name="search" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400" />
            </div>
            <label className="mt-2 flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-600">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300"
                checked={showCancelled}
                onChange={(e) => setShowCancelled(e.target.checked)}
              />
              Show cancelled items
            </label>
          </div>

          {/* KPI strip */}
          <div className="mt-2 flex flex-wrap gap-2">
            <Chip tone="warn">Submitted: {kpis.submitted}</Chip>
            <Chip tone="danger">Breaches: {kpis.breaches}</Chip>
            <Chip tone="info">In progress: {kpis.inProg}</Chip>
            <Chip tone="neutral">Open: {kpis.open}</Chip>
            <Chip tone="success">Approved: {kpis.approved}</Chip>
            <Chip tone="danger">Hard rejected: {kpis.hardRejected}</Chip>
            {!mounted && <Chip tone="neutral">Loading…</Chip>}
          </div>
        </div>
      </header>

      {toast && (
        <div className="fixed right-4 top-16 z-[80] rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-extrabold text-slate-900 shadow-lg">
          <div className={`inline-flex items-center gap-2 ${toast.tone === "success" ? "text-emerald-600" : "text-rose-600"}`}>
            <span className="h-2.5 w-2.5 rounded-full bg-current" />
            {toast.message}
          </div>
        </div>
      )}

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="grid grid-cols-12 gap-6">
          {/* Desktop sidebar */}
          <aside className="hidden lg:block col-span-3">
            <AdminSidebar active={activeSection} onPick={setActiveSection} onLogout={logout} />
          </aside>

          {/* Main */}
          <main className="col-span-12 lg:col-span-9 space-y-6">
            {/* Overview */}
            {activeSection === "Overview" && (
              <div className="space-y-6">
                <div className="grid gap-6 lg:grid-cols-2">
                <Card title="Review queue" subtitle="Submitted items awaiting admin decision" right={<Chip tone="warn">{reviewQueue.length}</Chip>}>
                  <AdminReviewList
                    items={reviewQueue.slice(0, 8)}
                    workerById={workerById}
                    accountById={accountById}
                    metaOf={dueMeta}
                    onOpen={openWorkDetails}
                    onReview={openReviewModal}
                  />
                  {reviewQueue.length === 0 && <div className="text-sm text-slate-600">No submitted items right now.</div>}
                </Card>

                <Card
                  title="Workers snapshot"
                  subtitle="Assignments + workload at a glance"
                  right={
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={openCreateWorker}>
                        <Icon name="plus" />
                        Add worker
                      </Button>
                      <Button variant="secondary" onClick={openCreateAccount}>
                        <Icon name="plus" />
                        Add account
                      </Button>
                    </div>
                  }
                >
                  <div className="space-y-3">
                    {workers.map((w) => {
                      const assignedCount = accountsForWorker(w.id).length;
                      const pending = workItems.filter((it) => isWorkerMatch(w, it) && isCountedSubmission(it)).length;
                      const resubmits = workItems.filter((it) => isWorkerMatch(w, it) && isResubmission(it)).length;
                      const inProg = workItems.filter((it) => isWorkerMatch(w, it) && it.status === "In progress").length;
                      const earningsApproved = getWorkerApprovedEarnings(w);
                      const upi = getWorkerUpi(w);
                      return (
                        <button
                          key={w.id}
                          className="w-full text-left rounded-lg border border-slate-200 bg-white p-3 hover:bg-slate-50 transition"
                          onClick={() => {
                            setSelectedWorkerId(w.id);
                            setActiveSection("Workers");
                          }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-sm font-extrabold text-slate-900 truncate">{w.name}</div>
                              <div className="text-xs text-slate-600 truncate">
                                {w.id}
                                {w.email ? ` • ${w.email}` : ""}
                              </div>
                              {upi?.upiId && (
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                                  <span className="truncate">UPI: {upi.upiId}</span>
                                  <Chip tone={upi.verified ? "success" : "warn"}>{upi.verified ? "Verified" : "Unverified"}</Chip>
                                </div>
                              )}
                            </div>
                            <Chip tone={w.active ? "success" : "danger"}>{w.active ? "Active" : "Inactive"}</Chip>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Chip tone="info">{assignedCount} accounts</Chip>
                            <Chip tone="warn">{pending} submitted</Chip>
                            <Chip tone="neutral">{resubmits} resubmits</Chip>
                            <Chip tone="neutral">{inProg} in progress</Chip>
                            <Chip tone="success">{formatINR(earningsApproved)} approved</Chip>
                          </div>
                        </button>
                      );
                    })}
                    {workers.length === 0 && <div className="text-sm text-slate-600">Loading workers…</div>}
                  </div>
                </Card>
                </div>

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
              </div>
            )}

            {/* Workers */}
            {activeSection === "Workers" && (
              <div className="grid grid-cols-12 gap-6">
                <div className="col-span-12 lg:col-span-5 space-y-6">
                  <Card
                    title="Workers"
                    subtitle="Select a worker to manage assignments and work"
                    right={
                      <Button variant="secondary" onClick={openCreateWorker}>
                        <Icon name="plus" />
                        Create worker
                      </Button>
                    }
                  >
                    <div className="space-y-2">
                      {visibleWorkers.map((w) => (
                        <button
                          key={w.id}
                          onClick={() => setSelectedWorkerId(w.id)}
                          className={cx(
                            "w-full text-left rounded-lg border p-3 transition",
                            selectedWorkerId === w.id ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-white hover:bg-slate-50"
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-sm font-extrabold text-slate-900 truncate">{w.name}</div>
                              <div className="mt-1 text-xs text-slate-600 truncate">
                                {w.id}
                                {w.email ? ` • ${w.email}` : ""}
                              </div>
                              {(() => {
                                const upi = getWorkerUpi(w);
                                if (!upi?.upiId) return null;
                                return (
                                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                                    <span className="truncate">UPI: {upi.upiId}</span>
                                    <Chip tone={upi.verified ? "success" : "warn"}>{upi.verified ? "Verified" : "Unverified"}</Chip>
                                  </div>
                                );
                              })()}
                            </div>
                            <Chip tone={w.active ? "success" : "danger"}>{w.active ? "Active" : "Inactive"}</Chip>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Chip tone="info">{accountsForWorker(w.id).length} accounts</Chip>
                            <Chip tone="warn">{workItems.filter((it) => isWorkerMatch(w, it) && isCountedSubmission(it)).length} submitted</Chip>
                            <Chip tone="neutral">{workItems.filter((it) => isWorkerMatch(w, it) && isResubmission(it)).length} resubmits</Chip>
                            <Chip tone="success">{formatINR(getWorkerApprovedEarnings(w))} approved</Chip>
                          </div>
                        </button>
                      ))}
                      {visibleWorkers.length === 0 && <div className="text-sm text-slate-600">No workers match search.</div>}
                    </div>
                  </Card>
                </div>

                <div className="col-span-12 lg:col-span-7 space-y-6">
                  <Card
                    title="Worker controls"
                    subtitle="Assignments + work creation are admin-owned."
                    right={
                      <div className="flex gap-2">
                        <Button variant="secondary" onClick={openCreateAccount}>
                          <Icon name="plus" />
                          Create account
                        </Button>
                        <Button variant="primary" onClick={() => openCreateWork(selectedWorkerId ?? undefined)} disabled={!selectedWorkerId}>
                          <Icon name="plus" />
                          Create work
                        </Button>
                      </div>
                    }
                  >
                    {!selectedWorker ? (
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">Select a worker to manage.</div>
                    ) : (
                      <div className="space-y-4">
                        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <div className="text-sm font-extrabold text-slate-900">{selectedWorker.name}</div>
                              <div className="text-xs text-slate-600">
                                {selectedWorker.id}
                                {selectedWorker.email ? ` • ${selectedWorker.email}` : ""}
                              </div>
                              {(() => {
                                const upi = getWorkerUpi(selectedWorker);
                                if (!upi?.upiId) return null;
                                return (
                                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                                    <span className="truncate">UPI: {upi.upiId}</span>
                                    <Chip tone={upi.verified ? "success" : "warn"}>{upi.verified ? "Verified" : "Unverified"}</Chip>
                                    {upi.payoutSchedule && upi.payoutDay && (
                                      <span className="text-[11px] text-slate-400">
                                        {upi.payoutSchedule} • {upi.payoutDay}
                                      </span>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                            <Chip tone="info">{accountsForWorker(selectedWorker.id).length} assigned accounts</Chip>
                          </div>
                          <div className="mt-3">
                            <Button variant="danger" onClick={() => openDeleteWorkerModal(selectedWorker)}>
                              Delete this worker
                            </Button>
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          <Card title="Assigned accounts" subtitle="Remove or add accounts. Target 5–6+ per worker." compact>
                            <div className="space-y-2">
                              {accountsForWorker(selectedWorker.id).map((aid, idx) => {
                                const acc = accountById(aid);
                                if (!acc) return null;
                                return (
                                  <div key={`${selectedWorker.id}-${aid}-${idx}`} className="rounded-lg border border-slate-200 bg-white p-3">
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0">
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
                                      <div className="flex items-center gap-2">
                                        <AccountHealthPill h={acc.health} />
                                        <Button variant="secondary" title="Edit schedule" onClick={() => openEditSchedule(selectedWorker.id, aid)}>
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
                            <AddAssignmentPanel
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
                            />
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
                          )}
                        </Card>

                        <Card title="Worker timezone" subtitle="Default timezone for new schedules" compact>
                          <div className="space-y-2">
                            <select
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
                    )}
                  </Card>
                </div>
              </div>
            )}

            {/* Assignments */}
            {activeSection === "Assignments" && (
              <Card title="Assignments matrix" subtitle="Admin-owned mapping between workers and accounts.">
                <AssignmentsMatrix workers={workers} accounts={accounts} assignments={assignments} onAssign={assignAccount} onRemove={removeAssignment} />
              </Card>
            )}

            {/* Work */}
            {activeSection === "Work" && (
              <div className="grid grid-cols-12 gap-6">
                <div className="col-span-12 lg:col-span-8 space-y-6">
                  <Card
                    title="Work items"
                    subtitle="Admin can create, track and open any work item."
                    right={
                      <div className="flex items-center gap-2">
                        <select
                          value={selectedWorkerId ?? ""}
                          onChange={(e) => setSelectedWorkerId(e.target.value || null)}
                          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-extrabold text-slate-900 outline-none"
                        >
                          {workers.map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.name} ({w.id})
                            </option>
                          ))}
                        </select>
                        <Button variant="primary" onClick={() => openCreateWork(selectedWorkerId ?? undefined)} disabled={!selectedWorkerId}>
                          <Icon name="plus" />
                          Create work
                        </Button>
                      </div>
                    }
                  >
                    <AdminWorkTable
                      items={workForSelectedWorker}
                      workerById={workerById}
                      accountById={accountById}
                      metaOf={dueMeta}
                      onOpen={openWorkDetails}
                      onReview={openReviewModal}
                    />
                  </Card>
                </div>

                <div className="col-span-12 lg:col-span-4 space-y-6">
                  <AdminWorkDetails
                    item={selectedWork}
                    worker={selectedWork ? workerById(selectedWork.workerId) : undefined}
                    account={selectedWork ? accountById(selectedWork.accountId) : undefined}
                    meta={selectedWork ? dueMeta(selectedWork.id) : undefined}
                    onClose={() => setSelectedWorkId(null)}
                    onReview={() => selectedWork && openReviewModal(selectedWork.id)}
                  />
                </div>
              </div>
            )}

            {/* Payouts */}
            {activeSection === "Payouts" && (
              <div className="grid grid-cols-12 gap-6">
                <div className="col-span-12 space-y-6">
                  <Card title="Payout requests" subtitle="Review, approve, or reject worker payout requests.">
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
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
                          {payoutBatchesAdmin.map((b) => {
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
                                    <Button variant="secondary" onClick={() => approvePayout(b.id)} disabled={b.status !== "Draft"}>
                                      Approve
                                    </Button>
                                    <Button variant="secondary" onClick={() => rejectPayout(b.id)} disabled={b.status === "Paid"}>
                                      Reject
                                    </Button>
                                    <Button variant="primary" onClick={() => markPayoutPaid(b.id)} disabled={b.status !== "Processing"}>
                                      Mark paid
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                          {payoutBatchesAdmin.length === 0 && (
                            <tr>
                              <td colSpan={7} className="px-3 py-6 text-sm text-slate-600">
                                No payout requests yet.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
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
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
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
                    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                        <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-500">Total</div>
                        <div className="mt-1 text-lg font-black text-slate-900">{workEmailCodeStats.total}</div>
                      </div>
                      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
                        <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-emerald-700">Active</div>
                        <div className="mt-1 text-lg font-black text-emerald-900">{workEmailCodeStats.active}</div>
                      </div>
                      <div className="rounded-md border border-rose-200 bg-rose-50 p-3">
                        <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-rose-700">Blocked</div>
                        <div className="mt-1 text-lg font-black text-rose-900">{workEmailCodeStats.blocked}</div>
                      </div>
                      <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                        <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-amber-700">Expired</div>
                        <div className="mt-1 text-lg font-black text-amber-900">{workEmailCodeStats.expired}</div>
                      </div>
                      <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
                        <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-blue-700">Exhausted</div>
                        <div className="mt-1 text-lg font-black text-blue-900">{workEmailCodeStats.exhausted}</div>
                      </div>
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
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="min-w-[1160px] w-full text-left text-sm">
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
                              <td className="px-3 py-3 font-extrabold text-slate-900">{row.code_hint}</td>
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
                                      <div className="h-full rounded-full bg-[#0b5cab]" style={{ width: `${row.usagePct}%` }} />
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

            {/* Gigs */}
            {activeSection === "Gigs" && (
              <div className="grid grid-cols-12 gap-6">
                <div className="col-span-12 space-y-6">
                  <Card title="Gig marketplace" subtitle="Manage gigs and applications in the dedicated console.">
                    <div className="flex flex-wrap items-center gap-3">
                      <a
                        href="/addgigs"
                        className="rounded-full bg-[#0b5cab] px-5 py-2 text-sm font-semibold text-white hover:bg-[#0f6bc7]"
                      >
                        Open gig management
                      </a>
                      <a
                        href="/browse"
                        className="rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400"
                      >
                        View marketplace
                      </a>
                    </div>
                  </Card>
                </div>
              </div>
            )}

            {/* Reviews */}
            {activeSection === "Reviews" && (
              <Card title="Reviews & enforcement" subtitle="Approve, Needs fix, or Hard reject submitted work.">
                <AdminReviewList
                  items={reviewQueue}
                  workerById={workerById}
                  accountById={accountById}
                  metaOf={dueMeta}
                  onOpen={openWorkDetails}
                  onReview={openReviewModal}
                />
                {reviewQueue.length === 0 && <div className="text-sm text-slate-600 mt-2">No submitted items.</div>}
              </Card>
            )}
          </main>
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
                disabled={!newWorkerId.trim() || !newWorkerName.trim() || !newWorkerEmail.trim() || newWorkerPassword.length < 6}
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
              <div className="text-sm font-extrabold text-slate-800">Password (min 6 chars)</div>
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

      {/* Delete Worker modal */}
      {deleteWorkerModalOpen && deleteWorkerTarget && (
        <Modal
          title="Delete worker permanently"
          subtitle={`Type "${deleteWorkerTarget.id}" to confirm`}
          onClose={() => {
            if (deleteWorkerSaving) return;
            setDeleteWorkerModalOpen(false);
            setDeleteWorkerTarget(null);
            setDeleteWorkerConfirmText("");
          }}
          actions={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  if (deleteWorkerSaving) return;
                  setDeleteWorkerModalOpen(false);
                  setDeleteWorkerTarget(null);
                  setDeleteWorkerConfirmText("");
                }}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => void deleteWorker(deleteWorkerTarget)}
                disabled={deleteWorkerSaving || deleteWorkerConfirmText.trim() !== deleteWorkerTarget.id}
              >
                {deleteWorkerSaving ? "Deleting..." : "Delete worker"}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              This action removes worker login access and related worker records.
            </div>
            <div className="text-sm text-slate-700">
              Worker: <span className="font-extrabold text-slate-900">{deleteWorkerTarget.name}</span> ({deleteWorkerTarget.id})
            </div>
            <div>
              <div className="text-sm font-extrabold text-slate-800">Confirm worker ID</div>
              <input
                value={deleteWorkerConfirmText}
                onChange={(e) => setDeleteWorkerConfirmText(e.target.value)}
                placeholder={deleteWorkerTarget.id}
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none"
              />
            </div>
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
              <Button variant="primary" onClick={createWork} disabled={!createWorkWorkerId || !createWorkAccountId || !createWorkTitle.trim()}>
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
                value={createWorkWorkerId}
                onChange={(e) => {
                  const wid = e.target.value;
                  setCreateWorkWorkerId(wid);
                  const firstAcc = accountsForWorker(wid)[0] ?? "";
                  setCreateWorkAccountId(firstAcc);
                }}
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm font-extrabold text-slate-900 outline-none"
              >
                {workers.map((w) => (
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

      {/* Review modal */}
      {reviewModalOpen && selectedWork && (
        <Modal
          title="Review submitted work"
          subtitle={`${selectedWork.id} • ${clampText(selectedWork.title, 64)}`}
          onClose={() => setReviewModalOpen(false)}
          actions={
            <>
              <Button variant="secondary" onClick={() => setReviewModalOpen(false)}>
                Close
              </Button>
              <Button variant="primary" onClick={() => approve(selectedWork.id)} disabled={selectedWork.status !== "Submitted"}>
                <Icon name="check" />
                Approve
              </Button>
              <Button variant="danger" onClick={() => needsFix(selectedWork.id, reviewReason)} disabled={selectedWork.status !== "Submitted"}>
                Needs fix
              </Button>
              <Button variant="danger" onClick={() => hardReject(selectedWork.id, reviewReason)} disabled={selectedWork.status !== "Submitted"}>
                Hard reject
              </Button>
            </>
          }
        >
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-extrabold">Submission</div>
              <WorkStatusBadge s={selectedWork.status} />
            </div>
            <div className="mt-2 space-y-1">
              <div className="break-all">
                <b>Reel:</b> {selectedWork.submission?.reelUrl || "—"}
              </div>
              <div className="break-all">
                <b>Screenshot:</b> {selectedWork.submission?.screenshotUrl || "—"}
              </div>
              <div className="text-xs text-slate-500">Submitted: {selectedWork.submission?.submittedAt || "—"}</div>
            </div>
          </div>

          <div className="mt-4">
            <div className="text-sm font-extrabold text-slate-800">Reason (required for Needs fix / Hard reject)</div>
            <textarea
              value={reviewReason}
              onChange={(e) => setReviewReason(e.target.value)}
              placeholder="Example: Screenshot missing, audio not approved, caption violates policy…"
              className="mt-2 w-full min-h-[120px] rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-[#0078d4]/20"
            />
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

  useEffect(() => {
    let alive = true;

    // ✅ Practical: if auth state changes (logout/session expiry), leave admin immediately
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      const lsSession = readLS<AuthSession | null>(LS_KEYS.AUTH, null);
      const hasLocalAdmin = lsSession?.role === "Admin";
      const hasSupabase = !!session?.user;
      if (!hasLocalAdmin && !hasSupabase) {
        setOk(false);
        if (pathname !== "/login") router.replace("/login");
      }
    });

    (async () => {
      // 1) ✅ Demo/local admin session support (kept)
      const lsSession = readLS<AuthSession | null>(LS_KEYS.AUTH, null);
      if (lsSession?.role === "Admin") {
        if (!alive) return;
        setOk(true);
        return;
      }

      // 2) ✅ Supabase auth (kept)
      const { data: authRes } = await supabase.auth.getUser();
      const user = authRes?.user;
      if (!user) {
        if (!alive) return;
        if (pathname !== "/login") router.replace("/login");
        return;
      }

      const { data: profile, error } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      if (error || profile?.role !== "Admin") {
        if (!alive) return;
        router.replace("/workspace");
        return;
      }

      if (!alive) return;
      setOk(true);
    })();

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe();
    };
  }, [router, pathname]);

  if (!ok) return null;
  return <AdminConsole />;
}

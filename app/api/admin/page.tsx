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

/** ===================== Types ===================== */
type PolicyTier = "Standard" | "Strict";
type AccountHealth = "Healthy" | "Watch" | "Risk";
type TaskType = "Reel posting" | "Story posting" | "Comment replies" | "Profile update";
type Priority = "P0" | "P1" | "P2";
type Status = "Open" | "In progress" | "Submitted" | "Approved" | "Needs fix" | "Hard rejected";

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
  id: string;
  userId?: string;
  name: string;
  email: string;
  active: boolean;
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
};

type ApiSnapshot = {
  workers: Worker[];
  accounts: AssignedAccount[];
  assignments: Assignment[];
  workItems: WorkItem[];
};

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

/** ===================== Page (UI) ===================== */
type AdminSection = "Overview" | "Workers" | "Assignments" | "Work" | "Reviews";

function AdminConsole() {
  // Hydration-safe mount guard
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const today = isoToday();

  // global UI
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<AdminSection>("Overview");
  const [q, setQ] = useState("");
  const [tick, setTick] = useState(0);

  // data
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [accounts, setAccounts] = useState<AssignedAccount[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);

  // selection / drawers
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null);
  const [detailsOpenMobile, setDetailsOpenMobile] = useState(false);

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

  // create worker + create account
  const [createWorkerOpen, setCreateWorkerOpen] = useState(false);
  const [newWorkerId, setNewWorkerId] = useState("");
  const [newWorkerName, setNewWorkerName] = useState("");
  const [newWorkerEmail, setNewWorkerEmail] = useState("");
  const [newWorkerPassword, setNewWorkerPassword] = useState(""); // NEW
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

  const refreshLock = useRef(false);
  const scheduleLock = useRef(false);

  const loadSnapshot = useCallback(async () => {
    if (refreshLock.current) return;
    refreshLock.current = true;
    try {
      const workersReq = fetchWithAuth<{ ok: boolean; workers: Worker[] }>("/api/admin/workers", { method: "GET" });
      const snap = await fetchWithAuth<ApiSnapshot>("/api/admin/snapshot", { method: "GET" });
      if (!snap) return;

      const workersRes = await workersReq;
      if (workersRes?.ok && workersRes.workers?.length) {
        setWorkers(workersRes.workers);
        setSelectedWorkerId((prev) => prev ?? workersRes.workers[0]?.id ?? null);
      } else if (snap.workers?.length) {
        setWorkers(snap.workers);
        setSelectedWorkerId((prev) => prev ?? snap.workers[0]?.id ?? null);
      } else {
        setWorkers([]);
      }
      const snapErrors = (snap as any).errors as Array<{ table?: string; message?: string }> | undefined;
      const accountsErrored = !!snapErrors?.some((e) => e.table === "accounts");
      if (!accountsErrored) {
        setAccounts(snap.accounts);
      }
      setAssignments(snap.assignments);
      setWorkItems(snap.workItems);
      if (!scheduleLock.current) {
        scheduleLock.current = true;
        await fetchWithAuth<{ ok: boolean }>("/api/admin/schedule-work", { method: "POST", body: JSON.stringify({}) });
      }
    } finally {
      window.setTimeout(() => {
        refreshLock.current = false;
      }, 400);
    }
  }, []);

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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [mounted, loadSnapshot]);

  const refresh = () => {
    setTick((t) => t + 1);
    loadSnapshot();
  };

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

  const selectedWorker = useMemo(
    () => (selectedWorkerId ? workerById(selectedWorkerId) : null),
    [selectedWorkerId, workerById]
  );

  const selectedWork = useMemo(
    () => (selectedWorkId ? workItems.find((w) => w.id === selectedWorkId) ?? null : null),
    [workItems, selectedWorkId]
  );

  const dueMeta = useMemo(() => {
    if (!mounted) {
      return (_id: string) => undefined as any;
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
      if (
        x.startedAt &&
        (x.status === "In progress" || x.status === "Submitted" || x.status === "Approved" || x.status === "Needs fix")
      ) {
        const started = parseLocalISO(x.startedAt);
        const elapsed = minutesBetween(started, now);
        slaRemaining = x.slaMinutes - elapsed;
        slaBreached = slaRemaining < 0 && x.status === "In progress";
      }
      map.set(x.id, { dueInMin, overdue, slaRemaining, slaBreached });
    });
    return (id: string) => map.get(id);
  }, [workItems, tick, mounted]);

  const kpis = useMemo(() => {
    if (!mounted) {
      return { submitted: 0, needsFix: 0, approved: 0, hardRejected: 0, open: 0, inProg: 0, breaches: 0 };
    }
    const submitted = workItems.filter((w) => w.status === "Submitted").length;
    const needsFix = workItems.filter((w) => w.status === "Needs fix").length;
    const approved = workItems.filter((w) => w.status === "Approved").length;
    const hardRejected = workItems.filter((w) => w.status === "Hard rejected").length;
    const open = workItems.filter((w) => w.status === "Open").length;
    const inProg = workItems.filter((w) => w.status === "In progress").length;
    const breaches = workItems.filter((w) => !!dueMeta(w.id)?.overdue || !!dueMeta(w.id)?.slaBreached).length;
    return { submitted, needsFix, approved, hardRejected, open, inProg, breaches };
  }, [workItems, dueMeta, mounted]);

  /** ---------- Admin actions (kept) ---------- */
  const logAudit = (id: string, by: string, text: string) => {
    setWorkItems((prev) => prev.map((x) => (x.id === id ? { ...x, audit: [{ at: nowStamp(), by, text }, ...x.audit] } : x)));
  };

  const openWorkDetails = (id: string) => {
    setSelectedWorkId(id);
    if (isMobileWidth()) setDetailsOpenMobile(true);
  };

  const assignAccount = async (workerId: string, accountId: string) => {
    // optimistic
    setAssignments((prev) => {
      const exists = prev.some((a) => a.workerId === workerId && a.accountId === accountId);
      if (exists) return prev;
      return [...prev, { workerId, accountId }];
    });

    // write directly to Supabase (client) OR call your API.
    await supabase.from("assignments").insert({ workerId, accountId });
  };

  const removeAssignment = async (workerId: string, accountId: string) => {
    setAssignments((prev) => prev.filter((a) => !(a.workerId === workerId && a.accountId === accountId)));
    await supabase.from("assignments").delete().eq("workerId", workerId).eq("accountId", accountId);
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

    await supabase.from("work_items").insert(item);
  };

  const setWorkStatus = async (id: string, status: Status, review?: WorkItem["review"]) => {
    setWorkItems((prev) =>
      prev.map((x) =>
        x.id !== id
          ? x
          : {
              ...x,
              status,
              review: review ?? x.review,
              completedAt: status === "Approved" || status === "Hard rejected" ? nowISO() : x.completedAt,
            }
      )
    );

    await supabase.from("work_items").update({ status, review, completedAt: status === "Approved" || status === "Hard rejected" ? nowISO() : null }).eq("id", id);
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

  // Create worker (NOW creates Supabase Auth + profile)
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

    // call secure API that uses service role
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

  // Create account (kept, but now writes realtime)
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

  const createAccount = async () => {
    const id = newAccountId.trim();
    const handle = normHandle(newAccountHandle);
    const niche = newAccountNiche.trim();
    const ownerTeam = newAccountOwnerTeam.trim();
    if (!id || !handle || !niche || !ownerTeam) return;
    if (accounts.some((a) => a.id === id) || accounts.some((a) => a.handle.toLowerCase() === handle.toLowerCase())) return;

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

    setAccounts((prev) => [acc, ...prev]);
    setCreateAccountOpen(false);

    await supabase.from("accounts").insert(acc);
  };

  /** ---------- Filters ---------- */
  const ql = q.trim().toLowerCase();

  const visibleWorkers = useMemo(() => {
    if (!ql) return workers;
    return workers.filter(
      (w) => w.id.toLowerCase().includes(ql) || w.name.toLowerCase().includes(ql) || w.email.toLowerCase().includes(ql)
    );
  }, [workers, ql]);

  const workForSelectedWorker = useMemo(() => {
    if (!selectedWorkerId) return [];
    let arr = workItems.filter((w) => w.workerId === selectedWorkerId);
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

  const reviewQueue = useMemo(() => {
    let arr = workItems.filter((w) => w.status === "Submitted");
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

  /** ---------- Render (YOUR UI unchanged) ---------- */
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
            </div>
          </div>

          {/* Mobile search */}
          <div className="mt-2 md:hidden">
            <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-700">
              <Icon name="search" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search…"
                className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
              />
            </div>
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

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="grid grid-cols-12 gap-6">
          {/* Desktop sidebar */}
          <aside className="hidden lg:block col-span-3">
            <AdminSidebar active={activeSection} onPick={setActiveSection} />
          </aside>

          {/* Main */}
          <main className="col-span-12 lg:col-span-9 space-y-6">
            {/* Overview */}
            {activeSection === "Overview" && (
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
                      const pending = workItems.filter((it) => it.workerId === w.id && it.status === "Submitted").length;
                      const inProg = workItems.filter((it) => it.workerId === w.id && it.status === "In progress").length;
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
                                {w.id} • {w.email}
                              </div>
                            </div>
                            <Chip tone={w.active ? "success" : "danger"}>{w.active ? "Active" : "Inactive"}</Chip>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Chip tone="info">{assignedCount} accounts</Chip>
                            <Chip tone="warn">{pending} submitted</Chip>
                            <Chip tone="neutral">{inProg} in progress</Chip>
                          </div>
                        </button>
                      );
                    })}
                    {workers.length === 0 && <div className="text-sm text-slate-600">Loading workers…</div>}
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
                                {w.id} • {w.email}
                              </div>
                            </div>
                            <Chip tone={w.active ? "success" : "danger"}>{w.active ? "Active" : "Inactive"}</Chip>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Chip tone="info">{accountsForWorker(w.id).length} accounts</Chip>
                            <Chip tone="warn">{workItems.filter((it) => it.workerId === w.id && it.status === "Submitted").length} submitted</Chip>
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
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                        Select a worker to manage.
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <div className="text-sm font-extrabold text-slate-900">{selectedWorker.name}</div>
                              <div className="text-xs text-slate-600">
                                {selectedWorker.id} • {selectedWorker.email}
                              </div>
                            </div>
                            <Chip tone="info">{accountsForWorker(selectedWorker.id).length} assigned accounts</Chip>
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          <Card title="Assigned accounts" subtitle="Remove or add accounts. Target 5–6+ per worker." compact>
                            <div className="space-y-2">
                              {accountsForWorker(selectedWorker.id).map((aid) => {
                                const acc = accountById(aid);
                                if (!acc) return null;
                                return (
                                  <div key={aid} className="rounded-lg border border-slate-200 bg-white p-3">
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <div className="text-sm font-extrabold text-slate-900 truncate">{acc.handle}</div>
                                        <div className="text-xs text-slate-600 truncate">
                                          {acc.ownerTeam} • {acc.policyTier}
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <AccountHealthPill h={acc.health} />
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
                              onAssign={(accountId) => assignAccount(selectedWorker.id, accountId)}
                              onCreateAccount={openCreateAccount}
                            />
                          </Card>
                        </div>
                      </div>
                    )}
                  </Card>
                </div>
              </div>
            )}

            {/* Assignments */}
            {activeSection === "Assignments" && (
              <Card title="Assignments matrix" subtitle="Admin-owned mapping between workers and accounts.">
                <AssignmentsMatrix workers={workers} accounts={accounts} assignments={assignments} onRemove={removeAssignment} />
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
                              {w.name}
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

      {/* Create Worker modal (UPDATED: password field) */}
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
                <input
                  type="checkbox"
                  checked={newWorkerActive}
                  onChange={() => setNewWorkerActive((v) => !v)}
                  className="h-4 w-4 accent-[#0078d4]"
                />
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

      {/* Create Account modal (unchanged UI) */}
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
          {/* (same as your existing modal) */}
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

      {/* Create Work modal (unchanged UI) */}
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
          {/* same as your existing modal */}
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

      {/* Review modal (unchanged UI) */}
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
    </div>
  );
}

/** ===================== Sidebar ===================== */
function AdminSidebar({ active, onPick }: { active: AdminSection; onPick: (s: AdminSection) => void }) {
  const Item = ({ id, label, icon }: { id: AdminSection; label: string; icon: string }) => (
    <button
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
        <Item id="Overview" label="Overview" icon="briefcase" />
        <Item id="Workers" label="Workers" icon="users" />
        <Item id="Assignments" label="Assignments" icon="briefcase" />
        <Item id="Work" label="Work items" icon="briefcase" />
        <Item id="Reviews" label="Reviews" icon="shield" />
      </nav>

      <div className="mt-auto px-4 py-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <div className="text-xs font-extrabold text-slate-600">Enforcement</div>
          <div className="mt-1">Only Admin can approve / reject / hard reject.</div>
        </div>
      </div>
    </div>
  );
}

/** ===================== Assignments Panels ===================== */
function AddAssignmentPanel({
  workerId,
  accounts,
  assignedIds,
  onAssign,
  onCreateAccount,
}: {
  workerId: string;
  accounts: AssignedAccount[];
  assignedIds: Set<string>;
  onAssign: (accountId: string) => void;
  onCreateAccount: () => void;
}) {
  const [pick, setPick] = useState("");
  const available = useMemo(() => accounts.filter((a) => !assignedIds.has(a.id)), [accounts, assignedIds]);

  useEffect(() => {
    setPick(available[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workerId, available.length]);

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
      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="primary" onClick={() => pick && onAssign(pick)} disabled={!pick || available.length === 0} className="w-full">
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
  onRemove,
}: {
  workers: Worker[];
  accounts: AssignedAccount[];
  assignments: Assignment[];
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
                        <Chip tone="neutral">—</Chip>
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
                    <div className="text-xs text-slate-500">{wk?.email ?? "—"}</div>
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

/** ===================== Exported Page (Auth Gate + UI) ===================== */
export default function AdminPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    let alive = true;

    (async () => {
      // 1) ✅ Demo/local admin session support (kept)
      // IMPORTANT: only trust LS if role is Admin (as before).
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
    };
  }, [router, pathname]);

  if (!ok) return null;
  return <AdminConsole />;
}

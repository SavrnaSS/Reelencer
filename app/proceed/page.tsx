"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabaseClient";

type Role = "Admin" | "Worker";
type AuthSession = { role: Role; workerId?: string; at: string };

type Gig = {
  id: string;
  title: string;
  company: string;
  platform: string;
  location: string;
  workload: string;
  payout: string;
  payoutType: string;
  gigType?: string;
  requirements?: string[];
  status: string;
  postedAt: string;
};

type Assignment = {
  id: string;
  gigId: string;
  workerId: string;
  assignedEmail: string;
  assignedEmails?: string[];
  status: string;
  submittedAt?: string;
  decidedAt?: string;
  subjectFilter?: string;
  earningsReleaseStatus?: "none" | "queued" | "credited" | "blocked";
  earningsReleasedAt?: string;
};

type ProposalPayload = {
  pitch?: string;
  approach?: string;
  timeline?: string;
  budget?: string;
  portfolio?: string;
  submittedAt?: string;
  reviewStatus?: "Pending" | "Accepted" | "Rejected";
  adminNote?: string;
  adminExplanation?: string;
  whatsappLink?: string;
  onboardingSteps?: string;
  groupJoinedConfirmed?: boolean;
  groupJoinedConfirmedAt?: string;
  reviewedAt?: string;
};

type GigApplication = {
  id: string;
  gigId: string;
  workerId: string;
  status: string;
  appliedAt: string;
  decidedAt?: string;
  proposal?: ProposalPayload;
};

type WorkerMetrics = {
  money?: {
    earnings?: number;
  };
};

type CredentialPayoutState =
  | { stage: "idle"; headline: string; detail: string }
  | { stage: "pending"; headline: string; detail: string }
  | { stage: "approved"; headline: string; detail: string }
  | { stage: "crediting"; headline: string; detail: string; paidAt?: string }
  | { stage: "paid"; headline: string; detail: string; paidAt?: string }
  | { stage: "blocked"; headline: string; detail: string };

type CredentialRow = {
  handle: string;
  email: string;
  password: string;
  phone: string;
};

const CREDENTIAL_SUCCESS_MESSAGE = "Credentials submitted. Admin review is now in progress.";

function getProceedDisplayName(user: { email?: string | null; user_metadata?: { name?: string; full_name?: string } }) {
  const explicitName = user.user_metadata?.name?.trim() || user.user_metadata?.full_name?.trim();
  if (explicitName) return explicitName;

  const email = user.email?.trim();
  if (!email) return "User";

  const local = email.split("@")[0]?.replace(/[._-]+/g, " ").trim();
  if (!local) return "User";

  return local.replace(/\b\w/g, (char) => char.toUpperCase());
}

function isWorkspaceGig(gig: Pick<Gig, "gigType" | "title">) {
  const raw = String(gig.gigType ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  if (raw === "workspace" || raw === "full-time" || raw === "fulltime") return true;
  return /\b(workspace|full[\s-]?time)\b/i.test(gig.title || "");
}

function isCustomGigType(gig: Pick<Gig, "gigType" | "title">) {
  const raw = String(gig.gigType ?? "").trim().toLowerCase();
  if (!raw) return false;
  if (raw === "email creator" || raw === "part-time" || raw === "part time") return false;
  if (raw === "project") return false;
  if (raw === "content posting") return false;
  if (raw === "workspace" || raw === "full-time" || raw === "full time" || raw === "fulltime") return false;
  return true;
}

function isProjectGigType(gig: Pick<Gig, "gigType">) {
  const raw = String(gig.gigType ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  return raw === "project";
}

function parseProceedPayoutAmount(raw: unknown) {
  const text = String(raw ?? "").trim();
  if (!text) return 0;
  const normalized = text.replace(/[, ]+/g, "");
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function parseOnboardingChecklist(text: string) {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\d+[\).\s-]*/, "").trim())
    .filter(Boolean);
}

function OnboardingChecklist({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const items = parseOnboardingChecklist(text);
  if (!items.length) return null;

  return (
    <div className={`space-y-2 ${className}`.trim()}>
      {items.map((item, idx) => (
        <div
          key={`${idx}-${item}`}
          className="flex items-start gap-3 rounded-xl border border-[#d9e6dc] bg-[#fbfdfb] px-3 py-3"
        >
          <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#edf5ef] text-xs font-semibold text-[#2f6655]">
            {idx + 1}
          </span>
          <span className="text-sm leading-7 text-[#4d5563]">{item}</span>
        </div>
      ))}
    </div>
  );
}

function isContentPostingGigType(gig: Pick<Gig, "gigType">) {
  const raw = String(gig.gigType ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  return raw === "content-posting";
}

function isEmailCreatorGig(gig: Pick<Gig, "gigType">) {
  const raw = String(gig.gigType ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  return raw === "" || raw === "email-creator" || raw === "part-time" || raw === "parttime";
}

function customTypeLabel(raw?: string) {
  const value = String(raw ?? "").trim();
  if (!value) return "Independent Project";
  const cleaned = value.replace(/^(custom|category):\s*/i, "").trim();
  return cleaned || "Independent Project";
}

function isImageUrl(url: string) {
  try {
    const parsed = new URL(url);
    const decodedPath = decodeURIComponent(parsed.pathname);
    if (/\.(png|jpe?g|gif|webp|avif|svg)$/i.test(decodedPath)) return true;
  } catch {
    // ignore and fallback to raw string
  }
  return /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i.test(url);
}

function isVideoUrl(url: string) {
  try {
    const parsed = new URL(url);
    const decodedPath = decodeURIComponent(parsed.pathname);
    if (/\.(mp4|webm|ogg|mov|m4v)$/i.test(decodedPath)) return true;
  } catch {
    // ignore and fallback to raw string
  }
  return /\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i.test(url);
}

function cleanInboxBody(body: string) {
  const text = body.trim();
  if (!text) return "";
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const dropPrefixes = [
    "delivered-to:",
    "received:",
    "x-forwarded-",
    "x-received:",
    "arc-",
    "authentication-results:",
    "dkim-signature:",
  ];

  const filtered = lines.filter(
    (line) => !dropPrefixes.some((p) => line.toLowerCase().startsWith(p))
  );

  const noiseTokens = ["d=google.com", "arc-202", "dkim", "spf", "bounce", "smtp"];
  const cleanLines = filtered.filter(
    (line) => !noiseTokens.some((t) => line.toLowerCase().includes(t))
  );

  const pick = (cleanLines[0] || filtered[0] || lines[0] || text).trim();
  return pick.length > 400 ? pick.slice(0, 400) : pick;
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-3 text-slate-900">
      <div className={`relative overflow-hidden ${compact ? "h-11 w-11" : "h-14 w-14"}`}>
        <Image src="/logo-mark.svg" alt="Reelencer logo mark" fill sizes={compact ? "44px" : "56px"} className="object-contain" />
      </div>
      <div
        className={`font-[Georgia,Times_New_Roman,serif] font-bold tracking-[-0.06em] text-slate-900 ${
          compact ? "text-[1.2rem] sm:text-[1.55rem]" : "text-[2.05rem] sm:text-[2.2rem]"
        }`}
      >
        Reelencer
      </div>
    </Link>
  );
}

function formatRelativeTimestamp(value?: string) {
  if (!value) return null;
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) return null;

  const diffMs = target - Date.now();
  const absMs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 1000 * 60 * 60 * 24 * 365],
    ["month", 1000 * 60 * 60 * 24 * 30],
    ["week", 1000 * 60 * 60 * 24 * 7],
    ["day", 1000 * 60 * 60 * 24],
    ["hour", 1000 * 60 * 60],
    ["minute", 1000 * 60],
  ];

  for (const [unit, size] of units) {
    if (absMs >= size || unit === "minute") {
      return rtf.format(Math.round(diffMs / size), unit);
    }
  }

  return "just now";
}

function formatCompactRelativeTimestamp(value?: string) {
  const relative = formatRelativeTimestamp(value);
  if (!relative) return null;
  return relative
    .replace(/\bminutes?\b/i, "min")
    .replace(/\bhours?\b/i, "hr")
    .replace(/\bdays?\b/i, "day")
    .replace(/\bweeks?\b/i, "wk")
    .replace(/\bmonths?\b/i, "mo")
    .replace(/\byears?\b/i, "yr");
}

function ProjectLineIcon({
  kind,
  className = "h-5 w-5",
}: {
  kind:
    | "share"
    | "heart"
    | "warning"
    | "location"
    | "calendar"
    | "views"
    | "money"
    | "duration"
    | "level"
    | "language"
    | "chart"
    | "external";
  className?: string;
}) {
  const common = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (kind) {
    case "share":
      return <svg {...common}><path d="M8 12l8-8"/><path d="M10 4h6v6"/><path d="M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4"/></svg>;
    case "heart":
      return <svg {...common}><path d="M12 20s-6.5-4.2-8.4-8A4.9 4.9 0 0 1 12 6a4.9 4.9 0 0 1 8.4 6C18.5 15.8 12 20 12 20Z"/></svg>;
    case "warning":
      return <svg {...common}><path d="M12 4l8 14H4L12 4Z"/><path d="M12 9v4"/><circle cx="12" cy="16.5" r=".6" fill="currentColor" stroke="none"/></svg>;
    case "location":
      return <svg {...common}><path d="M12 21s6-5.4 6-11a6 6 0 1 0-12 0c0 5.6 6 11 6 11Z"/><circle cx="12" cy="10" r="2.4"/></svg>;
    case "calendar":
      return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>;
    case "views":
      return <svg {...common}><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>;
    case "money":
      return <svg {...common}><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 7v10M15 9.5c0-1.1-1.3-2-3-2s-3 .9-3 2 1.3 2 3 2 3 .9 3 2-1.3 2-3 2-3-.9-3-2"/></svg>;
    case "duration":
      return <svg {...common}><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2.5"/><path d="M9 2h6"/></svg>;
    case "level":
      return <svg {...common}><path d="M7 11v8M12 8v11M17 5v14"/><path d="M5 19h14"/></svg>;
    case "language":
      return <svg {...common}><path d="M4 6h8"/><path d="M8 4v2c0 3-1.2 5.8-3.5 8"/><path d="M6 11c1.2 1.8 2.8 3.2 4.8 4.2"/><rect x="13" y="5" width="7" height="7" rx="1.5"/><path d="M15 9h3"/><path d="M16.5 7.5v3"/></svg>;
    case "chart":
      return <svg {...common}><path d="M4 19h16"/><rect x="6" y="11" width="3" height="6" rx="1"/><rect x="11" y="8" width="3" height="9" rx="1"/><rect x="16" y="5" width="3" height="12" rx="1"/></svg>;
    case "external":
      return <svg {...common}><path d="M8 16l8-8"/><path d="M10 6h6v6"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>;
  }
}

function parseBriefBlocks(raw: string) {
  return raw
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => block.split("\n").map((line) => line.trim()).filter(Boolean));
}

function isListLine(line: string) {
  return /^(\d+[\).\:]|[-*•])\s+/.test(line);
}

function stripListMarker(line: string) {
  return line.replace(/^(\d+[\).\:]|[-*•])\s+/, "").trim();
}

function looksLikeHeading(line: string) {
  if (!line || line.length > 72) return false;
  return !/[.!?]$/.test(line);
}

function groupParagraphLines(lines: string[]) {
  const grouped: string[] = [];
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    grouped.push(buffer.join(" "));
    buffer = [];
  };

  for (const line of lines) {
    if (isListLine(line)) {
      flush();
      grouped.push(line);
      continue;
    }
    buffer.push(line);
  }

  flush();
  return grouped;
}

function FormattedBrief({
  text,
  bodyClassName,
  headingClassName,
  sectionClassName,
}: {
  text: string;
  bodyClassName: string;
  headingClassName: string;
  sectionClassName?: string;
}) {
  const blocks = parseBriefBlocks(text);
  if (blocks.length === 0) return null;

  return (
    <div className={sectionClassName ?? "space-y-4"}>
      {blocks.map((lines, idx) => {
        const first = lines[0] ?? "";
        const heading = looksLikeHeading(first) && lines.length > 1 ? first : null;
        const rest = groupParagraphLines(heading ? lines.slice(1) : lines);
        const allList = rest.length > 1 && rest.every(isListLine);

        return (
          <div key={`${first}-${idx}`} className="space-y-2">
            {heading && <div className={headingClassName}>{heading}</div>}
            {allList ? (
              <ol className="space-y-2">
                {rest.map((line, lineIdx) => (
                  <li key={`${line}-${lineIdx}`} className={`flex items-start gap-3 ${bodyClassName}`}>
                    <span className="mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#1f4f43] px-1 text-[11px] font-bold text-white">
                      {lineIdx + 1}
                    </span>
                    <span>{stripListMarker(line)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              rest.map((line, lineIdx) => (
                <p key={`${line}-${lineIdx}`} className={`${bodyClassName} whitespace-pre-wrap`}>
                  {line}
                </p>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

const LS_KEYS = { AUTH: "igops:auth", SAVED_GIGS: "igops:saved-gigs" } as const;

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
    // ignore local storage write failures
  }
}

const emptyRows = () =>
  new Array(5).fill(null).map(() => ({ handle: "", email: "", password: "", phone: "" }));

function ProceedPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const gigId = searchParams.get("gigId");
  const gigTypeHint = searchParams.get("gigType");

  const [session, setSession] = useState<AuthSession | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [gig, setGig] = useState<Gig | null>(null);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [application, setApplication] = useState<GigApplication | null>(null);
  const [applicationStatus, setApplicationStatus] = useState<string | null>(null);
  const [kycStatus, setKycStatus] = useState<"none" | "pending" | "approved" | "rejected">("none");
  const [kycLoaded, setKycLoaded] = useState(false);

  const [rows, setRows] = useState<CredentialRow[]>(emptyRows());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuClosing, setMenuClosing] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; left: number; width: number } | null>(null);
  const [displayName, setDisplayName] = useState("User");
  const [workerMetrics, setWorkerMetrics] = useState<WorkerMetrics | null>(null);
  const [credentialPayoutState, setCredentialPayoutState] = useState<CredentialPayoutState>({
    stage: "idle",
    headline: "Awaiting review",
    detail: "Submit the credential package to start the verification and payout workflow.",
  });

  const [inbox, setInbox] = useState<any[]>([]);
  const [polling, setPolling] = useState(false);
  const [autoSync, setAutoSync] = useState(true);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedMsg, setSelectedMsg] = useState<any | null>(null);
  const [emailFilter, setEmailFilter] = useState<string>("all");
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);
  const [proposalPitch, setProposalPitch] = useState("");
  const [proposalApproach, setProposalApproach] = useState("");
  const [proposalTimeline, setProposalTimeline] = useState("");
  const [proposalBudget, setProposalBudget] = useState("");
  const [proposalPortfolio, setProposalPortfolio] = useState("");
  const [proposalSaving, setProposalSaving] = useState(false);
  const [groupJoinConfirming, setGroupJoinConfirming] = useState(false);
  const [savedGig, setSavedGig] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [activeReferenceVideo, setActiveReferenceVideo] = useState<{ url: string; label: string } | null>(null);

  const pollingRef = React.useRef(false);
  const menuButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const proposalDeskId = "project-proposal-desk";

  const computeMenuAnchor = React.useCallback(() => {
    const el = menuButtonRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 16;
    const preferredWidth = window.innerWidth >= 768 ? 448 : 320;
    const width = Math.min(preferredWidth, window.innerWidth - margin * 2);
    const left = Math.max(margin, Math.min(rect.right - width, window.innerWidth - width - margin));
    setMenuAnchor({ top: rect.bottom + 8, left, width });
  }, []);

  const closeMenu = React.useCallback(() => {
    if (!menuOpen) return;
    setMenuClosing(true);
    window.setTimeout(() => {
      setMenuOpen(false);
      setMenuClosing(false);
    }, 160);
  }, [menuOpen]);

  const refreshInbox = React.useCallback(async () => {
    if (!assignment?.id || pollingRef.current) return;
    pollingRef.current = true;
    setPolling(true);
    try {
      const inboxRes = await fetch(`/api/gig-inbox?assignmentId=${encodeURIComponent(assignment.id)}`, {
        method: "GET",
        cache: "no-store",
      });
      const inboxData = inboxRes.ok ? await inboxRes.json() : [];
      setInbox(Array.isArray(inboxData) ? inboxData : []);
      setLastSyncAt(new Date().toLocaleTimeString());
    } finally {
      pollingRef.current = false;
      setPolling(false);
    }
  }, [assignment?.id]);

  const forceRefreshInbox = React.useCallback(async () => {
    if (!assignment?.id) return;
    setRefreshing(true);
    try {
      await fetch(`/api/gig-inbox?assignmentId=${encodeURIComponent(assignment.id)}`, { method: "DELETE" });
      await refreshInbox();
    } finally {
      setRefreshing(false);
    }
  }, [assignment?.id, refreshInbox]);

  const refreshWorkerMetrics = React.useCallback(async () => {
    if (!session?.workerId || session.role !== "Worker") {
      setWorkerMetrics(null);
      return;
    }

    try {
      const res = await fetch(`/api/metrics/worker?workerId=${encodeURIComponent(session.workerId)}`, {
        method: "GET",
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load worker metrics");
      const data = await res.json();
      setWorkerMetrics(data ?? null);
    } catch {
      setWorkerMetrics(null);
    }
  }, [session?.role, session?.workerId]);

  useEffect(() => {
    if (!assignment?.id) {
      setCredentialPayoutState({
        stage: "idle",
        headline: "Awaiting review",
        detail: "Submit the credential package to start the verification and earnings workflow.",
      });
      return;
    }

    if (assignment.status === "Rejected") {
      setCredentialPayoutState({
        stage: "blocked",
        headline: "Payout remains on hold",
        detail: "This submission needs correction before any funds can be released.",
      });
      return;
    }

    if (assignment.status === "Submitted" || assignment.status === "Pending") {
      setCredentialPayoutState({
        stage: "pending",
        headline: "Awaiting admin verification",
        detail: "Your package is under review. Earnings stay on hold until verification is complete.",
      });
      return;
    }

    if (assignment.status !== "Accepted") {
      setCredentialPayoutState({
        stage: "approved",
        headline: "Approved. Wallet credit is pending.",
        detail: "Admin verification is complete. The approved amount is waiting for final wallet credit.",
      });
      return;
    }
    if (assignment.earningsReleaseStatus === "credited") {
      setCredentialPayoutState({
        stage: "paid",
        headline: "Amount credited to approved earnings",
        detail: "The approved amount has been added to your approved earnings wallet and is now available in your balance.",
        paidAt: assignment.earningsReleasedAt,
      });
      return;
    }

    if (assignment.earningsReleaseStatus === "queued") {
      setCredentialPayoutState({
        stage: "crediting",
        headline: "Amount will be credited shortly",
        detail: "Admin has approved the submission. The gig amount is queued for credit into your approved earnings wallet.",
        paidAt: assignment.earningsReleasedAt,
      });
      return;
    }

    setCredentialPayoutState({
      stage: "approved",
      headline: "Approved. Wallet credit is pending.",
      detail: "Admin verification is complete. The approved amount is waiting for final wallet credit.",
    });
  }, [assignment?.earningsReleaseStatus, assignment?.earningsReleasedAt, assignment?.id, assignment?.status]);

  useEffect(() => {
    const s = readLS<AuthSession | null>(LS_KEYS.AUTH, null);
    if (s?.workerId) {
      setSession(s);
      setSessionReady(true);
      return;
    }
    if (s?.role === "Admin") {
      // Temporary testing path to allow admin to proceed.
      setSession({ ...s, workerId: "ADMIN-TEST" });
      setSessionReady(true);
      return;
    }
    setSession(s);
    setSessionReady(true);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      const resolved = user ? getProceedDisplayName(user) : session?.workerId || "User";
      if (!alive) return;
      setDisplayName(resolved);
    })();
    return () => {
      alive = false;
    };
  }, [session?.workerId]);

  useEffect(() => {
    const run = async () => {
      await refreshWorkerMetrics();
    };

    void run();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void run();
    };
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") void run();
    }, 15000);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(intervalId);
    };
  }, [refreshWorkerMetrics]);

  useEffect(() => {
    if (assignment?.earningsReleaseStatus === "credited") {
      void refreshWorkerMetrics();
    }
  }, [assignment?.earningsReleaseStatus, refreshWorkerMetrics]);

  useEffect(() => {
    if (!menuOpen) return;
    computeMenuAnchor();
    const onLayout = () => computeMenuAnchor();
    window.addEventListener("resize", onLayout);
    window.addEventListener("scroll", onLayout, true);
    return () => {
      window.removeEventListener("resize", onLayout);
      window.removeEventListener("scroll", onLayout, true);
    };
  }, [computeMenuAnchor, menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-profile-menu]") && !target.closest("[data-profile-menu-panel]")) {
        closeMenu();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    window.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [closeMenu, menuOpen]);

  useEffect(() => {
    if (!gigId || !sessionReady) return;
    const key = session?.workerId || session?.role || "guest";
    const savedMap = readLS<Record<string, string[]>>(LS_KEYS.SAVED_GIGS, {});
    const savedItems = Array.isArray(savedMap[key]) ? savedMap[key] : [];
    setSavedGig(savedItems.includes(String(gigId)));
  }, [gigId, session?.role, session?.workerId, sessionReady]);

  useEffect(() => {
    if (!actionMessage) return;
    const id = window.setTimeout(() => setActionMessage(null), 2500);
    return () => window.clearTimeout(id);
  }, [actionMessage]);

  useEffect(() => {
    let alive = true;

    const refreshKyc = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) {
          if (alive) {
            setKycStatus("none");
            setKycLoaded(true);
          }
          return;
        }
        const res = await fetch("/api/kyc", { headers: { Authorization: `Bearer ${token}` } });
        const payload = res.ok ? await res.json() : null;
        if (!alive) return;
        setKycStatus(payload?.status ?? "none");
        setKycLoaded(true);
      } catch {
        if (!alive) return;
        setKycStatus("none");
        setKycLoaded(true);
      }
    };

    void refreshKyc();

    const onVisibility = () => {
      if (document.visibilityState === "visible") void refreshKyc();
    };

    document.addEventListener("visibilitychange", onVisibility);
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshKyc();
    }, 30000);

    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(intervalId);
    };
  }, []);

  const ensureAssignment = React.useCallback(
    async (targetGigId: string, targetWorkerId: string) => {
      const res = await fetch("/api/gig-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gigId: targetGigId,
          workerId: targetWorkerId,
          subjectFilter: "verification|confirm|security|code|twitter|x",
        }),
      });
      if (!res.ok) {
        const failure = await res.json().catch(() => ({}));
        throw new Error(failure?.error || "Unable to assign email. Please try again.");
      }
      const data = await res.json();
      setAssignment(data);
      if (data?.id) {
        const inboxRes = await fetch(`/api/gig-inbox?assignmentId=${encodeURIComponent(data.id)}`);
        const inboxData = inboxRes.ok ? await inboxRes.json() : [];
        setInbox(Array.isArray(inboxData) ? inboxData : []);
      }
    },
    []
  );

  const refreshApplicationState = React.useCallback(
    async (targetGigId: string, targetWorkerId: string) => {
      const appRes = await fetch(`/api/gig-applications?workerId=${encodeURIComponent(targetWorkerId)}`, {
        method: "GET",
        cache: "no-store",
      });
      const appPayload = appRes.ok ? await appRes.json() : [];
      const matchApp = Array.isArray(appPayload)
        ? appPayload.find((item: any) => String(item?.gigId) === String(targetGigId))
        : null;
      setApplication(matchApp ?? null);
      setApplicationStatus(matchApp?.status ? String(matchApp.status) : null);
      return matchApp ?? null;
    },
    []
  );

  useEffect(() => {
    if (!gigId) {
      setError("Missing gigId.");
      setLoading(false);
      return;
    }
    const currentWorkerId = session?.workerId;
    if (!currentWorkerId) return;

    let alive = true;

    (async () => {
      setLoading(true);
      setError(null);
      setApplication(null);
      setApplicationStatus(null);

      // Load gig
      try {
        const res = await fetch("/api/gigs", { method: "GET" });
        const data = res.ok ? await res.json() : [];
        const match = Array.isArray(data)
          ? data.find((g: any) => String(g.id) === String(gigId))
          : null;
        if (!alive) return;
        setGig(match ?? null);
        if (!match) {
          setError("This project is no longer available.");
          setLoading(false);
          return;
        }

        const appRes = await fetch(`/api/gig-applications?workerId=${encodeURIComponent(currentWorkerId)}`, {
          method: "GET",
          cache: "no-store",
        });
        const appPayload = appRes.ok ? await appRes.json() : [];
        const matchApp = Array.isArray(appPayload)
          ? appPayload.find((item: any) => String(item?.gigId) === String(gigId))
          : null;
        setApplication(matchApp ?? null);
        const status = matchApp?.status ? String(matchApp.status) : null;
        setApplicationStatus(status);
        if (isCustomGigType(match) || isProjectGigType(match) || isContentPostingGigType(match)) {
          setLoading(false);
          return;
        }
        if (!status) {
          setLoading(false);
          return;
        }
        if (isWorkspaceGig(match)) {
          setLoading(false);
          return;
        }
        const reviewStatus = String(matchApp?.proposal?.reviewStatus ?? "").trim();
        const isApproved = isEmailCreatorGig(match) || reviewStatus === "Accepted" || status === "Accepted";
        if (!isApproved) {
          setLoading(false);
          return;
        }
      } catch {
        if (alive) setGig(null);
      }

      // Get/create assignment + initial inbox
      try {
        await ensureAssignment(gigId, currentWorkerId);
      } catch (err: any) {
        if (alive) setError("Unable to open this project workspace right now. Please retry in a moment.");
      }

      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [ensureAssignment, gigId, session?.workerId]);

  useEffect(() => {
    if (!gigId || !session?.workerId || session.role !== "Worker") return;
    const workerId = session.workerId;

    let alive = true;

    const run = async () => {
      try {
        const matchApp = await refreshApplicationState(gigId, workerId);
        if (!alive || !matchApp) return;
        setSuccess((prev) =>
          prev && prev.toLowerCase().includes("proposal submitted successfully") ? null : prev
        );
      } catch {
        // keep last known application state
      }
    };

    run();

    const onVisibility = () => {
      if (document.visibilityState === "visible") run();
    };

    const id = window.setInterval(run, 15000);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      alive = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [gigId, refreshApplicationState, session?.role, session?.workerId]);

  const normalizedGigTypeHint = useMemo(
    () =>
      String(gigTypeHint ?? "")
        .trim()
        .toLowerCase()
        .replace(/[_\s]+/g, "-"),
    [gigTypeHint]
  );
  const normalizedGigTypeValue = useMemo(
    () =>
      String(gig?.gigType ?? "")
        .trim()
        .toLowerCase()
        .replace(/[_\s]+/g, "-"),
    [gig?.gigType]
  );
  const isProjectFlow = useMemo(
    () => normalizedGigTypeHint === "project" || normalizedGigTypeValue === "project" || (gig ? isProjectGigType(gig) : false),
    [gig, normalizedGigTypeHint, normalizedGigTypeValue]
  );
  const isContentPostingFlow = useMemo(
    () =>
      normalizedGigTypeHint === "content-posting" ||
      normalizedGigTypeValue === "content-posting" ||
      (gig ? isContentPostingGigType(gig) : false),
    [gig, normalizedGigTypeHint, normalizedGigTypeValue]
  );
  const isWorkspaceFlow = useMemo(() => (gig ? isWorkspaceGig(gig) : false), [gig]);
  const isCustomFlow = useMemo(
    () => !isProjectFlow && !isContentPostingFlow && !isWorkspaceFlow && (gig ? isCustomGigType(gig) : false),
    [gig, isContentPostingFlow, isProjectFlow, isWorkspaceFlow]
  );
  const isEmailCreatorFlow = useMemo(
    () =>
      normalizedGigTypeHint === "email-creator" ||
      normalizedGigTypeValue === "email-creator" ||
      normalizedGigTypeValue === "part-time" ||
      normalizedGigTypeValue === "parttime" ||
      (!isProjectFlow && !isContentPostingFlow && !isWorkspaceFlow && !isCustomFlow),
    [isContentPostingFlow, isCustomFlow, isProjectFlow, isWorkspaceFlow, normalizedGigTypeHint, normalizedGigTypeValue]
  );
  const isProjectStyleFlow = isProjectFlow || isContentPostingFlow;
  const proposalReviewStatus = useMemo<ProposalPayload["reviewStatus"] | null>(() => {
    if (!applicationStatus) return null;
    const explicit = application?.proposal?.reviewStatus;
    if (explicit) return explicit;
    if (applicationStatus === "Accepted") return "Accepted";
    if (applicationStatus === "Rejected") return "Rejected";
    return "Pending";
  }, [application?.proposal?.reviewStatus, applicationStatus]);
  const isProposalApproved = proposalReviewStatus === "Accepted";
  const hasApplication = useMemo(
    () => !!applicationStatus && applicationStatus !== "Withdrawn",
    [applicationStatus]
  );
  const canAccessOperations = isProposalApproved || !!assignment || (isEmailCreatorFlow && hasApplication);
  const hasAdminUpdate = useMemo(
    () =>
      !!(
        application?.proposal?.adminNote?.trim() ||
        application?.proposal?.adminExplanation?.trim() ||
        application?.proposal?.whatsappLink?.trim() ||
        application?.proposal?.onboardingSteps?.trim()
      ),
    [application?.proposal?.adminExplanation, application?.proposal?.adminNote, application?.proposal?.onboardingSteps, application?.proposal?.whatsappLink]
  );
  const adminWhatsappLink = useMemo(() => {
    const raw = application?.proposal?.whatsappLink?.trim() ?? "";
    if (!raw) return null;
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/^(chat\.whatsapp\.com|wa\.me|api\.whatsapp\.com)\//i.test(raw)) return `https://${raw}`;
    const inviteMatch = raw.match(/(https?:\/\/)?(chat\.whatsapp\.com\/[^\s]+)/i);
    if (inviteMatch?.[2]) return `https://${inviteMatch[2]}`;
    return null;
  }, [application?.proposal?.whatsappLink]);
  const sellerActionLabel = adminWhatsappLink ? "Contact Seller" : "Open Proposal Desk";
  const groupJoinConfirmed = !!application?.proposal?.groupJoinedConfirmed;
  const projectReviewBadgeTone =
    proposalReviewStatus === "Accepted"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : proposalReviewStatus === "Rejected"
        ? "border-rose-200 bg-rose-50 text-rose-700"
        : "border-[#d9e2d8] bg-[#f6faf5] text-[#476255]";
  const projectReviewLabel =
    proposalReviewStatus === "Accepted"
      ? "Recruiter Approved"
      : proposalReviewStatus === "Rejected"
        ? "Revision Requested"
        : hasAdminUpdate
          ? "Recruiter Update"
          : "Proposal Submitted";
  const isMarketplaceFlow = isProjectStyleFlow || isEmailCreatorFlow;
  const shouldShowProjectStatusPanel = isProjectStyleFlow && hasApplication && proposalReviewStatus !== "Rejected";
  const customType = useMemo(() => customTypeLabel(gig?.gigType), [gig?.gigType]);
  const customBrief = useMemo(() => {
    const list = gig?.requirements ?? [];
    const line = list.find((item) => String(item).toLowerCase().startsWith("brief::"));
    return line ? String(line).replace(/^brief::/i, "").trim() : "";
  }, [gig?.requirements]);
  const customMediaItems = useMemo(
    () => {
      const list = gig?.requirements ?? [];
      const fromPrefix = list
        .filter((item) => String(item).toLowerCase().startsWith("media::"))
        .map((item) => String(item).replace(/^media::/i, "").trim())
        .filter(Boolean);
      const legacyDirect = list
        .map((item) => String(item).trim())
        .filter((item) => /^https?:\/\//i.test(item))
        .filter((item) => isImageUrl(item) || isVideoUrl(item));
      return [...new Set([...fromPrefix, ...legacyDirect])];
    },
    [gig?.requirements]
  );
  const customRequirementItems = useMemo(
    () =>
      (gig?.requirements ?? []).filter((item) => {
        const lower = String(item).toLowerCase();
        return !lower.startsWith("brief::") && !lower.startsWith("media::") && !lower.startsWith("meta::");
      }),
    [gig?.requirements]
  );
  const projectMeta = useMemo(() => {
    const rows = gig?.requirements ?? [];
    return rows
      .filter((item) => String(item).toLowerCase().startsWith("meta::"))
      .reduce<Record<string, string>>((acc, item) => {
        const clean = String(item).replace(/^meta::/i, "");
        const sep = clean.indexOf("=");
        if (sep > 0) {
          const key = clean.slice(0, sep).trim().toLowerCase();
          const value = clean.slice(sep + 1).trim();
          if (key && value) acc[key] = value;
        }
        return acc;
      }, {});
  }, [gig?.requirements]);
  const standardRequirementItems = useMemo(
    () =>
      (gig?.requirements ?? []).filter((item) => {
        const lower = String(item).toLowerCase();
        return !lower.startsWith("brief::") && !lower.startsWith("media::") && !lower.startsWith("meta::");
      }),
    [gig?.requirements]
  );
  const onboardingRequired = useMemo(() => {
    const raw = String(projectMeta.onboarding_required ?? "true").trim().toLowerCase();
    return !["false", "0", "no", "off"].includes(raw);
  }, [projectMeta.onboarding_required]);
  const kycRequiredForGig = useMemo(() => {
    const raw = String(projectMeta.kyc_required ?? "true").trim().toLowerCase();
    return !["false", "0", "no", "off"].includes(raw);
  }, [projectMeta.kyc_required]);
  const shouldBlockForKyc = session?.role === "Worker" && kycRequiredForGig && kycStatus !== "approved";
  const marketplaceProfileLabel = useMemo(
    () => String(displayName || session?.workerId || session?.role || "Account").trim() || "Account",
    [displayName, session?.role, session?.workerId]
  );
  const marketplaceProfileInitial = marketplaceProfileLabel.charAt(0).toUpperCase() || "A";

  useEffect(() => {
    if (!activeReferenceVideo || typeof document === "undefined") return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveReferenceVideo(null);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [activeReferenceVideo]);

  const handleProjectShare = React.useCallback(async () => {
    const title = gig?.title || "Reelencer project";
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        setActionMessage("Project link shared.");
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setActionMessage("Project link copied.");
        return;
      }
      setActionMessage("Share is not available on this device.");
    } catch {
      setActionMessage("Share was cancelled.");
    }
  }, [gig?.title]);

  const handleProjectSave = React.useCallback(() => {
    if (!gigId) return;
    const key = session?.workerId || session?.role || "guest";
    const savedMap = readLS<Record<string, string[]>>(LS_KEYS.SAVED_GIGS, {});
    const current = new Set(Array.isArray(savedMap[key]) ? savedMap[key] : []);
    if (current.has(String(gigId))) {
      current.delete(String(gigId));
      setSavedGig(false);
      setActionMessage("Project removed from saved.");
    } else {
      current.add(String(gigId));
      setSavedGig(true);
      setActionMessage("Project saved.");
    }
    writeLS(LS_KEYS.SAVED_GIGS, { ...savedMap, [key]: Array.from(current) });
  }, [gigId, session?.role, session?.workerId]);

  const handleProjectReport = React.useCallback(() => {
    const subject = encodeURIComponent(`Report project ${gig?.id || gigId || ""}`);
    const body = encodeURIComponent(
      [
        `Project: ${gig?.title || "Unknown"}`,
        `Gig ID: ${gig?.id || gigId || "Unknown"}`,
        `Worker: ${session?.workerId || "Guest"}`,
        `URL: ${typeof window !== "undefined" ? window.location.href : "Unavailable"}`,
        "",
        "Issue summary:",
      ].join("\n")
    );
    window.location.href = `mailto:support@reelencer.com?subject=${subject}&body=${body}`;
  }, [gig?.id, gig?.title, gigId, session?.workerId]);

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
    try {
      window.localStorage.removeItem(LS_KEYS.AUTH);
    } catch {
      // ignore
    }
    window.location.replace("/login?next=/proceed");
  };

  const renderProfileMenu = (desktop = false) => (
    <>
      <div className="flex items-center justify-between border-b border-[#d4dccf] px-4 py-4">
        <div className="text-xs font-semibold uppercase tracking-[0.28em] text-[#2f6655]">Command Center</div>
        <button
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[#d1dacb] bg-[#f8faf7] text-xs font-semibold text-slate-700 transition hover:bg-[#ecf3e8]"
          onClick={closeMenu}
          aria-label="Close menu"
        >
          ✕
        </button>
      </div>
      <div className={desktop ? "max-h-[min(78vh,760px)] overflow-y-auto px-5 pb-5 pt-5" : "h-[calc(100vh-60px)] overflow-y-auto px-4 pb-4 pt-4"}>
        <div className="rounded-2xl border border-[#d4dccf] bg-[#f4f8f1] px-4 py-4 shadow-[0_16px_36px_rgba(22,58,46,0.08)]">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#1f4f43] text-lg font-bold text-white">
              {displayName.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <div className="text-base font-semibold text-slate-900">{displayName}</div>
              <div className="text-xs text-slate-500">{session?.role ? `${session.role} • ID ${session.workerId ?? "Unavailable"}` : "Guest"}</div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="inline-flex items-center rounded-full border border-[#d3dbce] bg-white px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">KYC: {kycStatus}</span>
            <span className={`inline-flex items-center rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.18em] ${kycStatus === "approved" ? "border border-[#bcd6c9] bg-[#edf5ef] text-[#2f6655]" : "border border-[#d3dbce] bg-white text-slate-500"}`}>
              {kycStatus === "approved" ? "Trusted" : "Verification required"}
            </span>
          </div>
          <div className="mt-4 rounded-2xl border border-[#d4dccf] bg-white px-4 py-3 shadow-sm">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Approved earnings</div>
            <div className={`mt-2 flex gap-3 ${desktop ? "items-end justify-between" : "flex-col"}`}>
              <div className="min-w-0 flex-1">
                <div className={`font-semibold leading-none text-slate-900 ${desktop ? "text-[1.5rem]" : "text-[1.35rem]"}`}>
                  ₹{Math.round(approvedEarningsDisplay)}
                </div>
                <div className={`mt-1 text-[11px] leading-5 text-slate-500 ${desktop ? "max-w-[14rem]" : "max-w-[18rem]"}`}>
                  Synced from your workspace payout ledger
                </div>
              </div>
              <Link
                href="/payouts"
                className={`inline-flex items-center justify-center rounded-full border border-[#bcd6c9] bg-[#edf5ef] px-4 py-2 text-[11px] font-semibold text-[#2f6655] transition hover:bg-[#e2f0e7] ${
                  desktop ? "shrink-0 self-end" : "w-full"
                }`}
                onClick={closeMenu}
              >
                View payouts
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Link className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50" href="/workspace" onClick={closeMenu}>Workspace</Link>
          <Link className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50" href="/payouts" onClick={closeMenu}>Payouts</Link>
        </div>
        <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Quick links</div>
        <div className="mt-2 space-y-1">
          <Link className="flex items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-[#edf4e8]" href="/" onClick={closeMenu}>Home<span className="text-slate-400">›</span></Link>
          <Link className="flex items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-[#edf4e8]" href="/workspace" onClick={closeMenu}>Go to workspace<span className="text-slate-400">›</span></Link>
          <Link className="flex items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-[#edf4e8]" href="/payouts" onClick={closeMenu}>Payouts<span className="text-slate-400">›</span></Link>
          <Link className="flex items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-[#edf4e8]" href="/my-assignments" onClick={closeMenu}>My assignments<span className="text-slate-400">›</span></Link>
        </div>
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2">
          <button className="w-full text-left text-sm font-semibold text-rose-700" onClick={signOut}>Sign out</button>
        </div>
        <Link
          href="mailto:support@reelencer.com"
          className="group mt-4 flex items-center gap-3 rounded-2xl border border-[#d4dccf] bg-[#f4f8f1] px-3 py-3 text-left shadow-[0_16px_36px_rgba(22,58,46,0.08)] transition hover:bg-[#edf4e8]"
          onClick={closeMenu}
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-[1.25rem]">✉️</span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[0.72rem] font-semibold uppercase tracking-[0.13em] text-slate-500">Send us mail for any query</span>
            <span className="block truncate text-[1.03rem] font-bold text-slate-900">support@reelencer.com</span>
          </span>
          <span className="text-xl text-slate-400 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5">↗</span>
        </Link>
      </div>
    </>
  );

  useEffect(() => {
    if (!gigId || !gig || (!isProjectStyleFlow && !isEmailCreatorFlow)) return;
    const expectedType = isProjectFlow ? "project" : isContentPostingFlow ? "content-posting" : "email-creator";
    if ((gigTypeHint ?? "").trim().toLowerCase() === expectedType) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("gigId", gigId);
    params.set("gigType", expectedType);
    router.replace(`/proceed?${params.toString()}`, { scroll: false });
  }, [gig, gigId, gigTypeHint, isContentPostingFlow, isEmailCreatorFlow, isProjectFlow, isProjectStyleFlow, router, searchParams]);

  // Auto-sync poller
  useEffect(() => {
    if (!assignment?.id || !autoSync) return;

    let alive = true;

    const run = async () => {
      if (!alive) return;
      try {
        await refreshInbox();
      } catch {
        // ignore
      }
    };

    run();
    const id = window.setInterval(run, 5000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      alive = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [assignment?.id, autoSync, refreshInbox]);

  const assignmentStatus = assignment?.status ?? proposalReviewStatus ?? applicationStatus ?? "Not applied";
  const statusTone =
    assignmentStatus === "Accepted"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : assignmentStatus === "Rejected"
      ? "border-rose-200 bg-rose-50 text-rose-700"
    : assignmentStatus === "Submitted"
      ? "border-[#bcd6c9] bg-[#edf5ef] text-[#2f6655]"
    : assignmentStatus === "Applied" || assignmentStatus === "Pending"
      ? "border-[#d4dfd7] bg-white text-[#4d665c]"
      : "border-[#d4dccf] bg-[#f4f8f1] text-[#5f746a]";
  const assignedList = useMemo(() => {
    const list = assignment?.assignedEmails?.length
      ? assignment.assignedEmails
      : assignment?.assignedEmail
      ? [assignment.assignedEmail]
      : [];
    return list.map((e) => e.trim().toLowerCase()).filter(Boolean);
  }, [assignment?.assignedEmails, assignment?.assignedEmail]);
  const approvedEarningsDisplay = useMemo(() => {
    const synced = Number(workerMetrics?.money?.earnings ?? 0);
    const creditedFallback =
      assignment?.earningsReleaseStatus === "credited" ? parseProceedPayoutAmount(gig?.payout) : 0;
    return Math.max(synced, creditedFallback);
  }, [assignment?.earningsReleaseStatus, gig?.payout, workerMetrics?.money?.earnings]);
  const hasCredentialSubmission = Boolean(
    assignment?.submittedAt || ["Submitted", "Accepted", "Rejected", "Pending"].includes(assignmentStatus)
  );
  const credentialSubmissionLocked = hasCredentialSubmission;
  const credentialReviewTone =
    assignmentStatus === "Accepted"
      ? "approved"
      : assignmentStatus === "Rejected"
        ? "rejected"
        : assignmentStatus === "Pending"
          ? "pending"
          : "submitted";
  const payoutCheckpointLabel =
    credentialReviewTone === "approved"
      ? credentialPayoutState.headline
      : credentialReviewTone === "rejected"
        ? "Submission requires correction before approval."
        : credentialReviewTone === "pending"
          ? "Awaiting final reviewer decision."
          : "Admin verifies handles, assigned emails, and login validity.";
  const showCredentialReviewState = credentialSubmissionLocked || success === CREDENTIAL_SUCCESS_MESSAGE;
  const credentialSubmittedAt = assignment?.submittedAt ? new Date(assignment.submittedAt).toLocaleString() : null;
  const credentialReviewBanner = showCredentialReviewState ? (
    <div
      className={`mt-4 overflow-hidden rounded-[1.25rem] shadow-[0_14px_32px_rgba(52,93,74,0.08)] ${
        credentialReviewTone === "approved"
          ? "border border-emerald-200 bg-[linear-gradient(180deg,#f5fcf7,#edf8f1)]"
          : credentialReviewTone === "rejected"
            ? "border border-rose-200 bg-[linear-gradient(180deg,#fff8f8,#fff1f1)]"
            : credentialReviewTone === "pending"
              ? "border border-amber-200 bg-[linear-gradient(180deg,#fffaf1,#fff5df)]"
              : "border border-emerald-200 bg-[linear-gradient(180deg,#f7fcf8,#eef7f1)]"
      }`}
    >
      <div
        className={`px-4 py-4 sm:px-5 ${
          credentialReviewTone === "approved"
            ? "border-b border-emerald-100"
            : credentialReviewTone === "rejected"
              ? "border-b border-rose-100"
              : credentialReviewTone === "pending"
                ? "border-b border-amber-100"
                : "border-b border-emerald-100"
        }`}
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6f8578]">Review status</div>
            <div className="mt-1 text-[1.05rem] font-semibold sm:text-[1.2rem] text-[#214d3f]">
              {credentialReviewTone === "approved"
                ? credentialPayoutState.stage === "paid"
                  ? "Approved and released"
                  : "Approved by admin"
                : credentialReviewTone === "rejected"
                  ? "Returned for correction"
                  : credentialReviewTone === "pending"
                    ? "Held in pending review"
                    : "Submitted for admin approval"}
            </div>
            <div className="mt-1 max-w-[44rem] text-sm leading-6 text-[#567062]">
              {credentialReviewTone === "approved"
                ? credentialPayoutState.detail
                : credentialReviewTone === "rejected"
                  ? "Admin reviewed the submission and sent it back for correction. Update the credential pack once the revision instructions are available."
                  : credentialReviewTone === "pending"
                    ? "Your account pack is still under manual review. Final approval is pending before any payout is released."
                    : "Your account pack has been delivered for verification. Payment for this gig is released only after admin approves the submitted accounts."}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <span
              className={`rounded-full bg-white px-3 py-1.5 text-xs font-semibold ${
                credentialReviewTone === "approved"
                  ? "border border-emerald-200 text-emerald-700"
                  : credentialReviewTone === "rejected"
                    ? "border border-rose-200 text-rose-700"
                    : credentialReviewTone === "pending"
                      ? "border border-amber-200 text-amber-700"
                      : "border border-emerald-200 text-emerald-700"
              }`}
            >
              {credentialReviewTone === "approved"
                ? credentialPayoutState.stage === "paid"
                  ? "Credited"
                  : credentialPayoutState.stage === "crediting"
                    ? "Wallet queue"
                    : "Approved"
                : credentialReviewTone === "rejected"
                  ? "Revision required"
                  : credentialReviewTone === "pending"
                    ? "Pending"
                    : "Awaiting approval"}
            </span>
            {credentialReviewTone === "approved" && (
              <Link
                href="/payouts"
                className="rounded-full border border-[#d8e4db] bg-white px-3 py-1.5 text-xs font-semibold text-[#305847] transition hover:border-[#bdd5c7] hover:bg-[#f7fbf8]"
              >
                View payouts
              </Link>
            )}
            {credentialSubmittedAt && (
              <span className="rounded-full border border-[#d8e4db] bg-[#f8fbf8] px-3 py-1.5 text-xs font-medium text-[#5f746a]">
                Submitted {credentialSubmittedAt}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="px-4 py-4 sm:px-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(260px,0.9fr)]">
          <div className="rounded-2xl border border-[#d8e4db] bg-white px-4 py-3.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#809184]">Current checkpoint</div>
            <div className="mt-1 text-sm font-semibold text-[#274537]">{payoutCheckpointLabel}</div>
          </div>
          <div className="rounded-2xl border border-[#d8e4db] bg-white px-4 py-3.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#809184]">
              {credentialReviewTone === "approved" ? "Earnings result" : "Payout release"}
            </div>
            <div className="mt-1 text-sm font-semibold text-[#274537]">
              {credentialReviewTone === "approved"
                ? credentialPayoutState.stage === "paid"
                  ? "Funds have been credited to your approved earnings wallet."
                  : credentialPayoutState.stage === "crediting"
                    ? "Wallet credit has been initiated and should reflect in your approved earnings shortly."
                    : "The amount is approved and queued for credit into your approved earnings wallet."
                : credentialReviewTone === "rejected"
                  ? "No payout is released until the corrected submission is approved."
                  : credentialReviewTone === "pending"
                    ? "Payout stays on hold until admin finalizes this review."
                    : "Once approved, the gig amount moves into your approved earnings ledger."}
            </div>
          </div>
        </div>
      </div>
    </div>
  ) : null;
  const credentialReviewPanel = credentialSubmissionLocked ? (
    <div className="mt-4 rounded-[1.45rem] border border-[#d8e4db] bg-[linear-gradient(180deg,#ffffff,#f7fbf8)] p-4 shadow-[0_16px_38px_rgba(42,74,60,0.08)] sm:p-5">
      {credentialReviewBanner}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-[#d8e4db] bg-white px-4 py-3.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#809184]">Submission state</div>
          <div className="mt-1 text-lg font-semibold text-[#25473b]">
            {credentialReviewTone === "approved" ? "Completed" : credentialReviewTone === "rejected" ? "Needs update" : "Locked"}
          </div>
          <div className="mt-1 text-xs leading-5 text-[#617166]">
            {credentialReviewTone === "approved"
              ? "Verification is complete and the workspace stays archived."
              : credentialReviewTone === "rejected"
                ? "Execution blocks stay hidden until the review issue is resolved."
                : "Workspace execution blocks are now hidden."}
          </div>
        </div>
        <div className="rounded-2xl border border-[#d8e4db] bg-white px-4 py-3.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#809184]">Package size</div>
          <div className="mt-1 text-lg font-semibold text-[#25473b]">5 accounts</div>
          <div className="mt-1 text-xs leading-5 text-[#617166]">Submission received and sealed.</div>
        </div>
        <div className="rounded-2xl border border-[#d8e4db] bg-white px-4 py-3.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#809184]">Payout state</div>
          <div className="mt-1 text-lg font-semibold text-[#25473b]">{gig?.payout ?? "—"}</div>
          <div className="mt-1 text-xs leading-5 text-[#617166]">
            {credentialReviewTone === "approved"
              ? credentialPayoutState.stage === "paid"
                ? "Credited to approved earnings."
                : credentialPayoutState.stage === "crediting"
                  ? "Wallet credit initiated. Amount will be added shortly."
                  : "Approved and queued for wallet credit."
              : "Credits after admin approval."}
          </div>
        </div>
        <div className="rounded-2xl border border-[#d8e4db] bg-white px-4 py-3.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#809184]">Visibility</div>
          <div className="mt-1 text-lg font-semibold text-[#25473b]">Private</div>
          <div className="mt-1 text-xs leading-5 text-[#617166]">Sensitive fields are removed from your feed.</div>
        </div>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.05fr)_minmax(300px,0.95fr)]">
        <div className="rounded-[1.2rem] border border-[#d8e4db] bg-white px-4 py-4 sm:px-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7c8c82]">Review summary</div>
          <div className="mt-2 text-[1.02rem] font-semibold text-[#274537]">
            {credentialReviewTone === "approved"
              ? credentialPayoutState.stage === "paid"
                ? "Submission verified and wallet credited"
                : "Submission verified and queued for wallet credit"
              : credentialReviewTone === "rejected"
                ? "Submission reviewed and sent back for correction"
                : credentialReviewTone === "pending"
                  ? "Submission locked and waiting for final reviewer action"
                  : "Submission locked and forwarded to admin verification"}
          </div>
          <div className="mt-2 text-sm leading-6 text-[#617166]">
            {credentialReviewTone === "approved"
              ? credentialPayoutState.stage === "paid"
                ? "Your credential package has cleared review and the approved amount is now in your approved earnings wallet. This project remains archived as a completed managed assignment."
                : "Your credential package has cleared review. The assignment is now in managed wallet credit and the approved amount will be added shortly."
              : credentialReviewTone === "rejected"
                ? "The credential package did not pass review. This project stays in a managed review state until the next approved submission is delivered."
                : credentialReviewTone === "pending"
                  ? "The credential package is sealed while the review team finalizes the decision and payout eligibility."
                  : "Your credential package is now sealed. The review team is validating the assigned emails, account access, and compliance quality before releasing payout."}
          </div>
          <div className="mt-4 rounded-2xl border border-[#d8e4db] bg-[#fbfdfb] px-4 py-3.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#809184]">Worker experience</div>
            <div className="mt-1 text-sm font-semibold text-[#274537]">
              {credentialReviewTone === "rejected"
                ? "Wait for revision guidance before acting."
                : credentialReviewTone === "approved"
                  ? credentialPayoutState.stage === "paid"
                    ? "No action is needed. Funds are in your approved earnings wallet."
                    : "No action is needed. Crediting will complete shortly."
                  : "No further action is needed right now."}
            </div>
            <div className="mt-1 text-xs leading-5 text-[#617166]">
              This page will continue reflecting the latest review state without showing your submitted credentials again.
            </div>
          </div>
        </div>
        <div className="rounded-[1.2rem] border border-[#d8e4db] bg-[#fbfdfb] px-4 py-4 sm:px-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7c8c82]">What happens next</div>
          <div className="mt-3 grid gap-2.5">
            <div className="rounded-xl border border-[#d8e4db] bg-white px-3.5 py-3">
              <div className="text-sm font-semibold text-[#274537]">1. Admin verification</div>
              <div className="mt-1 text-xs leading-5 text-[#617166]">The review team checks email mapping, account validity, and credential quality.</div>
            </div>
            <div className="rounded-xl border border-[#d8e4db] bg-white px-3.5 py-3">
              <div className="text-sm font-semibold text-[#274537]">2. Status decision</div>
              <div className="mt-1 text-xs leading-5 text-[#617166]">
                {credentialReviewTone === "approved"
                  ? "The submission has already been approved and closed."
                  : credentialReviewTone === "rejected"
                    ? "The submission has been returned for correction."
                    : "This panel updates once the submission is approved or returned for correction."}
              </div>
            </div>
            <div className="rounded-xl border border-[#d8e4db] bg-white px-3.5 py-3">
              <div className="text-sm font-semibold text-[#274537]">3. Earnings release</div>
              <div className="mt-1 text-xs leading-5 text-[#617166]">
                {credentialReviewTone === "approved"
                  ? credentialPayoutState.stage === "paid"
                    ? "The approved amount has already been added to your approved earnings wallet."
                    : credentialPayoutState.stage === "crediting"
                      ? "Wallet credit is in flight. The amount should appear in approved earnings shortly."
                      : "Admin approval is complete. The amount is queued for credit into approved earnings."
                  : credentialReviewTone === "rejected"
                    ? "Earnings stay blocked until a corrected submission is approved."
                    : "Approved submissions move the gig amount into your approved earnings balance."}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  useEffect(() => {
    if (!assignment?.id) {
      setRows(emptyRows());
      return;
    }

    let alive = true;

    const hydrateRows = async () => {
      try {
        const res = await fetch(`/api/gig-credentials?assignmentId=${encodeURIComponent(assignment.id)}`, {
          method: "GET",
          cache: "no-store",
        });
        const payload = res.ok ? await res.json() : [];
        if (!alive) return;

        if (Array.isArray(payload) && payload.length > 0) {
          const nextRows = emptyRows().map((row, idx) => {
            const saved = payload[idx];
            return saved
              ? {
                  handle: String(saved.handle ?? ""),
                  email: String(saved.email ?? assignedList[idx] ?? ""),
                  password: String(saved.password ?? ""),
                  phone: String(saved.phone ?? ""),
                }
              : {
                  ...row,
                  email: assignedList[idx] ?? "",
                };
          });
          setRows(nextRows);
          return;
        }

        setRows((prev) =>
          prev.map((row, idx) => ({
            ...row,
            email: row.email || assignedList[idx] || "",
          }))
        );
      } catch {
        if (!alive) return;
        setRows((prev) =>
          prev.map((row, idx) => ({
            ...row,
            email: row.email || assignedList[idx] || "",
          }))
        );
      }
    };

    hydrateRows();

    return () => {
      alive = false;
    };
  }, [assignment?.id, assignedList]);

  const filteredInbox = useMemo(() => {
    if (assignedList.length === 0) return inbox;
    const base = inbox.filter((msg) => {
      const toEmail = String(msg.toEmail ?? msg.to_email ?? "").toLowerCase();
      return assignedList.includes(toEmail);
    });
    if (emailFilter === "all") return base;
    return base.filter((msg) => String(msg.toEmail ?? msg.to_email ?? "").toLowerCase() === emailFilter);
  }, [inbox, assignedList, emailFilter]);

  const unreadCount = useMemo(() => {
    return filteredInbox.filter((msg) => !msg.readAt && !msg.read_at).length;
  }, [filteredInbox]);

  const markRead = async (msg: any) => {
    if (!assignment?.id || !msg?.id) return;
    if (msg.readAt || msg.read_at) return;
    try {
      await fetch("/api/gig-inbox/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: assignment.id, messageIds: [String(msg.id)] }),
      });
      setInbox((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, readAt: new Date().toISOString() } : m))
      );
    } catch {
      // ignore
    }
  };

  const markAllRead = async () => {
    if (!assignment?.id) return;
    const unread = filteredInbox.filter((msg) => !msg.readAt && !msg.read_at);
    if (unread.length === 0) return;
    const ids = unread.map((m) => String(m.id));
    try {
      await fetch("/api/gig-inbox/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: assignment.id, messageIds: ids }),
      });
      setInbox((prev) =>
        prev.map((m) => (ids.includes(String(m.id)) ? { ...m, readAt: new Date().toISOString() } : m))
      );
    } catch {
      // ignore
    }
  };

  const markAllReadAll = async () => {
    if (!assignment?.id) return;
    const unread = inbox.filter((msg) => !msg.readAt && !msg.read_at);
    if (unread.length === 0) return;
    const ids = unread.map((m) => String(m.id));
    try {
      await fetch("/api/gig-inbox/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: assignment.id, messageIds: ids }),
      });
      setInbox((prev) =>
        prev.map((m) => (ids.includes(String(m.id)) ? { ...m, readAt: new Date().toISOString() } : m))
      );
    } catch {
      // ignore
    }
  };

  const markUnread = async (msg: any) => {
    if (!assignment?.id || !msg?.id) return;
    try {
      await fetch("/api/gig-inbox/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: assignment.id, messageIds: [String(msg.id)], readAt: null }),
      });
      setInbox((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, readAt: null } : m))
      );
    } catch {
      // ignore
    }
  };

  const invalidRows = useMemo(() => {
    const hasEmpty = rows.some((row) => !row.handle.trim() || !row.email.trim() || !row.password.trim());
    if (hasEmpty) return true;
    if (assignedList.length === 0) return false;
    const emails = rows.map((row) => row.email.trim().toLowerCase());
    const allMatch = emails.every((email) => assignedList.includes(email));
    const unique = new Set(emails).size === emails.length;
    return !allMatch || !unique;
  }, [rows, assignedList]);

  const submitCredentials = async () => {
    if (!assignment) return;

    if (invalidRows) {
      if (assignedList.length > 0) {
        setError("Use the assigned emails only (each email once). All 5 accounts require handle, email, and password.");
      } else {
        setError("All 5 accounts must include handle, email, and password.");
      }
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/gig-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: assignment.id, accounts: rows }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Unable to submit");
      }

      setSuccess(CREDENTIAL_SUCCESS_MESSAGE);
      setAssignment((prev) => (prev ? { ...prev, status: "Submitted", submittedAt: new Date().toISOString() } : prev));
    } catch (e: any) {
      setError(e?.message || "Submission failed");
    } finally {
      setSaving(false);
    }
  };

  const submitCustomProposal = async () => {
    if (!gigId || !session?.workerId) return;
    const resolvedPitch = proposalPitch.trim();
    const resolvedApproach = isProjectStyleFlow ? proposalPitch.trim() : proposalApproach.trim();
    const resolvedTimeline = proposalTimeline.trim();
    const resolvedBudget = proposalBudget.trim();
    const projectFormIncomplete = isProjectStyleFlow && (!resolvedBudget || !resolvedTimeline || !resolvedPitch);
    const customFormIncomplete = !isProjectStyleFlow && (!resolvedPitch || !resolvedApproach || !resolvedTimeline);
    if (projectFormIncomplete || customFormIncomplete) {
      setError(
        isProjectStyleFlow
          ? isContentPostingFlow
            ? "Please complete per post price, accounts you can manage, and cover letter before submission."
            : "Please complete hourly price, estimated hours, and cover letter before submission."
          : "Please complete pitch, approach, and timeline before submission."
      );
      return;
    }
    setProposalSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const { data: authData } = await supabase.auth.getSession();
      const user = authData.session?.user ?? null;
      const res = await fetch("/api/gig-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gigId,
          workerId: session.workerId,
          workerName: displayName || session.workerId,
          workerEmail: user?.email ?? null,
          workerUserId: user?.id ?? null,
          status: "Pending",
          proposal: {
            pitch: resolvedPitch,
            approach: resolvedApproach,
            timeline: resolvedTimeline,
            budget: resolvedBudget,
            portfolio: proposalPortfolio.trim(),
            submittedAt: new Date().toISOString(),
            reviewStatus: "Pending",
          },
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error || "Proposal could not be saved.");
      }
      const payload = await res.json();
      setApplication(payload ?? null);
      setApplicationStatus(String(payload?.status ?? "Pending"));
      setSuccess("Proposal submitted successfully. Your application is now under review.");
    } catch (e: any) {
      setError(e?.message || "Unable to submit proposal right now.");
    } finally {
      setProposalSaving(false);
    }
  };

  const submitStandardProposal = async () => {
    if (!gigId || !session?.workerId) return;
    setProposalSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const { data: authData } = await supabase.auth.getSession();
      const user = authData.session?.user ?? null;
      const isInstantAccess = isEmailCreatorFlow;
      const res = await fetch("/api/gig-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gigId,
          workerId: session.workerId,
          workerName: displayName || session.workerId,
          workerEmail: user?.email ?? null,
          workerUserId: user?.id ?? null,
          status: isInstantAccess ? "Accepted" : "Pending",
          proposal: {
            reviewStatus: isInstantAccess ? "Accepted" : "Pending",
            submittedAt: new Date().toISOString(),
          },
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error || "Proposal could not be saved.");
      }
      const payload = await res.json();
      setApplication(payload ?? null);
      const resolvedStatus = String(payload?.status ?? (isInstantAccess ? "Accepted" : "Pending"));
      setApplicationStatus(resolvedStatus);
      if (isInstantAccess) {
        await ensureAssignment(gigId, session.workerId);
        setSuccess("Access activated. Your assigned work panel is ready.");
      } else {
        setSuccess("Proposal submitted successfully. Track status updates from this project panel.");
      }
    } catch (e: any) {
      setError(e?.message || "Unable to submit proposal right now.");
    } finally {
      setProposalSaving(false);
    }
  };

  const confirmGroupJoined = async () => {
    if (!application?.id || !session?.workerId || groupJoinConfirming || groupJoinConfirmed) return;
    const confirmedAt = new Date().toISOString();
    setGroupJoinConfirming(true);
    try {
      const nextProposal: ProposalPayload = {
        ...(application.proposal ?? {}),
        submittedAt: application.proposal?.submittedAt ?? application.appliedAt,
        reviewStatus: application.proposal?.reviewStatus ?? "Pending",
        groupJoinedConfirmed: true,
        groupJoinedConfirmedAt: confirmedAt,
      };
      const res = await fetch("/api/gig-applications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: application.id,
          updates: {
            status: application.status === "Accepted" || application.status === "Rejected" ? application.status : "Pending",
            decidedAt: application.decidedAt ?? confirmedAt,
            workerName: session.workerId,
            proposal: nextProposal,
          },
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error || "Unable to confirm group join right now.");
      }
      const payload = await res.json().catch(() => null);
      const updated = payload ?? { ...application, proposal: nextProposal, status: "Pending" };
      setApplication(updated);
      setApplicationStatus(String(updated?.status ?? "Pending"));
      setSuccess("Group participation confirmed. Operations has been notified for final review.");
    } catch (e: any) {
      setError(e?.message || "Unable to confirm group join right now.");
    } finally {
      setGroupJoinConfirming(false);
    }
  };

  if (!sessionReady || loading || !kycLoaded) {
    const showMarketplaceSkeleton =
      ["project", "content-posting", "email-creator"].includes((gigTypeHint ?? "").trim().toLowerCase()) ||
      (!!gig && (isProjectGigType(gig) || isContentPostingGigType(gig) || isEmailCreatorGig(gig)));
    return (
      <div className={`relative min-h-screen overflow-x-hidden ${showMarketplaceSkeleton ? "bg-[#fbfbfb] text-[#25272d]" : "bg-[#eef4ea] text-slate-900"}`}>
        {!showMarketplaceSkeleton && <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,#dce9de,transparent_42%)]" />}
        {showMarketplaceSkeleton ? (
          <>
            <header className="sticky top-0 z-30 border-b border-[#d5ddcf] bg-[#f8faf7]/95 backdrop-blur">
              <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-3 py-3 sm:px-6 lg:px-8">
                <div className="flex items-center gap-3 sm:gap-4 lg:gap-8">
                  <div className="hidden lg:block">
                    <BrandMark />
                  </div>
                  <div className="lg:hidden">
                    <BrandMark compact />
                  </div>
                </div>
                <div className="h-12 w-[9.5rem] animate-pulse rounded-full border border-[#d8e0d4] bg-white shadow-sm sm:w-[11rem]" />
              </div>
            </header>
            <main className="relative mx-auto w-full max-w-[1380px] px-3 py-4 sm:px-6 sm:py-5 lg:px-8">
            <div className="mb-4 animate-pulse border-b border-[#eceef2] pb-4 sm:mb-5 sm:pb-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <div className="h-3 w-10 rounded-full bg-[#eef1f4]" />
                  <div className="h-3 w-2 rounded-full bg-[#eef1f4]" />
                  <div className="h-3 w-14 rounded-full bg-[#eef1f4]" />
                  <div className="h-3 w-2 rounded-full bg-[#eef1f4]" />
                  <div className="h-7 w-52 rounded-full bg-[#f2f4f7]" />
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  <div className="h-10 w-10 rounded-full bg-[#eef1f4] sm:h-11 sm:w-11" />
                  <div className="h-10 w-10 rounded-full bg-[#eef1f4] sm:h-11 sm:w-11" />
                  <div className="h-4 w-10 rounded-full bg-[#eef1f4]" />
                  <div className="h-4 w-10 rounded-full bg-[#eef1f4]" />
                  <div className="h-10 w-10 rounded-full bg-[#f6efe0]" />
                </div>
              </div>
            </div>
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className="space-y-4 sm:space-y-5">
                <div className="animate-pulse rounded-[1.45rem] border border-[#f1dfd7] bg-[linear-gradient(135deg,#fff8f4,rgba(255,245,239,0.98))] p-4 shadow-sm sm:rounded-[1.7rem] sm:p-8">
                  <div className="h-4 w-24 rounded-full bg-white/80" />
                  <div className="mt-5 h-14 w-full max-w-[38rem] rounded-[1.6rem] bg-white/90" />
                  <div className="mt-3 h-14 w-4/5 rounded-[1.6rem] bg-white/75 lg:w-[70%]" />
                  <div className="mt-7 flex flex-wrap gap-4">
                    <div className="h-4 w-20 rounded-full bg-white/80" />
                    <div className="h-4 w-24 rounded-full bg-white/80" />
                    <div className="h-4 w-28 rounded-full bg-white/80" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
                  {Array.from({ length: 3 }).map((_, idx) => (
                    <div key={idx} className="flex animate-pulse items-start gap-3 sm:gap-4">
                      <div className="h-11 w-11 rounded-full bg-[#f3f4f6] sm:h-14 sm:w-14" />
                      <div className="flex-1">
                        <div className="h-4 w-24 rounded-full bg-[#eef1f4]" />
                        <div className="mt-2 h-5 w-20 rounded-full bg-[#eef1f4]" />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="animate-pulse space-y-4">
                  <div className="h-8 w-52 rounded-full bg-[#eef1f4]" />
                  <div className="rounded-[1.55rem] border border-[#e7ebef] bg-white p-4 shadow-[0_14px_40px_rgba(37,39,45,0.05)] sm:p-6">
                    <div className="rounded-[1.3rem] border border-[#e8edf0] bg-[#fafbfd] px-4 py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="h-5 w-40 rounded-full bg-[#eef1f4]" />
                          <div className="mt-3 h-4 w-[78%] rounded-full bg-[#f1f3f6]" />
                        </div>
                        <div className="h-8 w-20 rounded-full bg-[#e7f6eb]" />
                      </div>
                    </div>
                    <div className="mt-4 space-y-3">
                      <div className="h-14 rounded-[1.2rem] border border-[#eef1f4] bg-white" />
                      <div className="h-14 rounded-[1.2rem] border border-[#eef1f4] bg-white" />
                    </div>
                    <div className="mt-4 flex flex-col gap-3 xl:flex-row xl:flex-wrap xl:items-center">
                      <div className="h-16 w-full rounded-[1.2rem] border border-[#dbe5dc] bg-[linear-gradient(180deg,#ffffff,#f8fbf8)] lg:w-[320px]" />
                      <div className="h-11 w-40 rounded-full bg-[#f5f7fa]" />
                      <div className="h-11 w-36 rounded-full bg-[#e8f8ed]" />
                    </div>
                    <div className="mt-4 rounded-[1.35rem] border border-[#dbe5dc] bg-[linear-gradient(180deg,#fbfdfb,#f6faf5)] p-4 sm:p-5">
                      <div className="h-4 w-40 rounded-full bg-[#e7eee8]" />
                      <div className="mt-4 space-y-3">
                        {Array.from({ length: 4 }).map((_, idx) => (
                          <div key={idx} className="flex items-center justify-between rounded-2xl border border-[#d8e4db] bg-white px-4 py-4 shadow-sm">
                            <div className="h-4 w-36 rounded-full bg-[#eef1f4]" />
                            <div className="h-8 w-20 rounded-full bg-[#eef7f0]" />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <aside className="space-y-4 sm:space-y-6 lg:sticky lg:top-6 lg:self-start">
                <div className="animate-pulse rounded-[1.45rem] border border-[#e8ebf0] bg-white p-5 shadow-sm sm:rounded-[1.7rem] sm:p-6">
                  <div className="h-14 w-40 rounded-full bg-[#eef1f4]" />
                  <div className="mt-3 h-5 w-24 rounded-full bg-[#eef1f4]" />
                  <div className="mt-6 h-12 rounded-xl bg-[#e5f2e5]" />
                </div>
                <div className="animate-pulse rounded-[1.45rem] border border-[#e8ebf0] bg-white p-5 shadow-sm sm:rounded-[1.7rem] sm:p-6">
                  <div className="h-8 w-40 rounded-full bg-[#eef1f4]" />
                  <div className="mt-5 flex items-center gap-4">
                    <div className="h-16 w-16 rounded-2xl bg-[#eef1f4]" />
                    <div className="flex-1">
                      <div className="h-5 w-28 rounded-full bg-[#eef1f4]" />
                      <div className="mt-2 h-4 w-24 rounded-full bg-[#eef1f4]" />
                      <div className="mt-2 h-4 w-20 rounded-full bg-[#eef1f4]" />
                    </div>
                  </div>
                  <div className="mt-5 border-t border-[#eceef2] pt-5" />
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                    {Array.from({ length: 3 }).map((_, idx) => (
                      <div key={idx}>
                        <div className="h-4 w-16 rounded-full bg-[#eef1f4]" />
                        <div className="mt-2 h-4 w-14 rounded-full bg-[#eef1f4]" />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="animate-pulse rounded-[1.45rem] border border-[#e8ebf0] bg-white p-5 shadow-sm sm:rounded-[1.7rem] sm:p-6">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="h-14 w-14 rounded-2xl bg-[#eef1f4]" />
                      <div>
                        <div className="h-4 w-28 rounded-full bg-[#eef1f4]" />
                        <div className="mt-2 h-4 w-32 rounded-full bg-[#eef1f4]" />
                      </div>
                    </div>
                    <div className="h-6 w-6 rounded-full bg-[#eef1f4]" />
                  </div>
                </div>
              </aside>
            </div>
            </main>
          </>
        ) : (
          <>
            <div className="border-b border-[#d4dccf] bg-[#f8faf7]">
              <div className="relative mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-6">
                <div className="flex items-center gap-3">
                  <BrandMark compact />
                  <div>
                    <div className="text-lg font-semibold tracking-wide">Submission</div>
                    <div className="text-xs text-slate-500">Preparing your project workspace...</div>
                  </div>
                </div>
              </div>
            </div>
            <main className="relative mx-auto w-full max-w-5xl space-y-6 px-5 py-8">
              <div className="animate-pulse rounded-3xl border border-[#cfdbc8] bg-white/80 p-6 shadow-sm">
                <div className="h-4 w-24 rounded bg-[#e7efe8]" />
                <div className="mt-4 h-8 w-2/3 rounded bg-[#e7efe8]" />
                <div className="mt-3 h-4 w-1/2 rounded bg-[#e7efe8]" />
              </div>
              <div className="animate-pulse rounded-3xl border border-[#cfdbc8] bg-white/80 p-6 shadow-sm">
                <div className="h-5 w-48 rounded bg-[#e7efe8]" />
                <div className="mt-4 h-32 rounded-2xl bg-[#eef4ef]" />
              </div>
            </main>
          </>
        )}
      </div>
    );
  }

  if (!session?.workerId) {
    return (
      <div className="min-h-screen bg-[#eef4ea] text-slate-900 flex items-center justify-center">
        <div className="rounded-2xl border border-[#d4dccf] bg-[#f9fbf7] p-8 shadow-sm text-sm text-slate-600">
          Please sign in to proceed.
        </div>
      </div>
    );
  }

  if (!gig) {
    return (
      <div className="min-h-screen bg-[#eef4ea] text-slate-900 flex items-center justify-center px-5">
        <div className="w-full max-w-lg rounded-2xl border border-[#d4dccf] bg-[#f9fbf7] p-6 shadow-sm">
          <div className="text-base font-semibold text-slate-900">Project unavailable</div>
          <div className="mt-2 text-sm text-slate-600">
            This project is currently unavailable. It may have been closed, removed, or updated by the admin.
          </div>
          <div className="mt-3 text-xs text-slate-500">Refresh Browse to pick an active project and continue.</div>
          {error && <div className="mt-3 text-xs font-semibold text-rose-700">{error}</div>}
          <Link
            className="mt-4 inline-flex rounded-full border border-[#c9d3c4] bg-white px-4 py-2 text-sm text-[#284b3e] hover:border-[#a9bbb1]"
            href="/browse"
          >
            Back to browse
          </Link>
        </div>
      </div>
    );
  }

  if (shouldBlockForKyc) {
    return (
      <div className="relative min-h-screen overflow-x-hidden bg-[#eef4ea] text-slate-900">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,#dce9de,transparent_42%)]" />
        <div className="border-b border-[#d4dccf] bg-[#f8faf7]">
          <div className="relative mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-6">
            <div>
              <div className="text-lg font-semibold tracking-wide">Submission</div>
              <div className="text-xs text-slate-500">Identity verification required before access is granted</div>
            </div>
            <Link
              className="rounded-full border border-[#c9d3c4] bg-white px-4 py-2 text-sm text-[#284b3e] hover:border-[#a9bbb1]"
              href="/browse"
            >
              Return
            </Link>
          </div>
        </div>

        <main className="relative mx-auto w-full max-w-3xl px-5 py-8">
          <div className="rounded-3xl border border-[#cfdbc8] bg-white/95 p-5 shadow-xl shadow-[#c8d5c7]/55 backdrop-blur sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="rounded-full border border-[#d3dbce] bg-[#f2f6ef] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#4f6359]">
                Protected gig access
              </span>
              <span className="rounded-full border border-[#bcd6c9] bg-[#edf5ef] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#2f6655]">
                KYC: {kycStatus}
              </span>
            </div>

            <div className="mt-5 text-xs text-slate-500">Protected gig</div>
            <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-tight text-[#162038] sm:text-4xl">
              Gig details will unlock after KYC approval
            </h1>

            <div className="mt-5 rounded-2xl border border-[#d4dfd7] bg-[#f7fbf5] p-4 sm:p-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6f877d]">Why this is locked</div>
              <div className="mt-2 text-base font-semibold text-[#1c3e33]">
                {kycStatus === "pending" ? "Your mini KYC is under review." : "Complete mini KYC to unlock this gig."}
              </div>
              <div className="mt-2 text-sm leading-6 text-[#4d665c]">
                {kycStatus === "pending"
                  ? "This project stays hidden until your verification is approved. Once approved, access will unlock automatically."
                  : "This gig requires identity verification before proposal and submission tools become available."}
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/workspace"
                className="inline-flex items-center justify-center rounded-full bg-[#1f4f43] px-5 py-3 text-sm font-semibold text-white hover:bg-[#2d6b5a]"
              >
                {kycStatus === "pending" ? "Open KYC status" : "Complete mini KYC"}
              </Link>
              <Link
                href="/browse"
                className="inline-flex items-center justify-center rounded-full border border-[#c9d3c4] bg-white px-5 py-3 text-sm font-semibold text-[#284b3e] hover:border-[#a9bbb1]"
              >
                Back to browse
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={`relative min-h-screen overflow-x-hidden ${isMarketplaceFlow ? "bg-[#fbfbfb] text-[#25272d]" : "bg-[#eef4ea] text-slate-900"}`}>
      {!isMarketplaceFlow && <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,#dce9de,transparent_42%)]" />}
      {isMarketplaceFlow && (
        <header className="sticky top-0 z-30 border-b border-[#d5ddcf] bg-[#f8faf7]/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-3 py-3 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3 sm:gap-4 lg:gap-8">
              <div className="hidden lg:block">
                <BrandMark />
              </div>
              <div className="lg:hidden">
                <BrandMark compact />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <div className="relative" data-profile-menu>
                <button
                  ref={menuButtonRef}
                  className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 sm:gap-2 sm:px-3 sm:py-2 sm:text-xs"
                  onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1f4f43] text-xs font-bold text-white sm:h-9 sm:w-9 sm:text-sm">
                    {displayName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="max-w-[5rem] truncate text-xs text-slate-700 sm:hidden">{marketplaceProfileLabel}</span>
                  <span className="hidden max-w-[12rem] truncate text-sm text-slate-700 sm:block">{displayName}</span>
                  <span className="text-slate-400">▾</span>
                </button>
                {menuOpen &&
                  typeof document !== "undefined" &&
                  createPortal(
                    <>
                      <div className="fixed inset-0 z-[9990] flex items-stretch justify-end bg-slate-900/30 md:hidden">
                        <div
                          data-profile-menu-panel
                          className={`fixed right-0 top-0 bottom-0 z-[9991] flex w-[88vw] max-w-[420px] flex-col rounded-none border-l border-[#d4dccf] bg-[#f8faf7] text-slate-900 shadow-2xl transition-all duration-200 ease-out ${
                            menuClosing ? "animate-[slideOutRight_160ms_ease-in]" : "animate-[slideInRight_200ms_ease-out]"
                          }`}
                        >
                          {renderProfileMenu(false)}
                        </div>
                      </div>
                      <div
                        data-profile-menu-panel
                        className={`fixed z-[9991] hidden rounded-[1.6rem] border border-[#d4dccf] bg-[#f8faf7] text-slate-900 shadow-2xl backdrop-blur-xl md:block ${
                          menuClosing ? "animate-[slideUp_160ms_ease-in]" : "animate-[slideDown_200ms_ease-out]"
                        }`}
                        style={menuAnchor ? { top: menuAnchor.top, left: menuAnchor.left, width: menuAnchor.width, maxWidth: "calc(100vw - 2rem)" } : { top: 80, right: 24, width: "28rem", maxWidth: "calc(100vw - 2rem)" }}
                      >
                        {renderProfileMenu(true)}
                      </div>
                    </>,
                    document.body
                  )}
              </div>
            </div>
          </div>
        </header>
      )}
      {!isMarketplaceFlow && (
        <div className="border-b border-[#d4dccf] bg-[#f8faf7]">
          <div className="relative mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-6">
            <div className="flex items-center gap-3">
              <div>
                <div className="text-lg font-semibold tracking-wide">Submission</div>
                <div className="text-xs text-slate-500">Secure credential verification and handoff</div>
              </div>
            </div>

            <Link
              className="rounded-full border border-[#c9d3c4] bg-white px-4 py-2 text-sm text-[#284b3e] hover:border-[#a9bbb1]"
              href="/browse"
            >
              Return
            </Link>
          </div>
        </div>
      )}
      {activeReferenceVideo &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/88 p-3 sm:p-5">
            <div className="flex h-full w-full max-w-6xl items-center justify-center">
              <div className="relative flex h-full max-h-[92vh] w-full items-center justify-center overflow-hidden rounded-[1.75rem] bg-black shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
                <button
                  type="button"
                  aria-label="Close video"
                  onClick={() => setActiveReferenceVideo(null)}
                  className="absolute right-3 top-3 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/45 text-xl font-semibold text-white backdrop-blur-sm transition hover:bg-black/60 sm:right-4 sm:top-4"
                  style={{ top: "max(0.75rem, env(safe-area-inset-top))" }}
                >
                  ×
                </button>
                <video
                  key={activeReferenceVideo.url}
                  src={activeReferenceVideo.url}
                  controls
                  autoPlay
                  playsInline
                  className="h-full w-full object-contain"
                  preload="auto"
                />
                <div className="pointer-events-none absolute left-4 top-4 rounded-full border border-white/20 bg-black/35 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white backdrop-blur-sm">
                  {activeReferenceVideo.label}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      <main className={`relative mx-auto w-full ${isMarketplaceFlow ? "max-w-[1380px] px-3 py-4 sm:px-6 sm:py-5 lg:px-8" : "max-w-5xl space-y-6 px-5 py-8"}`}>
        {isMarketplaceFlow && (
          <>
            <div className="mb-4 flex flex-col gap-2.5 border-b border-[#eceef2] pb-4 sm:mb-5 sm:gap-4 sm:pb-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-y-2 text-[0.95rem] sm:text-sm">
                <Link
                  href="/"
                  className="rounded-full px-1.5 py-1 font-medium text-[#2f3747] transition hover:bg-[#f4f6f9] hover:text-[#121826] focus:outline-none focus:ring-2 focus:ring-[#d9dee6] sm:px-2"
                >
                  Home
                </Link>
                <span className="px-1 text-[#a0a5ae] sm:px-1.5">/</span>
                <Link
                  href="/browse"
                  className="rounded-full px-1.5 py-1 font-medium text-[#2f3747] transition hover:bg-[#f4f6f9] hover:text-[#121826] focus:outline-none focus:ring-2 focus:ring-[#d9dee6] sm:px-2"
                >
                  Projects
                </Link>
                <span className="px-1 text-[#a0a5ae] sm:px-1.5">/</span>
                <span className="min-w-0 rounded-full bg-[#f6f7fa] px-2 py-1 text-[#7b808a] sm:px-2.5">
                  <span className="block max-w-[140px] truncate sm:max-w-[420px]">{gig.title}</span>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[0.95rem] font-semibold text-[#2f3747] sm:gap-3 sm:text-sm">
                <button
                  type="button"
                  onClick={handleProjectShare}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#e6e8ed] bg-white text-[#626874] shadow-sm transition hover:border-[#d8dde6] hover:bg-[#f8fafc] sm:h-11 sm:w-11"
                  aria-label="Share project"
                  title="Share project"
                >
                  <ProjectLineIcon kind="share" className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
                </button>
                <button
                  type="button"
                  onClick={handleProjectSave}
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-full border bg-white shadow-sm transition sm:h-11 sm:w-11 ${
                    savedGig
                      ? "border-[#d9e6dc] bg-[#f3faf4] text-[#2f6a4d]"
                      : "border-[#e6e8ed] text-[#626874] hover:border-[#d8dde6] hover:bg-[#f8fafc]"
                  }`}
                  aria-label={savedGig ? "Unsave project" : "Save project"}
                  title={savedGig ? "Unsave project" : "Save project"}
                >
                  <ProjectLineIcon kind="heart" className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
                </button>
                <button
                  type="button"
                  onClick={handleProjectShare}
                  className="rounded-full px-2 py-1 text-[#2f3747] transition hover:bg-[#f4f6f9]"
                >
                  Share
                </button>
                <button
                  type="button"
                  onClick={handleProjectSave}
                  className={`rounded-full px-2 py-1 transition hover:bg-[#f4f6f9] ${savedGig ? "text-[#2f6a4d]" : "text-[#2f3747]"}`}
                >
                  {savedGig ? "Saved" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={handleProjectReport}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#d2a018] transition hover:bg-[#fff8e7] sm:h-10 sm:w-10"
                  aria-label="Report project"
                  title="Report project"
                >
                  <ProjectLineIcon kind="warning" className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
                </button>
              </div>
            </div>
            {actionMessage && (
              <div className="mb-4 rounded-2xl border border-[#d9e2d8] bg-[#f6faf5] px-4 py-2.5 text-sm font-medium text-[#476255]">
                {actionMessage}
              </div>
            )}
          </>
        )}

        {!isMarketplaceFlow && (
        <div className="rounded-[1.4rem] border border-[#cfdbc8] bg-white/90 p-4 shadow-xl shadow-[#c8d5c7]/55 backdrop-blur sm:rounded-3xl sm:p-6">
          <div className="text-xs text-slate-500">Gig</div>
          <h1 className="mt-2 text-balance text-[1.95rem] font-semibold leading-[1.06] tracking-tight text-[#162038] sm:text-5xl">
            {gig?.title ?? "Gig"}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.98rem] text-slate-500 sm:text-lg">
            <span className="inline-flex items-center gap-2">
              <svg viewBox="0 0 24 24" className="h-5 w-5 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              Posted {gig?.postedAt || "recently"}
            </span>
            <span className="inline-flex items-center gap-2">
              <svg viewBox="0 0 24 24" className="h-5 w-5 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              {gig?.location}
            </span>
          </div>
          <div className="mt-5 border-t border-[#e4e7e4]" />
          <div className="mt-3 sm:mt-4">
            <span className={`rounded-full border px-3 py-1 text-xs ${statusTone}`}>Status: {assignmentStatus}</span>
          </div>
        </div>
        )}

        {isCustomFlow && (
          <div className="rounded-3xl border border-[#cfdbc8] bg-white/90 p-4 shadow-xl shadow-[#c8d5c7]/55 backdrop-blur sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6f877d]">Project delivery workspace</div>
                <div className="mt-1 text-base font-semibold text-[#1c3e33] sm:text-lg">Submit your execution plan for this project</div>
              </div>
              <span className="rounded-full bg-[#edf5ef] px-3 py-1 text-xs font-semibold text-[#2f6655]">
                Project type: {customType}
              </span>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-[#d4dfd7] bg-[#f7fbf5] p-3.5 sm:p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6f877d]">Project brief</div>
                {customBrief ? (
                  <div className="mt-2 rounded-xl border border-[#d4dfd7] bg-white px-3 py-3 sm:px-4">
                    <FormattedBrief
                      text={customBrief}
                      sectionClassName="space-y-3"
                      headingClassName="text-[1.05rem] font-semibold text-[#1f4f43] sm:text-base"
                      bodyClassName="text-[0.95rem] leading-7 text-[#4d665c] sm:text-sm sm:leading-7"
                    />
                  </div>
                ) : (
                  <div className="mt-2 text-[0.95rem] leading-7 text-[#4d665c] sm:text-sm">
                    Review this project brief and submit a clear execution plan with milestones, communication cadence, and quality controls.
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] sm:text-xs">
                  <span className="rounded-full border border-[#d4dfd7] bg-white px-3 py-1 text-[#4d665c]">Platform: {gig?.platform}</span>
                  <span className="rounded-full border border-[#d4dfd7] bg-white px-3 py-1 text-[#4d665c]">Location: {gig?.location}</span>
                  <span className="rounded-full border border-[#d4dfd7] bg-white px-3 py-1 text-[#4d665c]">Workload: {gig?.workload}</span>
                  <span className="rounded-full border border-[#d4dfd7] bg-white px-3 py-1 text-[#4d665c]">Budget: {gig?.payout}</span>
                </div>
                <div className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-[#6f877d]">Scope and requirements</div>
                <div className="mt-2 space-y-2">
                  {customRequirementItems.length === 0 && (
                    <div className="rounded-xl border border-[#d4dfd7] bg-white px-3 py-2 text-xs text-[#6f877d]">
                      No additional requirements were provided by admin.
                    </div>
                  )}
                  {customRequirementItems.map((req, idx) => (
                    <div key={`${req}-${idx}`} className="rounded-xl border border-[#d4dfd7] bg-white px-3 py-2 text-xs text-[#4d665c]">
                      {idx + 1}. {req}
                    </div>
                  ))}
                </div>
                {customMediaItems.length > 0 && (
                  <>
                    <div className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-[#6f877d]">Reference media</div>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      {customMediaItems.map((url, idx) => (
                        <div key={`${url}-${idx}`} className="overflow-hidden rounded-xl border border-[#d4dfd7] bg-white">
                          {isImageUrl(url) ? (
                            <div className="aspect-[9/11] w-full overflow-hidden bg-slate-100 sm:aspect-[4/5]">
                              <img src={url} alt={`Reference media ${idx + 1}`} className="h-full w-full object-cover" loading="lazy" />
                            </div>
                          ) : isVideoUrl(url) ? (
                            <div className="relative aspect-[9/11] w-full overflow-hidden bg-[#eef3ef] sm:aspect-[4/5]">
                              <video
                                src={url}
                                autoPlay
                                muted
                                loop
                                playsInline
                                className="h-full w-full scale-[1.05] bg-[#eef3ef] object-cover blur-[3px] brightness-[0.88] saturate-[0.92]"
                                preload="metadata"
                              />
                              <button
                                type="button"
                                onClick={() => setActiveReferenceVideo({ url, label: `Reference Asset ${idx + 1}` })}
                                className="absolute inset-0 flex items-center justify-center"
                                aria-label={`Play reference video ${idx + 1}`}
                              >
                                <span className="rounded-full border border-white/35 bg-black/20 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white shadow-[0_12px_28px_rgba(0,0,0,0.18)] backdrop-blur-sm transition hover:bg-black/30 sm:px-4 sm:text-[11px] sm:tracking-[0.18em]">
                                  Tap to Play
                                </span>
                              </button>
                              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,transparent_20%,rgba(0,0,0,0.12)_56%,rgba(0,0,0,0.24)_100%)]" />
                              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/38 via-black/14 to-transparent" />
                            </div>
                          ) : (
                            <div className="p-3 text-xs text-[#4d665c]">
                              <a href={url} target="_blank" rel="noreferrer" className="font-semibold text-[#1f4f43] underline-offset-2 hover:underline">
                                Open reference asset {idx + 1}
                              </a>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="rounded-2xl border border-[#d4dfd7] bg-white p-4">
                <label className="block text-xs font-semibold text-[#4d665c]">
                  Plan summary
                  <textarea
                    className="mt-2 h-20 w-full rounded-xl border border-[#d4dfd7] bg-[#f9fcf7] px-3 py-2 text-sm text-slate-900"
                    placeholder="Summarize your approach, expected outcome, and why your plan is reliable."
                    value={proposalPitch}
                    onChange={(e) => setProposalPitch(e.target.value)}
                  />
                </label>
                <label className="mt-3 block text-xs font-semibold text-[#4d665c]">
                  Delivery approach
                  <textarea
                    className="mt-2 h-24 w-full rounded-xl border border-[#d4dfd7] bg-[#f9fcf7] px-3 py-2 text-sm text-slate-900"
                    placeholder="Outline milestones, deliverables, quality checkpoints, and reporting cadence."
                    value={proposalApproach}
                    onChange={(e) => setProposalApproach(e.target.value)}
                  />
                </label>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-semibold text-[#4d665c]">
                    Delivery timeline
                    <input
                      className="mt-2 w-full rounded-xl border border-[#d4dfd7] bg-[#f9fcf7] px-3 py-2 text-sm text-slate-900"
                      placeholder="e.g., 10 days with milestone updates every 48 hours"
                      value={proposalTimeline}
                      onChange={(e) => setProposalTimeline(e.target.value)}
                    />
                  </label>
                  <label className="text-xs font-semibold text-[#4d665c]">
                    Budget note (optional)
                    <input
                      className="mt-2 w-full rounded-xl border border-[#d4dfd7] bg-[#f9fcf7] px-3 py-2 text-sm text-slate-900"
                      placeholder="Milestone split, dependencies, or payout assumptions"
                      value={proposalBudget}
                      onChange={(e) => setProposalBudget(e.target.value)}
                    />
                  </label>
                </div>
                <label className="mt-3 block text-xs font-semibold text-[#4d665c]">
                  Relevant work links (optional)
                  <input
                    className="mt-2 w-full rounded-xl border border-[#d4dfd7] bg-[#f9fcf7] px-3 py-2 text-sm text-slate-900"
                    placeholder="Drive, Notion, case studies, sample dashboards, or social profiles"
                    value={proposalPortfolio}
                    onChange={(e) => setProposalPortfolio(e.target.value)}
                  />
                </label>
              </div>
            </div>
            {error && (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</div>
            )}
            {success && (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{success}</div>
            )}

            <div className="mt-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
              <div className="text-xs text-[#6f877d]">Your proposal will be sent to recruiter for review.</div>
              <button
                className="w-full rounded-full bg-[#1f4f43] px-5 py-2 text-sm font-semibold text-white hover:bg-[#2d6b5a] disabled:opacity-50 sm:w-auto"
                onClick={submitCustomProposal}
                disabled={proposalSaving || (hasApplication && proposalReviewStatus !== "Rejected")}
              >
                {proposalSaving
                  ? "Submitting plan..."
                  : hasApplication && proposalReviewStatus !== "Rejected"
                    ? "Plan submitted"
                    : "Submit project plan"}
              </button>
            </div>
          </div>
        )}

        {isEmailCreatorFlow && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="space-y-4 sm:space-y-5">
              <section className="relative overflow-hidden rounded-[1.45rem] border border-[#f6e0d8] bg-[linear-gradient(135deg,#fff7f3,rgba(255,245,240,0.99))] p-4 shadow-sm sm:rounded-[1.7rem] sm:p-8">
                <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_1px_1px,rgba(201,157,136,0.16)_1px,transparent_0)] [background-size:18px_18px]" />
                <div className="relative">
                  <h2 className="max-w-4xl text-[1.55rem] font-semibold leading-tight tracking-tight text-[#24262d] sm:text-[3.2rem] lg:max-w-[90%] xl:max-w-4xl">
                    {gig.title}
                  </h2>
                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2.5 text-[0.95rem] font-medium text-[#4b4f59] sm:mt-6 sm:gap-x-6 sm:gap-y-3 sm:text-sm">
                    <span className="inline-flex items-center gap-2">
                      <ProjectLineIcon kind="location" className="h-[18px] w-[18px]" />
                      {gig.location}
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <ProjectLineIcon kind="calendar" className="h-[18px] w-[18px]" />
                      {gig.postedAt || "Recently posted"}
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <ProjectLineIcon kind="views" className="h-[18px] w-[18px]" />
                      {hasApplication ? "Access active" : "Ready after KYC"}
                    </span>
                  </div>
                </div>
              </section>

              <section className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  { icon: "location", label: "Access model", value: "Direct after KYC" },
                  { icon: "duration", label: "Workload", value: gig.workload },
                  { icon: "level", label: "Assignment pack", value: "5 dashboard emails" },
                ].map((item) => (
                  <div key={item.label} className="flex items-start gap-3 sm:gap-4">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#f6f1e8] text-[#3e6357] sm:h-14 sm:w-14">
                      <ProjectLineIcon kind={item.icon as "location" | "duration" | "level"} className="h-5 w-5 sm:h-7 sm:w-7" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[0.9rem] font-semibold leading-5 text-[#2c3038] sm:text-[0.95rem] sm:leading-6">{item.label}</div>
                      <div className="mt-0.5 text-[0.95rem] text-[#4a4f58] sm:mt-1 sm:text-[1.05rem]">{item.value}</div>
                    </div>
                  </div>
                ))}
              </section>

              <section id={proposalDeskId} className="pt-1">
                <div className="text-[1.75rem] font-semibold tracking-tight text-[#24262d] sm:text-[2rem]">
                  {hasApplication ? (credentialSubmissionLocked ? "Submission Review" : "Execution Workspace") : "Activation Overview"}
                </div>
                <div className="mt-4 rounded-[1.55rem] border border-[#e7ebef] bg-[linear-gradient(180deg,#ffffff,#fcfcfb)] p-4 shadow-[0_14px_40px_rgba(37,39,45,0.06)] sm:rounded-[1.8rem] sm:p-6">
                  {!hasApplication ? (
                    <div className="space-y-4">
                      <div className="rounded-[1.3rem] border border-[#e8edf0] bg-[linear-gradient(180deg,#fbfcfd,#f8fafb)] px-4 py-4 sm:px-5">
                        <div className="text-[1.02rem] font-semibold text-[#2c3038]">Activate work access</div>
                        <div className="mt-1 text-sm leading-7 text-[#4d5563]">
                          KYC-cleared workers can activate this email-creator assignment immediately. No recruiter approval round is required for this gig type.
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-[1.2rem] border border-[#e8edf0] bg-white px-4 py-3.5 shadow-sm">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#738476]">Delivery mode</div>
                          <div className="mt-2 text-base font-semibold text-[#274537]">Assigned dashboard pack</div>
                          <div className="mt-1 text-sm text-[#617166]">You will receive five working emails and live inbox access after activation.</div>
                        </div>
                        <div className="rounded-[1.2rem] border border-[#e8edf0] bg-white px-4 py-3.5 shadow-sm">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#738476]">Execution rule</div>
                          <div className="mt-2 text-base font-semibold text-[#274537]">One email per account</div>
                          <div className="mt-1 text-sm text-[#617166]">Use each assigned email once and follow the inbox verification flow from this workspace.</div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={submitStandardProposal}
                        disabled={proposalSaving}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#77c07d] px-5 py-4 text-[1.05rem] font-semibold text-white transition hover:bg-[#67b56e] disabled:opacity-50 sm:w-auto sm:min-w-[240px]"
                      >
                        {proposalSaving ? "Activating access..." : "Activate work access"} <ProjectLineIcon kind="external" className="h-4 w-4" />
                      </button>
                    </div>
                  ) : credentialSubmissionLocked ? (
                    credentialReviewPanel
                  ) : (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-start justify-between gap-3 rounded-[1.45rem] border border-[#e8edf0] bg-[linear-gradient(180deg,#fbfcfd,#f8fafb)] px-4 py-4 sm:px-5">
                        <div>
                          <div className="text-[1.02rem] font-semibold text-[#2c3038]">Work access active</div>
                          <div className="mt-1 text-sm leading-7 text-[#4d5563]">
                            {customBrief || "Your email-creator workspace is live. Assigned emails, verification inbox, and creator utilities are ready below."}
                          </div>
                        </div>
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                          Active
                        </span>
                      </div>
                      <div className="rounded-[1.3rem] border border-[#dbe5dc] bg-[linear-gradient(180deg,#fbfdfb,#f6faf5)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] sm:p-5">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#738476]">Assigned dashboard emails</div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          {assignment?.assignedEmails?.length ? (
                            assignment.assignedEmails.map((email) => (
                              <button
                                key={email}
                                className={`inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                                  copiedEmail === email
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                    : "border-[#d8e4db] bg-white text-[#355548] hover:border-[#c5d7cb]"
                                }`}
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(email);
                                    setCopiedEmail(email);
                                    window.setTimeout(() => setCopiedEmail((prev) => (prev === email ? null : prev)), 1200);
                                  } catch {
                                    // ignore
                                  }
                                }}
                                type="button"
                              >
                                <span className="truncate">{copiedEmail === email ? "Copied" : email}</span>
                              </button>
                            ))
                          ) : (
                            <div className="rounded-2xl border border-[#d8e4db] bg-white px-4 py-3 text-sm text-[#617166] sm:col-span-2">
                              {assignment?.assignedEmail ?? "Assigning email pack..."}
                            </div>
                          )}
                        </div>
                        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="text-sm text-[#587062]">Use each email once and follow the verification messages inside the inbox sync panel.</div>
                          <Link
                            href="/work-email-creator"
                            className="inline-flex items-center justify-center rounded-full border border-[#d6e2da] bg-white px-4 py-2.5 text-sm font-semibold text-[#355548] transition hover:border-[#c6d7cc]"
                          >
                            Open Work Email Creator
                          </Link>
                        </div>
                      </div>

                      <div className="rounded-[1.35rem] border border-[#dbe5dc] bg-[linear-gradient(180deg,#fbfdfb,#f6faf5)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] sm:p-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#738476]">Inbox sync</div>
                            <div className="mt-1 text-sm font-semibold text-[#2c3038]">
                              {filteredInbox.length > 0 ? `${filteredInbox.length} messages available` : "No messages yet"}
                              {unreadCount > 0 && (
                                <span className="ml-2 rounded-full border border-[#d8e4db] bg-white px-2 py-0.5 text-[11px] text-[#2f6655]">
                                  {unreadCount} unread
                                </span>
                              )}
                            </div>
                            <div className="mt-1 text-xs text-[#85909c]">
                              {autoSync
                                ? lastSyncAt
                                  ? `Live refresh active • Last synced at ${lastSyncAt}`
                                  : "Live refresh active • Waiting for first sync"
                                : "Live refresh paused"}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-[#6b757f]">
                            {assignedList.length > 0 && (
                              <select
                                className="rounded-full border border-[#d8e4db] bg-white px-3 py-1.5 text-xs font-semibold text-[#355548] outline-none"
                                value={emailFilter}
                                onChange={(e) => setEmailFilter(e.target.value)}
                              >
                                <option value="all">All assigned</option>
                                {assignedList.map((email) => (
                                  <option key={email} value={email}>
                                    {email}
                                  </option>
                                ))}
                              </select>
                            )}
                            <button
                              className="rounded-full border border-[#d8e4db] bg-white px-3 py-1.5 font-semibold text-[#355548] hover:border-[#c5d7cb] disabled:opacity-50"
                              disabled={!assignment?.id || polling}
                              onClick={() => {
                                void refreshInbox();
                              }}
                              type="button"
                            >
                              {polling ? "Syncing..." : "Refresh"}
                            </button>
                            <button
                              className="rounded-full border border-[#d8e4db] bg-white px-3 py-1.5 font-semibold text-[#355548] hover:border-[#c5d7cb] disabled:opacity-50"
                              disabled={unreadCount === 0}
                              onClick={markAllRead}
                              type="button"
                            >
                              Mark read
                            </button>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
                          <div className="rounded-2xl border border-[#d8e4db] bg-white p-2 shadow-sm">
                            <div className="max-h-[320px] overflow-auto">
                              {filteredInbox
                                .slice()
                                .sort((a, b) => new Date(b.createdAt ?? b.created_at ?? 0).getTime() - new Date(a.createdAt ?? a.created_at ?? 0).getTime())
                                .slice(0, 10)
                                .map((msg) => {
                                  const created = msg.createdAt ?? msg.created_at ?? null;
                                  const subject = msg.subject ?? "Verification";
                                  const body = msg.body ?? "";
                                  const active = selectedMsg?.id === msg.id;
                                  return (
                                    <button
                                      key={msg.id}
                                      type="button"
                                      className={`mb-2 w-full rounded-2xl border px-3 py-3 text-left transition ${
                                        active ? "border-[#bfd5c7] bg-[#f6faf5]" : "border-transparent bg-white hover:border-[#e1e7e4] hover:bg-[#fafcfb]"
                                      }`}
                                      onClick={() => {
                                        setSelectedMsg(msg);
                                        markRead(msg);
                                      }}
                                    >
                                      <div className="truncate text-sm font-semibold text-[#2c3038]">{subject}</div>
                                      <div className="mt-1 line-clamp-2 text-xs leading-5 text-[#66707d]">{cleanInboxBody(body) || "Open to view message content."}</div>
                                      {created && <div className="mt-2 text-[10px] text-[#85909c]">{new Date(created).toLocaleString()}</div>}
                                    </button>
                                  );
                                })}
                              {filteredInbox.length === 0 && (
                                <div className="rounded-2xl border border-dashed border-[#d8e4db] bg-[#fcfdfc] px-4 py-8 text-center text-sm text-[#6b757f]">
                                  No verification messages have arrived yet.
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="rounded-2xl border border-[#d8e4db] bg-white p-4 shadow-sm">
                            {selectedMsg ? (
                              <>
                                <div className="text-sm font-semibold text-[#2c3038]">{selectedMsg.subject ?? "Verification"}</div>
                                <div className="mt-1 text-xs text-[#85909c]">
                                  {new Date(selectedMsg.createdAt ?? selectedMsg.created_at ?? Date.now()).toLocaleString()}
                                </div>
                                <div className="mt-4 whitespace-pre-wrap text-sm leading-7 text-[#4d5563]">
                                  {String(selectedMsg.body ?? "").trim() || "No message body available."}
                                </div>
                              </>
                            ) : (
                              <div className="flex h-full min-h-[220px] items-center justify-center rounded-2xl border border-dashed border-[#d8e4db] bg-[#fcfdfc] px-4 text-center text-sm text-[#6b757f]">
                                Select a message to inspect verification details.
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-[1.35rem] border border-[#dbe5dc] bg-[linear-gradient(180deg,#fbfdfb,#f6faf5)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] sm:p-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#738476]">Credential handoff</div>
                            <div className="mt-1 text-sm font-semibold text-[#2c3038]">Submit 5 account credentials</div>
                            <div className="mt-1 text-sm text-[#617166]">Admin will review and verify the created accounts after compliance checks.</div>
                          </div>
                          <span className="rounded-full border border-[#d8e4db] bg-white px-3 py-1.5 text-xs font-semibold text-[#355548]">
                            Required: 5
                          </span>
                        </div>

                        <div className="mt-4 grid gap-3">
                          {rows.map((row, idx) => (
                            <div key={idx} className="grid gap-3 rounded-2xl border border-[#d8e4db] bg-white p-4 shadow-sm md:grid-cols-4">
                              <input
                                className="rounded-xl border border-[#d8e4db] bg-[#fcfdfc] px-3 py-3 text-sm text-slate-900"
                                placeholder={`@handle ${idx + 1}`}
                                value={row.handle}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, handle: value } : r)));
                                }}
                              />
                              <input
                                className="rounded-xl border border-[#d8e4db] bg-[#fcfdfc] px-3 py-3 text-sm text-slate-900"
                                placeholder="Email used"
                                value={row.email}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, email: value } : r)));
                                }}
                              />
                              <input
                                className="rounded-xl border border-[#d8e4db] bg-[#fcfdfc] px-3 py-3 text-sm text-slate-900"
                                placeholder="Password"
                                value={row.password}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, password: value } : r)));
                                }}
                              />
                              <input
                                className="rounded-xl border border-[#d8e4db] bg-[#fcfdfc] px-3 py-3 text-sm text-slate-900"
                                placeholder="Phone (optional)"
                                value={row.phone}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, phone: value } : r)));
                                }}
                              />
                            </div>
                          ))}
                        </div>

                        {!credentialSubmissionLocked && credentialReviewBanner}

                        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="text-xs text-[#6b7770]">All fields are encrypted in transit. Do not reuse credentials.</div>
                          <button
                            className="inline-flex items-center justify-center rounded-full bg-[#1f4f43] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#2d6b5a] disabled:opacity-50"
                            onClick={submitCredentials}
                            disabled={saving || invalidRows || credentialSubmissionLocked}
                          >
                            {saving ? "Submitting..." : credentialSubmissionLocked ? "Submitted for admin review" : "Submit for verification"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  {error && (
                    <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</div>
                  )}
                  {success && success !== CREDENTIAL_SUCCESS_MESSAGE && (
                    <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{success}</div>
                  )}
                </div>
              </section>

              {!hasApplication && standardRequirementItems.length > 0 && (
                <section className="space-y-3">
                  <div className="text-[1.75rem] font-semibold tracking-tight text-[#24262d] sm:text-[2rem]">Execution Rules</div>
                  <div className="grid gap-3">
                    {standardRequirementItems.map((req, idx) => (
                      <div key={`${req}-${idx}`} className="rounded-2xl border border-[#eceef2] bg-white px-4 py-3 text-[1rem] leading-7 text-[#4d5563] shadow-sm">
                        <span className="font-semibold text-[#2c3038]">{idx + 1}.</span> {String(req).replace(/^brief::/i, "")}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>

            <aside className="space-y-4 sm:space-y-6 lg:sticky lg:top-6 lg:self-start">
              <section className="rounded-[1.45rem] border border-[#e8ebf0] bg-white p-5 shadow-sm sm:rounded-[1.7rem] sm:p-6">
                <div className="text-[2.45rem] font-semibold tracking-tight text-[#24262d] sm:text-[3rem]">{gig.payout}</div>
                <div className="mt-1 text-[1rem] text-[#4d5563] sm:text-[1.1rem]">{gig.payoutType} rate</div>
                <button
                  className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-[#77c07d] px-5 py-3.5 text-[1rem] font-semibold text-white transition hover:bg-[#67b56e] disabled:opacity-50 sm:mt-7 sm:py-4 sm:text-[1.05rem]"
                  onClick={() => {
                    if (hasApplication) {
                      document.getElementById(proposalDeskId)?.scrollIntoView({ behavior: "smooth", block: "start" });
                      return;
                    }
                    submitStandardProposal();
                  }}
                  disabled={proposalSaving}
                >
                  {proposalSaving ? "Activating..." : hasApplication ? "Open workspace" : "Activate work access"}
                </button>
              </section>

              <section className="rounded-[1.45rem] border border-[#e8ebf0] bg-white p-5 shadow-sm sm:rounded-[1.7rem] sm:p-6">
                <div className="text-[1.7rem] font-semibold tracking-tight text-[#24262d] sm:text-[2rem]">About Seller</div>
                <div className="mt-5 flex items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#f7faf8] text-2xl font-bold text-[#1f4f43]">
                    {gig.company.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-[1.4rem] font-semibold text-[#24262d]">{gig.company}</div>
                    <div className="text-sm text-[#4d5563]">{gig.platform} email creator workspace</div>
                    <div className="mt-1 text-sm font-medium text-[#5d6672]">
                      {hasApplication ? "Access live" : "Verified listing"}
                    </div>
                  </div>
                </div>
                <div className="mt-5 border-t border-[#eceef2] pt-5" />
                <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
                  <div>
                    <div className="font-semibold text-[#2c3038]">Location</div>
                    <div className="mt-1 text-[#4d5563]">{gig.location}</div>
                  </div>
                  <div>
                    <div className="font-semibold text-[#2c3038]">Platform</div>
                    <div className="mt-1 text-[#4d5563]">{gig.platform}</div>
                  </div>
                  <div>
                    <div className="font-semibold text-[#2c3038]">Categories</div>
                    <div className="mt-1 text-[#4d5563]">Email Creator</div>
                  </div>
                </div>
              </section>

              <Link
                href="/work-email-creator"
                className="flex w-full items-center justify-between gap-4 rounded-[1.3rem] border border-[#d9e1dc] bg-[#f7faf8] px-4 py-4 text-[#24303b] shadow-sm transition hover:border-[#c6d0ca] hover:bg-[#f3f7f4] sm:rounded-[1.55rem] sm:px-5 sm:py-5"
              >
                <div className="flex min-w-0 items-center gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[#e1e7e2] bg-white text-[#7a869d] shadow-sm sm:h-16 sm:w-16">
                    <ProjectLineIcon kind="external" className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-[#6d7b8f] sm:text-[0.8rem]">
                      Creator utility
                    </div>
                    <div className="mt-1 text-[0.92rem] text-[#5b6672] sm:text-[0.98rem]">
                      Generate additional dashboard emails when needed
                    </div>
                    <div className="mt-1 truncate text-[1.08rem] font-semibold tracking-tight text-[#1f2740] sm:text-[1.16rem]">
                      Open Work Email Creator
                    </div>
                  </div>
                </div>
                <ProjectLineIcon kind="external" className="h-6 w-6 shrink-0 text-[#7a869d] sm:h-7 sm:w-7" />
              </Link>
            </aside>
          </div>
        )}

        {isProjectStyleFlow && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="space-y-4 sm:space-y-5">
              <section className="relative overflow-hidden rounded-[1.45rem] border border-[#f6e0d8] bg-[linear-gradient(135deg,#fff7f3,rgba(255,245,240,0.99))] p-4 shadow-sm sm:rounded-[1.7rem] sm:p-8">
                <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_1px_1px,rgba(201,157,136,0.16)_1px,transparent_0)] [background-size:18px_18px]" />
                <div className="relative">
                  <h2 className="max-w-4xl text-[1.55rem] font-semibold leading-tight tracking-tight text-[#24262d] sm:text-[3.2rem] lg:max-w-[90%] xl:max-w-4xl">
                    {gig.title}
                  </h2>
                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2.5 text-[0.95rem] font-medium text-[#4b4f59] sm:mt-6 sm:gap-x-6 sm:gap-y-3 sm:text-sm">
                    <span className="inline-flex items-center gap-2">
                      <ProjectLineIcon kind="location" className="h-[18px] w-[18px]" />
                      {gig.location}
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <ProjectLineIcon kind="calendar" className="h-[18px] w-[18px]" />
                      {gig.postedAt || "Recently posted"}
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <ProjectLineIcon kind="views" className="h-[18px] w-[18px]" />
                      {application?.proposal?.reviewedAt ? "Reviewed recently" : "Active listing"}
                    </span>
                  </div>
                </div>
              </section>

              <section className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  { icon: "location", label: isContentPostingFlow ? "Posting model" : "Project type", value: gig.location },
                  { icon: "duration", label: "Duration", value: gig.workload },
                  { icon: "level", label: "Level", value: projectMeta.expertise || "Open level" },
                ].map((item) => (
                  <div key={item.label} className="flex items-start gap-3 sm:gap-4">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#f6f1e8] text-[#3e6357] sm:h-14 sm:w-14">
                      <ProjectLineIcon kind={item.icon as "location" | "money" | "duration" | "level" | "language" | "chart"} className="h-5 w-5 sm:h-7 sm:w-7" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[0.9rem] font-semibold leading-5 text-[#2c3038] sm:text-[0.95rem] sm:leading-6">{item.label}</div>
                      <div className="mt-0.5 text-[0.95rem] text-[#4a4f58] sm:mt-1 sm:text-[1.05rem]">{item.value}</div>
                    </div>
                  </div>
                ))}
              </section>

              {shouldShowProjectStatusPanel ? (
                <section className="pt-1">
                  <div className="text-[1.75rem] font-semibold tracking-tight text-[#24262d] sm:text-[2rem]">Proposal Status</div>
                  <div className="mt-4 rounded-[1.55rem] border border-[#e7ebef] bg-[linear-gradient(180deg,#ffffff,#fcfcfb)] p-4 shadow-[0_14px_40px_rgba(37,39,45,0.06)] sm:rounded-[1.8rem] sm:p-6">
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-start justify-between gap-3 rounded-[1.45rem] border border-[#e8edf0] bg-[linear-gradient(180deg,#fbfcfd,#f8fafb)] px-4 py-4 sm:px-5">
                        <div>
                          <div className="text-[1.02rem] font-semibold text-[#2c3038]">{projectReviewLabel}</div>
                          <div className="mt-1 text-sm leading-7 text-[#4d5563]">
                            {proposalReviewStatus === "Accepted"
                              ? "Your proposal cleared review. Follow the recruiter instructions below."
                              : hasAdminUpdate
                                ? "Recruiter guidance has been published for this proposal."
                                : "Your proposal is submitted. Recruiter updates will appear here once the review advances."}
                          </div>
                        </div>
                        <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${projectReviewBadgeTone}`}>
                          {proposalReviewStatus ?? "Pending"}
                        </span>
                      </div>
                      <div className="grid gap-3">
                        {application?.proposal?.adminNote?.trim() && (
                          <div className="rounded-[1.25rem] border border-[#e8edf0] bg-white px-4 py-3.5 text-sm leading-7 text-[#4d5563] shadow-sm">
                            <span className="font-semibold text-[#2c3038]">Recruiter note:</span> {application.proposal.adminNote}
                          </div>
                        )}
                        {application?.proposal?.adminExplanation?.trim() && (
                          <div className="rounded-[1.25rem] border border-[#e8edf0] bg-white px-4 py-3.5 text-sm leading-7 text-[#4d5563] shadow-sm">
                            <span className="font-semibold text-[#2c3038]">Next steps:</span> {application.proposal.adminExplanation}
                          </div>
                        )}
                        {application?.proposal?.onboardingSteps?.trim() && (
                          <div className="rounded-[1.25rem] border border-[#e8edf0] bg-white px-4 py-3.5 shadow-sm">
                            <div className="text-sm font-semibold text-[#2c3038]">Onboarding</div>
                            <div className="mt-3">
                              <OnboardingChecklist text={application.proposal.onboardingSteps} />
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
                        {adminWhatsappLink ? (
                          <a
                            href={adminWhatsappLink}
                            target="_blank"
                            rel="noreferrer"
                            className="flex w-full items-center justify-between gap-4 rounded-[1.25rem] border border-[#d6e2da] bg-[linear-gradient(180deg,#ffffff,#f6faf7)] px-4 py-3.5 text-left shadow-[0_10px_24px_rgba(44,84,62,0.08)] transition hover:border-[#c6d7cc] hover:bg-[#f7faf8] sm:px-5 lg:w-auto lg:min-w-[340px]"
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#d9e4db] bg-[#eef6f0] text-[#2f6a4d]">
                                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                                  <path d="M20 12a8 8 0 1 1-14.9-4" />
                                  <path d="M8.7 16.3 6 18l.8-3.1" />
                                  <path d="M9.5 8.8c.3-.5.6-.5.9-.5h.7c.2 0 .5 0 .7.5l.5 1.3c.1.3.1.6-.1.8l-.5.7a.8.8 0 0 0 0 .9c.4.6 1 1.2 1.6 1.6.3.2.6.2.9 0l.7-.5c.3-.2.5-.2.8-.1l1.3.5c.4.2.5.4.5.7v.7c0 .3 0 .6-.5.9-.6.4-1.4.6-2.1.4-1.8-.5-3.5-1.5-4.8-2.9-1.4-1.3-2.4-3-2.9-4.8-.2-.7 0-1.5.4-2.1Z" />
                                </svg>
                              </div>
                              <div className="min-w-0">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#738476]">
                                  WhatsApp onboarding
                                </div>
                                <div className="mt-1 text-[1rem] font-semibold text-[#24342c]">
                                  Open recruiter group link
                                </div>
                              </div>
                            </div>
                            <ProjectLineIcon kind="external" className="h-5 w-5 shrink-0 text-[#738476]" />
                          </a>
                        ) : null}
                        <span className="rounded-full border border-[#e7ebef] bg-white px-3 py-2 text-xs text-[#5d6672]">
                          Submitted {formatCompactRelativeTimestamp(application?.proposal?.submittedAt ?? application?.appliedAt) ?? "recently"}
                        </span>
                        {application?.proposal?.reviewedAt && (
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                            Updated {formatCompactRelativeTimestamp(application.proposal.reviewedAt) ?? "recently"}
                          </span>
                        )}
                      </div>
                      {proposalReviewStatus === "Accepted" && (
                        <div className="overflow-hidden rounded-[1.35rem] border border-[#cfe2d5] bg-[linear-gradient(135deg,#f8fdf8,rgba(240,249,242,0.98))] shadow-[0_12px_30px_rgba(41,88,60,0.08)]">
                          <div className="border-b border-[#d9e8dd] bg-[radial-gradient(circle_at_top_left,rgba(113,183,132,0.16),transparent_46%),linear-gradient(180deg,rgba(255,255,255,0.96),rgba(246,251,247,0.98))] px-4 py-4 sm:px-5">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#738476]">Next round activated</div>
                                <div className="mt-1 text-[1.12rem] font-semibold text-[#264638] sm:text-[1.2rem]">
                                  {isContentPostingFlow ? "Posting workspace handoff is now approved" : "Execution access is now approved"}
                                </div>
                                <div className="mt-1 text-sm leading-7 text-[#587062]">
                                  {isContentPostingFlow
                                    ? "Recruiter approval has cleared your proposal for the daily social posting workspace handoff."
                                    : "Recruiter approval has cleared your proposal for the onboarding and execution stage."}
                                </div>
                              </div>
                              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                                Approval cleared
                              </span>
                            </div>
                          </div>
                          <div className="grid gap-3 px-4 py-4 sm:px-5 sm:py-5 lg:grid-cols-3">
                            <div className="rounded-[1.15rem] border border-[#d7e5da] bg-white px-4 py-3 shadow-sm">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#738476]">Recruiter decision</div>
                              <div className="mt-2 text-base font-semibold text-[#274537]">Approved</div>
                              <div className="mt-1 text-sm text-[#617166]">
                                {application?.proposal?.reviewedAt
                                  ? `Updated ${formatCompactRelativeTimestamp(application.proposal.reviewedAt) ?? "recently"}`
                                  : "Decision published"}
                              </div>
                            </div>
                            <div className="rounded-[1.15rem] border border-[#d7e5da] bg-white px-4 py-3 shadow-sm">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#738476]">Coordination channel</div>
                              <div className="mt-2 text-base font-semibold text-[#274537]">{adminWhatsappLink ? "WhatsApp live" : "Awaiting link"}</div>
                              <div className="mt-1 text-sm text-[#617166]">
                                {adminWhatsappLink ? "Recruiter group link is ready for onboarding." : "Recruiter will share the live onboarding channel here."}
                              </div>
                            </div>
                            <div className="rounded-[1.15rem] border border-[#d7e5da] bg-white px-4 py-3 shadow-sm">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#738476]">Join confirmation</div>
                              <div className="mt-2 text-base font-semibold text-[#274537]">{groupJoinConfirmed ? "Confirmed" : "Action pending"}</div>
                              <div className="mt-1 text-sm text-[#617166]">
                                {groupJoinConfirmed
                                  ? `Joined ${formatCompactRelativeTimestamp(application?.proposal?.groupJoinedConfirmedAt) ?? "recently"}`
                                  : "Confirm after joining the recruiter group to finish onboarding."}
                              </div>
                            </div>
                          </div>
                          {isContentPostingFlow && groupJoinConfirmed && (
                            <div className="border-t border-[#d9e8dd] bg-white px-4 py-4 sm:px-5">
                              <div className="flex flex-col gap-3 rounded-[1.2rem] border border-[#d7e5da] bg-[linear-gradient(180deg,#ffffff,#f7fbf8)] p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#738476]">Workspace assigned</div>
                                  <div className="mt-1 text-base font-semibold text-[#274537]">Daily social posting queue is ready</div>
                                  <div className="mt-1 text-sm text-[#617166]">
                                    Your content posting proposal has cleared onboarding. Open the workspace to receive daily posting tasks, account briefs, and execution checklists.
                                  </div>
                                </div>
                                <Link
                                  href="/workspace"
                                  className="inline-flex items-center justify-center rounded-full bg-[#245543] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1f4a3a]"
                                >
                                  Open workspace
                                </Link>
                              </div>
                            </div>
                          )}
                          <div className="flex flex-col gap-3 border-t border-[#d9e8dd] px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
                            <div className="min-w-0 flex-1">
                              {application?.proposal?.onboardingSteps?.trim() ? (
                                <OnboardingChecklist text={application.proposal.onboardingSteps} />
                              ) : (
                                <div className="text-sm text-[#587062]">
                                  {isContentPostingFlow
                                    ? "Complete recruiter coordination, confirm group participation, and move into the daily posting workspace handoff."
                                    : "Follow recruiter instructions, complete coordination setup, and prepare for execution handoff."}
                                </div>
                              )}
                            </div>
                            <div className="flex flex-col gap-2 sm:flex-row">
                              {adminWhatsappLink && (
                                <a
                                  href={adminWhatsappLink}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center justify-center rounded-full bg-[#245543] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1f4a3a]"
                                >
                                  Open recruiter group
                                </a>
                              )}
                              {!groupJoinConfirmed && adminWhatsappLink && (
                                <button
                                  type="button"
                                  onClick={confirmGroupJoined}
                                  disabled={groupJoinConfirming}
                                  className="inline-flex items-center justify-center rounded-full border border-[#cfe2d5] bg-white px-4 py-2.5 text-sm font-semibold text-[#355548] transition hover:border-[#bdd5c4] hover:bg-[#fbfdfb] disabled:opacity-60"
                                >
                                  {groupJoinConfirming ? "Confirming..." : "Confirm joined"}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                      {adminWhatsappLink && (
                        <div className="rounded-[1.3rem] border border-[#dbe5dc] bg-[linear-gradient(180deg,#ffffff,#f8fbf8)] p-4 shadow-sm sm:px-5 sm:py-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <div className="text-[1.05rem] font-semibold text-[#355548]">Group join confirmation</div>
                              <div className="mt-1 text-sm text-[#5d6672]">
                                Confirm after you join the recruiter WhatsApp group so onboarding can move forward.
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={confirmGroupJoined}
                              disabled={groupJoinConfirming || groupJoinConfirmed}
                              className={`inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-semibold transition ${
                                groupJoinConfirmed
                                  ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border border-[#d7e4d9] bg-[#f3f7f4] text-[#4d6472] hover:border-[#c8d7cb] hover:bg-white disabled:opacity-60"
                              }`}
                            >
                              {groupJoinConfirmed ? "Confirmed" : groupJoinConfirming ? "Confirming..." : "Confirm joined"}
                            </button>
                          </div>
                          {application?.proposal?.groupJoinedConfirmedAt && (
                            <div className="mt-3 text-xs font-medium text-[#6b7770]">
                              Confirmed {formatCompactRelativeTimestamp(application.proposal.groupJoinedConfirmedAt) ?? "recently"}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="rounded-[1.35rem] border border-[#dbe5dc] bg-[linear-gradient(180deg,#fbfdfb,#f6faf5)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] sm:p-5">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#738476]">Onboarding workflow</div>
                        <div className="mt-4 space-y-3">
                          <div className="flex items-center justify-between rounded-2xl border border-[#d8e4db] bg-white px-4 py-3 shadow-sm">
                            <span className="text-sm font-medium text-[#355548]">Proposal submitted</span>
                            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Done</span>
                          </div>
                          <div className="flex items-center justify-between rounded-2xl border border-[#d8e4db] bg-white px-4 py-3 shadow-sm">
                            <span className="text-sm font-medium text-[#355548]">WhatsApp invite issued</span>
                            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${adminWhatsappLink ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                              {adminWhatsappLink ? "Ready" : "Pending"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between rounded-2xl border border-[#d8e4db] bg-white px-4 py-3 shadow-sm">
                            <span className="text-sm font-medium text-[#355548]">Group join confirmation</span>
                            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${groupJoinConfirmed ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                              {groupJoinConfirmed ? "Confirmed" : "Awaiting"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between rounded-2xl border border-[#d8e4db] bg-white px-4 py-3 shadow-sm">
                            <span className="text-sm font-medium text-[#355548]">Final recruiter decision</span>
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                proposalReviewStatus === "Accepted"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {proposalReviewStatus === "Accepted" ? "Approved" : "In review"}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                    {error && (
                      <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</div>
                    )}
                    {success && (
                      <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{success}</div>
                    )}
                  </div>
                </section>
              ) : (
                <section className="pt-1">
                  <div className="text-[1.75rem] font-semibold tracking-tight text-[#24262d] sm:text-[2rem]">{isContentPostingFlow ? "Content Posting Brief" : "Project Description"}</div>
                  {customBrief ? (
                    <div className="mt-4 space-y-4">
                      <FormattedBrief
                        text={customBrief}
                        sectionClassName="space-y-5"
                        headingClassName="text-xl font-semibold text-[#24262d]"
                        bodyClassName="text-[1rem] leading-8 text-[#5f6672] sm:text-[1.08rem] sm:leading-9"
                      />
                    </div>
                  ) : (
                    <p className="mt-4 text-[1rem] leading-8 text-[#5f6672] sm:text-[1.08rem] sm:leading-9">
                      Review the scope, align on deliverables, and submit a proposal with your execution approach and expected timeline.
                    </p>
                  )}
                </section>
              )}

              {customMediaItems.length > 0 && (
                <section className="space-y-3">
                  <div className="flex flex-col gap-3 rounded-[1.6rem] border border-[#e7ece8] bg-[linear-gradient(180deg,#fbfdfb_0%,#f4f8f4_100%)] p-4 shadow-sm sm:flex-row sm:items-end sm:justify-between sm:p-5">
                    <div>
                      <div className="text-[1.55rem] font-semibold tracking-tight text-[#24262d] sm:text-[2rem]">Reference Media</div>
                      <div className="mt-1 max-w-2xl text-sm leading-6 text-[#5f6672]">
                        Review the supplied examples before preparing your proposal. Open any asset to inspect framing, pacing, and visual direction.
                      </div>
                    </div>
                    <div className="inline-flex self-start whitespace-nowrap rounded-full border border-[#d6e1d7] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#6f877d]">
                      {customMediaItems.length} asset{customMediaItems.length === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {customMediaItems.map((url, idx) => (
                      <article
                        key={`${url}-${idx}`}
                        className={`group overflow-hidden rounded-[1.4rem] border border-[#e6ece8] bg-white shadow-[0_14px_34px_rgba(31,79,67,0.08)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgba(31,79,67,0.12)] sm:rounded-[1.7rem] ${
                          customMediaItems.length === 1 ? "md:mx-auto md:w-full md:max-w-[34rem]" : ""
                        }`}
                      >
                        {isImageUrl(url) ? (
                          <div className="relative aspect-[9/11] w-full overflow-hidden bg-[#eef3ef] sm:aspect-[4/5]">
                            <img
                              src={url}
                              alt={`Reference media ${idx + 1}`}
                              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                              loading="lazy"
                            />
                            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/45 via-black/10 to-transparent" />
                          </div>
                        ) : isVideoUrl(url) ? (
                          <div className="relative aspect-[9/11] w-full overflow-hidden bg-[#eef3ef] sm:aspect-[4/5]">
                            <video
                              src={url}
                              autoPlay
                              muted
                              loop
                              playsInline
                              className="h-full w-full scale-[1.05] bg-[#eef3ef] object-cover blur-[3.25px] brightness-[0.86] saturate-[0.92]"
                              preload="metadata"
                            />
                            <button
                              type="button"
                              onClick={() => setActiveReferenceVideo({ url, label: `Reference Asset ${idx + 1}` })}
                              className="absolute inset-0 flex items-center justify-center"
                              aria-label={`Play reference video ${idx + 1}`}
                            >
                              <span className="rounded-full border border-white/35 bg-black/20 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white shadow-[0_12px_28px_rgba(0,0,0,0.18)] backdrop-blur-sm transition hover:bg-black/30 sm:px-4 sm:text-[11px] sm:tracking-[0.18em]">
                                Tap to Play
                              </span>
                            </button>
                            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,transparent_20%,rgba(0,0,0,0.14)_56%,rgba(0,0,0,0.28)_100%)]" />
                            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/48 via-black/16 to-transparent" />
                          </div>
                        ) : (
                          <div className="flex aspect-[4/5] items-center justify-center bg-[linear-gradient(180deg,#f8faf8_0%,#f0f5f1_100%)] p-5 text-sm text-[#425952]">
                            <a
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center justify-center rounded-full border border-[#c9d7ce] bg-white px-4 py-2 font-semibold text-[#1f4f43] transition hover:border-[#9fb7aa]"
                            >
                              Open reference asset
                            </a>
                          </div>
                        )}
                        <div className="border-t border-[#edf2ee] px-4 py-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <div className="text-sm font-semibold text-[#23372f]">Reference Asset {idx + 1}</div>
                              <div className="mt-1 text-xs uppercase tracking-[0.18em] text-[#74877d]">
                                {isImageUrl(url) ? "Image reference" : isVideoUrl(url) ? "Video reference" : "External asset"}
                              </div>
                            </div>
                            <a
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex min-h-10 items-center justify-center rounded-full border border-[#d3ddd6] bg-[#f8faf8] px-4 py-2 text-xs font-semibold text-[#27483c] transition hover:border-[#a8bcb1] hover:bg-white"
                            >
                              Open
                            </a>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )}

              <section id={proposalDeskId} className={`space-y-4 scroll-mt-6 ${shouldShowProjectStatusPanel ? "hidden" : ""}`}>
                <div className="text-[1.75rem] font-semibold tracking-tight text-[#24262d] sm:text-[2rem]">Send Your Proposal</div>
                <div className="rounded-[1.45rem] border border-[#eceef2] bg-white p-4 shadow-sm sm:rounded-[1.7rem] sm:p-6">
                  {!shouldShowProjectStatusPanel && (
                    <>
                      <div className="grid gap-3 lg:grid-cols-2">
                        <label className="text-sm font-semibold text-[#2c3038]">
                          {isContentPostingFlow ? "Your Per Post Price" : "Your Hourly Price"}
                          <input
                            inputMode="decimal"
                            className="mt-3 w-full rounded-2xl border border-[#e7ebef] bg-white px-5 py-4 text-[1.05rem] text-slate-900"
                            placeholder="Price"
                            value={proposalBudget}
                            onChange={(e) => setProposalBudget(e.target.value)}
                          />
                        </label>
                        <label className="text-sm font-semibold text-[#2c3038]">
                          {isContentPostingFlow ? "Accounts You Can Manage" : "Estimated Hours"}
                          <input
                            inputMode="numeric"
                            className="mt-3 w-full rounded-2xl border border-[#e7ebef] bg-white px-5 py-4 text-[1.05rem] text-slate-900"
                            placeholder={isContentPostingFlow ? "5" : "4"}
                            value={proposalTimeline}
                            onChange={(e) => setProposalTimeline(e.target.value)}
                          />
                        </label>
                      </div>
                      <label className="mt-5 block text-sm font-semibold text-[#2c3038]">
                        Cover Letter
                        <textarea
                          className="mt-3 h-56 w-full rounded-2xl border border-[#e7ebef] bg-white px-5 py-4 text-[1.02rem] leading-8 text-slate-900"
                          placeholder="Share why you are the right fit, how you would execute the work, and what outcome the client can expect."
                          value={proposalPitch}
                          onChange={(e) => setProposalPitch(e.target.value)}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={submitCustomProposal}
                        disabled={proposalSaving}
                        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#77c07d] px-5 py-4 text-[1.05rem] font-semibold text-white transition hover:bg-[#67b56e] disabled:opacity-50 sm:w-auto sm:min-w-[220px]"
                      >
                        {proposalSaving ? "Submitting..." : "Submit a Proposal"} <ProjectLineIcon kind="external" className="h-4 w-4" />
                      </button>
                    </>
                  )}

                  {error && (
                    <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</div>
                  )}
                  {success && (
                    <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{success}</div>
                  )}
                </div>
              </section>

              {customRequirementItems.length > 0 && !shouldShowProjectStatusPanel && (
                <section className="space-y-3">
                  <div className="text-[1.75rem] font-semibold tracking-tight text-[#24262d] sm:text-[2rem]">{isContentPostingFlow ? "Posting Requirements" : "Project Requirements"}</div>
                  <div className="grid gap-3">
                    {customRequirementItems.map((req, idx) => (
                      <div key={`${req}-${idx}`} className="rounded-2xl border border-[#eceef2] bg-white px-4 py-3 text-[1rem] leading-7 text-[#4d5563] shadow-sm">
                        <span className="font-semibold text-[#2c3038]">{idx + 1}.</span> {req}
                      </div>
                    ))}
                  </div>
                </section>
              )}

            </div>

            <aside className="space-y-4 sm:space-y-6 lg:sticky lg:top-6 lg:self-start">
              <section className="rounded-[1.45rem] border border-[#e8ebf0] bg-white p-5 shadow-sm sm:rounded-[1.7rem] sm:p-6">
                <div className="text-[2.45rem] font-semibold tracking-tight text-[#24262d] sm:text-[3rem]">{gig.payout}</div>
                <div className="mt-1 text-[1rem] text-[#4d5563] sm:text-[1.1rem]">{gig.payoutType} rate</div>
                <button
                  className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-[#77c07d] px-5 py-3.5 text-[1rem] font-semibold text-white transition hover:bg-[#67b56e] disabled:opacity-50 sm:mt-7 sm:py-4 sm:text-[1.05rem]"
                  onClick={() => document.getElementById(proposalDeskId)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  disabled={hasApplication && proposalReviewStatus !== "Rejected"}
                >
                  {hasApplication && proposalReviewStatus !== "Rejected" ? "Proposal submitted" : "Go to proposal form"}
                </button>
              </section>

              <section className="rounded-[1.45rem] border border-[#e8ebf0] bg-white p-5 shadow-sm sm:rounded-[1.7rem] sm:p-6">
                <div className="text-[1.7rem] font-semibold tracking-tight text-[#24262d] sm:text-[2rem]">About Seller</div>
                <div className="mt-5 flex items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#f7faf8] text-2xl font-bold text-[#1f4f43]">
                    {gig.company.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-[1.4rem] font-semibold text-[#24262d]">{gig.company}</div>
                    <div className="text-sm text-[#4d5563]">{gig.platform} hiring project</div>
                    <div className="mt-1 text-sm font-medium text-[#5d6672]">
                      {application?.proposal?.reviewedAt ? `Updated ${new Date(application.proposal.reviewedAt).toLocaleDateString()}` : "Verified listing"}
                    </div>
                  </div>
                </div>
                <div className="mt-5 border-t border-[#eceef2] pt-5" />
                <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
                  <div>
                    <div className="font-semibold text-[#2c3038]">Location</div>
                    <div className="mt-1 text-[#4d5563]">{gig.location}</div>
                  </div>
                  <div>
                    <div className="font-semibold text-[#2c3038]">Platform</div>
                    <div className="mt-1 text-[#4d5563]">{gig.platform}</div>
                  </div>
                  <div>
                    <div className="font-semibold text-[#2c3038]">Categories</div>
                    <div className="mt-1 text-[#4d5563]">{isContentPostingFlow ? "Content Posting" : "Project"}</div>
                  </div>
                </div>
              </section>

              {adminWhatsappLink ? (
                <a
                  href={adminWhatsappLink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-[#77c07d] bg-white px-5 py-3.5 text-[1rem] font-semibold text-[#77c07d] transition hover:bg-[#f7fcf7] sm:py-4 sm:text-[1.05rem]"
                >
                  {sellerActionLabel} <ProjectLineIcon kind="external" className="h-4 w-4" />
                </a>
              ) : (
                <a
                  href="mailto:support@reelencer.com?subject=Project%20Query"
                  className="flex w-full items-center justify-between gap-4 rounded-[1.3rem] border border-[#d9e1dc] bg-[#f7faf8] px-4 py-4 text-[#24303b] shadow-sm transition hover:border-[#c6d0ca] hover:bg-[#f3f7f4] sm:rounded-[1.55rem] sm:px-5 sm:py-5"
                >
                  <div className="flex min-w-0 items-center gap-4">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[#e1e7e2] bg-white text-[#7a869d] shadow-sm sm:h-16 sm:w-16">
                      <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                        <path d="M4 7h16v10H4z" />
                        <path d="m5 8 7 6 7-6" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-[#6d7b8f] sm:text-[0.8rem]">
                        Contact Support
                      </div>
                      <div className="mt-1 text-[0.92rem] text-[#5b6672] sm:text-[0.98rem]">
                        For project questions or account help
                      </div>
                      <div className="mt-1 truncate text-[1.08rem] font-semibold tracking-tight text-[#1f2740] sm:text-[1.16rem]">
                        support@reelencer.com
                      </div>
                    </div>
                  </div>
                  <ProjectLineIcon kind="external" className="h-6 w-6 shrink-0 text-[#7a869d] sm:h-7 sm:w-7" />
                </a>
              )}
            </aside>
          </div>
        )}

        {!isCustomFlow && !isProjectStyleFlow && !isEmailCreatorFlow && !hasApplication && (
          <div className="rounded-[1.4rem] border border-[#c4d5cb] bg-[radial-gradient(circle_at_top_left,rgba(86,146,118,0.16),transparent_42%),linear-gradient(180deg,#f3f8f3,#edf4ee)] p-3 shadow-[0_26px_55px_rgba(24,64,49,0.14)] backdrop-blur sm:rounded-3xl sm:p-6">
            <div className="grid gap-3 sm:gap-5 lg:grid-cols-[1.85fr_0.95fr]">
              <article className="rounded-[1.2rem] border border-[#d5e2da] bg-white p-4 sm:rounded-2xl sm:p-6">
                <h2 className="text-lg font-semibold tracking-[0.03em] text-[#6f7c95]">Project overview</h2>
                <div className="mt-2.5 flex flex-wrap items-center gap-3 text-[0.98rem] text-[#6c7686] sm:mt-3 sm:text-sm">
                  <span>{gig?.postedAt || "Recently posted"}</span>
                  <span className="h-1 w-1 rounded-full bg-[#b5bfcc]" />
                  <span>{gig?.location}</span>
                </div>

                <div className="mt-4 border-t border-[#e5ece9] pt-4 sm:mt-5 sm:pt-5">
                  <h3 className="text-[2.05rem] font-semibold leading-[1.06] tracking-tight text-[#1d2a3f] sm:text-4xl">Project brief</h3>
                  {customBrief ? (
                    <div className="mt-4 rounded-[1.2rem] border border-[#d9e4de] bg-[#f7fbf8] px-4 py-4 sm:px-5">
                      <FormattedBrief
                        text={customBrief}
                        sectionClassName="space-y-4"
                        headingClassName="text-[1.1rem] font-semibold tracking-[0.01em] text-[#1d2a3f] sm:text-[1.18rem]"
                        bodyClassName="text-[1.02rem] leading-8 text-[#27324a] sm:text-base"
                      />
                    </div>
                  ) : (
                    <p className="mt-3 text-[1.02rem] leading-8 text-[#27324a] sm:text-base">
                      In this project, you will execute an outcome-focused delivery plan aligned with Reelencer quality standards, timeline discipline, and transparent reporting requirements.
                    </p>
                  )}
                </div>

                <div className="mt-6 sm:mt-7">
                  <div className="text-[1.85rem] font-semibold tracking-tight text-[#1d2a3f] sm:text-2xl">Responsibilities</div>
                  <div className="mt-3.5 space-y-3 sm:mt-4">
                    {standardRequirementItems.map((req, idx) => (
                        <div key={`${req}-${idx}`} className="flex items-start gap-3 text-[#27324a]">
                          <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#49b86b] text-xs font-bold text-white">
                            ✓
                          </span>
                          <span className="text-[1.03rem] leading-7">{String(req).replace(/^brief::/i, "")}</span>
                        </div>
                    ))}
                    {standardRequirementItems.length === 0 && (
                      <div className="rounded-xl border border-[#d9e4de] bg-[#f7fbf8] px-3 py-2 text-sm text-[#5f6f66]">
                        Detailed responsibilities will be shared by operations after proposal review.
                      </div>
                    )}
                  </div>
                </div>
              </article>

              <aside className="rounded-[1.2rem] border border-[#d5e2da] bg-white p-4 sm:rounded-2xl sm:p-6">
                <div className="inline-flex rounded-full border border-[#8bb4f0]/35 bg-[#dbe9ff] px-3 py-1 text-xs font-semibold text-[#2f68c6]">
                  {isWorkspaceFlow ? "Workspace project" : "Email creator project"}
                </div>
                <div className="mt-4 text-[2.3rem] font-semibold leading-none tracking-tight text-[#1d2a3f] sm:mt-5 sm:text-4xl">{gig?.payout}</div>
                <div className="mt-1 text-sm text-[#6a7284]">{gig?.payoutType}</div>

                <div className="mt-6 border-t border-[#e5ece9] pt-5 sm:mt-7 sm:pt-6">
                  <div className="text-xl font-semibold tracking-tight text-[#1d2a3f]">Project requirements</div>
                  <div className="mt-4 space-y-3 text-sm">
                    <div className="rounded-xl border border-[#d9e4de] bg-[#f7fbf8] px-3 py-2">
                      <div className="text-[#6a7284]">Hiring capacity</div>
                      <div className="font-semibold text-[#1f2a41]">{projectMeta.hiring_capacity || "1 creator"}</div>
                    </div>
                    <div className="rounded-xl border border-[#d9e4de] bg-[#f7fbf8] px-3 py-2">
                      <div className="text-[#6a7284]">Expertise</div>
                      <div className="font-semibold text-[#1f2a41]">{projectMeta.expertise || "Mid level"}</div>
                    </div>
                    <div className="rounded-xl border border-[#d9e4de] bg-[#f7fbf8] px-3 py-2">
                      <div className="text-[#6a7284]">Languages</div>
                      <div className="font-semibold text-[#1f2a41]">{projectMeta.languages || "English"}</div>
                    </div>
                    <div className="rounded-xl border border-[#d9e4de] bg-[#f7fbf8] px-3 py-2">
                      <div className="text-[#6a7284]">Engagement mode</div>
                      <div className="font-semibold text-[#1f2a41]">{gig?.location}</div>
                    </div>
                  </div>
                </div>

                <button
                  className="mt-6 w-full rounded-full bg-[#1f4f43] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#2d6b5a] disabled:opacity-50"
                  onClick={submitStandardProposal}
                  disabled={proposalSaving}
                >
                  {proposalSaving ? (isEmailCreatorFlow ? "Activating access..." : "Sending proposal...") : isEmailCreatorFlow ? "Activate work access" : "Send proposal"}
                </button>
              </aside>
            </div>
          </div>
        )}

        {!isCustomFlow && !isProjectStyleFlow && !isEmailCreatorFlow && hasApplication && !canAccessOperations && onboardingRequired && (
          <div className="rounded-3xl border border-[#c9d8cf] bg-[radial-gradient(circle_at_top_right,rgba(136,184,160,0.12),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.96),rgba(247,251,245,0.96))] p-4 shadow-xl shadow-[#c8d5c7]/55 backdrop-blur sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6f877d]">Proposal Desk</div>
                <div className="mt-1 text-2xl font-semibold tracking-tight text-[#1c3e33]">
                  {proposalReviewStatus === "Rejected" ? "Revision Requested" : "Proposal Under Review"}
                </div>
                <div className="mt-2 max-w-2xl text-sm leading-relaxed text-[#4d665c]">
                  {proposalReviewStatus === "Rejected"
                    ? "Your proposal did not clear pre-screening. Review the notes below and submit a stronger revision."
                    : "Your proposal is currently in pre-screening. Operations will publish a decision for the next onboarding stage."}
                </div>
              </div>
              <span className="inline-flex rounded-full border border-[#bcd6c9] bg-[#edf5ef] px-3 py-1 text-xs font-semibold text-[#2f6655]">
                {proposalReviewStatus === "Rejected" ? "Revision Required" : "In Queue"}
              </span>
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-[1.45fr_0.95fr]">
              <div className="space-y-3">
                <div className="rounded-xl border border-[#d4dfd7] bg-white px-3 py-2 text-sm text-[#355d50]">
                  <span className="font-semibold text-[#294b40]">Note:</span>{" "}
                  {application?.proposal?.adminNote?.trim() || "No note has been published yet."}
                </div>
                <div className="rounded-xl border border-[#d4dfd7] bg-white px-3 py-2 text-sm text-[#355d50]">
                  <span className="font-semibold text-[#294b40]">Guidance:</span>{" "}
                  {application?.proposal?.adminExplanation?.trim() || "Detailed guidance will be shared after the initial review."}
                </div>
                <div className="rounded-xl border border-[#d4dfd7] bg-white px-3 py-3 text-sm text-[#355d50]">
                  <div className="font-semibold text-[#294b40]">WhatsApp Onboarding</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {adminWhatsappLink ? (
                      <a
                        href={adminWhatsappLink}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center rounded-full border border-[#bcd6c9] bg-[#edf5ef] px-4 py-1.5 text-xs font-semibold text-[#1f4f43] hover:bg-[#e2f0e7]"
                      >
                        Open Onboarding Group
                      </a>
                    ) : (
                      <span className="text-xs text-[#6f877d]">
                        {application?.proposal?.whatsappLink
                        ? "The link format is invalid. Please request a valid WhatsApp invite URL."
                        : "The group link will be shared after review."}
                    </span>
                  )}
                </div>
                {adminWhatsappLink && proposalReviewStatus !== "Rejected" && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={confirmGroupJoined}
                        disabled={groupJoinConfirming || groupJoinConfirmed}
                        className={`inline-flex items-center rounded-full px-4 py-1.5 text-xs font-semibold ${
                          groupJoinConfirmed
                            ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border border-[#bcd6c9] bg-[#1f4f43] text-white hover:bg-[#2d6b5a] disabled:opacity-60"
                        }`}
                      >
                        {groupJoinConfirmed ? "Group Joined" : groupJoinConfirming ? "Confirming..." : "Confirm Group Joined"}
                      </button>
                      {application?.proposal?.groupJoinedConfirmedAt && (
                        <span className="text-[11px] text-[#6f877d]">
                          Confirmed {new Date(application.proposal.groupJoinedConfirmedAt).toLocaleString()}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="rounded-xl border border-[#d4dfd7] bg-white px-3 py-3 text-sm text-[#355d50]">
                  <div className="font-semibold text-[#294b40]">Next Steps</div>
                  <div className="mt-3">
                    {application?.proposal?.onboardingSteps?.trim() ? (
                      <OnboardingChecklist text={application.proposal.onboardingSteps} />
                    ) : (
                      <div className="text-sm leading-7 text-[#355d50]">
                        Complete WhatsApp onboarding, confirm group participation, then wait for the final admin decision.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <aside className="rounded-2xl border border-[#d4dfd7] bg-white p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6f877d]">Onboarding workflow</div>
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex items-center justify-between rounded-lg border border-[#d4dfd7] bg-[#f7fbf5] px-3 py-2">
                    <span className="text-[#355d50]">Proposal submitted</span>
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Done</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-[#d4dfd7] bg-[#f7fbf5] px-3 py-2">
                    <span className="text-[#355d50]">WhatsApp invite issued</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${adminWhatsappLink ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                      {adminWhatsappLink ? "Ready" : "Pending"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-[#d4dfd7] bg-[#f7fbf5] px-3 py-2">
                    <span className="text-[#355d50]">Group join confirmation</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${groupJoinConfirmed ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                      {groupJoinConfirmed ? "Confirmed" : "Awaiting"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-[#d4dfd7] bg-[#f7fbf5] px-3 py-2">
                    <span className="text-[#355d50]">Final admin decision</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      proposalReviewStatus === "Rejected"
                        ? "bg-rose-50 text-rose-700"
                        : "bg-slate-100 text-slate-600"
                    }`}>
                      {proposalReviewStatus === "Rejected"
                        ? "Revision"
                        : "In review"}
                    </span>
                  </div>
                </div>
              </aside>
            </div>

            <div className="mt-3 text-[11px] text-[#6f877d]">
              {application?.proposal?.reviewedAt
                ? `Updated: ${new Date(application.proposal.reviewedAt).toLocaleString()}`
                : `Submitted: ${new Date(application?.appliedAt ?? Date.now()).toLocaleString()}`}
            </div>
          </div>
        )}

        {!isCustomFlow && !isProjectStyleFlow && !isEmailCreatorFlow && hasApplication && !canAccessOperations && !onboardingRequired && (
          <div className="rounded-3xl border border-[#c9d8cf] bg-[radial-gradient(circle_at_top_right,rgba(136,184,160,0.12),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.96),rgba(247,251,245,0.96))] p-4 shadow-xl shadow-[#c8d5c7]/55 backdrop-blur sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6f877d]">Proposal Desk</div>
                <div className="mt-1 text-2xl font-semibold tracking-tight text-[#1c3e33]">
                  {proposalReviewStatus === "Rejected" ? "Revision Requested" : "Proposal Under Review"}
                </div>
                <div className="mt-2 max-w-2xl text-sm leading-relaxed text-[#4d665c]">
                  {proposalReviewStatus === "Rejected"
                    ? "Your proposal did not pass review. Please update your submission based on the feedback below."
                    : "Your proposal is in admin review. You will receive the final decision and next actions here."}
                </div>
              </div>
              <span className="inline-flex rounded-full border border-[#bcd6c9] bg-[#edf5ef] px-3 py-1 text-xs font-semibold text-[#2f6655]">
                {proposalReviewStatus === "Rejected" ? "Revision Required" : "In Queue"}
              </span>
            </div>
            {hasAdminUpdate && (
              <div className="mt-4 space-y-3">
                {application?.proposal?.adminNote?.trim() && (
                  <div className="rounded-xl border border-[#d4dfd7] bg-white px-3 py-2 text-sm text-[#355d50]">
                    <span className="font-semibold text-[#294b40]">Note:</span> {application.proposal.adminNote}
                  </div>
                )}
                {application?.proposal?.adminExplanation?.trim() && (
                  <div className="rounded-xl border border-[#d4dfd7] bg-white px-3 py-2 text-sm text-[#355d50]">
                    <span className="font-semibold text-[#294b40]">Guidance:</span> {application.proposal.adminExplanation}
                  </div>
                )}
              </div>
            )}
            {!hasAdminUpdate && (
              <div className="mt-4 rounded-xl border border-[#d4dfd7] bg-white px-3 py-2 text-sm text-[#355d50]">
                No additional instructions were published yet.
              </div>
            )}
            <div className="mt-3 text-[11px] text-[#6f877d]">
              {application?.proposal?.reviewedAt
                ? `Updated: ${new Date(application.proposal.reviewedAt).toLocaleString()}`
                : `Submitted: ${new Date(application?.appliedAt ?? Date.now()).toLocaleString()}`}
            </div>
          </div>
        )}

        {!isCustomFlow && !isProjectStyleFlow && !isEmailCreatorFlow && hasApplication && proposalReviewStatus === "Accepted" && kycRequiredForGig && (
          <div className="rounded-3xl border border-[#b9d7c6] bg-[radial-gradient(circle_at_top_right,rgba(138,225,95,0.22),transparent_44%),linear-gradient(180deg,#f8fdf7,#edf7f0)] p-4 shadow-xl shadow-[#c8d5c7]/55 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4b725f]">
                  {onboardingRequired ? "Offer Update" : "Project Access Update"}
                </div>
                <div className="mt-1 text-2xl font-semibold tracking-tight text-[#173e31]">
                  {onboardingRequired ? "Congratulations, your proposal is approved." : "Congratulations, your proposal is approved and activated."}
                </div>
                <div className="mt-2 max-w-2xl text-sm leading-relaxed text-[#355d50]">
                  {onboardingRequired
                    ? "Your proposal has cleared final review. Welcome to the next stage of Reelencer operations."
                    : "Your proposal has cleared final review. You can now move directly to your project execution workflow."}
                </div>
              </div>
              <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                {onboardingRequired ? "Offer Issued" : "Access Granted"}
              </span>
            </div>
            <div className="mt-4 rounded-2xl border border-[#cfe3d7] bg-white px-4 py-3 text-sm text-[#355d50]">
              <span className="font-semibold text-[#284b40]">Next Action:</span>{" "}
              {onboardingRequired
                ? "Complete onboarding handoff, then begin execution from your assigned workflow panel."
                : "Start execution from your assigned workflow panel."}
            </div>
          </div>
        )}

        {!isCustomFlow && !isProjectStyleFlow && hasApplication && isWorkspaceFlow && canAccessOperations && (
          <div className="rounded-3xl border border-[#cfdbc8] bg-white/90 p-6 shadow-xl shadow-[#c8d5c7]/55 backdrop-blur">
            <div className="text-sm font-semibold text-[#1c3e33]">Offer accepted: Workspace access active</div>
            <div className="mt-2 text-sm text-[#4d665c]">
              Your pre-approval is confirmed. Continue to workspace to start operations and complete assigned tasks.
            </div>
            <Link
              href="/workspace"
              className="mt-4 inline-flex rounded-full border border-[#bcd6c9] bg-[#edf5ef] px-4 py-2 text-sm font-semibold text-[#2f6655] hover:bg-[#e2f0e7]"
            >
              Go to workspace
            </Link>
          </div>
        )}

        {!isCustomFlow && !isProjectStyleFlow && !isEmailCreatorFlow && hasApplication && !isWorkspaceFlow && canAccessOperations && (
        <>
        <div className="rounded-3xl border border-[#cfdbc8] bg-white/90 p-6 shadow-xl shadow-[#c8d5c7]/55 backdrop-blur">
          <div className="text-sm font-semibold text-slate-900">
            {isEmailCreatorFlow ? "Work access active: Assigned dashboard emails (5)" : "Offer accepted: Assigned dashboard emails (5)"}
          </div>
          <div className="mt-2 text-sm text-slate-600">
            {isEmailCreatorFlow
              ? "Your access is active. Use these five emails to create the five Twitter accounts. Each email must be used once."
              : "Your pre-approval is complete. Use these five emails to create the five Twitter accounts. Each email must be used once."}
          </div>
          <div className="mt-2 text-xs">
            <Link href="/work-email-creator" className="font-semibold text-[#1f4f43] hover:text-[#2d6b5a]">
              Need custom emails? Open Work Email Creator (secret code required)
            </Link>
          </div>

          <div className="mt-4 rounded-2xl border border-[#bcd6c9] bg-[#edf5ef] px-4 py-3 text-sm font-semibold text-[#2f6655]">
            {assignment?.assignedEmails?.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {assignment.assignedEmails.map((email) => (
                  <button
                    key={email}
                    className={`inline-flex w-full items-center justify-center rounded-full border px-3 py-2 text-[11px] sm:text-xs ${
                      copiedEmail === email
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-[#bcd6c9] bg-white text-[#2f6655] hover:border-[#9ec3b2]"
                    }`}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(email);
                        setCopiedEmail(email);
                        window.setTimeout(() => setCopiedEmail((prev) => (prev === email ? null : prev)), 1200);
                      } catch {
                        // ignore
                      }
                    }}
                    type="button"
                    title="Click to copy"
                  >
                    <span className="truncate">{copiedEmail === email ? "Copied" : email}</span>
                  </button>
                ))}
              </div>
            ) : (
              assignment?.assignedEmail ?? (loading ? "Assigning email..." : "Email not available")
            )}
          </div>

          <div className="mt-4 rounded-2xl border border-[#cfdbc8] bg-[#f4f8f1] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Inbox</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {filteredInbox.length > 0 ? `${filteredInbox.length} messages` : "No messages yet"}
                  {unreadCount > 0 && (
                    <span className="ml-2 rounded-full border border-[#bcd6c9] bg-[#edf5ef] px-2 py-0.5 text-[11px] text-[#2f6655]">
                      {unreadCount} unread
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                {assignedList.length > 0 && (
                  <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Filter</span>
                    <select
                      className="bg-transparent text-xs font-semibold text-slate-700 outline-none"
                      value={emailFilter}
                      onChange={(e) => setEmailFilter(e.target.value)}
                    >
                      <option value="all">All assigned</option>
                      {assignedList.map((email) => (
                        <option key={email} value={email}>
                          {email}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:border-slate-300 disabled:opacity-50"
                    disabled={unreadCount === 0}
                    onClick={markAllRead}
                    type="button"
                  >
                    Mark read (filtered)
                  </button>
                  <button
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:border-slate-300 disabled:opacity-50"
                    disabled={inbox.filter((m) => !m.readAt && !m.read_at).length === 0}
                    onClick={markAllReadAll}
                    type="button"
                  >
                    Mark read (all)
                  </button>
                </div>
                <span>Auto-sync</span>
                <button
                  className={`h-6 w-11 rounded-full border px-1 ${
                    autoSync ? "border-emerald-200 bg-emerald-100" : "border-slate-300 bg-slate-100"
                  }`}
                  onClick={() => setAutoSync((v) => !v)}
                >
                  <span className={`block h-4 w-4 rounded-full bg-white shadow transition ${autoSync ? "translate-x-4" : "translate-x-0"}`} />
                </button>
                {lastSyncAt && <span>Last sync {lastSyncAt}</span>}
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
              <div className="rounded-2xl border border-slate-200 bg-white/80 p-2 shadow-[0_10px_30px_-20px_rgba(15,23,42,0.6)]">
                <div className="max-h-[320px] overflow-auto">
                  {filteredInbox
                    .slice()
                    .sort((a, b) => {
                      const aTime = new Date(a.createdAt ?? a.created_at ?? 0).getTime();
                      const bTime = new Date(b.createdAt ?? b.created_at ?? 0).getTime();
                      return bTime - aTime;
                    })
                    .slice(0, 10)
                    .map((msg) => {
                      const created = msg.createdAt ?? msg.created_at ?? null;
                      const subject = msg.subject ?? "Verification";
                      const body = msg.body ?? "";
                      const isActive = selectedMsg?.id === msg.id;
                      const isUnread = !msg.readAt && !msg.read_at;
                      const toEmail = msg.toEmail ?? msg.to_email ?? "";

                      return (
                        <button
                          key={msg.id}
                          className={`mb-2 w-full rounded-xl border px-3 py-2 text-left text-xs transition ${
                            isActive
                              ? "border-[#bcd6c9] bg-gradient-to-r from-[#edf5ef] to-white text-[#244f42]"
                              : "border-transparent bg-transparent text-slate-700 hover:border-slate-200 hover:bg-slate-50"
                          }`}
                          onClick={() => {
                            setSelectedMsg(msg);
                            markRead(msg);
                          }}
                          type="button"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span
                                className={`h-2 w-2 rounded-full ${
                                  isUnread ? "bg-[#2f6655]" : isActive ? "bg-[#9ec3b2]" : "bg-slate-200"
                                }`}
                              />
                              <div className="font-semibold">{subject}</div>
                            </div>
                            {created && <div className="text-[10px] text-slate-500">{new Date(created).toLocaleString()}</div>}
                          </div>
                          {toEmail && <div className="mt-1 text-[10px] text-slate-400">{toEmail}</div>}
                          <div className="mt-1 text-slate-500">{cleanInboxBody(String(body))}</div>
                        </button>
                      );
                    })}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_20px_50px_-35px_rgba(15,23,42,0.6)]">
                {selectedMsg ? (
                  <>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">
                          {selectedMsg.subject ?? "Verification"}
                        </div>
                        {(selectedMsg.createdAt || selectedMsg.created_at) && (
                          <div className="mt-1 text-xs text-slate-500">
                            {new Date(selectedMsg.createdAt ?? selectedMsg.created_at).toLocaleString()}
                          </div>
                        )}
                        {(selectedMsg.toEmail || selectedMsg.to_email) && (
                          <div className="mt-1 text-xs text-slate-400">
                            {selectedMsg.toEmail ?? selectedMsg.to_email}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {(selectedMsg.readAt || selectedMsg.read_at) && (
                          <button
                            className="rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold text-slate-700 hover:border-slate-400"
                            onClick={() => markUnread(selectedMsg)}
                            type="button"
                          >
                            Mark unread
                          </button>
                        )}
                        <button
                          className="rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold text-slate-700 hover:border-slate-400"
                          onClick={() => setSelectedMsg(null)}
                          type="button"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 max-h-[320px] overflow-auto whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                      {String(selectedMsg.body ?? "")}
                    </div>

                    {(selectedMsg.otpCode || selectedMsg.otp_code) && (
                      <div className="mt-3 inline-flex rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                        OTP: {selectedMsg.otpCode ?? selectedMsg.otp_code}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex h-full min-h-[200px] items-center justify-center text-xs text-slate-500">
                    Select an email to view the full message.
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-emerald-400" />
                <span>Live routing via Cloudflare</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400 disabled:opacity-60"
                  disabled={!assignment?.id || polling}
                  onClick={() => {
                    void refreshInbox();
                  }}
                >
                  {polling ? "Syncing..." : "Refresh inbox"}
                </button>

                <button
                  className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 hover:border-amber-300 disabled:opacity-60"
                  disabled={!assignment?.id || refreshing}
                  onClick={() => {
                    void forceRefreshInbox();
                  }}
                >
                  {refreshing ? "Refreshing..." : "Force refresh"}
                </button>
              </div>
            </div>
          </div>
        </div>

        

        <div className="rounded-3xl border border-[#cfdbc8] bg-white/90 p-6 shadow-xl shadow-[#c8d5c7]/55 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">Submit 5 account credentials</div>
              <div className="text-xs text-slate-500">Admin will review and accept/reject after compliance checks.</div>
            </div>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">Required: 5</span>
          </div>

          {credentialSubmissionLocked ? (
            credentialReviewPanel
          ) : (
            <div className="mt-5 grid gap-3">
              {rows.map((row, idx) => (
                <div key={idx} className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-4">
                  <input
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    placeholder={`@handle ${idx + 1}`}
                    value={row.handle}
                    onChange={(e) => {
                      const value = e.target.value;
                      setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, handle: value } : r)));
                    }}
                  />
                  <input
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    placeholder="Email used"
                    value={row.email}
                    onChange={(e) => {
                      const value = e.target.value;
                      setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, email: value } : r)));
                    }}
                  />
                  <input
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    placeholder="Password"
                    value={row.password}
                    onChange={(e) => {
                      const value = e.target.value;
                      setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, password: value } : r)));
                    }}
                  />
                  <input
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    placeholder="Phone (optional)"
                    value={row.phone}
                    onChange={(e) => {
                      const value = e.target.value;
                      setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, phone: value } : r)));
                    }}
                  />
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
              {error}
            </div>
          )}

          {success && success !== CREDENTIAL_SUCCESS_MESSAGE && (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
              {success}
            </div>
          )}

          {!credentialSubmissionLocked && credentialReviewBanner}

          {!credentialSubmissionLocked && (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-slate-500">All fields are encrypted in transit. Do not reuse credentials.</div>
              <button
                className="rounded-full bg-[#1f4f43] px-5 py-2 text-sm font-semibold text-white hover:bg-[#2d6b5a] disabled:opacity-50"
                onClick={submitCredentials}
                disabled={saving || invalidRows || credentialSubmissionLocked}
              >
                {saving ? "Submitting..." : credentialSubmissionLocked ? "Submitted for admin review" : "Submit for verification"}
              </button>
            </div>
          )}
        </div>
        </>
        )}
      </main>
    </div>
  );
}

export default function ProceedPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#eef4ea]" />}>
      <ProceedPageInner />
    </Suspense>
  );
}

"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

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

type CredentialRow = {
  handle: string;
  email: string;
  password: string;
  phone: string;
};

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
  if (raw === "workspace" || raw === "full-time" || raw === "full time" || raw === "fulltime") return false;
  return true;
}

function isEmailCreatorGig(gig: Pick<Gig, "gigType">) {
  const raw = String(gig.gigType ?? "")
    .trim()
    .toLowerCase();
  return raw === "" || raw === "email creator" || raw === "part-time" || raw === "part time";
}

function customTypeLabel(raw?: string) {
  const value = String(raw ?? "").trim();
  if (!value) return "Independent Project";
  const cleaned = value.replace(/^custom:\s*/i, "").trim();
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

const LS_KEYS = { AUTH: "igops:auth" } as const;

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

const emptyRows = () =>
  new Array(5).fill(null).map(() => ({ handle: "", email: "", password: "", phone: "" }));

function ProceedPageInner() {
  const searchParams = useSearchParams();
  const gigId = searchParams.get("gigId");

  const [session, setSession] = useState<AuthSession | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [gig, setGig] = useState<Gig | null>(null);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [application, setApplication] = useState<GigApplication | null>(null);
  const [applicationStatus, setApplicationStatus] = useState<string | null>(null);

  const [rows, setRows] = useState<CredentialRow[]>(emptyRows());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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

  const pollingRef = React.useRef(false);

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
        if (match && isCustomGigType(match)) {
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
        if (!status) {
          setLoading(false);
          return;
        }
        if (isWorkspaceGig(match)) {
          setLoading(false);
          return;
        }
        const reviewStatus = String(matchApp?.proposal?.reviewStatus ?? "").trim();
        const isApproved = reviewStatus === "Accepted" || status === "Accepted";
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

  const isCustomFlow = useMemo(() => (gig ? isCustomGigType(gig) : false), [gig]);
  const isWorkspaceFlow = useMemo(() => (gig ? isWorkspaceGig(gig) : false), [gig]);
  const isEmailCreatorFlow = useMemo(() => (gig ? isEmailCreatorGig(gig) : false), [gig]);
  const proposalReviewStatus = useMemo(() => {
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
  const canAccessOperations = isProposalApproved || !!assignment;
  const hasAdminUpdate = useMemo(
    () =>
      !!(
        application?.proposal?.adminNote?.trim() ||
        application?.proposal?.adminExplanation?.trim() ||
        application?.proposal?.whatsappLink?.trim()
      ),
    [application?.proposal?.adminExplanation, application?.proposal?.adminNote, application?.proposal?.whatsappLink]
  );
  const adminWhatsappLink = useMemo(() => {
    const raw = application?.proposal?.whatsappLink?.trim() ?? "";
    if (!raw) return null;
    return /^https?:\/\//i.test(raw) ? raw : null;
  }, [application?.proposal?.whatsappLink]);
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
        return !lower.startsWith("brief::") && !lower.startsWith("media::");
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

  // Auto-sync poller
  useEffect(() => {
    if (!assignment?.id || !autoSync) return;

    let alive = true;

    const run = async () => {
      if (!alive || pollingRef.current) return;
      pollingRef.current = true;

      try {
        const inboxRes = await fetch(`/api/gig-inbox?assignmentId=${encodeURIComponent(assignment.id)}`);
        const inboxData = inboxRes.ok ? await inboxRes.json() : [];
        if (alive) setInbox(Array.isArray(inboxData) ? inboxData : []);
        if (alive) setLastSyncAt(new Date().toLocaleTimeString());
      } catch {
        // ignore
      } finally {
        pollingRef.current = false;
      }
    };

    run();
    const id = window.setInterval(run, 5000);

    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [assignment?.id, autoSync]);

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

      setSuccess("Submitted for verification. Admin review is pending.");
      setAssignment((prev) => (prev ? { ...prev, status: "Submitted", submittedAt: new Date().toISOString() } : prev));
    } catch (e: any) {
      setError(e?.message || "Submission failed");
    } finally {
      setSaving(false);
    }
  };

  const submitCustomProposal = async () => {
    if (!gigId || !session?.workerId) return;
    if (!proposalPitch.trim() || !proposalApproach.trim() || !proposalTimeline.trim()) {
      setError("Please complete pitch, approach, and timeline before submission.");
      return;
    }
    setProposalSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/gig-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gigId,
          workerId: session.workerId,
          workerName: session.workerId,
          status: "Pending",
          proposal: {
            pitch: proposalPitch.trim(),
            approach: proposalApproach.trim(),
            timeline: proposalTimeline.trim(),
            budget: proposalBudget.trim(),
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
      setSuccess("Proposal submitted successfully. Your project application is now in review.");
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
      const res = await fetch("/api/gig-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gigId,
          workerId: session.workerId,
          workerName: session.workerId,
          status: "Pending",
          proposal: {
            reviewStatus: "Pending",
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
      setApplicationStatus(String(payload?.status ?? "Pending"));
      setSuccess("Proposal submitted successfully. You can track review updates in this project feed.");
    } catch (e: any) {
      setError(e?.message || "Unable to submit proposal right now.");
    } finally {
      setProposalSaving(false);
    }
  };

  if (!sessionReady || loading) {
    return (
      <div className="relative min-h-screen overflow-x-hidden bg-[#eef4ea] text-slate-900">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,#dce9de,transparent_42%)]" />
        <div className="border-b border-[#d4dccf] bg-[#f8faf7]">
          <div className="relative mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-6">
            <div>
              <div className="text-lg font-semibold tracking-wide">Submission</div>
              <div className="text-xs text-slate-500">Preparing your project workspace...</div>
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

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#eef4ea] text-slate-900">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,#dce9de,transparent_42%)]" />
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

      <main className="relative mx-auto w-full max-w-5xl space-y-6 px-5 py-8">
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

        {hasApplication && hasAdminUpdate && (
          <div className="rounded-3xl border border-[#c9d8cf] bg-white/90 p-5 shadow-xl shadow-[#c8d5c7]/45 backdrop-blur sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-[#1c3e33]">Operations update</div>
              <span className="rounded-full border border-[#d4dfd7] bg-[#f7fbf5] px-3 py-1 text-[11px] font-semibold text-[#4d665c]">
                {proposalReviewStatus === "Rejected"
                  ? "Revision requested"
                  : proposalReviewStatus === "Accepted"
                    ? "Approved"
                    : "Under review"}
              </span>
            </div>
            {application?.proposal?.adminNote && (
              <div className="mt-3 rounded-xl border border-[#d4dfd7] bg-[#f7fbf5] px-3 py-2 text-sm text-[#355d50]">
                <span className="font-semibold">Admin note:</span> {application.proposal.adminNote}
              </div>
            )}
            {application?.proposal?.adminExplanation && (
              <div className="mt-2 rounded-xl border border-[#d4dfd7] bg-[#f7fbf5] px-3 py-2 text-sm text-[#355d50]">
                <span className="font-semibold">Guidance:</span> {application.proposal.adminExplanation}
              </div>
            )}
            {application?.proposal?.whatsappLink && (
              <div className="mt-2 rounded-xl border border-[#d4dfd7] bg-[#f7fbf5] px-3 py-2 text-sm text-[#355d50]">
                <span className="font-semibold">WhatsApp group:</span>{" "}
                {adminWhatsappLink ? (
                  <a href={adminWhatsappLink} target="_blank" rel="noreferrer" className="font-semibold text-[#1f4f43] underline underline-offset-2">
                    Open group link
                  </a>
                ) : (
                  application.proposal.whatsappLink
                )}
              </div>
            )}
            {application?.proposal?.reviewedAt && (
              <div className="mt-2 text-[11px] text-[#6f877d]">Updated: {new Date(application.proposal.reviewedAt).toLocaleString()}</div>
            )}
          </div>
        )}

        {isCustomFlow && (
          <div className="rounded-3xl border border-[#cfdbc8] bg-white/90 p-4 shadow-xl shadow-[#c8d5c7]/55 backdrop-blur sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6f877d]">Project delivery workspace</div>
                <div className="mt-1 text-base font-semibold text-[#1c3e33] sm:text-lg">Submit your execution plan for this project</div>
              </div>
              <span className="rounded-full border border-[#bcd6c9] bg-[#edf5ef] px-3 py-1 text-xs font-semibold text-[#2f6655]">
                Project type: {customType}
              </span>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-[#d4dfd7] bg-[#f7fbf5] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6f877d]">Project brief</div>
                <div className="mt-2 text-sm text-[#4d665c]">
                  {customBrief || "Review this project brief and submit a clear execution plan with milestones, communication cadence, and quality controls."}
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
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
                            <div className="aspect-[4/5] w-full overflow-hidden bg-slate-100">
                              <img src={url} alt={`Reference media ${idx + 1}`} className="h-full w-full object-cover" loading="lazy" />
                            </div>
                          ) : isVideoUrl(url) ? (
                            <div className="aspect-[4/5] w-full overflow-hidden bg-slate-100">
                              <video src={url} controls className="h-full w-full bg-slate-100 object-cover" preload="metadata" />
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
              <div className="text-xs text-[#6f877d]">Your project plan is sent for admin review along with your application.</div>
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

        {!isCustomFlow && !hasApplication && (
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
                  <p className="mt-3 text-[1.02rem] leading-8 text-[#27324a] sm:text-base">
                    {customBrief ||
                      "In this project, you will execute an outcome-focused delivery plan aligned with Reelencer quality standards, timeline discipline, and transparent reporting requirements."}
                  </p>
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
                  {proposalSaving ? "Sending proposal..." : "Send proposal"}
                </button>
              </aside>
            </div>
          </div>
        )}

        {!isCustomFlow && hasApplication && !canAccessOperations && (
          <div className="rounded-3xl border border-[#cfdbc8] bg-white/90 p-6 shadow-xl shadow-[#c8d5c7]/55 backdrop-blur">
            <div className="text-sm font-semibold text-[#1c3e33]">
              {proposalReviewStatus === "Rejected" ? "Proposal revision requested" : "Proposal in review"}
            </div>
            <div className="mt-2 text-sm text-[#4d665c]">
              {proposalReviewStatus === "Rejected"
                ? "Your proposal needs updates. Review admin feedback, revise your plan, and submit again from Browse."
                : "Admin review is in progress. You will receive the final decision and onboarding details here."}
            </div>
            {application?.proposal?.adminNote && (
              <div className="mt-3 rounded-xl border border-[#d4dfd7] bg-[#f7fbf5] px-3 py-2 text-xs text-[#355d50]">
                <span className="font-semibold">Admin note:</span> {application.proposal.adminNote}
              </div>
            )}
            {application?.proposal?.adminExplanation && (
              <div className="mt-2 rounded-xl border border-[#d4dfd7] bg-[#f7fbf5] px-3 py-2 text-xs text-[#355d50]">
                <span className="font-semibold">Explanation:</span> {application.proposal.adminExplanation}
              </div>
            )}
            {application?.proposal?.whatsappLink && (
              <a
                href={application.proposal.whatsappLink}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex rounded-full border border-[#bcd6c9] bg-[#edf5ef] px-4 py-2 text-xs font-semibold text-[#2f6655] hover:bg-[#e2f0e7]"
              >
                Open WhatsApp onboarding group
              </a>
            )}
            {application?.proposal?.reviewedAt && (
              <div className="mt-2 text-[11px] text-[#6f877d]">Last review update: {new Date(application.proposal.reviewedAt).toLocaleString()}</div>
            )}
          </div>
        )}

        {!isCustomFlow && hasApplication && isWorkspaceFlow && canAccessOperations && (
          <div className="rounded-3xl border border-[#cfdbc8] bg-white/90 p-6 shadow-xl shadow-[#c8d5c7]/55 backdrop-blur">
            <div className="text-sm font-semibold text-[#1c3e33]">Proposal approved</div>
            <div className="mt-2 text-sm text-[#4d665c]">
              Your application is approved. Continue to workspace to start operations and complete assigned tasks.
            </div>
            <Link
              href="/workspace"
              className="mt-4 inline-flex rounded-full border border-[#bcd6c9] bg-[#edf5ef] px-4 py-2 text-sm font-semibold text-[#2f6655] hover:bg-[#e2f0e7]"
            >
              Go to workspace
            </Link>
          </div>
        )}

        {!isCustomFlow && hasApplication && !isWorkspaceFlow && canAccessOperations && (
        <>
        <div className="rounded-3xl border border-[#cfdbc8] bg-white/90 p-6 shadow-xl shadow-[#c8d5c7]/55 backdrop-blur">
          <div className="text-sm font-semibold text-slate-900">Assigned dashboard emails (5)</div>
          <div className="mt-2 text-sm text-slate-600">
            Use these five emails to create the five Twitter accounts. Each email must be used once.
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
                  onClick={async () => {
                    if (!assignment?.id) return;
                    setPolling(true);
                    try {
                      const inboxRes = await fetch(`/api/gig-inbox?assignmentId=${encodeURIComponent(assignment.id)}`);
                      const inboxData = inboxRes.ok ? await inboxRes.json() : [];
                      setInbox(Array.isArray(inboxData) ? inboxData : []);
                      setLastSyncAt(new Date().toLocaleTimeString());
                    } finally {
                      setPolling(false);
                    }
                  }}
                >
                  {polling ? "Syncing..." : "Refresh inbox"}
                </button>

                <button
                  className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 hover:border-amber-300 disabled:opacity-60"
                  disabled={!assignment?.id || refreshing}
                  onClick={async () => {
                    if (!assignment?.id) return;
                    setRefreshing(true);
                    try {
                      await fetch(`/api/gig-inbox?assignmentId=${encodeURIComponent(assignment.id)}`, { method: "DELETE" });

                      const inboxRes = await fetch(`/api/gig-inbox?assignmentId=${encodeURIComponent(assignment.id)}`);
                      const inboxData = inboxRes.ok ? await inboxRes.json() : [];
                      setInbox(Array.isArray(inboxData) ? inboxData : []);
                      setLastSyncAt(new Date().toLocaleTimeString());
                    } finally {
                      setRefreshing(false);
                    }
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

          {error && (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
              {error}
            </div>
          )}

          {success && (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
              {success}
            </div>
          )}

          {assignmentStatus === "Submitted" && !success && (
            <div className="mt-4 rounded-xl border border-[#bcd6c9] bg-[#edf5ef] px-3 py-2 text-xs font-semibold text-[#2f6655]">
              In verification: Admin is reviewing your submitted credentials.
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-500">All fields are encrypted in transit. Do not reuse credentials.</div>
            <button
              className="rounded-full bg-[#1f4f43] px-5 py-2 text-sm font-semibold text-white hover:bg-[#2d6b5a] disabled:opacity-50"
              onClick={submitCredentials}
              disabled={saving || invalidRows}
            >
              {saving ? "Submitting..." : "Submit for verification"}
            </button>
          </div>
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

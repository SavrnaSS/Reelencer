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
  gigType?: "Part-time" | "Full-time";
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

type CredentialRow = {
  handle: string;
  email: string;
  password: string;
  phone: string;
};

function isFullTimeGig(gig: Pick<Gig, "gigType" | "title">) {
  const raw = String(gig.gigType ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  if (raw === "full-time" || raw === "fulltime") return true;
  return /\bfull[\s-]?time\b/i.test(gig.title || "");
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
  const [gig, setGig] = useState<Gig | null>(null);
  const [assignment, setAssignment] = useState<Assignment | null>(null);

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

  const pollingRef = React.useRef(false);

  useEffect(() => {
    const s = readLS<AuthSession | null>(LS_KEYS.AUTH, null);
    if (s?.workerId) {
      setSession(s);
      return;
    }
    if (s?.role === "Admin") {
      // Temporary testing path to allow admin to proceed.
      setSession({ ...s, workerId: "ADMIN-TEST" });
      return;
    }
    setSession(s);
  }, []);

  useEffect(() => {
    if (!gigId) {
      setError("Missing gigId.");
      setLoading(false);
      return;
    }
    if (!session?.workerId) return;

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
        if (match && isFullTimeGig(match)) {
          window.location.replace("/workspace");
          return;
        }
      } catch {
        if (alive) setGig(null);
      }

      // Get/create assignment + initial inbox
      try {
        const res = await fetch("/api/gig-assignments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // keep your existing behavior; subjectFilter still passed (even though poller now grabs all recent mails)
          body: JSON.stringify({
            gigId,
            workerId: session.workerId,
            subjectFilter: "verification|confirm|security|code|twitter|x",
          }),
        });

        if (!res.ok) {
          const failure = await res.json().catch(() => ({}));
          throw new Error(failure?.error || "Unable to assign email. Please try again.");
        }

        const data = await res.json();
        if (!alive) return;

        setAssignment(data);

        if (data?.id) {
          const inboxRes = await fetch(`/api/gig-inbox?assignmentId=${encodeURIComponent(data.id)}`);
          const inboxData = inboxRes.ok ? await inboxRes.json() : [];
          if (alive) setInbox(Array.isArray(inboxData) ? inboxData : []);
        }
      } catch (err: any) {
        if (alive) setError(err?.message || "Unable to assign email. Please try again.");
      }

      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [gigId, session?.workerId]);

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

  const assignmentStatus = assignment?.status ?? "Assigned";
  const statusTone =
    assignmentStatus === "Accepted"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : assignmentStatus === "Rejected"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : assignmentStatus === "Submitted"
      ? "border-[#bcd6c9] bg-[#edf5ef] text-[#2f6655]"
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

  if (!session?.workerId) {
    return (
      <div className="min-h-screen bg-[#eef4ea] text-slate-900 flex items-center justify-center">
        <div className="rounded-2xl border border-[#d4dccf] bg-[#f9fbf7] p-8 shadow-sm text-sm text-slate-600">
          Please sign in to proceed.
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
        <div className="rounded-3xl border border-[#cfdbc8] bg-white/90 p-6 shadow-xl shadow-[#c8d5c7]/55 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs text-slate-500">Gig</div>
              <div className="mt-1 text-xl font-semibold text-slate-900">{gig?.title ?? "Gig"}</div>
              <div className="mt-2 text-sm text-slate-600">
                {gig?.company} • {gig?.platform} • {gig?.location}
              </div>
            </div>
            <span className={`rounded-full border px-3 py-1 text-xs ${statusTone}`}>Status: {assignmentStatus}</span>
          </div>
        </div>

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

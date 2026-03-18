"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Role = "Admin" | "Worker";
type AuthSession = { role: Role; workerId?: string; at: string };

type Gig = {
  id: string;
  title: string;
  company: string;
  platform: string;
  payout: string;
  status: string;
  location?: string;
  gigType?: string;
};

type GigApplication = {
  id: string;
  gigId: string;
  workerId: string;
  status: string;
  appliedAt: string;
  decidedAt?: string;
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
  assignedEmail?: string;
  assigned_email?: string;
  assignedEmails?: string[];
  assigned_emails?: string[];
  created_at?: string;
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

function toArray<T>(value: unknown, fallback: T[]): T[] {
  return Array.isArray(value) ? (value as T[]) : fallback;
}

function fmtDate(v?: string | null) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

function isWorkspaceGig(gig: Pick<Gig, "gigType" | "title">) {
  const raw = String(gig.gigType ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  if (raw === "workspace" || raw === "full-time" || raw === "fulltime") return true;
  return /\b(workspace|full[\s-]?time)\b/i.test(gig.title || "");
}

function isEmailCreatorGig(gig: Pick<Gig, "gigType">) {
  const raw = String(gig.gigType ?? "")
    .trim()
    .toLowerCase();
  return raw === "" || raw === "email creator" || raw === "part-time" || raw === "part time";
}

function isProjectGig(gig: Pick<Gig, "gigType">) {
  return String(gig.gigType ?? "")
    .trim()
    .toLowerCase() === "project";
}

function isContentPostingGig(gig: Pick<Gig, "gigType">) {
  return String(gig.gigType ?? "")
    .trim()
    .toLowerCase() === "content posting";
}

function buildProceedHref(gig: Pick<Gig, "id" | "gigType">) {
  const params = new URLSearchParams({ gigId: String(gig.id) });
  if (isProjectGig(gig)) params.set("gigType", "project");
  if (isContentPostingGig(gig)) params.set("gigType", "content-posting");
  if (isEmailCreatorGig(gig)) params.set("gigType", "email-creator");
  return `/proceed?${params.toString()}`;
}

export default function MyAssignmentsPage() {
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [role, setRole] = useState<Role | null>(null);
  const [workerId, setWorkerId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [gigs, setGigs] = useState<Gig[]>([]);
  const [apps, setApps] = useState<GigApplication[]>([]);
  const [assignments, setAssignments] = useState<GigAssignment[]>([]);

  useEffect(() => {
    const s = readLS<AuthSession | null>(LS_KEYS.AUTH, null);
    setRole(s?.role ?? null);
    setWorkerId(s?.workerId ?? null);
    setSessionLoaded(true);
  }, []);

  useEffect(() => {
    if (!sessionLoaded) return;
    if (!role) {
      window.location.replace("/login?next=/my-assignments");
      return;
    }
    if (role === "Admin") {
      window.location.replace("/admin");
      return;
    }
    if (!workerId) {
      setLoading(false);
      return;
    }

    let alive = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const [gigsRes, appsRes, assignmentsRes] = await Promise.all([
          fetch("/api/gigs", { method: "GET" }),
          fetch(`/api/gig-applications?workerId=${encodeURIComponent(workerId)}`, { method: "GET" }),
          fetch(`/api/gig-assignments?workerId=${encodeURIComponent(workerId)}`, { method: "GET" }),
        ]);

        if (!alive) return;

        if (!gigsRes.ok || !appsRes.ok || !assignmentsRes.ok) {
          throw new Error("Unable to load assignment activity right now.");
        }

        const gigsJson = await gigsRes.json();
        const appsJson = await appsRes.json();
        const assignmentsJson = await assignmentsRes.json();

        if (!alive) return;
        setGigs(toArray<Gig>(gigsJson, []));
        setApps(toArray<GigApplication>(appsJson, []));
        setAssignments(toArray<GigAssignment>(assignmentsJson, []));
      } catch (error) {
        if (!alive) return;
        setErr(error instanceof Error ? error.message : "Unable to load assignment activity.");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [role, sessionLoaded, workerId]);

  const gigById = useMemo(() => {
    const map = new Map<string, Gig>();
    gigs.forEach((g) => map.set(String(g.id), g));
    return map;
  }, [gigs]);

  const normalizedAssignments = useMemo(
    () =>
      assignments.map((a) => ({
        ...a,
        gigKey: String(a.gigId ?? a.gig_id ?? ""),
        status: String(a.status ?? "Assigned"),
        submittedAt: a.submittedAt ?? a.submitted_at,
        decidedAt: a.decidedAt ?? a.decided_at,
      })),
    [assignments]
  );

  const stats = useMemo(() => {
    const submitted = normalizedAssignments.filter((a) => String(a.status).toLowerCase() === "submitted").length;
    const accepted = normalizedAssignments.filter((a) => String(a.status).toLowerCase() === "accepted").length;
    const pending = normalizedAssignments.filter((a) => ["assigned", "pending"].includes(String(a.status).toLowerCase())).length;
    return {
      totalAssignments: normalizedAssignments.length,
      totalApplications: apps.length,
      submitted,
      accepted,
      pending,
    };
  }, [apps.length, normalizedAssignments]);

  const activity = useMemo(() => {
    const appEvents = apps.map((a) => {
      const g = gigById.get(String(a.gigId));
      return {
        id: `app-${a.id}`,
        when: a.decidedAt ?? a.appliedAt,
        title: g ? g.title : a.gigId,
        subtitle: `${g?.company ?? "Gig"} • application ${a.status}`,
        tone: "application",
      };
    });

    const assignmentEvents = normalizedAssignments.map((a) => {
      const g = gigById.get(a.gigKey);
      return {
        id: `asg-${a.id ?? a.gigKey}`,
        when: a.decidedAt ?? a.submittedAt ?? a.created_at,
        title: g ? g.title : a.gigKey,
        subtitle: `${g?.company ?? "Gig"} • assignment ${a.status}`,
        tone: "assignment",
      };
    });

    return [...assignmentEvents, ...appEvents]
      .filter((x) => !!x.when)
      .sort((a, b) => new Date(String(b.when)).getTime() - new Date(String(a.when)).getTime())
      .slice(0, 20);
  }, [apps, gigById, normalizedAssignments]);

  if (!sessionLoaded || loading) {
    return (
      <div className="min-h-screen bg-[#eef4ea] text-slate-900">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#cdd9cd] bg-white px-3 py-1 text-xs font-semibold text-[#486455] shadow-sm">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#c3d1c3] border-t-[#1f4f43]" />
            Loading your assignments...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#eef4ea] text-slate-900">
      <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,rgba(220,233,222,0.95),transparent_38%)]">
        <div className="border-b border-[#d4dccf] bg-[#f8faf7]">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6f877d]">Assignment Desk</div>
              <h1 className="mt-1 text-[1.9rem] font-semibold leading-tight tracking-tight text-[#1c3e33] sm:text-[2.35rem]">
                My assignments
              </h1>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[#5c7368]">
                Track recruiter decisions, assigned gigs, and your latest work activity in one browse-style dashboard.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/browse" className="rounded-full border border-[#c9d3c4] bg-white px-4 py-2 text-sm font-semibold text-[#284b3e] transition hover:border-[#a9bbb1]">
                Browse gigs
              </Link>
              <Link href="/workspace" className="rounded-full bg-[#1f4f43] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#2d6b5a]">
                Workspace
              </Link>
            </div>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-7xl px-4 pb-10 pt-6 sm:px-6 lg:px-8 lg:pt-8">
          {err && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{err}</div>}

          {!workerId && !err && (
            <div className="rounded-3xl border border-[#cfdbc8] bg-white/90 p-5 shadow-xl shadow-[#c8d5c7]/45 backdrop-blur sm:p-6">
              <div className="text-lg font-semibold text-[#1c3e33]">Worker profile not linked yet</div>
              <p className="mt-2 max-w-xl text-sm leading-6 text-[#5c7368]">
                Complete the verification and sign-in flow once, then your assignments and recruiter activity will appear here automatically.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/browse" className="rounded-xl border border-[#c9d3c4] bg-white px-4 py-2 text-sm font-semibold text-[#284b3e] transition hover:border-[#a9bbb1]">
                  Go to browse
                </Link>
                <Link href="/login?next=/my-assignments" className="rounded-xl bg-[#1f4f43] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#2d6b5a]">
                  Sign in
                </Link>
              </div>
            </div>
          )}

          {workerId && (
            <>
              <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {[
                  { label: "Assignments", value: stats.totalAssignments, detail: "Assigned by recruiter" },
                  { label: "Applications", value: stats.totalApplications, detail: "Proposals on record" },
                  { label: "Pending", value: stats.pending, detail: "Awaiting next action" },
                  { label: "Submitted", value: stats.submitted, detail: "Work under review" },
                  { label: "Accepted", value: stats.accepted, detail: "Approved access" },
                ].map((item) => (
                  <div key={item.label} className="relative rounded-[1.2rem] border border-[#cfdbc8] bg-white/90 px-4 py-3 shadow-lg shadow-[#d6dfd2]/35 backdrop-blur sm:rounded-[1.4rem] sm:px-5 sm:py-5">
                    <span className="absolute right-4 top-3 inline-flex rounded-full border border-[#d9e4de] bg-[#f3f8f2] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#597568] sm:right-5 sm:top-5 sm:px-3 sm:text-[10px] sm:tracking-[0.16em]">
                      {item.label}
                    </span>
                    <div className="min-w-0 pt-8 sm:pt-10">
                      <div className="text-[2rem] font-semibold leading-none tracking-tight text-[#1c3e33] sm:text-4xl">{item.value}</div>
                      <div className="mt-1.5 max-w-[14rem] text-[11px] leading-5 text-[#71887c] sm:mt-2 sm:text-xs">{item.detail}</div>
                    </div>
                  </div>
                ))}
              </section>

              <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.18fr)_minmax(320px,0.82fr)]">
                <div className="space-y-6">
                  <div className="rounded-[1.6rem] border border-[#cfdbc8] bg-white/90 p-4 shadow-xl shadow-[#c8d5c7]/45 backdrop-blur sm:p-6">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6f877d]">Assigned gigs</div>
                        <div className="mt-1 text-2xl font-semibold tracking-tight text-[#1c3e33]">Recruiter-assigned work</div>
                        <div className="mt-1 text-sm leading-6 text-[#5c7368]">Your accepted gigs, assignment packs, and current assignment state.</div>
                      </div>
                      <span className="inline-flex rounded-full border border-[#cfe0d4] bg-[#edf5ef] px-3 py-1 text-xs font-semibold text-[#2f6655]">
                        {normalizedAssignments.length} total
                      </span>
                    </div>

                    <div className="mt-5 space-y-3.5">
                      {normalizedAssignments.length === 0 && (
                        <div className="rounded-2xl border border-[#d9e4de] bg-[#f7fbf8] px-4 py-5 text-sm text-[#5f6f66]">
                          No assignments yet.
                        </div>
                      )}
                      {normalizedAssignments.map((a, idx) => {
                        const g = gigById.get(a.gigKey);
                        const emails = Array.isArray(a.assignedEmails)
                          ? a.assignedEmails
                          : Array.isArray(a.assigned_emails)
                            ? a.assigned_emails
                            : [a.assignedEmail ?? a.assigned_email].filter(Boolean);
                        const actionHref = g ? (isWorkspaceGig(g) ? "/workspace" : buildProceedHref(g)) : null;
                        const actionLabel = g
                          ? isWorkspaceGig(g)
                            ? "Open workspace"
                            : isEmailCreatorGig(g)
                              ? "Continue assignment"
                              : "Open gig"
                          : "Open assignment";
                        return (
                          <article key={`${a.id ?? a.gigKey}-${idx}`} className="rounded-2xl border border-[#d9e4de] bg-[#f9fcf8] p-4 shadow-[0_10px_24px_rgba(172,190,176,0.16)]">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0 flex-1">
                                <div className="break-words text-[1.02rem] font-semibold leading-tight text-[#23352d] sm:text-[1.08rem]">
                                  {g?.title ?? a.gigKey}
                                </div>
                                <div className="mt-1 break-words text-xs leading-5 text-[#6a7f73]">
                                  {g?.company ?? "Gig"} • {g?.platform ?? "Platform"}
                                </div>
                              </div>
                              <span className="self-start rounded-full border border-[#cfe0d4] bg-white px-3 py-1 text-xs font-semibold text-[#315f50]">
                                {a.status}
                              </span>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2 text-[11px] sm:text-xs">
                              {g?.payout && <span className="rounded-full border border-[#d4dfd7] bg-white px-3 py-1 text-[#4d665c]">{g.payout}</span>}
                              {g?.gigType && <span className="rounded-full border border-[#d4dfd7] bg-white px-3 py-1 text-[#4d665c]">{g.gigType}</span>}
                              {!!emails.length && <span className="rounded-full border border-[#d4dfd7] bg-white px-3 py-1 text-[#4d665c]">{emails.length} email(s)</span>}
                            </div>
                            <div className="mt-4 grid gap-2 text-xs text-[#70857a] sm:grid-cols-2">
                              <div className="rounded-xl border border-[#e1e8e0] bg-white px-3 py-2">Submitted: {fmtDate(a.submittedAt)}</div>
                              <div className="rounded-xl border border-[#e1e8e0] bg-white px-3 py-2">Reviewed: {fmtDate(a.decidedAt)}</div>
                            </div>
                            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                              <div className="text-xs leading-5 text-[#6b8175]">
                                Continue this assigned gig from the correct worker flow.
                              </div>
                              {actionHref ? (
                                <Link
                                  href={actionHref}
                                  className="inline-flex items-center rounded-full bg-[#1f4f43] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#2d6b5a]"
                                >
                                  {actionLabel}
                                </Link>
                              ) : (
                                <span className="inline-flex items-center rounded-full border border-[#d4dfd7] bg-white px-4 py-2 text-sm font-semibold text-[#6b8175]">
                                  Assignment pending sync
                                </span>
                              )}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="rounded-[1.6rem] border border-[#cfdbc8] bg-white/90 p-4 shadow-xl shadow-[#c8d5c7]/45 backdrop-blur sm:p-6">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6f877d]">Applications</div>
                        <div className="mt-1 text-2xl font-semibold tracking-tight text-[#1c3e33]">Proposal activity</div>
                      </div>
                      <span className="inline-flex rounded-full border border-[#d9e4de] bg-[#f3f8f2] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#597568]">
                        {apps.length} items
                      </span>
                    </div>
                    <div className="mt-5 space-y-3">
                      {apps.length === 0 && <div className="rounded-2xl border border-[#d9e4de] bg-[#f7fbf8] px-4 py-5 text-sm text-[#5f6f66]">No applications yet.</div>}
                      {apps.map((a) => {
                        const g = gigById.get(String(a.gigId));
                        return (
                          <div key={a.id} className="rounded-2xl border border-[#d9e4de] bg-[#f9fcf8] p-4">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0 flex-1">
                                <div className="break-words text-sm font-semibold text-[#23352d]">{g?.title ?? a.gigId}</div>
                                <div className="mt-1 break-words text-xs leading-5 text-[#6a7f73]">{g?.company ?? "Gig"}</div>
                              </div>
                              <span className="self-start rounded-full border border-[#d4dfd7] bg-white px-3 py-1 text-xs font-semibold text-[#315f50]">{a.status}</span>
                            </div>
                            <div className="mt-3 rounded-xl border border-[#e1e8e0] bg-white px-3 py-2 text-xs text-[#70857a]">
                              Applied: {fmtDate(a.appliedAt)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-[1.6rem] border border-[#cfdbc8] bg-white/90 p-4 shadow-xl shadow-[#c8d5c7]/45 backdrop-blur sm:p-6">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6f877d]">Recent activity</div>
                        <div className="mt-1 text-2xl font-semibold tracking-tight text-[#1c3e33]">Latest updates</div>
                      </div>
                      <span className="inline-flex rounded-full border border-[#d9e4de] bg-[#f3f8f2] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#597568]">
                        Live log
                      </span>
                    </div>
                    <div className="mt-5 space-y-3">
                      {activity.length === 0 && <div className="rounded-2xl border border-[#d9e4de] bg-[#f7fbf8] px-4 py-5 text-sm text-[#5f6f66]">No recent activity.</div>}
                      {activity.map((item) => (
                        <div key={item.id} className="rounded-2xl border border-[#d9e4de] bg-[#f9fcf8] p-4">
                          <div className="break-words text-sm font-semibold text-[#23352d]">{item.title}</div>
                          <div className="mt-1 break-words text-xs leading-5 text-[#6a7f73]">{item.subtitle}</div>
                          <div className="mt-3 inline-flex rounded-full border border-[#d4dfd7] bg-white px-3 py-1 text-[11px] font-medium text-[#70857a]">
                            {fmtDate(String(item.when))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

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
      <div className="min-h-screen bg-[#041f1a] text-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/18 bg-white/8 px-3 py-1 text-xs text-white/80">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-[#95ea63]" />
            Loading your assignments...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#041f1a] text-white">
      <div className="relative isolate min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(45,130,105,0.22),transparent_34%),radial-gradient(circle_at_top_right,rgba(18,64,53,0.36),transparent_26%),linear-gradient(135deg,#0d4b3d_0%,#08342b_58%,#051916_100%)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(140,209,115,0.12)_1.1px,transparent_1.1px)] bg-[length:12px_12px] opacity-80" />

        <div className="relative mx-auto w-full max-w-7xl px-4 pb-10 pt-8 sm:px-6 lg:px-8 lg:pt-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-[2rem] font-black tracking-[-0.04em] text-white sm:text-[2.5rem]">My assignments</h1>
              <p className="mt-1 text-sm text-white/68">Track your gig applications, assigned work, and latest activity.</p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/browse" className="rounded-full border border-white/16 bg-white/6 px-4 py-2 text-sm font-semibold text-white/88 hover:bg-white/12">
                Browse gigs
              </Link>
              <Link href="/workspace" className="rounded-full bg-[#8fe05f] px-4 py-2 text-sm font-bold text-[#0b1914] hover:bg-[#9ae86a]">
                Workspace
              </Link>
            </div>
          </div>

          {err && <div className="mt-5 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{err}</div>}

          {!workerId && !err && (
            <div className="mt-6 rounded-2xl border border-white/12 bg-white/6 p-5">
              <div className="text-lg font-semibold text-white">Worker profile not linked yet</div>
              <p className="mt-2 text-sm text-white/70">Complete verification/login flow once, then your assignments will appear here.</p>
              <div className="mt-4 flex gap-2">
                <Link href="/browse" className="rounded-lg border border-white/16 bg-white/8 px-4 py-2 text-sm font-semibold text-white">Go to browse</Link>
                <Link href="/login?next=/my-assignments" className="rounded-lg bg-[#8fe05f] px-4 py-2 text-sm font-bold text-[#0b1914]">Sign in</Link>
              </div>
            </div>
          )}

          {workerId && (
            <>
              <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
                {[
                  { label: "Assignments", value: stats.totalAssignments },
                  { label: "Applications", value: stats.totalApplications },
                  { label: "Pending", value: stats.pending },
                  { label: "Submitted", value: stats.submitted },
                  { label: "Accepted", value: stats.accepted },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl border border-white/10 bg-white/6 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] sm:rounded-2xl sm:p-4">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-white/50 sm:text-xs sm:tracking-[0.14em]">{item.label}</div>
                    <div className="mt-1 text-2xl font-black leading-none tracking-[-0.03em] text-white sm:mt-2 sm:text-3xl sm:tracking-[-0.04em]">
                      {item.value}
                    </div>
                  </div>
                ))}
              </section>

              <section className="mt-6 grid gap-6 lg:grid-cols-[1.08fr_0.92fr]">
                <div className="rounded-2xl border border-white/10 bg-white/6 p-5">
                  <div className="text-lg font-semibold text-white">Assigned gigs</div>
                  <div className="mt-4 space-y-3">
                    {normalizedAssignments.length === 0 && (
                      <div className="rounded-xl border border-white/10 bg-black/10 px-4 py-5 text-sm text-white/65">No assignments yet.</div>
                    )}
                    {normalizedAssignments.map((a, idx) => {
                      const g = gigById.get(a.gigKey);
                      const emails = Array.isArray(a.assignedEmails)
                        ? a.assignedEmails
                        : Array.isArray(a.assigned_emails)
                          ? a.assigned_emails
                          : [a.assignedEmail ?? a.assigned_email].filter(Boolean);
                      return (
                        <article key={`${a.id ?? a.gigKey}-${idx}`} className="rounded-xl border border-white/10 bg-black/10 p-3 sm:p-4">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0 flex-1">
                              <div className="whitespace-normal break-words text-[1.05rem] font-semibold leading-tight text-white">{g?.title ?? a.gigKey}</div>
                              <div className="mt-1 break-words text-xs text-white/62">{g?.company ?? "Gig"} • {g?.platform ?? "Platform"}</div>
                            </div>
                            <span className="self-start rounded-full border border-white/14 bg-white/8 px-2.5 py-1 text-xs font-semibold text-white/80">{a.status}</span>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-white/66 sm:gap-2 sm:text-xs">
                            {g?.payout && <span className="rounded-full border border-white/10 bg-white/6 px-2 py-0.5 sm:py-1">{g.payout}</span>}
                            {g?.gigType && <span className="rounded-full border border-white/10 bg-white/6 px-2 py-0.5 sm:py-1">{g.gigType}</span>}
                            {!!emails.length && <span className="rounded-full border border-white/10 bg-white/6 px-2 py-0.5 sm:py-1">{emails.length} email(s)</span>}
                          </div>
                          <div className="mt-3 text-xs text-white/55">Submitted: {fmtDate(a.submittedAt)}</div>
                          <div className="mt-1 text-xs text-white/55">Reviewed: {fmtDate(a.decidedAt)}</div>
                        </article>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="rounded-2xl border border-white/10 bg-white/6 p-5">
                    <div className="text-lg font-semibold text-white">Applications</div>
                    <div className="mt-4 space-y-3">
                      {apps.length === 0 && <div className="text-sm text-white/65">No applications yet.</div>}
                      {apps.map((a) => {
                        const g = gigById.get(String(a.gigId));
                        return (
                          <div key={a.id} className="rounded-xl border border-white/10 bg-black/10 p-3">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0 flex-1">
                                <div className="whitespace-normal break-words text-sm font-semibold text-white">{g?.title ?? a.gigId}</div>
                                <div className="mt-1 break-words text-xs text-white/58">{g?.company ?? "Gig"}</div>
                              </div>
                              <span className="self-start rounded-full border border-white/14 bg-white/8 px-2 py-0.5 text-xs text-white/80">{a.status}</span>
                            </div>
                            <div className="mt-2 text-xs text-white/55">Applied: {fmtDate(a.appliedAt)}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/6 p-5">
                    <div className="text-lg font-semibold text-white">Recent activity</div>
                    <div className="mt-4 space-y-3">
                      {activity.length === 0 && <div className="text-sm text-white/65">No recent activity.</div>}
                      {activity.map((item) => (
                        <div key={item.id} className="rounded-xl border border-white/10 bg-black/10 p-3">
                          <div className="break-words text-sm font-semibold text-white">{item.title}</div>
                          <div className="mt-1 break-words text-xs text-white/62">{item.subtitle}</div>
                          <div className="mt-2 text-xs text-white/50">{fmtDate(String(item.when))}</div>
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

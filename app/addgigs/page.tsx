"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Platform = "Instagram" | "X" | "YouTube" | "LinkedIn" | "TikTok";
type PayoutType = "Per task" | "Per post" | "Monthly";
type GigStatus = "Open" | "Paused" | "Closed";
type GigType = "Part-time" | "Full-time";
type ApplicationStatus = "Applied" | "Accepted" | "Rejected" | "Withdrawn";

type Gig = {
  id: string;
  title: string;
  company: string;
  verified: boolean;
  platform: Platform;
  location: string;
  workload: string;
  payout: string;
  payoutType: PayoutType;
  gigType?: GigType;
  requirements: string[];
  status: GigStatus;
  postedAt: string;
};

type GigApplication = {
  id: string;
  gigId: string;
  workerId: string;
  workerName?: string;
  status: ApplicationStatus;
  appliedAt: string;
  decidedAt?: string;
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
};

type Role = "Admin" | "Worker";
type AuthSession = { role: Role; workerId?: string; at: string };

const LS_KEYS = {
  AUTH: "igops:auth",
  GIGS: "igops:gigs",
  GIG_APPS: "igops:gig-apps",
} as const;

const PLATFORMS: Platform[] = ["Instagram", "X", "YouTube", "LinkedIn", "TikTok"];
const PAYOUTS: PayoutType[] = ["Per task", "Per post", "Monthly"];
const STATUSES: GigStatus[] = ["Open", "Paused", "Closed"];
const GIG_TYPES: GigType[] = ["Part-time", "Full-time"];

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

function toArray<T>(value: any, fallback: T[]): T[] {
  return Array.isArray(value) ? (value as T[]) : fallback;
}

function nowLabel() {
  const d = new Date();
  return `Posted ${d.toLocaleDateString()}`;
}

function makeId() {
  return `GIG-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

export default function AdminGigsPage() {
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [gigs, setGigs] = useState<Gig[]>([]);
  const [apps, setApps] = useState<GigApplication[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [assignmentCreds, setAssignmentCreds] = useState<any[]>([]);
  const [credsCache, setCredsCache] = useState<Record<string, any[]>>({});
  const [loadingCredsId, setLoadingCredsId] = useState<string | null>(null);
  const [assignmentFilter, setAssignmentFilter] = useState<string>("Submitted");
  const [assignmentsRefreshing, setAssignmentsRefreshing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [lastSeenSubmittedAt, setLastSeenSubmittedAt] = useState<string | null>(null);
  const [kycRows, setKycRows] = useState<any[]>([]);
  const [kycLoading, setKycLoading] = useState(false);
  const [kycError, setKycError] = useState<string | null>(null);
  const [kycNoteDraft, setKycNoteDraft] = useState<Record<string, string>>({});
  const [kycTimeline, setKycTimeline] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedGigId, setSelectedGigId] = useState<string | "All">("All");
  const [editingGig, setEditingGig] = useState<Gig | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [form, setForm] = useState({
    title: "",
    company: "",
    platform: "Instagram" as Platform,
    location: "Remote",
    workload: "",
    payout: "",
    payoutType: "Per post" as PayoutType,
    gigType: "Part-time" as GigType,
    requirements: "",
    status: "Open" as GigStatus,
  });

  useEffect(() => {
    const s = readLS<AuthSession | null>(LS_KEYS.AUTH, null);
    setSession(s);
    setSessionLoaded(true);
  }, []);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (!alive) return;
      await fetchKyc();
    };
    const id = window.setInterval(run, 15000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!sessionLoaded) return;
    if (!session) {
      window.location.replace("/login?next=/addgigs");
      return;
    }
    if (session.role !== "Admin") {
      window.location.replace("/workspace");
      return;
    }
  }, [sessionLoaded, session]);

  useEffect(() => {
    let alive = true;

    const loadAssignments = async () => {
      try {
        const res = await fetch("/api/gig-assignments?all=1", { method: "GET" });
        if (res.ok) {
          const data = await res.json();
          if (!alive) return;
          const safe = toArray<Assignment>(data, []);
          setAssignments(safe);
        } else {
          throw new Error("Failed assignments");
        }
      } catch {
        setAssignments([]);
      }
    };

    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/gigs", { method: "GET" });
        if (res.ok) {
          const data = await res.json();
          if (!alive) return;
          const safe = toArray<Gig>(data, []);
          setGigs(safe);
          writeLS(LS_KEYS.GIGS, safe);
        } else {
          throw new Error("Failed gigs");
        }
      } catch {
        const cached = toArray<Gig>(readLS(LS_KEYS.GIGS, []), []);
        setGigs(cached);
      }

      try {
        const res = await fetch("/api/gig-applications", { method: "GET" });
        if (res.ok) {
          const data = await res.json();
          if (!alive) return;
          const safe = toArray<GigApplication>(data, []);
          setApps(safe);
          writeLS(LS_KEYS.GIG_APPS, safe);
        } else {
          throw new Error("Failed apps");
        }
      } catch {
        const cached = toArray<GigApplication>(readLS(LS_KEYS.GIG_APPS, []), []);
        setApps(cached);
      }

      await loadAssignments();
      if (alive) setLastRefreshAt(new Date().toISOString());
      if (alive) fetchKyc();

      if (alive) setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, []);

  const fetchKyc = async () => {
    setKycLoading(true);
    setKycError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Missing session");
      const res = await fetch("/api/admin/kyc", { headers: { Authorization: `Bearer ${token}` } });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || "Failed to load KYC");
      setKycRows(Array.isArray(payload.rows) ? payload.rows : []);
    } catch (e: any) {
      setKycError(e?.message || "Failed to load KYC");
    } finally {
      setKycLoading(false);
    }
  };

  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (!alive) return;
      try {
        const res = await fetch("/api/gig-assignments?all=1", { method: "GET" });
        if (res.ok) {
          const data = await res.json();
          if (!alive) return;
          const safe = toArray<Assignment>(data, []);
          setAssignments(safe);
        }
      } catch {
        // ignore
      }
    };
    const id = window.setInterval(run, 10000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const filteredApps = useMemo(() => {
    if (selectedGigId === "All") return apps;
    return apps.filter((app) => app.gigId === selectedGigId);
  }, [apps, selectedGigId]);

  const validateForm = () => {
    if (!form.title.trim()) return "Title is required.";
    if (!form.company.trim()) return "Company is required.";
    if (!form.workload.trim()) return "Workload is required.";
    if (!form.payout.trim()) return "Payout is required.";
    return null;
  };

  const createGig = async () => {
    const err = validateForm();
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    const payload: Gig = {
      id: makeId(),
      title: form.title,
      company: form.company,
      verified: true,
      platform: form.platform,
      location: form.location,
      workload: form.workload,
      payout: form.payout,
      payoutType: form.payoutType,
      gigType: form.gigType,
      requirements: form.requirements.split(",").map((s) => s.trim()).filter(Boolean),
      status: form.status,
      postedAt: nowLabel(),
    };

    setGigs((prev) => {
      const next = [payload, ...prev];
      writeLS(LS_KEYS.GIGS, next);
      return next;
    });

    try {
      const res = await fetch("/api/gigs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        setGigs((prev) => {
          const next = prev.map((gig) => (gig.id === payload.id ? data : gig));
          writeLS(LS_KEYS.GIGS, next);
          return next;
        });
      }
    } catch {
      // keep optimistic
    }

    setForm({
      title: "",
      company: "",
      platform: "Instagram",
      location: "Remote",
      workload: "",
      payout: "",
      payoutType: "Per post",
      gigType: "Part-time",
      requirements: "",
      status: "Open",
    });
  };

  const startEdit = (gig: Gig) => {
    setEditingGig(gig);
    setForm({
      title: gig.title,
      company: gig.company,
      platform: gig.platform,
      location: gig.location,
      workload: gig.workload,
      payout: gig.payout,
      payoutType: gig.payoutType,
      gigType: gig.gigType ?? "Part-time",
      requirements: gig.requirements.join(", "),
      status: gig.status,
    });
    setFormError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const updateGig = async () => {
    if (!editingGig) return;
    const err = validateForm();
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    const updates: Partial<Gig> = {
      title: form.title,
      company: form.company,
      platform: form.platform,
      location: form.location,
      workload: form.workload,
      payout: form.payout,
      payoutType: form.payoutType,
      gigType: form.gigType,
      requirements: form.requirements.split(",").map((s) => s.trim()).filter(Boolean),
      status: form.status,
    };

    setGigs((prev) => {
      const next = prev.map((gig) => (gig.id === editingGig.id ? { ...gig, ...updates } : gig));
      writeLS(LS_KEYS.GIGS, next);
      return next;
    });

    try {
      await fetch("/api/gigs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingGig.id, updates }),
      });
    } catch {
      // keep optimistic
    }

    setEditingGig(null);
    setForm({
      title: "",
      company: "",
      platform: "Instagram",
      location: "Remote",
      workload: "",
      payout: "",
      payoutType: "Per post",
      gigType: "Part-time",
      requirements: "",
      status: "Open",
    });
  };

  const deleteGig = async (gigId: string) => {
    const confirmed = window.confirm("Delete this gig? This will remove all related applications.");
    if (!confirmed) return;

    setGigs((prev) => {
      const next = prev.filter((gig) => gig.id !== gigId);
      writeLS(LS_KEYS.GIGS, next);
      return next;
    });
    setApps((prev) => {
      const next = prev.filter((app) => app.gigId !== gigId);
      writeLS(LS_KEYS.GIG_APPS, next);
      return next;
    });

    try {
      await fetch(`/api/gigs?id=${encodeURIComponent(gigId)}`, { method: "DELETE" });
    } catch {
      // ignore
    }
  };
  const updateGigStatus = async (gigId: string, status: GigStatus) => {
    setGigs((prev) => {
      const next = prev.map((gig) => (gig.id === gigId ? { ...gig, status } : gig));
      writeLS(LS_KEYS.GIGS, next);
      return next;
    });

    try {
      await fetch("/api/gigs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: gigId, updates: { status } }),
      });
    } catch {
      // ignore
    }
  };

  const updateGigType = async (gigId: string, gigType: GigType) => {
    setGigs((prev) => {
      const next = prev.map((gig) => (gig.id === gigId ? { ...gig, gigType } : gig));
      writeLS(LS_KEYS.GIGS, next);
      return next;
    });

    try {
      await fetch("/api/gigs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: gigId, updates: { gigType } }),
      });
    } catch {
      // ignore
    }
  };

  const updateApplication = async (app: GigApplication, status: ApplicationStatus) => {
    const decidedAt = new Date().toISOString();
    setApps((prev) => {
      const next = prev.map((a) => (a.id === app.id ? { ...a, status, decidedAt } : a));
      writeLS(LS_KEYS.GIG_APPS, next);
      return next;
    });

    try {
      await fetch("/api/gig-applications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: app.id, updates: { status, decidedAt } }),
      });
    } catch {
      // ignore
    }
  };

  const updateAssignment = async (assignment: Assignment, status: string) => {
    const decidedAt = new Date().toISOString();
    setAssignments((prev) => prev.map((a) => (a.id === assignment.id ? { ...a, status, decidedAt } : a)));
    try {
      await fetch("/api/gig-assignments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: assignment.id, updates: { status, decidedAt } }),
      });
    } catch {
      // ignore
    }
  };

  const filteredAssignments = useMemo(() => {
    if (assignmentFilter === "All") return assignments;
    return assignments.filter((a) => a.status === assignmentFilter);
  }, [assignments, assignmentFilter]);

  const assignmentCounts = useMemo(() => {
    const counts: Record<string, number> = { All: assignments.length };
    for (const a of assignments) {
      counts[a.status] = (counts[a.status] ?? 0) + 1;
    }
    return counts;
  }, [assignments]);

  useEffect(() => {
    if (assignmentFilter !== "Submitted") return;
    const submitted = assignments
      .filter((a) => a.status === "Submitted" && a.submittedAt)
      .slice()
      .sort((a, b) => new Date(b.submittedAt ?? 0).getTime() - new Date(a.submittedAt ?? 0).getTime());
    const newest = submitted[0];
    if (!newest?.submittedAt) return;
    if (!lastSeenSubmittedAt || new Date(newest.submittedAt).getTime() > new Date(lastSeenSubmittedAt).getTime()) {
      setLastSeenSubmittedAt(newest.submittedAt);
      if (!selectedAssignment || selectedAssignment.id !== newest.id) {
        openAssignment(newest);
      }
    }
  }, [assignments, assignmentFilter, lastSeenSubmittedAt, selectedAssignment]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (!selectedAssignment) return;
      if (e.key === "j") {
        e.preventDefault();
        openAdjacent(1);
      } else if (e.key === "k") {
        e.preventDefault();
        openAdjacent(-1);
      } else if (e.key === "a") {
        e.preventDefault();
        updateAssignment(selectedAssignment, "Accepted");
      } else if (e.key === "r") {
        e.preventDefault();
        updateAssignment(selectedAssignment, "Rejected");
      } else if (e.key === "p") {
        e.preventDefault();
        updateAssignment(selectedAssignment, "Pending");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedAssignment, filteredAssignments]);

  const fetchAssignmentCreds = async (assignmentId: string) => {
    if (credsCache[assignmentId]) return credsCache[assignmentId];
    setLoadingCredsId(assignmentId);
    try {
      const res = await fetch(`/api/gig-credentials?assignmentId=${encodeURIComponent(assignmentId)}`);
      const data = res.ok ? await res.json() : [];
      const safe = Array.isArray(data) ? data : [];
      setCredsCache((prev) => ({ ...prev, [assignmentId]: safe }));
      return safe;
    } catch {
      setCredsCache((prev) => ({ ...prev, [assignmentId]: [] }));
      return [];
    } finally {
      setLoadingCredsId((prev) => (prev === assignmentId ? null : prev));
    }
  };

  const openAssignment = async (assignment: Assignment) => {
    setSelectedAssignment(assignment);
    const creds = await fetchAssignmentCreds(assignment.id);
    setAssignmentCreds(creds);
  };

  const selectedIndex = useMemo(() => {
    if (!selectedAssignment) return -1;
    return filteredAssignments.findIndex((a) => a.id === selectedAssignment.id);
  }, [selectedAssignment, filteredAssignments]);

  const openAdjacent = async (dir: -1 | 1) => {
    if (selectedIndex < 0) return;
    const next = filteredAssignments[selectedIndex + dir];
    if (!next) return;
    await openAssignment(next);
  };

  const refreshAssignments = async () => {
    setAssignmentsRefreshing(true);
    try {
      const res = await fetch("/api/gig-assignments?all=1", { method: "GET" });
      const data = res.ok ? await res.json() : [];
      setAssignments(Array.isArray(data) ? data : []);
      setLastRefreshAt(new Date().toISOString());
    } finally {
      setAssignmentsRefreshing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0b5cab] text-white font-black">R</div>
            <div>
              <div className="text-lg font-semibold tracking-wide">Reelencer Admin</div>
              <div className="text-xs text-slate-500">Gig control center</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              className="rounded-full border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:border-slate-400"
              href="/browse"
            >
              Browse view
            </Link>
            <Link
              className="rounded-full border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:border-slate-400"
              href="/admin"
            >
              Admin home
            </Link>
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-6xl px-5 py-8">
        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">Create new gig</div>
                <div className="text-xs text-slate-500">Post verified opportunities with structured requirements.</div>
              </div>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">Admin only</span>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="text-xs font-semibold text-slate-600">
                Title
                <input
                  className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  value={form.title}
                  onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                  placeholder="e.g., Reel Creator — Skincare"
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Company
                <input
                  className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  value={form.company}
                  onChange={(e) => setForm((prev) => ({ ...prev, company: e.target.value }))}
                  placeholder="Business name"
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Platform
                <select
                  className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  value={form.platform}
                  onChange={(e) => setForm((prev) => ({ ...prev, platform: e.target.value as Platform }))}
                >
                  {PLATFORMS.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Location
                <input
                  className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  value={form.location}
                  onChange={(e) => setForm((prev) => ({ ...prev, location: e.target.value }))}
                  placeholder="Remote / Hybrid / City"
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Workload
                <input
                  className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  value={form.workload}
                  onChange={(e) => setForm((prev) => ({ ...prev, workload: e.target.value }))}
                  placeholder="e.g., 10 reels / month"
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Payout
                <input
                  className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  value={form.payout}
                  onChange={(e) => setForm((prev) => ({ ...prev, payout: e.target.value }))}
                  placeholder="e.g., ₹48,000"
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Payout type
                <select
                  className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  value={form.payoutType}
                  onChange={(e) => setForm((prev) => ({ ...prev, payoutType: e.target.value as PayoutType }))}
                >
                  {PAYOUTS.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Gig type
                <select
                  className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  value={form.gigType}
                  onChange={(e) => setForm((prev) => ({ ...prev, gigType: e.target.value as GigType }))}
                >
                  {GIG_TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Status
                <select
                  className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  value={form.status}
                  onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value as GigStatus }))}
                >
                  {STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className="mt-4 block text-xs font-semibold text-slate-600">
              Requirements (comma separated)
              <input
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                value={form.requirements}
                onChange={(e) => setForm((prev) => ({ ...prev, requirements: e.target.value }))}
                placeholder="e.g., 10k+ followers, 72h turnaround"
              />
            </label>

            {formError && (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                {formError}
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-slate-500">Gigs publish instantly to Browse.</div>
              <div className="flex items-center gap-2">
                {editingGig && (
                  <button
                    className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400"
                    onClick={() => {
                      setEditingGig(null);
                      setForm({
                        title: "",
                        company: "",
                        platform: "Instagram",
                        location: "Remote",
                        workload: "",
                        payout: "",
                        payoutType: "Per post",
                        gigType: "Part-time",
                        requirements: "",
                        status: "Open",
                      });
                      setFormError(null);
                    }}
                  >
                    Cancel edit
                  </button>
                )}
                <button
                  className="rounded-full bg-[#0b5cab] px-5 py-2 text-sm font-semibold text-white hover:bg-[#0f6bc7]"
                  onClick={editingGig ? updateGig : createGig}
                >
                  {editingGig ? "Update gig" : "Publish gig"}
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-semibold text-slate-900">Marketplace metrics</div>
            <div className="mt-4 grid grid-cols-2 gap-4 text-sm text-slate-600">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs text-slate-500">Active gigs</div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">{gigs.filter((g) => g.status === "Open").length}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs text-slate-500">Applications</div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">{apps.length}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs text-slate-500">Accepted</div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">{apps.filter((a) => a.status === "Accepted").length}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs text-slate-500">Pending review</div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">{apps.filter((a) => a.status === "Applied").length}</div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-10 grid gap-6 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-900">Gig listings</div>
              <span className="text-xs text-slate-500">{gigs.length} total</span>
            </div>
            {loading && <div className="mt-4 text-xs text-slate-500">Loading gigs...</div>}
            <div className="mt-4 space-y-3">
              {gigs.map((gig) => (
                <div key={gig.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{gig.title}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {gig.company} • {gig.platform}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400"
                        onClick={() => startEdit(gig)}
                      >
                        Edit
                      </button>
                      <button
                        className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700"
                        onClick={() => deleteGig(gig.id)}
                      >
                        Remove
                      </button>
                      <select
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                        value={gig.gigType ?? "Part-time"}
                        onChange={(e) => updateGigType(gig.id, e.target.value as GigType)}
                      >
                        {GIG_TYPES.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                      <select
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                        value={gig.status}
                        onChange={(e) => updateGigStatus(gig.id, e.target.value as GigStatus)}
                      >
                        {STATUSES.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">{gig.location}</span>
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">{gig.workload}</span>
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">{gig.payout}</span>
                    {gig.gigType && <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">{gig.gigType}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">Applications</div>
                <div className="text-xs text-slate-500">Review and approve applicants.</div>
              </div>
              <select
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                value={selectedGigId}
                onChange={(e) => setSelectedGigId(e.target.value as string)}
              >
                <option value="All">All gigs</option>
                {gigs.map((gig) => (
                  <option key={gig.id} value={gig.id}>
                    {gig.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-4 space-y-3">
              {filteredApps.length === 0 && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-xs text-slate-500">
                  No applications yet.
                </div>
              )}
              {filteredApps.map((app) => (
                <div key={app.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{app.workerName ?? app.workerId}</div>
                      <div className="mt-1 text-xs text-slate-500">Gig: {app.gigId}</div>
                    </div>
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600">
                      {app.status}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>Applied {new Date(app.appliedAt).toLocaleDateString()}</span>
                    {app.decidedAt && <span>• Reviewed {new Date(app.decidedAt).toLocaleDateString()}</span>}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"
                      onClick={() => updateApplication(app, "Accepted")}
                    >
                      Accept
                    </button>
                    <button
                      className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700"
                      onClick={() => updateApplication(app, "Rejected")}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">KYC Review</div>
                <div className="text-xs text-slate-500">Approve or reject full-time access requests.</div>
              </div>
              <button
                className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400"
                onClick={fetchKyc}
              >
                Refresh
              </button>
            </div>

            {kycLoading && <div className="mt-4 text-xs text-slate-500">Loading KYC...</div>}
            {kycError && (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                {kycError}
              </div>
            )}

            <div className="mt-4 grid gap-3">
              {kycRows.length === 0 && !kycLoading && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-xs text-slate-500">
                  No KYC requests yet.
                </div>
              )}
              {kycRows.map((row) => (
                <div key={row.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{row.legal_name}</div>
                      {row.email && <div className="mt-1 text-xs text-slate-500">{row.email}</div>}
                      <div className="mt-1 text-xs text-slate-500">User ID: {row.user_id}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {row.id_type} • {row.id_number}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{row.phone}</div>
                      <div className="mt-1 text-xs text-slate-500">{row.address}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        {row.id_doc_url && (
                          <div className="flex items-center gap-2">
                            <img
                              src={row.id_doc_url}
                              alt="ID document"
                              className="h-12 w-12 rounded-md border border-slate-200 object-cover"
                            />
                            <a
                              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700"
                              href={row.id_doc_url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open ID
                            </a>
                            <a
                              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700"
                              href={`/api/kyc/file?path=${encodeURIComponent(row.id_doc_path)}&name=id-${row.id}.jpg`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Download
                            </a>
                          </div>
                        )}
                        {row.selfie_url && (
                          <div className="flex items-center gap-2">
                            <img
                              src={row.selfie_url}
                              alt="Selfie"
                              className="h-12 w-12 rounded-md border border-slate-200 object-cover"
                            />
                            <a
                              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700"
                              href={row.selfie_url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open selfie
                            </a>
                            <a
                              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700"
                              href={`/api/kyc/file?path=${encodeURIComponent(row.selfie_path)}&name=selfie-${row.id}.jpg`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Download
                            </a>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 text-xs">
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-600">
                        {row.status}
                      </span>
                      <input
                        className="w-56 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                        placeholder="Admin note (visible in timeline)"
                        value={kycNoteDraft[row.id] ?? ""}
                        onChange={(e) => setKycNoteDraft((p) => ({ ...p, [row.id]: e.target.value }))}
                        onBlur={async () => {
                          const note = kycNoteDraft[row.id] ?? "";
                          const { data } = await supabase.auth.getSession();
                          const token = data.session?.access_token;
                          if (!token) return;
                          await fetch("/api/admin/kyc", {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                            body: JSON.stringify({ id: row.id, status: row.status, adminNote: note }),
                          });
                          fetchKyc();
                        }}
                      />
                      <button
                        className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 font-semibold text-emerald-700"
                        onClick={async () => {
                          const note = kycNoteDraft[row.id] ?? null;
                          const { data } = await supabase.auth.getSession();
                          const token = data.session?.access_token;
                          if (!token) return;
                          await fetch("/api/admin/kyc", {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                            body: JSON.stringify({ id: row.id, status: "approved", adminNote: note }),
                          });
                          fetchKyc();
                        }}
                      >
                        Approve
                      </button>
                      <button
                        className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 font-semibold text-rose-700"
                        onClick={async () => {
                          const reason = window.prompt("Rejection reason (optional)");
                          const note = kycNoteDraft[row.id] ?? null;
                          const { data } = await supabase.auth.getSession();
                          const token = data.session?.access_token;
                          if (!token) return;
                          await fetch("/api/admin/kyc", {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                            body: JSON.stringify({ id: row.id, status: "rejected", rejectionReason: reason ?? null, adminNote: note }),
                          });
                          fetchKyc();
                        }}
                      >
                        Reject
                      </button>
                      {Array.isArray(row.events) && row.events.length > 0 && (
                        <button
                          className="rounded-full border border-slate-300 px-3 py-1 font-semibold text-slate-700 hover:border-slate-400"
                          onClick={() => setKycTimeline(row)}
                        >
                          View timeline
                        </button>
                      )}
                    </div>
                  </div>
                  {Array.isArray(row.events) && row.events.length > 0 && (
                    <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                      <div className="font-semibold text-slate-800">Timeline</div>
                      {row.events.slice(0, 3).map((ev: any, idx: number) => (
                        <div key={`${row.id}-${idx}`} className="mt-1">
                          {new Date(ev.created_at).toLocaleString()} • {ev.status}
                          {ev.note ? ` • ${ev.note}` : ""}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {kycTimeline && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
            <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <div>
                  <div className="text-sm font-semibold text-slate-900">KYC Timeline</div>
                  <div className="text-xs text-slate-500">{kycTimeline.legal_name}</div>
                </div>
                <button
                  className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400"
                  onClick={() => setKycTimeline(null)}
                >
                  Close
                </button>
              </div>
              <div className="max-h-[60vh] overflow-auto px-5 py-4 text-xs text-slate-700">
                {(kycTimeline.events ?? []).map((ev: any, idx: number) => (
                  <div key={`${kycTimeline.id}-${idx}`} className="mb-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="font-semibold text-slate-900">{ev.status}</div>
                    <div className="text-[11px] text-slate-500">{new Date(ev.created_at).toLocaleString()}</div>
                    {ev.note && <div className="mt-1 text-slate-700">{ev.note}</div>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <section className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">Credential submissions</div>
                <div className="text-xs text-slate-500">Review submitted account credentials.</div>
              </div>
              <span className="text-xs text-slate-500">{assignments.length} total</span>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {["Submitted", "Assigned", "Accepted", "Rejected", "Pending", "All"].map((status) => (
                <button
                  key={status}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    assignmentFilter === status
                      ? "border-blue-200 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                  onClick={() => setAssignmentFilter(status)}
                >
                  {status} {assignmentCounts[status] ? `(${assignmentCounts[status]})` : ""}
                </button>
              ))}
              <button
                className="ml-auto rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400 disabled:opacity-60"
                onClick={refreshAssignments}
                disabled={assignmentsRefreshing}
              >
                {assignmentsRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {filteredAssignments.length === 0 && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-xs text-slate-500">
                  No submissions yet.
                </div>
              )}
              {filteredAssignments.map((assignment) => {
                const cached = credsCache[assignment.id];
                const isNew =
                  assignment.submittedAt &&
                  lastRefreshAt &&
                  new Date(assignment.submittedAt).getTime() > new Date(lastRefreshAt).getTime();
                return (
                <div key={assignment.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{assignment.workerId}</div>
                      <div className="mt-1 text-xs text-slate-500">Gig: {assignment.gigId}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        Emails: {assignment.assignedEmails?.length ? `${assignment.assignedEmails.length} assigned` : assignment.assignedEmail}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isNew && (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          New
                        </span>
                      )}
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600">
                        {assignment.status}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    {assignment.submittedAt && <span>Submitted {new Date(assignment.submittedAt).toLocaleDateString()}</span>}
                    {assignment.decidedAt && <span>• Reviewed {new Date(assignment.decidedAt).toLocaleDateString()}</span>}
                  </div>
                  {cached && cached.length > 0 && (
                    <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                      <div className="font-semibold text-slate-800">Preview</div>
                      {cached.slice(0, 2).map((c) => (
                        <div key={c.id} className="mt-1">
                          {c.handle} • {c.email}
                        </div>
                      ))}
                      {cached.length > 2 && <div className="mt-1 text-slate-400">+{cached.length - 2} more</div>}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400"
                      onClick={() => openAssignment(assignment)}
                    >
                      View credentials
                    </button>
                    <button
                      className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400 disabled:opacity-60"
                      onClick={() => fetchAssignmentCreds(assignment.id)}
                      disabled={loadingCredsId === assignment.id}
                    >
                      {loadingCredsId === assignment.id ? "Loading..." : "Preview"}
                    </button>
                    <button
                      className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"
                      onClick={() => updateAssignment(assignment, "Accepted")}
                    >
                      Accept
                    </button>
                    <button
                      className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700"
                      onClick={() => updateAssignment(assignment, "Pending")}
                    >
                      Keep pending
                    </button>
                    <button
                      className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700"
                      onClick={() => updateAssignment(assignment, "Rejected")}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              )})}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-semibold text-slate-900">Selected submission</div>
            {!selectedAssignment && (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-xs text-slate-500">
                Select a submission to view credentials.
              </div>
            )}
            {selectedAssignment && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs text-slate-500">Assignment: {selectedAssignment.id}</div>
                  <div className="flex items-center gap-2">
                    <button
                      className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400 disabled:opacity-60"
                      onClick={() => openAdjacent(-1)}
                      disabled={selectedIndex <= 0}
                    >
                      Prev
                    </button>
                    <button
                      className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400 disabled:opacity-60"
                      onClick={() => openAdjacent(1)}
                      disabled={selectedIndex < 0 || selectedIndex >= filteredAssignments.length - 1}
                    >
                      Next
                    </button>
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
                  Assigned emails:{" "}
                  {selectedAssignment.assignedEmails?.length
                    ? selectedAssignment.assignedEmails.join(", ")
                    : selectedAssignment.assignedEmail}
                </div>
                {assignmentCreds.length === 0 && (
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-xs text-slate-500">
                    No credentials submitted yet.
                  </div>
                )}
                {assignmentCreds.map((cred) => (
                  <div key={cred.id} className="rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-700">
                    <div className="font-semibold text-slate-900">{cred.handle}</div>
                    <div className="mt-1">Email: {cred.email}</div>
                    <div className="mt-1">Password: {cred.password}</div>
                    {cred.phone && <div className="mt-1">Phone: {cred.phone}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

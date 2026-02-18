"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabaseClient";

type Platform = "Instagram" | "X" | "YouTube" | "LinkedIn" | "TikTok";
type PayoutType = "Per task" | "Per post" | "Monthly";
type GigStatus = "Open" | "Paused" | "Closed";
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
  gigType?: "Part-time" | "Full-time";
  requirements: string[];
  status: GigStatus;
  postedAt: string;
};

type GigApplication = {
  id: string;
  gigId: string;
  workerId: string;
  status: ApplicationStatus;
  appliedAt: string;
  decidedAt?: string;
};

function isFullTimeGig(gig: Pick<Gig, "gigType" | "title">) {
  const raw = String(gig.gigType ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  if (raw === "full-time" || raw === "fulltime") return true;
  return /\bfull[\s-]?time\b/i.test(gig.title || "");
}

type Role = "Admin" | "Worker";
type AuthSession = { role: Role; workerId?: string; at: string };

const LS_KEYS = {
  AUTH: "igops:auth",
  GIGS: "igops:gigs",
  GIG_APPS: "igops:gig-apps",
} as const;

const seedGigs: Gig[] = [
  {
    id: "GIG-1042",
    title: "Reel Creator — Lifestyle Skincare",
    company: "Lumina Labs",
    verified: true,
    platform: "Instagram",
    location: "Remote",
    workload: "12 reels / month",
    payout: "₹65,000",
    payoutType: "Monthly",
    gigType: "Part-time",
    requirements: ["10k+ followers", "Beauty niche experience", "3-day turnaround"],
    status: "Open",
    postedAt: "Posted 2 days ago",
  },
  {
    id: "GIG-1051",
    title: "Short-Form Editor — Fintech",
    company: "AxisPay",
    verified: true,
    platform: "X",
    location: "Remote",
    workload: "18 posts / week",
    payout: "₹1,200",
    payoutType: "Per post",
    gigType: "Part-time",
    requirements: ["Thread + visuals", "Daily reporting", "Compliance ready"],
    status: "Open",
    postedAt: "Posted today",
  },
  {
    id: "GIG-1017",
    title: "Creator Ops — Fitness Studio",
    company: "PulseCore",
    verified: true,
    platform: "TikTok",
    location: "Hybrid • Mumbai",
    workload: "20 clips / month",
    payout: "₹2,500",
    payoutType: "Per task",
    gigType: "Part-time",
    requirements: ["On-site shoots twice/month", "Editing in CapCut", "Brand-safe music"],
    status: "Open",
    postedAt: "Posted 4 days ago",
  },
  {
    id: "GIG-1099",
    title: "Brand Social Specialist — SaaS",
    company: "NimbusHQ",
    verified: true,
    platform: "LinkedIn",
    location: "Remote",
    workload: "10 posts / month",
    payout: "₹48,000",
    payoutType: "Monthly",
    gigType: "Part-time",
    requirements: ["B2B tone", "Carousel design", "Analytics reporting"],
    status: "Paused",
    postedAt: "Posted 1 day ago",
  },
  {
    id: "GIG-1104",
    title: "Shorts Creator — Consumer Tech",
    company: "Nova Devices",
    verified: true,
    platform: "YouTube",
    location: "Remote",
    workload: "8 shorts / week",
    payout: "₹1,800",
    payoutType: "Per post",
    gigType: "Part-time",
    requirements: ["Voice-over + captions", "UGC style", "48h turnaround"],
    status: "Open",
    postedAt: "Posted 3 hours ago",
  },
  {
    id: "GIG-1112",
    title: "Storyteller — Travel Brand",
    company: "SkyMiles Co.",
    verified: true,
    platform: "Instagram",
    location: "Remote",
    workload: "6 reels / month",
    payout: "₹28,000",
    payoutType: "Monthly",
    gigType: "Part-time",
    requirements: ["Travel niche", "On-camera presence", "Content calendar discipline"],
    status: "Closed",
    postedAt: "Posted 1 week ago",
  },
];

const STATUS_OPTIONS: GigStatus[] = ["Open", "Paused", "Closed"];
const PLATFORM_OPTIONS: Platform[] = ["Instagram", "X", "YouTube", "LinkedIn", "TikTok"];

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

export default function BrowsePage() {
  const [gigs, setGigs] = useState<Gig[]>([]);
  const [apps, setApps] = useState<GigApplication[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGig, setSelectedGig] = useState<Gig | null>(null);
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuClosing, setMenuClosing] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; left: number } | null>(null);
  const [displayName, setDisplayName] = useState<string>("User");
  const [kycStatus, setKycStatus] = useState<"none" | "pending" | "approved" | "rejected">("none");
  const isGuest = !role;

  const [keyword, setKeyword] = useState("");
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [payoutType, setPayoutType] = useState<PayoutType | "All">("All");
  const [statusFilter, setStatusFilter] = useState<GigStatus | "All">("All");
  const [gigTypeFilter, setGigTypeFilter] = useState<"All" | "Part-time" | "Full-time">("All");
  const [sortBy, setSortBy] = useState<"recent" | "payout-high" | "payout-low">("recent");
  const menuButtonRef = React.useRef<HTMLButtonElement | null>(null);

  const computeMenuAnchor = React.useCallback(() => {
    const el = menuButtonRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const popupWidth = 320;
    const margin = 12;
    const left = Math.max(margin, Math.min(rect.right - popupWidth, window.innerWidth - popupWidth - margin));
    setMenuAnchor({ top: rect.bottom + 8, left });
  }, []);

  useEffect(() => {
    const session = readLS<AuthSession | null>(LS_KEYS.AUTH, null);
    setRole(session?.role ?? null);
    if (session?.workerId) {
      setWorkerId(session.workerId);
      return;
    }
    if (session?.role === "Admin") {
      // Temporary testing path: allow Admin to apply with a test worker code.
      setWorkerId("ADMIN-TEST");
      return;
    }
    setWorkerId(null);
  }, []);

  const refreshKyc = async () => {
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (token) {
        const res = await fetch("/api/kyc", { headers: { Authorization: `Bearer ${token}` } });
        const payload = res.ok ? await res.json() : null;
        setKycStatus(payload?.status ?? "none");
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const name = data?.user?.user_metadata?.name ?? data?.user?.email ?? "User";
      if (alive) setDisplayName(String(name));
      await refreshKyc();
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    refreshKyc();
  }, [menuOpen]);

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
  }, [menuOpen, computeMenuAnchor]);

  useEffect(() => {
    if (!workerId) return;
    let timer: number | null = null;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      refreshKyc();
    };
    timer = window.setInterval(tick, 30000);
    const onVis = () => {
      if (document.visibilityState === "visible") refreshKyc();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      if (timer) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [workerId]);

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
  }, [menuOpen]);

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
    try {
      window.localStorage.removeItem(LS_KEYS.AUTH);
    } catch {}
    window.location.replace("/login?next=/browse");
  };

  function closeMenu() {
    if (!menuOpen) return;
    setMenuClosing(true);
    window.setTimeout(() => {
      setMenuOpen(false);
      setMenuClosing(false);
    }, 160);
  }

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/gigs", { method: "GET" });
        if (res.ok) {
          const data = await res.json();
          if (!alive) return;
          const safe = toArray<Gig>(data, seedGigs);
          setGigs(safe);
          writeLS(LS_KEYS.GIGS, safe);
        } else {
          throw new Error("Failed to load gigs");
        }
      } catch {
        const cached = toArray<Gig>(readLS(LS_KEYS.GIGS, seedGigs), seedGigs);
        setGigs(cached);
      }

      if (workerId) {
        try {
          const query = `?workerId=${encodeURIComponent(workerId)}`;
          const res = await fetch(`/api/gig-applications${query}`, { method: "GET" });
          if (res.ok) {
            const data = await res.json();
            if (!alive) return;
            const safe = toArray<GigApplication>(data, []);
            setApps(safe);
            writeLS(LS_KEYS.GIG_APPS, safe);
          } else {
            throw new Error("Failed to load apps");
          }
        } catch {
          const cached = toArray<GigApplication>(readLS(LS_KEYS.GIG_APPS, []), []);
          setApps(cached.filter((app) => app.workerId === workerId));
        }

        try {
          const res = await fetch(`/api/gig-assignments?workerId=${encodeURIComponent(workerId)}`, { method: "GET" });
          if (res.ok) {
            const data = await res.json();
            if (!alive) return;
            setAssignments(Array.isArray(data) ? data : []);
          }
        } catch {
          setAssignments([]);
        }
      } else if (alive) {
        setApps([]);
        setAssignments([]);
      }

      if (alive) setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [workerId]);

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    return gigs.filter((gig) => {
      if (statusFilter !== "All" && gig.status !== statusFilter) return false;
      if (gigTypeFilter !== "All" && gig.gigType !== gigTypeFilter) return false;
      if (payoutType !== "All" && gig.payoutType !== payoutType) return false;
      if (platforms.length > 0 && !platforms.includes(gig.platform)) return false;
      if (!k) return true;
      return (
        gig.title.toLowerCase().includes(k) ||
        gig.company.toLowerCase().includes(k) ||
        gig.platform.toLowerCase().includes(k)
      );
    });
  }, [gigs, keyword, platforms, payoutType, statusFilter, gigTypeFilter]);

  const appByGig = useMemo(() => {
    const map = new Map<string, GigApplication>();
    apps.forEach((app) => map.set(app.gigId, app));
    return map;
  }, [apps]);

  const assignmentByGig = useMemo(() => {
    const map = new Map<string, any>();
    assignments.forEach((a) => map.set(String(a.gigId ?? a.gig_id), a));
    return map;
  }, [assignments]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (keyword.trim()) count += 1;
    if (platforms.length > 0) count += 1;
    if (payoutType !== "All") count += 1;
    if (statusFilter !== "All") count += 1;
    if (gigTypeFilter !== "All") count += 1;
    return count;
  }, [keyword, platforms, payoutType, statusFilter, gigTypeFilter]);

  const visibleGigs = useMemo(() => {
    const withPayout = (value: string) => {
      const numeric = Number(value.replace(/[^\d]/g, ""));
      return Number.isFinite(numeric) ? numeric : 0;
    };
    const list = [...filtered];
    if (sortBy === "payout-high") {
      list.sort((a, b) => withPayout(b.payout) - withPayout(a.payout));
    } else if (sortBy === "payout-low") {
      list.sort((a, b) => withPayout(a.payout) - withPayout(b.payout));
    }
    return list;
  }, [filtered, sortBy]);

  const applyForGig = async (gig: Gig) => {
    if (!workerId) {
      window.location.href = "/login?next=/browse";
      return;
    }
    if (gig.status !== "Open") return;

    const optimistic: GigApplication = {
      id: `APP-${gig.id}-${workerId}`,
      gigId: gig.id,
      workerId,
      status: "Applied",
      appliedAt: new Date().toISOString(),
    };

    setApps((prev) => {
      const next = prev.filter((app) => app.gigId !== gig.id || app.workerId !== workerId);
      const updated = [optimistic, ...next];
      writeLS(LS_KEYS.GIG_APPS, updated);
      return updated;
    });

    try {
      const res = await fetch("/api/gig-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gigId: gig.id, workerId, status: "Applied" }),
      });
      if (res.ok) {
        const data = await res.json();
        setApps((prev) => {
          const next = prev.map((app) => (app.gigId === gig.id && app.workerId === workerId ? data : app));
          writeLS(LS_KEYS.GIG_APPS, next);
          return next;
        });
      }
      const nextPath = isFullTimeGig(gig) ? "/workspace" : `/proceed?gigId=${encodeURIComponent(gig.id)}`;
      window.location.href = nextPath;
    } catch {
      // keep optimistic
    }
  };

  const resetFilters = () => {
    setKeyword("");
    setPlatforms([]);
    setPayoutType("All");
    setStatusFilter("All");
    setGigTypeFilter("All");
  };

  const renderProfileMenu = (desktop = false) => (
    <>
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Navigation</div>
        <button
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-xs font-semibold text-slate-600 shadow-sm hover:border-slate-300 cursor-pointer"
          onClick={closeMenu}
          aria-label="Close menu"
        >
          ✕
        </button>
      </div>
      <div className={desktop ? "px-4 pb-4 pt-4" : "h-[calc(100vh-60px)] overflow-y-auto px-4 pb-4 pt-4"}>
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-4 py-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0b5cab] text-lg font-bold text-white">
              {displayName.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <div className="text-base font-semibold text-slate-900">{displayName}</div>
              <div className="text-xs text-slate-500">{role ? `${role} • ${workerId ? `ID ${workerId}` : "No worker ID"}` : "Guest"}</div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {isGuest ? (
              <>
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">Sign in required</span>
                <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-blue-700">Guest access</span>
              </>
            ) : (
              <>
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">KYC: {kycStatus}</span>
                <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-emerald-700">Trusted</span>
              </>
            )}
          </div>
        </div>

        {isGuest ? (
          <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-4">
            <div className="text-sm font-semibold text-slate-900">Sign in to unlock the workspace</div>
            <p className="mt-1 text-xs text-slate-600">Access assignments, payouts, and verified gigs once you’re signed in.</p>
            <div className="mt-3 grid gap-2">
              <Link className="rounded-xl bg-[#0b5cab] px-3 py-3 text-center text-xs font-semibold text-white hover:bg-[#0f6bc7] cursor-pointer" href="/login" onClick={closeMenu}>Sign in</Link>
              <Link className="rounded-xl border border-blue-200 bg-white px-3 py-3 text-center text-xs font-semibold text-blue-700 shadow-sm hover:border-blue-300 cursor-pointer" href="/signup" onClick={closeMenu}>Create account</Link>
              <Link className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-center text-xs font-semibold text-slate-700 shadow-sm hover:border-slate-300 cursor-pointer" href="/browse" onClick={closeMenu}>Browse gigs</Link>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Link className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs font-semibold text-slate-700 shadow-sm hover:border-slate-300 cursor-pointer" href="/workspace" onClick={closeMenu}>Workspace</Link>
              <Link className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs font-semibold text-slate-700 shadow-sm hover:border-slate-300 cursor-pointer" href="/browse" onClick={closeMenu}>Browse gigs</Link>
            </div>
            <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Quick links</div>
            <div className="mt-2 space-y-1">
              <Link className="flex items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer" href="/" onClick={closeMenu}>Home<span className="text-slate-400">›</span></Link>
              <Link className="flex items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer" href="/workspace" onClick={closeMenu}>Go to workspace<span className="text-slate-400">›</span></Link>
              {role === "Admin" && <Link className="flex items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer" href="/addgigs" onClick={closeMenu}>Admin console<span className="text-slate-400">›</span></Link>}
              <Link className="flex items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer" href="/workspace" onClick={closeMenu}>My assignments<span className="text-slate-400">›</span></Link>
            </div>
            <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50 px-3 py-2">
              <button className="w-full text-left text-sm font-semibold text-rose-600 cursor-pointer" onClick={signOut}>Sign out</button>
            </div>
          </>
        )}
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-[#f5faff] to-slate-50 text-slate-900">
      <div className="relative z-0 border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-5 sm:py-5">
          <div className="flex items-center gap-3 sm:gap-4 lg:gap-8">
            <Link href="/" className="shrink-0" aria-label="Go to home">
              <Image
                src="/reelencer-logo-transparent-v1.png"
                alt="Reelencer"
                width={1160}
                height={508}
                className="h-auto w-[125px] sm:w-[160px]"
                priority
              />
            </Link>
            <div className="hidden sm:block">
              <div className="inline-flex items-center rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                Browse gigs
              </div>
              <div className="mt-1 text-sm text-slate-500">Verified gig marketplace</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="relative" data-profile-menu>
              <button
                ref={menuButtonRef}
                className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:border-slate-300 cursor-pointer"
                onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0b5cab] text-sm font-bold text-white sm:h-9 sm:w-9">
                  {displayName.slice(0, 1).toUpperCase()}
                </span>
                <span className="text-slate-400">▾</span>
              </button>
              {menuOpen &&
                typeof document !== "undefined" &&
                createPortal(
                  <>
                    <div className="fixed inset-0 z-[9990] flex items-stretch justify-end bg-slate-900/45 md:hidden">
                      <div
                        data-profile-menu-panel
                        className={`fixed right-0 top-0 bottom-0 z-[9991] flex w-[88vw] max-w-[420px] flex-col rounded-none border-l border-slate-200 bg-white shadow-2xl transition-all duration-200 ease-out ${
                          menuClosing ? "animate-[slideOutRight_160ms_ease-in]" : "animate-[slideInRight_200ms_ease-out]"
                        }`}
                      >
                        {renderProfileMenu(false)}
                      </div>
                    </div>
                    <div
                      data-profile-menu-panel
                      className={`fixed z-[9991] hidden w-80 rounded-2xl border border-slate-200 bg-white shadow-2xl md:block ${
                        menuClosing ? "animate-[slideUp_160ms_ease-in]" : "animate-[slideDown_200ms_ease-out]"
                      }`}
                      style={menuAnchor ? { top: menuAnchor.top, left: menuAnchor.left } : { top: 80, right: 24 }}
                    >
                      {renderProfileMenu(true)}
                    </div>
                  </>,
                  document.body
                )}
            </div>
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-5 sm:py-8">
        <section className="relative grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
          <div className="pointer-events-none absolute -left-10 -top-10 hidden h-32 w-32 rounded-full bg-blue-100/70 blur-3xl lg:block" />
          <div className="pointer-events-none absolute -bottom-10 right-10 hidden h-32 w-32 rounded-full bg-emerald-100/50 blur-3xl lg:block" />
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">
              Corporate marketplace
            </div>
            <h1 className="mt-4 text-balance text-3xl font-semibold leading-tight text-slate-900 sm:text-4xl">
              Browse verified gigs from admins and trusted businesses.
            </h1>
            <p className="text-pretty mt-3 text-sm leading-relaxed text-slate-600 sm:text-base">
              Explore structured opportunities with clear requirements, workload expectations, and transparent payout
              structures. Apply directly to roles that match your platform expertise and earning goals.
            </p>
            {!workerId && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                Sign in to apply for gigs. Browsing is public, applications require an authenticated workspace session.
              </div>
            )}
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <div className="text-xs font-semibold text-slate-500">Marketplace summary</div>
            <div className="mt-4 grid grid-flow-col auto-cols-[72%] gap-3 overflow-x-auto pb-1 text-sm text-slate-600 sm:grid-flow-row sm:auto-cols-auto sm:grid-cols-2 sm:overflow-visible">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4">
                <div className="text-xs text-slate-500">Active gigs</div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">{gigs.filter((g) => g.status === "Open").length}</div>
              </div>
              <div className="rounded-2xl border border-blue-200 bg-blue-50/45 p-4">
                <div className="text-xs text-slate-500">Verified employers</div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">18</div>
              </div>
              <div className="rounded-2xl border border-violet-200 bg-violet-50/45 p-4">
                <div className="text-xs text-slate-500">Median payout</div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">₹52k</div>
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50/55 p-4">
                <div className="text-xs text-slate-500">Avg. response</div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">36h</div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-7 grid gap-6 lg:mt-10 lg:grid-cols-[320px_1fr]">
          <aside className="sticky top-20 hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:block">
            <div className="text-sm font-semibold text-slate-900">Filters</div>
            <div className="mt-4 space-y-4 text-sm text-slate-600">
              <div>
                <div className="text-xs font-semibold text-slate-500">Keyword</div>
                <input
                  className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0b5cab] focus:ring-2 focus:ring-[#0b5cab]/15"
                  placeholder="Search title, brand, platform"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                />
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">Platform</div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-700">
                  {PLATFORM_OPTIONS.map((p) => (
                    <label key={p} className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[#0b5cab]"
                        checked={platforms.includes(p)}
                        onChange={(e) => {
                          setPlatforms((prev) => (e.target.checked ? [...prev, p] : prev.filter((x) => x !== p)));
                        }}
                      />
                      {p}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">Payout model</div>
                <div className="mt-2 space-y-2">
                  {(["All", "Per task", "Per post", "Monthly"] as const).map((p) => (
                    <label key={p} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="payout"
                        className="h-4 w-4 accent-[#0b5cab]"
                        checked={payoutType === p}
                        onChange={() => setPayoutType(p)}
                      />
                      {p}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">Status</div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  {["All", ...STATUS_OPTIONS].map((s) => (
                    <button
                      key={s}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        statusFilter === s ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-50 text-slate-600"
                      }`}
                      onClick={() => setStatusFilter(s as GigStatus | "All")}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">Gig type</div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  {(["All", "Part-time", "Full-time"] as const).map((t) => (
                    <button
                      key={t}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        gigTypeFilter === t ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-50 text-slate-600"
                      }`}
                      onClick={() => setGigTypeFilter(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <button
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400"
                onClick={resetFilters}
              >
                Reset filters
              </button>
            </div>
          </aside>

          <section className="space-y-4">
            <div className="sticky top-2 z-10 -mx-1 rounded-2xl border border-slate-200 bg-white/90 px-3 py-3 text-sm text-slate-600 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/75 sm:mx-0 sm:px-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                <span className="font-semibold text-slate-900">Available gigs</span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs">
                  Showing {visibleGigs.length} of {gigs.length}
                </span>
              </div>
                <div className="flex flex-wrap items-center gap-2">
                <button
                  className={`rounded-full border px-3 py-1 text-xs font-semibold lg:hidden ${
                    filtersOpen ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-300 text-slate-700 hover:border-slate-400"
                  }`}
                  onClick={() => setFiltersOpen((v) => !v)}
                >
                  {filtersOpen ? "Hide filters" : "Filters"}
                  {activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
                </button>
                <span className="text-xs text-slate-500">Sort by</span>
                <select
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 shadow-sm"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as "recent" | "payout-high" | "payout-low")}
                >
                  <option value="recent">Most recent</option>
                  <option value="payout-high">Highest payout</option>
                  <option value="payout-low">Lowest payout</option>
                </select>
              </div>
            </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                <label className="relative block">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">⌕</span>
                  <input
                    className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 py-2.5 text-sm text-slate-900 outline-none focus:border-[#0b5cab] focus:ring-2 focus:ring-[#0b5cab]/15"
                    placeholder="Search title, brand, platform..."
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                  />
                </label>
                {activeFilterCount > 0 && (
                  <button
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-400"
                    onClick={resetFilters}
                  >
                    Clear all
                  </button>
                )}
              </div>
              {activeFilterCount > 0 && (
                <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                  {platforms.length > 0 && <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">Platforms: {platforms.join(", ")}</span>}
                  {payoutType !== "All" && <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">Payout: {payoutType}</span>}
                  {statusFilter !== "All" && <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">Status: {statusFilter}</span>}
                  {gigTypeFilter !== "All" && <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">Type: {gigTypeFilter}</span>}
                </div>
              )}
            </div>

            {filtersOpen && (
              <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden">
                <div className="absolute inset-0" onClick={() => setFiltersOpen(false)} />
                <div className="absolute bottom-0 left-0 right-0 max-h-[85vh] overflow-auto rounded-t-3xl border border-slate-200 bg-white p-5 pb-24 shadow-2xl">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-slate-900">Filters</div>
                    <button
                      className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700"
                      onClick={() => setFiltersOpen(false)}
                    >
                      Close
                    </button>
                  </div>
                  <div className="mt-4 space-y-4 text-sm text-slate-600">
                  <div>
                    <div className="text-xs font-semibold text-slate-500">Keyword</div>
                    <input
                      className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0b5cab] focus:ring-2 focus:ring-[#0b5cab]/15"
                      placeholder="Search title, brand, platform"
                      value={keyword}
                      onChange={(e) => setKeyword(e.target.value)}
                    />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-500">Platform</div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-700">
                      {PLATFORM_OPTIONS.map((p) => (
                        <label key={p} className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-[#0b5cab]"
                            checked={platforms.includes(p)}
                            onChange={(e) => {
                              setPlatforms((prev) => (e.target.checked ? [...prev, p] : prev.filter((x) => x !== p)));
                            }}
                          />
                          {p}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-500">Payout model</div>
                    <div className="mt-2 space-y-2">
                      {(["All", "Per task", "Per post", "Monthly"] as const).map((p) => (
                        <label key={p} className="flex items-center gap-2 text-sm">
                          <input
                            type="radio"
                            name="payout-mobile"
                            className="h-4 w-4 accent-[#0b5cab]"
                            checked={payoutType === p}
                            onChange={() => setPayoutType(p)}
                          />
                          {p}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-500">Status</div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      {["All", ...STATUS_OPTIONS].map((s) => (
                        <button
                          key={s}
                          className={`rounded-full border px-3 py-1 text-xs ${
                            statusFilter === s ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-50 text-slate-600"
                          }`}
                          onClick={() => setStatusFilter(s as GigStatus | "All")}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-500">Gig type</div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      {(["All", "Part-time", "Full-time"] as const).map((t) => (
                        <button
                          key={t}
                          className={`rounded-full border px-3 py-1 text-xs ${
                            gigTypeFilter === t ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-50 text-slate-600"
                          }`}
                          onClick={() => setGigTypeFilter(t)}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 px-5 py-3 backdrop-blur lg:hidden">
                    <div className="mx-auto flex max-w-6xl gap-2">
                      <button
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400"
                        onClick={resetFilters}
                      >
                        Reset
                      </button>
                      <button
                        className="w-full rounded-lg bg-[#0b5cab] px-3 py-2 text-sm font-semibold text-white hover:bg-[#0f6bc7]"
                        onClick={() => setFiltersOpen(false)}
                      >
                        Show {visibleGigs.length}
                      </button>
                    </div>
                  </div>
                </div>
                </div>
              </div>
            )}

            {loading && (
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
                Loading marketplace...
              </div>
            )}

            {!loading && visibleGigs.length === 0 && (
              <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
                <div className="text-base font-semibold text-slate-900">No gigs match your filters</div>
                <p className="mt-1">Try clearing filters or broadening your search terms.</p>
                <button
                  className="mt-3 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400"
                  onClick={resetFilters}
                >
                  Reset all filters
                </button>
              </div>
            )}

            <div className="grid gap-3 sm:gap-4">
              {visibleGigs.map((gig) => {
                const app = appByGig.get(gig.id);
                const assignment = assignmentByGig.get(gig.id);
                const isFullTime = isFullTimeGig(gig);
                const partTimeLocked = gig.gigType === "Part-time" && !!workerId && kycStatus !== "approved";
                const derivedStatus = app?.status ?? assignment?.status ?? undefined;
                const canApply = gig.status === "Open" && !!workerId && !partTimeLocked;
                const needsSignIn = !workerId;
                const canProceed =
                  !!workerId &&
                  !partTimeLocked &&
                  (app?.status === "Applied" || app?.status === "Accepted" || assignment?.status === "Submitted" || assignment?.status === "Assigned");
                const statusTone =
                  derivedStatus === "Accepted"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : derivedStatus === "Rejected"
                    ? "border-rose-200 bg-rose-50 text-rose-700"
                    : derivedStatus === "Applied" || derivedStatus === "Assigned"
                    ? "border-blue-200 bg-blue-50 text-blue-700"
                    : "border-slate-200 bg-slate-50 text-slate-600";
                const gigStatusTone =
                  gig.status === "Open"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : gig.status === "Paused"
                      ? "border-amber-200 bg-amber-50 text-amber-700"
                      : "border-slate-200 bg-slate-100 text-slate-600";
                const applyLabel = needsSignIn ? "Sign in to apply" : assignment ? "Assigned" : app ? "Applied" : "Apply now";
                const applyBtnClass = !canApply || !!app || !!assignment ? "bg-slate-300 text-white" : "bg-[#0b5cab] text-white shadow-sm hover:bg-[#0f6bc7]";
                if (partTimeLocked) {
                  return (
                    <div
                      key={gig.id}
                      className="relative overflow-hidden rounded-3xl border border-blue-200 bg-gradient-to-br from-blue-50 via-slate-50 to-sky-50 p-4 shadow-sm sm:p-6"
                    >
                      <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-blue-200/40 blur-2xl" />
                      <div className="pointer-events-none absolute -bottom-10 -left-8 h-28 w-28 rounded-full bg-slate-200/70 blur-2xl" />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-700">
                          Restricted Workstream
                        </span>
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-700">
                          Mini KYC Pending
                        </span>
                      </div>

                      <div className="mt-4 rounded-2xl border border-blue-200/70 bg-white/80 p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Hidden gig preview</div>
                        <div className="mt-3 space-y-2">
                          <div className="h-4 w-[72%] rounded-full bg-slate-200" />
                          <div className="h-3 w-[52%] rounded-full bg-slate-200/90" />
                          <div className="h-3 w-[86%] rounded-full bg-slate-200/80" />
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-500">
                            Role hidden
                          </span>
                          <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-500">
                            Payout hidden
                          </span>
                          <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-500">
                            Requirements hidden
                          </span>
                        </div>
                      </div>

                      <div className="mt-4 flex items-start gap-3">
                        <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-blue-200 bg-white">
                          <svg className="h-5 w-5 text-blue-700" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                            <path
                              fillRule="evenodd"
                              d="M10 2a4 4 0 0 0-4 4v2H5a2 2 0 0 0-2 2v5a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-5a2 2 0 0 0-2-2h-1V6a4 4 0 0 0-4-4Zm2 6V6a2 2 0 1 0-4 0v2h4Z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </div>
                        <div>
                          <div className="text-xl font-semibold leading-tight text-slate-900">Complete mini KYC to reveal this gig</div>
                          <div className="mt-1 text-sm text-slate-600">
                            This listing is policy-protected. After KYC approval, full role details and actions unlock automatically.
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <Link
                          href="/workspace"
                          className="inline-flex rounded-full bg-[#0b5cab] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0f6bc7]"
                        >
                          Complete mini KYC
                        </Link>
                        <span className="rounded-full border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-600">
                          Estimated review: 5-15 mins
                        </span>
                      </div>
                    </div>
                  );
                }
                return (
                  <div
                    key={gig.id}
                    className="relative overflow-hidden rounded-[1.35rem] border border-slate-200 bg-gradient-to-br from-white via-white to-slate-50/60 p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md animate-[slideDown_220ms_ease-out] sm:rounded-[1.5rem] sm:p-4 lg:p-5"
                  >
                    <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-blue-100/45 blur-2xl" />
                    <div>
                    <div className="flex flex-col gap-2.5 sm:gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500 sm:text-sm">
                          <span>{gig.postedAt}</span>
                          <span className="h-1 w-1 rounded-full bg-slate-300" />
                          <span>{gig.id}</span>
                          {gig.status === "Open" && <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700">Hiring now</span>}
                        </div>
                        <div className="mt-1.5 text-balance text-[1.15rem] font-semibold leading-tight text-slate-900 sm:text-[1.35rem] lg:text-[1.55rem]">{gig.title}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-slate-600 sm:mt-3 sm:gap-2">
                          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-800 sm:px-4 sm:py-1.5 sm:text-sm">{gig.company}</span>
                          {gig.verified && (
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 sm:px-3 sm:text-sm">
                              Verified
                            </span>
                          )}
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs sm:px-3 sm:text-sm">{gig.platform}</span>
                          {gig.gigType && (
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs sm:px-3 sm:text-sm">
                              {gig.gigType}
                            </span>
                          )}
                          {partTimeLocked && (
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 sm:px-3 sm:text-sm">
                              Mini KYC required
                            </span>
                          )}
                          {gig.gigType === "Full-time" && (
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 sm:px-3 sm:text-sm">
                              Workspace ready
                            </span>
                          )}
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs sm:px-3 sm:text-sm">{gig.location}</span>
                          <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold sm:px-3 sm:text-sm ${gigStatusTone}`}>{gig.status}</span>
                        </div>
                      </div>
                      <div className="flex w-full flex-col items-start gap-2 sm:gap-2.5 md:w-auto md:min-w-[220px] md:items-end">
                        <span className={`rounded-full border px-3 py-1 text-xs sm:px-4 sm:py-1.5 sm:text-sm ${statusTone}`}>
                          {derivedStatus ? `Status: ${derivedStatus}` : "Not applied"}
                        </span>
                        <div className="grid w-full grid-cols-2 gap-1.5 sm:gap-2 md:grid-cols-1">
                          <button
                            className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 sm:px-4 sm:py-2"
                            onClick={() => setSelectedGig(gig)}
                          >
                            View details
                          </button>
                          <button
                            className={`rounded-full px-3 py-1.5 text-xs font-semibold sm:px-4 sm:py-2 ${applyBtnClass}`}
                            onClick={() => applyForGig(gig)}
                            disabled={!canApply || !!app || !!assignment}
                          >
                            {applyLabel}
                          </button>
                          {canProceed && (
                            <Link
                              className="col-span-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-center text-xs font-semibold text-emerald-700 sm:px-4 sm:py-2 md:col-span-1"
                              href={isFullTime ? "/workspace" : `/proceed?gigId=${encodeURIComponent(gig.id)}`}
                            >
                              {isFullTime ? "Go to workspace" : "Proceed"}
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>

                    {assignment?.status === "Submitted" && (
                      <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-semibold text-blue-700">
                        In verification: Admin is reviewing your submitted credentials.
                      </div>
                    )}

                    <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-4 sm:gap-2.5 md:grid-cols-3">
                      <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600 sm:rounded-2xl sm:p-3.5">
                        <div className="text-xs text-slate-500 sm:text-sm">Workload</div>
                        <div className="mt-1.5 text-[1.1rem] font-semibold leading-tight text-slate-900 sm:text-[1.2rem]">{gig.workload}</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600 sm:rounded-2xl sm:p-3.5">
                        <div className="text-xs text-slate-500 sm:text-sm">Payout</div>
                        <div className="mt-1.5 text-[1.1rem] font-semibold leading-tight text-slate-900 sm:text-[1.2rem]">{gig.payout}</div>
                        <div className="text-xs text-slate-500 sm:text-sm">{gig.payoutType}</div>
                      </div>
                      <div className="col-span-2 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600 sm:rounded-2xl sm:p-3.5 md:col-span-1">
                        <div className="text-xs text-slate-500 sm:text-sm">Application status</div>
                        <div className="mt-1.5 text-[1.1rem] font-semibold leading-tight text-slate-900 sm:text-[1.2rem]">{derivedStatus ?? "Not applied"}</div>
                        <div className="text-xs text-slate-500 sm:text-sm">Updated hourly</div>
                      </div>
                    </div>

                    <div className="mt-3 sm:mt-4">
                      <div className="text-xs font-semibold text-slate-500 sm:text-sm">Key requirements</div>
                      <div className="mt-2 flex flex-wrap gap-1.5 sm:gap-2">
                        {gig.requirements.map((req) => (
                          <span key={req} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 sm:px-3 sm:py-1.5 sm:text-sm">
                            <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                            <span>{req}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </section>
      </main>

      {selectedGig && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/30 md:items-center" role="dialog" aria-modal="true">
          <div className="absolute inset-0" onClick={() => setSelectedGig(null)} />
          <div className="relative z-10 w-full max-w-2xl rounded-t-3xl border border-slate-200 bg-white p-5 shadow-xl md:rounded-3xl md:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs text-slate-500">{selectedGig.id}</div>
                <div className="mt-1 text-xl font-semibold text-slate-900">{selectedGig.title}</div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">{selectedGig.company}</span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">{selectedGig.platform}</span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">{selectedGig.location}</span>
                </div>
              </div>
              <button
                className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700"
                onClick={() => setSelectedGig(null)}
              >
                Close
              </button>
            </div>
            <div className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs text-slate-500">Workload</div>
                <div className="mt-1 text-base font-semibold text-slate-900">{selectedGig.workload}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs text-slate-500">Payout</div>
                <div className="mt-1 text-base font-semibold text-slate-900">{selectedGig.payout}</div>
                <div className="text-xs text-slate-500">{selectedGig.payoutType}</div>
              </div>
            </div>
            <div className="mt-4">
              <div className="text-xs font-semibold text-slate-500">Requirements</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {selectedGig.requirements.map((req) => (
                  <span key={req} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
                    {req}
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                className="rounded-full border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
                onClick={() => setSelectedGig(null)}
              >
                Close
              </button>
              <button
                className="rounded-full bg-[#0b5cab] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0f6bc7]"
                onClick={() => {
                  applyForGig(selectedGig);
                  setSelectedGig(null);
                }}
              >
                Apply now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

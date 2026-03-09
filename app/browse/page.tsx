"use client";

import React, { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabaseClient";

type Platform = "Instagram" | "X" | "YouTube" | "LinkedIn" | "TikTok";
type PayoutType = "Per task" | "Per post" | "Monthly";
type GigStatus = "Open" | "Paused" | "Closed";
type ApplicationStatus = "Applied" | "Pending" | "Accepted" | "Rejected" | "Withdrawn";

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
  gigType?: string;
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
  proposal?: {
    reviewStatus?: "Pending" | "Accepted" | "Rejected";
    adminNote?: string;
    adminExplanation?: string;
    whatsappLink?: string;
    reviewedAt?: string;
  };
};

type GigAssignment = {
  gigId?: string;
  gig_id?: string;
  status?: string;
};

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

function isCustomGig(gig: Pick<Gig, "gigType" | "title">) {
  return !isWorkspaceGig(gig) && !isEmailCreatorGig(gig);
}

type Role = "Admin" | "Worker";
type AuthSession = { role: Role; workerId?: string; at: string };

const LS_KEYS = {
  AUTH: "igops:auth",
  GIGS: "igops:gigs",
  GIG_APPS: "igops:gig-apps",
} as const;

const STATUS_OPTIONS: GigStatus[] = ["Open", "Paused", "Closed"];
const PLATFORM_OPTIONS: Platform[] = ["Instagram", "X", "YouTube", "LinkedIn", "TikTok"];
const DEMO_GIG_IDS = new Set(["GIG-1042", "GIG-1051", "GIG-1017", "GIG-1099", "GIG-1104", "GIG-1112"]);
const DEV_ADMIN_HEADERS: Record<string, string> = process.env.NODE_ENV !== "production" ? { "x-dev-bypass": "1" } : {};

function isSeedGig(gig: Gig) {
  return DEMO_GIG_IDS.has(String(gig.id));
}

function normalizeGigList(value: unknown) {
  return toArray<Gig>(value, []).filter((gig) => gig && typeof gig.id === "string" && !isSeedGig(gig));
}

function mergeGigLists(primary: Gig[], fallback: Gig[]) {
  const map = new Map<string, Gig>();
  for (const gig of fallback) {
    map.set(gig.id, gig);
  }
  for (const gig of primary) {
    map.set(gig.id, gig);
  }
  return Array.from(map.values());
}

function isGigActive(gig: Pick<Gig, "status">) {
  const raw = String(gig.status ?? "")
    .trim()
    .toLowerCase();
  return raw !== "closed" && raw !== "inactive" && raw !== "archived" && raw !== "deleted";
}

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

function toArray<T>(value: unknown, fallback: T[]): T[] {
  return Array.isArray(value) ? (value as T[]) : fallback;
}

async function fetchJsonWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 3500) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    return response;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function getBrowseDisplayName(user: { email?: string | null; user_metadata?: { name?: string; full_name?: string } }) {
  const explicitName = user.user_metadata?.name?.trim() || user.user_metadata?.full_name?.trim();
  if (explicitName) return explicitName;

  const email = user.email?.trim();
  if (!email) return "User";

  const local = email.split("@")[0]?.replace(/[._-]+/g, " ").trim();
  if (!local) return "User";

  return local.replace(/\b\w/g, (char) => char.toUpperCase());
}

function BrandMark({ compact = false, showTagline = true }: { compact?: boolean; showTagline?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-3 text-white">
      <div className={`relative overflow-hidden ${compact ? "h-11 w-11" : "h-14 w-14"}`}>
        <Image src="/logo-mark.svg" alt="Reelencer logo mark" fill sizes={compact ? "44px" : "56px"} className="object-contain" />
      </div>
      <div className="leading-none">
        <div
          className={`font-[Georgia,Times_New_Roman,serif] font-bold tracking-[-0.06em] text-white ${
            compact ? "text-[1.2rem] sm:text-[1.55rem]" : "text-[2.05rem] sm:text-[2.2rem]"
          }`}
        >
          Reelencer
        </div>
        {showTagline && (
          <div className={`${compact ? "mt-0.5 text-[0.72rem]" : "mt-1 text-[0.95rem]"} font-medium text-white/82`}>
            Freelance Creator Platform
          </div>
        )}
      </div>
    </Link>
  );
}

export default function BrowsePage() {
  const [gigs, setGigs] = useState<Gig[]>([]);
  const [apps, setApps] = useState<GigApplication[]>([]);
  const [assignments, setAssignments] = useState<GigAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGig, setSelectedGig] = useState<Gig | null>(null);
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuClosing, setMenuClosing] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; left: number } | null>(null);
  const [displayName, setDisplayName] = useState<string>("User");
  const [kycStatus, setKycStatus] = useState<"none" | "pending" | "approved" | "rejected">("none");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const isGuest = !role;
  const dashboardHref = role === "Admin" ? "/admin" : "/workspace";
  const loginHref = "/login?next=/browse";
  const signupHref = "/signup?next=/browse";
  const kycActionLabel = role === "Admin" ? "Open KYC Review" : "Complete mini KYC";

  const [keyword, setKeyword] = useState("");
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [payoutType, setPayoutType] = useState<PayoutType | "All">("All");
  const [statusFilter, setStatusFilter] = useState<GigStatus | "All">("All");
  const [gigTypeFilter, setGigTypeFilter] = useState<"All" | "Email Creator" | "Workspace" | "Custom">("All");
  const menuButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const hasApprovedKyc = role === "Worker" && (!!workerId || kycStatus === "approved");
  const kycBadgeStatus = hasApprovedKyc ? "approved" : kycStatus;
  const mobileDisplayName = displayName.trim().split(/\s+/)[0] || "User";
  const computeMenuAnchor = React.useCallback(() => {
    const el = menuButtonRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const popupWidth = 320;
    const margin = 12;
    const left = Math.max(margin, Math.min(rect.right - popupWidth, window.innerWidth - popupWidth - margin));
    setMenuAnchor({ top: rect.bottom + 8, left });
  }, []);

  const closeMenu = React.useCallback(() => {
    if (!menuOpen) return;
    setMenuClosing(true);
    window.setTimeout(() => {
      setMenuOpen(false);
      setMenuClosing(false);
    }, 160);
  }, [menuOpen]);

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

  const refreshKyc = React.useCallback(async () => {
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (token) {
        const res = await fetch("/api/kyc", { headers: { Authorization: `Bearer ${token}`, ...DEV_ADMIN_HEADERS } });
        const payload = res.ok ? await res.json() : null;
        setKycStatus(payload?.status ?? "none");
        if (payload?.status === "approved" && payload?.workerId && role === "Worker") {
          setWorkerId(String(payload.workerId));
        }
      }
    } catch {
      // ignore
    }
  }, [role]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      const name = user ? getBrowseDisplayName(user) : "User";
      if (alive) setDisplayName(String(name));
      void refreshKyc();
    })();
    return () => {
      alive = false;
    };
  }, [refreshKyc]);

  useEffect(() => {
    if (!menuOpen) return;
    refreshKyc();
  }, [menuOpen, refreshKyc]);

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
  }, [refreshKyc, workerId]);

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

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
    try {
      window.localStorage.removeItem(LS_KEYS.AUTH);
    } catch {}
    window.location.replace(loginHref);
  };

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      const cachedGigs = normalizeGigList(readLS(LS_KEYS.GIGS, []));
      if (alive && cachedGigs.length > 0) {
        setGigs(cachedGigs);
        setLoading(false);
      }

      let gigsLoaded = false;
      try {
        const res = await fetchJsonWithTimeout("/api/gigs", { method: "GET" }, 3500);
        if (!res.ok) throw new Error("Failed to load gigs");
        const data = await res.json();
        if (!alive) return;
        const liveGigs = normalizeGigList(data);
        const mergedGigs = mergeGigLists(liveGigs, cachedGigs);
        setGigs(mergedGigs);
        gigsLoaded = mergedGigs.length > 0;
        setLoading(false);
        if (mergedGigs.length > 0) {
          writeLS(LS_KEYS.GIGS, mergedGigs);
        }
      } catch {
        if (alive) setLoading(false);
      }

      if (!gigsLoaded && alive) {
        setGigs(cachedGigs);
        setLoading(false);
      }

      if (workerId) {
        const cachedApps = toArray<GigApplication>(readLS(LS_KEYS.GIG_APPS, []), []);
        if (alive) setApps(cachedApps.filter((app) => app.workerId === workerId));

        void (async () => {
          try {
            const query = `?workerId=${encodeURIComponent(workerId)}`;
            const res = await fetch(`/api/gig-applications${query}`, { method: "GET" });
            if (!res.ok) throw new Error("Failed to load apps");
            const data = await res.json();
            if (!alive) return;
            const safe = toArray<GigApplication>(data, []);
            setApps(safe);
            writeLS(LS_KEYS.GIG_APPS, safe);
          } catch {
            if (!alive) return;
            setApps(cachedApps.filter((app) => app.workerId === workerId));
          }
        })();

        void (async () => {
          try {
            const res = await fetch(`/api/gig-assignments?workerId=${encodeURIComponent(workerId)}`, { method: "GET" });
            if (!res.ok) throw new Error("Failed to load assignments");
            const data = await res.json();
            if (!alive) return;
            setAssignments(Array.isArray(data) ? data : []);
          } catch {
            if (!alive) return;
            setAssignments([]);
          }
        })();
      } else if (alive) {
        setApps([]);
        setAssignments([]);
      }
    })();

    return () => {
      alive = false;
    };
  }, [workerId]);

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    return gigs.filter((gig) => {
      if (statusFilter !== "All" && gig.status !== statusFilter) return false;
      if (gigTypeFilter !== "All") {
        if (gigTypeFilter === "Workspace" && !isWorkspaceGig(gig)) return false;
        if (gigTypeFilter === "Email Creator" && !isEmailCreatorGig(gig)) return false;
        if (gigTypeFilter === "Custom" && !isCustomGig(gig)) return false;
      }
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
    const map = new Map<string, GigAssignment>();
    assignments.forEach((a) => map.set(String(a.gigId ?? a.gig_id), a));
    return map;
  }, [assignments]);

  const visibleGigs = useMemo(() => filtered, [filtered]);

  const applyForGig = async (gig: Gig) => {
    if (!workerId) {
      window.location.href = loginHref;
      return;
    }
    if (gig.status !== "Open") return;
    window.location.href = `/proceed?gigId=${encodeURIComponent(gig.id)}`;
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
      <div className="flex items-center justify-between border-b border-white/8 px-4 py-4">
        <div className="text-xs font-semibold uppercase tracking-[0.28em] text-[#95ea63]">Command Center</div>
        <button
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-white/6 text-xs font-semibold text-white/80 shadow-sm transition hover:bg-white/10 cursor-pointer"
          onClick={closeMenu}
          aria-label="Close menu"
        >
          ✕
        </button>
      </div>
      <div className={desktop ? "px-4 pb-4 pt-4" : "h-[calc(100vh-60px)] overflow-y-auto px-4 pb-4 pt-4"}>
        <div className="rounded-[1.8rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,#8fe05f,#6fc447)] text-lg font-bold text-[#10251b]">
              {displayName.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <div className="text-base font-semibold text-white">{displayName}</div>
              <div className="text-xs text-white/50">{role ? `${role} • ${workerId ? `ID ${workerId}` : "No worker ID"}` : "Guest"}</div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {isGuest ? (
              <>
                <span className="inline-flex items-center rounded-full border border-white/10 bg-white/6 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-white/58">Sign in required</span>
                <span className="inline-flex items-center rounded-full border border-[#8fe05f]/35 bg-[#8fe05f]/10 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-[#a6f56f]">Guest access</span>
              </>
            ) : (
              <>
                <span className="inline-flex items-center rounded-full border border-white/10 bg-white/6 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-white/58">KYC: {kycBadgeStatus}</span>
                <span className={`inline-flex items-center rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.18em] ${hasApprovedKyc ? "border border-[#8fe05f]/35 bg-[#8fe05f]/10 text-[#a6f56f]" : "border border-white/10 bg-white/6 text-white/58"}`}>
                  {hasApprovedKyc ? "Trusted" : "Verification required"}
                </span>
              </>
            )}
          </div>
        </div>

        {isGuest ? (
          <div className="mt-4 rounded-[1.6rem] border border-white/10 bg-black/10 px-4 py-4">
            <div className="text-sm font-semibold text-white">Sign in to unlock the workspace</div>
            <p className="mt-1 text-xs leading-5 text-white/62">Access assignments, payouts, and verified gigs once you’re signed in.</p>
            <div className="mt-3 grid gap-2">
              <Link className="rounded-xl bg-[#8fe05f] px-3 py-3 text-center text-xs font-semibold text-[#10251b] transition hover:bg-[#9aed6d] cursor-pointer" href={loginHref} onClick={closeMenu}>Sign in</Link>
              <Link className="rounded-xl border border-white/10 bg-white/6 px-3 py-3 text-center text-xs font-semibold text-white shadow-sm transition hover:bg-white/10 cursor-pointer" href={signupHref} onClick={closeMenu}>Create account</Link>
              <Link className="rounded-xl border border-white/10 bg-white/6 px-3 py-3 text-center text-xs font-semibold text-white/82 shadow-sm transition hover:bg-white/10 cursor-pointer" href="/browse" onClick={closeMenu}>Browse gigs</Link>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Link className="rounded-xl border border-white/10 bg-white/6 px-3 py-3 text-xs font-semibold text-white shadow-sm transition hover:bg-white/10 cursor-pointer" href={dashboardHref} onClick={closeMenu}>{role === "Admin" ? "Admin" : "Workspace"}</Link>
              <Link className="rounded-xl border border-white/10 bg-white/6 px-3 py-3 text-xs font-semibold text-white shadow-sm transition hover:bg-white/10 cursor-pointer" href="/browse" onClick={closeMenu}>Browse gigs</Link>
            </div>
            <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/42">Quick links</div>
            <div className="mt-2 space-y-1">
              <Link className="flex items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold text-white/82 transition hover:bg-white/8 cursor-pointer" href="/" onClick={closeMenu}>Home<span className="text-white/35">›</span></Link>
              <Link className="flex items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold text-white/82 transition hover:bg-white/8 cursor-pointer" href={dashboardHref} onClick={closeMenu}>{role === "Admin" ? "Go to admin" : "Go to workspace"}<span className="text-white/35">›</span></Link>
              {role === "Admin" && <Link className="flex items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold text-white/82 transition hover:bg-white/8 cursor-pointer" href="/addgigs" onClick={closeMenu}>Admin console<span className="text-white/35">›</span></Link>}
              <Link className="flex items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold text-white/82 transition hover:bg-white/8 cursor-pointer" href={role === "Admin" ? dashboardHref : "/my-assignments"} onClick={closeMenu}>{role === "Admin" ? "Approval queue" : "My assignments"}<span className="text-white/35">›</span></Link>
            </div>
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/10 px-3 py-2">
              <button className="w-full text-left text-sm font-semibold text-[#ff9f9f] cursor-pointer" onClick={signOut}>Sign out</button>
            </div>
          </>
        )}
        <Link
          href="mailto:support@reelencer.com"
          className="group mt-4 flex items-center gap-3 rounded-2xl border border-white/14 bg-[linear-gradient(135deg,#1f2228,#171a1f)] px-3 py-3 text-left shadow-[0_14px_28px_rgba(0,0,0,0.28)] transition hover:border-white/22 hover:bg-[linear-gradient(135deg,#22262d,#1a1d23)]"
          onClick={closeMenu}
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-[1.25rem]">✉️</span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[0.72rem] font-semibold uppercase tracking-[0.13em] text-white/62">Send us mail for any query</span>
            <span className="block truncate text-[1.03rem] font-bold text-white">support@reelencer.com</span>
          </span>
          <span className="text-xl text-white/62 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5">↗</span>
        </Link>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-[#041f1a] text-white">
      <div className="relative isolate min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(45,130,105,0.22),transparent_34%),radial-gradient(circle_at_top_right,rgba(18,64,53,0.36),transparent_26%),linear-gradient(135deg,#0d4b3d_0%,#08342b_58%,#051916_100%)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(140,209,115,0.12)_1.1px,transparent_1.1px)] bg-[length:12px_12px] opacity-80" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/45 to-transparent" />
        <header className="relative z-30">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-3 pb-3 pt-3 sm:px-6 sm:pb-4 sm:pt-5 lg:px-8">
          <div className="flex items-center gap-3 sm:gap-4 lg:gap-8">
            <div className="hidden lg:block">
              <BrandMark showTagline={false} />
            </div>
            <div className="lg:hidden">
              <BrandMark compact showTagline={false} />
            </div>
            
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="relative" data-profile-menu>
              <button
                ref={menuButtonRef}
                className="flex items-center gap-1.5 rounded-full border border-white/12 bg-white/6 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-sm backdrop-blur-md transition hover:bg-white/10 cursor-pointer sm:gap-2 sm:px-3 sm:py-2 sm:text-xs"
                onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[linear-gradient(180deg,#8fe05f,#6fc447)] text-xs font-bold text-[#10251b] sm:h-9 sm:w-9 sm:text-sm">
                  {displayName.slice(0, 1).toUpperCase()}
                </span>
                <span className="max-w-[5rem] truncate text-xs text-white/90 sm:hidden">{mobileDisplayName}</span>
                <span className="hidden max-w-[12rem] truncate text-sm text-white/90 sm:block">{displayName}</span>
                <span className="text-white/45">▾</span>
              </button>
              {menuOpen &&
                typeof document !== "undefined" &&
                createPortal(
                  <>
                    <div className="fixed inset-0 z-[9990] flex items-stretch justify-end bg-black/45 md:hidden">
                      <div
                        data-profile-menu-panel
                        className={`fixed right-0 top-0 bottom-0 z-[9991] flex w-[88vw] max-w-[420px] flex-col rounded-none border-l border-white/10 bg-[#103e34]/98 text-white shadow-2xl transition-all duration-200 ease-out ${
                          menuClosing ? "animate-[slideOutRight_160ms_ease-in]" : "animate-[slideInRight_200ms_ease-out]"
                        }`}
                      >
                        {renderProfileMenu(false)}
                      </div>
                    </div>
                    <div
                      data-profile-menu-panel
                      className={`fixed z-[9991] hidden w-80 rounded-[1.6rem] border border-white/10 bg-[#103e34]/98 text-white shadow-2xl backdrop-blur-xl md:block ${
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
        </header>

        <main className="mx-auto w-full max-w-7xl px-4 pb-10 pt-2 sm:px-6 sm:pb-14 lg:px-8">
        <section className="relative grid gap-6 lg:grid-cols-[1.12fr_0.88fr] lg:items-center">
          <div>
            <h1 className="mt-5 max-w-4xl font-[Georgia,Times_New_Roman,serif] text-[2.45rem] leading-[0.94] font-bold tracking-[-0.045em] text-white sm:mt-6 sm:text-[3.35rem] lg:text-[4.2rem]">
              Browse Verified
              <br />
              Gigs, Clear
              <br />
              Payouts, Faster.
            </h1>
            <p className="mt-5 max-w-3xl text-[0.95rem] font-medium leading-[1.54] tracking-[-0.015em] text-white/80 sm:mt-6 sm:text-[1.08rem] lg:text-[1.18rem]">
              Explore Reelencer opportunities with structured briefs, visible workload expectations, and transparent payout logic. The browse flow now carries the same premium operating-system feel as the homepage.
            </p>
            {!workerId && (
              <div className="mt-4 inline-flex rounded-full border border-[#8fe05f]/25 bg-[#8fe05f]/8 px-3 py-1.5 text-xs font-medium text-[#b7f18e] sm:mt-5 sm:px-4 sm:py-2 sm:text-sm">
                Sign in to apply. Browsing stays public, applications require an authenticated workspace session.
              </div>
            )}
          </div>
          <div className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(22,72,60,0.88),rgba(10,38,31,0.92))] p-4 shadow-[0_25px_60px_rgba(0,0,0,0.18)] backdrop-blur-md sm:p-6">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[#95ea63]">Marketplace summary</div>
            <div className="mt-4 grid grid-flow-col auto-cols-[72%] gap-3 overflow-x-auto pb-1 text-sm text-white/70 sm:grid-flow-row sm:auto-cols-auto sm:grid-cols-2 sm:overflow-visible">
              <div className="rounded-[1.5rem] border border-white/8 bg-white/[0.04] p-4">
                <div className="text-xs text-white/45">Active gigs</div>
                <div className="mt-2 text-xl font-semibold text-white sm:text-2xl">{gigs.filter(isGigActive).length}</div>
              </div>
              <div className="rounded-[1.5rem] border border-white/8 bg-white/[0.04] p-4">
                <div className="text-xs text-white/45">Verified employers</div>
                <div className="mt-2 text-xl font-semibold text-white sm:text-2xl">18</div>
              </div>
              <div className="rounded-[1.5rem] border border-white/8 bg-white/[0.04] p-4">
                <div className="text-xs text-white/45">Median payout</div>
                <div className="mt-2 text-xl font-semibold text-white sm:text-2xl">₹52k</div>
              </div>
              <div className="rounded-[1.5rem] border border-white/8 bg-white/[0.04] p-4">
                <div className="text-xs text-white/45">Avg. response</div>
                <div className="mt-2 text-xl font-semibold text-white sm:text-2xl">36h</div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-7 grid gap-6 lg:mt-10 lg:grid-cols-[320px_1fr]">
          <aside className="sticky top-20 hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(20,68,56,0.94),rgba(7,31,26,0.92))] p-6 shadow-[0_24px_55px_rgba(0,0,0,0.16)] backdrop-blur-md lg:block">
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-[#95ea63]">Filters</div>
            <div className="mt-4 space-y-4 text-sm text-white/72">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/42">Keyword</div>
                <input
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-white/6 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-[#8fe05f]/45 focus:ring-2 focus:ring-[#8fe05f]/10"
                  placeholder="Search title, brand, platform"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                />
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/42">Platform</div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-white/78">
                  {PLATFORM_OPTIONS.map((p) => (
                    <label key={p} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/6 px-3 py-2.5">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[#8fe05f]"
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
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/42">Payout model</div>
                <div className="mt-2 space-y-2">
                  {(["All", "Per task", "Per post", "Monthly"] as const).map((p) => (
                    <label key={p} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="payout"
                        className="h-4 w-4 accent-[#8fe05f]"
                        checked={payoutType === p}
                        onChange={() => setPayoutType(p)}
                      />
                      {p}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/42">Status</div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  {["All", ...STATUS_OPTIONS].map((s) => (
                    <button
                      key={s}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        statusFilter === s ? "border-[#8fe05f]/40 bg-[#8fe05f]/10 text-[#b7f18e]" : "border-white/10 bg-white/6 text-white/62"
                      }`}
                      onClick={() => setStatusFilter(s as GigStatus | "All")}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/42">Gig type</div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  {(["All", "Email Creator", "Workspace", "Custom"] as const).map((t) => (
                    <button
                      key={t}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        gigTypeFilter === t ? "border-[#8fe05f]/40 bg-[#8fe05f]/10 text-[#b7f18e]" : "border-white/10 bg-white/6 text-white/62"
                      }`}
                      onClick={() => setGigTypeFilter(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <button
                className="mt-2 w-full rounded-2xl border border-white/10 bg-white/6 px-3 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                onClick={resetFilters}
              >
                Reset filters
              </button>
            </div>
          </aside>

          <section className="space-y-4">
            <div className="lg:hidden">
              <div className="flex items-center gap-3 rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-3 backdrop-blur-sm">
                <button
                  type="button"
                  onClick={() => setMobileFiltersOpen(true)}
                  className="inline-flex min-h-11 items-center justify-center rounded-[1rem] bg-[#8fe05f] px-4 text-xs font-semibold text-[#10251b] transition hover:bg-[#9aed6d] sm:min-h-12 sm:rounded-[1.2rem] sm:px-5 sm:text-sm"
                >
                  Open filters
                </button>
                <div className="min-w-0 flex-1">
                  <div className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-white/42">Marketplace view</div>
                  <div className="truncate text-sm text-white/78">
                    {visibleGigs.length} gigs matching your current filters
                  </div>
                </div>
              </div>
            </div>

            {loading && (
              <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] px-4 py-6 text-sm text-white/60 backdrop-blur-sm">
                Loading marketplace...
              </div>
            )}

            {!loading && visibleGigs.length === 0 && (
              <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-6 text-sm text-white/62 shadow-sm backdrop-blur-sm">
                <div className="text-base font-semibold text-white">No gigs match your filters</div>
                <p className="mt-1">Try clearing filters or broadening your search terms.</p>
                <button
                  className="mt-3 rounded-full border border-white/10 bg-white/6 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                  onClick={resetFilters}
                >
                  Reset all filters
                </button>
              </div>
            )}

            <div className="grid gap-3 sm:gap-4">
              {visibleGigs.map((gig, index) => {
                const app = appByGig.get(gig.id);
                const assignment = assignmentByGig.get(gig.id);
                const isFullTime = isWorkspaceGig(gig);
                const isFreelanceCustom = isCustomGig(gig);
                const isFeaturedCard = index === 0 || (index === 1 && visibleGigs[0]?.status !== "Open" && gig.status === "Open");
                const kycLocked = isFullTime && role === "Worker" && !hasApprovedKyc;
                const guestLocked = isGuest;
                const accessLocked = kycLocked || guestLocked;
                const kycActionHref =
                  role === "Admin"
                    ? "/addgigs#kyc-review"
                    : role === "Worker"
                      ? `/proceed?gigId=${encodeURIComponent(gig.id)}&kyc=1`
                      : loginHref;
                const proposalReviewStatus =
                  app?.proposal?.reviewStatus ??
                  (app?.status === "Accepted"
                    ? "Accepted"
                    : app?.status === "Rejected"
                      ? "Rejected"
                      : app?.status
                        ? "Pending"
                        : undefined);
                const derivedStatus = proposalReviewStatus ?? app?.status ?? assignment?.status ?? undefined;
                const canApply = gig.status === "Open" && !!workerId && !kycLocked;
                const needsSignIn = !workerId;
                const canProceed =
                  !!workerId &&
                  !kycLocked &&
                  (proposalReviewStatus === "Accepted" ||
                    app?.status === "Accepted" ||
                    assignment?.status === "Submitted" ||
                    assignment?.status === "Assigned");
                const statusTone =
                  derivedStatus === "Accepted"
                    ? "border-[#8fe05f]/35 bg-[#8fe05f]/10 text-[#b7f18e]"
                  : derivedStatus === "Rejected"
                    ? "border-[#ff8d8d]/30 bg-[#ff8d8d]/10 text-[#ffb0b0]"
                  : derivedStatus === "Applied" || derivedStatus === "Pending" || derivedStatus === "Assigned"
                    ? "border-white/12 bg-white/8 text-white/82"
                    : "border-white/10 bg-white/6 text-white/58";
                const gigStatusTone =
                  gig.status === "Open"
                    ? isFreelanceCustom
                      ? "border-[#bcd6c9] bg-[#edf5ef] text-[#2f6655]"
                      : "border-[#8fe05f]/35 bg-[#8fe05f]/10 text-[#b7f18e]"
                    : gig.status === "Paused"
                      ? isFreelanceCustom
                        ? "border-[#d4dfd7] bg-white text-[#5b7469]"
                        : "border-white/12 bg-white/8 text-white/72"
                      : isFreelanceCustom
                        ? "border-[#d4dfd7] bg-white text-[#7b9087]"
                        : "border-white/10 bg-white/6 text-white/50";
                const applyLabel = needsSignIn
                  ? "Sign in to apply"
                  : assignment
                  ? "Assigned"
                  : app
                  ? proposalReviewStatus === "Accepted"
                    ? "Approved"
                    : "In review"
                  : "Send proposal";
                const applyBtnClass =
                  !canApply || !!app || !!assignment
                    ? "bg-white/14 text-white/55"
                    : "bg-[#8fe05f] text-[#10251b] shadow-sm transition hover:bg-[#9aed6d]";
                if (accessLocked) {
                  return (
                    <div
                      key={gig.id}
                      className={`relative overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(17,61,51,0.96),rgba(8,33,28,0.96))] p-4 shadow-[0_22px_45px_rgba(0,0,0,0.16)] sm:p-6 ${isFeaturedCard ? "xl:col-span-2" : ""}`}
                    >
                      <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-[#5a45e3]/15 blur-2xl" />
                      <div className="pointer-events-none absolute -bottom-10 -left-8 h-28 w-28 rounded-full bg-[#8fe05f]/10 blur-2xl" />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="rounded-full border border-white/10 bg-white/6 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/72">
                          Protected Listing
                        </span>
                        <span className="rounded-full border border-[#8fe05f]/35 bg-[#8fe05f]/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#b7f18e]">
                          {guestLocked ? "Sign in required" : "Mini KYC Pending"}
                        </span>
                      </div>

                      <div className="mt-4 rounded-[1.4rem] border border-white/10 bg-white/[0.05] p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/42">Hidden gig preview</div>
                        <div className="mt-3 space-y-2">
                          <div className="h-4 w-[72%] rounded-full bg-white/14" />
                          <div className="h-3 w-[52%] rounded-full bg-white/12" />
                          <div className="h-3 w-[86%] rounded-full bg-white/10" />
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="rounded-full border border-white/10 bg-white/6 px-2.5 py-1 text-[10px] font-semibold text-white/45">
                            Role hidden
                          </span>
                          <span className="rounded-full border border-white/10 bg-white/6 px-2.5 py-1 text-[10px] font-semibold text-white/45">
                            Payout hidden
                          </span>
                          <span className="rounded-full border border-white/10 bg-white/6 px-2.5 py-1 text-[10px] font-semibold text-white/45">
                            Requirements hidden
                          </span>
                        </div>
                      </div>

                      <div className="mt-4 flex items-start gap-3">
                        <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/6">
                          <svg className="h-5 w-5 text-[#95ea63]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                            <path
                              fillRule="evenodd"
                              d="M10 2a4 4 0 0 0-4 4v2H5a2 2 0 0 0-2 2v5a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-5a2 2 0 0 0-2-2h-1V6a4 4 0 0 0-4-4Zm2 6V6a2 2 0 1 0-4 0v2h4Z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </div>
                        <div>
                          <div className="text-xl font-semibold leading-tight text-white">
                            {guestLocked
                              ? "Sign in to reveal this gig"
                              : "Complete mini KYC to reveal this gig"}
                          </div>
                          <div className="mt-1 text-sm text-white/62">
                            {guestLocked
                              ? "This listing is protected. Sign in to view full role details, payout terms, and application actions."
                              : "This listing is policy-protected. After KYC approval, full role details and actions unlock automatically."}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => window.location.assign(kycActionHref)}
                          className="inline-flex rounded-full bg-[#8fe05f] px-4 py-2 text-xs font-semibold text-[#10251b] transition hover:bg-[#9aed6d]"
                        >
                          {guestLocked ? "Sign in to continue" : kycActionLabel}
                        </button>
                        <span className="rounded-full border border-white/10 bg-white/6 px-3 py-2 text-[11px] text-white/58">
                          {guestLocked ? "Takes less than a minute" : "Estimated review: 5-15 mins"}
                        </span>
                      </div>
                    </div>
                  );
                }
                return (
                  <div
                    key={gig.id}
                    className="relative overflow-hidden rounded-[1.6rem] border border-white/10 bg-[linear-gradient(180deg,rgba(20,68,56,0.94),rgba(8,33,28,0.94))] p-3 shadow-[0_20px_45px_rgba(0,0,0,0.16)] transition hover:-translate-y-0.5 hover:border-white/16 hover:bg-[linear-gradient(180deg,rgba(22,76,62,0.96),rgba(8,33,28,0.96))] animate-[slideDown_220ms_ease-out] sm:rounded-[1.75rem] sm:p-4 lg:grid lg:grid-cols-[1.38fr_0.62fr] lg:gap-6 lg:p-5 xl:grid-cols-[1.48fr_0.52fr]"
                    style={{ animationDelay: `${Math.min(index, 8) * 55}ms`, animationFillMode: "both" }}
                  >
                    <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-[#5a45e3]/14 blur-2xl" />
                    <div>
                    <div className="flex flex-col gap-2.5 sm:gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-white/42 sm:text-sm">
                          <span>{gig.postedAt}</span>
                          <span className="h-1 w-1 rounded-full bg-white/25" />
                          <span>{gig.id}</span>
                          {gig.status === "Open" && (
                            <span className="rounded-full bg-[#8fe05f]/10 px-3 py-1 text-[11px] font-semibold text-[#b7f18e]">
                              Hiring now
                            </span>
                          )}
                          {isFeaturedCard && (
                            <span className="rounded-full bg-white/8 px-3 py-1 text-[11px] font-semibold text-white/80">
                              Featured match
                            </span>
                          )}
                          <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold md:hidden ${statusTone}`}>
                            {derivedStatus ? derivedStatus : "Not applied"}
                          </span>
                        </div>
                        <div className="mt-1.5 text-balance text-[1.25rem] font-semibold leading-tight text-white sm:text-[1.5rem] lg:text-[1.9rem]">{gig.title}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-white/62 sm:mt-2.5 sm:gap-2">
                          <span className="rounded-full border border-white/10 bg-white/6 px-2.5 py-1 text-xs font-semibold text-white sm:px-3 sm:py-1.5 sm:text-sm">{gig.company}</span>
                          {gig.verified && (
                            <span className="rounded-full border border-[#8fe05f]/35 bg-[#8fe05f]/10 px-2.5 py-1 text-xs font-semibold text-[#b7f18e] sm:px-3 sm:text-sm">
                              Verified
                            </span>
                          )}
                          <span className="rounded-full border border-white/10 bg-white/6 px-2.5 py-1 text-xs sm:px-3 sm:text-sm">{gig.platform}</span>
                          {gig.gigType && (
                            <span className="rounded-full border border-white/10 bg-white/6 px-2.5 py-1 text-xs sm:px-3 sm:text-sm">
                              {gig.gigType}
                            </span>
                          )}
                          {kycLocked && (
                            <span className="rounded-full border border-[#8fe05f]/35 bg-[#8fe05f]/10 px-2.5 py-1 text-xs font-semibold text-[#b7f18e] sm:px-3 sm:text-sm">
                              Mini KYC required
                            </span>
                          )}
                          {isFullTime && (
                            <span className="rounded-full border border-[#8fe05f]/35 bg-[#8fe05f]/10 px-2.5 py-1 text-xs font-semibold text-[#b7f18e] sm:px-3 sm:text-sm">
                              Workspace ready
                            </span>
                          )}
                          {isFreelanceCustom && (
                            <span className="rounded-full border border-[#8fe05f]/35 bg-[#8fe05f]/10 px-2.5 py-1 text-xs font-semibold text-[#b7f18e] sm:px-3 sm:text-sm">
                              Freelance marketplace
                            </span>
                          )}
                          <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold sm:px-3 sm:text-sm ${gigStatusTone}`}>{gig.status}</span>
                        </div>
                      </div>
                      <div className="flex w-full flex-col items-start gap-2 sm:gap-2.5 md:w-auto md:min-w-[250px] md:items-end lg:min-w-[290px]">
                        <span className={`hidden rounded-full border px-3 py-1 text-xs sm:px-4 sm:py-1.5 sm:text-sm md:inline-flex ${statusTone}`}>
                          {derivedStatus ? `Status: ${derivedStatus}` : "Not applied"}
                        </span>
                        <div className="grid w-full grid-cols-2 gap-1.5 sm:gap-2 md:grid-cols-1">
                          <button
                            className="rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/10 sm:px-4 sm:py-2"
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
                              className="col-span-2 rounded-full border border-[#8fe05f]/35 bg-[#8fe05f]/10 px-3 py-1.5 text-center text-xs font-semibold text-[#b7f18e] sm:px-4 sm:py-2 md:col-span-1"
                              href={isFullTime ? "/workspace" : `/proceed?gigId=${encodeURIComponent(gig.id)}`}
                            >
                              {isFullTime ? "Go to workspace" : isFreelanceCustom ? "Open proposal flow" : "Proceed"}
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>

                    {assignment?.status === "Submitted" && (
                      <div className="mt-4 rounded-2xl border border-[#8fe05f]/35 bg-[#8fe05f]/10 px-4 py-3 text-xs font-semibold text-[#b7f18e]">
                        In verification: Admin is reviewing your submitted credentials.
                      </div>
                    )}
                    {app && (
                      <div
                        className={`mt-3 rounded-2xl border px-4 py-3 text-xs ${
                          proposalReviewStatus === "Accepted"
                            ? "border-[#8fe05f]/35 bg-[#8fe05f]/10 text-[#b7f18e]"
                            : proposalReviewStatus === "Rejected"
                              ? "border-[#ff8d8d]/30 bg-[#ff8d8d]/10 text-[#ffb0b0]"
                              : "border-white/12 bg-white/8 text-white/80"
                        }`}
                      >
                        <div className="font-semibold">
                          {proposalReviewStatus === "Accepted"
                            ? "Proposal approved"
                            : proposalReviewStatus === "Rejected"
                              ? "Proposal needs revision"
                              : "Proposal under review"}
                        </div>
                        {app.proposal?.adminNote && <div className="mt-1 text-white/85">Note: {app.proposal.adminNote}</div>}
                        {app.proposal?.adminExplanation && <div className="mt-1 text-white/75">{app.proposal.adminExplanation}</div>}
                        {app.proposal?.whatsappLink && (
                          <a
                            href={app.proposal.whatsappLink}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-flex font-semibold underline underline-offset-2"
                          >
                            Join WhatsApp group
                          </a>
                        )}
                      </div>
                    )}

                    <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-4 sm:gap-2.5 md:grid-cols-3">
                      <div className="rounded-xl border border-white/10 bg-white/[0.05] p-3 text-sm text-white/62 sm:rounded-2xl sm:p-3.5">
                        <div className="text-xs text-white/42 sm:text-sm">Workload</div>
                        <div className="mt-1.5 text-[1.1rem] font-semibold leading-tight text-white sm:text-[1.2rem]">{gig.workload}</div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/[0.05] p-3 text-sm text-white/62 sm:rounded-2xl sm:p-3.5">
                        <div className="text-xs text-white/42 sm:text-sm">Budget</div>
                        <div className="mt-1.5 text-[1.1rem] font-semibold leading-tight text-white sm:text-[1.2rem]">{gig.payout}</div>
                        <div className="text-xs text-white/42 sm:text-sm">{gig.payoutType}</div>
                      </div>
                      <div className="col-span-2 rounded-xl border border-white/10 bg-white/[0.05] p-3 text-sm text-white/62 sm:rounded-2xl sm:p-3.5 md:col-span-1">
                        <div className="text-xs text-white/42 sm:text-sm">Application status</div>
                        <div className="mt-1.5 text-[1.1rem] font-semibold leading-tight text-white sm:text-[1.2rem]">{derivedStatus ?? "Not applied"}</div>
                        <div className="text-xs text-white/42 sm:text-sm">Updated hourly</div>
                      </div>
                    </div>

                    <div className="mt-3 sm:mt-4">
                      <div className="text-xs font-semibold text-white/42 sm:text-sm">Key requirements</div>
                      <div className="mt-2 flex flex-wrap gap-1.5 sm:gap-2">
                        {gig.requirements
                          .filter((req) => {
                            const lower = String(req).toLowerCase();
                            return !lower.startsWith("brief::") && !lower.startsWith("meta::") && !lower.startsWith("media::");
                          })
                          .map((req) => (
                          <span key={req} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] text-white/70 sm:px-3 sm:py-1.5 sm:text-sm">
                            <span className="h-1.5 w-1.5 rounded-full bg-[#8fe05f]" />
                            <span>{req}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                    </div>
                      <div className="mt-4 hidden w-full gap-3 lg:mt-0 lg:grid lg:max-w-[360px] lg:justify-self-end lg:content-start">
                        <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.05] p-4">
                          <div className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-[#95ea63]">Why this gig</div>
                          <div className="mt-3 text-sm leading-6 text-white/72">
                            Clear scope, visible payout model, and Reelencer workflow protections make this a stronger-fit opportunity for fast-moving freelance creators.
                          </div>
                        </div>
                        <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.05] p-4">
                          <div className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-white/42">Match signals</div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <span className="rounded-full border border-[#8fe05f]/35 bg-[#8fe05f]/10 px-3 py-1 text-xs font-semibold text-[#b7f18e]">Transparent payout</span>
                            <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs font-semibold text-white/72">Verified client</span>
                            <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs font-semibold text-white/72">Structured brief</span>
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

      {mobileFiltersOpen && (
        <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] lg:hidden">
          <div className="absolute inset-0" onClick={() => setMobileFiltersOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 rounded-t-[2rem] border-t border-white/10 bg-[linear-gradient(180deg,rgba(20,68,56,0.98),rgba(8,33,28,0.98))] p-5 shadow-[0_-20px_50px_rgba(0,0,0,0.25)] animate-[revealRise_260ms_ease-out]">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-[#95ea63]">Filters</div>
                <div className="mt-1 text-lg font-semibold text-white">Refine gigs faster</div>
              </div>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/6 text-white"
              >
                ✕
              </button>
            </div>
            <div className="mt-5 space-y-4 text-sm text-white/72">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/42">Keyword</div>
                <input
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-white/6 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35"
                  placeholder="Search title, brand, platform"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                />
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/42">Platform</div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-white/78">
                  {PLATFORM_OPTIONS.map((p) => (
                    <label key={p} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/6 px-3 py-2.5">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[#8fe05f]"
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/42">Status</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {["All", ...STATUS_OPTIONS].map((s) => (
                      <button
                        key={s}
                        className={`rounded-full border px-3 py-1.5 ${
                          statusFilter === s ? "border-[#8fe05f]/40 bg-[#8fe05f]/10 text-[#b7f18e]" : "border-white/10 bg-white/6 text-white/62"
                        }`}
                        onClick={() => setStatusFilter(s as GigStatus | "All")}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/42">Gig type</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {(["All", "Email Creator", "Workspace", "Custom"] as const).map((t) => (
                      <button
                        key={t}
                        className={`rounded-full border px-3 py-1.5 ${
                          gigTypeFilter === t ? "border-[#8fe05f]/40 bg-[#8fe05f]/10 text-[#b7f18e]" : "border-white/10 bg-white/6 text-white/62"
                        }`}
                        onClick={() => setGigTypeFilter(t)}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={resetFilters}
                  className="rounded-2xl border border-white/10 bg-white/6 px-4 py-3 text-sm font-semibold text-white"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => setMobileFiltersOpen(false)}
                  className="rounded-2xl bg-[#8fe05f] px-4 py-3 text-sm font-semibold text-[#10251b]"
                >
                  Apply filters
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedGig && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 backdrop-blur-[2px] md:items-center" role="dialog" aria-modal="true">
          <div className="absolute inset-0" onClick={() => setSelectedGig(null)} />
          <div className="relative z-10 w-full max-w-2xl rounded-t-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(20,68,56,0.98),rgba(8,33,28,0.98))] p-5 text-white shadow-xl md:rounded-[2rem] md:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs text-white/45">{selectedGig.id}</div>
                <div className="mt-1 text-xl font-semibold text-white">{selectedGig.title}</div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-white/62">
                  <span className="rounded-full border border-white/10 bg-white/6 px-2 py-0.5">{selectedGig.company}</span>
                  <span className="rounded-full border border-white/10 bg-white/6 px-2 py-0.5">{selectedGig.platform}</span>
                </div>
              </div>
              <button
                className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs font-semibold text-white"
                onClick={() => setSelectedGig(null)}
              >
                Close
              </button>
            </div>
            <div className="mt-4 grid gap-3 text-sm text-white/62 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
                <div className="text-xs text-white/42">Workload</div>
                <div className="mt-1 text-base font-semibold text-white">{selectedGig.workload}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
                <div className="text-xs text-white/42">Payout</div>
                <div className="mt-1 text-base font-semibold text-white">{selectedGig.payout}</div>
                <div className="text-xs text-white/42">{selectedGig.payoutType}</div>
              </div>
            </div>
            <div className="mt-4">
              <div className="text-xs font-semibold text-white/42">Requirements</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {selectedGig.requirements.map((req) => (
                  <span key={req} className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-white/70">
                    {req}
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                className="rounded-full border border-white/10 bg-white/6 px-4 py-2 text-xs font-semibold text-white"
                onClick={() => setSelectedGig(null)}
              >
                Close
              </button>
              <button
                className="rounded-full bg-[#8fe05f] px-4 py-2 text-xs font-semibold text-[#10251b] transition hover:bg-[#9aed6d]"
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
    </div>
  );
}

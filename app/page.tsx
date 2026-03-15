"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Role = "Admin" | "Worker" | null;
const AUTH_CACHE_KEY = "igops:auth";

const navItems = [
  {
    label: "Home",
    href: "#top",
    items: ["Platform overview", "Creator-first onboarding", "Trusted operations"],
  },
  {
    label: "How It Works",
    href: "#solution",
    items: ["Post opportunities", "Manage approvals", "Track payouts"],
  },
  {
    label: "Why Reelencer",
    href: "#company",
    items: ["Verified workflows", "Role-based access", "Operational clarity"],
  },
  {
    label: "Creator Stories",
    href: "#portfolio",
    items: ["Campaign showcases", "Delivery examples", "Performance outcomes"],
  },
  {
    label: "Help Center",
    href: "#resources",
    items: ["Guides and playbooks", "Support and contact", "Launch checklist"],
  },
] as const;

const trustStats = [
  { value: "18K+", label: "Verified creator workflows launched" },
  { value: "94%", label: "Campaign approval confidence" },
  { value: "36h", label: "Average payout visibility cycle" },
] as const;

const partnerNames = ["Replotre", "Gerox Ai", "Sarvam Ai", "Stake"] as const;

function getDisplayName(user: { email?: string | null; user_metadata?: { name?: string; full_name?: string } }) {
  const explicitName = user.user_metadata?.name?.trim() || user.user_metadata?.full_name?.trim();
  if (explicitName) return explicitName;

  const email = user.email?.trim();
  if (!email) return "Account";

  const local = email.split("@")[0]?.replace(/[._-]+/g, " ").trim();
  if (!local) return "Account";

  return local.replace(/\b\w/g, (char) => char.toUpperCase());
}

function readCachedRole(): Exclude<Role, null> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(AUTH_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { role?: string } | null;
    if (parsed?.role === "Admin" || parsed?.role === "Worker") return parsed.role;
    return null;
  } catch {
    return null;
  }
}

function writeCachedRole(role: Exclude<Role, null>) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(AUTH_CACHE_KEY);
    const prev = raw ? (JSON.parse(raw) as { workerId?: string } | null) : null;
    window.localStorage.setItem(
      AUTH_CACHE_KEY,
      JSON.stringify({
        role,
        workerId: prev?.workerId,
        at: Date.now(),
      })
    );
  } catch {
    // ignore
  }
}

function clearCachedRole() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(AUTH_CACHE_KEY);
  } catch {
    // ignore
  }
}

export default function HomePage() {
  const [menuOpen, setmenuOpen] = useState(false);
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const [role, setRole] = useState<Role>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [displayName, setDisplayName] = useState("Login");
  const [expandedMenu, setExpandedMenu] = useState<string>("Home");
  const [activeSection, setActiveSection] = useState<string>("Home");
  const [revealedSectionId, setRevealedSectionId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const trimmedEmail = email.trim();
  const scrollRafRef = useRef<number | null>(null);
  const revealTimeoutRef = useRef<number | null>(null);
  const accountPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    const cachedRole = readCachedRole();
    if (cachedRole && active) {
      setRole(cachedRole);
      setDisplayName(cachedRole === "Admin" ? "Admin" : "Workspace");
    }

    async function syncAuth() {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const user = sessionData.session?.user ?? null;
        if (!active || !user) {
          if (active) {
            setRole(null);
            setDisplayName("Login");
            clearCachedRole();
            setAuthResolved(true);
          }
          return;
        }

        const ensured = await supabase.rpc("ensure_profile");
        const profile = ensured.data as { role?: Exclude<Role, null> } | null;

        if (!active) return;

        setRole(profile?.role ?? "Worker");
        writeCachedRole(profile?.role ?? "Worker");
        setDisplayName(getDisplayName(user));
        setAuthResolved(true);
      } catch {
        if (!active) return;
        if (!cachedRole) {
          setRole(null);
          setDisplayName("Login");
        }
        setAuthResolved(true);
      }
    }

    void syncAuth();

    const { data: authSub } = supabase.auth.onAuthStateChange(() => {
      void syncAuth();
    });

    return () => {
      active = false;
      authSub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current);
      }
      if (revealTimeoutRef.current !== null) {
        window.clearTimeout(revealTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!accountPanelOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (!accountPanelRef.current?.contains(target)) setAccountPanelOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountPanelOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onEscape);
    };
  }, [accountPanelOpen]);

  useEffect(() => {
    const targets = [
      { id: "top", label: "Home" },
      { id: "solution", label: "How It Works" },
      { id: "company", label: "Why Reelencer" },
      { id: "portfolio", label: "Creator Stories" },
      { id: "resources", label: "Help Center" },
    ];

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (!visible) return;
        const match = targets.find((target) => target.id === visible.target.id);
        if (!match) return;
        setActiveSection(match.label);
      },
      { rootMargin: "-20% 0px -55% 0px", threshold: [0.2, 0.45, 0.7] }
    );

    targets.forEach((target) => {
      const el = document.getElementById(target.id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  const primaryHref = role === "Admin" ? "/admin" : role === "Worker" ? "/workspace" : "/signup?next=/";
  const primaryLabel = role ? "Open Dashboard" : "Start With Reelencer";
  const accountHref = role === "Admin" ? "/admin" : role === "Worker" ? "/workspace" : "/login?next=/";
  const browseHref = "/browse";
  const signupHref =
    role === "Admin"
      ? "/admin"
      : role === "Worker"
        ? "/workspace"
        : trimmedEmail
          ? `/signup?next=/&email=${encodeURIComponent(trimmedEmail)}`
          : "/signup?next=/";
  const loginHref = trimmedEmail ? `/login?next=/&email=${encodeURIComponent(trimmedEmail)}` : "/login?next=/";
  const accountLabel = authResolved ? (role ? displayName : "Login") : "";
  const navAccountLabel = accountLabel || "Login";
  const navAccountFirstWord = navAccountLabel.trim().split(/\s+/)[0] || "Login";
  const accountInitial = accountLabel.trim().charAt(0).toUpperCase() || "L";

  async function handleSignOut() {
    try {
      await supabase.auth.signOut();
    } finally {
      clearCachedRole();
      setRole(null);
      setDisplayName("Login");
      setAccountPanelOpen(false);
      window.location.assign("/");
    }
  }

  function easeInOutQuint(t: number) {
    return t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;
  }

  function animateToSection(sectionHref: string, sectionLabel: string) {
    if (typeof window === "undefined") return;
    const id = sectionHref.replace(/^#/, "");
    const target = document.getElementById(id);
    if (!target) return;

    if (scrollRafRef.current !== null) {
      window.cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }

    const startY = window.scrollY;
    const rect = target.getBoundingClientRect();
    const targetY = Math.max(0, startY + rect.top - 12);
    const distance = targetY - startY;
    const duration = Math.min(1200, Math.max(560, Math.abs(distance) * 0.55));
    const start = performance.now();

    setActiveSection(sectionLabel);
    window.history.replaceState(null, "", sectionHref);

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = easeInOutQuint(progress);
      window.scrollTo({ top: startY + distance * eased });
      if (progress < 1) {
        scrollRafRef.current = window.requestAnimationFrame(tick);
      } else {
        window.scrollTo({ top: targetY });
        scrollRafRef.current = null;
        if (revealTimeoutRef.current !== null) {
          window.clearTimeout(revealTimeoutRef.current);
        }
        setRevealedSectionId(id);
        revealTimeoutRef.current = window.setTimeout(() => setRevealedSectionId(null), 720);
      }
    };

    scrollRafRef.current = window.requestAnimationFrame(tick);
  }

  function sectionRevealClass(id: string) {
    return revealedSectionId === id ? "section-swipe-settle" : "";
  }

  function handleLeadSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    window.location.assign(signupHref);
  }

  return (
    <div className="min-h-screen bg-[#041f1a] text-white">
      <div
        id="top"
        className="relative isolate min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(45,130,105,0.22),transparent_34%),radial-gradient(circle_at_top_right,rgba(18,64,53,0.36),transparent_26%),linear-gradient(135deg,#0d4b3d_0%,#08342b_58%,#051916_100%)]"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(140,209,115,0.12)_1.1px,transparent_1.1px)] bg-[length:12px_12px] opacity-80" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/45 to-transparent" />
        <div className="pointer-events-none absolute right-[9%] top-[21%] hidden h-44 w-44 rounded-full bg-[#8fe05f]/10 blur-3xl lg:block" />
        <div className="pointer-events-none absolute left-[5%] top-[30%] hidden h-52 w-52 rounded-full bg-[#5a45e3]/10 blur-3xl lg:block" />

        <aside
          className={`fixed inset-y-0 left-0 z-[70] flex w-[84vw] max-w-[360px] flex-col border-r border-white/12 bg-[linear-gradient(180deg,#133f35_0%,#10362f_52%,#0d2d27_100%)] px-4 py-6 shadow-[28px_0_64px_rgba(0,0,0,0.42)] backdrop-blur-xl transition-[transform,opacity] duration-500 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${
            menuOpen ? "translate-x-0 opacity-100" : "-translate-x-[104%] opacity-0"
          }`}
          aria-hidden={!menuOpen}
        >
          <div
            className={`flex items-start justify-between transition-all duration-500 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${
              menuOpen ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
            }`}
          >
            <BrandMark compact />
            <button
              type="button"
              onClick={() => setmenuOpen(false)}
              className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/35 bg-white/[0.02] text-white/95 transition hover:border-white/55 hover:bg-white/8"
              aria-label="Close navigation"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>

          <nav className="mt-12 space-y-1">
            {navItems.map((item, index) => (
              <div
                key={item.label}
                className={`border-b border-white/10 py-3.5 transition-all duration-500 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${
                  menuOpen ? "translate-x-0 opacity-100" : "-translate-x-4 opacity-0"
                }`}
                style={{ transitionDelay: menuOpen ? `${90 + index * 45}ms` : "0ms" }}
              >
                <button
                  type="button"
                  onClick={() => setExpandedMenu((current) => (current === item.label ? "" : item.label))}
                  className={`flex w-full items-center justify-between py-1 text-left text-[1.1rem] font-semibold tracking-[-0.01em] ${activeSection === item.label ? "text-white" : "text-white/90"}`}
                >
                  <span>{item.label}</span>
                  <span className={`${activeSection === item.label ? "text-white/92" : "text-white/62"}`}>
                    {expandedMenu === item.label ? "−" : "+"}
                  </span>
                </button>
                <div className={`grid transition-all duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${expandedMenu === item.label ? "mt-2 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                  <div className="overflow-hidden">
                    <div className="space-y-2 pt-1 pb-1">
                      <a
                        href={item.href}
                        onClick={(event) => {
                          event.preventDefault();
                          setmenuOpen(false);
                          animateToSection(item.href, item.label);
                        }}
                        className="block text-sm font-medium text-white/78 transition hover:text-white"
                      >
                        Open {item.label}
                      </a>
                      {item.items.map((subitem) => (
                        <div key={subitem} className="text-sm text-white/46">
                          {subitem}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </nav>

          <div className="mt-auto hidden rounded-[1.6rem] border border-white/8 bg-black/10 p-4 md:block">
            <div className="text-xs font-semibold uppercase tracking-[0.26em] text-[#95ea63]">Reelencer Support</div>
            <div className="mt-3 text-2xl font-bold tracking-[-0.04em] text-white">Fast, reliable support for creators and operators.</div>
            <div className="mt-2 text-sm leading-6 text-white/65">
              Access your workspace, browse verified gigs, and contact support from one streamlined experience.
            </div>
          </div>

          <div
            className={`mt-6 pt-4 transition-all duration-500 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${
              menuOpen ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
            }`}
            style={{ transitionDelay: menuOpen ? "300ms" : "0ms" }}
          >
            <Link
              href="mailto:support@reelencer.com"
              className="group flex items-center gap-3 rounded-2xl border border-white/14 bg-[linear-gradient(135deg,#1f2228,#171a1f)] px-3 py-3 text-left shadow-[0_14px_28px_rgba(0,0,0,0.28)] transition hover:border-white/24 hover:bg-[linear-gradient(135deg,#232833,#1b2029)]"
              onClick={() => setmenuOpen(false)}
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-[1.25rem]">✉️</span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[0.72rem] font-semibold uppercase tracking-[0.13em] text-white/62">Send us mail for any query</span>
                <span className="block truncate text-[1.03rem] font-bold text-white">support@reelencer.com</span>
              </span>
              <span className="text-xl text-white/62 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5">↗</span>
            </Link>
          </div>
        </aside>

        <button
          type="button"
          className={`fixed inset-0 z-[65] transition-all duration-500 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${
            menuOpen ? "pointer-events-auto bg-black/52 backdrop-blur-[3px] opacity-100" : "pointer-events-none bg-black/0 backdrop-blur-0 opacity-0"
          }`}
          onClick={() => setmenuOpen(false)}
          aria-label="Dismiss navigation overlay"
        />
        <button
          type="button"
          className={`fixed inset-0 z-[65] hidden transition-all duration-500 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] lg:block ${
            accountPanelOpen ? "pointer-events-auto bg-black/34 backdrop-blur-[2px] opacity-100" : "pointer-events-none bg-black/0 backdrop-blur-0 opacity-0"
          }`}
          onClick={() => setAccountPanelOpen(false)}
          aria-label="Dismiss account panel overlay"
        />

        <header className="relative z-30 lg:z-50">
          <div className="relative mx-auto flex w-full max-w-7xl items-center justify-between px-3 pb-3 pt-3 sm:px-6 sm:pb-4 sm:pt-5 lg:px-8">
            <div>
              <BrandMark showTagline={false} />
            </div>
            

            <nav className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-2 py-2 backdrop-blur-md">
              {navItems.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  onClick={(event) => {
                    event.preventDefault();
                    animateToSection(item.href, item.label);
                  }}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${activeSection === item.label ? "bg-white text-[#0b211b]" : "text-white/74 hover:bg-white/8 hover:text-white"}`}
                >
                  {item.label}
                </a>
              ))}
            </nav>

            <div className="flex items-center gap-3">
              <Link
                href={accountHref}
                className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[1rem] font-semibold text-white transition hover:bg-white/8 sm:gap-1.5 sm:px-2 sm:text-[1.15rem]"
              >
                <span className="max-w-[4.5rem] truncate sm:hidden">{navAccountFirstWord}</span>
                <span className="hidden max-w-[5rem] truncate sm:inline sm:max-w-[7rem]">{navAccountLabel}</span>
                <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 sm:h-6 sm:w-6" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <circle cx="12" cy="8" r="4" />
                  <path strokeLinecap="round" d="M4 20c2-4 5.2-6 8-6s6 2 8 6" />
                </svg>
              </Link>
              <div ref={accountPanelRef} className="relative hidden">
                <button
                  type="button"
                  onClick={() => setAccountPanelOpen((prev) => !prev)}
                  className="inline-flex h-16 items-center gap-3 rounded-full border border-white/14 bg-white/[0.04] px-4 pr-5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] backdrop-blur-md transition hover:bg-white/[0.08]"
                  aria-haspopup="dialog"
                  aria-expanded={accountPanelOpen}
                  aria-label="Open account navigation"
                >
                  <span className="grid h-12 w-12 place-items-center rounded-full bg-[#95ea63] text-[1.85rem] font-black text-[#0b211b]">
                    {accountInitial}
                  </span>
                  <svg
                    viewBox="0 0 20 20"
                    className={`h-5 w-5 text-white/72 transition-transform ${accountPanelOpen ? "rotate-180" : "rotate-0"}`}
                    fill="currentColor"
                  >
                    <path d="M5.5 7.5 10 12l4.5-4.5" />
                  </svg>
                </button>

                <div
                  className={`fixed inset-y-0 left-0 z-[70] flex w-[84vw] max-w-[330px] flex-col border-r border-white/10 bg-[#154d3f] transition-[transform,opacity] duration-500 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${
                    accountPanelOpen ? "translate-x-0 opacity-100" : "pointer-events-none -translate-x-[104%] opacity-0"
                  }`}
                  role="dialog"
                  aria-hidden={!accountPanelOpen}
                >
                  <div className="flex items-center justify-between border-b border-white/8 px-4 py-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.28em] text-[#95ea63]">Command Center</div>
                    <button
                      type="button"
                      onClick={() => setAccountPanelOpen(false)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-white/6 text-xs font-semibold text-white/80 shadow-sm transition hover:bg-white/10"
                      aria-label="Close navigation panel"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="h-[calc(100vh-60px)] overflow-y-auto px-4 pb-4 pt-4">
                    <div className="rounded-[1.8rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                      <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,#8fe05f,#6fc447)] text-lg font-bold text-[#10251b]">
                          {accountInitial}
                        </div>
                        <div>
                          <div className="text-base font-semibold text-white">{accountLabel || "Account"}</div>
                          <div className="text-xs text-white/50">{role ? `${role} • ID ${role === "Admin" ? "ADMIN-TEST" : "USER"}` : "Guest"}</div>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="inline-flex items-center rounded-full border border-white/10 bg-white/6 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-white/58">
                          KYC: none
                        </span>
                        <span className="inline-flex items-center rounded-full border border-white/10 bg-white/6 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-white/58">
                          Verification required
                        </span>
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <Link
                        className="rounded-xl border border-white/10 bg-white/6 px-3 py-3 text-xs font-semibold text-white shadow-sm transition hover:bg-white/10"
                        href={accountHref}
                        onClick={() => setAccountPanelOpen(false)}
                      >
                        {role === "Admin" ? "Admin" : role === "Worker" ? "Workspace" : "Sign in"}
                      </Link>
                      <Link
                        className="rounded-xl border border-white/10 bg-white/6 px-3 py-3 text-xs font-semibold text-white shadow-sm transition hover:bg-white/10"
                        href={browseHref}
                        onClick={() => setAccountPanelOpen(false)}
                      >
                        Browse gigs
                      </Link>
                    </div>
                    <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/42">Quick links</div>
                    <div className="mt-2 space-y-1">
                      <button
                        type="button"
                        onClick={() => {
                          animateToSection("#top", "Home");
                          setAccountPanelOpen(false);
                        }}
                        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-semibold text-white/82 transition hover:bg-white/8"
                      >
                        Home
                        <span className="text-white/35">›</span>
                      </button>
                      <Link
                        className="flex items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold text-white/82 transition hover:bg-white/8"
                        href={accountHref}
                        onClick={() => setAccountPanelOpen(false)}
                      >
                        {role === "Admin" ? "Go to admin" : role === "Worker" ? "Go to workspace" : "Go to login"}
                        <span className="text-white/35">›</span>
                      </Link>
                      <Link
                        className="flex items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold text-white/82 transition hover:bg-white/8"
                        href="/addgigs/create-new-gig"
                        onClick={() => setAccountPanelOpen(false)}
                      >
                        Admin console
                        <span className="text-white/35">›</span>
                      </Link>
                      <Link
                        className="flex items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold text-white/82 transition hover:bg-white/8"
                        href="/addgigs/kyc-review"
                        onClick={() => setAccountPanelOpen(false)}
                      >
                        Approval queue
                        <span className="text-white/35">›</span>
                      </Link>
                    </div>
                    {role ? (
                      <div className="mt-4 rounded-2xl border border-white/10 bg-black/10 px-3 py-2">
                        <button className="w-full text-left text-sm font-semibold text-[#ff9f9f]" onClick={handleSignOut}>
                          Sign out
                        </button>
                      </div>
                    ) : (
                      <div className="mt-4 rounded-2xl border border-white/10 bg-black/10 px-3 py-2">
                        <Link href={loginHref} className="block w-full text-left text-sm font-semibold text-white/88" onClick={() => setAccountPanelOpen(false)}>
                          Sign in
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setExpandedMenu("");
                  setAccountPanelOpen(false);
                  setmenuOpen(true);
                }}
                className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-white/70 bg-white/4 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-md transition hover:bg-white/10 sm:h-14 sm:w-14 sm:rounded-2xl"
                aria-label="Open navigation"
              >
                <svg viewBox="0 0 24 24" className="h-6 w-6 sm:h-7 sm:w-7" fill="none" stroke="currentColor" strokeWidth="2.4">
                  <path strokeLinecap="round" d="M6 7h12M10 12h8M6 17h12" />
                </svg>
              </button>
            </div>
          </div>
        </header>

        <main className="relative z-20">
          <section className="mx-auto hidden w-full max-w-7xl grid-cols-12 gap-8 px-4 pb-18 pt-6 lg:grid lg:px-8 lg:pt-10">
            <div className="col-span-6 pt-10 xl:col-span-7">
              <div className="inline-flex items-center rounded-full border border-[#79a96c]/30 bg-[#2f624e]/55 px-4 py-2 text-[1rem] font-semibold tracking-[-0.02em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                <span className="mr-2 text-[#95ea63]">⚡</span>
                #1 Creator Operations, Simplified
              </div>

              <h1 className="mt-8 max-w-5xl font-[Georgia,Times_New_Roman,serif] text-[4.8rem] leading-[0.9] font-bold tracking-[-0.06em] text-white xl:text-[5.8rem]">
                Freelance Work,
                  <br />
                  One Workflow
                  <br />
                  at a Time.
              </h1>

              <p className="mt-7 max-w-3xl text-[1.15rem] font-medium leading-[1.6] text-white/84 xl:text-[1.25rem]">
                Reelencer helps independent creators and fast-moving teams manage gigs, approvals, and payouts in one clear workflow.
              </p>

              <div className="mt-10 max-w-4xl rounded-[1.9rem] border border-white/10 bg-[#0d3b32]/72 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-sm xl:px-6 xl:py-6">
                {!authResolved ? (
                  <div className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
                    <div className="h-[7.2rem] w-full animate-pulse rounded-[1.6rem] bg-white/70" />
                    <div className="min-h-[6.5rem] animate-pulse rounded-[1.6rem] bg-white/25" />
                  </div>
                ) : !role ? (
                  <form onSubmit={handleLeadSubmit}>
                    <div className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
                      <input
                        type="email"
                        placeholder="Enter your email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        required
                        className="h-[7.2rem] w-full rounded-[1.6rem] border border-black/8 bg-white px-8 text-[1.05rem] font-semibold text-slate-800 outline-none placeholder:text-slate-500"
                      />
                      <button
                        type="submit"
                        className="flex min-h-[6.5rem] items-center justify-center rounded-[1.6rem] bg-[#8fe05f] px-7 py-5 text-center text-[1.1rem] font-extrabold tracking-[-0.03em] text-[#0b1914] transition hover:bg-[#9ae86a] xl:text-[1.22rem]"
                      >
                        <span>
                          Start With
                          <br />
                          Reelencer
                        </span>
                        <span className="ml-3 text-[2.2rem]">↗</span>
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_215px]">
                    <Link
                      href={browseHref}
                      className="group relative overflow-hidden rounded-[1.35rem] border border-white/10 bg-white px-6 py-5 text-slate-900 shadow-[0_10px_30px_rgba(0,0,0,0.12)] transition hover:scale-[1.01] hover:shadow-[0_16px_40px_rgba(0,0,0,0.16)]"
                    >
                      <span className="absolute inset-y-0 left-0 w-1 bg-[#8fe05f]" />
                      <span className="absolute right-5 top-5 text-3xl text-slate-400 transition group-hover:translate-x-1 group-hover:-translate-y-1">↗</span>
                      <span className="block text-xs font-bold uppercase tracking-[0.22em] text-slate-400">Recommended next step</span>
                      <span className="mt-2 block text-[1.45rem] font-black tracking-[-0.05em] text-slate-900">Browse Gigs</span>
                      <span className="mt-2 block max-w-xl text-sm font-medium leading-7 text-slate-500">Discover open opportunities and apply faster.</span>
                    </Link>
                    <Link
                      href={primaryHref}
                      className="flex min-h-[8.75rem] items-center justify-center rounded-[1.35rem] bg-[#8fe05f] px-5 text-center text-[1.08rem] font-extrabold tracking-[-0.03em] text-[#0b1914] transition hover:bg-[#9ae86a]"
                    >
                      <span>
                        Open
                        <br />
                        Dashboard
                      </span>
                      <span className="ml-2 text-[2rem]">↗</span>
                    </Link>
                  </div>
                )}
                {authResolved && !role && (
                  <div className="mt-5 px-1 xl:grid xl:grid-cols-[minmax(0,1fr)_280px] xl:items-center xl:gap-5">
                    <span className="block max-w-2xl text-[1.02rem] leading-8 text-white/62">
                      Use any email to create your Reelencer account and start earning.
                    </span>
                    <div className="mt-3 flex items-center gap-4 text-[1.05rem] xl:mt-0 xl:justify-center">
                      <Link href={loginHref} className="font-semibold text-[#9eea6d] transition hover:text-white">
                        Sign in
                      </Link>
                      <span className="text-white/35">/</span>
                      <Link href={signupHref} className="whitespace-nowrap font-semibold text-white transition hover:text-[#9eea6d]">
                        Create account
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="col-span-6 flex items-center justify-end xl:col-span-5">
              <div className="relative h-[36rem] w-full max-w-[38rem]">
                <div className="absolute right-0 top-0 h-[34rem] w-[34rem] rounded-full border border-white/12 bg-white/90 shadow-[0_25px_80px_rgba(0,0,0,0.25)]" />
                <div className="absolute right-[4.8rem] top-[3.7rem] h-[27rem] w-[15.5rem] rounded-[3rem] border-[7px] border-[#20191f] bg-[#fbfbfb] shadow-[0_30px_60px_rgba(0,0,0,0.28)]">
                  <div className="absolute left-1/2 top-3 h-7 w-28 -translate-x-1/2 rounded-full bg-[#18131a]" />
                  <div className="px-5 pt-14">
                    <div className="flex items-center justify-between text-[0.82rem] font-semibold text-slate-500">
                      <span>Good Morning!</span>
                      <span>👋</span>
                    </div>
                    <div className="mt-2 text-[1.75rem] font-bold tracking-[-0.04em] text-slate-800">Reelencer</div>
                    <div className="mt-4 rounded-[1.4rem] bg-[#cfd8ff] px-4 py-4 text-slate-700 shadow-inner">
                      <div className="text-sm font-semibold">Creator earnings wallet</div>
                      <div className="mt-5 text-xs text-slate-500">Available for payout</div>
                      <div className="mt-1 text-2xl font-black tracking-[-0.05em]">$2,480</div>
                    </div>
                    <div className="mt-5 space-y-3">
                      {[
                        ["UGC reel delivery", "$950"],
                        ["Brand edit batch", "$780"],
                        ["Weekend review sprint", "$750"],
                      ].map(([label, value]) => (
                        <div key={label} className="flex items-center justify-between rounded-2xl bg-slate-100 px-4 py-3 text-sm">
                          <span className="font-medium text-slate-600">{label}</span>
                          <span className="font-bold text-slate-800">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="absolute left-[2rem] top-[11rem] w-[25rem] rounded-[2rem] border border-white/12 bg-[linear-gradient(180deg,rgba(8,8,10,0.96),rgba(30,30,35,0.92))] p-5 shadow-[0_25px_55px_rgba(0,0,0,0.34)]">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-sm font-bold tracking-[0.12em] text-white/80">REELENCER</div>
                      <div className="mt-1 text-[0.72rem] uppercase tracking-[0.18em] text-white/35">Monthly earnings</div>
                    </div>
                    <div className="rounded-full border border-white/10 px-3 py-1 text-[0.68rem] font-semibold text-white/70">
                      VERIFIED
                    </div>
                  </div>
                  <div className="mt-8 text-[3rem] font-black tracking-[-0.06em] text-white">$4,860</div>
                  <div className="mt-1 text-sm text-white/55">Total earnings from completed gigs this month</div>
                  <div className="mt-6 grid grid-cols-3 gap-3">
                    <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-3">
                      <div className="text-[0.62rem] uppercase tracking-[0.18em] text-white/35">Completed</div>
                      <div className="mt-2 text-xl font-bold text-white">18</div>
                    </div>
                    <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-3">
                      <div className="text-[0.62rem] uppercase tracking-[0.18em] text-white/35">Avg/Gig</div>
                      <div className="mt-2 text-xl font-bold text-white">$270</div>
                    </div>
                    <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-3">
                      <div className="text-[0.62rem] uppercase tracking-[0.18em] text-white/35">Status</div>
                      <div className="mt-2 text-xl font-bold text-white">Paid</div>
                    </div>
                  </div>
                </div>

                <div className="absolute bottom-[1.4rem] right-[1.2rem] w-[18rem] rounded-[999px] bg-[#8fe05f] px-6 py-5 text-center text-[#14311f] shadow-[0_22px_40px_rgba(62,96,35,0.25)]">
                  <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-[#6fc447] text-lg">↗</div>
                  <div className="mt-3 text-[1.35rem] font-black tracking-[-0.04em]">Withdraw to Bank</div>
                  <div className="text-sm font-semibold">Fast payout, zero confusion</div>
                </div>

                <div className="pointer-events-none absolute right-0 top-[7rem] h-40 w-36 rounded-full border border-white/12 opacity-40" />
                <div className="pointer-events-none absolute right-10 top-[8rem] h-44 w-44 rounded-full border border-white/10 opacity-30" />
              </div>
            </div>
          </section>

          <section className="mx-auto w-full max-w-7xl px-4 pb-12 pt-2 sm:px-6 sm:pb-16 lg:hidden">
            <div className="animate-[revealRise_700ms_ease-out]">
              <div className="inline-flex items-center rounded-full border border-[#79a96c]/30 bg-[#2f624e]/55 px-3 py-1.5 text-[0.82rem] font-semibold tracking-[-0.01em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] sm:px-4 sm:py-2 sm:text-[0.95rem]">
                <span className="mr-2 text-[#95ea63]">⚡</span>
                #1 Creator Operations, Simplified
              </div>

              <div className="relative mt-8">
                <h1 className="max-w-4xl font-[Georgia,Times_New_Roman,serif] text-[2.62rem] leading-[0.94] font-bold tracking-[-0.045em] text-white sm:text-[3.35rem]">
                  Freelance Work,
                  <br />
                  One Workflow
                  <br />
                  at a Time.
                </h1>
              </div>

              <p className="mt-5 max-w-3xl text-[0.95rem] font-medium leading-[1.54] tracking-[-0.015em] text-white/86 sm:mt-6 sm:text-[1.08rem]">
                Reelencer helps independent creators and fast-moving teams manage gigs, approvals, and payouts in one clear workflow.
              </p>

              <div className="mt-9 rounded-[1.65rem] border border-white/10 bg-[#113d33]/72 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-sm sm:p-4">
                {!authResolved ? (
                  <div className="grid gap-3">
                    <div className="h-16 animate-pulse rounded-[1.2rem] bg-white/70" />
                    <div className="h-16 animate-pulse rounded-[1.2rem] bg-white/25" />
                  </div>
                ) : !role ? (
                  <form onSubmit={handleLeadSubmit}>
                    <div className="grid gap-3">
                      <input
                        type="email"
                        placeholder="Enter Your Email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        required
                        className="h-14 rounded-[1.1rem] border border-black/8 bg-white px-5 text-base font-semibold text-slate-800 outline-none placeholder:text-slate-500 sm:h-16 sm:rounded-[1.2rem] sm:px-6 sm:text-lg"
                      />
                      <button
                        type="submit"
                        className="flex h-14 items-center justify-center rounded-[1.1rem] bg-[#8fe05f] px-5 text-[1.18rem] font-extrabold tracking-[-0.03em] text-[#0b1914] transition hover:bg-[#9ae86a] sm:h-16 sm:rounded-[1.2rem] sm:px-6 sm:text-[1.35rem]"
                      >
                        {primaryLabel}
                        <span className="ml-2">↗</span>
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="grid gap-3">
                    <Link
                      href={browseHref}
                      className="relative overflow-hidden rounded-[1.2rem] border border-white/10 bg-white px-5 py-4 text-slate-900 shadow-[0_10px_30px_rgba(0,0,0,0.12)]"
                    >
                      <span className="absolute inset-y-0 left-0 w-1 bg-[#8fe05f]" />
                      <span className="block text-[0.72rem] font-bold uppercase tracking-[0.22em] text-slate-400">Recommended</span>
                      <span className="mt-1 block text-[1.15rem] font-black tracking-[-0.04em] sm:text-[1.3rem]">Browse Gigs</span>
                      <span className="mt-1 block text-sm font-medium text-slate-500">Find new work and apply in minutes.</span>
                    </Link>
                    <Link
                      href={primaryHref}
                      className="flex h-14 items-center justify-center rounded-[1.1rem] bg-[#8fe05f] px-5 text-[1rem] font-extrabold tracking-[-0.03em] text-[#0b1914] transition hover:bg-[#9ae86a] sm:h-16 sm:rounded-[1.2rem] sm:px-6 sm:text-[1.08rem]"
                    >
                      Open Dashboard
                      <span className="ml-2">↗</span>
                    </Link>
                  </div>
                )}
                {authResolved && !role && (
                  <div className="mt-3 flex items-center gap-1.5 px-1 text-[0.82rem] tracking-[-0.01em] text-white/60 sm:flex-wrap sm:gap-2 sm:text-sm sm:tracking-normal">
                    <span className="whitespace-nowrap">Use any email to create your Reelencer account.</span>
                    <Link href={loginHref} className="font-semibold text-[#9eea6d] transition hover:text-white">
                      Sign in
                    </Link>
                  </div>
                )}
              </div>

              <div className="mt-8 grid gap-4 border-t border-white/10 pt-6 sm:grid-cols-3">
                {trustStats.map((stat) => (
                  <div key={stat.label} className="rounded-[1.4rem] border border-white/8 bg-white/[0.03] px-4 py-4">
                    <div className="text-[1.28rem] font-extrabold tracking-[-0.035em] text-white sm:text-[1.5rem]">{stat.value}</div>
                    <div className="mt-1 text-sm leading-6 text-white/68">{stat.label}</div>
                  </div>
                ))}
              </div>

              <div className="mt-8 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                <div className="rounded-[1.8rem] border border-white/8 bg-black/12 p-5 backdrop-blur-sm xl:min-h-[17.5rem]">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold uppercase tracking-[0.24em] text-[#95ea63]">Workflow signal</div>
                      <div className="mt-2 text-2xl font-bold tracking-[-0.04em] text-white">Every task stays visible from brief to payout.</div>
                    </div>
                    <div className="hidden h-14 w-14 items-center justify-center rounded-2xl bg-[#8fe05f] text-2xl font-black text-[#0b1914] sm:flex">R</div>
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    {[
                      ["Brief", "Approved"],
                      ["Proof", "Under review"],
                      ["Payout", "Scheduled"],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-[1.2rem] border border-white/8 bg-white/[0.04] px-4 py-4">
                        <div className="text-xs uppercase tracking-[0.2em] text-white/48">{label}</div>
                        <div className="mt-2 text-base font-semibold text-white">{value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[1.8rem] border border-white/8 bg-[linear-gradient(180deg,rgba(95,69,227,0.14),rgba(255,255,255,0.03))] p-5 xl:min-h-[17.5rem]">
                  <div className="text-sm font-bold uppercase tracking-[0.24em] text-[#b2a6ff]">Realtime oversight</div>
                  <div className="mt-3 text-xl font-bold tracking-[-0.04em] text-white">Admins, workers, and creators stay aligned without chasing updates.</div>
                  <div className="mt-4 space-y-3">
                    {[
                      "Role-aware routes and workspace access",
                      "Cleaner review loops with visible state changes",
                      "A hero CTA that now routes directly into auth",
                    ].map((point) => (
                      <div key={point} className="flex items-start gap-3 text-sm text-white/72">
                        <span className="mt-1 h-2.5 w-2.5 rounded-full bg-[#8fe05f]" />
                        <span>{point}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                <div className="rounded-[1.8rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-5 xl:min-h-[21rem]">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold uppercase tracking-[0.22em] text-[#95ea63]">Worker workspace</div>
                      <div className="mt-2 text-xl font-bold tracking-[-0.04em] text-white">Assigned work items</div>
                    </div>
                    <div className="rounded-full bg-white/8 px-3 py-1 text-xs font-bold text-white/70">Live board</div>
                  </div>
                  <div className="mt-5 space-y-3">
                    {[
                      ["Instagram batch", "In review", "06:30 PM"],
                      ["Creator follow-up", "Open", "07:15 PM"],
                      ["Proof verification", "Approved", "08:10 PM"],
                    ].map(([title, state, time]) => (
                      <div key={title} className="grid grid-cols-[1fr_auto] gap-3 rounded-[1.2rem] border border-white/8 bg-black/12 px-4 py-4">
                        <div>
                          <div className="text-sm font-semibold text-white">{title}</div>
                          <div className="mt-1 text-xs text-white/45">Reelencer workspace queue</div>
                        </div>
                        <div className="text-right">
                          <div className={`text-xs font-bold ${state === "Approved" ? "text-[#8fe05f]" : state === "In review" ? "text-[#b2a6ff]" : "text-white/65"}`}>{state}</div>
                          <div className="mt-1 text-xs text-white/45">{time}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[1.8rem] border border-white/8 bg-[#082721]/88 p-5 xl:min-h-[21rem]">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold uppercase tracking-[0.22em] text-[#95ea63]">Admin pulse</div>
                      <div className="mt-2 text-xl font-bold tracking-[-0.04em] text-white">Approval and payout command panel</div>
                    </div>
                    <div className="hidden h-12 w-12 place-items-center rounded-2xl bg-[#8fe05f] text-lg font-black text-[#0b1914] sm:grid">A</div>
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    {[
                      ["Pending reviews", "28"],
                      ["Queued payouts", "12"],
                      ["Active workers", "146"],
                      ["Flagged items", "03"],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-[1.2rem] border border-white/8 bg-white/[0.03] px-4 py-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-white/45">{label}</div>
                        <div className="mt-2 text-2xl font-black tracking-[-0.05em] text-white">{value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section
            id="solution"
            className={`mx-auto w-full max-w-7xl px-4 pb-16 pt-2 sm:px-6 lg:px-8 lg:pb-20 ${sectionRevealClass("solution")}`}
          >
            <div className="rounded-[2.4rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] px-6 py-8 shadow-[0_20px_50px_rgba(0,0,0,0.18)] sm:px-8 lg:px-10 lg:py-10">
              <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
                <div>
                  <div className="text-sm font-bold uppercase tracking-[0.3em] text-[#95ea63]">How It Works</div>
                  <h2 className="mt-4 max-w-3xl text-[2.7rem] font-black leading-[0.98] tracking-[-0.06em] text-white sm:text-[3.2rem] lg:text-[4rem]">
                    How Reelencer Turns Freelance Hustle into a Reliable Workflow.
                  </h2>
                  <p className="mt-5 max-w-2xl text-lg leading-8 text-white/68">
                    From discovery to payout, every step is designed to help creators work faster, stay organized, and earn with more confidence.
                  </p>
                </div>
                <div className="lg:justify-self-end">
                  <div className="text-[2.6rem] font-black tracking-[-0.05em] text-white">100%</div>
                  <div className="mt-1 text-sm font-bold uppercase tracking-[0.24em] text-white/46">Workflow confidence</div>
                  <div className="max-w-xs pt-3 text-lg font-semibold leading-8 text-white/72">
                    Client satisfaction stays at the center of every approved delivery and every payout-ready submission.
                  </div>
                  <div className="mt-4 h-[2px] w-40 bg-white/35" />
                </div>
              </div>

              <div className="relative mt-8 hidden h-14 lg:block">
                <div className="absolute left-0 right-0 top-[2.7rem] h-[2px] bg-white/10" />
                <div className="absolute left-1/2 top-[0.65rem] h-9 w-[28%] -translate-x-1/2 rounded-t-[1.6rem] border border-b-0 border-white/12" />
                <div className="absolute left-1/2 top-0 grid h-12 w-12 -translate-x-1/2 place-items-center rounded-full bg-[#8fe05f] text-[1.7rem] font-black text-[#10311f] shadow-[0_14px_30px_rgba(68,118,37,0.28)]">
                  ∞
                </div>
              </div>

              <div className="mt-6 grid gap-8 lg:mt-4 lg:grid-cols-4 lg:gap-8 xl:gap-10">
                {[
                  {
                    step: "01",
                    title: "Find the right gigs faster.",
                    body: "Browse verified opportunities with clear deliverables, realistic deadlines, and transparent payout expectations.",
                  },
                  {
                    step: "02",
                    title: "Accept with full context.",
                    body: "Start with clean briefs, organized assets, and a workflow that makes expectations obvious from day one.",
                  },
                  {
                    step: "03",
                    title: "Submit work and move through review.",
                    body: "Upload deliverables, respond to feedback quickly, and keep progress visible without losing momentum.",
                  },
                  {
                    step: "04",
                    title: "Track approval and cash out.",
                    body: "See payout status clearly, know what is pending, and withdraw earnings without second-guessing the process.",
                  },
                ].map((item) => (
                  <article key={item.step} className="relative lg:px-1">
                    <div className="inline-flex items-center rounded-full border border-white/14 bg-[#10352d] px-3 py-1 text-sm font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                      <span className="mr-2 text-white/72">Step</span>
                      {item.step}
                    </div>
                    <h3 className="mt-4 text-[1.9rem] font-bold leading-[1.08] tracking-[-0.05em] text-white lg:min-h-[5rem] lg:text-[1.72rem] xl:min-h-[5.75rem] xl:text-[1.9rem]">
                      {item.title}
                    </h3>
                    <p className="mt-4 max-w-sm text-base leading-8 text-white/68">{item.body}</p>
                  </article>
                ))}
              </div>

              <div className="mt-10 rounded-full border border-white/8 bg-white/[0.03] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="flex flex-col gap-3 rounded-full px-4 py-2 lg:flex-row lg:items-center lg:justify-between lg:px-6">
                  <div className="text-base font-medium text-white/72">
                    Ready to move from accepted gigs to paid work with less friction and better visibility?
                  </div>
                  <Link
                    href={primaryHref}
                    className="inline-flex h-14 items-center justify-center rounded-full bg-[#8fe05f] px-7 text-base font-extrabold text-[#0b1914] transition hover:bg-[#9ae86a]"
                  >
                    Explore Reelencer
                    <span className="ml-2">↗</span>
                  </Link>
                </div>
              </div>
            </div>
          </section>

          <section id="portfolio" className={`mx-auto w-full max-w-7xl px-4 pb-14 sm:px-6 lg:px-8 ${sectionRevealClass("portfolio")}`}>
            <div className="partner-rail-mask overflow-hidden rounded-[2rem] border border-white/8 bg-black/12 px-5 py-5 backdrop-blur-sm">
              <div className="partner-rail-track group flex min-w-max items-center gap-10 text-white/78">
                {[...partnerNames, ...partnerNames, ...partnerNames].map((name, index) => (
                  <div key={`${name}-${index}`} className="flex items-center gap-3 whitespace-nowrap">
                    <span className="inline-block h-4 w-4 rotate-45 rounded-[3px] bg-white/90" />
                    <span className="text-[1.45rem] font-black tracking-[-0.05em]">{name}</span>
                    <span className="text-sm font-medium text-white/44">Reelencer network</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section id="solution" className="mx-auto grid w-full max-w-7xl gap-6 px-4 pb-18 sm:px-6 lg:grid-cols-3 lg:px-8">
            {[
              {
                kicker: "Design system",
                title: "A Reelencer hero that feels editorial instead of generic SaaS.",
                body: "The page keeps the visual discipline of your reference but translates it into a stronger brand surface for creator operations.",
              },
              {
                kicker: "Conversion",
                title: "CTA-first architecture for onboarding, login, and workspace entry.",
                body: "The email capture, dashboard route, and support path stay visible without collapsing the hero or diluting the primary story.",
              },
              {
                kicker: "Responsiveness",
                title: "Mobile drawer behavior that now works like a product Browse Menu, not a flat list.",
                body: "Each section expands with sub-navigation so the experience feels production-ready on small screens while staying clean on desktop.",
              },
            ].map((item) => (
              <article
                key={item.title}
                className="animate-[revealRise_700ms_ease-out] rounded-[2rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.03))] p-6 shadow-[0_14px_30px_rgba(0,0,0,0.18)]"
              >
                <div className="text-sm font-bold uppercase tracking-[0.28em] text-[#95ea63]">{item.kicker}</div>
                <h2 className="mt-4 text-[1.7rem] font-bold leading-tight tracking-[-0.05em] text-white">{item.title}</h2>
                <p className="mt-4 text-base leading-7 text-white/72">{item.body}</p>
              </article>
            ))}
          </section>

          <section id="company" className={`mx-auto grid w-full max-w-7xl gap-6 px-4 pb-16 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8 ${sectionRevealClass("company")}`}>
            <div className="rounded-[2rem] border border-white/8 bg-white/[0.04] p-6 shadow-[0_18px_40px_rgba(0,0,0,0.18)]">
              <div className="text-sm font-bold uppercase tracking-[0.28em] text-[#95ea63]">Why Reelencer</div>
              <h2 className="mt-4 text-[2rem] font-bold leading-tight tracking-[-0.05em] text-white">
                A sharper operational layer for creators, reviewers, and internal teams.
              </h2>
              <p className="mt-4 max-w-2xl text-base leading-7 text-white/72">
                Reelencer turns loose creator coordination into a structured system for briefs, proof, approval, payouts, and team accountability.
              </p>
            </div>
            <div className="grid gap-4">
              {[
                "Verified sign-in and role-aware dashboards",
                "Clear review loops for admin and worker teams",
                "Payout-ready workflows with stronger visibility",
              ].map((item) => (
                <div key={item} className="rounded-[1.5rem] border border-white/8 bg-black/12 px-5 py-5 text-base font-medium text-white/78">
                  {item}
                </div>
              ))}
            </div>
          </section>

          <section id="resources" className={`mx-auto w-full max-w-7xl px-4 pb-20 sm:px-6 lg:px-8 ${sectionRevealClass("resources")}`}>
            <div className="rounded-[2.2rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.03))] p-6 shadow-[0_20px_50px_rgba(0,0,0,0.2)]">
              <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
                <div>
                  <div className="text-sm font-bold uppercase tracking-[0.28em] text-[#95ea63]">Resources</div>
                  <h2 className="mt-4 text-[2rem] font-bold tracking-[-0.05em] text-white">Scale creator operations with Reelencer from day one.</h2>
                  <p className="mt-4 max-w-3xl text-base leading-7 text-white/72">
                    Reelencer unifies gig discovery, approval workflows, and payout visibility into one production-ready system for creators and operations teams.
                  </p>
                </div>
                <Link
                  href={primaryHref}
                  className="inline-flex h-14 items-center justify-center rounded-2xl bg-[#8fe05f] px-6 text-base font-extrabold text-[#0b1914] transition hover:bg-[#9ae86a]"
                >
                  Start with Reelencer
                </Link>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
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

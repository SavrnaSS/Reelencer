"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { BrandMark } from "@/app/_components/BrandMark";
import { ThemeToggle, useSyncHomeTheme } from "@/app/_components/ThemeToggle";
import { HomeHero } from "@/app/_components/home/HomeHero";
import { CREATOR_HOME_HREF, FIND_GIGS_HREF } from "@/lib/routes";
import { stashAuthEmail } from "@/lib/authEmailHandoff";

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

const reelNicheRows = [
  ["Fashion try-ons", "Tech explainers", "Cafe & food reviews", "Fitness routines", "Skincare demos", "Travel diaries", "App walkthroughs"],
  ["Unboxings", "Finance tips", "Study hacks", "Home decor", "Gaming clips", "Day-in-the-life", "Product UGC"],
] as const;

const whyReelencerCards = [
  {
    kicker: "Find work",
    title: "Brand gigs, not bidding wars.",
    body: "Open gigs list the deliverables, deadline, and payout up front, so you know what you're signing up for before you apply.",
    visual: "gigs",
  },
  {
    kicker: "Get approved",
    title: "Reviews you can actually follow.",
    body: "Every submission moves through one visible review loop, so you always know whether your reel is approved, in review, or needs a tweak.",
    visual: "review",
  },
  {
    kicker: "Get paid",
    title: "Earnings you can see grow.",
    body: "Approved reels move toward payout in plain sight: pending, approved, and paid, all tracked in one place.",
    visual: "payout",
  },
] as const;

const comparisonColumns = ["Reelencer", "Freelance marketplaces", "Brand DMs"] as const;

const comparisonRows = [
  { label: "Finding work", values: ["Open gigs with payouts listed", "Bidding against crowds", "Cold outreach and waiting"] },
  { label: "The brief", values: ["Deliverables and deadline up front", "Varies client to client", "Scattered across chats"] },
  { label: "Review", values: ["One visible review loop", "Endless back-and-forth", "Unclear sign-off"] },
  { label: "Getting paid", values: ["Tracked from approval to payout", "Depends on platform rules", "Chasing invoices"] },
  { label: "Workspace", values: ["Gigs, reels, and earnings together", "Split across tools", "Spread across apps"] },
] as const;

const faqItems = [
  {
    q: "What is Reelencer?",
    a: "Reelencer connects creators with brand gigs for short-form video. You browse open gigs, create the reel, submit it for review, and track your payout, all from one workspace.",
  },
  {
    q: "Who can join as a creator?",
    a: "Anyone can create an account with an email address. Once you're in, you can browse open gigs and apply to the ones that fit your style and niche.",
  },
  {
    q: "How do I find and accept gigs?",
    a: "Open Browse Gigs to see what's live. Each gig lists its deliverables, deadline, and payout, so you can apply with full context and pick up accepted work in your workspace.",
  },
  {
    q: "What happens after I submit a reel?",
    a: "Your submission goes to a reviewer. You can see its status at every step, and if something needs changing, you'll know what to fix before resubmitting.",
  },
  {
    q: "How and when do I get paid?",
    a: "Approved work moves into your payouts, where you can see what's pending, approved, and paid. Identity verification (KYC) may be required before your first withdrawal.",
  },
] as const;

const dashboardNavItems = ["Overview", "Campaigns", "Creators", "Content", "Analytics", "Payments", "Settings"] as const;
type DashboardTab = (typeof dashboardNavItems)[number];

const dashboardMetrics = [
  { label: "Revenue", value: "₹15.6L", change: "+14.3%" },
  { label: "Reach", value: "32.8M", change: "+22.1%" },
  { label: "Engagement", value: "4.9M", change: "+18.7%" },
  { label: "Conversions", value: "4.2K", change: "+12.7%" },
] as const;

const platformBreakdown = [
  { label: "Instagram", value: "38%", color: "#8fe05f" },
  { label: "TikTok", value: "28%", color: "#a78bfa" },
  { label: "YouTube", value: "18%", color: "#2dd4bf" },
  { label: "Other", value: "16%", color: "#4b635c" },
] as const;

const analyticsIntroBenefits = [
  "Live channel metrics",
  "Creator-level breakdowns",
  "ROI and payout visibility",
  "Auto-archived proof library",
] as const;

const dateRanges = ["This month", "Last month", "This quarter", "Last 90 days"] as const;

const dashboardViews: Record<
  DashboardTab,
  {
    kicker: string;
    title: string;
    subtitle: string;
    insight: string;
    chartLabels: readonly [string, string];
    totalLabel: string;
    totalValue: string;
    metrics: readonly { label: string; value: string; change: string }[];
    platforms: readonly { label: string; value: string; color: string }[];
  }
> = {
  Overview: {
    kicker: "Live operations",
    title: "Overview",
    subtitle: "Real-time revenue and creator performance",
    insight: "Revenue is pacing ahead of the monthly target with engagement rising across short-form placements.",
    chartLabels: ["Revenue", "Engagement"],
    totalLabel: "Total",
    totalValue: "₹15.4L",
    metrics: dashboardMetrics,
    platforms: platformBreakdown,
  },
  Campaigns: {
    kicker: "Campaign control",
    title: "Campaigns",
    subtitle: "Active briefs, delivery health, and approval velocity",
    insight: "Four briefs need review, while launch-ready campaigns are trending above slot-fill targets.",
    chartLabels: ["Budget", "Approved"],
    totalLabel: "Booked",
    totalValue: "₹9.1L",
    metrics: [
      { label: "Live briefs", value: "28", change: "+8.4%" },
      { label: "Booked spend", value: "₹9.1L", change: "+11.2%" },
      { label: "Approval rate", value: "92%", change: "+6.8%" },
      { label: "At risk", value: "4", change: "-12.5%" },
    ],
    platforms: [
      { label: "Launch", value: "34%", color: "#8fe05f" },
      { label: "Review", value: "26%", color: "#a78bfa" },
      { label: "Live", value: "24%", color: "#2dd4bf" },
      { label: "Closed", value: "16%", color: "#4b635c" },
    ],
  },
  Creators: {
    kicker: "Creator network",
    title: "Creators",
    subtitle: "Creator supply, response time, and verified availability",
    insight: "Verified creators are responding faster, with strongest capacity in Instagram and TikTok workflows.",
    chartLabels: ["Active", "Matched"],
    totalLabel: "Creators",
    totalValue: "184",
    metrics: [
      { label: "Active", value: "184", change: "+17.9%" },
      { label: "Verified", value: "142", change: "+9.6%" },
      { label: "Avg response", value: "2.4h", change: "-18.1%" },
      { label: "Shortlisted", value: "63", change: "+21.5%" },
    ],
    platforms: [
      { label: "Instagram", value: "42%", color: "#8fe05f" },
      { label: "TikTok", value: "31%", color: "#a78bfa" },
      { label: "YouTube", value: "15%", color: "#2dd4bf" },
      { label: "Other", value: "12%", color: "#4b635c" },
    ],
  },
  Content: {
    kicker: "Content pipeline",
    title: "Content",
    subtitle: "Submissions, revisions, and publish-ready deliverables",
    insight: "Submission quality is improving with fewer revision loops and a higher first-pass approval rate.",
    chartLabels: ["Submitted", "Approved"],
    totalLabel: "Assets",
    totalValue: "436",
    metrics: [
      { label: "Submitted", value: "436", change: "+19.4%" },
      { label: "Approved", value: "318", change: "+13.7%" },
      { label: "Revisions", value: "42", change: "-9.1%" },
      { label: "Published", value: "226", change: "+16.8%" },
    ],
    platforms: [
      { label: "Reels", value: "46%", color: "#8fe05f" },
      { label: "Shorts", value: "24%", color: "#a78bfa" },
      { label: "Stories", value: "18%", color: "#2dd4bf" },
      { label: "Static", value: "12%", color: "#4b635c" },
    ],
  },
  Analytics: {
    kicker: "Performance lab",
    title: "Analytics",
    subtitle: "Reach, watch time, retention, and conversion quality",
    insight: "The strongest lift is coming from creator-led tutorials and repeat audience exposure.",
    chartLabels: ["Reach", "Retention"],
    totalLabel: "Reach",
    totalValue: "32.8M",
    metrics: [
      { label: "Reach", value: "32.8M", change: "+22.1%" },
      { label: "Watch time", value: "9.6M", change: "+18.3%" },
      { label: "Retention", value: "61%", change: "+7.4%" },
      { label: "CTR", value: "4.8%", change: "+5.9%" },
    ],
    platforms: [
      { label: "Instagram", value: "39%", color: "#8fe05f" },
      { label: "TikTok", value: "34%", color: "#a78bfa" },
      { label: "YouTube", value: "19%", color: "#2dd4bf" },
      { label: "Other", value: "8%", color: "#4b635c" },
    ],
  },
  Payments: {
    kicker: "Payout desk",
    title: "Payments",
    subtitle: "Creator payouts, pending approvals, and payment readiness",
    insight: "Most payout volume is cleared, with pending batches concentrated in final approval checks.",
    chartLabels: ["Paid", "Pending"],
    totalLabel: "Paid",
    totalValue: "₹11.8L",
    metrics: [
      { label: "Paid", value: "₹11.8L", change: "+12.6%" },
      { label: "Pending", value: "₹4.2L", change: "-8.2%" },
      { label: "Avg payout", value: "3.2d", change: "-14.4%" },
      { label: "Ready", value: "76", change: "+10.1%" },
    ],
    platforms: [
      { label: "Cleared", value: "52%", color: "#8fe05f" },
      { label: "Queued", value: "24%", color: "#a78bfa" },
      { label: "Review", value: "16%", color: "#2dd4bf" },
      { label: "Hold", value: "8%", color: "#4b635c" },
    ],
  },
  Settings: {
    kicker: "Workspace setup",
    title: "Settings",
    subtitle: "Access controls, automation rules, and operational guardrails",
    insight: "Automation coverage is high, with role permissions and payout rules ready for final review.",
    chartLabels: ["Automated", "Manual"],
    totalLabel: "Rules",
    totalValue: "24",
    metrics: [
      { label: "Roles", value: "12", change: "+4.0%" },
      { label: "Rules", value: "24", change: "+9.1%" },
      { label: "Alerts", value: "7", change: "-22.0%" },
      { label: "Uptime", value: "99.9%", change: "+0.4%" },
    ],
    platforms: [
      { label: "Access", value: "36%", color: "#8fe05f" },
      { label: "Payouts", value: "28%", color: "#a78bfa" },
      { label: "Reviews", value: "22%", color: "#2dd4bf" },
      { label: "Alerts", value: "14%", color: "#4b635c" },
    ],
  },
};

type NameSource = {
  email?: string | null;
  user_metadata?: { name?: string; full_name?: string; avatar_url?: string; picture?: string };
};

const GENERIC_NAMES = new Set(["worker", "creator", "admin", "user", "account"]);

/** Best human name we have: profile display name, then signup/Google name, then a tidied email name. */
function getDisplayName(user: NameSource, profileName?: string | null) {
  const candidates = [profileName, user.user_metadata?.full_name, user.user_metadata?.name].map((v) => v?.trim() ?? "");
  const explicitName = candidates.find((v) => v && !GENERIC_NAMES.has(v.toLowerCase()));
  if (explicitName) return explicitName;

  const email = user.email?.trim();
  if (!email) return "Account";

  const local = email.split("@")[0]?.replace(/\d+$/, "").replace(/[._-]+/g, " ").trim();
  if (!local) return "Account";

  return local.replace(/\b\w/g, (char) => char.toUpperCase());
}

function getAvatarUrl(user: NameSource) {
  const url = user.user_metadata?.avatar_url || user.user_metadata?.picture;
  return url && /^https:\/\//.test(url) ? url : null;
}

/** "Sumit Kumar Singh" -> "SS"; "Asha" -> "A". */
function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function readCachedAuth(): { role: Exclude<Role, null>; name?: string; avatar?: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(AUTH_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { role?: string; name?: string; avatar?: string } | null;
    if (parsed?.role !== "Admin" && parsed?.role !== "Worker") return null;
    return {
      role: parsed.role,
      name: typeof parsed.name === "string" ? parsed.name.slice(0, 80) : undefined,
      avatar: typeof parsed.avatar === "string" && parsed.avatar.startsWith("https://") ? parsed.avatar : undefined,
    };
  } catch {
    return null;
  }
}

function writeCachedRole(role: Exclude<Role, null>, identity?: { name?: string; avatar?: string | null }) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(AUTH_CACHE_KEY);
    const prev = raw ? (JSON.parse(raw) as Record<string, unknown> | null) : null;
    window.localStorage.setItem(
      AUTH_CACHE_KEY,
      JSON.stringify({
        ...(prev ?? {}),
        role,
        name: identity?.name ?? prev?.name,
        avatar: identity?.avatar ?? prev?.avatar,
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

function DashboardCalendarIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 2v4M16 2v4M4 9h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
    </svg>
  );
}

function DashboardChevronIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
    </svg>
  );
}

function buildConicGradient(items: readonly { value: string; color: string }[]) {
  let cursor = 0;
  const segments = items.map((item, index) => {
    const amount = Number.parseFloat(item.value);
    const next = index === items.length - 1 ? 360 : cursor + (Number.isFinite(amount) ? amount * 3.6 : 0);
    const segment = `${item.color} ${cursor}deg ${next}deg`;
    cursor = next;
    return segment;
  });

  return `conic-gradient(${segments.join(", ")})`;
}

function RevenuePerformanceChart({
  labels,
  insight,
}: {
  labels: readonly [string, string];
  insight: string;
}) {
  return (
    <div className="analytics-chart-card relative h-[188px] min-h-[188px] overflow-hidden rounded-[0.95rem] border border-white/8 bg-white/[0.035] shadow-[0_12px_28px_rgba(0,0,0,0.22)] sm:h-[210px] lg:h-[232px] 2xl:h-[252px]">
      <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-3 text-[0.72rem] font-extrabold text-white/60 sm:left-4 sm:top-4 sm:gap-4 sm:text-xs">
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#8fe05f] shadow-[0_0_0_4px_rgba(143,224,95,0.14)]" />
          {labels[0]}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#a78bfa] shadow-[0_0_0_4px_rgba(167,139,250,0.14)]" />
          {labels[1]}
        </span>
      </div>
      <div className="absolute right-4 top-4 z-10 hidden max-w-[13rem] rounded-full bg-white/[0.06] px-2.5 py-1 text-[0.62rem] font-bold leading-4 text-white/60 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] 2xl:block">
        {insight}
      </div>

      <svg
        viewBox="0 0 760 310"
        className="analytics-chart-svg absolute inset-x-3 bottom-2.5 top-[3.1rem] h-auto w-[calc(100%-1.5rem)] sm:inset-x-4 sm:bottom-4 sm:top-[3.8rem] sm:w-[calc(100%-2rem)]"
        role="img"
        aria-label="Revenue and engagement trend lines rising through May"
      >
        <defs>
          <linearGradient id="homeRevenueFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#8fe05f" stopOpacity="0.28" />
            <stop offset="64%" stopColor="#8fe05f" stopOpacity="0.07" />
            <stop offset="100%" stopColor="#8fe05f" stopOpacity="0" />
          </linearGradient>
        </defs>

        {[58, 112, 166, 220, 274].map((y) => (
          <line key={y} className="analytics-chart-grid" x1="0" x2="760" y1={y} y2={y} stroke="rgba(255,255,255,0.09)" strokeDasharray="6 14" strokeWidth="1.6" />
        ))}

        <path
          className="analytics-chart-fill"
          d="M0 255 C36 183 76 175 111 191 C141 204 157 198 190 146 C225 94 250 118 290 135 C337 154 372 125 404 90 C438 54 486 81 520 115 C551 145 583 113 616 65 C654 10 704 71 760 54 L760 310 L0 310 Z"
          fill="url(#homeRevenueFill)"
        />
        <path
          className="analytics-chart-line analytics-chart-line-primary"
          d="M0 255 C36 183 76 175 111 191 C141 204 157 198 190 146 C225 94 250 118 290 135 C337 154 372 125 404 90 C438 54 486 81 520 115 C551 145 583 113 616 65 C654 10 704 71 760 54"
          fill="none"
          pathLength={1}
          stroke="#8fe05f"
          strokeLinecap="round"
          strokeWidth="5.1"
        />
        <path
          className="analytics-chart-line analytics-chart-line-secondary"
          d="M0 285 C38 249 74 235 113 238 C143 240 161 229 191 199 C224 166 249 186 288 203 C331 221 365 203 405 157 C441 117 488 133 522 166 C554 197 584 177 618 137 C653 96 700 158 760 151"
          fill="none"
          pathLength={1}
          stroke="#a78bfa"
          strokeLinecap="round"
          strokeWidth="4.4"
        />
      </svg>
    </div>
  );
}

function PlatformRevenueCard({
  title,
  totalLabel,
  totalValue,
  platforms,
}: {
  title: string;
  totalLabel: string;
  totalValue: string;
  platforms: readonly { label: string; value: string; color: string }[];
}) {
  return (
    <div className="analytics-platform-card flex h-full min-h-[188px] flex-col rounded-[0.95rem] border border-white/8 bg-white/[0.035] p-3.5 shadow-[0_12px_28px_rgba(0,0,0,0.22)] sm:min-h-[210px] sm:p-4 lg:min-h-[232px] 2xl:min-h-[252px]">
      <h3 className="text-base font-black tracking-normal text-white sm:text-lg 2xl:text-xl">{title}</h3>

      <div className="mt-3 flex flex-1 flex-col items-center justify-center gap-4 md:flex-row lg:flex-col 2xl:flex-row">
        <div
          className="analytics-donut relative grid aspect-square w-[108px] shrink-0 place-items-center rounded-full sm:w-[126px] 2xl:w-[146px]"
          style={{ background: buildConicGradient(platforms) }}
          aria-label={platforms.map((item) => `${item.label} ${item.value}`).join(", ")}
        >
          <div className="analytics-donut-core grid h-[46%] w-[46%] place-items-center rounded-full bg-[#0c241e] text-center shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
            <div>
              <div className="text-base font-black tracking-normal text-white sm:text-lg 2xl:text-xl">{totalValue}</div>
              <div className="mt-0.5 text-[0.62rem] font-extrabold text-white/50 sm:text-[0.68rem]">{totalLabel}</div>
            </div>
          </div>
        </div>

        <div className="w-full max-w-[190px] space-y-2">
          {platforms.map((item) => (
            <div key={item.label} className="analytics-platform-row grid grid-cols-[1fr_auto] items-center gap-3 text-xs font-extrabold text-white/65 2xl:text-sm">
              <span className="inline-flex min-w-0 items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="truncate">{item.label}</span>
              </span>
              <span className="text-white">{item.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AnalyticsIntroSection() {
  return (
    <section data-page-motion="analytics-intro" className="analytics-intro-section mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
      <div className="analytics-intro-shell">
        <div data-page-stagger className="analytics-intro-kicker">
          Realtime command center
        </div>
        <h2 data-page-stagger className="analytics-intro-title" aria-label="Know what is working while every campaign is still live.">
          <span aria-hidden="true" className="analytics-writing-line">
            Know what is working
          </span>
          <span aria-hidden="true" className="analytics-writing-line">
            while every campaign
          </span>
          <span aria-hidden="true" className="analytics-writing-line">
            is still live.
          </span>
        </h2>
        <p data-page-stagger className="analytics-intro-copy">
          Track views, engagement, creator performance, approvals, and revenue movement the moment content starts gaining traction.
        </p>
        <div className="analytics-intro-pills" aria-label="Realtime dashboard capabilities">
          {analyticsIntroBenefits.map((benefit) => (
            <div key={benefit} data-page-stagger className="analytics-intro-pill">
              <span className="analytics-intro-check" aria-hidden="true">
                <svg viewBox="0 0 16 16" fill="none">
                  <path d="M3.4 8.1 6.5 11l6.1-6.3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                </svg>
              </span>
              <span>{benefit}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function AnalyticsOverviewSection() {
  const [activeDashboardTab, setActiveDashboardTab] = useState<DashboardTab>("Overview");
  const [selectedDateRange, setSelectedDateRange] = useState<(typeof dateRanges)[number]>(dateRanges[0]);
  const [dateMenuOpen, setDateMenuOpen] = useState(false);
  const [prototypeVisible, setPrototypeVisible] = useState(false);
  const prototypeRef = useRef<HTMLElement | null>(null);
  const prototypeReplayFrameRef = useRef<number | null>(null);
  const prototypeInViewRef = useRef(false);
  const view = dashboardViews[activeDashboardTab];
  const platformTitle =
    activeDashboardTab === "Campaigns"
      ? "Campaign by Stage"
      : activeDashboardTab === "Creators"
        ? "Creator Mix"
        : activeDashboardTab === "Content"
          ? "Content Mix"
          : activeDashboardTab === "Analytics"
            ? "Reach by Platform"
            : activeDashboardTab === "Payments"
              ? "Payout Status"
              : activeDashboardTab === "Settings"
                ? "Rules by Area"
                : "Revenue by Platform";

  useEffect(() => {
    if (!dateMenuOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDateMenuOpen(false);
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [dateMenuOpen]);

  useEffect(() => {
    const target = prototypeRef.current;
    if (!target) return;

    const clearReplayFrame = () => {
      if (prototypeReplayFrameRef.current === null) return;
      window.cancelAnimationFrame(prototypeReplayFrameRef.current);
      prototypeReplayFrameRef.current = null;
    };

    const replayPrototype = () => {
      clearReplayFrame();
      setPrototypeVisible(false);
      prototypeReplayFrameRef.current = window.requestAnimationFrame(() => {
        prototypeReplayFrameRef.current = window.requestAnimationFrame(() => {
          prototypeReplayFrameRef.current = null;
          setPrototypeVisible(true);
        });
      });
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      prototypeReplayFrameRef.current = window.requestAnimationFrame(() => setPrototypeVisible(true));
      return clearReplayFrame;
    }

    const BrowserIntersectionObserver = window.IntersectionObserver;
    if (typeof BrowserIntersectionObserver === "undefined") {
      prototypeReplayFrameRef.current = window.requestAnimationFrame(() => setPrototypeVisible(true));
      return clearReplayFrame;
    }

    const observer = new BrowserIntersectionObserver(
      ([entry]) => {
        if (!entry) return;

        const isReadyToEnter = entry.isIntersecting && entry.intersectionRatio >= 0.18;
        if (isReadyToEnter) {
          if (prototypeInViewRef.current) return;
          prototypeInViewRef.current = true;
          replayPrototype();
          return;
        }

        const isClearOfViewport = !entry.isIntersecting || entry.intersectionRatio <= 0.01;
        if (!isClearOfViewport) return;
        prototypeInViewRef.current = false;
        clearReplayFrame();
        setPrototypeVisible(false);
      },
      { rootMargin: "-6% 0px -14% 0px", threshold: [0, 0.01, 0.18, 0.32, 0.55] }
    );

    observer.observe(target);
    return () => {
      observer.disconnect();
      clearReplayFrame();
    };
  }, []);

  return (
    <section ref={prototypeRef} id="analytics-overview" data-page-motion="analytics-prototype" className="analytics-prototype-section mx-auto w-full max-w-[82rem] px-3 pb-12 pt-0 sm:px-5 lg:px-6 lg:pb-16">
      <div
        className={`analytics-prototype-stage rounded-[1.35rem] border border-white/12 bg-[linear-gradient(135deg,rgba(143,224,95,0.16)_0%,rgba(255,255,255,0.04)_45%,rgba(167,139,250,0.14)_100%)] p-1.5 text-white shadow-[0_28px_70px_rgba(0,0,0,0.45)] sm:rounded-[1.6rem] sm:p-2.5 lg:p-3 ${
          prototypeVisible ? "is-visible" : ""
        }`}
      >
        <div className="analytics-prototype-frame flex flex-col gap-2.5 rounded-[1.15rem] bg-[#061c17]/88 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl sm:p-2.5 lg:flex-row lg:p-3">
          <aside
            className="analytics-prototype-item analytics-dashboard-rail shrink-0 overflow-hidden rounded-[0.95rem] bg-white/[0.035] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] lg:w-[150px] xl:w-[164px] 2xl:w-[178px]"
            style={{ transitionDelay: prototypeVisible ? "110ms" : "0ms" }}
          >
            <nav aria-label="Analytics preview navigation" className="analytics-dashboard-nav flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:gap-2 lg:overflow-visible lg:pb-0">
              {dashboardNavItems.map((item) => {
                const active = item === activeDashboardTab;
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setActiveDashboardTab(item)}
                    className={`analytics-nav-button flex h-9 shrink-0 items-center gap-2 rounded-[0.75rem] px-2.5 text-[0.72rem] font-black transition sm:h-10 sm:px-3 sm:text-xs lg:w-full 2xl:h-10 ${
                      active
                        ? "is-active bg-[#8fe05f] text-[#0b1914] shadow-[0_10px_22px_rgba(143,224,95,0.28)]"
                        : "text-white/55 hover:bg-white/[0.06] hover:text-white"
                    }`}
                    aria-current={active ? "page" : undefined}
                    aria-pressed={active}
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${active ? "bg-[#0b1914]/55" : "bg-white/25"}`} />
                    <span>{item}</span>
                  </button>
                );
              })}
            </nav>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col rounded-[0.95rem] bg-white/[0.025] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:p-3.5 lg:p-4">
            <header
              className="analytics-prototype-item analytics-dashboard-header flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"
              style={{ transitionDelay: prototypeVisible ? "220ms" : "0ms" }}
            >
              <div>
                <div className="text-[0.64rem] font-black uppercase tracking-[0.2em] text-[#95ea63] sm:text-[0.72rem]">{view.kicker}</div>
                <h2 className="mt-1 text-[1.65rem] font-black leading-none tracking-normal text-white sm:text-3xl">{view.title}</h2>
                <p className="mt-1.5 max-w-2xl text-xs font-extrabold text-white/55 sm:text-sm">{view.subtitle}</p>
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setDateMenuOpen((open) => !open)}
                  className="analytics-date-button inline-flex h-10 w-full items-center justify-center gap-2 rounded-[0.75rem] border border-white/12 bg-white/[0.05] px-3 text-xs font-black text-white/75 shadow-[0_8px_18px_rgba(0,0,0,0.2)] transition hover:border-[#8fe05f]/40 hover:text-white sm:w-fit sm:px-4"
                  aria-label="Select analytics date range"
                  aria-expanded={dateMenuOpen}
                  aria-haspopup="menu"
                >
                  <DashboardCalendarIcon />
                  <span>{selectedDateRange}</span>
                  <span className={`transition-transform ${dateMenuOpen ? "rotate-180" : "rotate-0"}`}>
                    <DashboardChevronIcon />
                  </span>
                </button>

                <div
                  className={`analytics-date-menu absolute right-0 top-[calc(100%+0.6rem)] z-20 w-full min-w-[15rem] overflow-hidden rounded-[0.9rem] border border-white/12 bg-[#0b241e] p-1.5 shadow-[0_22px_46px_rgba(0,0,0,0.45)] transition ${
                    dateMenuOpen ? "is-open pointer-events-auto translate-y-0 opacity-100" : "pointer-events-none -translate-y-2 opacity-0"
                  }`}
                  role="menu"
                >
                  {dateRanges.map((range) => {
                    const selected = range === selectedDateRange;
                    return (
                      <button
                        key={range}
                        type="button"
                        onClick={() => {
                          setSelectedDateRange(range);
                          setDateMenuOpen(false);
                        }}
                        className={`flex w-full items-center justify-between rounded-[0.75rem] px-3 py-2.5 text-left text-xs font-black transition sm:text-sm ${
                          selected ? "bg-[#8fe05f]/12 text-[#aef07f]" : "text-white/70 hover:bg-white/[0.06] hover:text-white"
                        }`}
                        role="menuitem"
                      >
                        <span>{range}</span>
                        <span className={`${selected ? "opacity-100" : "opacity-0"}`}>✓</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </header>

            <div
              className="analytics-prototype-item analytics-insight-strip mt-3 rounded-[0.75rem] border border-[#8fe05f]/20 bg-[#8fe05f]/[0.07] px-3 py-2 text-xs font-bold leading-5 text-white/72"
              style={{ transitionDelay: prototypeVisible ? "310ms" : "0ms" }}
            >
              {view.insight}
            </div>

            <div className="analytics-kpi-grid mt-4 grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(min(100%,9.25rem),1fr))] sm:gap-2.5">
              {view.metrics.map((metric, index) => (
                <article
                  key={`${activeDashboardTab}-${metric.label}`}
                  className="analytics-prototype-item analytics-kpi-card min-h-[78px] rounded-[0.85rem] border border-white/8 bg-white/[0.04] p-3 shadow-[0_8px_18px_rgba(0,0,0,0.16)] sm:min-h-[86px] 2xl:min-h-[92px]"
                  style={{ transitionDelay: prototypeVisible ? `${390 + index * 70}ms` : "0ms" }}
                >
                  <div className="text-[0.68rem] font-black uppercase tracking-normal text-white/50 sm:text-xs">{metric.label}</div>
                  <div className="mt-2 flex flex-wrap items-end justify-between gap-x-2 gap-y-1 sm:mt-2.5">
                    <div className="text-lg font-black tracking-normal text-white min-[380px]:text-xl sm:text-2xl">{metric.value}</div>
                    <div className="analytics-change-pill rounded-full bg-[#8fe05f]/14 px-2 py-0.5 text-[0.68rem] font-black text-[#aef07f] sm:text-xs">{metric.change}</div>
                  </div>
                </article>
              ))}
            </div>

            <div className="mt-2.5 grid flex-1 gap-2.5 lg:grid-cols-[minmax(0,1.45fr)_minmax(220px,0.78fr)] 2xl:grid-cols-[minmax(0,1.48fr)_minmax(250px,0.84fr)]">
              <div key={`${activeDashboardTab}-chart`} className="analytics-prototype-item analytics-visual-panel" style={{ transitionDelay: prototypeVisible ? "700ms" : "0ms" }}>
                <RevenuePerformanceChart labels={view.chartLabels} insight={view.insight} />
              </div>
              <div key={`${activeDashboardTab}-platforms`} className="analytics-prototype-item analytics-visual-panel" style={{ transitionDelay: prototypeVisible ? "790ms" : "0ms" }}>
                <PlatformRevenueCard title={platformTitle} totalLabel={view.totalLabel} totalValue={view.totalValue} platforms={view.platforms} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function HomePage() {
  const [menuOpen, setmenuOpen] = useState(false);
  const [navScrolled, setNavScrolled] = useState(false);
  const navPillRef = useRef<HTMLElement | null>(null);
  const navIndicatorRef = useRef<HTMLSpanElement | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [displayName, setDisplayName] = useState("Login");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string>("Home");
  const [revealedSectionId, setRevealedSectionId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [leadValidationMessage, setLeadValidationMessage] = useState<string | null>(null);
  const [leadInvalidActive, setLeadInvalidActive] = useState(false);
  const trimmedEmail = email.trim();
  const leadEmailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);
  const router = useRouter();
  const leadRedirectingRef = useRef(false);
  const scrollRafRef = useRef<number | null>(null);
  const revealTimeoutRef = useRef<number | null>(null);
  const leadInvalidRafRef = useRef<number | null>(null);
  const leadInvalidTimerRef = useRef<number | null>(null);
  const homeMotionRef = useRef<HTMLDivElement | null>(null);
  const motionRafRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (leadInvalidRafRef.current !== null) {
        window.cancelAnimationFrame(leadInvalidRafRef.current);
      }
      if (leadInvalidTimerRef.current !== null) {
        window.clearTimeout(leadInvalidTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let active = true;
    const cached = readCachedAuth();
    const cachedRole = cached?.role ?? null;
    if (cached && active) {
      setRole(cached.role);
      // Last known name on first paint; a generic label only for brand-new caches.
      setDisplayName(cached.name || (cached.role === "Admin" ? "Admin" : "Workspace"));
      setAvatarUrl(cached.avatar ?? null);
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

        // Show the session's name right away so a slow/failed profile call never leaves a placeholder.
        const sessionName = getDisplayName(user);
        const sessionAvatar = getAvatarUrl(user);
        setDisplayName(sessionName);
        setAvatarUrl(sessionAvatar);
        setAccountEmail(user.email ?? null);

        const ensured = await fetch("/api/bootstrap-profile", { method: "POST" });
        if (!ensured.ok) throw new Error("Profile unavailable");
        const profile = await ensured.json() as { role?: Exclude<Role, null>; display_name?: string | null } | null;

        if (!active) return;

        const resolvedRole = profile?.role ?? "Worker";
        const resolvedName = getDisplayName(user, profile?.display_name);
        setRole(resolvedRole);
        setDisplayName(resolvedName);
        writeCachedRole(resolvedRole, { name: resolvedName, avatar: sessionAvatar });
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
      if (motionRafRef.current !== null) {
        window.cancelAnimationFrame(motionRafRef.current);
      }
    };
  }, []);

  useSyncHomeTheme();

  useLayoutEffect(() => {
    const nav = navPillRef.current;
    const indicator = navIndicatorRef.current;
    if (!nav || !indicator) return;
    const place = () => {
      const active = nav.querySelector<HTMLElement>('a[aria-current="location"]');
      if (!active || active.offsetWidth === 0) {
        indicator.style.opacity = "0";
        return;
      }
      indicator.style.opacity = "1";
      indicator.style.width = `${active.offsetWidth}px`;
      indicator.style.transform = `translateX(${active.offsetLeft}px)`;
    };
    place();
    // Enable the slide only after the first placement so it doesn't animate in from the left edge.
    const frame = window.requestAnimationFrame(() => {
      indicator.dataset.ready = "true";
    });
    const observer = new ResizeObserver(place);
    observer.observe(nav);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [activeSection]);

  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setmenuOpen(false);
    };
    const desktopQuery = window.matchMedia("(min-width: 1024px)");
    const onDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setmenuOpen(false);
    };
    window.addEventListener("keydown", onEscape);
    desktopQuery.addEventListener("change", onDesktop);
    return () => {
      root.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onEscape);
      desktopQuery.removeEventListener("change", onDesktop);
    };
  }, [menuOpen]);

  useEffect(() => {
    const targets = [
      { id: "top", label: "Home" },
      { id: "solution", label: "How It Works" },
      { id: "company", label: "Why Reelencer" },
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

  useEffect(() => {
    const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-page-motion]"));
    if (!targets.length) return;

    targets.forEach((target) => {
      target.querySelectorAll<HTMLElement>("[data-page-stagger]").forEach((child, index) => {
        child.style.setProperty("--motion-index", String(index));
        child.style.setProperty("--motion-delay", `${120 + index * 62}ms`);
      });
    });

    const reveal = (target: HTMLElement) => {
      target.classList.add("is-visible");
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      targets.forEach(reveal);
      return;
    }

    const BrowserIntersectionObserver = window.IntersectionObserver;
    if (typeof BrowserIntersectionObserver === "undefined") {
      const frame = window.requestAnimationFrame(() => targets.forEach(reveal));
      return () => window.cancelAnimationFrame(frame);
    }

    const observer = new BrowserIntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const target = entry.target as HTMLElement;
          const revealRatio = target.dataset.pageMotion === "analytics-intro" ? 0.38 : 0.12;
          if (entry.intersectionRatio < revealRatio) return;
          reveal(target);
          observer.unobserve(target);
        });
      },
      { rootMargin: "0px 0px -12% 0px", threshold: [0.12, 0.24, 0.38, 0.52] }
    );

    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const root = homeMotionRef.current;
    if (!root) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    let targetPointerX = 0;
    let targetPointerY = 0;
    let visualPointerX = 0;
    let visualPointerY = 0;
    let targetScrollY = window.scrollY;
    let visualScrollY = targetScrollY;
    let lastFrame = performance.now();

    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

    // Performance: every motion variable is registered as non-inheriting (globals.css @property) and written only
    // onto the element that reads it, so a frame restyles a handful of nodes instead of the whole page. Values are
    // only written when they change, and the scrollable height is cached (reading it per frame forced a layout).
    const scrollTargets = Array.from(root.querySelectorAll<HTMLElement>(".rx-progress, .rx-aurora-blob--a, .rx-aurora-blob--c"));
    const heroDesktop = root.querySelector<HTMLElement>('[data-page-motion="hero-desktop"]');
    const prototype = root.querySelector<HTMLElement>('[data-page-motion="analytics-prototype"]');
    const TILT_CARD = '[data-page-motion="cards"].is-visible > article, [data-page-motion="section"].is-visible article, [data-page-motion="company"].is-visible [data-page-stagger], [data-page-motion="cta"].is-visible > div';
    let tiltCard: HTMLElement | null = null;
    const written = new WeakMap<HTMLElement, Map<string, string>>();
    const write = (el: HTMLElement | null, name: string, value: string) => {
      if (!el) return;
      let props = written.get(el);
      if (!props) written.set(el, (props = new Map()));
      if (props.get(name) === value) return;
      props.set(name, value);
      el.style.setProperty(name, value);
    };
    let scrollable = 1;
    const measure = () => {
      scrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    };
    measure();
    const sizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => { measure(); schedule(); }) : null;
    sizeObserver?.observe(document.body);

    const renderMotionFrame = (now: number) => {
      motionRafRef.current = null;
      const elapsed = clamp(now - lastFrame, 16, 80);
      lastFrame = now;
      const shouldReduceMotion = reduceMotion.matches;
      const scrollEase = shouldReduceMotion ? 1 : 1 - Math.pow(0.001, elapsed / 220);
      const pointerEase = shouldReduceMotion ? 1 : 1 - Math.pow(0.001, elapsed / 320);

      visualScrollY += (targetScrollY - visualScrollY) * scrollEase;
      visualPointerX += (targetPointerX - visualPointerX) * pointerEase;
      visualPointerY += (targetPointerY - visualPointerY) * pointerEase;

      if (Math.abs(targetScrollY - visualScrollY) < 0.04) visualScrollY = targetScrollY;
      if (Math.abs(targetPointerX - visualPointerX) < 0.001) visualPointerX = targetPointerX;
      if (Math.abs(targetPointerY - visualPointerY) < 0.001) visualPointerY = targetPointerY;

      const scrollProgress = clamp(visualScrollY / scrollable, 0, 1);
      const progress = scrollProgress.toFixed(4);
      for (const el of scrollTargets) write(el, "--page-scroll", progress);
      write(tiltCard, "--tilt-x", `${(-visualPointerY * 1.15).toFixed(2)}deg`);
      write(tiltCard, "--tilt-y", `${(visualPointerX * 1.4).toFixed(2)}deg`);
      write(heroDesktop, "--hero-shift-x", `${(visualPointerX * -0.14).toFixed(3)}rem`);
      write(heroDesktop, "--hero-shift-y", `${(scrollProgress * -0.9).toFixed(3)}rem`);
      write(prototype, "--prototype-shift-x", `${(visualPointerX * 0.08).toFixed(3)}rem`);
      write(prototype, "--prototype-shift-y", `${(scrollProgress * -0.26).toFixed(3)}rem`);

      const hasScrollToSettle = Math.abs(targetScrollY - visualScrollY) > 0.08;
      const hasPointerToSettle = Math.abs(targetPointerX - visualPointerX) > 0.002 || Math.abs(targetPointerY - visualPointerY) > 0.002;
      if (!shouldReduceMotion && (hasScrollToSettle || hasPointerToSettle)) {
        motionRafRef.current = window.requestAnimationFrame(renderMotionFrame);
      }
    };

    function schedule() {
      targetScrollY = window.scrollY;
      if (motionRafRef.current !== null) return;
      lastFrame = performance.now();
      motionRafRef.current = window.requestAnimationFrame(renderMotionFrame);
    }

    const onPointerMove = (event: PointerEvent) => {
      if (reduceMotion.matches || !finePointer.matches) return;
      // Tilt only the card under the pointer; clear the previous one when it changes.
      const card = event.target instanceof Element ? event.target.closest<HTMLElement>(TILT_CARD) : null;
      if (card !== tiltCard) {
        if (tiltCard) {
          tiltCard.style.removeProperty("--tilt-x");
          tiltCard.style.removeProperty("--tilt-y");
          written.delete(tiltCard);
        }
        tiltCard = card && root.contains(card) ? card : null;
      }
      targetPointerX = (event.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
      targetPointerY = (event.clientY / Math.max(1, window.innerHeight) - 0.5) * 2;
      schedule();
    };
    const onResize = () => {
      measure();
      schedule();
    };

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", onResize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    schedule();

    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
      sizeObserver?.disconnect();
      if (motionRafRef.current !== null) {
        window.cancelAnimationFrame(motionRafRef.current);
        motionRafRef.current = null;
      }
    };
  }, []);

  const primaryHref = role === "Admin" ? "/admin" : role === "Worker" ? "/workspace" : "/signup?next=/";
  const primaryLabel = role ? "Open Dashboard" : "Start With Reelencer";
  const accountHref = role === "Admin" ? "/admin" : role === "Worker" ? "/workspace" : "/login?next=/";
  const browseHref = FIND_GIGS_HREF;
  const signupHref =
    role === "Admin"
      ? "/admin"
      : role === "Worker"
        ? "/workspace"
        : "/signup?next=/";
  const loginHref = "/login?next=/";
  // Cached identity renders immediately; otherwise wait for auth to resolve (avoids a "Login" flash).
  const accountLabel = role ? displayName : authResolved ? "Login" : "";
  const accountFirstName = accountLabel.trim().split(/\s+/)[0] ?? "";
  const accountInitial = getInitials(accountLabel) || "L";

  async function handleSignOut() {
    try {
      await supabase.auth.signOut();
    } finally {
      clearCachedRole();
      setRole(null);
      setDisplayName("Login");
      setmenuOpen(false);
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
    const headerHeight = Math.min(document.querySelector<HTMLElement>(".rx-nav")?.offsetHeight ?? 0, 76);
    const targetY = Math.max(0, startY + rect.top - (id === "top" ? 0 : headerHeight + 8));
    const distance = targetY - startY;
    const duration = Math.min(1200, Math.max(560, Math.abs(distance) * 0.55));
    const start = performance.now();

    setActiveSection(sectionLabel);
    window.history.replaceState(null, "", sectionHref);

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = easeInOutQuint(progress);
      window.scrollTo({ top: startY + distance * eased, behavior: "auto" });
      if (progress < 1) {
        scrollRafRef.current = window.requestAnimationFrame(tick);
      } else {
        window.scrollTo({ top: targetY, behavior: "auto" });
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


  function replayLeadInvalidFeedback(message: string) {
    if (leadInvalidRafRef.current !== null) {
      window.cancelAnimationFrame(leadInvalidRafRef.current);
    }
    if (leadInvalidTimerRef.current !== null) {
      window.clearTimeout(leadInvalidTimerRef.current);
    }

    setLeadValidationMessage(message);
    setLeadInvalidActive(false);
    if ("vibrate" in navigator) {
      (navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean }).vibrate?.([28, 36, 28]);
    }

    leadInvalidRafRef.current = window.requestAnimationFrame(() => {
      leadInvalidRafRef.current = null;
      setLeadInvalidActive(true);
      leadInvalidTimerRef.current = window.setTimeout(() => {
        leadInvalidTimerRef.current = null;
        setLeadInvalidActive(false);
      }, 760);
    });
  }

  // Warm up /signup as soon as the email looks real, so the hand-off below is instant.
  useEffect(() => {
    if (leadEmailLooksValid && !role) router.prefetch(signupHref);
  }, [leadEmailLooksValid, role, router, signupHref]);

  function handleLeadEmailChange(event: React.ChangeEvent<HTMLInputElement>) {
    setEmail(event.target.value);
    // Keep the hand-off current, so every sign-up and sign-in link on the page carries a valid email too.
    const next = event.target.value.trim();
    stashAuthEmail(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next) ? next : "");
    if (leadValidationMessage) {
      setLeadValidationMessage(null);
    }
  }

  function handleLeadSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmedEmail) {
      replayLeadInvalidFeedback("Enter your email first.");
      return;
    }
    if (!leadEmailLooksValid) {
      replayLeadInvalidFeedback("Enter a valid email address.");
      return;
    }

    if (leadRedirectingRef.current) return;
    leadRedirectingRef.current = true;
    stashAuthEmail(trimmedEmail);
    // Let the button's sweep play before the (prefetched, client-side) navigation; skip the wait for reduced motion.
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(() => router.push(signupHref), reduceMotion ? 0 : 420);
  }

  return (
    <div ref={homeMotionRef} className="home-motion-scope min-h-screen bg-[#041f1a] text-white">
      <div aria-hidden className="rx-progress" />
      <div
        id="top"
        className="home-page-bg relative isolate min-h-screen overflow-clip"
      >
        <div aria-hidden className="rx-aurora">
          <span className="rx-aurora-blob rx-aurora-blob--a" />
          <span className="rx-aurora-blob rx-aurora-blob--b" />
          <span className="rx-aurora-blob rx-aurora-blob--c" />
        </div>
        <div aria-hidden className="rx-hero-grid" />
        <div aria-hidden className="rx-grain" />
        <div data-depth-layer="grid" className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(140,209,115,0.12)_1.1px,transparent_1.1px)] bg-[length:12px_12px] opacity-80" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/45 to-transparent" />
        <div data-depth-layer="accent-a" className="pointer-events-none absolute right-[9%] top-[21%] hidden h-44 w-44 rounded-full bg-[#8fe05f]/10 blur-3xl lg:block" />
        <div data-depth-layer="accent-b" className="pointer-events-none absolute left-[5%] top-[30%] hidden h-52 w-52 rounded-full bg-[#5a45e3]/10 blur-3xl lg:block" />

        <aside
          id="mobile-navigation"
          className={`rx-drawer fixed inset-y-0 right-0 z-[70] flex h-[100dvh] w-[88vw] max-w-[380px] flex-col overflow-y-auto border-l border-white/10 bg-[linear-gradient(180deg,rgba(9,40,32,0.97)_0%,rgba(5,26,21,0.98)_100%)] px-4 pb-5 pt-4 shadow-[-28px_0_64px_rgba(0,0,0,0.45)] backdrop-blur-xl transition-[transform,opacity] duration-500 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] min-[430px]:px-5 lg:hidden ${
            menuOpen ? "translate-x-0 opacity-100" : "translate-x-[104%] opacity-0"
          }`}
          aria-label="Site navigation"
          aria-hidden={!menuOpen}
          inert={!menuOpen}
        >
          <div className="flex items-center justify-between gap-3">
            <BrandMark compact showTagline={false} />
            <button
              type="button"
              onClick={() => setmenuOpen(false)}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] text-white/90 transition hover:border-white/30 hover:bg-white/10"
              aria-label="Close navigation"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>

          {role && (
            <Link
              href={accountHref}
              onClick={() => setmenuOpen(false)}
              className="mt-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.05] p-3 transition hover:bg-white/[0.08]"
            >
              <AccountAvatar src={avatarUrl} initials={accountInitial} className="h-11 w-11 rounded-xl text-base" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-white">{accountLabel || "Account"}</span>
                <span className="block text-xs text-white/50">{role === "Admin" ? "Admin console" : "Creator workspace"}</span>
              </span>
              <span className="text-white/40" aria-hidden>
                →
              </span>
            </Link>
          )}

          <nav aria-label="Sections" className="mt-6">
            <div className="px-1 text-[0.68rem] font-bold uppercase tracking-[0.22em] text-white/40">Explore</div>
            <ul className="mt-2 grid gap-1">
              {navItems.map((item, index) => {
                const active = activeSection === item.label;
                return (
                  <li
                    key={item.label}
                    className={`transition-all duration-500 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${menuOpen ? "translate-x-0 opacity-100" : "translate-x-4 opacity-0"}`}
                    style={{ transitionDelay: menuOpen ? `${80 + index * 45}ms` : "0ms" }}
                  >
                    <a
                      href={item.href}
                      onClick={(event) => {
                        event.preventDefault();
                        setmenuOpen(false);
                        animateToSection(item.href, item.label);
                      }}
                      aria-current={active ? "location" : undefined}
                      className={`group flex items-center gap-3 rounded-2xl px-3 py-3 transition ${active ? "bg-white/[0.07]" : "hover:bg-white/[0.05]"}`}
                    >
                      <span className={`h-2 w-2 shrink-0 rounded-full transition ${active ? "bg-[#8fe05f] shadow-[0_0_10px_rgba(143,224,95,0.7)]" : "bg-white/20"}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[1.02rem] font-semibold text-white">{item.label}</span>
                        <span className="block truncate text-xs text-white/48">{item.items.slice(0, 2).join(" · ")}</span>
                      </span>
                      <span className="text-white/35 transition group-hover:translate-x-0.5 group-hover:text-white/70" aria-hidden>
                        →
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <Link
              href={browseHref}
              onClick={() => setmenuOpen(false)}
              className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.08]"
            >
              Browse gigs
              <span className="mt-0.5 block text-xs font-normal text-white/45">See what&apos;s live</span>
            </Link>
            <Link
              href={role ? "/payouts" : loginHref}
              onClick={() => setmenuOpen(false)}
              className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.08]"
            >
              {role ? "Payouts" : "Log in"}
              <span className="mt-0.5 block text-xs font-normal text-white/45">{role ? "Track earnings" : "Welcome back"}</span>
            </Link>
          </div>

          <div className="mt-auto grid gap-3 pt-6">
            <Link
              href={primaryHref}
              onClick={() => setmenuOpen(false)}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#8fe05f] px-5 text-base font-extrabold text-[#0b1914] shadow-[0_14px_30px_rgba(143,224,95,0.25)] transition hover:bg-[#9ae86a]"
            >
              {primaryLabel}
              <span aria-hidden>→</span>
            </Link>
            {role && (
              <button
                type="button"
                onClick={() => {
                  setmenuOpen(false);
                  void handleSignOut();
                }}
                className="h-11 rounded-2xl border border-white/10 text-sm font-semibold text-[#ff9f9f] transition hover:bg-white/[0.05]"
              >
                Sign out
              </button>
            )}
            <a
              href="mailto:support@reelencer.com"
              onClick={() => setmenuOpen(false)}
              className="flex items-center gap-3 rounded-2xl border border-white/8 bg-black/15 px-3 py-2.5 transition hover:border-white/20"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-white/80" aria-hidden>
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="5" width="18" height="14" rx="2.5" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4 7 8 6 8-6" />
                </svg>
              </span>
              <span className="min-w-0 leading-tight">
                <span className="block text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-white/45">Need help?</span>
                <span className="block truncate text-sm font-semibold text-white">support@reelencer.com</span>
              </span>
            </a>
          </div>
        </aside>

        <button
          type="button"
          tabIndex={-1}
          className={`fixed inset-0 z-[65] transition-all duration-500 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] lg:hidden ${
            menuOpen ? "pointer-events-auto bg-black/55 backdrop-blur-[3px] opacity-100" : "pointer-events-none bg-black/0 backdrop-blur-0 opacity-0"
          }`}
          onClick={() => setmenuOpen(false)}
          aria-label="Dismiss navigation overlay"
        />

        <header data-page-motion="header" data-scrolled={navScrolled ? "true" : undefined} className="rx-nav sticky top-0 z-50">
          <div className="rx-nav-bar mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-3 min-[430px]:px-4 sm:px-6 lg:gap-5 lg:px-8">
            <div className="min-w-0 shrink lg:hidden xl:block">
              <BrandMark compact={navScrolled} taglineHidden={navScrolled} />
            </div>
            <div className="hidden min-w-0 shrink lg:block xl:hidden">
              <BrandMark compact showTagline={false} />
            </div>

            <nav
              ref={navPillRef}
              aria-label="Primary"
              className="rx-nav-pill relative hidden items-center gap-0.5 rounded-full border border-white/10 bg-white/[0.04] p-1 backdrop-blur-md lg:flex"
            >
              <span ref={navIndicatorRef} aria-hidden className="rx-nav-indicator pointer-events-none absolute bottom-1 left-0 top-1 rounded-full opacity-0" />
              {navItems.map((item) => {
                const active = activeSection === item.label;
                return (
                  <a
                    key={item.label}
                    href={item.href}
                    onClick={(event) => {
                      event.preventDefault();
                      animateToSection(item.href, item.label);
                    }}
                    aria-current={active ? "location" : undefined}
                    className={`rx-nav-link relative z-10 whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-semibold transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fe05f] xl:px-4 ${
                      active ? "text-black" : "text-white/72 hover:bg-white/8 hover:text-white"
                    }`}
                  >
                    {item.label}
                  </a>
                );
              })}
            </nav>

            <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
              {!authResolved ? (
                <span className="hidden h-11 w-44 animate-pulse rounded-full bg-white/8 sm:block" aria-hidden />
              ) : (
                <>
                  {role ? (
                    <AccountMenu
                      name={accountLabel}
                      firstName={accountFirstName}
                      email={accountEmail}
                      roleLabel={role === "Admin" ? "Admin" : "Creator"}
                      avatar={<AccountAvatar src={avatarUrl} initials={accountInitial} className="h-8 w-8 text-[0.72rem]" />}
                      largeAvatar={<AccountAvatar src={avatarUrl} initials={accountInitial} className="h-11 w-11 text-sm" />}
                      links={[
                        {
                          href: accountHref,
                          label: role === "Admin" ? "Open admin console" : "Open workspace",
                          hint: role === "Admin" ? "Gigs, reviews & payouts" : "Dashboard & submissions",
                          icon: "grid",
                        },
                        ...(role === "Admin"
                          ? []
                          : [
                              { href: browseHref, label: "Find gigs", hint: "Open brand briefs", icon: "search" as const },
                              { href: "/payouts", label: "Payouts", hint: "Earnings & withdrawals", icon: "wallet" as const },
                            ]),
                      ]}
                      onSignOut={() => void handleSignOut()}
                    />
                  ) : (
                    <Link
                      href={loginHref}
                      className="hidden h-11 items-center rounded-full px-4 text-sm font-semibold text-white/80 transition hover:bg-white/8 hover:text-white sm:inline-flex"
                    >
                      Log in
                    </Link>
                  )}
                  <Link
                    href={primaryHref}
                    className="group hidden h-11 items-center gap-2 rounded-full bg-[linear-gradient(180deg,#a5ec78,#86d957)] py-1.5 pl-4 pr-1.5 text-sm font-extrabold text-[#0b1914] shadow-[0_10px_24px_-6px_rgba(143,224,95,0.55),inset_0_1px_0_rgba(255,255,255,0.45)] ring-1 ring-[#6fc447]/40 transition hover:-translate-y-px hover:shadow-[0_14px_30px_-6px_rgba(143,224,95,0.65),inset_0_1px_0_rgba(255,255,255,0.45)] sm:inline-flex sm:pl-4.5"
                  >
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" strokeLinecap="round" className="hidden h-[1.05rem] w-[1.05rem] md:block" aria-hidden>
                      {role ? (
                        <path d="M3.5 3.5h5v5h-5zM11.5 3.5h5v5h-5zM3.5 11.5h5v5h-5zM11.5 11.5h5v5h-5z" />
                      ) : (
                        <path d="M10 2.5v3M10 14.5v3M2.5 10h3M14.5 10h3M4.7 4.7l2.1 2.1M13.2 13.2l2.1 2.1M4.7 15.3l2.1-2.1M13.2 6.8l2.1-2.1" />
                      )}
                    </svg>
                    {role ? "Dashboard" : "Get started"}
                    <span className="relative grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-[#0b1914] text-[#a5ec78]" aria-hidden>
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-6 group-hover:-translate-y-6">
                        <path d="M5.5 14.5 14.5 5.5M7.5 5.5h7v7" />
                      </svg>
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="absolute h-4 w-4 -translate-x-6 translate-y-6 transition-transform duration-300 group-hover:translate-x-0 group-hover:translate-y-0">
                        <path d="M5.5 14.5 14.5 5.5M7.5 5.5h7v7" />
                      </svg>
                    </span>
                  </Link>
                </>
              )}

              <ThemeToggle className="h-11 w-11 hover:[&_svg]:rotate-[18deg] [&_svg]:transition-transform [&_svg]:duration-500" />

              <button
                type="button"
                onClick={() => setmenuOpen(true)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/[0.05] text-white backdrop-blur-md transition hover:border-white/30 hover:bg-white/10 lg:hidden"
                aria-label="Open navigation"
                aria-expanded={menuOpen}
                aria-controls="mobile-navigation"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path strokeLinecap="round" d="M5 7h14M9 12h10M5 17h14" />
                </svg>
              </button>
            </div>
          </div>
        </header>

        <main className="relative z-20">
          <HomeHero
            role={role}
            authResolved={authResolved}
            findHref={browseHref}
            dashboardHref={primaryHref}
            loginHref={loginHref}
            stats={trustStats}
            onScrollTo={animateToSection}
            renderLeadForm={(ghost) => (
              <form
                onSubmit={handleLeadSubmit}
                noValidate
                className={`lead-capture-card rounded-[1.45rem] border border-white/10 bg-[#0d3b32]/72 p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-sm ${
                  leadInvalidActive ? "is-invalid" : ""
                }`}
              >
                <div className="grid items-stretch gap-2.5 min-[520px]:grid-cols-[minmax(0,1fr)_auto]">
                  <label className="group/field relative block min-w-0" htmlFor={ghost ? undefined : "hero-email"}>
                    <span className="sr-only">Email address</span>
                    {/* Envelope */}
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400 transition-colors group-focus-within/field:text-[#3f9a2c]" aria-hidden>
                      <rect x="2.5" y="4.5" width="15" height="11" rx="2.2" />
                      <path d="m3.5 6 6.5 5 6.5-5" />
                    </svg>
                    <input
                      id={ghost ? undefined : "hero-email"}
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      enterKeyHint="go"
                      placeholder="Enter your email"
                      value={email}
                      onChange={handleLeadEmailChange}
                      aria-invalid={Boolean(leadValidationMessage)}
                      aria-describedby={ghost ? undefined : "hero-email-perks"}
                      className="h-14 w-full min-w-0 rounded-[1.1rem] border border-black/8 bg-[#fff] pl-12 pr-12 text-[1rem] font-semibold text-slate-800 shadow-[inset_0_1px_2px_rgba(15,23,42,0.06)] outline-none transition placeholder:font-medium placeholder:text-slate-400 focus:border-[#8fe05f] focus:shadow-[0_0_0_4px_rgba(143,224,95,0.28)] sm:h-[3.75rem] lg-short:h-12"
                    />
                    {/* Valid-email check */}
                    <span
                      aria-hidden
                      className={`pointer-events-none absolute right-3.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full bg-[#22c55e] text-white transition duration-300 ${
                        leadEmailLooksValid ? "scale-100 opacity-100" : "scale-50 opacity-0"
                      }`}
                    >
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                        <path d="m5 10.5 3.2 3.2L15 7" />
                      </svg>
                    </span>
                  </label>
                  <AnimatedLeadSubmitButton
                    label="Start earning"
                    className="h-14 rounded-[1.1rem] px-6 text-[1rem] sm:h-[3.75rem] lg-short:h-12"
                    arrowClassName="ml-3 h-9 w-9"
                    canPlaySubmitAnimation={leadEmailLooksValid}
                    invalidActive={leadInvalidActive}
                  />
                </div>
                {!ghost && leadValidationMessage && <LeadValidationPrompt message={leadValidationMessage} compact />}
                {/* Perks */}
                <ul id={ghost ? undefined : "hero-email-perks"} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-2 pb-1 pt-3 lg-short:pt-2 text-[0.8rem] font-semibold text-white/70 sm:text-[0.84rem]">
                  {["Free to join", "No card needed", "Paid to your bank"].map((perk) => (
                    <li key={perk} className="inline-flex items-center gap-1.5">
                      <span className="grid h-4 w-4 place-items-center rounded-full bg-[#8fe05f]/25 text-[#8fe05f]" aria-hidden>
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-2.5 w-2.5">
                          <path d="m5 10.5 3.2 3.2L15 7" />
                        </svg>
                      </span>
                      {perk}
                    </li>
                  ))}
                </ul>
              </form>
            )}
          />

          <AnalyticsIntroSection />
          <AnalyticsOverviewSection />

          <section data-page-motion="rail" aria-label="Reels for every niche" className="relative w-full overflow-hidden border-y border-white/8 bg-white/[0.025] py-8 backdrop-blur-[2px] sm:py-10">
            <div data-page-stagger className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-4 sm:flex-row sm:items-end sm:justify-between sm:px-6 lg:px-8">
              <p className="text-[0.7rem] font-bold uppercase tracking-[0.26em] text-[#95ea63] sm:text-xs">Reels for every niche</p>
              <p className="max-w-md text-sm leading-6 text-white/58 sm:text-right">Whatever you create, there&apos;s a brief that fits your style.</p>
            </div>
            <div className="mt-5 grid gap-3 sm:mt-6">
              {reelNicheRows.map((row, rowIndex) => (
                <div key={rowIndex} className="rx-marquee" aria-hidden={rowIndex > 0 ? true : undefined}>
                  <div className={`rx-marquee-track ${rowIndex % 2 ? "rx-marquee-track--reverse" : ""}`}>
                    {[0, 1].map((copy) => (
                      <ul key={copy} className="flex shrink-0 gap-3 pr-3" aria-hidden={copy > 0 ? true : undefined}>
                        {row.map((niche) => (
                          <li
                            key={niche}
                            className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/80 sm:px-5 sm:py-2.5 sm:text-[0.95rem]"
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-[#8fe05f]" aria-hidden />
                            {niche}
                          </li>
                        ))}
                      </ul>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section
            id="company"
            data-page-motion="cards"
            data-reveal-settle={revealedSectionId === "company" ? "true" : undefined}
            className="rx-ambient rx-ambient--why mx-auto w-full max-w-7xl px-3 pb-6 pt-16 min-[430px]:px-4 sm:px-6 sm:pt-20 lg:px-8 lg:pt-24"
          >
            <div data-page-stagger className="mx-auto max-w-3xl text-center">
              <div className="earn-kicker justify-center text-xs font-bold uppercase tracking-[0.28em] text-[#95ea63] sm:text-sm">Why Reelencer</div>
              <h2 className="mt-4 text-balance text-[clamp(1.9rem,6.6vw,3.6rem)] font-black leading-[1.04] tracking-[-0.045em] text-white">
                Not another freelance marketplace. <span className="earn-gradient-text">A workspace that pays.</span>
              </h2>
              <p className="mx-auto mt-4 max-w-2xl text-pretty text-[clamp(0.98rem,3.6vw,1.12rem)] leading-[1.7] text-white/66">
                Reelencer replaces cold DMs, bidding wars, and invoice chasing with one clear path from brief to payout.
              </p>
            </div>

            <div className="earn-scroller -mx-3 mt-9 flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-3 min-[430px]:-mx-4 min-[430px]:px-4 sm:mt-12 md:mx-0 md:grid md:grid-cols-2 md:gap-5 md:overflow-visible md:px-0 md:pb-0 lg:grid-cols-3 lg:gap-6">
              {whyReelencerCards.map((card, index) => (
                <article
                  key={card.kicker}
                  data-page-stagger
                  className={`earn-feature-card rx-tone-${["green", "violet", "sky"][index]} group flex w-[86%] max-w-[23rem] shrink-0 snap-start flex-col overflow-hidden rounded-[1.6rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.065),rgba(255,255,255,0.02))] shadow-[0_14px_30px_rgba(0,0,0,0.18)] transition duration-300 md:w-auto md:max-w-none lg:rounded-[2rem] ${
                    index === 2 ? "md:col-span-2 md:flex-row lg:col-span-1 lg:flex-col" : ""
                  }`}
                >
                  <WhyCardVisual
                    kind={card.visual}
                    className={index === 2 ? "md:h-auto md:min-h-[13rem] md:w-1/2 md:border-b-0 md:border-r lg:h-48 lg:min-h-0 lg:w-auto lg:border-b lg:border-r-0" : ""}
                  />
                  <div className="flex flex-1 flex-col p-5 sm:p-6">
                    <div className="text-xs font-bold uppercase tracking-[0.22em] text-[#95ea63]">{card.kicker}</div>
                    <h3 className="mt-2.5 text-balance text-[clamp(1.25rem,4.6vw,1.55rem)] font-bold leading-[1.18] tracking-[-0.035em] text-white">{card.title}</h3>
                    <p className="mt-3 text-pretty text-[0.95rem] leading-[1.65] text-white/64">{card.body}</p>
                  </div>
                </article>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-center gap-2 text-xs font-semibold text-white/42 md:hidden" aria-hidden>
              Swipe for more
              <span className="earn-swipe-hint">→</span>
            </div>

            <div data-page-stagger className="mt-8 flex flex-col items-stretch justify-center gap-3 min-[430px]:flex-row min-[430px]:items-center sm:mt-10">
              <Link
                href={signupHref}
                className="resources-cta-button group inline-flex h-13 items-center justify-center gap-2 rounded-full bg-[#8fe05f] px-7 text-base font-extrabold text-[#0b1914] shadow-[0_16px_34px_rgba(143,224,95,0.22)] transition hover:bg-[#9ae86a]"
              >
                {role ? "Open your workspace" : "Start earning"}
                <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
              </Link>
              <Link
                href={browseHref}
                className="inline-flex h-13 items-center justify-center rounded-full border border-white/14 bg-white/[0.04] px-7 text-base font-bold text-white transition hover:border-white/30 hover:bg-white/[0.08]"
              >
                Browse live gigs
              </Link>
            </div>
          </section>

          <section
            id="solution"
            data-page-motion="section"
            data-reveal-settle={revealedSectionId === "solution" ? "true" : undefined}
            className="rx-ambient rx-ambient--left mx-auto w-full max-w-7xl px-3 pb-16 pt-2 min-[430px]:px-4 sm:px-6 lg:px-8 lg:pb-20"
          >
            <div className="earn-panel relative isolate overflow-hidden rounded-[1.6rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] px-4 py-7 shadow-[0_20px_50px_rgba(0,0,0,0.18)] min-[430px]:px-5 sm:rounded-[2rem] sm:px-8 sm:py-9 lg:rounded-[2.4rem] lg:px-10 lg:py-11">
              <div className="grid gap-7 lg:grid-cols-[minmax(0,1.2fr)_minmax(17rem,0.8fr)] lg:items-end lg:gap-12">
                <div data-page-stagger className="min-w-0">
                  <div className="earn-kicker text-xs font-bold uppercase tracking-[0.28em] text-[#95ea63] sm:text-sm">How It Works</div>
                  <h2 className="mt-4 max-w-3xl text-balance text-[clamp(2rem,7.4vw,3.6rem)] font-black leading-[1.02] tracking-[-0.045em] text-white lg:text-[3.3rem] xl:text-[4rem]">
                    How Reelencer turns your reels into <span className="earn-gradient-text">reliable income.</span>
                  </h2>
                  <p className="mt-4 max-w-2xl text-pretty text-[clamp(0.98rem,3.6vw,1.12rem)] leading-[1.7] text-white/68 sm:mt-5">
                    Pick a brand gig, create the reel, and get paid once it&apos;s approved. Every step from discovery to payout stays in one place.
                  </p>
                </div>

                <div data-page-stagger className="hidden rounded-[1.4rem] border border-white/10 bg-[#0b2f27]/70 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-sm sm:p-5 md:block">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <div className="text-[0.68rem] font-bold uppercase tracking-[0.22em] text-white/46 sm:text-xs">Workflow confidence</div>
                      <div className="mt-1 text-[clamp(2.2rem,8vw,2.8rem)] font-black leading-none tracking-[-0.05em] text-white">100%</div>
                    </div>
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#8fe05f] text-[#0b1914] shadow-[0_10px_24px_rgba(143,224,95,0.28)]">
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m5 12.5 4.5 4.5L19 7.5" />
                      </svg>
                    </div>
                  </div>
                  <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/8">
                    <div className="earn-meter-fill h-full rounded-full bg-[linear-gradient(90deg,#5fbf45,#b4f28a)]" />
                  </div>
                  <p className="mt-3 text-sm font-medium leading-6 text-white/66">
                    Client satisfaction stays at the center of every approved delivery and every payout-ready submission.
                  </p>
                </div>
              </div>

              <ol className="mt-8 grid sm:mt-10 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4 lg:gap-5" aria-label="Steps to get paid">
                {[
                  {
                    step: "01",
                    title: "Find the right gigs faster.",
                    body: "Browse verified opportunities with clear deliverables, realistic deadlines, and transparent payout expectations.",
                    tag: "Discover",
                  },
                  {
                    step: "02",
                    title: "Accept with full context.",
                    body: "Start with clean briefs, organized assets, and a workflow that makes expectations obvious from day one.",
                    tag: "Brief",
                  },
                  {
                    step: "03",
                    title: "Submit your reel for review.",
                    body: "Upload deliverables, respond to feedback quickly, and keep progress visible without losing momentum.",
                    tag: "Create",
                  },
                  {
                    step: "04",
                    title: "Track approval and cash out.",
                    body: "See payout status clearly, know what is pending, and withdraw earnings without second-guessing the process.",
                    tag: "Get paid",
                  },
                ].map((item, index, steps) => {
                  const isLast = index === steps.length - 1;
                  return (
                    <li key={item.step} data-page-stagger className={`rx-step rx-step-${index} grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-3.5 min-[430px]:gap-x-4 sm:flex sm:flex-col sm:gap-3`}>
                      <div className="flex flex-col items-center sm:flex-row">
                        <span
                          className={`rx-step-node grid h-11 w-11 shrink-0 place-items-center rounded-full border text-sm font-black tracking-[-0.02em] ${
                            isLast
                              ? "border-[#b4f28a]/60 bg-[#8fe05f] text-[#0b1914] shadow-[0_0_0_6px_rgba(143,224,95,0.12),0_12px_26px_rgba(143,224,95,0.3)]"
                              : "border-[#95ea63]/30 bg-[#10352d] text-[#aef07f] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                          }`}
                        >
                          {item.step}
                        </span>
                        <span
                          aria-hidden
                          className={`mt-2 w-px flex-1 bg-gradient-to-b from-[#8fe05f]/55 to-white/5 sm:hidden lg:ml-3 lg:mt-0 lg:block lg:h-px lg:w-auto lg:bg-gradient-to-r lg:from-[#8fe05f]/45 lg:to-white/5 ${isLast ? "invisible" : ""}`}
                        />
                      </div>
                      <article
                        className={`earn-step-card group flex min-w-0 flex-1 flex-col rounded-[1.3rem] border border-white/8 bg-white/[0.035] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition duration-300 min-[430px]:p-5 sm:rounded-[1.5rem] ${isLast ? "" : "mb-4 sm:mb-0"}`}
                      >
                        <span className="rx-step-tag w-fit rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[0.66rem] font-bold uppercase tracking-[0.18em] text-white/60">
                          {item.tag}
                        </span>
                        <h3 className="mt-3 text-balance text-[clamp(1.2rem,4.6vw,1.45rem)] font-bold leading-[1.15] tracking-[-0.035em] text-white lg:min-h-[3.4rem] lg:text-[1.3rem] xl:text-[1.42rem]">
                          {item.title}
                        </h3>
                        <p className="mt-2.5 text-pretty text-[0.94rem] leading-[1.65] text-white/64 sm:text-[0.96rem]">{item.body}</p>
                      </article>
                    </li>
                  );
                })}
              </ol>

              <div data-page-stagger className="mt-8 rounded-[1.4rem] border border-white/8 bg-white/[0.03] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:mt-10 md:rounded-full">
                <div className="flex flex-col gap-3 px-2 pb-1 pt-2 md:flex-row md:items-center md:justify-between md:gap-6 md:py-0 md:pl-5 md:pr-0">
                  <div className="flex items-center gap-3 text-[0.95rem] font-medium leading-6 text-white/76 sm:text-base">
                    <span className="earn-live-dot hidden shrink-0 min-[380px]:block" aria-hidden />
                    Ready to turn accepted gigs into paid work with less friction?
                  </div>
                  <Link
                    href={primaryHref}
                    className="resources-cta-button group inline-flex h-13 w-full shrink-0 items-center justify-center gap-2 rounded-[1.1rem] bg-[#8fe05f] px-7 text-base font-extrabold text-[#0b1914] transition hover:bg-[#9ae86a] md:h-14 md:w-auto md:rounded-full"
                  >
                    Explore Reelencer
                    <span className="transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5">↗</span>
                  </Link>
                </div>
              </div>
            </div>
          </section>

          <section data-page-motion="section" aria-labelledby="compare-heading" className="rx-ambient rx-ambient--right mx-auto w-full max-w-7xl px-3 pb-16 min-[430px]:px-4 sm:px-6 sm:pb-20 lg:px-8 lg:pb-24">
            <div data-page-stagger className="max-w-3xl">
              <div className="earn-kicker rx-kicker-violet text-xs font-bold uppercase tracking-[0.28em] text-[#95ea63] sm:text-sm">The difference</div>
              <h2 id="compare-heading" className="mt-4 text-balance text-[clamp(1.8rem,6vw,3.2rem)] font-black leading-[1.05] tracking-[-0.045em] text-white">
                Why creators switch to Reelencer.
              </h2>
            </div>

            <div data-page-stagger className="mt-8 hidden overflow-hidden rounded-[2rem] border border-white/8 bg-white/[0.025] lg:block">
              <table className="w-full table-fixed border-collapse text-left">
                <caption className="sr-only">Reelencer compared with freelance marketplaces and brand DMs</caption>
                <thead>
                  <tr>
                    <th scope="col" className="w-[22%] px-6 py-5 text-xs font-bold uppercase tracking-[0.2em] text-white/40" />
                    {comparisonColumns.map((column, index) => (
                      <th
                        key={column}
                        scope="col"
                        className={`px-6 py-5 text-base font-bold ${index === 0 ? "bg-[#8fe05f]/10 text-[#aef07f]" : "text-white/60"}`}
                      >
                        {index === 0 ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="grid h-6 w-6 place-items-center rounded-full bg-[#8fe05f] text-[0.7rem] font-black text-[#0b1914]">R</span>
                            {column}
                          </span>
                        ) : (
                          column
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {comparisonRows.map((row) => (
                    <tr key={row.label} className="border-t border-white/6">
                      <th scope="row" className="px-6 py-5 text-sm font-semibold text-white/72">{row.label}</th>
                      {row.values.map((value, index) => (
                        <td key={value} className={`px-6 py-5 text-[0.95rem] ${index === 0 ? "bg-[#8fe05f]/10 font-semibold text-white" : "text-white/50"}`}>
                          <span className="flex items-start gap-2.5">
                            <CompareMark positive={index === 0} />
                            {value}
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="mt-7 grid gap-3 sm:grid-cols-2 sm:gap-4 lg:hidden">
              {comparisonRows.map((row) => (
                <li key={row.label} data-page-stagger className="rounded-[1.35rem] border border-white/8 bg-white/[0.03] p-4 min-[380px]:p-5 sm:last:odd:col-span-2">
                  <div className="text-[0.68rem] font-bold uppercase tracking-[0.2em] text-white/45">{row.label}</div>
                  <div className="mt-3 flex items-start gap-2.5 rounded-xl bg-[#8fe05f]/10 px-3 py-2.5 text-[0.95rem] font-semibold text-white">
                    <CompareMark positive />
                    <span>
                      <span className="sr-only">Reelencer: </span>
                      {row.values[0]}
                    </span>
                  </div>
                  <div className="mt-2 grid gap-1.5 px-3 text-sm text-white/48">
                    {row.values.slice(1).map((value, index) => (
                      <div key={value} className="flex items-start gap-2.5">
                        <CompareMark positive={false} />
                        <span>
                          <span className="text-white/35">{comparisonColumns[index + 1]}: </span>
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section data-page-motion="cards" aria-labelledby="paths-heading" className="rx-ambient rx-ambient--paths mx-auto w-full max-w-7xl px-3 pb-16 min-[430px]:px-4 sm:px-6 sm:pb-20 lg:px-8 lg:pb-24">
            <div data-page-stagger className="mx-auto max-w-3xl text-center">
              <div className="earn-kicker rx-kicker-sky justify-center text-xs font-bold uppercase tracking-[0.28em] text-[#95ea63] sm:text-sm">Choose your path</div>
              <h2 id="paths-heading" className="mt-4 text-balance text-[clamp(1.8rem,6vw,3.2rem)] font-black leading-[1.05] tracking-[-0.045em] text-white">
                One platform, two ways in.
              </h2>
            </div>
            <div className="mt-8 grid gap-4 sm:mt-10 md:grid-cols-2 lg:gap-6">
              <div data-page-stagger className="@container relative isolate flex flex-col overflow-hidden rounded-[1.6rem] border border-[#8fe05f]/35 bg-[linear-gradient(160deg,rgba(143,224,95,0.16),rgba(143,224,95,0.03)_55%,rgba(255,255,255,0.02))] p-5 shadow-[0_24px_60px_rgba(0,0,0,0.22)] sm:p-7 lg:rounded-[2rem] lg:p-9">
                <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 -z-10 h-56 w-56 rounded-full bg-[#8fe05f]/18 blur-3xl" />
                <div className="flex items-center justify-between gap-3">
                  <span className="rounded-full bg-[#8fe05f] px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-[#0b1914]">For creators</span>
                </div>
                <h3 className="mt-5 text-balance text-[clamp(1.45rem,5vw,2rem)] font-bold leading-[1.12] tracking-[-0.04em] text-white md:text-[1.6rem] lg:text-[2rem]">Turn your reels into a steady side income.</h3>
                <ul className="mt-5 grid gap-3">
                  {["Browse open brand gigs with payouts listed", "Submit reels and follow every review", "Track pending, approved, and paid earnings"].map((point) => (
                    <PathPoint key={point} text={point} />
                  ))}
                </ul>
                <div className="mt-7 flex flex-col gap-3 pt-1 @sm:flex-row lg:mt-auto lg:pt-8">
                  <Link
                    href={signupHref}
                    className="resources-cta-button group inline-flex min-h-13 whitespace-nowrap @sm:flex-1 items-center justify-center gap-2 rounded-[1rem] bg-[#8fe05f] px-6 text-base font-extrabold text-[#0b1914] transition hover:bg-[#9ae86a]"
                  >
                    {role ? "Open workspace" : "Join as a creator"}
                    <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
                  </Link>
                  <Link
                    href={browseHref}
                    className="inline-flex min-h-13 whitespace-nowrap @sm:flex-1 items-center justify-center rounded-[1rem] border border-white/14 px-6 text-base font-bold text-white transition hover:bg-white/[0.06]"
                  >
                    Browse gigs
                  </Link>
                </div>
              </div>

              <div data-page-stagger className="rx-tone-violet relative isolate flex flex-col overflow-hidden rounded-[1.6rem] border border-white/10 bg-white/[0.035] p-5 shadow-[0_24px_60px_rgba(0,0,0,0.18)] sm:p-7 lg:rounded-[2rem] lg:p-9">
                <div className="flex items-center justify-between gap-3">
                  <span className="rounded-full border border-white/14 bg-white/[0.06] px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-white/85">For teams</span>
                  <span className="text-xs font-semibold text-white/50">Admins &amp; reviewers</span>
                </div>
                <h3 className="mt-5 text-balance text-[clamp(1.45rem,5vw,2rem)] font-bold leading-[1.12] tracking-[-0.04em] text-white md:text-[1.6rem] lg:text-[2rem]">Run creator operations without the spreadsheet chaos.</h3>
                <ul className="mt-5 grid gap-3">
                  {["Post, schedule, and assign work", "Review submissions and approve in one queue", "Batch and approve payouts with full visibility"].map((point) => (
                    <PathPoint key={point} text={point} />
                  ))}
                </ul>
                <div className="mt-7 pt-1 lg:mt-auto lg:pt-8">
                  <Link
                    href={accountHref}
                    className="group inline-flex h-13 w-full items-center justify-center gap-2 rounded-[1rem] border border-white/16 bg-white/[0.06] px-6 text-base font-bold text-white transition hover:border-white/30 hover:bg-white/[0.1]"
                  >
                    {role ? "Open dashboard" : "Sign in to your workspace"}
                    <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
                  </Link>
                </div>
              </div>
            </div>
          </section>

          <section
            id="resources"
            data-page-motion="section"
            data-reveal-settle={revealedSectionId === "resources" ? "true" : undefined}
            className="rx-ambient rx-ambient--band mx-auto grid w-full max-w-7xl gap-8 px-3 pb-16 pt-14 min-[430px]:px-4 sm:pt-16 lg:pt-20 sm:px-6 sm:pb-20 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-14 lg:px-8 lg:pb-24"
          >
            <div data-page-stagger className="lg:pt-2">
              <div className="earn-kicker rx-kicker-violet text-xs font-bold uppercase tracking-[0.28em] text-[#95ea63] sm:text-sm">Help Center</div>
              <h2 className="mt-4 text-balance text-[clamp(1.8rem,6vw,3rem)] font-black leading-[1.05] tracking-[-0.045em] text-white">Questions, answered.</h2>
              <p className="mt-4 max-w-md text-pretty text-[0.98rem] leading-[1.7] text-white/62">
                Everything you need to know before your first gig. Still unsure? Sign in and explore your workspace.
              </p>
              <Link href={loginHref} className="mt-2 inline-flex min-h-11 items-center gap-2 py-2.5 text-sm font-bold text-[#aef07f] transition hover:text-white">
                Sign in to your account
                <span aria-hidden>→</span>
              </Link>
            </div>
            <div className="grid gap-3">
              {faqItems.map((item, index) => (
                <details
                  key={item.q}
                  data-page-stagger
                  open={index === 0}
                  className="rx-faq group rounded-[1.3rem] border border-white/8 bg-white/[0.03] transition-colors open:border-[#8fe05f]/30 open:bg-white/[0.05] sm:rounded-[1.5rem]"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 text-left text-[1rem] font-semibold text-white min-[380px]:px-5 sm:px-6 sm:py-5 sm:text-[1.06rem] [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <span
                      aria-hidden
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/12 text-lg leading-none text-white/70 transition-transform duration-300 group-open:rotate-45 group-open:border-[#8fe05f]/50 group-open:text-[#aef07f]"
                    >
                      +
                    </span>
                  </summary>
                  <p className="px-4 pb-5 text-pretty text-[0.95rem] leading-[1.7] text-white/64 min-[380px]:px-5 sm:px-6">{item.a}</p>
                </details>
              ))}
            </div>
          </section>

          <section data-page-motion="cta" className="resources-cta-section mx-auto w-full max-w-7xl px-3 pb-16 sm:px-6 sm:pb-20 lg:px-8">
            <div data-page-stagger className="resources-cta-card rx-invert-light overflow-hidden rounded-[1.6rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.075),rgba(255,255,255,0.028))] px-5 py-10 text-center shadow-[0_20px_50px_rgba(0,0,0,0.2)] sm:rounded-[2rem] sm:px-10 sm:py-14 lg:rounded-[2.4rem] lg:py-20">
              <div className="resources-cta-kicker justify-center text-xs font-black uppercase tracking-[0.24em] text-[#95ea63] sm:text-sm">Get started</div>
              <h2 className="mx-auto mt-4 max-w-3xl text-balance text-[clamp(1.9rem,6.4vw,3.6rem)] font-black leading-[1.04] tracking-[-0.045em] text-white">
                Your next reel could be your <span className="earn-gradient-text">next payout.</span>
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-pretty text-[0.98rem] leading-7 text-white/68 sm:text-lg sm:leading-8">
                Join Reelencer, pick a gig that fits your style, and start earning from the reels you already love making.
              </p>
              <div className="mx-auto mt-8 flex max-w-lg flex-col gap-3 min-[430px]:flex-row min-[430px]:justify-center">
                <Link
                  href={primaryHref}
                  className="resources-cta-button group inline-flex min-h-14 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-[1.1rem] bg-[#8fe05f] px-6 text-base font-extrabold text-[#0b1914] shadow-[0_18px_36px_rgba(143,224,95,0.22)] transition hover:bg-[#9ae86a]"
                >
                  {primaryLabel}
                  <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
                </Link>
                <Link
                  href={browseHref}
                  className="inline-flex min-h-14 flex-1 items-center justify-center rounded-[1.1rem] border border-white/16 bg-white/[0.05] px-6 text-base font-bold text-white transition hover:bg-white/[0.1]"
                >
                  Browse live gigs
                </Link>
              </div>
              <ul className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-medium text-white/55 sm:text-sm">
                {["Sign up with any email", "Clear briefs and payouts", "Tracked from review to bank"].map((item) => (
                  <li key={item} className="inline-flex items-center gap-1.5">
                    <CompareMark positive />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </main>

        <footer className="relative z-20 border-t border-white/8 bg-[#031713]">
          <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 pb-10 pt-12 sm:px-6 lg:grid-cols-[1.25fr_2fr] lg:gap-16 lg:px-8 lg:pb-14 lg:pt-16">
            <div className="max-w-md">
              <BrandMark compact />
              <p className="mt-4 text-sm leading-6 text-white/64">Brand gigs, clear reviews, and tracked payouts for short-form creators.</p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Link
                  href={primaryHref}
                  className="group inline-flex h-10 items-center gap-1.5 rounded-full bg-[#8fe05f] px-4 text-sm font-extrabold text-[#0b1914] transition hover:bg-[#9ae86a]"
                >
                  {primaryLabel}
                  <span className="transition-transform duration-300 group-hover:translate-x-0.5" aria-hidden>
                    →
                  </span>
                </Link>
                <a
                  href="mailto:support@reelencer.com"
                  className="inline-flex h-10 items-center gap-2 rounded-full border border-white/12 px-4 text-sm font-semibold text-white/80 transition hover:border-white/30 hover:text-white"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <rect x="3" y="5" width="18" height="14" rx="2.5" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4 7 8 6 8-6" />
                  </svg>
                  Contact support
                </a>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-8 min-[430px]:grid-cols-3">
              <nav aria-label="Explore">
                <div className="text-xs font-bold uppercase tracking-[0.2em] text-white/40">Explore</div>
                <ul className="mt-4 grid gap-2.5">
                  {navItems.slice(1).map((item) => (
                    <li key={item.label}>
                      <a
                        href={item.href}
                        onClick={(event) => {
                          event.preventDefault();
                          animateToSection(item.href, item.label);
                        }}
                        className="rx-footer-link text-sm font-medium text-white/72 transition hover:text-[#aef07f]"
                      >
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
              {[
                {
                  title: "Creators",
                  links: [
                    ["Browse gigs", browseHref],
                    ["My jobs", CREATOR_HOME_HREF],
                    ["Payouts", "/payouts"],
                  ],
                },
                {
                  title: "Account",
                  links: [
                    ["Sign in", loginHref],
                    ["Create account", signupHref],
                    ["Reset password", "/reset-password"],
                  ],
                },
              ].map((column) => (
                <nav key={column.title} aria-label={column.title}>
                  <div className="text-xs font-bold uppercase tracking-[0.2em] text-white/40">{column.title}</div>
                  <ul className="mt-4 grid gap-2.5">
                    {column.links.map(([label, href]) => (
                      <li key={label}>
                        <Link href={href} className="rx-footer-link text-sm font-medium text-white/72 transition hover:text-[#aef07f]">
                          {label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              ))}
            </div>
          </div>
          <div className="border-t border-white/6">
            <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-5 text-xs text-white/40 sm:px-6 lg:px-8">
              <span>© {new Date().getFullYear()} Reelencer. Built for creators.</span>
              <button
                type="button"
                onClick={() => animateToSection("#top", "Home")}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 font-semibold text-white/72 transition hover:border-white/25 hover:text-white"
              >
                Back to top
                <span aria-hidden>↑</span>
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

function LeadValidationPrompt({ message, compact = false }: { message: string; compact?: boolean }) {
  return (
    <div
      className={`lead-validation-prompt mt-3 flex items-center gap-2 rounded-[1rem] border border-[#ffe37a]/28 bg-[#183a2d]/88 px-3 py-2.5 text-[#fff3b0] shadow-[0_12px_26px_rgba(0,0,0,0.18)] ${
        compact ? "text-[0.82rem] leading-5" : "text-[0.9rem] leading-6"
      }`}
      role="alert"
      aria-live="assertive"
    >
      <span className="lead-validation-prompt__icon grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#ffe37a] text-[0.82rem] font-black text-[#193025]">!</span>
      <span className="font-semibold">{message}</span>
    </div>
  );
}

function AnimatedLeadSubmitButton({
  label,
  className,
  arrowClassName,
  canPlaySubmitAnimation = true,
  invalidActive = false,
}: {
  label: string;
  className: string;
  arrowClassName: string;
  canPlaySubmitAnimation?: boolean;
  invalidActive?: boolean;
}) {
  const [isAnimating, setIsAnimating] = useState(false);
  const animationFrameRef = useRef<number | null>(null);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const replayClickAnimation = () => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
    }
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }

    setIsAnimating(false);
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      setIsAnimating(true);
      resetTimerRef.current = window.setTimeout(() => {
        resetTimerRef.current = null;
        setIsAnimating(false);
      }, 920);
    });
  };

  return (
    <button
      type="submit"
      onClick={() => {
        if (canPlaySubmitAnimation) {
          replayClickAnimation();
        }
      }}
      className={`lead-submit-button flex min-w-0 items-center justify-center bg-[#8fe05f] text-center font-extrabold tracking-normal text-[#0b1914] transition hover:bg-[#9ae86a] ${isAnimating ? "is-activated" : ""} ${invalidActive ? "is-invalid" : ""} ${className}`}
    >
      <span className="lead-submit-button__sweep" aria-hidden="true" />
      <span className="lead-submit-button__pulse" aria-hidden="true" />
      <span className="lead-submit-button__spark lead-submit-button__spark--one" aria-hidden="true" />
      <span className="lead-submit-button__spark lead-submit-button__spark--two" aria-hidden="true" />
      <span className="lead-submit-button__spark lead-submit-button__spark--three" aria-hidden="true" />
      <span className="lead-submit-button__label min-w-0 text-balance leading-tight">{label}</span>
      <span className={`lead-submit-button__arrow grid shrink-0 place-items-center rounded-full leading-none ${arrowClassName}`} aria-hidden="true">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="h-[1.1rem] w-[1.1rem]">
          <path d="M5.5 14.5 14.5 5.5M7.5 5.5h7v7" />
        </svg>
      </span>
    </button>
  );
}

function CompareMark({ positive }: { positive: boolean }) {
  return positive ? (
    <span className="mt-0.5 grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full bg-[#8fe05f] text-[#0b1914]" aria-hidden>
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3.2">
        <path strokeLinecap="round" strokeLinejoin="round" d="m5 12.5 4.5 4.5L19 7.5" />
      </svg>
    </span>
  ) : (
    <span className="mt-0.5 grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full bg-white/8 text-white/40" aria-hidden>
      <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3.2">
        <path strokeLinecap="round" d="M7 7l10 10M17 7 7 17" />
      </svg>
    </span>
  );
}

function PathPoint({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-3 text-[0.96rem] leading-snug text-white/78">
      <CompareMark positive />
      <span>{text}</span>
    </li>
  );
}

function WhyCardVisual({ kind, className = "" }: { kind: "gigs" | "review" | "payout"; className?: string }) {
  return (
    <div aria-hidden className={`rx-why-visual relative h-44 shrink-0 overflow-hidden border-b border-white/6 px-5 pt-5 sm:h-48 ${className}`}>
      {kind === "gigs" && (
        <div className="grid gap-2.5">
          {[
            ["Skincare UGC reel", "30s · 1 reel", "₹1,200"],
            ["Cafe launch teaser", "15s · 2 reels", "₹1,800"],
            ["App walkthrough", "45s · 1 reel", "₹950"],
          ].map(([title, meta, pay], index) => (
            <div
              key={title}
              className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 transition duration-500 ${
                index === 0 ? "border-[#8fe05f]/40 bg-[#fff] text-slate-900 shadow-[0_10px_24px_rgba(0,0,0,0.25)] group-hover:-translate-y-0.5" : "border-white/8 bg-white/[0.05] text-white"
              }`}
            >
              <div className="min-w-0">
                <div className="truncate text-[0.82rem] font-bold">{title}</div>
                <div className={`text-[0.7rem] ${index === 0 ? "text-slate-500" : "text-white/45"}`}>{meta}</div>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[0.72rem] font-black ${index === 0 ? "bg-[#8fe05f] text-[#0b1914]" : "bg-white/8 text-white/70"}`}>{pay}</span>
            </div>
          ))}
        </div>
      )}
      {kind === "review" && (
        <div className="mx-auto grid max-w-[17rem] gap-2">
          {[
            ["Reel uploaded", "done"],
            ["Brand guidelines check", "done"],
            ["Reviewer sign-off", "active"],
            ["Ready for payout", "next"],
          ].map(([label, state]) => (
            <div key={label} className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.04] px-3 py-2">
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${
                  state === "done" ? "bg-[#8fe05f] text-[#0b1914]" : state === "active" ? "earn-live-ring border-2 border-[#b2a6ff]" : "border-2 border-white/20"
                }`}
              >
                {state === "done" && (
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3.2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m5 12.5 4.5 4.5L19 7.5" />
                  </svg>
                )}
              </span>
              <span className={`text-[0.8rem] font-semibold ${state === "next" ? "text-white/45" : "text-white"}`}>{label}</span>
              {state === "active" && <span className="ml-auto rounded-full bg-[#b2a6ff]/15 px-2 py-0.5 text-[0.65rem] font-bold text-[#c9c1ff]">In review</span>}
            </div>
          ))}
        </div>
      )}
      {kind === "payout" && (
        <div className="flex h-full flex-col">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-white/45">This month</div>
              <div className="mt-1 text-[1.7rem] font-black leading-none tracking-[-0.05em] text-white">₹24,800</div>
            </div>
            <span className="rounded-full bg-[#8fe05f]/15 px-2.5 py-1 text-[0.7rem] font-bold text-[#aef07f]">3 paid · 2 pending</span>
          </div>
          <div className="mt-auto flex h-24 items-end gap-2 pb-0">
            {[34, 48, 40, 62, 55, 78, 92].map((height, index) => (
              <span
                key={index}
                className={`rx-bar flex-1 rounded-t-md ${index === 6 ? "bg-[#8fe05f]" : "bg-white/12"}`}
                style={{ height: `${height}%`, animationDelay: `${index * 70}ms` }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Profile photo when the account has one (e.g. Google sign-in), otherwise initials on the brand green. */
function AccountAvatar({ src, initials, className = "" }: { src: string | null; initials: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`shrink-0 rounded-full object-cover ring-2 ring-[#8fe05f]/60 ${className}`}
      />
    );
  }
  return (
    <span className={`grid shrink-0 place-items-center rounded-full bg-[#8fe05f] font-black tracking-tight text-[#0b211b] ${className}`}>
      {initials}
    </span>
  );
}

const MENU_ICONS = {
  grid: "M3.5 3.5h5v5h-5zM11.5 3.5h5v5h-5zM3.5 11.5h5v5h-5zM11.5 11.5h5v5h-5z",
  search: "M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM17 17l-3.8-3.8",
  wallet: "M3.5 6h13v9.5h-13zM3.5 6l9-2.5V6M13 10.5h1.5",
  logout: "M8 4.5H4.5v11H8M12 6.5 15.5 10 12 13.5M15.5 10H8",
} as const;

const MENU_TONES: Record<keyof typeof MENU_ICONS, string> = {
  grid: "bg-[#8fe05f]/15 text-[#8fe05f]",
  search: "bg-[#38bdf8]/15 text-[#38bdf8]",
  wallet: "bg-[#b2a6ff]/18 text-[#b2a6ff]",
  logout: "",
};

/**
 * Header account chip: avatar with status dot, first name + role (xl), chevron. Opens a menu with the full
 * identity, described quick links and sign-out. Closes on outside click / Escape; focus moves into the menu.
 */
function AccountMenu({
  name,
  firstName,
  email,
  roleLabel,
  avatar,
  largeAvatar,
  links,
  onSignOut,
}: {
  name: string;
  firstName: string;
  email: string | null;
  roleLabel: string;
  avatar: React.ReactNode;
  largeAvatar: React.ReactNode;
  links: { href: string; label: string; hint: string; icon: keyof typeof MENU_ICONS }[];
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLAnchorElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    firstItemRef.current?.focus({ preventScroll: true });
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative hidden sm:block">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={name}
        className={`group inline-flex h-11 items-center gap-2 rounded-full border pl-1 pr-1 text-left text-white transition md:pr-2.5 lg:pr-1 xl:pr-2.5 ${
          open ? "border-[#8fe05f]/50 bg-white/[0.08]" : "border-white/12 bg-white/[0.04] hover:border-white/25 hover:bg-white/[0.08]"
        }`}
      >
        <span className="relative shrink-0 rounded-full bg-[linear-gradient(135deg,#b6f28f,#4fbf6a)] p-[2px]">
          {avatar}
          <span aria-hidden className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-[#22c55e] ring-2 ring-[var(--rx-chip-ring,#0b2a23)]" />
        </span>
        <span className="hidden min-w-0 leading-tight md:block lg:hidden xl:block">
          <span className="block max-w-[7rem] truncate text-[0.88rem] font-bold xl:max-w-[8.5rem]">{firstName}</span>
          <span className="hidden text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-white/50 xl:block">{roleLabel}</span>
        </span>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className={`hidden h-3.5 w-3.5 shrink-0 text-white/55 transition-transform md:block lg:hidden xl:block ${open ? "rotate-180" : ""}`} aria-hidden>
          <path d="m5.5 8 4.5 4.5L14.5 8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="rx-popover absolute right-0 top-[calc(100%+0.6rem)] z-[70] w-[min(19rem,calc(100vw-2rem))] origin-top-right overflow-hidden rounded-[1.4rem] border border-white/12 p-2"
        >
          {/* Identity */}
          <div className="rx-popover-head relative overflow-hidden rounded-[1.05rem] p-3.5">
            <div className="flex items-center gap-3">
              <span className="shrink-0 rounded-full bg-[linear-gradient(135deg,#b6f28f,#4fbf6a)] p-[2px] shadow-[0_6px_18px_-6px_rgba(79,191,106,0.6)]">{largeAvatar}</span>
              <div className="min-w-0">
                <div className="truncate text-[0.98rem] font-extrabold tracking-[-0.01em] text-white">{name}</div>
                {email && <div className="truncate text-[0.78rem] text-white/60">{email}</div>}
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#8fe05f]/18 px-2.5 py-1 text-[0.66rem] font-bold uppercase tracking-[0.12em] text-[#8fe05f]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#22c55e]" />
                {roleLabel}
              </span>
              <span className="text-[0.7rem] font-semibold text-white/45">Signed in</span>
            </div>
          </div>

          {/* Links */}
          <div className="mt-2 grid gap-1">
            {links.map((link, index) => (
              <Link
                key={link.href + link.label}
                ref={index === 0 ? firstItemRef : undefined}
                href={link.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="group/item flex min-h-[3.25rem] items-center gap-3 rounded-[0.95rem] px-2.5 py-2 transition hover:bg-white/[0.06] focus-visible:bg-white/[0.06] focus-visible:outline-none"
              >
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[0.7rem] transition-transform group-hover/item:scale-105 ${MENU_TONES[link.icon]}`}>
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[1.1rem] w-[1.1rem]" aria-hidden>
                    <path d={MENU_ICONS[link.icon]} />
                  </svg>
                </span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-[0.9rem] font-bold text-white">{link.label}</span>
                  <span className="mt-0.5 block truncate text-[0.74rem] text-white/50">{link.hint}</span>
                </span>
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 shrink-0 -translate-x-1 text-white/35 opacity-0 transition group-hover/item:translate-x-0 group-hover/item:opacity-100 group-focus-visible/item:opacity-100" aria-hidden>
                  <path d="m8 5 5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            ))}
          </div>

          {/* Sign out */}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
            className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-[0.95rem] border border-[#ff6b6b]/25 bg-[#ff6b6b]/[0.07] px-3 text-[0.88rem] font-bold text-[#ff9f9f] transition hover:border-[#ff6b6b]/45 hover:bg-[#ff6b6b]/[0.13] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6b6b]/40"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-[1.05rem] w-[1.05rem]" aria-hidden>
              <path d={MENU_ICONS.logout} />
            </svg>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

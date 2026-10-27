"use client";
import { isValidViewPayoutRate } from "@/lib/socialAnalytics";
import { apiFetch as fetch } from "@/lib/api/client";

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import AdminSectionLoading from "@/app/_components/AdminSectionLoading";
import loadingStyles from "@/app/_components/adminLoading.module.css";
import { useAdminLive, type AdminLiveKind } from "@/lib/useAdminLive";
import { createAdminReadQueue } from "@/lib/adminReadQueue";
import { adminSectionHref, type GigAdminView } from "@/lib/adminNavigation";
import LinkedAccountsPanel from "./LinkedAccountsPanel";
import KycReviewPanel, { type KycRow } from "./KycReviewPanel";
import CredentialSubmissionsPanel, { type Assignment } from "./CredentialSubmissionsPanel";
import ApplicationDetail from "./ApplicationDetail";
import {
  Banner,
  BulkBar,
  type BulkProgress,
  EmptyState,
  ICONS,
  Icon,
  SelectAllCheckbox,
  StatusChip,
  btnGhost,
  bulkBtn,
  fieldClass,
  formatDateTime,
  formatRelative,
  runPool,
} from "./adminUi";
import { AutomationDrawer, MessageDrawer, SmartSelectMenu, useApplicationAutomation } from "./ApplicationBulkTools";
import { getMyRole } from "@/lib/role";
import { supabase } from "@/lib/supabaseClient";
import { MAX_ASSET_NOTE, splitBriefMediaLines, withAssetNote, withReelExample } from "@/lib/gigBriefMedia";
import { isReelKitCompany, parseCompanyReelKit, reelKitRequirementsForCompany, withReelKit } from "@/lib/reelKit";
import ReelKitEditor from "./ReelKitEditor";
import {
  type GigApplicationMode,
  parseGigRequirementMeta,
  readGigApplicationMode,
  resolveGigApplicationMode,
} from "@/lib/gigApplicationMode";
import { GigSampleVideosField } from "./GigSampleVideosField";
import { Field, FormSection, Segmented, SwitchRow, inputCls, textareaCls } from "./gigFormUi";
import { accountPlatformFor, encodeAccountInstructions, parseAccountInstructions, type AccountSetupView } from "@/lib/accountSetup";
import { MAX_GIG_SAMPLES, encodeGigSample, isSampleLine, parseGigSamples, type GigSample } from "@/lib/gigSamples";

type Platform = "Instagram" | "X" | "YouTube" | "LinkedIn" | "TikTok";
type PayoutType = "Per task" | "Per post" | "Monthly" | "Per 1k Views";
type GigStatus = "Open" | "Paused" | "Closed";
type GigType = string;
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
  gigType?: GigType;
  requirements: string[];
  applicationMode?: GigApplicationMode;
  status: GigStatus;
  postedAt: string;
  browsePinned?: boolean;
  browsePinRank?: number | null;
  browsePinLabel?: string;
};

type GigApplication = {
  id: string;
  gigId: string;
  workerId: string;
  workerName?: string;
  proposal?: {
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
    /** Content Posting gigs: the creator's new account (redacted; reveal the password through the API). */
    accountSetup?: AccountSetupView;
  };
  status: ApplicationStatus;
  appliedAt: string;
  decidedAt?: string;
};

type Role = "Admin" | "Worker";
type AuthSession = { role: Role; workerId?: string; email?: string; at: string };

const LS_KEYS = {
  AUTH: "igops:auth",
  GIGS: "igops:gigs",
  GIG_APPS: "igops:gig-apps",
  GIG_ASSIGNMENTS: "igops:gig-assignments",
  GIG_KYC_ROWS: "igops:gig-kyc-rows",
  GIG_KYC_SYNC_AT: "igops:gig-kyc-sync-at",
  PROPOSAL_REVIEW_DRAFT: "igops:proposal-review-draft",
} as const;

const PLATFORMS: Platform[] = ["Instagram", "X", "YouTube", "LinkedIn", "TikTok"];
const PAYOUTS: PayoutType[] = ["Per task", "Per post", "Monthly", "Per 1k Views"];
const STATUSES: GigStatus[] = ["Open", "Paused", "Closed"];
// Leave room for the shared sidebar before showing queue and detail side by side.
const DESKTOP_QUERY = "(min-width: 1280px)";
const subscribeDesktop = (callback: () => void) => {
  const mq = window.matchMedia(DESKTOP_QUERY);
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
};
const readDesktop = () => window.matchMedia(DESKTOP_QUERY).matches;
// Compact "Label · value ▾" controls for listing cards: content-width in a row, full-width cells on phones.
const pillClass =
  "relative flex h-9 min-w-0 items-center gap-1.5 overflow-hidden rounded-[10px] border border-[#d9ddd8] bg-white pl-2.5 text-[12.5px] transition focus-within:border-[#7fa58c] focus-within:ring-2 focus-within:ring-[#2e7d4f]/20 hover:border-[#c9cec8] md:flex-auto lg:flex-none";
const pillSelectClass =
  "h-full min-w-0 flex-1 cursor-pointer appearance-none truncate bg-transparent pr-7 font-semibold text-[#1a201c] outline-none disabled:cursor-default disabled:opacity-60 lg:flex-none";
function PillChevron() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8a928c]" aria-hidden>
      <path d="m5 8 5 5 5-5" />
    </svg>
  );
}

const GIG_TYPE_HINTS: Record<string, string> = {
  "Email Creator": "Workers set up and verify accounts in the activation workspace.",
  Workspace: "Ongoing tasks handled inside the Reelencer workspace.",
  Project: "Scoped work with a brief, deliverables and review.",
  "Content Posting": "Recurring posting on managed brand accounts.",
  Custom: "Your own category label and brief.",
};
const GIG_STATUS_DOT: Record<string, string> = { Open: "bg-[#2e7d4f]", Paused: "bg-[#e29a1b]", Closed: "bg-[#8a928c]" };
/** "2026-10-04T09:43:00Z" → "4 Oct 2026"; human labels ("Posted today") pass through untouched. */
const formatPostedLabel = (value?: string) => {
  if (!value) return "";
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};
const payoutAmount = (payout: string) => Number(String(payout ?? "").replace(/,/g, "").match(/\d+(\.\d+)?/)?.[0] ?? 0);
const GIG_TYPES: GigType[] = ["Email Creator", "Workspace", "Project", "Content Posting", "Custom"];
type BulkReviewDraft = {
  adminNote: string;
  adminExplanation: string;
  whatsappLink: string;
  onboardingSteps: string;
};

const DEFAULT_BULK_REVIEW_DRAFT: BulkReviewDraft = {
  adminNote: "Review the onboarding instructions below and join the recruiter coordination channel to continue.",
  adminExplanation:
    "Complete the onboarding checklist, and wait for the next execution update inside their project feed.",
  whatsappLink: "",
  onboardingSteps:
    "1. Open the recruiter group link.\n2. Join the group using your active WhatsApp account.\n3. Send a short intro message with your worker ID and timezone.\n4. Read the onboarding checklist carefully.\n5. Wait for the recruiter confirmation before starting execution.",
};

function normalizeGigType(raw?: string) {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!value) return "Email Creator";
  if (value === "part-time" || value === "part time") return "Email Creator";
  if (value === "full-time" || value === "full time" || value === "workspace") return "Workspace";
  if (value === "project") return "Project";
  if (value === "content posting" || value === "content-posting") return "Content Posting";
  return raw ?? "Email Creator";
}

function formatGigTypeLabel(raw?: string) {
  const value = String(raw ?? "").trim();
  if (!value) return "Email Creator";
  if (/^custom:\s*/i.test(value)) return `Cat: ${value.replace(/^custom:\s*/i, "").trim() || "Freelance"}`;
  if (/^category:\s*/i.test(value)) return `Cat: ${value.replace(/^category:\s*/i, "").trim() || "Freelance"}`;
  return value;
}

function isProjectGig(raw?: string) {
  return String(raw ?? "")
    .trim()
    .toLowerCase() === "project";
}

function isContentPostingGig(raw?: string) {
  return String(raw ?? "")
    .trim()
    .toLowerCase() === "content posting";
}

function isProjectStyleGig(raw?: string) {
  return isProjectGig(raw) || isContentPostingGig(raw);
}

function parseCustomRequirementsText(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Public sample videos, stored as `Sample::{json}` lines (see lib/gigSamples). */
function sampleLines(samples?: GigSample[]) {
  return (samples ?? []).slice(0, MAX_GIG_SAMPLES).map(encodeGigSample).filter((line): line is string => Boolean(line));
}

function buildRequirementsPayload(input: {
  gigType: string;
  requirements: string;
  customBrief: string;
  customRequirements: string;
  customMedia: string;
  /** Content Posting only: how to set up the account creators must create before screening. */
  accountInstructions?: string;
  sampleVideos?: GigSample[];
  projectBrief: string;
  hiringCapacity: string;
  expertise: string;
  languages: string;
  applicationMode: GigApplicationMode;
  onboardingRequired: boolean;
  kycRequired: boolean;
}) {
  if (input.gigType === "Custom" || input.gigType === "Project" || input.gigType === "Content Posting") {
    const out: string[] = [];
    if (input.customBrief.trim()) out.push(`Brief::${input.customBrief.trim()}`);
    out.push(`Meta::application_mode=${input.applicationMode}`);
    out.push(`Meta::onboarding_required=${input.onboardingRequired ? "true" : "false"}`);
    out.push(`Meta::kyc_required=${input.kycRequired ? "true" : "false"}`);
    parseCustomRequirementsText(input.customMedia).forEach((line) => out.push(`Media::${line}`));
    const accountLine = input.gigType === "Content Posting" ? encodeAccountInstructions(input.accountInstructions ?? "") : null;
    if (accountLine) out.push(accountLine);
    out.push(...sampleLines(input.sampleVideos));
    out.push(...parseCustomRequirementsText(input.customRequirements));
    return out;
  }
  const out: string[] = [];
  if (input.projectBrief.trim()) out.push(`Brief::${input.projectBrief.trim()}`);
  out.push(`Meta::application_mode=${input.applicationMode}`);
  out.push(`Meta::onboarding_required=${input.onboardingRequired ? "true" : "false"}`);
  out.push(`Meta::kyc_required=${input.kycRequired ? "true" : "false"}`);
  if (input.hiringCapacity.trim()) out.push(`Meta::hiring_capacity=${input.hiringCapacity.trim()}`);
  if (input.expertise.trim()) out.push(`Meta::expertise=${input.expertise.trim()}`);
  if (input.languages.trim()) out.push(`Meta::languages=${input.languages.trim()}`);
  out.push(...sampleLines(input.sampleVideos));
  out.push(
    ...input.requirements
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  return out;
}

function normalizeGigApplicationMode(gig: Pick<Gig, "requirements" | "applicationMode">) {
  return resolveGigApplicationMode(gig, "apply");
}

function readCustomFieldsFromRequirements(requirements: string[]) {
  const briefLine = requirements.find((item) => item.toLowerCase().startsWith("brief::"));
  const customBrief = briefLine ? briefLine.replace(/^brief::/i, "").trim() : "";
  const meta = parseGigRequirementMeta(requirements);
  const customMedia = requirements
    .filter((item) => item.toLowerCase().startsWith("media::"))
    .map((item) => item.replace(/^media::/i, "").trim())
    .filter(Boolean)
    .join("\n");
  const customRequirements = requirements
    .filter(
      (item) =>
        !item.toLowerCase().startsWith("brief::") &&
        !item.toLowerCase().startsWith("media::") &&
        !item.toLowerCase().startsWith("meta::") &&
        !isSampleLine(item)
    )
    .join("\n");
  return {
    customBrief,
    customRequirements,
    customMedia,
    accountInstructions: parseAccountInstructions(requirements),
    applicationMode: readGigApplicationMode(requirements),
    kycRequired: !["false", "0", "no", "off"].includes((meta.kyc_required ?? "true").toLowerCase()),
  };
}

function readProjectFieldsFromRequirements(requirements: string[]) {
  const briefLine = requirements.find((item) => item.toLowerCase().startsWith("brief::"));
  const projectBrief = briefLine ? briefLine.replace(/^brief::/i, "").trim() : "";
  const meta = parseGigRequirementMeta(requirements);
  const requirementsText = requirements
    .filter(
      (item) =>
        !item.toLowerCase().startsWith("brief::") &&
        !item.toLowerCase().startsWith("meta::") &&
        !item.toLowerCase().startsWith("media::") &&
        !isSampleLine(item)
    )
    .join(", ");
  return {
    projectBrief,
    hiringCapacity: meta.hiring_capacity ?? "",
    expertise: meta.expertise ?? "",
    languages: meta.languages ?? "",
    applicationMode: readGigApplicationMode(requirements),
    onboardingRequired: !["false", "0", "no", "off"].includes((meta.onboarding_required ?? "true").toLowerCase()),
    kycRequired: !["false", "0", "no", "off"].includes((meta.kyc_required ?? "true").toLowerCase()),
    requirementsText,
  };
}

type BrowseSpotlightConfig = {
  pinned: boolean;
  pinRank: number | null;
  pinLabel: string;
};

function readBrowseSpotlightConfig(requirements: string[]): BrowseSpotlightConfig {
  const meta = parseGigRequirementMeta(requirements);
  const rank = Number.parseInt(meta.browse_pin_rank ?? "", 10);
  return {
    pinned: ["true", "1", "yes", "on"].includes((meta.browse_pinned ?? "false").toLowerCase()),
    pinRank: Number.isFinite(rank) && rank > 0 ? rank : null,
    pinLabel: meta.browse_pin_label ?? "",
  };
}

function mergeBrowseSpotlightConfig(
  requirements: string[],
  updates: Partial<{ pinned: boolean; pinRank: number | null; pinLabel: string }>
) {
  const current = readBrowseSpotlightConfig(requirements);
  const nextPinned = updates.pinned ?? current.pinned;
  const rawRank = updates.pinRank ?? current.pinRank;
  const nextRank = typeof rawRank === "number" && Number.isFinite(rawRank) && rawRank > 0 ? Math.min(rawRank, 6) : null;
  const nextLabel = (updates.pinLabel ?? current.pinLabel).trim();
  const base = requirements.filter((item) => {
    const lower = item.toLowerCase();
    return (
      !lower.startsWith("meta::browse_pinned=") &&
      !lower.startsWith("meta::browse_pin_rank=") &&
      !lower.startsWith("meta::browse_pin_label=")
    );
  });
  if (!nextPinned) return base;
  base.push("Meta::browse_pinned=true");
  if (nextRank) base.push(`Meta::browse_pin_rank=${nextRank}`);
  if (nextLabel) base.push(`Meta::browse_pin_label=${nextLabel}`);
  return base;
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
  // Only public gig listings may persist. Admin records and review drafts stay in memory.
  if (key !== LS_KEYS.GIGS) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function nowLabel() {
  const d = new Date();
  return `Posted ${d.toLocaleDateString()}`;
}

function makeId() {
  return `GIG-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

export type { GigAdminView } from "@/lib/adminNavigation";

export default function GigAdminConsole({
  view = "create-new-gig",
  nextPath = "/addgigs/create-new-gig",
  authorized = false,
  active = true,
  onCountsChange,
  searchKey,
  adminId,
}: {
  view?: GigAdminView;
  nextPath?: string;
  authorized?: boolean;
  active?: boolean;
  onCountsChange?: (counts: Partial<Record<GigAdminView, number>>) => void;
  searchKey?: string;
  adminId?: string;
}) {
  const [sessionLoaded, setSessionLoaded] = useState(authorized);
  const [session, setSession] = useState<AuthSession | null>(() => authorized ? { role: "Admin", at: "" } : null);
  const adminReady = authorized || (sessionLoaded && session?.role === "Admin");
  const [reads] = useState(createAdminReadQueue);
  const readable = useRef(adminReady);
  const [loadedResources, setLoadedResources] = useState({ gigs: false, applications: false, assignments: false, kyc: false });
  const [loadErrors, setLoadErrors] = useState<Partial<Record<"gigs" | "applications" | "assignments", string>>>({});
  const dataLoadError = Object.values(loadErrors).filter(Boolean).join(" ");
  const appsLoading = !loadedResources.applications && !loadErrors.applications;
  const assignmentsLoading = !loadedResources.assignments && !loadErrors.assignments;
  const [gigs, setGigs] = useState<Gig[]>([]);
  const [apps, setApps] = useState<GigApplication[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [assignmentsRefreshing, setAssignmentsRefreshing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [applicationNotice, setApplicationNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [kycRows, setKycRows] = useState<KycRow[]>([]);
  const [kycLoading, setKycLoading] = useState(false);
  const [kycError, setKycError] = useState<string | null>(null);
  const [kycNotice, setKycNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [kycLastSyncAt, setKycLastSyncAt] = useState<string | null>(null);
  const [selectedGigId, setSelectedGigId] = useState<string | "All">("All");
  // Deep link from Gig listings: /addgigs/applications?gig=<id> opens that gig's applications.
  useEffect(() => {
    if (!active || view !== "applications") return;
    const gigParam = new URLSearchParams(searchKey ?? window.location.search).get("gig");
    queueMicrotask(() => setSelectedGigId(gigParam || "All"));
  }, [active, view, searchKey]);
  const [applicationStatusFilter, setApplicationStatusFilter] = useState<ApplicationStatus | "All">("All");
  const [applicationQueueQuery, setApplicationQueueQuery] = useState("");
  const [applicationQueueSort, setApplicationQueueSort] = useState<"latest" | "oldest" | "worker_asc" | "gig_asc">("latest");
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null);
  const [selectedApplicationIds, setSelectedApplicationIds] = useState<string[]>([]);
  const [appsRefreshing, setAppsRefreshing] = useState(false);
  const [appsSyncedAt, setAppsSyncedAt] = useState<string | null>(null);
  const [appDrawer, setAppDrawer] = useState<"message" | "automation" | null>(null);
  const [bulkApplicationActionId, setBulkApplicationActionId] = useState<string | null>(null);
  const [applicationBulkProgress, setApplicationBulkProgress] = useState<BulkProgress>(null);
  const [editingGig, setEditingGigState] = useState<Gig | null>(null);
  const editContext = useRef<{ id: string | null }>({ id: null });
  const kitUploadContext = useRef<object | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [mediaUploading, setMediaUploading] = useState(false);
  const [mediaUploadError, setMediaUploadError] = useState<string | null>(null);
  const setEditingGig = useCallback((gig: Gig | null) => {
    editContext.current = { id: gig?.id ?? null };
    kitUploadContext.current = null;
    setEditingGigState(gig);
    setMediaUploading(false);
    setMediaUploadError(null);
  }, []);
  /** Reference URL whose in-reel example is uploading; it shares mediaUploading so publishing waits for it. */
  const [reelExampleUploadingFor, setReelExampleUploadingFor] = useState<string | null>(null);
  const [samplesUploading, setSamplesUploading] = useState(false);
  // Success banner after publishing/updating, with links to the listings page.
  const [lastSaved, setLastSaved] = useState<{ kind: "created" | "updated"; id: string; title: string } | null>(null);
  const [spotlightCollapsed, setSpotlightCollapsed] = useState(false);
  // The sidebar only needs counts; account data loads inside its own panel.
  const [linkedSummary, setLinkedSummary] = useState<{ due: number; reelsToReview: number; accountRequests: number } | null>(null);
  const tabCounts = useMemo<Partial<Record<GigAdminView, number>>>(() => ({
    ...(linkedSummary ? { "linked-accounts": linkedSummary.due + linkedSummary.reelsToReview + linkedSummary.accountRequests } : {}),
    ...(loadedResources.gigs ? { "gig-listings": gigs.length } : {}),
    ...(loadedResources.applications ? { applications: apps.filter(app => app.status === "Applied" || app.status === "Pending").length } : {}),
    ...(loadedResources.kyc ? { "kyc-review": kycRows.filter(row => String(row.status ?? "").toLowerCase() === "pending").length } : {}),
    ...(loadedResources.assignments ? { "credential-submissions": assignments.filter(assignment => assignment.status === "Submitted").length } : {}),
  }), [apps, assignments, gigs.length, kycRows, linkedSummary, loadedResources]);
  useEffect(() => { onCountsChange?.(tabCounts); }, [onCountsChange, tabCounts]);
  const [gigQuery, setGigQuery] = useState("");
  const [gigStatusFilter, setGigStatusFilter] = useState<"All" | GigStatus>("All");
  const [gigSort, setGigSort] = useState<"recent" | "title" | "payout" | "applicants">("recent");
  const applicantsByGig = useMemo(() => {
    const counts = new Map<string, number>();
    apps.forEach((app) => counts.set(String(app.gigId), (counts.get(String(app.gigId)) ?? 0) + 1));
    return counts;
  }, [apps]);
  const gigStatusCounts = useMemo(() => {
    const counts: Record<GigStatus, number> = { Open: 0, Paused: 0, Closed: 0 };
    gigs.forEach((gig) => {
      if (gig.status in counts) counts[gig.status] += 1;
    });
    return counts;
  }, [gigs]);
  const visibleGigs = useMemo(() => {
    const text = gigQuery.trim().toLowerCase();
    const list = gigs.filter(
      (gig) =>
        (gigStatusFilter === "All" || gig.status === gigStatusFilter) &&
        (!text || [gig.title, gig.company, gig.platform, gig.gigType].some((field) => String(field ?? "").toLowerCase().includes(text)))
    );
    if (gigSort === "title") return [...list].sort((a, b) => a.title.localeCompare(b.title));
    if (gigSort === "payout") return [...list].sort((a, b) => payoutAmount(b.payout) - payoutAmount(a.payout));
    if (gigSort === "applicants") return [...list].sort((a, b) => (applicantsByGig.get(b.id) ?? 0) - (applicantsByGig.get(a.id) ?? 0));
    return list; // API order = newest first
  }, [applicantsByGig, gigQuery, gigSort, gigStatusFilter, gigs]);
  const getAdminToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Admin session missing. Please login again.");
    return token;
  }, []);
  const [proposalReviewDraft, setProposalReviewDraft] = useState<
      Record<string, { adminNote: string; adminExplanation: string; whatsappLink: string; onboardingSteps?: string }>
  >({});
  const [bulkReviewDraft, setBulkReviewDraft] = useState<BulkReviewDraft>({ ...DEFAULT_BULK_REVIEW_DRAFT });
  const [browseControlSavingId, setBrowseControlSavingId] = useState<string | null>(null);
  const [browseControlNotice, setBrowseControlNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const [form, setForm] = useState({
    title: "",
    company: "",
    platform: "Instagram" as Platform,
    location: "Remote",
    workload: "",
    payout: "",
    payoutType: "Per post" as PayoutType,
    gigType: "Email Creator" as GigType,
    customGigType: "",
    customBrief: "",
    accountInstructions: "",
    customRequirements: "",
    customMedia: "",
    sampleVideos: [] as GigSample[],
    projectBrief: "",
    hiringCapacity: "",
    expertise: "",
    languages: "",
    applicationMode: "apply" as GigApplicationMode,
    onboardingRequired: true,
    kycRequired: true,
    requirements: "",
    status: "Open" as GigStatus,
  });
  // Mirrors validateForm: drives the progress bar, section ticks and the "required left" hint.
  const formChecklist = useMemo(() => {
    const needsBrief = form.gigType === "Custom" || form.gigType === "Project" || form.gigType === "Content Posting";
    const checks = [
      { section: 0, label: "Title", ok: !!form.title.trim() },
      { section: 0, label: "Company", ok: !!form.company.trim() },
      { section: 1, label: "Payout", ok: !!form.payout.trim() },
      { section: 1, label: "Workload", ok: !!form.workload.trim() },
      ...(form.gigType === "Custom" ? [{ section: 2, label: "Custom type label", ok: !!form.customGigType.trim() }] : []),
      ...(needsBrief ? [{ section: 2, label: "Brief", ok: !!form.customBrief.trim() }] : []),
    ];
    const sectionOk = (index: number) => checks.filter((c) => c.section === index).every((c) => c.ok);
    return {
      done: checks.filter((c) => c.ok).length,
      total: checks.length,
      missing: checks.filter((c) => !c.ok).map((c) => c.label),
      sections: [
        { id: "gig-step-basics", label: "Basics", complete: sectionOk(0) },
        { id: "gig-step-pay", label: "Pay", complete: sectionOk(1) },
        { id: "gig-step-type", label: "Type & brief", complete: sectionOk(2) },
        { id: "gig-step-media", label: "Media", complete: form.sampleVideos.length > 0 },
        { id: "gig-step-settings", label: "Settings", complete: true },
      ],
    };
  }, [form]);

  useEffect(() => {
    if (authorized) return;
    let alive = true;
    void getMyRole().then(role => {
      if (!alive) return;
      const cached = readLS<AuthSession | null>(LS_KEYS.AUTH, null);
      setSession(role ? { ...cached, role, at: new Date().toISOString() } : null);
      setSessionLoaded(true);
    }).catch(() => {
      if (!alive) return;
      setSession(null);
      setSessionLoaded(true);
    });
    return () => { alive = false; };
  }, [authorized]);

  useEffect(() => {
    if (!adminReady) return;
    // Remove older persistent admin records. Sensitive rows and drafts now live only in this mounted console.
    try {
      for (const key of [LS_KEYS.GIG_APPS, LS_KEYS.GIG_ASSIGNMENTS, LS_KEYS.GIG_KYC_ROWS, LS_KEYS.GIG_KYC_SYNC_AT, LS_KEYS.PROPOSAL_REVIEW_DRAFT]) {
        window.localStorage.removeItem(key);
      }
    } catch { /* Browser storage may be unavailable. */ }
  }, [adminReady]);

  useEffect(() => {
    if (authorized || !sessionLoaded) return;
    if (!session) {
      window.location.replace(`/login?next=${encodeURIComponent(nextPath)}`);
    } else if (session.role !== "Admin") {
      window.location.replace("/dashboard");
    }
  }, [authorized, nextPath, sessionLoaded, session]);

  useEffect(() => {
    readable.current = adminReady;
    if (!adminReady) reads.abortAll();
    return () => {
      readable.current = false;
      reads.abortAll();
    };
  }, [adminReady, reads]);

  const seenAppIds = useRef<Set<string> | null>(null);
  const applicationReadVersion = useRef(0);
  const pendingApplicationWrites = useRef(0);
  const gigTitles = useRef(gigs);
  useEffect(() => { gigTitles.current = gigs; }, [gigs]);
  const loadGigs = useCallback(async ({ afterCurrent = false } = {}) => reads.run("gigs", async signal => {
    if (!readable.current) return;
    try {
      const res = await fetch("/api/gigs", { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
      const payload = await res.json();
      if (!res.ok || !Array.isArray(payload)) throw new Error("Gig listings could not be refreshed.");
      if (signal.aborted) return;
      setGigs(payload);
      writeLS(LS_KEYS.GIGS, payload);
      setLoadedResources(previous => ({ ...previous, gigs: true }));
      setLoadErrors(previous => ({ ...previous, gigs: undefined }));
    } catch {
      if (!signal.aborted) setLoadErrors(previous => ({ ...previous, gigs: "Gig listings could not be refreshed." }));
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, { afterCurrent }), [reads]);

  const loadApps = useCallback(async ({ announce = false, afterCurrent = false } = {}) => reads.run("applications", async signal => {
    if (!readable.current || pendingApplicationWrites.current) return;
    const version = ++applicationReadVersion.current;
    setAppsRefreshing(true);
    try {
      const res = await fetch("/api/gig-applications", { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
      const payload = await res.json();
      if (!res.ok || !Array.isArray(payload)) throw new Error("Applications could not be refreshed.");
      if (signal.aborted || pendingApplicationWrites.current) return;
      const safe = payload as GigApplication[];
      const previous = seenAppIds.current;
      const fresh = previous && announce ? safe.filter(app => !previous.has(String(app.id))) : [];
      seenAppIds.current = new Set(safe.map(app => String(app.id)));
      setApps(safe);
      setAppsSyncedAt(new Date().toISOString());
      setLoadedResources(previous => ({ ...previous, applications: true }));
      setLoadErrors(previous => ({ ...previous, applications: undefined }));
      if (fresh.length) {
        const first = fresh[0];
        const gigTitle = gigTitles.current.find(gig => String(gig.id) === String(first.gigId))?.title;
        const instant = String(first.status ?? "").toLowerCase() === "accepted";
        setApplicationNotice({
          tone: "success",
          text: fresh.length === 1
            ? `New application from ${first.workerName || first.workerId}${gigTitle ? ` for ${gigTitle}` : ""}${instant ? " · approved instantly" : ""}.`
            : `${fresh.length} new applications.`,
        });
      }
    } catch {
      if (!signal.aborted) setLoadErrors(previous => ({ ...previous, applications: "Applications could not be refreshed." }));
    } finally {
      if (applicationReadVersion.current === version) setAppsRefreshing(false);
    }
  }, { afterCurrent }), [reads]);

  const loadAssignments = useCallback(async ({ afterCurrent = false } = {}) => reads.run("assignments", async signal => {
    if (!readable.current) return;
    try {
      const res = await fetch("/api/gig-assignments?all=1", { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
      const payload = await res.json();
      if (!res.ok || !Array.isArray(payload)) throw new Error("Credential submissions could not be refreshed.");
      if (signal.aborted) return;
      setAssignments(payload);
      setLastRefreshAt(new Date().toISOString());
      setLoadedResources(previous => ({ ...previous, assignments: true }));
      setLoadErrors(previous => ({ ...previous, assignments: undefined }));
    } catch {
      if (!signal.aborted) setLoadErrors(previous => ({ ...previous, assignments: "Credential submissions could not be refreshed." }));
    }
  }, { afterCurrent }), [reads]);

  const fetchKyc = useCallback(async ({ preserveFeedback = false, afterCurrent = false }: { preserveFeedback?: boolean; afterCurrent?: boolean } = {}) => reads.run("kyc", async signal => {
    if (!readable.current) return;
    if (!preserveFeedback) {
      setKycLoading(true);
      setKycError(null);
      setKycNotice(null);
    }
    try {
      const token = await getAdminToken();
      signal.throwIfAborted();
      const res = await fetch("/api/admin/kyc", {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(payload?.rows)) throw new Error(payload?.error || "KYC review could not be refreshed.");
      if (signal.aborted) return;
      setKycRows(payload.rows);
      setKycLastSyncAt(new Date().toISOString());
      setLoadedResources(previous => ({ ...previous, kyc: true }));
      setKycError(null);
    } catch (error) {
      if (!signal.aborted) setKycError(error instanceof Error ? error.message : "KYC review could not be refreshed.");
    } finally {
      if (!signal.aborted) setKycLoading(false);
    }
  }, { afterCurrent }), [getAdminToken, reads]);

  const loadLinkedSummary = useCallback(async ({ afterCurrent = false } = {}) => reads.run("summary", async signal => {
    if (!readable.current) return;
    try {
      const res = await fetch("/api/social-accounts?scope=summary", { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
      if (!res.ok) return;
      const payload = await res.json();
      if (signal.aborted) return;
      const count = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
      setLinkedSummary({ due: count(payload?.due), reelsToReview: count(payload?.reelsToReview), accountRequests: count(payload?.accountRequests) });
    } catch { /* Keep the previous badge count on transient errors. */ }
  }, { afterCurrent }), [reads]);

  const refreshData = useCallback((afterCurrent = false) => Promise.allSettled([
    loadGigs({ afterCurrent }),
    loadApps({ afterCurrent }),
    loadAssignments({ afterCurrent }),
    fetchKyc({ preserveFeedback: loadedResources.kyc, afterCurrent }),
    loadLinkedSummary({ afterCurrent }),
  ]), [fetchKyc, loadApps, loadAssignments, loadGigs, loadLinkedSummary, loadedResources.kyc]);
  const refreshDataRef = useRef(refreshData);
  useEffect(() => { refreshDataRef.current = refreshData; }, [refreshData]);

  useEffect(() => {
    if (!adminReady || !active) return;
    // Independent resources arrive as soon as each request finishes; navigation retains previous rows.
    void refreshDataRef.current();
  }, [active, adminReady]);

  useEffect(() => {
    if (!adminReady || !active) return;
    const refresh = () => {
      void refreshDataRef.current(true);
      window.dispatchEvent(new CustomEvent<AdminLiveKind[] | null>("admin-live", { detail: null }));
    };
    window.addEventListener("admin-refresh", refresh);
    return () => window.removeEventListener("admin-refresh", refresh);
  }, [active, adminReady]);

  useAdminLive(adminReady && active, kinds => {
    if (!kinds) void loadGigs({ afterCurrent: true });
    if (!kinds || kinds.has("worker_kyc")) void fetchKyc({ preserveFeedback: true, afterCurrent: true });
    if (!kinds || kinds.has("gig_applications") || kinds.has("worker_moderation") || kinds.has("worker_deletion_jobs")) {
      void loadApps({ announce: !kinds?.has("worker_moderation"), afterCurrent: true });
    }
    if (!kinds || kinds.has("gig_assignments") || kinds.has("gig_account_credentials")) void loadAssignments({ afterCurrent: true });
    if (!kinds || kinds.has("social_account_requests")) void loadLinkedSummary({ afterCurrent: true });
    window.dispatchEvent(new CustomEvent<AdminLiveKind[] | null>("admin-live", { detail: kinds ? [...kinds] : null }));
  }, { refreshOnConnect: true });

  const appsForGig = useMemo(() => {
    if (selectedGigId === "All") return apps;
    return apps.filter((app) => app.gigId === selectedGigId);
  }, [apps, selectedGigId]);
  const gigById = useMemo(() => {
    const map = new Map<string, Gig>();
    gigs.forEach((gig) => map.set(String(gig.id), gig));
    return map;
  }, [gigs]);
  const gigTitleById = useCallback((gigId: string) => gigById.get(String(gigId))?.title, [gigById]);
  const filteredApps = useMemo(() => {
    const statusScoped =
      applicationStatusFilter === "All" ? appsForGig : appsForGig.filter((app) => app.status === applicationStatusFilter);
    const query = applicationQueueQuery.trim().toLowerCase();
    const queryScoped = !query
      ? statusScoped
      : statusScoped.filter((app) => {
          const gig = gigById.get(String(app.gigId));
          return [
            app.workerName,
            app.workerId,
            app.proposal?.pitch,
            app.proposal?.approach,
            gig?.title,
            gig?.company,
          ]
            .map((value) => String(value ?? "").toLowerCase())
            .some((value) => value.includes(query));
        });
    const sorted = [...queryScoped];
    sorted.sort((a, b) => {
      if (applicationQueueSort === "oldest") return new Date(a.appliedAt).getTime() - new Date(b.appliedAt).getTime();
      if (applicationQueueSort === "worker_asc") return String(a.workerName ?? a.workerId).localeCompare(String(b.workerName ?? b.workerId));
      if (applicationQueueSort === "gig_asc") {
        const aGig = String(gigById.get(String(a.gigId))?.title ?? a.gigId);
        const bGig = String(gigById.get(String(b.gigId))?.title ?? b.gigId);
        return aGig.localeCompare(bGig);
      }
      return new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime();
    });
    return sorted;
  }, [applicationQueueQuery, applicationQueueSort, applicationStatusFilter, appsForGig, gigById]);
  const proposalApps = useMemo(
    () =>
      apps.filter(
        (app) =>
          !!app.proposal &&
          !!(
            app.proposal.pitch ||
            app.proposal.approach ||
            app.proposal.timeline ||
            app.proposal.budget ||
            app.proposal.portfolio
          )
      ),
    [apps]
  );
  const applicationStatusCounts = useMemo(() => {
    const counts: Record<ApplicationStatus, number> = {
      Applied: 0,
      Pending: 0,
      Accepted: 0,
      Rejected: 0,
      Withdrawn: 0,
    };
    for (const app of appsForGig) {
      counts[app.status] = (counts[app.status] ?? 0) + 1;
    }
    return counts;
  }, [appsForGig]);
  const selectedApplication = useMemo(() => {
    if (!filteredApps.length) return null;
    return filteredApps.find((app) => app.id === selectedApplicationId) ?? filteredApps[0];
  }, [filteredApps, selectedApplicationId]);
  const isDesktop = useSyncExternalStore(subscribeDesktop, readDesktop, () => true);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const selectedIndex = selectedApplication ? filteredApps.findIndex((app) => app.id === selectedApplication.id) : -1;
  // Move through the filtered queue and keep the active card in view.
  const stepApplication = useCallback(
    (delta: number) => {
      if (!filteredApps.length) return;
      const target = filteredApps[Math.min(filteredApps.length - 1, Math.max(0, (selectedIndex < 0 ? 0 : selectedIndex) + delta))];
      if (!target) return;
      setSelectedApplicationId(target.id);
      window.requestAnimationFrame(() =>
        document.querySelector(`[data-queue-app="${CSS.escape(target.id)}"]`)?.scrollIntoView({ block: "nearest" })
      );
    },
    [filteredApps, selectedIndex]
  );
  // J/K step through the queue on desktop (arrows too inside the mobile sheet). Decisions stay click-only:
  // approving or rejecting emails the worker, so a stray keypress shouldn't send one.
  useEffect(() => {
    if (!active || view !== "applications") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || appDrawer) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      const key = event.key.toLowerCase();
      if (key === "j" || (detailSheetOpen && event.key === "ArrowRight")) {
        event.preventDefault();
        stepApplication(1);
      } else if (key === "k" || (detailSheetOpen && event.key === "ArrowLeft")) {
        event.preventDefault();
        stepApplication(-1);
      } else if (event.key === "Escape" && detailSheetOpen) {
        setDetailSheetOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, view, appDrawer, detailSheetOpen, stepApplication]);
  const sheetVisible = active && !isDesktop && detailSheetOpen && view === "applications";
  useEffect(() => {
    if (!sheetVisible) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [sheetVisible]);
  const selectedFilteredApplications = useMemo(
    () => filteredApps.filter((app) => selectedApplicationIds.includes(app.id)),
    [filteredApps, selectedApplicationIds]
  );
  const allFilteredSelected = filteredApps.length > 0 && filteredApps.every((app) => selectedApplicationIds.includes(app.id));

  useEffect(() => {
    if (!filteredApps.length) {
      setSelectedApplicationId(null);
      return;
    }
    if (!selectedApplicationId || !filteredApps.some((app) => app.id === selectedApplicationId)) {
      setSelectedApplicationId(filteredApps[0].id);
    }
  }, [filteredApps, selectedApplicationId]);

  useEffect(() => {
    const validIds = new Set(filteredApps.map((app) => app.id));
    setSelectedApplicationIds((prev) => prev.filter((id) => validIds.has(id)));
  }, [filteredApps]);

  const validateForm = () => {
    if (!form.title.trim()) return "Title is required.";
    if (!form.company.trim()) return "Company is required.";
    if (!form.workload.trim()) return "Workload is required.";
    if (!form.payout.trim()) return "Payout is required.";
    if (form.payoutType === "Per 1k Views" && !isValidViewPayoutRate(form.payout)) return "Enter a positive amount per 1,000 views, such as ₹100.";
    if (form.gigType === "Custom" && !form.customGigType.trim()) return "Custom gig type label is required.";
    if ((form.gigType === "Custom" || form.gigType === "Project" || form.gigType === "Content Posting") && !form.customBrief.trim()) return "A project brief is required for this gig type.";
    return null;
  };

  const uploadBriefFile = useCallback(async (file: File, token: string) => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/admin/gig-brief-media/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload?.error || `Upload failed for ${file.name}`);
    return String(payload?.url ?? "").trim();
  }, []);

  const uploadCustomMediaFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setMediaUploadError(null);
      setMediaUploading(true);
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error("Admin session missing. Please login again.");

        const nextUrls: string[] = [];
        for (const file of Array.from(files)) {
          const url = await uploadBriefFile(file, token);
          if (url) nextUrls.push(url);
        }

        if (nextUrls.length > 0) {
          setForm((prev) => {
            const existing = parseCustomRequirementsText(prev.customMedia);
            return { ...prev, customMedia: [...existing, ...nextUrls].join("\n") };
          });
        }
      } catch (error: unknown) {
        setMediaUploadError(error instanceof Error ? error.message : "Media upload failed.");
      } finally {
        setMediaUploading(false);
      }
    },
    [uploadBriefFile]
  );

  /** Uploads the reel kit's example reel; the URL is stored on the kit line, not as a reference picture. */
  const uploadKitExample = useCallback(
    async (file: File) => {
      if (form.gigType !== "Content Posting" || !isReelKitCompany(form.company)) return null;
      const context = editContext.current;
      kitUploadContext.current = context;
      setMediaUploadError(null);
      setMediaUploading(true);
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error("Admin session missing. Please login again.");
        if (editContext.current !== context) return null;
        const url = await uploadBriefFile(file, token);
        return editContext.current === context ? url || null : null;
      } catch (error: unknown) {
        if (editContext.current === context) setMediaUploadError(error instanceof Error ? error.message : "Example reel upload failed.");
        return null;
      } finally {
        if (editContext.current === context) {
          kitUploadContext.current = null;
          setMediaUploading(false);
        }
      }
    },
    [form.company, form.gigType, uploadBriefFile]
  );

  const uploadReelExample = useCallback(
    async (forUrl: string, file: File | undefined) => {
      if (!file) return;
      setMediaUploadError(null);
      setMediaUploading(true);
      setReelExampleUploadingFor(forUrl);
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error("Admin session missing. Please login again.");
        const url = await uploadBriefFile(file, token);
        if (url) setForm((prev) => ({ ...prev, customMedia: withReelExample(parseCustomRequirementsText(prev.customMedia), forUrl, url).join("\n") }));
      } catch (error: unknown) {
        setMediaUploadError(error instanceof Error ? error.message : "Reel example upload failed.");
      } finally {
        setMediaUploading(false);
        setReelExampleUploadingFor(null);
      }
    },
    [uploadBriefFile]
  );

  const createGig = async () => {
    if (mediaUploading || samplesUploading) {
      setFormError("Please wait for media upload to finish before publishing.");
      return;
    }
    const err = validateForm();
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    const resolvedGigType =
      form.gigType === "Custom"
        ? `Category: ${form.customGigType.trim() || "Freelance"}`
        : form.gigType === "Project"
          ? "Project"
          : form.gigType === "Content Posting"
            ? "Content Posting"
          : normalizeGigType(form.gigType);

    const newGigId = makeId();
    const payload: Gig = {
      id: newGigId,
      title: form.title,
      company: form.company,
      verified: true,
      platform: form.platform,
      location: form.location,
      workload: form.workload,
      payout: form.payout,
      payoutType: form.payoutType,
      gigType: resolvedGigType,
      requirements: reelKitRequirementsForCompany(form.company, buildRequirementsPayload(form)),
      applicationMode: form.applicationMode,
      status: form.status,
      postedAt: nowLabel(),
    };

    reads.abort("gigs");
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
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.id) throw new Error(data?.error || "The gig could not be published. Please try again.");
      reads.abort("gigs");
      setGigs(previous => {
        const saved = { ...data, applicationMode: normalizeGigApplicationMode(data) } as Gig;
        const next = previous.some(gig => gig.id === payload.id)
          ? previous.map(gig => gig.id === payload.id ? saved : gig)
          : [saved, ...previous];
        writeLS(LS_KEYS.GIGS, next);
        return next;
      });
      setLastSaved({ kind: "created", id: data.id, title: data.title || payload.title });
      void loadGigs();
    } catch (error) {
      reads.abort("gigs");
      setGigs(previous => {
        const next = previous.filter(gig => gig.id !== payload.id);
        writeLS(LS_KEYS.GIGS, next);
        return next;
      });
      void loadGigs();
      setFormError(error instanceof Error ? error.message : "The gig could not be published. Please try again.");
      return;
    }

    setForm({
      title: "",
      company: "",
      platform: "Instagram",
      location: "Remote",
      workload: "",
      payout: "",
      payoutType: "Per post",
      gigType: "Email Creator",
      customGigType: "",
      customBrief: "",
      accountInstructions: "",
      customRequirements: "",
      customMedia: "",
      sampleVideos: [] as GigSample[],
      projectBrief: "",
      hiringCapacity: "",
      expertise: "",
      languages: "",
      applicationMode: "apply",
      onboardingRequired: true,
      kycRequired: true,
      requirements: "",
      status: "Open",
    });
  };

  // Listings page links here with ?edit=<id>: open that gig in the form once gigs have loaded.
  const editParamHandledRef = useRef<string | null>(null);
  const startEdit = useCallback((gig: Gig) => {
    setEditingGig(gig);
    const normalizedType = normalizeGigType(gig.gigType);
    const isProject = isProjectStyleGig(normalizedType);
    const isCustom = /^(custom|category):/i.test(normalizedType);
    const customLabel = isCustom ? normalizedType.replace(/^(custom|category):\s*/i, "").trim() : "";
    const scopedRequirements = reelKitRequirementsForCompany(gig.company, gig.requirements);
    const customFields = readCustomFieldsFromRequirements(scopedRequirements);
    const projectFields = readProjectFieldsFromRequirements(scopedRequirements);
    setForm({
      title: gig.title,
      company: gig.company,
      platform: gig.platform,
      location: gig.location,
      workload: gig.workload,
      payout: gig.payout,
      payoutType: gig.payoutType,
      gigType: isCustom ? "Custom" : isProject ? normalizedType : normalizedType,
      customGigType: customLabel,
      customBrief: customFields.customBrief,
      accountInstructions: customFields.accountInstructions,
      customRequirements: customFields.customRequirements,
      customMedia: customFields.customMedia,
      sampleVideos: parseGigSamples(gig.requirements),
      projectBrief: projectFields.projectBrief,
      hiringCapacity: projectFields.hiringCapacity,
      expertise: projectFields.expertise,
      languages: projectFields.languages,
      applicationMode: customFields.applicationMode ?? projectFields.applicationMode,
      onboardingRequired: projectFields.onboardingRequired,
      kycRequired: isCustom || isProject ? customFields.kycRequired : projectFields.kycRequired,
      requirements: isCustom || isProject ? customFields.customRequirements.replace(/\n/g, ", ") : projectFields.requirementsText,
      status: gig.status,
    });
    setFormError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [setEditingGig]);

  useEffect(() => {
    if (view !== "create-new-gig") return;
    const params = new URLSearchParams(searchKey ?? window.location.search);
    const editId = params.get("edit");
    if (!editId) {
      editParamHandledRef.current = null;
      return;
    }
    if (editParamHandledRef.current === editId || gigs.length === 0) return;
    const gig = gigs.find((item) => item.id === editId);
    if (!gig) return;
    editParamHandledRef.current = editId;
    params.delete("edit");
    const query = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    queueMicrotask(() => startEdit(gig));
    // The handled ID prevents repeated form resets while retaining support for a later edit link.
  }, [view, gigs, searchKey, startEdit]);

  const updateGig = async () => {
    if (!editingGig) return;
    if (mediaUploading || samplesUploading) {
      setFormError("Please wait for media upload to finish before updating.");
      return;
    }
    const err = validateForm();
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    const resolvedGigType =
      form.gigType === "Custom"
        ? `Category: ${form.customGigType.trim() || "Freelance"}`
        : form.gigType === "Project"
          ? "Project"
          : form.gigType === "Content Posting"
            ? "Content Posting"
          : normalizeGigType(form.gigType);

    const updates: Partial<Gig> = {
      title: form.title,
      company: form.company,
      platform: form.platform,
      location: form.location,
      workload: form.workload,
      payout: form.payout,
      payoutType: form.payoutType,
      gigType: resolvedGigType,
      requirements: reelKitRequirementsForCompany(form.company, buildRequirementsPayload(form)),
      applicationMode: form.applicationMode,
      status: form.status,
    };

    reads.abort("gigs");

    setGigs((prev) => {
      const next = prev.map((gig) => (gig.id === editingGig.id ? { ...gig, ...updates } : gig));
      writeLS(LS_KEYS.GIGS, next);
      return next;
    });

    try {
      const res = await fetch("/api/gigs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingGig.id, updates }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error || "Failed to update gig.");
      }
      const data = await res.json();
      reads.abort("gigs");
      setGigs((prev) => {
        const next = prev.map((gig) => (gig.id === editingGig.id ? { ...data, applicationMode: normalizeGigApplicationMode(data) } : gig));
        writeLS(LS_KEYS.GIGS, next);
        return next;
      });
    } catch {
      reads.abort("gigs");
      setGigs(previous => previous.map(gig => gig.id === editingGig.id ? editingGig : gig));
      setFormError("Failed to update gig. Please try again.");
      return;
    }

    setLastSaved({ kind: "updated", id: editingGig.id, title: form.title || editingGig.title });
    setEditingGig(null);
    setForm({
      title: "",
      company: "",
      platform: "Instagram",
      location: "Remote",
      workload: "",
      payout: "",
      payoutType: "Per post",
      gigType: "Email Creator",
      customGigType: "",
      customBrief: "",
      accountInstructions: "",
      customRequirements: "",
      customMedia: "",
      sampleVideos: [] as GigSample[],
      projectBrief: "",
      hiringCapacity: "",
      expertise: "",
      languages: "",
      applicationMode: "apply",
      onboardingRequired: true,
      kycRequired: true,
      requirements: "",
      status: "Open",
    });
  };

  const deleteGig = async (gigId: string) => {
    const confirmed = window.confirm("Delete this gig? This will remove all related applications.");
    if (!confirmed) return;

    reads.abort("gigs");
    reads.abort("applications");
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
      const res = await fetch(`/api/gigs?id=${encodeURIComponent(gigId)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("The gig could not be deleted.");
    } catch {
      setBrowseControlNotice({ tone: "danger", text: "The gig could not be deleted. Please try again." });
    } finally {
      reads.abort("gigs");
      reads.abort("applications");
      void loadGigs();
      void loadApps();
    }
  };
  const updateGigStatus = async (gigId: string, status: GigStatus) => {
    reads.abort("gigs");
    setGigs((prev) => {
      const next = prev.map((gig) => (gig.id === gigId ? { ...gig, status } : gig));
      writeLS(LS_KEYS.GIGS, next);
      return next;
    });

    try {
      const res = await fetch("/api/gigs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: gigId, updates: { status } }),
      });
      if (!res.ok) throw new Error("The gig status could not be saved.");
    } catch {
      setBrowseControlNotice({ tone: "danger", text: "The gig status could not be saved. Please try again." });
    } finally {
      reads.abort("gigs");
      void loadGigs();
    }
  };

  const updateGigType = async (gigId: string, gigType: GigType) => {
    const normalized = normalizeGigType(gigType);
    const resolved =
      normalized === "Custom"
        ? `Category: ${window.prompt("Enter custom gig type label", "Freelance")?.trim() || "Freelance"}`
        : normalized === "Project"
          ? "Project"
        : normalized;
    reads.abort("gigs");
    setGigs((prev) => {
      const next = prev.map((gig) => (gig.id === gigId ? { ...gig, gigType: resolved } : gig));
      writeLS(LS_KEYS.GIGS, next);
      return next;
    });

    try {
      const res = await fetch("/api/gigs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: gigId, updates: { gigType: resolved } }),
      });
      if (!res.ok) throw new Error("The gig type could not be saved.");
    } catch {
      setBrowseControlNotice({ tone: "danger", text: "The gig type could not be saved. Please try again." });
    } finally {
      reads.abort("gigs");
      void loadGigs();
    }
  };

  const updateGigApplicationMode = async (gig: Gig, applicationMode: GigApplicationMode) => {
    const normalizedType = normalizeGigType(gig.gigType);
    const isCustomGigType = /^(custom|category):/i.test(String(normalizedType ?? ""));
    const customFields = readCustomFieldsFromRequirements(gig.requirements);
    const projectFields = readProjectFieldsFromRequirements(gig.requirements);
    const nextRequirements = reelKitRequirementsForCompany(gig.company, buildRequirementsPayload({
      gigType: isCustomGigType ? "Custom" : normalizedType,
      requirements: projectFields.requirementsText,
      customBrief: customFields.customBrief,
      accountInstructions: customFields.accountInstructions,
      customRequirements: customFields.customRequirements,
      customMedia: customFields.customMedia,
      sampleVideos: parseGigSamples(gig.requirements),
      projectBrief: projectFields.projectBrief,
      hiringCapacity: projectFields.hiringCapacity,
      expertise: projectFields.expertise,
      languages: projectFields.languages,
      applicationMode,
      onboardingRequired: projectFields.onboardingRequired,
      kycRequired: isCustomGigType || isProjectStyleGig(normalizedType) ? customFields.kycRequired : projectFields.kycRequired,
    }));

    reads.abort("gigs");

    setGigs((prev) => {
      const next = prev.map((item) => (item.id === gig.id ? { ...item, requirements: nextRequirements } : item));
      writeLS(LS_KEYS.GIGS, next);
      return next;
    });

    try {
      const res = await fetch("/api/gigs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: gig.id, updates: { requirements: nextRequirements } }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error || "Failed to update application flow.");
      }
      const data = await res.json();
      reads.abort("gigs");
      setGigs((prev) => {
        const next = prev.map((item) => (item.id === gig.id ? { ...data, applicationMode: normalizeGigApplicationMode(data) } : item));
        writeLS(LS_KEYS.GIGS, next);
        return next;
      });
    } catch {
      reads.abort("gigs");
      setGigs(previous => previous.map(item => item.id === gig.id ? gig : item));
      setBrowseControlNotice({ tone: "danger", text: "Could not save application flow. Please retry." });
    }
  };

  const pinnedGigs = useMemo(
    () =>
      gigs
        .map((gig) => ({ gig, spotlight: readBrowseSpotlightConfig(gig.requirements) }))
        .filter((entry) => entry.spotlight.pinned)
        .sort((a, b) => {
          const rankA = a.spotlight.pinRank ?? 999;
          const rankB = b.spotlight.pinRank ?? 999;
          if (rankA !== rankB) return rankA - rankB;
          if (a.gig.status !== b.gig.status) {
            const statusOrder = { Open: 0, Paused: 1, Closed: 2 } as const;
            return statusOrder[a.gig.status] - statusOrder[b.gig.status];
          }
          return a.gig.title.localeCompare(b.gig.title);
        }),
    [gigs]
  );

  const getNextBrowsePinRank = useCallback(() => {
    const used = new Set(
      gigs
        .map((gig) => readBrowseSpotlightConfig(gig.requirements).pinRank)
        .filter((value): value is number => typeof value === "number" && value > 0)
    );
    for (let index = 1; index <= 6; index += 1) {
      if (!used.has(index)) return index;
    }
    return 6;
  }, [gigs]);

  const updateGigBrowseSpotlight = useCallback(
    async (gig: Gig, updates: Partial<{ pinned: boolean; pinRank: number | null; pinLabel: string }>) => {
      const nextRequirements = mergeBrowseSpotlightConfig(gig.requirements, updates);
      setBrowseControlSavingId(gig.id);
      setBrowseControlNotice(null);
      reads.abort("gigs");
      setGigs((prev) => {
        const next = prev.map((item) =>
          item.id === gig.id
            ? {
                ...item,
                requirements: nextRequirements,
                applicationMode: gig.applicationMode ?? normalizeGigApplicationMode(gig),
                ...readBrowseSpotlightConfig(nextRequirements),
              }
            : item
        );
        writeLS(LS_KEYS.GIGS, next);
        return next;
      });
      try {
        const res = await fetch("/api/gigs", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: gig.id,
            updates: {
              requirements: nextRequirements,
              applicationMode: gig.applicationMode ?? normalizeGigApplicationMode(gig),
            },
          }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          throw new Error(payload?.error || "Failed to update browse spotlight controls.");
        }
        const data = await res.json();
        reads.abort("gigs");
        setGigs(previous => previous.map(item => item.id === gig.id ? { ...data, applicationMode: normalizeGigApplicationMode(data) } : item));
        setBrowseControlNotice({
          tone: "success",
          text: updates.pinned === false ? "Gig removed from Browse spotlight." : "Browse spotlight settings updated.",
        });
      } catch (error) {
        reads.abort("gigs");
        setGigs(previous => previous.map(item => item.id === gig.id ? gig : item));
        setBrowseControlNotice({
          tone: "danger",
          text: error instanceof Error ? error.message : "Failed to update Browse spotlight controls.",
        });
      } finally {
        setBrowseControlSavingId(null);
      }
    },
    [reads]
  );

  const toggleGigPinned = useCallback(
    async (gig: Gig) => {
      const spotlight = readBrowseSpotlightConfig(gig.requirements);
      if (spotlight.pinned) {
        await updateGigBrowseSpotlight(gig, { pinned: false, pinRank: null, pinLabel: "" });
        return;
      }
      await updateGigBrowseSpotlight(gig, {
        pinned: true,
        pinRank: spotlight.pinRank ?? getNextBrowsePinRank(),
        pinLabel: spotlight.pinLabel || "Pinned by admin",
      });
    },
    [getNextBrowsePinRank, updateGigBrowseSpotlight]
  );

  const persistApplicationReview = async (
    app: GigApplication,
    review?: { adminNote?: string; adminExplanation?: string; whatsappLink?: string; onboardingSteps?: string },
    statusOverride?: ApplicationStatus,
    options?: { notificationMode?: "whatsapp_invite" | "workflow_update"; quiet?: boolean }
  ): Promise<{ ok: boolean; mailSent?: boolean; error?: string }> => {
    const status = statusOverride ?? app.status;
    const decidedAt = new Date().toISOString();
    const reviewStatus: NonNullable<GigApplication["proposal"]>["reviewStatus"] =
      status === "Rejected" ? "Rejected" : status === "Accepted" ? "Accepted" : "Pending";
    const nextProposal: GigApplication["proposal"] = {
      ...(app.proposal ?? {}),
      submittedAt: app.proposal?.submittedAt ?? app.appliedAt,
      reviewStatus,
      adminNote: review?.adminNote ?? app.proposal?.adminNote ?? "",
      adminExplanation: review?.adminExplanation ?? app.proposal?.adminExplanation ?? "",
      whatsappLink: review?.whatsappLink ?? app.proposal?.whatsappLink ?? "",
      onboardingSteps: review?.onboardingSteps ?? app.proposal?.onboardingSteps ?? "",
      reviewedAt: decidedAt,
    };
    pendingApplicationWrites.current++;
    reads.abort("applications");
    setApps((prev) => {
      const next = prev.map((a) => (a.id === app.id ? { ...a, status, decidedAt, proposal: nextProposal } : a));
      writeLS(LS_KEYS.GIG_APPS, next);
      return next;
    });
    if (!options?.quiet) setApplicationNotice(null);

    try {
      const res = await fetch("/api/gig-applications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: app.id,
          updates: {
            status,
            decidedAt,
            workerName: app.workerName ?? app.workerId,
            proposal: nextProposal,
            notificationMode: options?.notificationMode,
          },
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || "Unable to update recruiter workflow.");
      }
      reads.abort("applications");
      setApps(previous => previous.map(item => item.id === app.id ? { ...item, status, decidedAt, proposal: nextProposal } : item));
      if (!options?.quiet) {
        if (payload?.mailStatus?.sent) {
          setApplicationNotice({ tone: "success", text: `Worker notification sent to ${payload.mailStatus.recipient}.` });
        } else if (payload?.mailStatus?.reason) {
          setApplicationNotice({ tone: "danger", text: `Worker notification was not sent: ${payload.mailStatus.reason}` });
        }
      }
      return { ok: true, mailSent: !!payload?.mailStatus?.sent };
    } catch (err: unknown) {
      // Roll back the optimistic update so the queue reflects what the server actually has.
      reads.abort("applications");
      setApps((prev) => {
        const next = prev.map((a) => (a.id === app.id ? app : a));
        writeLS(LS_KEYS.GIG_APPS, next);
        return next;
      });
      const message = err instanceof Error ? err.message : "Unable to update recruiter workflow.";
      if (!options?.quiet) setApplicationNotice({ tone: "danger", text: message });
      return { ok: false, error: message };
    } finally {
      pendingApplicationWrites.current--;
      if (!pendingApplicationWrites.current) void loadApps();
    }
  };

  const updateApplication = async (
    app: GigApplication,
    status: ApplicationStatus,
    review?: { adminNote?: string; adminExplanation?: string; whatsappLink?: string; onboardingSteps?: string }
  ) => {
    await persistApplicationReview(app, review, status);
  };

  /** Shared bulk executor for the bulk bar, the message drawer and automation rules. */
  const executeApplicationBulk = async (
    targets: GigApplication[],
    action: ApplicationStatus | "push",
    message: BulkReviewDraft | undefined,
    label: string
  ): Promise<{ ok: string[]; failed: string[] }> => {
    if (!targets.length) return { ok: [], failed: [] };
    setBulkApplicationActionId(`${action}:${Date.now()}`);
    setApplicationNotice(null);
    setApplicationBulkProgress({ label: `${label}…`, done: 0, total: targets.length });
    const ok: string[] = [];
    const failed: string[] = [];
    let mailed = 0;
    try {
      await runPool(
        targets,
        3,
        async (app) => {
          const result =
            action === "push"
              ? await persistApplicationReview(app, message, app.status, {
                  quiet: true,
                  notificationMode: (message?.whatsappLink ?? app.proposal?.whatsappLink ?? "").trim() ? "whatsapp_invite" : "workflow_update",
                })
              : await persistApplicationReview(app, message, action, { quiet: true });
          if (result.ok) ok.push(app.id);
          else failed.push(app.id);
          if (result.mailSent) mailed += 1;
        },
        (done) => setApplicationBulkProgress((prev) => (prev ? { ...prev, done } : prev))
      );
      const verb = action === "push" ? "updated" : action === "Accepted" ? "approved" : action === "Rejected" ? "rejected" : "moved to pending";
      const names = failed.map((id) => {
        const app = targets.find((t) => t.id === id);
        return app?.workerName ?? app?.workerId ?? id;
      });
      setApplicationNotice(
        failed.length
          ? { tone: "danger", text: `${label}: ${ok.length} ${verb}, ${failed.length} failed (${names.join(", ")}). Failed ones stay selected.` }
          : { tone: "success", text: `${label}: ${ok.length} application${ok.length === 1 ? "" : "s"} ${verb} · ${mailed} email${mailed === 1 ? "" : "s"} sent.` }
      );
      setSelectedApplicationIds((prev) => prev.filter((id) => !ok.includes(id)));
      return { ok, failed };
    } finally {
      setBulkApplicationActionId(null);
      setApplicationBulkProgress(null);
    }
  };

  const automation = useApplicationAutomation({
    apps,
    onRunComplete: (rule, summary) => {
      const failures = summary.failures.map((f) => `${f.workerId}: ${f.error}`).join("; ");
      setApplicationNotice(
        summary.failed
          ? { tone: "danger", text: `Rule “${rule.name}”: ${summary.succeeded} done, ${summary.failed} failed (${failures}).` }
          : { tone: "success", text: `Rule “${rule.name}”: ${summary.succeeded} application${summary.succeeded === 1 ? "" : "s"} updated · ${summary.emailsSent} email${summary.emailsSent === 1 ? "" : "s"} sent.` }
      );
      void refreshApps();
    },
  });

  const toggleApplicationSelection = (appId: string) => {
    setSelectedApplicationIds((prev) => (prev.includes(appId) ? prev.filter((id) => id !== appId) : [...prev, appId]));
  };

  const toggleSelectAllFilteredApplications = () => {
    const filteredIds = filteredApps.map((app) => app.id);
    if (!filteredIds.length) return;
    setSelectedApplicationIds((prev) => {
      const allSelected = filteredIds.every((id) => prev.includes(id));
      if (allSelected) {
        return prev.filter((id) => !filteredIds.includes(id));
      }
      const next = new Set(prev);
      filteredIds.forEach((id) => next.add(id));
      return Array.from(next);
    });
  };

  const selectedTargets = filteredApps.filter((app) => selectedApplicationIds.includes(app.id));
  const runSelected = (action: ApplicationStatus | "push", label: string) => {
    if (!selectedTargets.length) {
      setApplicationNotice({ tone: "danger", text: "Select one or more applications first." });
      return;
    }
    void executeApplicationBulk(selectedTargets, action, bulkReviewDraft, label);
  };

  const refreshApps = useCallback(async () => {
    await loadApps({ afterCurrent: true });
  }, [loadApps]);

  const refreshAssignments = async () => {
    setAssignmentsRefreshing(true);
    try { await loadAssignments({ afterCurrent: true }); }
    finally { setAssignmentsRefreshing(false); }
  };


  // Position + previous/next controls shown above the detail (desktop) or as the sheet header (phones/tablets).
  const renderDetailNav = (variant: "inline" | "sheet") => {
    if (!selectedApplication) return null;
    const position = (
      <span className="text-[12.5px] text-[#616a64]">
        <span className="font-semibold tabular-nums text-[#1a201c]">{selectedIndex + 1}</span> of <span className="tabular-nums">{filteredApps.length}</span>
      </span>
    );
    const arrowBtn = "grid h-9 w-9 place-items-center rounded-[10px] border border-[#d9ddd8] bg-white text-[#1a201c] transition hover:bg-[#f7f8f6] disabled:cursor-default disabled:opacity-40";
    const arrows = (
      <span className="flex items-center gap-1.5">
        <button type="button" className={arrowBtn} onClick={() => stepApplication(-1)} disabled={selectedIndex <= 0} aria-label="Previous application">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden><path d="m12 5-5 5 5 5" /></svg>
        </button>
        <button type="button" className={arrowBtn} onClick={() => stepApplication(1)} disabled={selectedIndex >= filteredApps.length - 1} aria-label="Next application">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden><path d="m8 5 5 5-5 5" /></svg>
        </button>
      </span>
    );
    if (variant === "sheet") {
      return (
        <div className="flex items-center justify-between gap-2 border-b border-[#e3e5e1] bg-white/95 px-3 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] backdrop-blur sm:px-5">
          <button type="button" onClick={() => setDetailSheetOpen(false)} className="inline-flex h-9 items-center gap-1.5 rounded-[10px] px-2 text-[13.5px] font-semibold text-[#1a201c] hover:bg-[#f1f3f0]">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden><path d="m12 5-5 5 5 5" /></svg>
            Queue
          </button>
          {position}
          {arrows}
        </div>
      );
    }
    return (
      <div className="mb-3 flex items-center justify-between gap-3 rounded-[14px] border border-[#e3e5e1] bg-white px-3.5 py-2 shadow-[0_1px_2px_rgba(26,32,28,0.04)]">
        <span className="flex min-w-0 items-center gap-3">
          {position}
          <span className="hidden items-center gap-1 text-[11.5px] text-[#8a928c] xl:inline-flex">
            <kbd className="rounded border border-[#e3e5e1] bg-[#fafbf9] px-1.5 font-sans font-semibold text-[#616a64]">J</kbd>
            <kbd className="rounded border border-[#e3e5e1] bg-[#fafbf9] px-1.5 font-sans font-semibold text-[#616a64]">K</kbd>
            to move through the queue
          </span>
        </span>
        {arrows}
      </div>
    );
  };

  const selectedApplicationPanel = selectedApplication
    ? (() => {
        const app = selectedApplication;
        const relatedGig = gigById.get(String(app.gigId));
        const savedDraft = proposalReviewDraft[app.id];
        const draft = {
          adminNote: savedDraft?.adminNote ?? app.proposal?.adminNote ?? "",
          adminExplanation: savedDraft?.adminExplanation ?? app.proposal?.adminExplanation ?? "",
          whatsappLink: savedDraft?.whatsappLink ?? app.proposal?.whatsappLink ?? "",
          onboardingSteps: savedDraft?.onboardingSteps ?? app.proposal?.onboardingSteps ?? "",
        };
        return (
          <ApplicationDetail
            key={app.id}
            app={app}
            gigTitle={relatedGig?.title ?? app.gigId}
            company={relatedGig?.company ?? "Reelencer"}
            gigTypeLabel={relatedGig?.gigType ? formatGigTypeLabel(relatedGig.gigType) : undefined}
            isProjectProposal={isProjectStyleGig(relatedGig?.gigType)}
            isDirectApply={normalizeGigApplicationMode(relatedGig ?? { requirements: [] }) === "apply"}
            draft={draft}
            onDraftChange={(patch) => setProposalReviewDraft((prev) => ({ ...prev, [app.id]: { ...draft, ...patch } }))}
            onSave={async (review) => {
              await persistApplicationReview(app, review, app.status);
            }}
            onDecide={(status, review) => updateApplication(app, status, review)}
            stickyDecisions={!isDesktop}
            account={
              isContentPostingGig(relatedGig?.gigType)
                ? {
                    platformLabel: accountPlatformFor(relatedGig?.platform).label,
                    onReveal: async () => {
                      const res = await fetch("/api/gig-applications/account-setup", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "reveal", applicationId: app.id }),
                      });
                      const payload = await res.json().catch(() => null);
                      if (!res.ok) throw new Error(payload?.error || "Couldn't load the password.");
                      return String(payload?.password ?? "");
                    },
                    onCheck: async () => {
                      const res = await fetch("/api/gig-applications/account-setup", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "check", applicationId: app.id }),
                      });
                      const payload = await res.json().catch(() => null);
                      if (!res.ok) throw new Error(payload?.error || "Couldn't read the bio.");
                      reads.abort("applications");
                      setApps((prev) => {
                        const next = prev.map((a) => (a.id === app.id ? { ...a, ...payload, status: payload.status ?? a.status } : a));
                        writeLS(LS_KEYS.GIG_APPS, next);
                        return next;
                      });
                    },
                    onRequestChanges: async (note) => {
                      const res = await fetch("/api/gig-applications/account-setup", {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "request_changes", applicationId: app.id, note }),
                      });
                      const payload = await res.json().catch(() => null);
                      if (!res.ok) throw new Error(payload?.error || "Couldn't send the request.");
                      reads.abort("applications");
                      setApps((prev) => {
                        const next = prev.map((a) => (a.id === app.id ? { ...a, ...payload, status: payload.status ?? a.status } : a));
                        writeLS(LS_KEYS.GIG_APPS, next);
                        return next;
                      });
                      setApplicationNotice(
                        payload?.mailStatus?.sent
                          ? { tone: "success", text: `Change request sent to ${payload.mailStatus.recipient}.` }
                          : { tone: "danger", text: `Change request saved, but the email wasn't sent${payload?.mailStatus?.reason ? `: ${payload.mailStatus.reason}` : "."}` }
                      );
                    },
                  }
                : undefined
            }
          />
        );
      })()
    : null;

  if (!active) return null;
  const initialLoading =
    (view === "applications" && appsLoading) ||
    (view === "credential-submissions" && assignmentsLoading) ||
    (view === "gig-listings" && loading) ||
    (view === "kyc-review" && !loadedResources.kyc && !kycError);
  if (initialLoading) return <AdminSectionLoading label={view === "applications" ? "Loading applications" : "Loading live records"} variant={view === "applications" ? "applications" : "section"} />;

  const initialError =
    (view === "applications" && !loadedResources.applications && loadErrors.applications) ||
    (view === "credential-submissions" && !loadedResources.assignments && loadErrors.assignments) ||
    (view === "gig-listings" && !loadedResources.gigs && loadErrors.gigs);
  const loadFeedback = dataLoadError ? (
    <Banner tone="danger">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>{dataLoadError} Any previously loaded records are still shown.</span>
        <button type="button" onClick={() => void refreshData(true)} className="shrink-0 rounded-lg border border-current px-3 py-1.5 text-[12px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current">Retry</button>
      </div>
    </Banner>
  ) : null;
  if (initialError) return <div role="alert">{loadFeedback}</div>;

  return (
    <div className="min-w-0 space-y-5 text-slate-900">
        {loadFeedback}
        {view === "create-new-gig" && (
            <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(18rem,0.85fr)] xl:items-start">
          <div className="min-w-0 rounded-3xl border border-slate-200 bg-white shadow-sm">
            {/* Header + section navigator (sticks under the admin header while scrolling the form) */}
            {/* Sticks below the shared admin header; on phones it scrolls away to save space. */}
            <div className="z-10 rounded-t-3xl border-b border-slate-100 bg-white/95 px-4 pb-3 pt-4 backdrop-blur sm:px-6 sm:pt-5 md:sticky md:top-[60px] lg:top-16">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-slate-900 sm:text-[18px]">{editingGig ? "Edit gig" : "Create new gig"}</h2>
                  <p className="mt-0.5 truncate text-[12.5px] text-slate-500">
                    {editingGig ? <>Editing <span className="font-semibold text-slate-700">{editingGig.title}</span> · changes go live on update</> : "Publish a verified opportunity to Browse in five quick steps."}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Required</div>
                  <div className="text-[13px] font-bold tabular-nums text-slate-900">
                    {formChecklist.done}/{formChecklist.total}
                  </div>
                </div>
              </div>
              <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                <div className="h-full rounded-full bg-[#2e7d4f] transition-[width] duration-500" style={{ width: `${(formChecklist.done / formChecklist.total) * 100}%` }} />
              </div>
              <nav aria-label="Form sections" className="dashboard-chip-scroller -mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1">
                {formChecklist.sections.map((section, index) => (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold transition ${
                      section.complete ? "border-[#bcd6c9] bg-[#f3f8f4] text-[#1f5131]" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    <span className={`grid h-4 w-4 place-items-center rounded-full text-[9.5px] font-bold ${section.complete ? "bg-[#2e7d4f] text-white" : "bg-slate-100 text-slate-500"}`}>
                      {section.complete ? "✓" : index + 1}
                    </span>
                    {section.label}
                  </a>
                ))}
              </nav>
            </div>

            <div className="space-y-6 px-4 py-5 sm:px-6 sm:py-6">
            {lastSaved && !editingGig ? (
              <div role="status" className="flex flex-col gap-3 rounded-2xl border border-[#c8e0cf] bg-[#f1f8f2] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#2e7d4f] text-white" aria-hidden>
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                      <path d="m5 10.5 3.2 3.2L15 7" />
                    </svg>
                  </span>
                  <div className="min-w-0 text-[13px] text-[#1f5131]">
                    <span className="font-semibold">{lastSaved.kind === "created" ? "Published" : "Updated"}:</span> <span className="break-words">{lastSaved.title}</span>
                    <div className="text-[12px] text-[#41695b]">{lastSaved.kind === "created" ? "It's live in Browse now." : "Changes are live."}</div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Link href={adminSectionHref("gig-listings")} className="inline-flex h-8 items-center rounded-full bg-[#1f2b24] px-3 text-[12px] font-semibold text-white hover:bg-[#2b3a31]">
                    View in listings
                  </Link>
                  <button type="button" onClick={() => setLastSaved(null)} className="inline-flex h-8 items-center rounded-full border border-[#c8e0cf] bg-white px-3 text-[12px] font-semibold text-[#1f5131] hover:bg-[#f7fbf7]">
                    {lastSaved.kind === "created" ? "Create another" : "Dismiss"}
                  </button>
                </div>
              </div>
            ) : null}

              <FormSection id="gig-step-basics" step={1} title="Basics" description="What the gig is and who it's for." complete={formChecklist.sections[0].complete}>
                <Field label="Title" required wide count={{ value: form.title.length, max: 90 }}>
                  <input className={inputCls} value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} placeholder="e.g., Reel Creator — Skincare" />
                </Field>
                <Field label="Company" required>
                  <input className={inputCls} value={form.company} onChange={(e) => {
                    const company = e.target.value;
                    if (isReelKitCompany(company) !== isReelKitCompany(form.company)) {
                      // A late kit upload must not follow a company change into another editing session.
                      editContext.current = { id: editingGig?.id ?? null };
                      if (kitUploadContext.current) {
                        kitUploadContext.current = null;
                        setMediaUploading(false);
                        setMediaUploadError(null);
                      }
                    }
                    setForm((prev) => ({ ...prev, company }));
                  }} placeholder="Business name" />
                </Field>
                <Field label="Location" hint="Most gigs are remote. Use a city for on-site work.">
                  <input className={inputCls} value={form.location} onChange={(e) => setForm((prev) => ({ ...prev, location: e.target.value }))} placeholder="Remote / Hybrid / City" list="gig-location-options" />
                  <datalist id="gig-location-options">
                    <option value="Remote" />
                    <option value="Hybrid" />
                    <option value="India" />
                  </datalist>
                </Field>
                <div className="min-w-0 sm:col-span-2">
                  <div className="mb-1.5 text-[12.5px] font-semibold text-slate-700">Platform</div>
                  <Segmented label="Platform" value={form.platform} options={PLATFORMS} onChange={(platform) => setForm((prev) => ({ ...prev, platform }))} />
                </div>
              </FormSection>

              <FormSection id="gig-step-pay" step={2} title="Pay & workload" description="Creators decide fast when the payout and effort are clear." complete={formChecklist.sections[1].complete}>
                <Field label={form.payoutType === "Per 1k Views" ? "Rate per 1,000 views" : "Payout"} required hint={form.payoutType === "Per 1k Views" ? "A positive amount, with up to two decimal places." : "Shown exactly as typed on the gig card."}>
                  <span className="relative block">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">₹</span>
                    <input
                      className={`${inputCls} pl-8`}
                      value={form.payout.replace(/^\s*₹\s*/, "")}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/^\s*₹\s*/, "");
                        // Numbers get the ₹ prefix; anything else ("$500", "Negotiable") is kept as typed.
                        setForm((prev) => ({ ...prev, payout: raw ? (/^\d/.test(raw) ? `₹${raw}` : raw) : "" }));
                      }}
                      inputMode="decimal"
                      placeholder="48,000"
                    />
                  </span>
                </Field>
                <Field label="Workload" required hint="e.g. 10 reels / month, 3 posts a week.">
                  <input className={inputCls} value={form.workload} onChange={(e) => setForm((prev) => ({ ...prev, workload: e.target.value }))} placeholder="e.g., 10 reels / month" />
                </Field>
                <div className="min-w-0 sm:col-span-2">
                  <div className="mb-1.5 text-[12.5px] font-semibold text-slate-700">Payout type</div>
                  <Segmented label="Payout type" value={form.payoutType} options={PAYOUTS} onChange={(payoutType) => setForm((prev) => ({ ...prev, payoutType }))} />
                  {form.payoutType === "Per 1k Views" ? <p className="mt-2 text-[12px] leading-5 text-[#5f6f65]">Enter the rate for 1,000 views. Earnings use available views on approved reels, including partial thousands. For example, ₹100 at 1,500 views gives ₹150. Reels awaiting review or view counts are shown separately.</p> : null}
                </div>
              </FormSection>

              <FormSection id="gig-step-type" step={3} title="Gig type & brief" description="The type decides which workflow creators get after they're accepted." complete={formChecklist.sections[2].complete}>
                <div role="radiogroup" aria-label="Gig type" className="grid gap-2 sm:col-span-2 sm:grid-cols-2 xl:grid-cols-3">
                  {GIG_TYPES.map((type) => {
                    const active = form.gigType === type;
                    return (
                      <button
                        key={type}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setForm((prev) => ({ ...prev, gigType: type }))}
                        className={`flex items-start gap-3 rounded-2xl border p-3.5 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#2f6655]/15 ${
                          active ? "border-[#1f4f43] bg-[#f3f8f4] shadow-[0_8px_20px_-12px_rgba(31,79,67,0.4)]" : "border-slate-200 bg-white hover:border-slate-300"
                        }`}
                      >
                        <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${active ? "border-[#1f4f43] bg-[#1f4f43]" : "border-slate-300"}`} aria-hidden>
                          {active ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[13.5px] font-semibold text-slate-900">{type}</span>
                          <span className="mt-0.5 block text-[11.5px] leading-snug text-slate-500">{GIG_TYPE_HINTS[type] ?? ""}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {form.gigType === "Custom" && (
                  <Field label="Custom gig type label" required wide>
                    <input className={inputCls} value={form.customGigType} onChange={(e) => setForm((prev) => ({ ...prev, customGigType: e.target.value }))} placeholder="e.g., Freelance Marketplace" />
                  </Field>
                )}
                {(form.gigType === "Custom" || form.gigType === "Project" || form.gigType === "Content Posting") && (
                  <Field
                    label={form.gigType === "Project" ? "Project brief" : form.gigType === "Content Posting" ? "Content posting brief" : "Custom brief"}
                    required
                    wide
                    count={{ value: form.customBrief.length }}
                    hint="Shown in the proposal desk. Plain text; new lines become paragraphs."
                  >
                    <textarea
                      className={`${textareaCls} min-h-[7.5rem]`}
                      value={form.customBrief}
                      onChange={(e) => setForm((prev) => ({ ...prev, customBrief: e.target.value }))}
                      placeholder={
                        form.gigType === "Project"
                          ? "Describe the project scope, client expectation, deliverables, and review process."
                          : form.gigType === "Content Posting"
                            ? "Describe posting cadence, content workflow, account expectations, and how daily execution starts after approval."
                            : "Describe the custom project scope, expectations, and decision criteria."
                      }
                    />
                  </Field>
                )}
                {(form.gigType === "Custom" || form.gigType === "Project" || form.gigType === "Content Posting") && (
                  <Field label="Detailed requirements" wide hint="One per line. Each line becomes a checklist item for creators.">
                    <textarea
                      className={`${textareaCls} min-h-[7rem]`}
                      value={form.customRequirements}
                      onChange={(e) => setForm((prev) => ({ ...prev, customRequirements: e.target.value }))}
                      placeholder={"Deliver 3 concepts in week 1\nDaily progress updates\nPortfolio examples required"}
                    />
                  </Field>
                )}
                {form.gigType === "Content Posting" && (
                  <Field
                    label={`${accountPlatformFor(form.platform).label} account setup`}
                    wide
                    count={{ value: form.accountInstructions.length, max: 2000 }}
                    hint={`After applying, creators make a fresh ${accountPlatformFor(form.platform).label} account and submit its login before screening. They always see the standard setup steps; add anything specific to this gig, one step per line.`}
                  >
                    <textarea
                      className={`${textareaCls} min-h-[6.5rem]`}
                      value={form.accountInstructions}
                      maxLength={2000}
                      onChange={(e) => setForm((prev) => ({ ...prev, accountInstructions: e.target.value }))}
                      placeholder={"Username format: brandname.city (e.g. glowco.pune)\nUse the logo from the brief as the profile photo\nBio: Daily skincare tips ✨ Link in bio"}
                    />
                  </Field>
                )}
                {form.gigType !== "Custom" && form.gigType !== "Project" && (
                  <Field label="Project brief" wide count={{ value: form.projectBrief.length }} hint="Shown before proposal submission.">
                    <textarea
                      className={`${textareaCls} min-h-[6.5rem]`}
                      value={form.projectBrief}
                      onChange={(e) => setForm((prev) => ({ ...prev, projectBrief: e.target.value }))}
                      placeholder="Describe project scope, expected outcomes, and execution context."
                    />
                  </Field>
                )}
                {form.gigType !== "Custom" && (
                  <Field label="Requirements" wide hint="Comma separated, e.g. 10k+ followers, 72h turnaround.">
                    <input className={inputCls} value={form.requirements} onChange={(e) => setForm((prev) => ({ ...prev, requirements: e.target.value }))} placeholder="e.g., 10k+ followers, 72h turnaround" />
                    {form.requirements.trim() ? (
                      <span className="mt-2 flex flex-wrap gap-1.5">
                        {form.requirements
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean)
                          .map((item, index) => (
                            <span key={`${item}-${index}`} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11.5px] font-medium text-slate-700">
                              {item}
                            </span>
                          ))}
                      </span>
                    ) : null}
                  </Field>
                )}
              </FormSection>

              <FormSection id="gig-step-media" step={4} title="Media" description="Show the work you want. Sample videos appear above the brief for every creator." complete={formChecklist.sections[3].complete}>
                <GigSampleVideosField
                  samples={form.sampleVideos}
                  onChange={(next) => setForm((prev) => ({ ...prev, sampleVideos: typeof next === "function" ? next(prev.sampleVideos) : next }))}
                  getToken={getAdminToken}
                  onBusyChange={setSamplesUploading}
                />
                {(form.gigType === "Custom" || form.gigType === "Project" || form.gigType === "Content Posting") && (
                  <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 sm:col-span-2 sm:p-4">
                    <label htmlFor="gig-brief-media-upload" className="text-xs font-semibold text-slate-700">Reference pictures &amp; files · after approval</label>
                    <p className="mt-0.5 text-[11px] text-slate-500">Upload the pictures creators should show in their reels, plus any reference videos. Approved creators see these in a gallery above their next steps.</p>
                  <input
                    id="gig-brief-media-upload"
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="mt-3 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 file:mr-3 file:rounded-md file:border-0 file:bg-[#edf5ef] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-[#2f6655]"
                    onChange={async (e) => {
                      const input = e.currentTarget;
                      const files = input.files;
                      await uploadCustomMediaFiles(files);
                      input.value = "";
                    }}
                    disabled={mediaUploading}
                  />
                  <div className="mt-2 text-[11px] text-slate-500">
                    Save the gig to share these files with approved creators. Public sample reels above remain separate.
                  </div>
                  {mediaUploadError && (
                    <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                      {mediaUploadError}
                    </div>
                  )}
                  {(() => {
                    const lines = parseCustomRequirementsText(form.customMedia);
                    const { assets: mediaAssets, examples, notes } = splitBriefMediaLines(lines);
                    const isVideoUrl = (url: string) => /\.(mp4|m4v|mov|webm|ogv)(?:[?#]|$)/i.test(url);
                    const fileLabel = (url: string) => {
                      const name = url.split("/").pop()?.split(/[?#]/)[0] ?? "";
                      try { return decodeURIComponent(name).replace(/^\d{13}-[a-z0-9]{6}-/i, ""); } catch { return name; }
                    };
                    const setMediaLines = (next: string[]) => setForm((prev) => ({ ...prev, customMedia: next.join("\n") }));
                    const thumb = (url: string, className: string) =>
                      isVideoUrl(url) ? (
                        <video src={`${url}#t=0.5`} preload="metadata" muted playsInline className={`${className} bg-slate-900 object-cover`} />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element -- admin preview of an uploaded file on any media host
                        <img src={url} alt="" className={`${className} bg-slate-100 object-cover`} />
                      );
                    return (
                      <div className="mt-3 space-y-2">
                        {mediaAssets.length === 0 && (
                          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                            No media uploaded yet.
                          </div>
                        )}
                        {mediaAssets.length > 0 ? (
                          <p className="text-[11px] text-slate-500">
                            Optional: add an <span className="font-semibold text-slate-700">in-reel example</span> for a picture, a 9:16 screenshot or short clip showing how it should appear in the reel. Creators see it in the &ldquo;In a reel&rdquo; view.
                          </p>
                        ) : null}
                        {mediaAssets.map((url, index) => {
                          const example = examples.get(url);
                          const uploadingExample = reelExampleUploadingFor === url;
                          const exampleInputId = `gig-reel-example-${index}`;
                          return (
                            <div key={url} className="flex min-w-0 flex-col gap-3 rounded-lg border border-slate-300 bg-slate-50 p-2.5 text-xs text-slate-700 sm:flex-row sm:flex-wrap sm:items-center">
                              <div className="flex min-w-0 flex-1 items-center gap-3">
                                {thumb(url, "h-14 w-14 shrink-0 rounded-md border border-slate-200")}
                                <div className="min-w-0 flex-1">
                                  <a href={url} target="_blank" rel="noreferrer" className="block truncate font-semibold text-[#2f6655] hover:underline">
                                    Asset {index + 1}
                                  </a>
                                  <div className="truncate text-[11px] text-slate-500">{fileLabel(url)}</div>
                                </div>
                                <button
                                  type="button"
                                  className="shrink-0 rounded-full border border-slate-300 px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:border-slate-400"
                                  onClick={() => setMediaLines(withReelExample(lines.filter((line) => line.trim() !== url), url, null))}
                                >
                                  Remove
                                </button>
                              </div>
                              {isVideoUrl(url) ? null : (
                                <div className="flex min-w-0 items-center gap-2 border-t border-slate-200 pt-2.5 sm:w-[15.5rem] sm:shrink-0 sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0">
                                  {example ? (
                                    <>
                                      {thumb(example.url, "h-14 w-8 shrink-0 rounded border border-slate-200")}
                                      <div className="min-w-0 flex-1">
                                        <div className="font-semibold text-slate-700">In-reel example</div>
                                        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
                                          <label htmlFor={exampleInputId} className="cursor-pointer font-semibold text-[#2f6655] hover:underline">{uploadingExample ? "Uploading…" : "Replace"}</label>
                                          <button type="button" onClick={() => setMediaLines(withReelExample(lines, url, null))} className="font-semibold text-slate-500 hover:text-rose-700">Remove</button>
                                        </div>
                                      </div>
                                    </>
                                  ) : (
                                    <label
                                      htmlFor={exampleInputId}
                                      className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#9cc3ad] bg-white px-3 text-[11.5px] font-semibold text-[#2f6655] hover:bg-[#edf5ef]"
                                    >
                                      {uploadingExample ? "Uploading example…" : "+ Add in-reel example"}
                                    </label>
                                  )}
                                  <input
                                    id={exampleInputId}
                                    type="file"
                                    accept="image/*,video/*"
                                    className="sr-only"
                                    aria-label={`In-reel example for asset ${index + 1}`}
                                    disabled={mediaUploading}
                                    onChange={async (e) => {
                                      const input = e.currentTarget;
                                      await uploadReelExample(url, input.files?.[0]);
                                      input.value = "";
                                    }}
                                  />
                                </div>
                              )}
                              <label className="block min-w-0 basis-full">
                                <span className="flex items-baseline justify-between gap-2 text-[11px] font-semibold text-slate-700">
                                  What should creators show?
                                  <span className="font-normal tabular-nums text-slate-400">{(notes.get(url) ?? "").length}/{MAX_ASSET_NOTE}</span>
                                </span>
                                <textarea
                                  rows={2}
                                  maxLength={MAX_ASSET_NOTE}
                                  value={notes.get(url) ?? ""}
                                  onChange={(e) => setMediaLines(withAssetNote(lines, url, e.target.value))}
                                  placeholder="e.g. Show the Approved earnings card for 2–3 seconds, then the payout breakdown."
                                  className="mt-1 w-full resize-y rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs leading-5 text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#2f6655] focus:ring-2 focus:ring-[#2f6655]/20"
                                />
                              </label>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                  {form.gigType === "Content Posting" && isReelKitCompany(form.company) ? (
                    <ReelKitEditor
                      key={editingGig?.id ?? "new-gig"}
                      company={form.company}
                      kit={parseCompanyReelKit(form.company, parseCustomRequirementsText(form.customMedia))}
                      onChange={(kit) => {
                        if (editContext.current.id !== (editingGig?.id ?? null)) return;
                        setForm((prev) => isReelKitCompany(prev.company) ? { ...prev, customMedia: withReelKit(parseCustomRequirementsText(prev.customMedia), kit).join("\n") } : prev);
                      }}
                      onUploadExample={uploadKitExample}
                      uploading={mediaUploading}
                    />
                  ) : null}
                  {mediaUploading && <div className="mt-2 text-xs font-semibold text-[#2f6655]">Uploading media...</div>}
                  </div>
                )}
              </FormSection>

              <FormSection id="gig-step-settings" step={5} title="Application settings" description="How creators apply, what they must complete first, and whether it's live." complete={formChecklist.sections[4].complete}>
                <div className="min-w-0 sm:col-span-2">
                  <div className="mb-1.5 text-[12.5px] font-semibold text-slate-700">Application flow</div>
                <div className="grid gap-3 md:grid-cols-2">
                  {[
                    {
                      value: "apply" as GigApplicationMode,
                      title: "Apply now",
                      description: "Show a direct application modal with consent confirmation, then push the candidate into recruiter screening.",
                    },
                    {
                      value: "proposal" as GigApplicationMode,
                      title: "Proposal required",
                      description: "Keep the detailed proposal desk and require timeline, budget, or cover-letter style submission before review.",
                    },
                  ].map((option) => {
                    const active = form.applicationMode === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setForm((prev) => ({ ...prev, applicationMode: option.value }))}
                        className={`rounded-2xl border px-4 py-4 text-left transition ${
                          active
                            ? "border-[#1f4f43] bg-[#edf5ef] shadow-[0_10px_24px_rgba(31,79,67,0.08)]"
                            : "border-slate-200 bg-white hover:border-slate-300"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-slate-900">{option.title}</div>
                          <span
                            className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold ${
                              active ? "border-[#1f4f43] bg-[#1f4f43] text-white" : "border-slate-300 bg-white text-transparent"
                            }`}
                          >
                            ✓
                          </span>
                        </div>
                        <div className="mt-2 text-[11px] leading-5 text-slate-500">{option.description}</div>
                      </button>
                    );
                  })}
                </div>
                  <p className="mt-2 text-[11.5px] text-slate-500">
                    Workers will see {form.applicationMode === "proposal" ? "the proposal desk" : "a corporate-style apply flow"} on Browse and Proceed.
                    {form.gigType === "Email Creator" ? " Email Creator gigs still use the direct activation workspace after KYC." : ""}
                  </p>
                </div>
                <SwitchRow
                  checked={form.onboardingRequired}
                  onChange={(onboardingRequired) => setForm((prev) => ({ ...prev, onboardingRequired }))}
                  title="Structured onboarding"
                  description="Workers complete the onboarding steps before workspace handoff."
                />
                <SwitchRow
                  checked={form.kycRequired}
                  onChange={(kycRequired) => setForm((prev) => ({ ...prev, kycRequired }))}
                  title="Require KYC approval"
                  description="Turn off for lighter gigs that any signed-in worker can unlock."
                />
                {form.gigType !== "Custom" && form.gigType !== "Project" && (
                  <>
                    <Field label="Hiring capacity">
                      <input className={inputCls} value={form.hiringCapacity} onChange={(e) => setForm((prev) => ({ ...prev, hiringCapacity: e.target.value }))} placeholder="e.g., 1 creator" />
                    </Field>
                    <Field label="Expertise">
                      <input className={inputCls} value={form.expertise} onChange={(e) => setForm((prev) => ({ ...prev, expertise: e.target.value }))} placeholder="e.g., Mid level" />
                    </Field>
                    <Field label="Languages" wide>
                      <input className={inputCls} value={form.languages} onChange={(e) => setForm((prev) => ({ ...prev, languages: e.target.value }))} placeholder="e.g., English, Hindi" />
                    </Field>
                  </>
                )}
                <div className="min-w-0 sm:col-span-2">
                  <div className="mb-1.5 text-[12.5px] font-semibold text-slate-700">Status</div>
                  <Segmented
                    label="Status"
                    value={form.status}
                    options={STATUSES}
                    onChange={(status) => setForm((prev) => ({ ...prev, status }))}
                    renderOption={(status) => (
                      <>
                        <span className={`h-2 w-2 rounded-full ${GIG_STATUS_DOT[status]}`} aria-hidden />
                        {status}
                      </>
                    )}
                  />
                </div>
              </FormSection>

              {formError && (
                <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] font-semibold text-rose-700">
                  {formError}
                </div>
              )}
            </div>

            {/* Sticky action bar: what's missing on the left, actions on the right */}
            <div className="sticky bottom-0 z-10 flex flex-col gap-3 rounded-b-3xl border-t border-slate-100 bg-white/95 px-4 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="min-w-0 text-[12.5px]">
                {formChecklist.missing.length ? (
                  <span className="text-slate-600">
                    <span className="font-semibold text-amber-700">{formChecklist.missing.length} required left:</span> {formChecklist.missing.join(", ")}
                  </span>
                ) : (
                  <span className="font-semibold text-[#1f5131]">✓ Ready to {editingGig ? "update" : "publish"}. Gigs go live in Browse instantly.</span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {editingGig && (
                  <button
                    type="button"
                    className="inline-flex h-11 flex-1 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:border-slate-400 sm:flex-none"
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
                        gigType: "Email Creator",
                        customGigType: "",
                        customBrief: "",
                        accountInstructions: "",
                        customRequirements: "",
                        customMedia: "",
                        sampleVideos: [] as GigSample[],
                        projectBrief: "",
                        hiringCapacity: "",
                        expertise: "",
                        languages: "",
                        applicationMode: "apply",
                        onboardingRequired: true,
                        kycRequired: true,
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
                  type="button"
                  className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#1f4f43] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#245a4b] disabled:opacity-60 sm:flex-none"
                  onClick={editingGig ? updateGig : createGig}
                  disabled={mediaUploading || samplesUploading}
                >
                  {mediaUploading || samplesUploading ? "Uploading media…" : editingGig ? "Update gig" : "Publish gig"}
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
                    <path d="M4.5 10h11M11 5.5l4.5 4.5-4.5 4.5" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* Sidebar: quick stats + recent gigs with shortcuts into the listings page */}
          <aside className="space-y-4 xl:sticky xl:top-20">
            {/* Live creator preview: how the Find gigs card will read, updated as the form changes */}
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-900">Creator preview</div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#eef6ec] px-2 py-0.5 text-[11px] font-semibold text-[#2e7d4f]">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#2e7d4f] motion-reduce:animate-none" aria-hidden />
                  Live
                </span>
              </div>
              <div className="mt-4 overflow-hidden rounded-2xl border border-[#e3e5e1] bg-white shadow-[0_1px_2px_rgba(26,32,28,0.06)]">
                <div className="p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#e3e5e1] bg-[#fafbf9] text-[13px] font-bold text-[#2b5d4a]">
                      {(form.company.trim() || "?").slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-semibold text-[#20352c]">{form.company.trim() || "Company name"}</div>
                      <div className="truncate text-[12px] text-[#6f7d74]">
                        {form.platform}
                        {form.location.trim() && form.location.trim() !== "Remote" ? ` · ${form.location.trim()}` : ""}
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${form.status === "Open" ? "bg-[#e3f1df] text-[#1f5131]" : "bg-slate-100 text-slate-600"}`}>
                      {form.status === "Open" ? "Hiring" : form.status}
                    </span>
                  </div>
                  <div className={`mt-3 line-clamp-2 text-[16px] font-semibold leading-snug ${form.title.trim() ? "text-[#20352c]" : "text-slate-300"}`}>{form.title.trim() || "Your gig title appears here"}</div>
                  <div className="mt-1 line-clamp-2 text-[12.5px] text-[#5f6f65]">
                    {(form.gigType === "Custom" || form.gigType === "Project" || form.gigType === "Content Posting" ? form.customBrief : form.projectBrief).trim().split(/\n+/)[0] ||
                      `${form.company.trim() || "The brand"} is looking for ${form.platform} creators.`}
                  </div>
                </div>
                <div className="border-t border-[#ebedea] bg-[#fafbf9] px-4 py-3">
                  <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#7a877f]">Payout</div>
                  <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
                    <span className={`text-[19px] font-bold tracking-[-0.02em] ${form.payout.trim() ? "text-[#20352c]" : "text-slate-300"}`}>{form.payout.trim() || "₹—"}</span>
                    <span className="text-[12px] text-[#5f6f65]">{form.payoutType}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
                    {form.workload.trim() ? <span className="rounded-full bg-white px-2 py-0.5 text-[#4d5f55] shadow-[0_0_0_1px_#e3e5e1]">{form.workload.trim()}</span> : null}
                    <span className="rounded-full bg-[#f0f4ec] px-2 py-0.5 text-[#4d5f55]">{form.gigType === "Custom" ? form.customGigType.trim() || "Custom" : form.gigType}</span>
                    {form.sampleVideos.length ? <span className="rounded-full bg-[#e3f1df] px-2 py-0.5 text-[#1f5131]">▶ {form.sampleVideos.length} {form.sampleVideos.length === 1 ? "sample" : "samples"}</span> : null}
                    {form.kycRequired ? <span className="rounded-full bg-white px-2 py-0.5 text-[#4d5f55] shadow-[0_0_0_1px_#e3e5e1]">KYC</span> : null}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-900">Marketplace</div>
                <Link href={adminSectionHref("gig-listings")} className="text-xs font-semibold text-[#2f6655] hover:underline">
                  Manage listings →
                </Link>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {[
                  { label: "Open gigs", value: gigStatusCounts.Open, href: adminSectionHref("gig-listings") },
                  { label: "Applications", value: apps.length, href: adminSectionHref("applications") },
                  { label: "Accepted", value: apps.filter((a) => a.status === "Accepted").length, href: adminSectionHref("applications") },
                  { label: "Pending review", value: apps.filter((a) => a.status === "Applied" || a.status === "Pending").length, href: adminSectionHref("applications") },
                ].map((stat) => (
                  <Link key={stat.label} href={stat.href} className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 transition hover:border-slate-300 hover:bg-white">
                    <div className="text-[11.5px] text-slate-500">{stat.label}</div>
                    <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{stat.value}</div>
                  </Link>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-900">Recent gigs</div>
                <span className="text-xs text-slate-500">{gigs.length} total</span>
              </div>
              {gigs.length === 0 ? (
                <div className="mt-3 rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500">Your published gigs will show up here.</div>
              ) : (
                <ul className="mt-3 divide-y divide-slate-100">
                  {gigs.slice(0, 5).map((gig) => (
                    <li key={gig.id} className="flex items-center gap-3 py-2.5">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${GIG_STATUS_DOT[gig.status] ?? "bg-slate-400"}`} title={gig.status} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-slate-900">{gig.title}</div>
                        <div className="truncate text-[11.5px] text-slate-500">
                          {gig.company} · {applicantsByGig.get(gig.id) ?? 0} {(applicantsByGig.get(gig.id) ?? 0) === 1 ? "applicant" : "applicants"}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          startEdit(gig);
                        }}
                        className="shrink-0 rounded-full border border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-slate-400"
                      >
                        Edit
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                href={adminSectionHref("gig-listings")}
                className="mt-3 flex h-9 items-center justify-center rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                View all listings
              </Link>
            </div>
          </aside>
        </section>
        )}

        {view === "gig-listings" && (
        <section className="space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-[#1a201c] sm:text-[22px]">Gig listings</h1>
              <p className="mt-0.5 max-w-[70ch] text-[13px] text-[#616a64]">
                <span className="font-semibold text-[#1a201c]">{gigs.length}</span> gigs · {gigStatusCounts.Open} open · {pinnedGigs.length} pinned in Browse
                <span className="hidden sm:inline"> · status, flow, pins and edits in one place</span>
              </p>
            </div>
            <Link
              href={adminSectionHref("create-new-gig")}
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[10px] bg-[#1f2b24] px-4 text-[13.5px] font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition hover:bg-[#2b3a31]"
            >
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4" aria-hidden>
                <path d="M10 4.5v11M4.5 10h11" />
              </svg>
              New gig
            </Link>
          </div>
          <div className="space-y-4">
            {/* Browse spotlight: compact, collapsible strip of pinned gigs */}
            <section aria-labelledby="spotlight-title" className="rounded-2xl border border-[#d4e3d8] bg-[linear-gradient(135deg,#f7fbf8,#eff6f1)] p-3 sm:p-4">
              <div className="flex items-center gap-3">
                <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#1f4f43] text-[15px] text-[#aef07f]">★</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h2 id="spotlight-title" className="text-[14px] font-semibold text-[#1a201c]">Browse spotlight</h2>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[#2f6655] shadow-[0_0_0_1px_#d4e3d8]">{pinnedGigs.length}/6 slots</span>
                    {pinnedGigs.length ? (
                      <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[#4b544e] shadow-[0_0_0_1px_#e3e5e1]">
                        {pinnedGigs.filter(({ gig }) => gig.status === "Open").length} open
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 hidden truncate text-[12px] text-[#5f766e] sm:block">Pinned gigs show first in creators&apos; Find gigs feed, with an optional label.</p>
                </div>
                {pinnedGigs.length ? (
                  <button
                    type="button"
                    onClick={() => setSpotlightCollapsed((v) => !v)}
                    aria-expanded={!spotlightCollapsed}
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[12.5px] font-semibold text-[#2f6655] transition hover:bg-white"
                  >
                    {spotlightCollapsed ? "Show" : "Hide"}
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`h-3.5 w-3.5 transition-transform ${spotlightCollapsed ? "" : "rotate-180"}`} aria-hidden>
                      <path d="m5 8 5 5 5-5" />
                    </svg>
                  </button>
                ) : null}
              </div>

              {browseControlNotice && (
                <div
                  role="status"
                  className={`mt-3 rounded-xl border px-3 py-2 text-[12.5px] ${
                    browseControlNotice.tone === "success" ? "border-[#c8d8cf] bg-white text-[#355c4f]" : "border-rose-200 bg-rose-50 text-rose-700"
                  }`}
                >
                  {browseControlNotice.text}
                </div>
              )}

              {pinnedGigs.length === 0 ? (
                <p className="mt-2.5 text-[12.5px] text-[#5f766e]">No gigs pinned yet. Use <span className="font-semibold text-[#1f4f43]">Pin</span> on any listing below to feature it.</p>
              ) : spotlightCollapsed ? null : (
                <ol className="dashboard-chip-scroller -mx-3 mt-3 flex snap-x gap-2.5 overflow-x-auto px-3 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-3">
                  {pinnedGigs.map(({ gig, spotlight }) => {
                    const saving = browseControlSavingId === gig.id;
                    return (
                      <li key={gig.id} className="w-[82%] shrink-0 snap-start rounded-xl border border-[#d7e2da] bg-white p-3 shadow-[0_1px_2px_rgba(26,32,28,0.05)] sm:w-auto">
                        <div className="flex items-start gap-2.5">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#e3f1df] text-[12px] font-bold text-[#1f5131]" title="Spotlight slot">
                            {spotlight.pinRank ?? "–"}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-semibold text-[#1a201c]" title={gig.title}>
                              {gig.title}
                            </div>
                            <div className="flex items-center gap-1.5 truncate text-[11.5px] text-[#7a827c]">
                              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${GIG_STATUS_DOT[gig.status] ?? "bg-slate-400"}`} aria-hidden />
                              {gig.status} · {gig.company}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleGigPinned(gig)}
                            disabled={saving}
                            aria-label={`Unpin ${gig.title}`}
                            title="Unpin"
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[#7a827c] transition hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
                          >
                            {saving ? (
                              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
                            ) : (
                              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden>
                                <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />
                              </svg>
                            )}
                          </button>
                        </div>
                        <div className="mt-2.5 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
                          <select
                            aria-label={`Spotlight slot for ${gig.title}`}
                            className="h-8 rounded-lg border border-[#d4e3d8] bg-white px-2 text-[12.5px] font-semibold text-slate-700 outline-none focus:border-[#2f6655] focus:ring-2 focus:ring-[#2f6655]/15"
                            value={String(spotlight.pinRank ?? 1)}
                            onChange={(e) =>
                              updateGigBrowseSpotlight(gig, {
                                pinned: true,
                                pinRank: Number.parseInt(e.target.value, 10) || 1,
                              })
                            }
                            disabled={saving}
                          >
                            {[1, 2, 3, 4, 5, 6].map((slot) => (
                              <option key={slot} value={slot}>
                                Slot {slot}
                              </option>
                            ))}
                          </select>
                          <input
                            className="h-8 min-w-0 rounded-lg border border-[#d4e3d8] bg-white px-2.5 text-[12.5px] text-slate-700 outline-none focus:border-[#2f6655] focus:ring-2 focus:ring-[#2f6655]/15"
                                aria-label={`Spotlight label for ${gig.title}`}
                            value={spotlight.pinLabel}
                            placeholder="Pinned by admin"
                            onChange={(e) =>
                              setGigs((prev) => {
                                const next = prev.map((item) =>
                                  item.id === gig.id
                                    ? {
                                        ...item,
                                        requirements: mergeBrowseSpotlightConfig(item.requirements, {
                                          pinLabel: e.target.value,
                                          pinned: true,
                                          pinRank: spotlight.pinRank ?? 1,
                                        }),
                                      }
                                    : item
                                );
                                writeLS(LS_KEYS.GIGS, next);
                                return next;
                              })
                            }
                            onBlur={(e) =>
                              updateGigBrowseSpotlight(gig, {
                                pinned: true,
                                pinRank: spotlight.pinRank ?? 1,
                                pinLabel: e.target.value,
                              })
                            }
                            disabled={browseControlSavingId === gig.id}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>

            {/* Toolbar: status filters on the left, search + sort on the right (stacks on phones) */}
            <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
              <div role="tablist" aria-label="Filter gigs by status" className="dashboard-chip-scroller -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
              {(["All", ...STATUSES] as const).map((status) => {
                const active = gigStatusFilter === status;
                const count = status === "All" ? gigs.length : gigStatusCounts[status];
                return (
                  <button
                    key={status}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setGigStatusFilter(status)}
                    className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold transition ${
                      active ? "border-[#1f2b24] bg-[#1f2b24] text-white" : "border-[#e3e5e1] bg-white text-[#4b544e] hover:border-[#cfd5cf]"
                    }`}
                  >
                    {status !== "All" ? <span className={`h-1.5 w-1.5 rounded-full ${GIG_STATUS_DOT[status]}`} aria-hidden /> : null}
                    {status}
                    <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${active ? "bg-white/15" : "bg-[#f1f3f0] text-[#616a64]"}`}>{count}</span>
                  </button>
                );
              })}
              </div>
              <div className="flex items-center gap-2">
                <label className="relative min-w-0 flex-1 lg:w-64 lg:flex-none">
                  <span className="sr-only">Search gigs</span>
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a928c]" aria-hidden>
                    <circle cx="9" cy="9" r="5.5" />
                    <path d="m13.2 13.2 3.3 3.3" />
                  </svg>
                  <input
                    type="search"
                    value={gigQuery}
                    onChange={(e) => setGigQuery(e.target.value)}
                    placeholder="Search gigs"
                    className="h-9 w-full rounded-[10px] border border-[#d9ddd8] bg-white pl-9 pr-3 text-[16px] text-[#1a201c] outline-none transition placeholder:text-[#8a928c] focus:border-[#7fa58c] focus:ring-2 focus:ring-[#2e7d4f]/20 sm:text-[13px]"
                  />
                </label>
                <select
                  value={gigSort}
                  onChange={(e) => setGigSort(e.target.value as typeof gigSort)}
                  aria-label="Sort gigs"
                  className="h-9 w-[8.5rem] shrink-0 rounded-[10px] border border-[#d9ddd8] bg-white px-3 text-[13px] font-semibold sm:w-auto text-[#1a201c] outline-none focus:border-[#7fa58c] focus:ring-2 focus:ring-[#2e7d4f]/20"
                >
                  <option value="recent">Newest first</option>
                  <option value="title">Title A–Z</option>
                  <option value="payout">Highest payout</option>
                  <option value="applicants">Most applicants</option>
                </select>
              </div>
            </div>

            {loading && (
              <div className="mt-4 space-y-3" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-28 animate-pulse rounded-2xl border border-[#e3e5e1] bg-[#f6f7f5]" />
                ))}
              </div>
            )}
            {!loading && visibleGigs.length === 0 && (
              <div className="mt-4 rounded-2xl border border-dashed border-[#d9ddd8] bg-[#fafbf9] px-4 py-10 text-center">
                <div className="text-[14px] font-semibold text-[#1a201c]">{gigs.length ? "No gigs match these filters" : "No gigs yet"}</div>
                <p className="mt-1 text-[12.5px] text-[#616a64]">{gigs.length ? "Try another status or search term." : "Use New gig to publish your first one."}</p>
                {gigs.length ? (
                  <button type="button" onClick={() => { setGigQuery(""); setGigStatusFilter("All"); }} className="mt-3 rounded-full border border-[#d9ddd8] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[#1a201c] hover:border-[#cfd5cf]">
                    Clear filters
                  </button>
                ) : null}
              </div>
            )}

            <ul className="mt-4 space-y-3">
              {visibleGigs.map((gig) => {
                const spotlight = readBrowseSpotlightConfig(gig.requirements);
                const applicationMode = normalizeGigApplicationMode(gig);
                const kycRequired = readProjectFieldsFromRequirements(gig.requirements).kycRequired;
                const sampleCount = parseGigSamples(gig.requirements).length;
                const applicantCount = applicantsByGig.get(gig.id) ?? 0;
                const saving = browseControlSavingId === gig.id;
                return (
                  <li
                    key={gig.id}
                    className={`relative overflow-hidden rounded-2xl border bg-white shadow-[0_1px_2px_rgba(26,32,28,0.05)] transition hover:shadow-[0_6px_18px_-10px_rgba(26,32,28,0.25)] ${
                      spotlight.pinned ? "border-[#b9d5c0]" : "border-[#e3e5e1]"
                    }`}
                  >
                    {spotlight.pinned ? <span className="absolute inset-x-0 top-0 h-[3px] bg-[#2e7d4f]" aria-hidden /> : null}
                    <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                      {/* Identity + facts */}
                      <div className="flex min-w-0 gap-3">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#e3e5e1] bg-[#f4f7f2] text-[13px] font-bold text-[#2b5d4a]" aria-hidden>
                          {(gig.company || "?").trim().slice(0, 2).toUpperCase()}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <h3 className="min-w-0 text-[14.5px] font-semibold leading-snug text-[#1a201c] sm:text-[15px]">{gig.title}</h3>
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f1f3f0] px-2 py-0.5 text-[11px] font-semibold text-[#4b544e]">
                              <span className={`h-1.5 w-1.5 rounded-full ${GIG_STATUS_DOT[gig.status] ?? "bg-[#8a928c]"}`} aria-hidden />
                              {gig.status}
                            </span>
                            {spotlight.pinned ? (
                              <span className="rounded-full bg-[#e3f1df] px-2 py-0.5 text-[11px] font-semibold text-[#1f5131]">
                                ★ Pinned{spotlight.pinRank ? ` · slot ${spotlight.pinRank}` : ""}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-0.5 truncate text-[12.5px] text-[#616a64]">
                            {gig.company} · {gig.platform}
                            {gig.postedAt ? ` · ${formatPostedLabel(gig.postedAt)}` : ""}
                            {spotlight.pinned && spotlight.pinLabel ? <span className="text-[#2e7d4f]"> · {spotlight.pinLabel}</span> : null}
                          </div>
                          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11.5px] font-medium text-[#4b544e]">
                            <span className="rounded-md bg-[#eef6ec] px-2 py-0.5 font-bold text-[#1f5131]">
                              {gig.payout}
                              {gig.payoutType ? <span className="font-medium text-[#41695b]"> · {gig.payoutType}</span> : null}
                            </span>
                            {[gig.location, gig.workload, gig.gigType ? formatGigTypeLabel(gig.gigType) : "", applicationMode === "proposal" ? "Proposal flow" : "Apply flow", kycRequired ? "KYC required" : "KYC optional"]
                              .filter(Boolean)
                              .map((chip) => (
                                <span key={chip} className="rounded-md border border-[#e3e5e1] bg-[#fafbf9] px-2 py-0.5">
                                  {chip}
                                </span>
                              ))}
                            <Link
                              href={adminSectionHref("applications", { gig: gig.id })}
                              className="rounded-md border border-[#d6e3f5] bg-[#f3f7fd] px-2 py-0.5 font-semibold text-[#2a5b9b] hover:border-[#b9cdea]"
                              title="Open this gig's applications"
                            >
                              {applicantCount} {applicantCount === 1 ? "applicant" : "applicants"} →
                            </Link>
                            {sampleCount ? (
                              <span className="rounded-md bg-[#e3f1df] px-2 py-0.5 font-semibold text-[#1f5131]">▶ {sampleCount} {sampleCount === 1 ? "sample" : "samples"}</span>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      {/* Primary actions */}
                      <div className="flex gap-2 sm:pl-14 md:hidden lg:flex lg:justify-end lg:pl-0">
                        <Link
                          href={adminSectionHref("create-new-gig", { edit: gig.id })}
                          className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-[#1f2b24] px-4 text-[13px] font-semibold text-white transition hover:bg-[#2b3a31] sm:flex-none"
                        >
                          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
                            <path d="m12.5 4.5 3 3L7 16H4v-3l8.5-8.5Z" />
                          </svg>
                          Edit
                        </Link>
                        <button
                          type="button"
                          onClick={() => deleteGig(gig.id)}
                          aria-label={`Remove ${gig.title}`}
                          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[10px] border border-[#f1d1cc] bg-white px-3 text-[13px] font-semibold text-[#b42318] transition hover:bg-[#fff5f3]"
                        >
                          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
                            <path d="M4 6h12M8 6V4.5h4V6M6 6l.7 9.2a1.5 1.5 0 0 0 1.5 1.3h3.6a1.5 1.5 0 0 0 1.5-1.3L14 6" />
                          </svg>
                          <span className="hidden sm:inline">Remove</span>
                        </button>
                      </div>
                    </div>

                    {/* Controls: compact labelled pills in one row (2×2 grid on phones) */}
                    <div className="grid grid-cols-2 gap-2 border-t border-[#ebedea] bg-[#fafbf9] px-4 py-2.5 sm:px-5 md:flex md:flex-nowrap md:items-center lg:flex-wrap">
                      <label className={pillClass}>
                        <span className="shrink-0 text-[#8a928c]">Status</span>
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${GIG_STATUS_DOT[gig.status] ?? "bg-slate-400"}`} aria-hidden />
                        <select className={pillSelectClass} value={gig.status} onChange={(e) => updateGigStatus(gig.id, e.target.value as GigStatus)} aria-label={`Status for ${gig.title}`}>
                          {STATUSES.map((status) => (
                            <option key={status}>{status}</option>
                          ))}
                        </select>
                        <PillChevron />
                      </label>
                      <label className={pillClass}>
                        <span className="shrink-0 text-[#8a928c]">Type</span>
                        <select className={pillSelectClass} value={normalizeGigType(gig.gigType)} onChange={(e) => updateGigType(gig.id, e.target.value as GigType)} aria-label={`Type for ${gig.title}`}>
                          {[...new Set([...GIG_TYPES, normalizeGigType(gig.gigType)])].map((type) => (
                            <option key={type}>{type}</option>
                          ))}
                        </select>
                        <PillChevron />
                      </label>
                      <label className={pillClass}>
                        <span className="shrink-0 text-[#8a928c]">Flow</span>
                        <select className={pillSelectClass} value={applicationMode} onChange={(e) => updateGigApplicationMode(gig, e.target.value as GigApplicationMode)} aria-label={`Application flow for ${gig.title}`}>
                          <option value="apply">Apply now</option>
                          <option value="proposal">Proposal required</option>
                        </select>
                        <PillChevron />
                      </label>
                      <div className={`${pillClass.replace("pl-2.5", "")} gap-0 md:shrink-0`}>
                        <button
                          type="button"
                          onClick={() => toggleGigPinned(gig)}
                          disabled={saving}
                          aria-pressed={spotlight.pinned}
                          aria-label={spotlight.pinned ? `Unpin ${gig.title} from Browse` : `Pin ${gig.title} in Browse`}
                          title={spotlight.pinned ? "Pinned in Browse (click to unpin)" : "Pin in Browse"}
                          className={`flex h-full shrink-0 items-center gap-1 border-r border-[#e3e5e1] px-2.5 font-semibold transition disabled:opacity-60 ${
                            spotlight.pinned ? "bg-[#e3f1df] text-[#1f5131]" : "text-[#1a201c] hover:bg-[#f4f7f2]"
                          }`}
                        >
                          {saving ? (
                            "…"
                          ) : (
                            <>
                              <span aria-hidden>{spotlight.pinned ? "★" : "☆"}</span>
                              <span className="hidden sm:inline md:hidden lg:inline">{spotlight.pinned ? "Pinned" : "Pin"}</span>
                            </>
                          )}
                        </button>
                        <select
                          aria-label={`Browse pin slot for ${gig.title}`}
                          className={`${pillSelectClass} pl-2`}
                          value={String(spotlight.pinRank ?? getNextBrowsePinRank())}
                          onChange={(e) =>
                            updateGigBrowseSpotlight(gig, {
                              pinned: true,
                              pinRank: Number.parseInt(e.target.value, 10) || 1,
                              pinLabel: spotlight.pinLabel || "Pinned by admin",
                            })
                          }
                          disabled={saving}
                        >
                          {[1, 2, 3, 4, 5, 6].map((slot) => (
                            <option key={slot} value={slot}>
                              Slot {slot}
                            </option>
                          ))}
                        </select>
                        <PillChevron />
                      </div>
                      {/* Tablets: actions join the control row instead of taking their own line */}
                      <div className="ml-auto hidden shrink-0 items-center gap-1.5 md:flex lg:hidden">
                        <Link
                          href={adminSectionHref("create-new-gig", { edit: gig.id })}
                          className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-[#1f2b24] px-3 text-[12.5px] font-semibold text-white transition hover:bg-[#2b3a31]"
                        >
                          Edit
                        </Link>
                        <button
                          type="button"
                          onClick={() => deleteGig(gig.id)}
                          aria-label={`Remove ${gig.title}`}
                          title="Remove"
                          className="grid h-9 w-9 place-items-center rounded-[10px] border border-[#f1d1cc] bg-white text-[#b42318] transition hover:bg-[#fff5f3]"
                        >
                          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
                            <path d="M4 6h12M8 6V4.5h4V6M6 6l.7 9.2a1.5 1.5 0 0 0 1.5 1.3h3.6a1.5 1.5 0 0 0 1.5-1.3L14 6" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
        )}

        {view === "applications" && (
          <section className="space-y-4 sm:space-y-5">
            {/* Header */}
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-[#1a201c] sm:text-[22px]">Applications</h1>
                <p className="mt-0.5 max-w-[70ch] text-[13px] text-[#616a64]">
                  Review applications from current workers, send updates in bulk and automate follow-ups.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="h-9 min-w-0 flex-1 rounded-[10px] border bg-[#fff] px-3 text-[13px] font-medium sm:w-60 sm:flex-none"
                  value={selectedGigId}
                  onChange={(e) => {
                    setSelectedGigId(e.target.value as string);
                    setSelectedApplicationIds([]);
                  }}
                  aria-label="Filter by gig"
                >
                  <option value="All">All gigs</option>
                  {gigs.map((gig) => (
                    <option key={gig.id} value={gig.id}>
                      {gig.title}
                    </option>
                  ))}
                </select>
                <button type="button" className={btnGhost} onClick={() => setAppDrawer("message")}>
                  <Icon d={ICONS.chat} />
                  <span className="hidden sm:inline">Templates</span>
                </button>
                <button type="button" className={`${btnGhost} relative`} onClick={() => setAppDrawer("automation")}>
                  <Icon d="M11 2.5 4.5 11H10l-1 6.5L15.5 9H10l1-6.5Z" />
                  Automations
                  {automation.autoCount > 0 && (
                    <span className="ml-0.5 inline-flex items-center gap-1 rounded-[999px] bg-[#ebf5ee] px-1.5 text-[11px] font-semibold leading-[18px] text-[#226b40]">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#2e7d4f]" />
                      {automation.autoCount} live
                    </span>
                  )}
                </button>
                <button type="button" className={`${btnGhost} px-2.5`} onClick={() => void refreshApps()} disabled={appsRefreshing} aria-label="Refresh applications" title={appsSyncedAt ? `Synced ${formatRelative(appsSyncedAt)}` : "Refresh"}>
                  <Icon d={ICONS.refresh} className={`h-4 w-4 ${appsRefreshing ? "motion-safe:animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            {/* KPI strip */}
            <div className="grid grid-cols-3 gap-1.5 sm:gap-2.5 xl:grid-cols-6">
              {[
                { label: "Total", value: String(appsForGig.length), caption: `${proposalApps.length} proposals`, dot: "bg-[#8a928c]", filter: "All" as const },
                { label: "Awaiting", value: String(applicationStatusCounts.Pending + applicationStatusCounts.Applied), caption: "Pending + applied", dot: "bg-[#e29a1b]", filter: "Pending" as const },
                { label: "Approved", value: String(applicationStatusCounts.Accepted), caption: "Accepted", dot: "bg-[#2e7d4f]", filter: "Accepted" as const },
                { label: "Rejected", value: String(applicationStatusCounts.Rejected), caption: "Needs changes", dot: "bg-[#d4483b]", filter: "Rejected" as const },
                {
                  label: "Approval rate",
                  value: appsForGig.length > 0 ? `${Math.round((applicationStatusCounts.Accepted / appsForGig.length) * 100)}%` : "0%",
                  caption: "Of all applications",
                  dot: "bg-[#2a78d6]",
                  filter: null,
                },
                {
                  label: "Invited",
                  value: String(appsForGig.filter((app) => app.proposal?.whatsappLink?.trim()).length),
                  caption: `${appsForGig.filter((app) => app.proposal?.groupJoinedConfirmed).length} joined group`,
                  dot: "bg-[#2e7d4f]",
                  filter: null,
                },
              ].map((tile) => {
                const active = tile.filter && applicationStatusFilter === tile.filter;
                const body = (
                  <>
                    <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-[#616a64] sm:text-[12px]">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tile.dot}`} aria-hidden="true" />
                      <span className="truncate">{tile.label}</span>
                    </span>
                    <span className="mt-1 block text-[19px] font-semibold leading-none tabular-nums text-[#1a201c] sm:text-[22px]">{tile.value}</span>
                    <span className="mt-1 hidden truncate text-[11.5px] text-[#8a928c] sm:block">{tile.caption}</span>
                  </>
                );
                const shell = `min-w-0 rounded-[12px] border bg-[#fff] px-2.5 py-2 text-left sm:rounded-[14px] sm:px-3.5 sm:py-3 ${
                  active ? "border-[#1f2b24] shadow-[0_0_0_1px_#1f2b24]" : "border-[#e3e5e1]"
                }`;
                return tile.filter ? (
                  <button
                    key={tile.label}
                    type="button"
                    aria-pressed={!!active}
                    onClick={() => {
                      setApplicationStatusFilter(tile.filter);
                      setSelectedApplicationIds([]);
                    }}
                    className={`${shell} transition hover:border-[#c9cec8]`}
                  >
                    {body}
                  </button>
                ) : (
                  <div key={tile.label} className={shell}>
                    {body}
                  </div>
                );
              })}
            </div>

            {applicationNotice && (
              <Banner tone={applicationNotice.tone} onDismiss={() => setApplicationNotice(null)}>
                {applicationNotice.text}
              </Banner>
            )}

            <span role="status" className="sr-only">{appsRefreshing ? "Refreshing applications…" : ""}</span>
            <div aria-busy={appsRefreshing} className="grid gap-4 xl:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] 2xl:grid-cols-[380px_minmax(0,1fr)]">
              {/* Queue */}
              <div className="relative min-w-0 self-start rounded-[16px] border border-[#e3e5e1] bg-[#fff] shadow-[0_1px_2px_rgba(26,32,28,0.05)] xl:sticky xl:top-20">
                {appsRefreshing && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden rounded-t-[16px] bg-[#ebf5ee]"><div className={loadingStyles.progress} /></div>}
                <div className="space-y-2.5 border-b border-[#eef0ec] p-3">
                  <div className="flex items-center gap-2.5 px-1">
                    <SelectAllCheckbox
                      checked={allFilteredSelected}
                      indeterminate={selectedFilteredApplications.length > 0}
                      onChange={toggleSelectAllFilteredApplications}
                      label="Select all applications in view"
                    />
                    <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[#1a201c]">
                      Queue{" "}
                      <span className="font-normal text-[#7a827c]">
                        · {selectedFilteredApplications.length ? `${selectedFilteredApplications.length} of ${filteredApps.length}` : filteredApps.length}
                      </span>
                    </h2>
                    <SmartSelectMenu apps={filteredApps} selectedIds={selectedApplicationIds} onSelect={setSelectedApplicationIds} />
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <label className="relative block min-w-0">
                      <span className="sr-only">Search queue</span>
                      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8a928c]">
                        <Icon d={ICONS.search} />
                      </span>
                      <input
                        type="search"
                        className={`${fieldClass} h-9 pl-8`}
                        value={applicationQueueQuery}
                        onChange={(e) => setApplicationQueueQuery(e.target.value)}
                        placeholder="Search worker, gig, proposal"
                      />
                    </label>
                    <select
                      className="h-9 rounded-[10px] border bg-[#fff] px-2 text-[13px] font-medium"
                      value={applicationQueueSort}
                      onChange={(e) => setApplicationQueueSort(e.target.value as typeof applicationQueueSort)}
                      aria-label="Sort queue"
                    >
                      <option value="latest">Latest</option>
                      <option value="oldest">Oldest</option>
                      <option value="worker_asc">Worker A–Z</option>
                      <option value="gig_asc">Gig A–Z</option>
                    </select>
                  </div>
                  <div className="dashboard-chip-scroller -mx-1 flex gap-1 overflow-x-auto px-1" role="tablist" aria-label="Filter by status">
                    {(["All", "Applied", "Pending", "Accepted", "Rejected", "Withdrawn"] as const).map((status) => {
                      const count = status === "All" ? appsForGig.length : applicationStatusCounts[status as ApplicationStatus];
                      const active = applicationStatusFilter === status;
                      return (
                        <button
                          key={status}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[8px] px-2 text-[12px] font-semibold transition ${
                            active ? "bg-[#1f2b24] text-[#fff]" : "text-[#4b544e] hover:bg-[#f1f3f0]"
                          }`}
                          onClick={() => {
                            setApplicationStatusFilter(status);
                            setSelectedApplicationIds([]);
                          }}
                        >
                          {status}
                          <span className={`rounded-[999px] px-1.5 text-[10.5px] leading-[16px] tabular-nums ${active ? "bg-[#fff]/20" : "bg-[#eef0ed]"}`}>{count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {filteredApps.length === 0 ? (
                  <div className="px-4 py-10 text-center">
                    <div className="text-[13.5px] font-semibold text-[#1a201c]">{appsForGig.length === 0 ? "No applications yet" : "Nothing matches"}</div>
                    <p className="mt-1 text-[12.5px] text-[#7a827c]">{appsForGig.length === 0 ? "Applications for your gigs show up here." : "Try another status, gig or search."}</p>
                  </div>
                ) : (
                  <div className="space-y-1 p-2 xl:max-h-[calc(100dvh-260px)] xl:overflow-y-auto xl:overscroll-contain">
                      {filteredApps.map((app) => {
                        const relatedGig = gigById.get(String(app.gigId));
                        const active = selectedApplication?.id === app.id;
                        const checked = selectedApplicationIds.includes(app.id);
                        const name = app.workerName ?? app.workerId;
                        return (
                          <div
                            key={app.id}
                            data-queue-app={app.id}
                            className={`group relative flex gap-2.5 rounded-[12px] border px-3 py-2.5 transition ${
                              active
                                ? "border-[#1f2b24] bg-[#f7f8f6] shadow-[inset_3px_0_0_#1f2b24]"
                                : checked
                                  ? "border-[#c9e3d2] bg-[#f5faf6]"
                                  : "border-transparent hover:border-[#e3e5e1] hover:bg-[#fafbf9]"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleApplicationSelection(app.id)}
                              className="relative z-10 mt-1 h-4 w-4 shrink-0 rounded"
                              aria-label={`Select ${name}`}
                            />
                            <div className="min-w-0 flex-1">
                              <button
                                type="button"
                                aria-current={active ? "true" : undefined}
                                className="block w-full text-left after:absolute after:inset-0 after:content-['']"
                                onClick={() => {
                                  setSelectedApplicationId(app.id);
                                  if (!isDesktop) setDetailSheetOpen(true);
                                }}
                              >
                                <span className="flex items-center justify-between gap-2">
                                  <span className="flex min-w-0 items-center gap-2">
                                    <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#eef3ef] text-[10px] font-bold text-[#2b5d4a]">
                                      {String(name ?? "?").trim().slice(0, 1).toUpperCase() || "?"}
                                    </span>
                                    <span className="truncate text-[13.5px] font-semibold text-[#1a201c]">{name || "Unnamed worker"}</span>
                                  </span>
                                  <span className="shrink-0 text-[11.5px] text-[#8a928c]" title={formatDateTime(app.appliedAt)}>
                                    {formatRelative(app.appliedAt)}
                                  </span>
                                </span>
                                <span className="mt-0.5 block truncate text-[12.5px] text-[#616a64]">{relatedGig?.title ?? app.gigId}</span>
                              </button>
                              <div className="mt-1.5 line-clamp-2 text-[12px] leading-5 text-[#7a827c]">
                                {app.proposal?.pitch || app.proposal?.approach || "No proposal text"}
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                <StatusChip status={app.status} />
                                {isContentPostingGig(relatedGig?.gigType) && app.status !== "Accepted" && app.status !== "Rejected" ? (
                                  <span
                                    className={`inline-flex items-center gap-1 rounded-[999px] px-2 py-0.5 text-[11px] font-medium ${
                                      app.proposal?.accountSetup?.status === "Submitted"
                                        ? "bg-[#e6f0fb] text-[#1f4a73]"
                                        : "bg-[#fff4df] text-[#8a5300]"
                                    }`}
                                  >
                                    <Icon d={ICONS.lock} className="h-3 w-3" />
                                    {app.proposal?.accountSetup?.status === "Submitted"
                                      ? app.proposal.accountSetup.ownership === "found"
                                        ? "Code verified · review"
                                        : "Account to check"
                                      : app.proposal?.accountSetup?.status === "ChangesRequested"
                                        ? "Awaiting fixes"
                                        : "No account yet"}
                                  </span>
                                ) : null}
                                {app.proposal?.whatsappLink?.trim() && (
                                  <span className="inline-flex items-center gap-1 rounded-[999px] bg-[#f1f3f0] px-2 py-0.5 text-[11px] font-medium text-[#4b544e]">
                                    <Icon d={ICONS.chat} className="h-3 w-3" />
                                    Invite sent
                                  </span>
                                )}
                                {app.proposal?.groupJoinedConfirmed && (
                                  <span className="inline-flex items-center gap-1 rounded-[999px] bg-[#ebf5ee] px-2 py-0.5 text-[11px] font-medium text-[#226b40]">
                                    <Icon d={ICONS.check} className="h-3 w-3" />
                                    Joined
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>

              {/* Detail: inline beside the queue on desktop; phones and tablets open it as a full-screen sheet */}
              <div id="application-detail" className="hidden min-w-0 xl:block">
                {isDesktop ? (
                  selectedApplicationPanel ? (
                    <>
                      {renderDetailNav("inline")}
                      {selectedApplicationPanel}
                    </>
                  ) : (
                    <EmptyState icon={ICONS.list} title="No application selected" body="Pick one from the queue to review the proposal, add notes and decide." />
                  )
                ) : null}
              </div>
              {sheetVisible && selectedApplicationPanel
                ? createPortal(
                    <div role="dialog" aria-modal="true" aria-label="Application details" className="ops-dashboard-skin fixed inset-0 z-[60] flex flex-col bg-[#f6f7f5] text-slate-900 xl:hidden">
                      {renderDetailNav("sheet")}
                      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-3 sm:px-5 sm:pt-5">{selectedApplicationPanel}</div>
                    </div>,
                    document.body
                  )
                : null}
            </div>

            {/* Floating bulk bar */}
            <BulkBar
              count={selectedFilteredApplications.length}
              total={filteredApps.length}
              onSelectAll={() => setSelectedApplicationIds(filteredApps.map((app) => app.id))}
              onClear={() => setSelectedApplicationIds([])}
              progress={applicationBulkProgress}
            >
              <button type="button" className={bulkBtn.danger} disabled={!!bulkApplicationActionId} onClick={() => runSelected("Rejected", "Reject")}>
                <Icon d={ICONS.x} />
                Reject
              </button>
              <button type="button" className={bulkBtn.ghost} disabled={!!bulkApplicationActionId} onClick={() => runSelected("Pending", "Mark pending")}>
                <Icon d={ICONS.pause} />
                Pending
              </button>
              <button type="button" className={bulkBtn.ghost} disabled={!!bulkApplicationActionId} onClick={() => setAppDrawer("message")}>
                <Icon d={ICONS.chat} />
                Message
              </button>
              <button type="button" className={bulkBtn.primary} disabled={!!bulkApplicationActionId} onClick={() => runSelected("Accepted", "Approve")}>
                <Icon d={ICONS.check} />
                Approve
              </button>
            </BulkBar>

            {appDrawer === "message" && (
              <MessageDrawer
                message={bulkReviewDraft}
                setMessage={setBulkReviewDraft}
                selectedCount={selectedFilteredApplications.length}
                busy={!!bulkApplicationActionId}
                onClose={() => setAppDrawer(null)}
                onPush={() => {
                  setAppDrawer(null);
                  runSelected("push", "Push update");
                }}
                onDecide={(action) => {
                  setAppDrawer(null);
                  runSelected(action, action === "Accepted" ? "Approve with message" : "Reject with message");
                }}
              />
            )}
            {appDrawer === "automation" && (
              <AutomationDrawer
                api={automation}
                gigs={gigs.map((g) => ({ id: String(g.id), title: g.title }))}
                gigTitle={gigTitleById}
                busy={!!bulkApplicationActionId}
                onClose={() => setAppDrawer(null)}
                onSelectMatches={(ids) => {
                  setSelectedGigId("All");
                  setApplicationStatusFilter("All");
                  setApplicationQueueQuery("");
                  setSelectedApplicationIds(ids);
                }}
              />
            )}
          </section>
        )}

        {view === "kyc-review" && (
          <KycReviewPanel
            rows={kycRows}
            loading={kycLoading}
            error={kycError}
            notice={kycNotice}
            lastSyncAt={kycLastSyncAt}
            onRefresh={(options) => fetchKyc({ ...options, afterCurrent: true })}
            setError={setKycError}
            setNotice={setKycNotice}
          />
        )}

        {view === "linked-accounts" && adminId && <LinkedAccountsPanel key={adminId} adminId={adminId} isDesktop={isDesktop} />}

        {view === "credential-submissions" && (
          <CredentialSubmissionsPanel
            assignments={assignments}
            setAssignments={(next) => {
              reads.abort("assignments");
              setAssignments(next);
            }}
            gigTitle={gigTitleById}
            lastRefreshAt={lastRefreshAt}
            refreshing={assignmentsRefreshing}
            onRefresh={refreshAssignments}
          />
        )}
    </div>
  );
}

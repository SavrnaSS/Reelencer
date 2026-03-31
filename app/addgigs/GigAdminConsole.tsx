"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Platform = "Instagram" | "X" | "YouTube" | "LinkedIn" | "TikTok";
type PayoutType = "Per task" | "Per post" | "Monthly";
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
  status: GigStatus;
  postedAt: string;
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
  };
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

type AssignmentActionResult = {
  fundsReleased?: boolean;
  payoutBatchId?: string;
  payoutStatus?: string;
  earningsReleaseStatus?: string;
};

type CredentialSubmission = {
  id: string;
  handle: string;
  email: string;
  password: string;
  phone?: string;
};

type KycEvent = {
  created_at: string;
  status: string;
  note?: string;
};

type KycRow = {
  id: string;
  legal_name: string;
  email?: string;
  user_id: string;
  id_type: string;
  id_number: string;
  phone?: string;
  address?: string;
  id_doc_url?: string;
  id_doc_path?: string;
  selfie_url?: string;
  selfie_path?: string;
  status: string;
  events?: KycEvent[];
};

type Role = "Admin" | "Worker";
type AuthSession = { role: Role; workerId?: string; at: string };

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
const PAYOUTS: PayoutType[] = ["Per task", "Per post", "Monthly"];
const STATUSES: GigStatus[] = ["Open", "Paused", "Closed"];
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

function buildRequirementsPayload(input: {
  gigType: string;
  requirements: string;
  customBrief: string;
  customRequirements: string;
  customMedia: string;
  projectBrief: string;
  hiringCapacity: string;
  expertise: string;
  languages: string;
  onboardingRequired: boolean;
  kycRequired: boolean;
}) {
  if (input.gigType === "Custom" || input.gigType === "Project" || input.gigType === "Content Posting") {
    const out: string[] = [];
    if (input.customBrief.trim()) out.push(`Brief::${input.customBrief.trim()}`);
    out.push(`Meta::onboarding_required=${input.onboardingRequired ? "true" : "false"}`);
    out.push(`Meta::kyc_required=${input.kycRequired ? "true" : "false"}`);
    parseCustomRequirementsText(input.customMedia).forEach((line) => out.push(`Media::${line}`));
    out.push(...parseCustomRequirementsText(input.customRequirements));
    return out;
  }
  const out: string[] = [];
  if (input.projectBrief.trim()) out.push(`Brief::${input.projectBrief.trim()}`);
  out.push(`Meta::onboarding_required=${input.onboardingRequired ? "true" : "false"}`);
  out.push(`Meta::kyc_required=${input.kycRequired ? "true" : "false"}`);
  if (input.hiringCapacity.trim()) out.push(`Meta::hiring_capacity=${input.hiringCapacity.trim()}`);
  if (input.expertise.trim()) out.push(`Meta::expertise=${input.expertise.trim()}`);
  if (input.languages.trim()) out.push(`Meta::languages=${input.languages.trim()}`);
  out.push(
    ...input.requirements
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  return out;
}

function readCustomFieldsFromRequirements(requirements: string[]) {
  const briefLine = requirements.find((item) => item.toLowerCase().startsWith("brief::"));
  const customBrief = briefLine ? briefLine.replace(/^brief::/i, "").trim() : "";
  const meta = requirements
    .filter((item) => item.toLowerCase().startsWith("meta::"))
    .reduce<Record<string, string>>((acc, item) => {
      const clean = item.replace(/^meta::/i, "");
      const sep = clean.indexOf("=");
      if (sep > 0) {
        const key = clean.slice(0, sep).trim().toLowerCase();
        const value = clean.slice(sep + 1).trim();
        if (key && value) acc[key] = value;
      }
      return acc;
    }, {});
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
        !item.toLowerCase().startsWith("meta::")
    )
    .join("\n");
  return {
    customBrief,
    customRequirements,
    customMedia,
    kycRequired: !["false", "0", "no", "off"].includes((meta.kyc_required ?? "true").toLowerCase()),
  };
}

function readProjectFieldsFromRequirements(requirements: string[]) {
  const briefLine = requirements.find((item) => item.toLowerCase().startsWith("brief::"));
  const projectBrief = briefLine ? briefLine.replace(/^brief::/i, "").trim() : "";
  const meta = requirements
    .filter((item) => item.toLowerCase().startsWith("meta::"))
    .reduce<Record<string, string>>((acc, item) => {
      const clean = item.replace(/^meta::/i, "");
      const sep = clean.indexOf("=");
      if (sep > 0) {
        const key = clean.slice(0, sep).trim().toLowerCase();
        const value = clean.slice(sep + 1).trim();
        if (key && value) acc[key] = value;
      }
      return acc;
    }, {});
  const requirementsText = requirements
    .filter(
      (item) =>
        !item.toLowerCase().startsWith("brief::") &&
        !item.toLowerCase().startsWith("meta::") &&
        !item.toLowerCase().startsWith("media::")
    )
    .join(", ");
  return {
    projectBrief,
    hiringCapacity: meta.hiring_capacity ?? "",
    expertise: meta.expertise ?? "",
    languages: meta.languages ?? "",
    onboardingRequired: !["false", "0", "no", "off"].includes((meta.onboarding_required ?? "true").toLowerCase()),
    kycRequired: !["false", "0", "no", "off"].includes((meta.kyc_required ?? "true").toLowerCase()),
    requirementsText,
  };
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

function nowLabel() {
  const d = new Date();
  return `Posted ${d.toLocaleDateString()}`;
}

function makeId() {
  return `GIG-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

export type GigAdminView = "create-new-gig" | "applications" | "kyc-review" | "credential-submissions";

export default function GigAdminConsole({
  view = "create-new-gig",
  nextPath = "/addgigs/create-new-gig",
}: {
  view?: GigAdminView;
  nextPath?: string;
}) {
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [gigs, setGigs] = useState<Gig[]>([]);
  const [apps, setApps] = useState<GigApplication[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [assignmentCreds, setAssignmentCreds] = useState<CredentialSubmission[]>([]);
  const [credsCache, setCredsCache] = useState<Record<string, CredentialSubmission[]>>({});
  const [loadingCredsId, setLoadingCredsId] = useState<string | null>(null);
  const [assignmentFilter, setAssignmentFilter] = useState<string>("Submitted");
  const [assignmentsRefreshing, setAssignmentsRefreshing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [lastSeenSubmittedAt, setLastSeenSubmittedAt] = useState<string | null>(null);
  const [assignmentActionId, setAssignmentActionId] = useState<string | null>(null);
  const [assignmentNotice, setAssignmentNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [applicationNotice, setApplicationNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [kycRows, setKycRows] = useState<KycRow[]>([]);
  const [kycLoading, setKycLoading] = useState(false);
  const [kycError, setKycError] = useState<string | null>(null);
  const [kycNotice, setKycNotice] = useState<string | null>(null);
  const [kycNoteDraft, setKycNoteDraft] = useState<Record<string, string>>({});
  const [kycTimeline, setKycTimeline] = useState<KycRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [kycLastSyncAt, setKycLastSyncAt] = useState<string | null>(null);
  const [selectedGigId, setSelectedGigId] = useState<string | "All">("All");
  const [applicationStatusFilter, setApplicationStatusFilter] = useState<ApplicationStatus | "All">("All");
  const [applicationQueueQuery, setApplicationQueueQuery] = useState("");
  const [applicationQueueSort, setApplicationQueueSort] = useState<"latest" | "oldest" | "worker_asc" | "gig_asc">("latest");
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null);
  const [selectedApplicationIds, setSelectedApplicationIds] = useState<string[]>([]);
  const [bulkApplicationActionId, setBulkApplicationActionId] = useState<string | null>(null);
  const [editingGig, setEditingGig] = useState<Gig | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [mediaUploading, setMediaUploading] = useState(false);
  const [mediaUploadError, setMediaUploadError] = useState<string | null>(null);
  const [proposalReviewDraft, setProposalReviewDraft] = useState<
    Record<string, { adminNote: string; adminExplanation: string; whatsappLink: string; onboardingSteps?: string }>
  >({});
  const [bulkReviewDraft, setBulkReviewDraft] = useState<BulkReviewDraft>({ ...DEFAULT_BULK_REVIEW_DRAFT });

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
    customRequirements: "",
    customMedia: "",
    projectBrief: "",
    hiringCapacity: "",
    expertise: "",
    languages: "",
    onboardingRequired: true,
    kycRequired: true,
    requirements: "",
    status: "Open" as GigStatus,
  });

  useEffect(() => {
    const s = readLS<AuthSession | null>(LS_KEYS.AUTH, null);
    setSession(s);
    setSessionLoaded(true);
  }, []);

  useEffect(() => {
    const cachedGigs = toArray<Gig>(readLS(LS_KEYS.GIGS, []), []);
    const cachedApps = toArray<GigApplication>(readLS(LS_KEYS.GIG_APPS, []), []);
    const cachedAssignments = toArray<Assignment>(readLS(LS_KEYS.GIG_ASSIGNMENTS, []), []);
    const cachedKyc = toArray<KycRow>(readLS<KycRow[]>(LS_KEYS.GIG_KYC_ROWS, []), []);
    const cachedKycSync = readLS<string | null>(LS_KEYS.GIG_KYC_SYNC_AT, null);
    const cachedProposalDraft = readLS<
      Record<string, { adminNote: string; adminExplanation: string; whatsappLink: string; onboardingSteps?: string }>
    >(
      LS_KEYS.PROPOSAL_REVIEW_DRAFT,
      {}
    );

    if (cachedGigs.length) setGigs(cachedGigs);
    if (cachedApps.length) setApps(cachedApps);
    if (cachedAssignments.length) setAssignments(cachedAssignments);
    if (cachedKyc.length) setKycRows(cachedKyc);
    if (cachedKycSync) setKycLastSyncAt(cachedKycSync);
    if (Object.keys(cachedProposalDraft).length) setProposalReviewDraft(cachedProposalDraft);
    if (cachedGigs.length || cachedApps.length || cachedAssignments.length || cachedKyc.length) setLoading(false);
  }, []);

  useEffect(() => {
    writeLS(LS_KEYS.PROPOSAL_REVIEW_DRAFT, proposalReviewDraft);
  }, [proposalReviewDraft]);

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
      window.location.replace(`/login?next=${encodeURIComponent(nextPath)}`);
      return;
    }
    if (session.role !== "Admin") {
      window.location.replace("/workspace");
      return;
    }
  }, [nextPath, sessionLoaded, session]);

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
          writeLS(LS_KEYS.GIG_ASSIGNMENTS, safe);
        } else {
          throw new Error("Failed assignments");
        }
      } catch {
        setAssignments([]);
      }
    };

    (async () => {
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

  const fetchKyc = async ({ preserveFeedback = false }: { preserveFeedback?: boolean } = {}) => {
    setKycLoading(true);
    if (!preserveFeedback) {
      setKycError(null);
      setKycNotice(null);
    }
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Missing session");
      const res = await fetch("/api/admin/kyc", { headers: { Authorization: `Bearer ${token}` } });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || "Failed to load KYC");
      const safeRows = toArray<KycRow>(payload.rows, []);
      const syncedAt = new Date().toISOString();
      setKycRows(safeRows);
      setKycLastSyncAt(syncedAt);
      writeLS(LS_KEYS.GIG_KYC_ROWS, safeRows);
      writeLS(LS_KEYS.GIG_KYC_SYNC_AT, syncedAt);
    } catch (e: unknown) {
      setKycError(e instanceof Error ? e.message : "Failed to load KYC");
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
          writeLS(LS_KEYS.GIG_ASSIGNMENTS, safe);
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

  const appsForGig = useMemo(() => {
    if (selectedGigId === "All") return apps;
    return apps.filter((app) => app.gigId === selectedGigId);
  }, [apps, selectedGigId]);
  const gigById = useMemo(() => {
    const map = new Map<string, Gig>();
    gigs.forEach((gig) => map.set(String(gig.id), gig));
    return map;
  }, [gigs]);
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
    if (form.gigType === "Custom" && !form.customGigType.trim()) return "Custom gig type label is required.";
    if ((form.gigType === "Custom" || form.gigType === "Project" || form.gigType === "Content Posting") && !form.customBrief.trim()) return "A project brief is required for this gig type.";
    return null;
  };

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
          const formData = new FormData();
          formData.append("file", file);
          const res = await fetch("/api/admin/gig-brief-media/upload", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
          });
          const payload = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(payload?.error || `Upload failed for ${file.name}`);
          const url = String(payload?.url ?? "").trim();
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
    []
  );

  const createGig = async () => {
    if (mediaUploading) {
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
      gigType: resolvedGigType,
      requirements: buildRequirementsPayload(form),
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
      gigType: "Email Creator",
      customGigType: "",
      customBrief: "",
      customRequirements: "",
      customMedia: "",
      projectBrief: "",
      hiringCapacity: "",
      expertise: "",
      languages: "",
      onboardingRequired: true,
      kycRequired: true,
      requirements: "",
      status: "Open",
    });
  };

  const startEdit = (gig: Gig) => {
    setEditingGig(gig);
    const normalizedType = normalizeGigType(gig.gigType);
    const isProject = isProjectStyleGig(normalizedType);
    const isCustom = /^(custom|category):/i.test(normalizedType);
    const customLabel = isCustom ? normalizedType.replace(/^(custom|category):\s*/i, "").trim() : "";
    const customFields = readCustomFieldsFromRequirements(gig.requirements);
    const projectFields = readProjectFieldsFromRequirements(gig.requirements);
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
      customRequirements: customFields.customRequirements,
      customMedia: customFields.customMedia,
      projectBrief: projectFields.projectBrief,
      hiringCapacity: projectFields.hiringCapacity,
      expertise: projectFields.expertise,
      languages: projectFields.languages,
      onboardingRequired: projectFields.onboardingRequired,
      kycRequired: isCustom || isProject ? customFields.kycRequired : projectFields.kycRequired,
      requirements: isCustom || isProject ? customFields.customRequirements.replace(/\n/g, ", ") : projectFields.requirementsText,
      status: gig.status,
    });
    setFormError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const updateGig = async () => {
    if (!editingGig) return;
    if (mediaUploading) {
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
      requirements: buildRequirementsPayload(form),
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
      gigType: "Email Creator",
      customGigType: "",
      customBrief: "",
      customRequirements: "",
      customMedia: "",
      projectBrief: "",
      hiringCapacity: "",
      expertise: "",
      languages: "",
      onboardingRequired: true,
      kycRequired: true,
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
    const normalized = normalizeGigType(gigType);
    const resolved =
      normalized === "Custom"
        ? `Category: ${window.prompt("Enter custom gig type label", "Freelance")?.trim() || "Freelance"}`
        : normalized === "Project"
          ? "Project"
        : normalized;
    setGigs((prev) => {
      const next = prev.map((gig) => (gig.id === gigId ? { ...gig, gigType: resolved } : gig));
      writeLS(LS_KEYS.GIGS, next);
      return next;
    });

    try {
      await fetch("/api/gigs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: gigId, updates: { gigType: resolved } }),
      });
    } catch {
      // ignore
    }
  };

  const persistApplicationReview = async (
    app: GigApplication,
    review?: { adminNote?: string; adminExplanation?: string; whatsappLink?: string; onboardingSteps?: string },
    statusOverride?: ApplicationStatus,
    options?: { notificationMode?: "whatsapp_invite" | "workflow_update" }
  ) => {
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
    setApps((prev) => {
      const next = prev.map((a) => (a.id === app.id ? { ...a, status, decidedAt, proposal: nextProposal } : a));
      writeLS(LS_KEYS.GIG_APPS, next);
      return next;
    });
    setApplicationNotice(null);

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
      if (payload?.mailStatus?.sent) {
        setApplicationNotice({
          tone: "success",
          text: `Worker notification sent to ${payload.mailStatus.recipient}.`,
        });
      } else if (payload?.mailStatus?.reason) {
        setApplicationNotice({
          tone: "danger",
          text: `Worker notification was not sent: ${payload.mailStatus.reason}`,
        });
      }
    } catch {
      setApplicationNotice({
        tone: "danger",
        text: "Recruiter workflow was updated, but the notification status could not be confirmed.",
      });
    }
  };

  const updateApplication = async (
    app: GigApplication,
    status: ApplicationStatus,
    review?: { adminNote?: string; adminExplanation?: string; whatsappLink?: string; onboardingSteps?: string }
  ) => {
    await persistApplicationReview(app, review, status);
  };

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

  const selectApplicationsByStatus = (status: ApplicationStatus) => {
    const targetIds = filteredApps.filter((app) => app.status === status).map((app) => app.id);
    setSelectedApplicationIds(targetIds);
  };

  const invertFilteredApplicationSelection = () => {
    const current = new Set(selectedApplicationIds);
    setSelectedApplicationIds(filteredApps.map((app) => app.id).filter((id) => !current.has(id)));
  };

  const runBulkApplicationAction = async (
    status: ApplicationStatus,
    review?: BulkReviewDraft
  ) => {
    const targets = filteredApps.filter((app) => selectedApplicationIds.includes(app.id));
    if (!targets.length) {
      setApplicationNotice({ tone: "danger", text: "Select one or more applications before running a bulk action." });
      return;
    }
    setBulkApplicationActionId(`${status}:${Date.now()}`);
    try {
      for (const app of targets) {
        await persistApplicationReview(app, review, status);
      }
      setSelectedApplicationIds([]);
      setApplicationNotice({
        tone: "success",
        text: `${targets.length} application${targets.length === 1 ? "" : "s"} updated to ${status.toLowerCase()} in bulk.`,
      });
    } finally {
      setBulkApplicationActionId(null);
    }
  };

  const runBulkApplicationInstructionPush = async (review: BulkReviewDraft) => {
    const targets = filteredApps.filter((app) => selectedApplicationIds.includes(app.id));
    if (!targets.length) {
      setApplicationNotice({ tone: "danger", text: "Select one or more applications before publishing recruiter instructions." });
      return;
    }
    setBulkApplicationActionId(`Notify:${Date.now()}`);
    try {
      for (const app of targets) {
        await persistApplicationReview(app, review, app.status, {
          notificationMode: review.whatsappLink.trim() ? "whatsapp_invite" : "workflow_update",
        });
      }
      setApplicationNotice({
        tone: "success",
        text: `Latest recruiter instructions were published to ${targets.length} selected application${targets.length === 1 ? "" : "s"}.`,
      });
    } finally {
      setBulkApplicationActionId(null);
    }
  };

  const updateAssignment = async (
    assignment: Assignment,
    status: string,
    options?: { releaseFundsNow?: boolean }
  ): Promise<AssignmentActionResult | null> => {
    const decidedAt = new Date().toISOString();
    setAssignmentActionId(assignment.id);
    setAssignmentNotice(null);
    setAssignments((prev) => prev.map((a) => (a.id === assignment.id ? { ...a, status, decidedAt } : a)));
    try {
      const res = await fetch("/api/gig-assignments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: assignment.id, updates: { status, decidedAt, releaseFundsNow: !!options?.releaseFundsNow } }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || "Unable to update submission.");
      }
      const nextAssignment = payload
        ? {
            ...assignment,
            status: payload.status ?? status,
            decidedAt: payload.decidedAt ?? decidedAt,
          }
        : { ...assignment, status, decidedAt };
      setAssignments((prev) => prev.map((a) => (a.id === assignment.id ? nextAssignment : a)));
      setSelectedAssignment((prev) => (prev?.id === assignment.id ? nextAssignment : prev));
      setAssignmentNotice({
        tone: "success",
        text:
          status === "Accepted" && options?.releaseFundsNow
            ? payload?.fundsReleased
              ? "Submission approved and the gig amount was credited to the worker's approved earnings wallet."
              : "Submission approved. Wallet credit is being prepared."
            : status === "Accepted"
              ? "Submission approved. Earnings are ready for wallet credit."
              : status === "Pending"
                ? "Submission kept in managed review."
                : "Submission returned for correction.",
      });
      return payload;
    } catch (err: any) {
      setAssignments((prev) => prev.map((a) => (a.id === assignment.id ? assignment : a)));
      setSelectedAssignment((prev) => (prev?.id === assignment.id ? assignment : prev));
      setAssignmentNotice({
        tone: "danger",
        text:
          err?.message ||
          (status === "Accepted" && options?.releaseFundsNow
            ? "Approval saved failed or payout release is blocked. Check the worker payout method."
            : "Unable to update the submission right now."),
      });
      return null;
    } finally {
      setAssignmentActionId((prev) => (prev === assignment.id ? null : prev));
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

  const fetchAssignmentCreds = useCallback(async (assignmentId: string) => {
    if (credsCache[assignmentId]) return credsCache[assignmentId];
    setLoadingCredsId(assignmentId);
    try {
      const res = await fetch(`/api/gig-credentials?assignmentId=${encodeURIComponent(assignmentId)}`);
      const data = res.ok ? await res.json() : [];
      const safe = toArray<CredentialSubmission>(data, []);
      setCredsCache((prev) => ({ ...prev, [assignmentId]: safe }));
      return safe;
    } catch {
      setCredsCache((prev) => ({ ...prev, [assignmentId]: [] }));
      return [];
    } finally {
      setLoadingCredsId((prev) => (prev === assignmentId ? null : prev));
    }
  }, [credsCache]);

  const openAssignment = useCallback(async (assignment: Assignment) => {
    setSelectedAssignment(assignment);
    const creds = await fetchAssignmentCreds(assignment.id);
    setAssignmentCreds(creds);
  }, [fetchAssignmentCreds]);

  const selectedIndex = useMemo(() => {
    if (!selectedAssignment) return -1;
    return filteredAssignments.findIndex((a) => a.id === selectedAssignment.id);
  }, [selectedAssignment, filteredAssignments]);

  const openAdjacent = useCallback(async (dir: -1 | 1) => {
    if (selectedIndex < 0) return;
    const next = filteredAssignments[selectedIndex + dir];
    if (!next) return;
    await openAssignment(next);
  }, [filteredAssignments, openAssignment, selectedIndex]);

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
  }, [assignments, assignmentFilter, lastSeenSubmittedAt, openAssignment, selectedAssignment]);

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
  }, [openAdjacent, selectedAssignment]);

  const refreshAssignments = async () => {
    setAssignmentsRefreshing(true);
    try {
      const res = await fetch("/api/gig-assignments?all=1", { method: "GET" });
      const data = res.ok ? await res.json() : [];
      const safe = Array.isArray(data) ? data : [];
      setAssignments(safe);
      writeLS(LS_KEYS.GIG_ASSIGNMENTS, safe);
      setLastRefreshAt(new Date().toISOString());
    } finally {
      setAssignmentsRefreshing(false);
    }
  };

  const selectedApplicationPanel = selectedApplication
    ? (() => {
        const app = selectedApplication;
        const relatedGig = gigById.get(String(app.gigId));
        const isProjectProposal = isProjectStyleGig(relatedGig?.gigType);
        const draft = proposalReviewDraft[app.id] ?? {
          adminNote: app.proposal?.adminNote ?? "",
          adminExplanation: app.proposal?.adminExplanation ?? "",
          whatsappLink: app.proposal?.whatsappLink ?? "",
          onboardingSteps: app.proposal?.onboardingSteps ?? "",
        };

        return (
          <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Selected submission</div>
                <div className="mt-2 break-words text-2xl font-semibold text-slate-900">{app.workerName ?? app.workerId}</div>
                <div className="mt-1 text-sm text-slate-500">
                  {relatedGig?.title ?? app.gigId} • {relatedGig?.company ?? "Reelencer"}
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">Applied {new Date(app.appliedAt).toLocaleDateString()}</span>
                  {app.decidedAt && (
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                      Reviewed {new Date(app.decidedAt).toLocaleDateString()}
                    </span>
                  )}
                  {relatedGig?.gigType && (
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">{formatGigTypeLabel(relatedGig.gigType)}</span>
                  )}
                </div>
              </div>
              <span
                className={`self-start rounded-full border px-3 py-1 text-xs font-semibold ${
                  app.status === "Accepted"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : app.status === "Rejected"
                      ? "border-rose-200 bg-rose-50 text-rose-700"
                      : "border-slate-200 bg-slate-50 text-slate-600"
                }`}
              >
                {app.status}
              </span>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
              <div className="space-y-4">
                {app.proposal && (
                  <div className="rounded-2xl border border-[#d4dfd7] bg-[#f7fbf5] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6f877d]">Submitted proposal</div>
                      {app.proposal.reviewStatus && (
                        <span className="rounded-full border border-[#d4dfd7] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#4d665c]">
                          {app.proposal.reviewStatus}
                        </span>
                      )}
                    </div>
                    {app.proposal.pitch && (
                      <div className="mt-3 text-sm leading-6 text-slate-700">
                        <span className="font-semibold text-slate-900">{isProjectProposal ? "Cover letter:" : "Pitch:"}</span> {app.proposal.pitch}
                      </div>
                    )}
                    {app.proposal.approach && !isProjectProposal && (
                      <div className="mt-3 text-sm leading-6 text-slate-700">
                        <span className="font-semibold text-slate-900">Approach:</span> {app.proposal.approach}
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                      {app.proposal.timeline && (
                        <span className="rounded-full border border-[#d4dfd7] bg-white px-2 py-1 text-[#4d665c]">
                          {isProjectProposal ? "Estimated hours" : "Timeline"}: {app.proposal.timeline}
                        </span>
                      )}
                      {app.proposal.budget && (
                        <span className="rounded-full border border-[#d4dfd7] bg-white px-2 py-1 text-[#4d665c]">
                          {isProjectProposal ? "Hourly price" : "Budget note"}: {app.proposal.budget}
                        </span>
                      )}
                      {app.proposal.submittedAt && (
                        <span className="rounded-full border border-[#d4dfd7] bg-white px-2 py-1 text-[#4d665c]">
                          Submitted: {new Date(app.proposal.submittedAt).toLocaleString()}
                        </span>
                      )}
                    </div>
                    {app.proposal.portfolio && !isProjectProposal && (
                      <div className="mt-3 text-sm leading-6 text-slate-700">
                        <span className="font-semibold text-slate-900">Portfolio:</span> {app.proposal.portfolio}
                      </div>
                    )}
                    {app.proposal.onboardingSteps && (
                      <div className="mt-3 text-sm leading-6 text-slate-700">
                        <span className="font-semibold text-slate-900">Post-onboarding steps:</span> {app.proposal.onboardingSteps}
                      </div>
                    )}
                    {app.proposal.reviewedAt && (
                      <div className="mt-3 text-[11px] text-slate-500">Reviewed: {new Date(app.proposal.reviewedAt).toLocaleString()}</div>
                    )}
                    {app.proposal.groupJoinedConfirmed && (
                      <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-700">
                        Worker confirmed WhatsApp group joined
                        {app.proposal.groupJoinedConfirmedAt ? ` (${new Date(app.proposal.groupJoinedConfirmedAt).toLocaleString()})` : ""}
                      </div>
                    )}
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-[11px] font-semibold text-slate-600">
                    Admin note
                    <input
                      className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                      value={draft.adminNote}
                      onChange={(e) =>
                        setProposalReviewDraft((prev) => ({
                          ...prev,
                          [app.id]: { ...(prev[app.id] ?? draft), adminNote: e.target.value },
                        }))
                      }
                      onBlur={(e) =>
                        persistApplicationReview(
                          app,
                          { ...(proposalReviewDraft[app.id] ?? draft), adminNote: e.target.value },
                          app.status
                        )
                      }
                      placeholder="Short status note for the worker feed"
                    />
                  </label>
                  <label className="text-[11px] font-semibold text-slate-600">
                    WhatsApp group link
                    <input
                      className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                      value={draft.whatsappLink}
                      onChange={(e) =>
                        setProposalReviewDraft((prev) => ({
                          ...prev,
                          [app.id]: { ...(prev[app.id] ?? draft), whatsappLink: e.target.value },
                        }))
                      }
                      onBlur={(e) =>
                        persistApplicationReview(
                          app,
                          { ...(proposalReviewDraft[app.id] ?? draft), whatsappLink: e.target.value },
                          app.status
                        )
                      }
                      placeholder="https://chat.whatsapp.com/..."
                    />
                  </label>
                </div>
                <label className="block text-[11px] font-semibold text-slate-600">
                  Post-onboarding steps
                  <textarea
                    className="mt-1 h-28 w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900"
                    value={draft.onboardingSteps}
                    onChange={(e) =>
                      setProposalReviewDraft((prev) => ({
                        ...prev,
                        [app.id]: { ...(prev[app.id] ?? draft), onboardingSteps: e.target.value },
                      }))
                    }
                    onBlur={(e) =>
                      persistApplicationReview(
                        app,
                        { ...(proposalReviewDraft[app.id] ?? draft), onboardingSteps: e.target.value },
                        app.status
                      )
                    }
                    placeholder="After joining group: submit intro message, share worker ID, confirm timezone, and wait for admin checklist."
                  />
                </label>
                <label className="block text-[11px] font-semibold text-slate-600">
                  Admin explanation
                  <textarea
                    className="mt-1 h-28 w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900"
                    value={draft.adminExplanation}
                    onChange={(e) =>
                      setProposalReviewDraft((prev) => ({
                        ...prev,
                        [app.id]: { ...(prev[app.id] ?? draft), adminExplanation: e.target.value },
                      }))
                    }
                    onBlur={(e) =>
                      persistApplicationReview(
                        app,
                        { ...(proposalReviewDraft[app.id] ?? draft), adminExplanation: e.target.value },
                        app.status
                      )
                    }
                    placeholder="Explain next steps, reason, or onboarding guidance."
                  />
                </label>
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Review controls</div>
                  <div className="mt-3 grid gap-3">
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Current state</div>
                      <div className="mt-2 text-xl font-semibold text-slate-900">{app.status}</div>
                      <div className="mt-1 text-sm text-slate-500">
                        {app.status === "Accepted"
                          ? "Candidate has been moved into onboarding."
                          : app.status === "Rejected"
                            ? "Candidate is waiting for a revised submission."
                            : "Review is still in progress."}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Communication readiness</div>
                      <div className="mt-2 text-base font-semibold text-slate-900">
                        {draft.whatsappLink.trim() ? "Invite prepared" : "Invite not issued"}
                      </div>
                      <div className="mt-1 text-sm text-slate-500">
                        {draft.whatsappLink.trim()
                          ? "Worker will be notified when the recruiter update is published."
                          : "Add onboarding communication before moving the candidate deeper into the workflow."}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Bulk action pattern</div>
                      <div className="mt-2 text-sm leading-6 text-slate-600">
                        Save recruiter note, explanation, and onboarding details here, then publish the correct status to sync the worker feed and mail updates.
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      className="rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
                      onClick={() => {
                        const latest = proposalReviewDraft[app.id] ?? draft;
                        updateApplication(app, "Pending", {
                          adminNote: latest.adminNote,
                          adminExplanation: latest.adminExplanation,
                          whatsappLink: latest.whatsappLink,
                          onboardingSteps: latest.onboardingSteps,
                        });
                      }}
                    >
                      Mark pending
                    </button>
                    <button
                      className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700"
                      onClick={() => {
                        const latest = proposalReviewDraft[app.id] ?? draft;
                        updateApplication(app, "Accepted", {
                          adminNote: latest.adminNote,
                          adminExplanation: latest.adminExplanation,
                          whatsappLink: latest.whatsappLink,
                          onboardingSteps: latest.onboardingSteps,
                        });
                      }}
                    >
                      Approve
                    </button>
                    <button
                      className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700"
                      onClick={() => {
                        const latest = proposalReviewDraft[app.id] ?? draft;
                        updateApplication(app, "Rejected", {
                          adminNote: latest.adminNote,
                          adminExplanation: latest.adminExplanation,
                          whatsappLink: latest.whatsappLink,
                          onboardingSteps: latest.onboardingSteps,
                        });
                      }}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()
    : null;

  return (
    <div className="ops-dashboard-skin min-h-screen bg-slate-50 text-slate-900">
      <div className="sticky top-0 z-40 border-b border-[#d5ddcf] bg-[#f8faf7]/95 backdrop-blur">
        <div className={`mx-auto flex w-full flex-wrap items-start justify-between gap-3 px-4 py-4 sm:px-5 sm:py-6 ${view === "applications" ? "max-w-[92rem]" : "max-w-6xl"}`}>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#1f4f43] text-white font-black">R</div>
            <div>
              <div className="text-lg font-semibold tracking-wide">Reelencer Admin</div>
              <div className="text-xs text-slate-500">Gig control center</div>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:gap-3">
            <Link
              className="rounded-full border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:border-slate-400 sm:px-4 sm:py-2 sm:text-sm"
              href="/browse"
            >
              Browse view
            </Link>
            <Link
              className="rounded-full border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:border-slate-400 sm:px-4 sm:py-2 sm:text-sm"
              href="/admin"
            >
              Admin home
            </Link>
          </div>
        </div>
      </div>

      <main className={`mx-auto w-full px-4 py-6 sm:px-5 sm:py-8 ${view === "applications" ? "max-w-[92rem]" : "max-w-6xl"}`}>
        <section className="mb-6">
          <div className="flex w-full items-center gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Link
              href="/addgigs/create-new-gig"
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition ${
                view === "create-new-gig" ? "bg-[#1f4f43] text-white" : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              Create new gig
            </Link>
            <Link
              href="/addgigs/applications"
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition ${
                view === "applications" ? "bg-[#1f4f43] text-white" : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              Applications
            </Link>
            <Link
              href="/addgigs/kyc-review"
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition ${
                view === "kyc-review" ? "bg-[#1f4f43] text-white" : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              KYC Review
            </Link>
            <Link
              href="/addgigs/credential-submissions"
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition ${
                view === "credential-submissions" ? "bg-[#1f4f43] text-white" : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              Credential submissions
            </Link>
          </div>
        </section>

        {view === "create-new-gig" && (
          <>
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
              {form.gigType === "Custom" && (
                <label className="text-xs font-semibold text-slate-600 md:col-span-2">
                  Custom gig type label
                  <input
                    className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    value={form.customGigType}
                    onChange={(e) => setForm((prev) => ({ ...prev, customGigType: e.target.value }))}
                    placeholder="e.g., Freelance Marketplace"
                  />
                </label>
              )}
              {(form.gigType === "Custom" || form.gigType === "Project" || form.gigType === "Content Posting") && (
                <label className="text-xs font-semibold text-slate-600 md:col-span-2">
                  {form.gigType === "Project"
                    ? "Project brief (shown in proposal desk)"
                    : form.gigType === "Content Posting"
                      ? "Content posting brief (shown in proposal desk)"
                      : "Custom brief (shown in proposal desk)"}
                  <textarea
                    className="mt-2 h-24 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
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
                </label>
              )}
              {(form.gigType === "Custom" || form.gigType === "Project" || form.gigType === "Content Posting") && (
                <label className="text-xs font-semibold text-slate-600 md:col-span-2">
                  Detailed requirements (one per line)
                  <textarea
                    className="mt-2 h-28 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    value={form.customRequirements}
                    onChange={(e) => setForm((prev) => ({ ...prev, customRequirements: e.target.value }))}
                    placeholder={"Deliver 3 concepts in week 1\nDaily progress updates\nPortfolio examples required"}
                  />
                </label>
              )}
              {(form.gigType === "Custom" || form.gigType === "Project" || form.gigType === "Content Posting") && (
                <label className="text-xs font-semibold text-slate-600 md:col-span-2">
                  Brief media upload (images/videos)
                  <input
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="mt-2 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 file:mr-3 file:rounded-md file:border-0 file:bg-[#edf5ef] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-[#2f6655]"
                    onChange={async (e) => {
                      const input = e.currentTarget;
                      const files = input.files;
                      await uploadCustomMediaFiles(files);
                      input.value = "";
                    }}
                    disabled={mediaUploading}
                  />
                  <div className="mt-2 text-[11px] text-slate-500">
                    Uploaded media will appear in the worker proposal UI automatically.
                  </div>
                  {mediaUploadError && (
                    <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                      {mediaUploadError}
                    </div>
                  )}
                  <div className="mt-3 space-y-2">
                    {parseCustomRequirementsText(form.customMedia).length === 0 && (
                      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                        No media uploaded yet.
                      </div>
                    )}
                    {parseCustomRequirementsText(form.customMedia).map((item, index) => (
                      <div key={`${item}-${index}`} className="flex items-center justify-between gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                        <a href={item} target="_blank" rel="noreferrer" className="truncate font-semibold text-[#2f6655] hover:underline">
                          Asset {index + 1}
                        </a>
                        <button
                          type="button"
                          className="rounded-full border border-slate-300 px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:border-slate-400"
                          onClick={() =>
                            setForm((prev) => ({
                              ...prev,
                              customMedia: parseCustomRequirementsText(prev.customMedia)
                                .filter((_, i) => i !== index)
                                .join("\n"),
                            }))
                          }
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                  {mediaUploading && <div className="mt-2 text-xs font-semibold text-[#2f6655]">Uploading media...</div>}
                </label>
              )}
              {form.gigType !== "Custom" && form.gigType !== "Project" && (
                <label className="text-xs font-semibold text-slate-600 md:col-span-2">
                  Project brief (shown before proposal submission)
                  <textarea
                    className="mt-2 h-24 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    value={form.projectBrief}
                    onChange={(e) => setForm((prev) => ({ ...prev, projectBrief: e.target.value }))}
                    placeholder="Describe project scope, expected outcomes, and execution context."
                  />
                </label>
              )}
              {form.gigType !== "Custom" && form.gigType !== "Project" && (
                <label className="text-xs font-semibold text-slate-600">
                  Hiring capacity
                  <input
                    className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    value={form.hiringCapacity}
                    onChange={(e) => setForm((prev) => ({ ...prev, hiringCapacity: e.target.value }))}
                    placeholder="e.g., 1 creator"
                  />
                </label>
              )}
              {form.gigType !== "Custom" && form.gigType !== "Project" && (
                <label className="text-xs font-semibold text-slate-600">
                  Expertise
                  <input
                    className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    value={form.expertise}
                    onChange={(e) => setForm((prev) => ({ ...prev, expertise: e.target.value }))}
                    placeholder="e.g., Mid level"
                  />
                </label>
              )}
              {form.gigType !== "Custom" && form.gigType !== "Project" && (
                <label className="text-xs font-semibold text-slate-600 md:col-span-2">
                  Languages
                  <input
                    className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    value={form.languages}
                    onChange={(e) => setForm((prev) => ({ ...prev, languages: e.target.value }))}
                    placeholder="e.g., English, Hindi"
                  />
                </label>
              )}
              <label className="text-xs font-semibold text-slate-600 md:col-span-2">
                <span className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.onboardingRequired}
                    onChange={(e) => setForm((prev) => ({ ...prev, onboardingRequired: e.target.checked }))}
                    className="h-4 w-4 rounded border-slate-300 text-[#1f4f43] focus:ring-[#1f4f43]"
                  />
                  Require structured onboarding workflow for this gig
                </span>
                <div className="mt-1 text-[11px] font-normal text-slate-500">
                  When enabled, workers must complete the onboarding steps before workspace handoff.
                </div>
              </label>
              <label className="text-xs font-semibold text-slate-600 md:col-span-2">
                <span className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.kycRequired}
                    onChange={(e) => setForm((prev) => ({ ...prev, kycRequired: e.target.checked }))}
                    className="h-4 w-4 rounded border-slate-300 text-[#1f4f43] focus:ring-[#1f4f43]"
                  />
                  Require KYC approval before workers can unlock this gig
                </span>
                <div className="mt-1 text-[11px] font-normal text-slate-500">
                  Disable this for less restricted gigs that should be visible to signed-in workers without KYC.
                </div>
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

            {form.gigType !== "Custom" && (
              <label className="mt-4 block text-xs font-semibold text-slate-600">
                Requirements (comma separated)
                <input
                  className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  value={form.requirements}
                  onChange={(e) => setForm((prev) => ({ ...prev, requirements: e.target.value }))}
                  placeholder="e.g., 10k+ followers, 72h turnaround"
                />
              </label>
            )}

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
                        gigType: "Email Creator",
                        customGigType: "",
                        customBrief: "",
                        customRequirements: "",
                        customMedia: "",
                        projectBrief: "",
                        hiringCapacity: "",
                        expertise: "",
                        languages: "",
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
                  className="rounded-full bg-[#1f4f43] px-5 py-2 text-sm font-semibold text-white hover:bg-[#245a4b]"
                  onClick={editingGig ? updateGig : createGig}
                  disabled={mediaUploading}
                >
                  {mediaUploading ? "Uploading media..." : editingGig ? "Update gig" : "Publish gig"}
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
                <div className="mt-2 text-2xl font-semibold text-slate-900">
                  {apps.filter((a) => a.status === "Applied" || a.status === "Pending").length}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-10">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 text-sm font-semibold text-slate-900">Gig listings</div>
              <span className="shrink-0 text-xs text-slate-500">{gigs.length} total</span>
            </div>
            {loading && <div className="mt-4 text-xs text-slate-500">Loading gigs...</div>}
            <div className="mt-4 space-y-3">
              {gigs.map((gig) => (
                <div key={gig.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="break-words text-sm font-semibold text-slate-900">{gig.title}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {gig.company} • {gig.platform}
                      </div>
                    </div>
                    <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
                      <button
                        className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400 sm:w-auto"
                        onClick={() => startEdit(gig)}
                      >
                        Edit
                      </button>
                      <button
                        className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 sm:w-auto"
                        onClick={() => deleteGig(gig.id)}
                      >
                        Remove
                      </button>
                      <select
                        className="w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 sm:w-auto"
                        value={normalizeGigType(gig.gigType)}
                        onChange={(e) => updateGigType(gig.id, e.target.value as GigType)}
                      >
                        {[...new Set([...GIG_TYPES, normalizeGigType(gig.gigType)])].map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                      <select
                        className="w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 sm:w-auto"
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
                    {gig.gigType && <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">{formatGigTypeLabel(gig.gigType)}</span>}
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                      {readProjectFieldsFromRequirements(gig.requirements).kycRequired ? "KYC required" : "KYC optional"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
            </section>
          </>
        )}

        {view === "applications" && (
          <>
            <section className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)]">
              <aside className="space-y-5 lg:sticky lg:top-28 lg:self-start">
                <div className="overflow-hidden rounded-[28px] border border-[#d5dfd6] bg-[linear-gradient(180deg,#f7fbf8,#eef4ef)] shadow-[0_24px_60px_rgba(31,79,67,0.08)]">
                  <div className="border-b border-[#d8e3db] px-5 py-5">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#6f877d]">Applications desk</div>
                    <div className="mt-2 text-2xl font-semibold leading-tight text-[#203a33]">Bulk recruiter review</div>
                    <div className="mt-2 text-sm leading-6 text-[#5f766e]">
                      A dedicated command surface for screening, onboarding, and final hiring decisions across all gigs.
                    </div>
                  </div>
                  <div className="space-y-3 px-5 py-5">
                    <label className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6f877d]">
                      Focus queue
                      <select
                        className="mt-2 w-full rounded-2xl border border-[#c9d7ce] bg-white px-3 py-3 text-sm text-slate-700 shadow-sm"
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
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-2xl border border-[#d3dfd7] bg-white px-3 py-3">
                        <div className="text-[11px] uppercase tracking-[0.14em] text-[#70857d]">Live queue</div>
                        <div className="mt-2 text-2xl font-semibold text-[#203a33]">{filteredApps.length}</div>
                        <div className="mt-1 text-[11px] text-[#70857d]">records in focus</div>
                      </div>
                      <div className="rounded-2xl border border-[#d3dfd7] bg-white px-3 py-3">
                        <div className="text-[11px] uppercase tracking-[0.14em] text-[#70857d]">Approval rate</div>
                        <div className="mt-2 text-2xl font-semibold text-[#203a33]">
                          {appsForGig.length > 0 ? `${Math.round((applicationStatusCounts.Accepted / appsForGig.length) * 100)}%` : "0%"}
                        </div>
                        <div className="mt-1 text-[11px] text-[#70857d]">accepted so far</div>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-[#d3dfd7] bg-white px-4 py-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6f877d]">Queue discipline</div>
                      <div className="mt-2 text-sm leading-6 text-[#556a62]">
                        Finalize recruiter note, onboarding direction, and communication channel before publishing a status change to the worker.
                      </div>
                    </div>
                    <div className="rounded-2xl border border-[#d3dfd7] bg-[#1f4f43] px-4 py-4 text-white">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">Operations pulse</div>
                      <div className="mt-3 space-y-2 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-white/75">Awaiting review</span>
                          <span className="font-semibold">{applicationStatusCounts.Pending + applicationStatusCounts.Applied}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-white/75">Need correction</span>
                          <span className="font-semibold">{applicationStatusCounts.Rejected}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-white/75">Submitted proposals</span>
                          <span className="font-semibold">{proposalApps.length}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </aside>

              <div className="space-y-6">
                <div className="overflow-hidden rounded-[32px] border border-[#d7e0d8] bg-white shadow-[0_24px_70px_rgba(15,43,34,0.08)]">
                  <div className="border-b border-[#e0e7e1] bg-[linear-gradient(135deg,#f6faf7,#eef5ef)] px-5 py-5 sm:px-7">
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-[#6f877d]">Recruiter operations</div>
                      <div className="mt-2 max-w-4xl text-3xl font-semibold tracking-tight text-[#203a33] sm:text-4xl">Applications command center</div>
                      <div className="mt-3 max-w-3xl text-sm leading-6 text-[#5c7169]">
                        Review applicant quality, publish recruiter guidance, issue onboarding links, and move high-intent workers through the queue without leaving this desk.
                      </div>
                    </div>
                    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {[
                        { label: "Live applications", value: appsForGig.length, tint: "bg-sky-50 text-sky-800" },
                        { label: "Pending review", value: applicationStatusCounts.Pending + applicationStatusCounts.Applied, tint: "bg-amber-50 text-amber-800" },
                        { label: "Approved", value: applicationStatusCounts.Accepted, tint: "bg-emerald-50 text-emerald-800" },
                        { label: "Corrections", value: applicationStatusCounts.Rejected, tint: "bg-rose-50 text-rose-700" },
                      ].map((item) => (
                        <div key={item.label} className="rounded-2xl border border-[#d7e2da] bg-white px-4 py-4">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#778983]">{item.label}</div>
                          <div className="mt-3 flex items-end justify-between gap-3">
                            <div className="text-3xl font-semibold text-[#203a33]">{item.value}</div>
                            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${item.tint}`}>Live</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-4 px-5 py-5 sm:px-7 lg:grid-cols-3">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Decision throughput</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-900">{applicationStatusCounts.Accepted + applicationStatusCounts.Rejected}</div>
                      <div className="mt-1 text-sm text-slate-500">Applications already reviewed in this queue.</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Onboarding ready</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-900">
                        {appsForGig.filter((app) => app.proposal?.whatsappLink?.trim()).length}
                      </div>
                      <div className="mt-1 text-sm text-slate-500">Applications with a prepared recruiter communication channel.</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Selected queue scope</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-900">{selectedGigId === "All" ? "All gigs" : "Focused"}</div>
                      <div className="mt-1 text-sm text-slate-500">
                        {selectedGigId === "All" ? "Reviewing applications across every active marketplace listing." : "Filtering review activity to one gig."}
                      </div>
                    </div>
                  </div>
                </div>

                <section className="space-y-4">
              {applicationNotice && (
                <div
                  className={`rounded-2xl border px-4 py-3 text-sm font-medium ${
                    applicationNotice.tone === "success"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-rose-200 bg-rose-50 text-rose-700"
                  }`}
                >
                  {applicationNotice.text}
                </div>
              )}

                  <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">Review queue filters</div>
                        <div className="mt-1 text-xs text-slate-500">Use status filters to process applications in batches without losing context.</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(["All", "Pending", "Accepted", "Rejected", "Applied", "Withdrawn"] as const).map((status) => {
                          const count = status === "All" ? appsForGig.length : applicationStatusCounts[status as ApplicationStatus];
                          const active = applicationStatusFilter === status;
                          return (
                            <button
                              key={status}
                              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                                active
                                  ? "border-[#bcd6c9] bg-[#edf5ef] text-[#2f6655]"
                                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                              }`}
                              onClick={() => setApplicationStatusFilter(status)}
                            >
                              {status} ({count})
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-[#d4dfd7] bg-[#f7fbf5] p-4 shadow-sm">
                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6f877d]">Bulk action studio</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">
                          {selectedApplicationIds.length} selected from the filtered queue
                        </div>
                        <div className="mt-1 text-xs leading-5 text-slate-500">
                          Apply recruiter notes and status decisions across the current filtered set without opening each application one by one.
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 xl:justify-end">
                        <button
                          className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400"
                          onClick={toggleSelectAllFilteredApplications}
                        >
                          {allFilteredSelected ? "Clear filtered selection" : "Select filtered queue"}
                        </button>
                        <button
                          className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400"
                          onClick={() => setSelectedApplicationIds([])}
                        >
                          Clear selection
                        </button>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
                      <div className="rounded-2xl border border-[#d3dfd7] bg-white px-4 py-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#70857d]">Selection shortcuts</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:border-slate-400"
                            onClick={() => selectApplicationsByStatus("Pending")}
                          >
                            Pending only
                          </button>
                          <button
                            className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:border-slate-400"
                            onClick={() => selectApplicationsByStatus("Accepted")}
                          >
                            Accepted only
                          </button>
                          <button
                            className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:border-slate-400"
                            onClick={() => selectApplicationsByStatus("Rejected")}
                          >
                            Rejected only
                          </button>
                          <button
                            className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:border-slate-400"
                            onClick={invertFilteredApplicationSelection}
                          >
                            Invert selection
                          </button>
                          <button
                            className="rounded-full border border-[#bcd6c9] bg-[#edf5ef] px-3 py-1.5 text-[11px] font-semibold text-[#2f6655] hover:border-[#9fc3b1]"
                            onClick={() => setBulkReviewDraft({ ...DEFAULT_BULK_REVIEW_DRAFT, whatsappLink: bulkReviewDraft.whatsappLink })}
                          >
                            Restore default copy
                          </button>
                        </div>
                      </div>
                      <div className="rounded-2xl border border-[#d3dfd7] bg-white px-4 py-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#70857d]">Publish mode</div>
                        <div className="mt-2 text-sm leading-6 text-slate-600">
                          Use the prepared template below to push a recruiter update or complete a bulk status action.
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-2xl border border-[#d3dfd7] bg-white px-3 py-3">
                        <div className="text-[11px] uppercase tracking-[0.14em] text-[#70857d]">Selected total</div>
                        <div className="mt-2 text-2xl font-semibold text-[#203a33]">{selectedFilteredApplications.length}</div>
                      </div>
                      <div className="rounded-2xl border border-[#d3dfd7] bg-white px-3 py-3">
                        <div className="text-[11px] uppercase tracking-[0.14em] text-[#70857d]">Selected pending</div>
                        <div className="mt-2 text-2xl font-semibold text-[#203a33]">
                          {selectedFilteredApplications.filter((app) => app.status === "Pending" || app.status === "Applied").length}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-[#d3dfd7] bg-white px-3 py-3">
                        <div className="text-[11px] uppercase tracking-[0.14em] text-[#70857d]">Selected approved</div>
                        <div className="mt-2 text-2xl font-semibold text-[#203a33]">
                          {selectedFilteredApplications.filter((app) => app.status === "Accepted").length}
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                      <div className="2xl:col-span-2 rounded-2xl border border-[#d3dfd7] bg-white px-4 py-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#70857d]">One-step onboarding template</div>
                        <div className="mt-2 text-sm leading-6 text-slate-600">
                          Standard onboarding copy is preloaded below. For the common flow, the admin only needs to paste the recruiter WhatsApp link and run the bulk approval action.
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                          <span className="rounded-full border border-[#d3dfd7] bg-[#f7fbf5] px-3 py-1.5 font-semibold text-[#2f6655]">
                            One tap update
                          </span>
                          <span>
                            Publish the latest admin note, WhatsApp link, onboarding steps, and explanation to all selected workers without changing their current review status.
                          </span>
                        </div>
                      </div>
                      <label className="rounded-2xl border border-[#d3dfd7] bg-white px-4 py-4 text-[11px] font-semibold text-slate-600">
                        Bulk admin note
                        <input
                          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                          value={bulkReviewDraft.adminNote}
                          onChange={(e) => setBulkReviewDraft((prev) => ({ ...prev, adminNote: e.target.value }))}
                          placeholder="Short worker-facing note"
                        />
                      </label>
                      <label className="rounded-2xl border border-[#d3dfd7] bg-white px-4 py-4 text-[11px] font-semibold text-slate-600">
                        Bulk WhatsApp link
                        <input
                          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                          value={bulkReviewDraft.whatsappLink}
                          onChange={(e) => setBulkReviewDraft((prev) => ({ ...prev, whatsappLink: e.target.value }))}
                          placeholder="https://chat.whatsapp.com/..."
                        />
                      </label>
                      <label className="rounded-2xl border border-[#d3dfd7] bg-white px-4 py-4 text-[11px] font-semibold text-slate-600">
                        Bulk post-onboarding steps
                        <textarea
                          className="mt-1 h-32 w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900"
                          value={bulkReviewDraft.onboardingSteps}
                          onChange={(e) => setBulkReviewDraft((prev) => ({ ...prev, onboardingSteps: e.target.value }))}
                          placeholder="Shared onboarding instruction for the selected workers."
                        />
                      </label>
                      <label className="rounded-2xl border border-[#d3dfd7] bg-white px-4 py-4 text-[11px] font-semibold text-slate-600">
                        Bulk admin explanation
                        <textarea
                          className="mt-1 h-32 w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900"
                          value={bulkReviewDraft.adminExplanation}
                          onChange={(e) => setBulkReviewDraft((prev) => ({ ...prev, adminExplanation: e.target.value }))}
                          placeholder="Internal or worker-facing explanation for the selected group."
                        />
                      </label>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        className="rounded-full border border-[#bcd6c9] bg-[#edf5ef] px-4 py-2 text-xs font-semibold text-[#2f6655] disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => runBulkApplicationInstructionPush(bulkReviewDraft)}
                        disabled={!selectedApplicationIds.length || !!bulkApplicationActionId}
                      >
                        {bulkApplicationActionId?.startsWith("Notify:") ? "Publishing..." : "Push update to selected"}
                      </button>
                      <button
                        className="rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => runBulkApplicationAction("Pending", bulkReviewDraft)}
                        disabled={!selectedApplicationIds.length || !!bulkApplicationActionId}
                      >
                        {bulkApplicationActionId?.startsWith("Pending:") ? "Updating..." : "Bulk mark pending"}
                      </button>
                      <button
                        className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => runBulkApplicationAction("Accepted", bulkReviewDraft)}
                        disabled={!selectedApplicationIds.length || !!bulkApplicationActionId}
                      >
                        {bulkApplicationActionId?.startsWith("Accepted:") ? "Approving..." : "Bulk approve"}
                      </button>
                      <button
                        className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => runBulkApplicationAction("Rejected", bulkReviewDraft)}
                        disabled={!selectedApplicationIds.length || !!bulkApplicationActionId}
                      >
                        {bulkApplicationActionId?.startsWith("Rejected:") ? "Rejecting..." : "Bulk reject"}
                      </button>
                    </div>
                  </div>

                  {filteredApps.length === 0 ? (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                      No applications match the current review filters.
                    </div>
                  ) : (
                    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)] 2xl:grid-cols-[380px_minmax(0,1fr)]">
                      <div className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="px-2 pb-3">
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Application queue</div>
                            <div className="mt-1 text-sm font-semibold text-slate-900">{filteredApps.length} active records</div>
                          </div>
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">
                            Live sync
                          </span>
                        </div>
                        <div className="rounded-2xl border border-[#d7e2da] bg-[#f7fbf5] p-3">
                          <div className="flex flex-col gap-3">
                            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px]">
                              <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#70857d]">
                                Search queue
                                <input
                                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 placeholder:text-slate-400"
                                  value={applicationQueueQuery}
                                  onChange={(e) => setApplicationQueueQuery(e.target.value)}
                                  placeholder="Worker, project, company, or proposal text"
                                />
                              </label>
                              <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#70857d]">
                                Sort by
                                <select
                                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900"
                                  value={applicationQueueSort}
                                  onChange={(e) => setApplicationQueueSort(e.target.value as typeof applicationQueueSort)}
                                >
                                  <option value="latest">Latest first</option>
                                  <option value="oldest">Oldest first</option>
                                  <option value="worker_asc">Worker name</option>
                                  <option value="gig_asc">Project title</option>
                                </select>
                              </label>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={allFilteredSelected}
                                  onChange={toggleSelectAllFilteredApplications}
                                  className="h-4 w-4 rounded border-slate-300 text-[#1f4f43] focus:ring-[#1f4f43]"
                                />
                                Select all in queue
                              </label>
                              <button
                                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:border-slate-300"
                                onClick={() => selectApplicationsByStatus("Pending")}
                              >
                                Select pending
                              </button>
                              <button
                                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:border-slate-300"
                                onClick={() => selectApplicationsByStatus("Accepted")}
                              >
                                Select accepted
                              </button>
                              <button
                                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:border-slate-300"
                                onClick={() => selectApplicationsByStatus("Rejected")}
                              >
                                Select rejected
                              </button>
                              <button
                                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:border-slate-300"
                                onClick={invertFilteredApplicationSelection}
                              >
                                Invert
                              </button>
                              <button
                                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:border-slate-300"
                                onClick={() => setSelectedApplicationIds([])}
                              >
                                Clear
                              </button>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-3">
                              <div className="rounded-2xl border border-[#d7e2da] bg-white px-3 py-3">
                                <div className="text-[11px] uppercase tracking-[0.14em] text-[#70857d]">Selected</div>
                                <div className="mt-1 text-xl font-semibold text-[#203a33]">{selectedFilteredApplications.length}</div>
                              </div>
                              <div className="rounded-2xl border border-[#d7e2da] bg-white px-3 py-3">
                                <div className="text-[11px] uppercase tracking-[0.14em] text-[#70857d]">Pending slice</div>
                                <div className="mt-1 text-xl font-semibold text-[#203a33]">
                                  {selectedFilteredApplications.filter((app) => app.status === "Pending" || app.status === "Applied").length}
                                </div>
                              </div>
                              <div className="rounded-2xl border border-[#d7e2da] bg-white px-3 py-3">
                                <div className="text-[11px] uppercase tracking-[0.14em] text-[#70857d]">Approved slice</div>
                                <div className="mt-1 text-xl font-semibold text-[#203a33]">
                                  {selectedFilteredApplications.filter((app) => app.status === "Accepted").length}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
                      {filteredApps.map((app) => {
                        const relatedGig = gigById.get(String(app.gigId));
                        const active = selectedApplication?.id === app.id;
                        const checked = selectedApplicationIds.includes(app.id);
                        return (
                          <div
                            key={app.id}
                            className={`rounded-2xl border px-3 py-3 transition ${
                              active
                                ? "border-[#bcd6c9] bg-[#f7fbf5] shadow-sm"
                                : "border-transparent bg-slate-50 hover:border-slate-200 hover:bg-white"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleApplicationSelection(app.id)}
                                    className="h-4 w-4 rounded border-slate-300 text-[#1f4f43] focus:ring-[#1f4f43]"
                                  />
                                  <button
                                    className="truncate text-left text-sm font-semibold text-slate-900"
                                    onClick={() => setSelectedApplicationId(app.id)}
                                  >
                                    {app.workerName ?? app.workerId}
                                  </button>
                                </div>
                                <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{relatedGig?.title ?? app.gigId}</div>
                              </div>
                              <span
                                className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                                  app.status === "Accepted"
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                    : app.status === "Rejected"
                                      ? "border-rose-200 bg-rose-50 text-rose-700"
                                      : "border-slate-200 bg-white text-slate-600"
                                }`}
                              >
                                {app.status}
                              </span>
                            </div>
                            <div className="mt-2 line-clamp-2 text-[11px] leading-5 text-slate-600">
                              {app.proposal?.pitch || app.proposal?.approach || "Proposal submitted"}
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-500">
                              <span>{new Date(app.appliedAt).toLocaleDateString()}</span>
                              {app.decidedAt && <span>Updated {new Date(app.decidedAt).toLocaleDateString()}</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                      </div>

                      {selectedApplicationPanel ? (
                        selectedApplicationPanel
                      ) : (
                        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-12 text-center text-sm text-slate-500">
                            Select an application from the queue to open the recruiter review workspace.
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              </div>
            </section>
          </>
        )}

        {view === "kyc-review" && (
          <section className="mt-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">KYC Review</div>
                <div className="text-xs text-slate-500">Approve or reject workspace access requests.</div>
              </div>
              <button
                className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400"
                onClick={() => {
                  void fetchKyc();
                }}
              >
                Refresh
              </button>
            </div>

            {kycLoading && (
              <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-[#1f4f43]" />
                Syncing KYC records...
              </div>
            )}
            {!kycLoading && kycLastSyncAt && (
              <div className="mt-3 text-[11px] text-slate-500">Last synced {new Date(kycLastSyncAt).toLocaleString()}</div>
            )}
            {kycError && (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                {kycError}
              </div>
            )}
            {kycNotice && (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                {kycNotice}
              </div>
            )}

            <div className="mt-4 grid gap-3">
              {kycLoading && kycRows.length === 0 && (
                <>
                  {Array.from({ length: 2 }).map((_, idx) => (
                    <div key={`kyc-skeleton-${idx}`} className="animate-pulse rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="h-5 w-40 rounded-md bg-slate-200" />
                      <div className="mt-3 h-4 w-64 rounded-md bg-slate-200" />
                      <div className="mt-2 h-4 w-52 rounded-md bg-slate-200" />
                      <div className="mt-4 grid gap-2 sm:grid-cols-2">
                        <div className="h-10 rounded-md bg-slate-200" />
                        <div className="h-10 rounded-md bg-slate-200" />
                      </div>
                    </div>
                  ))}
                </>
              )}
              {kycRows.length === 0 && !kycLoading && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-xs text-slate-500">
                  No KYC requests yet.
                </div>
              )}
              {kycRows.map((row) => (
                <div key={row.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="break-words text-sm font-semibold text-slate-900">{row.legal_name}</div>
                      {row.email && <div className="mt-1 text-xs text-slate-500">{row.email}</div>}
                      <div className="mt-1 break-all text-xs text-slate-500">User ID: {row.user_id}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {row.id_type} • {row.id_number}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{row.phone}</div>
                      <div className="mt-1 break-words text-xs text-slate-500">{row.address}</div>
                      <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                        {row.id_doc_url && (
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
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
                            {row.id_doc_path && (
                              <a
                                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700"
                                href={`/api/kyc/file?path=${encodeURIComponent(row.id_doc_path)}&name=id-${row.id}.jpg`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Download
                              </a>
                            )}
                          </div>
                        )}
                        {row.selfie_url && (
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
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
                            {row.selfie_path && (
                              <a
                                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700"
                                href={`/api/kyc/file?path=${encodeURIComponent(row.selfie_path)}&name=selfie-${row.id}.jpg`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Download
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex w-full flex-col gap-2 text-xs lg:w-[300px] lg:items-stretch">
                      <span className="self-start rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-600">
                        {row.status}
                      </span>
                      <input
                        className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                        placeholder="Admin note (visible in timeline)"
                        value={kycNoteDraft[row.id] ?? ""}
                        onChange={(e) => setKycNoteDraft((p) => ({ ...p, [row.id]: e.target.value }))}
                        onBlur={async () => {
                          const note = kycNoteDraft[row.id] ?? "";
                          const { data } = await supabase.auth.getSession();
                          const token = data.session?.access_token;
                          if (!token) return;
                          const res = await fetch("/api/admin/kyc", {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                            body: JSON.stringify({ id: row.id, status: row.status, adminNote: note }),
                          });
                          const payload = await res.json().catch(() => ({}));
                          if (!res.ok) setKycError(payload?.error || "Failed to update KYC note");
                          fetchKyc({ preserveFeedback: true });
                        }}
                      />
                      <button
                        className="w-full rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 font-semibold text-emerald-700"
                        onClick={async () => {
                          setKycError(null);
                          setKycNotice(null);
                          const note = kycNoteDraft[row.id] ?? null;
                          const { data } = await supabase.auth.getSession();
                          const token = data.session?.access_token;
                          if (!token) return;
                          const res = await fetch("/api/admin/kyc", {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                            body: JSON.stringify({ id: row.id, status: "approved", adminNote: note }),
                          });
                          const payload = await res.json().catch(() => ({}));
                          if (!res.ok) {
                            setKycError(payload?.error || "Failed to approve KYC");
                          } else if (payload?.mailStatus?.sent) {
                            setKycNotice(`KYC approved and notification sent to ${payload.mailStatus.recipient}.`);
                          } else if (payload?.mailStatus?.reason) {
                            setKycError(`KYC approved, but email notification was not sent: ${payload.mailStatus.reason}`);
                          }
                          await fetchKyc({ preserveFeedback: true });
                        }}
                      >
                        Approve
                      </button>
                      <button
                        className="w-full rounded-full border border-rose-200 bg-rose-50 px-3 py-1 font-semibold text-rose-700"
                        onClick={async () => {
                          setKycError(null);
                          setKycNotice(null);
                          const reason = window.prompt("Rejection reason (optional)");
                          const note = kycNoteDraft[row.id] ?? null;
                          const { data } = await supabase.auth.getSession();
                          const token = data.session?.access_token;
                          if (!token) return;
                          const res = await fetch("/api/admin/kyc", {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                            body: JSON.stringify({ id: row.id, status: "rejected", rejectionReason: reason ?? null, adminNote: note }),
                          });
                          const payload = await res.json().catch(() => ({}));
                          if (!res.ok) {
                            setKycError(payload?.error || "Failed to reject KYC");
                          } else if (payload?.mailStatus?.sent) {
                            setKycNotice(`KYC rejected and notification sent to ${payload.mailStatus.recipient}.`);
                          } else if (payload?.mailStatus?.reason) {
                            setKycError(`KYC rejected, but email notification was not sent: ${payload.mailStatus.reason}`);
                          }
                          await fetchKyc({ preserveFeedback: true });
                        }}
                      >
                        Reject
                      </button>
                      {Array.isArray(row.events) && row.events.length > 0 && (
                        <button
                          className="w-full rounded-full border border-slate-300 px-3 py-1 font-semibold text-slate-700 hover:border-slate-400"
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
                      {row.events.slice(0, 3).map((ev: KycEvent, idx: number) => (
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
        )}

        {view === "kyc-review" && kycTimeline && (
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
                {(kycTimeline.events ?? []).map((ev: KycEvent, idx: number) => (
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

        {view === "credential-submissions" && (
          <section className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
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
                className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400 disabled:opacity-60 sm:ml-auto"
                onClick={refreshAssignments}
                disabled={assignmentsRefreshing}
              >
                {assignmentsRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {assignmentNotice && (
                <div
                  className={`rounded-2xl border px-4 py-3 text-sm font-medium ${
                    assignmentNotice.tone === "success"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-rose-200 bg-rose-50 text-rose-700"
                  }`}
                >
                  {assignmentNotice.text}
                </div>
              )}
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
                <div key={assignment.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="break-words text-sm font-semibold text-slate-900">{assignment.workerId}</div>
                      <div className="mt-1 text-xs text-slate-500">Gig: {assignment.gigId}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        Emails: {assignment.assignedEmails?.length ? `${assignment.assignedEmails.length} assigned` : assignment.assignedEmail}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 sm:justify-end">
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
                      className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 disabled:opacity-60"
                      onClick={() => updateAssignment(assignment, "Accepted")}
                      disabled={assignmentActionId === assignment.id}
                    >
                      {assignmentActionId === assignment.id ? "Saving..." : "Approve only"}
                    </button>
                    <button
                      className="rounded-full border border-[#25473b] bg-[#25473b] px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
                      onClick={() => updateAssignment(assignment, "Accepted", { releaseFundsNow: true })}
                      disabled={assignmentActionId === assignment.id}
                    >
                      {assignmentActionId === assignment.id ? "Releasing..." : "Approve & release funds"}
                    </button>
                    <button
                      className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 disabled:opacity-60"
                      onClick={() => updateAssignment(assignment, "Pending")}
                      disabled={assignmentActionId === assignment.id}
                    >
                      Keep pending
                    </button>
                    <button
                      className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 disabled:opacity-60"
                      onClick={() => updateAssignment(assignment, "Rejected")}
                      disabled={assignmentActionId === assignment.id}
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="break-all text-xs text-slate-500">Assignment: {selectedAssignment.id}</div>
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
        )}
      </main>
    </div>
  );
}

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
const GIG_TYPES: GigType[] = ["Email Creator", "Workspace", "Custom"];

function normalizeGigType(raw?: string) {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!value) return "Email Creator";
  if (value === "part-time" || value === "part time") return "Email Creator";
  if (value === "full-time" || value === "full time" || value === "workspace") return "Workspace";
  return raw ?? "Email Creator";
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
  if (input.gigType === "Custom") {
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

export type GigAdminView = "create-new-gig" | "kyc-review" | "credential-submissions";

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
  const [kycRows, setKycRows] = useState<KycRow[]>([]);
  const [kycLoading, setKycLoading] = useState(false);
  const [kycError, setKycError] = useState<string | null>(null);
  const [kycNoteDraft, setKycNoteDraft] = useState<Record<string, string>>({});
  const [kycTimeline, setKycTimeline] = useState<KycRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [kycLastSyncAt, setKycLastSyncAt] = useState<string | null>(null);
  const [selectedGigId, setSelectedGigId] = useState<string | "All">("All");
  const [editingGig, setEditingGig] = useState<Gig | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [mediaUploading, setMediaUploading] = useState(false);
  const [mediaUploadError, setMediaUploadError] = useState<string | null>(null);
  const [proposalReviewDraft, setProposalReviewDraft] = useState<
    Record<string, { adminNote: string; adminExplanation: string; whatsappLink: string; onboardingSteps?: string }>
  >({});

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

  const filteredApps = useMemo(() => {
    if (selectedGigId === "All") return apps;
    return apps.filter((app) => app.gigId === selectedGigId);
  }, [apps, selectedGigId]);
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

  const validateForm = () => {
    if (!form.title.trim()) return "Title is required.";
    if (!form.company.trim()) return "Company is required.";
    if (!form.workload.trim()) return "Workload is required.";
    if (!form.payout.trim()) return "Payout is required.";
    if (form.gigType === "Custom" && !form.customGigType.trim()) return "Custom gig type label is required.";
    if (form.gigType === "Custom" && !form.customBrief.trim()) return "Custom brief is required for custom gigs.";
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
        ? `Custom: ${form.customGigType.trim() || "Freelance"}`
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
    const isCustom = normalizedType.toLowerCase().startsWith("custom:");
    const customLabel = isCustom ? normalizedType.replace(/^custom:\s*/i, "").trim() : "";
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
      gigType: isCustom ? "Custom" : normalizedType,
      customGigType: customLabel,
      customBrief: customFields.customBrief,
      customRequirements: customFields.customRequirements,
      customMedia: customFields.customMedia,
      projectBrief: projectFields.projectBrief,
      hiringCapacity: projectFields.hiringCapacity,
      expertise: projectFields.expertise,
      languages: projectFields.languages,
      onboardingRequired: projectFields.onboardingRequired,
      kycRequired: isCustom ? customFields.kycRequired : projectFields.kycRequired,
      requirements: isCustom ? customFields.customRequirements.replace(/\n/g, ", ") : projectFields.requirementsText,
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
        ? `Custom: ${form.customGigType.trim() || "Freelance"}`
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
        ? `Custom: ${window.prompt("Enter custom gig type label", "Freelance")?.trim() || "Freelance"}`
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
    statusOverride?: ApplicationStatus
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

    try {
      await fetch("/api/gig-applications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: app.id,
          updates: {
            status,
            decidedAt,
            workerName: app.workerName ?? app.workerId,
            proposal: nextProposal,
          },
        }),
      });
    } catch {
      // ignore
    }
  };

  const updateApplication = async (
    app: GigApplication,
    status: ApplicationStatus,
    review?: { adminNote?: string; adminExplanation?: string; whatsappLink?: string; onboardingSteps?: string }
  ) => {
    await persistApplicationReview(app, review, status);
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

  return (
    <div className="ops-dashboard-skin min-h-screen bg-slate-50 text-slate-900">
      <div className="sticky top-0 z-40 border-b border-[#d5ddcf] bg-[#f8faf7]/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-start justify-between gap-3 px-4 py-4 sm:px-5 sm:py-6">
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

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-5 sm:py-8">
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
              {form.gigType === "Custom" && (
                <label className="text-xs font-semibold text-slate-600 md:col-span-2">
                  Custom brief (shown in proposal desk)
                  <textarea
                    className="mt-2 h-24 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    value={form.customBrief}
                    onChange={(e) => setForm((prev) => ({ ...prev, customBrief: e.target.value }))}
                    placeholder="Describe the custom project scope, expectations, and decision criteria."
                  />
                </label>
              )}
              {form.gigType === "Custom" && (
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
              {form.gigType === "Custom" && (
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
                    Uploaded media will appear in worker proposal UI automatically.
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
              {form.gigType !== "Custom" && (
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
              {form.gigType !== "Custom" && (
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
              {form.gigType !== "Custom" && (
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
              {form.gigType !== "Custom" && (
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

        <section className="mt-10 grid gap-6 lg:grid-cols-[1fr_1fr]">
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
                    {gig.gigType && <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">{gig.gigType}</span>}
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                      {readProjectFieldsFromRequirements(gig.requirements).kycRequired ? "KYC required" : "KYC optional"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">Applications</div>
                <div className="text-xs text-slate-500">Review and approve applicants.</div>
              </div>
              <select
                className="w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 sm:w-auto"
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
              <div className="rounded-2xl border border-[#d4dfd7] bg-[#f7fbf5] p-3 sm:p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#6f877d]">Submitted proposals</div>
                  <span className="rounded-full border border-[#bcd6c9] bg-[#edf5ef] px-2 py-0.5 text-[11px] font-semibold text-[#2f6655]">
                    {proposalApps.length}
                  </span>
                </div>
                {proposalApps.length === 0 ? (
                  <div className="mt-2 text-xs text-[#6f877d]">
                    No proposal received yet.
                  </div>
                ) : (
                  <div className="mt-2 space-y-2">
                    {proposalApps.map((app) => (
                      <div key={`proposal-${app.id}`} className="rounded-xl border border-[#d4dfd7] bg-white px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-xs font-semibold text-slate-800">{app.workerName ?? app.workerId}</div>
                          <div className="text-[11px] text-slate-500">Gig: {app.gigId}</div>
                        </div>
                        <div className="mt-1 text-[11px] text-slate-600 line-clamp-2">{app.proposal?.pitch || app.proposal?.approach || "Proposal submitted"}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {filteredApps.length === 0 && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-xs text-slate-500">
                  No applications yet.
                </div>
              )}
              {filteredApps.map((app) => (
                <div key={app.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
                  {(() => {
                    const draft = proposalReviewDraft[app.id] ?? {
                      adminNote: app.proposal?.adminNote ?? "",
                      adminExplanation: app.proposal?.adminExplanation ?? "",
                      whatsappLink: app.proposal?.whatsappLink ?? "",
                      onboardingSteps: app.proposal?.onboardingSteps ?? "",
                    };
                    return (
                      <>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="break-words text-sm font-semibold text-slate-900">{app.workerName ?? app.workerId}</div>
                      <div className="mt-1 text-xs text-slate-500">Gig: {app.gigId}</div>
                    </div>
                    <span className="self-start rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600">
                      {app.status}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>Applied {new Date(app.appliedAt).toLocaleDateString()}</span>
                    {app.decidedAt && <span>• Reviewed {new Date(app.decidedAt).toLocaleDateString()}</span>}
                  </div>
                  {app.proposal && (
                    <div className="mt-3 rounded-xl border border-[#d4dfd7] bg-white p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6f877d]">Submitted proposal</div>
                      {app.proposal.pitch && (
                        <div className="mt-2 text-xs text-slate-600">
                          <span className="font-semibold text-slate-700">Pitch:</span> {app.proposal.pitch}
                        </div>
                      )}
                      {app.proposal.approach && (
                        <div className="mt-2 text-xs text-slate-600">
                          <span className="font-semibold text-slate-700">Approach:</span> {app.proposal.approach}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                        {app.proposal.timeline && (
                          <span className="rounded-full border border-[#d4dfd7] bg-[#f7fbf5] px-2 py-1 text-[#4d665c]">
                            Timeline: {app.proposal.timeline}
                          </span>
                        )}
                        {app.proposal.budget && (
                          <span className="rounded-full border border-[#d4dfd7] bg-[#f7fbf5] px-2 py-1 text-[#4d665c]">
                            Budget note: {app.proposal.budget}
                          </span>
                        )}
                        {app.proposal.submittedAt && (
                          <span className="rounded-full border border-[#d4dfd7] bg-[#f7fbf5] px-2 py-1 text-[#4d665c]">
                            Submitted: {new Date(app.proposal.submittedAt).toLocaleString()}
                          </span>
                        )}
                      </div>
                      {app.proposal.portfolio && (
                        <div className="mt-2 text-xs text-slate-600">
                          <span className="font-semibold text-slate-700">Portfolio:</span> {app.proposal.portfolio}
                        </div>
                      )}
                      {app.proposal.onboardingSteps && (
                        <div className="mt-2 text-xs text-slate-600">
                          <span className="font-semibold text-slate-700">Post-onboarding steps:</span> {app.proposal.onboardingSteps}
                        </div>
                      )}
                      {app.proposal.reviewedAt && (
                        <div className="mt-2 text-[11px] text-slate-500">Reviewed: {new Date(app.proposal.reviewedAt).toLocaleString()}</div>
                      )}
                      {app.proposal.groupJoinedConfirmed && (
                        <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                          Worker confirmed WhatsApp group joined
                          {app.proposal.groupJoinedConfirmedAt ? ` (${new Date(app.proposal.groupJoinedConfirmedAt).toLocaleString()})` : ""}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <label className="text-[11px] font-semibold text-slate-600">
                      Admin note
                      <input
                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
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
                        placeholder="Short status note for worker feed"
                      />
                    </label>
                    <label className="text-[11px] font-semibold text-slate-600">
                      WhatsApp group link
                      <input
                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
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
                  <label className="mt-2 block text-[11px] font-semibold text-slate-600">
                    Post-onboarding steps
                    <textarea
                      className="mt-1 h-16 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
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
                  <label className="mt-2 block text-[11px] font-semibold text-slate-600">
                    Admin explanation
                    <textarea
                      className="mt-1 h-16 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
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
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700"
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
                      className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"
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
                      className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700"
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
                      </>
                    );
                  })()}
                </div>
              ))}
            </div>
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
                onClick={fetchKyc}
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
                          await fetch("/api/admin/kyc", {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                            body: JSON.stringify({ id: row.id, status: row.status, adminNote: note }),
                          });
                          fetchKyc();
                        }}
                      />
                      <button
                        className="w-full rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 font-semibold text-emerald-700"
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
                        className="w-full rounded-full border border-rose-200 bg-rose-50 px-3 py-1 font-semibold text-rose-700"
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

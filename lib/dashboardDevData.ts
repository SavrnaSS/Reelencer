import { resolveGigApplicationMode, type GigApplicationMode } from "@/lib/gigApplicationMode";

type DevGig = {
  id: string;
  title: string;
  company: string;
  verified: boolean;
  platform: string;
  location: string;
  workload?: string;
  payout: string;
  payoutType?: string;
  gigType?: string;
  requirements: string[];
  applicationMode?: GigApplicationMode;
  status: string;
  postedAt: string;
  browsePinned?: boolean;
  browsePinRank?: number | null;
  browsePinLabel?: string;
  newCreatorHold?: boolean;
};

type DevApplication = {
  id: string;
  gigId: string;
  workerId: string;
  status: string;
  appliedAt: string;
  decidedAt?: string;
  workerName?: string;
  workerEmail?: string;
  workerUserId?: string;
  proposal?: {
    pitch?: string;
    approach?: string;
    timeline?: string;
    budget?: string;
    portfolio?: string;
    submittedAt?: string;
    reviewStatus?: "Pending" | "Accepted" | "Rejected";
    applicationMode?: "direct_apply" | "proposal";
    source?: string;
    consentAcceptedAt?: string;
    consentText?: string;
    profileSnapshotName?: string;
    profileSnapshotEmail?: string;
    adminNote?: string;
    adminExplanation?: string;
    whatsappLink?: string;
    onboardingSteps?: string;
    groupJoinedConfirmed?: boolean;
    groupJoinedConfirmedAt?: string;
    reviewedAt?: string;
  };
};

type DevAssignment = {
  id: string;
  gigId: string;
  workerId: string;
  assignedEmail?: string;
  assignedEmails?: string[];
  status: string;
  submittedAt?: string;
  decidedAt?: string;
  createdAt: string;
  earningsReleaseStatus?: "none" | "queued" | "credited" | "blocked";
  earningsReleasedAt?: string;
  subjectFilter?: string;
};

type DevPayoutBatch = {
  id: string;
  cycleLabel: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  createdAt: string;
  processedAt?: string;
  paidAt?: string;
  method: string;
  notes?: string[];
  items: Array<{
    id: string;
    workItemId: string;
    workItemPublicId?: string;
    workerId: string;
    handle: string;
    amountINR: number;
    status: string;
    reason?: string;
    sourceAssignmentId?: string;
  }>;
};

type DevWorkerProfile = {
  id: string;
  workerId: string;
  userId?: string;
  name: string;
  email: string;
  headline?: string;
  city?: string;
  bio?: string;
  active: boolean;
  assignedAccountIds: string[];
  assignedAccounts: Array<{
    id: string;
    handle: string;
    niche: string;
    ownerTeam: string;
    policyTier: string;
    health: string;
    rules: string[];
    allowedAudios: string[];
    requiredHashtags: string[];
  }>;
  assignedAccountSchedules?: Record<string, { times: string[]; days: number[]; deadlineMin: number; timezone: string }>;
};

type DevDashboardState = {
  gigs: DevGig[];
  applications: DevApplication[];
  assignments: DevAssignment[];
  payoutBatches: DevPayoutBatch[];
  workers: DevWorkerProfile[];
  sequence: {
    application: number;
    assignment: number;
    gig: number;
  };
};

const DEFAULT_WORKER_ID = "WKR-TEST";
const NOISE_FREE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

const globalForDashboard = globalThis as typeof globalThis & {
  __reelencerDashboardDevStoreV1?: DevDashboardState;
};

export function isDashboardDevMode() {
  return process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === "true";
}

export function dashboardDevHeaders() {
  return NOISE_FREE_HEADERS;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function iso(offsetDays = 0, hour = 10, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function dateOnly(offsetDays = 0) {
  return iso(offsetDays).slice(0, 10);
}

function normalizeWorkerId(value?: string | null) {
  return String(value ?? "").trim();
}

function workerIdentity(workerId: string) {
  const compact = normalizeWorkerId(workerId)
    .replace(/^WKR[-_]?/i, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim();
  const name = (compact || "Creator")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
  const local = (compact || "creator").toLowerCase().replace(/\s+/g, ".");
  return {
    name,
    email: `${local}@example.test`,
  };
}

function isGeneratedDevEmail(email: string) {
  return !email.trim() || email.trim().toLowerCase().endsWith("@example.test");
}

function normalizeDevWorkerProfile<T extends { id: string; workerId: string; userId?: string; name: string; email: string }>(worker: T): T {
  const userId = String(worker.userId ?? "").trim().toLowerCase();
  const workerId = normalizeWorkerId(worker.workerId || worker.id);
  if (!workerId || !userId.startsWith("dev-") || !/^WKR-/i.test(workerId)) return worker;
  const identity = workerIdentity(workerId);
  const currentName = String(worker.name ?? "").trim();
  const currentEmail = String(worker.email ?? "").trim();
  const shouldUseGeneratedName = !currentName || ["creator", "local creator"].includes(currentName.toLowerCase());
  return {
    ...worker,
    name: shouldUseGeneratedName ? identity.name : currentName,
    email: isGeneratedDevEmail(currentEmail) ? identity.email : currentEmail,
  };
}

function same(value: unknown, target: unknown) {
  return String(value ?? "").trim().toLowerCase() === String(target ?? "").trim().toLowerCase();
}

function normalizeGig(input: Record<string, unknown>): DevGig {
  const requirements = Array.isArray(input.requirements)
    ? input.requirements.map((item) => String(item)).filter(Boolean)
    : [];
  const rawApplicationMode =
    typeof input.application_mode === "string"
      ? input.application_mode
      : typeof input.applicationMode === "string"
        ? input.applicationMode
        : null;

  return {
    id: String(input.id ?? ""),
    title: String(input.title ?? ""),
    company: String(input.company ?? ""),
    verified: input.verified === undefined ? true : Boolean(input.verified),
    platform: String(input.platform ?? ""),
    location: String(input.location ?? "Remote"),
    workload: input.workload === undefined ? undefined : String(input.workload),
    payout: String(input.payout ?? ""),
    payoutType: input.payoutType === undefined && input.payout_type === undefined ? undefined : String(input.payoutType ?? input.payout_type),
    gigType: input.gigType === undefined && input.gig_type === undefined ? "Email Creator" : String(input.gigType ?? input.gig_type),
    requirements,
    applicationMode: resolveGigApplicationMode({ requirements, applicationMode: rawApplicationMode }, "apply"),
    status: String(input.status ?? "Open"),
    postedAt: String(input.postedAt ?? input.posted_at ?? new Date().toISOString()),
    browsePinned: Boolean(input.browsePinned ?? input.browse_pinned),
    browsePinRank:
      input.browsePinRank === undefined && input.browse_pin_rank === undefined
        ? undefined
        : Number(input.browsePinRank ?? input.browse_pin_rank),
    browsePinLabel: input.browsePinLabel === undefined && input.browse_pin_label === undefined ? undefined : String(input.browsePinLabel ?? input.browse_pin_label),
    newCreatorHold: Boolean(input.newCreatorHold ?? input.new_creator_hold),
  };
}

function seedState(): DevDashboardState {
  const creatorAccount = {
    id: "ACC-LOCAL-REELS",
    handle: "@local.creator.lab",
    niche: "Creator growth",
    ownerTeam: "Reelencer Ops",
    policyTier: "Standard",
    health: "Healthy",
    rules: ["Use assigned captions", "Upload proof before payout review"],
    allowedAudios: ["Original audio", "Licensed trend audio"],
    requiredHashtags: ["#reelencer", "#creatorgrowth"],
  };
  const defaultIdentity = workerIdentity(DEFAULT_WORKER_ID);
  const devIdentity = workerIdentity("WKR-DEV");

  return {
    gigs: [
      {
        id: "GIG-UGC-LAUNCH",
        title: "Short-form UGC launch reel",
        company: "GlowCart",
        verified: true,
        platform: "Instagram",
        location: "Remote, India",
        workload: "3 reels in 7 days",
        payout: "INR 4,500 per campaign",
        payoutType: "Per campaign",
        gigType: "Content Posting",
        requirements: [
          "brief::Create a launch reel with hook, product use, and proof-style CTA.",
          "meta::application_mode=proposal",
          "Hook writing",
          "Creator voiceover",
          "Proof upload required",
        ],
        applicationMode: "proposal",
        status: "Open",
        postedAt: iso(-1, 9, 30),
        browsePinned: true,
        browsePinRank: 1,
        browsePinLabel: "Featured",
      },
      {
        id: "GIG-SOCIAL-OPS",
        title: "Daily social posting operator",
        company: "Reelencer Labs",
        verified: true,
        platform: "Instagram",
        location: "Remote",
        workload: "2 posting windows per day",
        payout: "INR 12,000 monthly",
        payoutType: "Monthly",
        gigType: "Workspace",
        requirements: [
          "brief::Handle scheduled posting tasks, captions, proof submission, and checklist updates.",
          "meta::application_mode=apply",
          "Daily availability",
          "Caption discipline",
          "Account safety rules",
        ],
        applicationMode: "apply",
        status: "Open",
        postedAt: iso(-2, 14, 15),
        browsePinned: true,
        browsePinRank: 2,
        browsePinLabel: "Workspace",
      },
      {
        id: "GIG-BRAND-COMMENTS",
        title: "Comment reply sprint",
        company: "UrbanSip",
        verified: true,
        platform: "Instagram",
        location: "Mumbai, India",
        workload: "90 minutes per evening",
        payout: "INR 850 per sprint",
        payoutType: "Per sprint",
        gigType: "Project",
        requirements: [
          "brief::Reply to campaign comments with approved tone and escalation notes.",
          "meta::application_mode=apply",
          "Fast response quality",
          "Hindi and English preferred",
        ],
        applicationMode: "apply",
        status: "Open",
        postedAt: iso(-3, 18, 45),
      },
      {
        id: "GIG-EMAIL-CREATOR",
        title: "Creator email onboarding pack",
        company: "FasterDrop",
        verified: true,
        platform: "Email",
        location: "Remote",
        workload: "5 dashboard emails",
        payout: "INR 2,000 setup",
        payoutType: "Fixed",
        gigType: "Email Creator",
        requirements: [
          "brief::Activate assigned dashboard emails and complete inbox verification steps.",
          "meta::application_mode=apply",
          "Email verification",
          "Credential accuracy",
        ],
        applicationMode: "apply",
        status: "Open",
        postedAt: iso(-4, 11, 10),
      },
    ],
    applications: [
      {
        id: "APP-DEV-1001",
        gigId: "GIG-UGC-LAUNCH",
        workerId: DEFAULT_WORKER_ID,
        workerName: "Local Creator",
        workerEmail: "wkr-test@example.test",
        status: "Pending",
        appliedAt: iso(-1, 12, 20),
        proposal: {
          pitch: "I can deliver a clean demo-led launch reel with a fast hook and proof CTA.",
          approach: "Shoot product use, cut with captions, submit one final proof link.",
          timeline: "48 hours",
          budget: "INR 4,500",
          submittedAt: iso(-1, 12, 20),
          reviewStatus: "Pending",
          applicationMode: "proposal",
          source: "dashboard-dev",
          profileSnapshotName: "Local Creator",
          profileSnapshotEmail: "wkr-test@example.test",
        },
      },
    ],
    assignments: [
      {
        id: "ASG-DEV-1001",
        gigId: "GIG-SOCIAL-OPS",
        workerId: DEFAULT_WORKER_ID,
        assignedEmail: "studio.signal.inbox.test412@fasterdrop.site",
        assignedEmails: [
          "studio.signal.inbox.test412@fasterdrop.site",
          "desk.atlas.workflow.test581@fasterdrop.site",
          "ops.harbor.registry.test706@fasterdrop.site",
          "hub.vector.dispatch.test273@fasterdrop.site",
          "team.prime.postbox.test844@fasterdrop.site",
        ],
        status: "Accepted",
        createdAt: iso(-2, 16, 0),
        decidedAt: iso(-1, 17, 30),
        earningsReleaseStatus: "queued",
        subjectFilter: "reelencer-dashboard",
      },
    ],
    payoutBatches: [
      {
        id: "PAY-DEV-1001",
        cycleLabel: "Current creator cycle",
        periodStart: dateOnly(-7),
        periodEnd: dateOnly(),
        status: "Processing",
        createdAt: iso(-1, 19, 0),
        processedAt: iso(0, 9, 15),
        method: "UPI",
        notes: ["Pending release after final assignment proof review."],
        items: [
          {
            id: "PAYITEM-DEV-1001",
            workItemId: "ASG-DEV-1001",
            workItemPublicId: "GIGCRED-ASGDEV1001",
            workerId: DEFAULT_WORKER_ID,
            handle: "@local.creator.lab",
            amountINR: 2500,
            status: "Queued",
            sourceAssignmentId: "ASG-DEV-1001",
          },
        ],
      },
    ],
    workers: [
      {
        id: DEFAULT_WORKER_ID,
        workerId: DEFAULT_WORKER_ID,
        userId: "dev-dashboard-user",
        name: defaultIdentity.name,
        email: defaultIdentity.email,
        headline: "Short-form creator and social posting operator",
        city: "Remote, India",
        bio: "Local development creator profile wired to live dashboard APIs.",
        active: true,
        assignedAccountIds: [creatorAccount.id],
        assignedAccounts: [creatorAccount],
        assignedAccountSchedules: {
          [creatorAccount.id]: { times: ["10:00", "18:00"], days: [0, 1, 2, 3, 4, 5, 6], deadlineMin: 180, timezone: "Asia/Kolkata" },
        },
      },
      {
        id: "WKR-DEV",
        workerId: "WKR-DEV",
        userId: "dev-worker-generic",
        name: devIdentity.name,
        email: devIdentity.email,
        headline: "Creator operations profile",
        city: "Remote",
        bio: "Fallback local creator profile.",
        active: true,
        assignedAccountIds: [creatorAccount.id],
        assignedAccounts: [creatorAccount],
      },
    ],
    sequence: {
      application: 1001,
      assignment: 1001,
      gig: 1004,
    },
  };
}

function state() {
  globalForDashboard.__reelencerDashboardDevStoreV1 ??= seedState();
  return globalForDashboard.__reelencerDashboardDevStoreV1;
}

function nextId(prefix: string, key: keyof DevDashboardState["sequence"]) {
  const store = state();
  store.sequence[key] += 1;
  return `${prefix}-${store.sequence[key]}`;
}

function withRequestedWorker<T extends { workerId: string }>(rows: T[], workerId?: string | null) {
  const requested = normalizeWorkerId(workerId);
  if (!requested) return rows;

  const exact = rows.filter((row) => same(row.workerId, requested));
  if (exact.length) return exact;

  if (/^WKR-/i.test(requested)) {
    return rows
      .filter((row) => same(row.workerId, DEFAULT_WORKER_ID))
      .map((row) => ({ ...row, workerId: requested }));
  }

  return [];
}

/** Gigs in the team's feed order (the array order); new gigs join at the bottom. */
export function getDevDashboardGigs() {
  return clone(state().gigs).map((gig, index) => ({ ...gig, createdAt: gig.postedAt, feedPosition: index + 1 }));
}

/** Listed gigs move to the top in the given order; the rest keep their relative order after them. */
export function reorderDevDashboardGigs(ids: readonly string[]) {
  const store = state();
  const rank = new Map(ids.map((id, index) => [id, index]));
  const before = store.gigs.map(gig => gig.id).join("\n");
  store.gigs = store.gigs
    .map((gig, index) => ({ gig, index }))
    .sort((a, b) => (rank.get(a.gig.id) ?? ids.length + a.index) - (rank.get(b.gig.id) ?? ids.length + b.index))
    .map(entry => entry.gig);
  return before === store.gigs.map(gig => gig.id).join("\n") ? 0 : store.gigs.length;
}

export function createDevDashboardGig(input: unknown) {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const id = String(body.id ?? `GIG-DEV-${nextId("", "gig").replace(/^-/, "")}`).trim();
  const gig = normalizeGig({
    ...body,
    id,
    verified: body.verified ?? true,
    status: body.status ?? "Open",
    postedAt: body.postedAt ?? new Date().toISOString(),
  });

  if (!gig.id || !gig.title || !gig.company || !gig.workload || !gig.payout) {
    return { ok: false as const, error: "Missing required fields" };
  }

  const store = state();
  const existing = store.gigs.findIndex((item) => same(item.id, gig.id));
  if (existing >= 0) store.gigs[existing] = gig;
  else store.gigs = [...store.gigs, gig];
  return { ok: true as const, gig: clone(gig) };
}

export function updateDevDashboardGig(id: string, updates: unknown) {
  const store = state();
  const index = store.gigs.findIndex((gig) => same(gig.id, id));
  if (index < 0) return { ok: false as const, error: "Gig not found" };
  const body = (updates && typeof updates === "object" ? updates : {}) as Record<string, unknown>;
  const next = normalizeGig({ ...store.gigs[index], ...body, id: store.gigs[index].id });
  store.gigs[index] = next;
  return { ok: true as const, gig: clone(next) };
}

export function deleteDevDashboardGig(id: string) {
  const store = state();
  const before = store.gigs.length;
  store.gigs = store.gigs.filter((gig) => !same(gig.id, id));
  store.applications = store.applications.filter((application) => !same(application.gigId, id));
  store.assignments = store.assignments.filter((assignment) => !same(assignment.gigId, id));
  return { ok: before !== store.gigs.length };
}

export function getDevDashboardApplications(filters: { gigId?: string | null; workerId?: string | null }) {
  let rows = state().applications;
  if (filters.gigId) rows = rows.filter((row) => same(row.gigId, filters.gigId));
  rows = withRequestedWorker(rows, filters.workerId);
  return clone(rows);
}

export function upsertDevDashboardApplication(input: unknown) {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const gigId = String(body.gigId ?? "").trim();
  const workerId = String(body.workerId ?? "").trim();
  if (!gigId || !workerId) return { ok: false as const, error: "gigId and workerId required" };

  const store = state();
  const existingIndex = store.applications.findIndex((item) => same(item.gigId, gigId) && same(item.workerId, workerId));
  const existing = existingIndex >= 0 ? store.applications[existingIndex] : null;
  const application: DevApplication = {
    id: String(body.id ?? existing?.id ?? nextId("APP-DEV", "application")),
    gigId,
    workerId,
    workerName: body.workerName === undefined ? existing?.workerName : String(body.workerName ?? ""),
    workerEmail: body.workerEmail === undefined ? existing?.workerEmail : String(body.workerEmail ?? ""),
    workerUserId: body.workerUserId === undefined ? existing?.workerUserId : String(body.workerUserId ?? ""),
    status: String(body.status ?? existing?.status ?? "Pending"),
    appliedAt: existing?.appliedAt ?? new Date().toISOString(),
    decidedAt: existing?.decidedAt,
    proposal:
      body.proposal && typeof body.proposal === "object"
        ? (body.proposal as DevApplication["proposal"])
        : existing?.proposal,
  };

  if (existingIndex >= 0) store.applications[existingIndex] = application;
  else store.applications.unshift(application);
  return { ok: true as const, application: clone(application) };
}

export function updateDevDashboardApplication(id: string, updates: unknown) {
  const store = state();
  const index = store.applications.findIndex((application) => same(application.id, id));
  if (index < 0) return { ok: false as const, error: "Application not found" };
  const body = (updates && typeof updates === "object" ? updates : {}) as Record<string, unknown>;
  const next: DevApplication = {
    ...store.applications[index],
    status: body.status === undefined ? store.applications[index].status : String(body.status),
    decidedAt: body.decidedAt === undefined ? new Date().toISOString() : String(body.decidedAt),
    workerName: body.workerName === undefined ? store.applications[index].workerName : String(body.workerName),
    workerEmail: body.workerEmail === undefined ? store.applications[index].workerEmail : String(body.workerEmail),
    workerUserId: body.workerUserId === undefined ? store.applications[index].workerUserId : String(body.workerUserId),
    proposal:
      body.proposal && typeof body.proposal === "object"
        ? (body.proposal as DevApplication["proposal"])
        : store.applications[index].proposal,
  };
  store.applications[index] = next;
  return { ok: true as const, application: clone(next) };
}

export function getDevDashboardAssignments(filters: { gigId?: string | null; workerId?: string | null; all?: boolean }) {
  let rows = state().assignments;
  if (!filters.all) {
    if (filters.gigId) rows = rows.filter((row) => same(row.gigId, filters.gigId));
    rows = withRequestedWorker(rows, filters.workerId);
  }
  return clone(rows);
}

export function upsertDevDashboardAssignment(input: unknown) {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const gigId = String(body.gigId ?? "").trim();
  const workerId = String(body.workerId ?? "").trim();
  if (!gigId || !workerId) return { ok: false as const, error: "gigId and workerId required" };

  const store = state();
  const index = store.assignments.findIndex((assignment) => same(assignment.gigId, gigId) && same(assignment.workerId, workerId));
  const existing = index >= 0 ? store.assignments[index] : null;
  const assignedEmails = Array.isArray(body.assignedEmails)
    ? body.assignedEmails.map((item) => String(item))
    : existing?.assignedEmails ?? [`studio.local.${workerId.toLowerCase().replace(/[^a-z0-9]/g, "")}@fasterdrop.site`];
  const assignment: DevAssignment = {
    id: String(body.id ?? existing?.id ?? nextId("ASG-DEV", "assignment")),
    gigId,
    workerId,
    assignedEmail: String(body.assignedEmail ?? existing?.assignedEmail ?? assignedEmails[0] ?? ""),
    assignedEmails,
    status: String(body.status ?? existing?.status ?? "Assigned"),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    submittedAt: body.submittedAt === undefined ? existing?.submittedAt : String(body.submittedAt),
    decidedAt: body.decidedAt === undefined ? existing?.decidedAt : String(body.decidedAt),
    earningsReleaseStatus: existing?.earningsReleaseStatus ?? "queued",
    subjectFilter: body.subjectFilter === undefined ? existing?.subjectFilter : String(body.subjectFilter),
  };

  if (index >= 0) store.assignments[index] = assignment;
  else store.assignments.unshift(assignment);
  return { ok: true as const, assignment: clone(assignment) };
}

export function updateDevDashboardAssignment(id: string, updates: unknown) {
  const store = state();
  const index = store.assignments.findIndex((assignment) => same(assignment.id, id));
  if (index < 0) return { ok: false as const, error: "Assignment not found" };
  const body = (updates && typeof updates === "object" ? updates : {}) as Record<string, unknown>;
  const next: DevAssignment = {
    ...store.assignments[index],
    status: body.status === undefined ? store.assignments[index].status : String(body.status),
    submittedAt: body.submittedAt === undefined ? store.assignments[index].submittedAt : String(body.submittedAt),
    decidedAt: body.decidedAt === undefined ? store.assignments[index].decidedAt : String(body.decidedAt),
    earningsReleaseStatus:
      body.releaseFundsNow || body.status === "Accepted"
        ? "credited"
        : store.assignments[index].earningsReleaseStatus,
    earningsReleasedAt: body.releaseFundsNow ? new Date().toISOString() : store.assignments[index].earningsReleasedAt,
  };
  store.assignments[index] = next;
  return { ok: true as const, assignment: clone(next), fundsReleased: Boolean(body.releaseFundsNow) };
}

export function getDevDashboardPayoutBatches(workerId?: string | null) {
  const requested = normalizeWorkerId(workerId);
  if (!requested) return clone(state().payoutBatches);
  const exact = state().payoutBatches
    .map((batch) => ({
      ...batch,
      items: batch.items.filter((item) => same(item.workerId, requested)),
    }))
    .filter((batch) => batch.items.length > 0);
  if (exact.length) return clone(exact);
  if (!/^WKR-/i.test(requested)) return [];
  return clone(
    state().payoutBatches.map((batch) => ({
      ...batch,
      items: batch.items.map((item) => ({ ...item, workerId: requested })),
    }))
  );
}

export function getDevDashboardWorkers(workerId?: string | null) {
  const store = state();
  const requested = normalizeWorkerId(workerId);
  const workers = store.workers.map((worker) => normalizeDevWorkerProfile(worker));
  if (!requested) return clone(workers);

  const exact = workers.some(
    (worker) => same(worker.workerId, requested) || same(worker.id, requested) || same(worker.userId, requested) || same(worker.email, requested)
  );
  if (exact || !/^WKR-/i.test(requested)) return clone(workers);

  const base = workers.find((worker) => same(worker.workerId, DEFAULT_WORKER_ID)) ?? workers[0];
  if (!base) return clone(store.workers);
  const identity = workerIdentity(requested);

  return clone([
    {
      ...base,
      id: requested,
      workerId: requested,
      userId: `dev-user-${requested.toLowerCase()}`,
      name: identity.name,
      email: identity.email,
    },
    ...workers,
  ]);
}

export function updateDevDashboardWorkerIdentity(input: { workerId?: string | null; userId?: string | null; name: string; email: string }) {
  const store = state();
  const workerId = normalizeWorkerId(input.workerId);
  const userId = String(input.userId ?? "").trim();
  const name = String(input.name ?? "").trim();
  const email = String(input.email ?? "").trim().toLowerCase();
  const index = store.workers.findIndex(
    (worker) =>
      (workerId && (same(worker.workerId, workerId) || same(worker.id, workerId))) ||
      (userId && same(worker.userId, userId)) ||
      (email && same(worker.email, email))
  );

  if (index >= 0) {
    store.workers[index] = {
      ...store.workers[index],
      name,
      email,
    };
    return { ok: true as const, worker: clone(normalizeDevWorkerProfile(store.workers[index])) };
  }

  if (!workerId) return { ok: false as const, error: "workerId required" };

  const base = store.workers.find((worker) => same(worker.workerId, DEFAULT_WORKER_ID)) ?? store.workers[0];
  if (!base) return { ok: false as const, error: "No worker profile available" };

  const created: DevWorkerProfile = {
    ...clone(base),
    id: workerId,
    workerId,
    userId: userId || `dev-user-${workerId.toLowerCase()}`,
    name,
    email,
  };
  store.workers.unshift(created);
  return { ok: true as const, worker: clone(normalizeDevWorkerProfile(created)) };
}

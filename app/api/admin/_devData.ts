const DEFAULT_TIMES = ["08:00", "18:00"];
const DEFAULT_DAYS = [0, 1, 2, 3, 4, 5, 6];
const DEFAULT_TIMEZONE = "Asia/Kolkata";
const DEFAULT_DEADLINE_MIN = 180;
const DEFAULT_RULES = ["Use caption template", "No politics/religion"];
const DEFAULT_AUDIOS = ["Calm Beat #2", "Soft Pop #3"];
const DEFAULT_HASHTAGS = ["#brand", "#reels"];

type PolicyTier = "Standard" | "Strict";
type AccountHealth = "Healthy" | "Watch" | "Risk";
type TaskType = "Reel posting" | "Story posting" | "Comment replies" | "Profile update";
type Priority = "P0" | "P1" | "P2";
type WorkStatus = "Open" | "In progress" | "Submitted" | "Approved" | "Needs fix" | "Hard rejected" | "Cancelled";

type DevSchedule = {
  times: string[];
  days: number[];
  deadlineMin: number;
  timezone: string;
};

type DevWorker = {
  id: string;
  userId: string;
  name: string;
  email: string;
  active: boolean;
  timezone: string;
};

type DevAccount = {
  id: string;
  handle: string;
  niche: string;
  ownerTeam: string;
  policyTier: PolicyTier;
  health: AccountHealth;
  rules: string[];
  allowedAudios: string[];
  requiredHashtags: string[];
};

type DevAssignment = {
  workerId: string;
  accountId: string;
  schedule?: DevSchedule;
};

type DevWorkItem = {
  id: string;
  workerId: string;
  accountId: string;
  title: string;
  type: TaskType;
  createdAt: string;
  dueAt: string;
  status: WorkStatus;
  priority: Priority;
  rewardINR: number;
  estMinutes: number;
  slaMinutes: number;
  startedAt?: string;
  completedAt?: string;
  gates: {
    captionTemplate: boolean;
    approvedAudio: boolean;
    hashtagsOk: boolean;
    noRestricted: boolean;
    proofAttached: boolean;
  };
  submission?: {
    reelUrl?: string;
    screenshotUrl?: string;
    submittedAt?: string;
  };
  review?: {
    reviewedAt?: string;
    reviewer?: string;
    decision?: "Approved" | "Needs fix" | "Hard rejected";
    rejectReason?: string;
  };
  audit: Array<{ at: string; by: string; text: string }>;
};

type DevUpiConfig = {
  workerId: string;
  workerCode: string;
  upiId: string;
  verified: boolean;
  verifiedAt?: string;
  payoutSchedule?: string;
  payoutDay?: string;
};

type DevPayoutBatch = {
  id: string;
  workerId: string;
  workerCode?: string;
  workerName?: string;
  cycleLabel: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  createdAt: string;
  processedAt?: string;
  paidAt?: string;
  method: string;
  notes?: string[];
  items: Array<{ id: string; workItemId: string; handle: string; amountINR: number; status: string; reason?: string }>;
};

type DevAdminState = {
  workers: DevWorker[];
  accounts: DevAccount[];
  assignments: DevAssignment[];
  workItems: DevWorkItem[];
  upiConfigs: DevUpiConfig[];
  payoutBatches: DevPayoutBatch[];
  sequence: {
    worker: number;
    account: number;
    work: number;
    schedule: number;
  };
};

type JsonRecord = Record<string, unknown>;

const globalForDevAdmin = globalThis as typeof globalThis & {
  __reelencerDevAdminStoreV2?: DevAdminState;
};

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function dateOnly(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function localDateTime(time: string, offsetDays = 0) {
  return `${dateOnly(offsetDays)}T${time}`;
}

function stamp(time?: string, offsetDays = 0) {
  if (time) return `${dateOnly(offsetDays)} ${time}`;
  const date = new Date();
  return `${dateOnly()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function nowLocalDateTime() {
  const date = new Date();
  return `${dateOnly()}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function asString(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}

function asStringArray(value: unknown, fallback: string[] = []) {
  if (!Array.isArray(value)) return [...fallback];
  return value.map((item) => asString(item)).filter(Boolean);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizePolicyTier(value: unknown): PolicyTier {
  return asString(value) === "Strict" ? "Strict" : "Standard";
}

function normalizeHealth(value: unknown): AccountHealth {
  const health = asString(value);
  if (health === "Watch" || health === "Risk") return health;
  return "Healthy";
}

function normalizePriority(value: unknown): Priority {
  const priority = asString(value);
  if (priority === "P0" || priority === "P2") return priority;
  return "P1";
}

function normalizeTaskType(value: unknown): TaskType {
  const type = asString(value);
  if (type === "Story posting" || type === "Comment replies" || type === "Profile update") return type;
  return "Reel posting";
}

function normalizeStatus(value: unknown): WorkStatus | "" {
  const status = asString(value);
  if (status === "Rejected") return "Needs fix";
  if (
    status === "Open" ||
    status === "In progress" ||
    status === "Submitted" ||
    status === "Approved" ||
    status === "Needs fix" ||
    status === "Hard rejected" ||
    status === "Cancelled"
  ) {
    return status;
  }
  return "";
}

function normalizeHandle(value: unknown) {
  const handle = asString(value);
  if (!handle) return "";
  return handle.startsWith("@") ? handle : `@${handle}`;
}

function normalizeSchedule(value: unknown): DevSchedule {
  const input = asRecord(value);
  const rawTimes = Array.isArray(input.times) && input.times.length ? input.times : [input.morning, input.evening];
  const times = Array.from(
    new Set(
      rawTimes
        .map((time) => asString(time))
        .filter((time) => /^\d{2}:\d{2}$/.test(time))
    )
  );
  const rawDays = Array.isArray(input.days) ? input.days : DEFAULT_DAYS;
  const days = Array.from(
    new Set(
      rawDays.filter((day): day is number => typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6)
    )
  ).sort((a, b) => a - b);
  const deadlineMin = Math.max(60, Math.min(720, Number(input.deadlineMin ?? DEFAULT_DEADLINE_MIN) || DEFAULT_DEADLINE_MIN));
  const timezone = asString(input.timezone, DEFAULT_TIMEZONE) || DEFAULT_TIMEZONE;

  return {
    times: times.length ? times : [...DEFAULT_TIMES],
    days: days.length ? days : [...DEFAULT_DAYS],
    deadlineMin,
    timezone,
  };
}

function addMinutesToLocalSlot(date: string, time: string, minutes: number) {
  const slot = new Date(`${date}T${time}:00`);
  if (Number.isNaN(slot.getTime())) return `${date}T${time}`;
  slot.setMinutes(slot.getMinutes() + minutes);
  return `${slot.getFullYear()}-${pad2(slot.getMonth() + 1)}-${pad2(slot.getDate())}T${pad2(slot.getHours())}:${pad2(slot.getMinutes())}`;
}

function buildNextSlots(schedule: DevSchedule) {
  const slots: Array<{ label: string; dueAt: string }> = [];
  const now = new Date();

  for (let offset = 0; offset < 14; offset += 1) {
    const candidateDate = dateOnly(offset);
    const date = new Date(`${candidateDate}T00:00:00`);
    const day = date.getDay();
    if (!schedule.days.includes(day)) continue;

    schedule.times.forEach((time, index) => {
      const dueAt = addMinutesToLocalSlot(candidateDate, time, schedule.deadlineMin);
      const dueDate = new Date(`${dueAt}:00`);
      if (!Number.isNaN(dueDate.getTime()) && dueDate >= now) {
        slots.push({ label: index === 0 ? "AM" : index === 1 ? "PM" : `S${index + 1}`, dueAt });
      }
    });
  }

  return slots.sort((a, b) => a.dueAt.localeCompare(b.dueAt)).slice(0, 2);
}

function seedState(): DevAdminState {
  return {
    workers: [
      {
        id: "WKR-101",
        userId: "dev-worker-101",
        name: "Aarav Creator",
        email: "aarav.creator@example.test",
        active: true,
        timezone: DEFAULT_TIMEZONE,
      },
      {
        id: "WKR-102",
        userId: "dev-worker-102",
        name: "Mira Social",
        email: "mira.social@example.test",
        active: true,
        timezone: DEFAULT_TIMEZONE,
      },
    ],
    accounts: [
      {
        id: "ACC-REELS",
        handle: "@reelencer.lab",
        niche: "Creator tools",
        ownerTeam: "Growth",
        policyTier: "Standard",
        health: "Healthy",
        rules: ["Use assigned captions", "Attach proof before submitting"],
        allowedAudios: ["Original audio", "Licensed trend audio"],
        requiredHashtags: ["#reelencer", "#creatorgrowth"],
      },
      {
        id: "ACC-BRAND",
        handle: "@verified.creator",
        niche: "Brand campaigns",
        ownerTeam: "Ops",
        policyTier: "Strict",
        health: "Watch",
        rules: ["No restricted claims", "Brand-safe captions only"],
        allowedAudios: ["Original audio"],
        requiredHashtags: ["#sponsored", "#verifiedcreator"],
      },
    ],
    assignments: [
      {
        workerId: "WKR-101",
        accountId: "ACC-REELS",
        schedule: { times: ["08:00", "18:00"], days: DEFAULT_DAYS, deadlineMin: 180, timezone: DEFAULT_TIMEZONE },
      },
      {
        workerId: "WKR-102",
        accountId: "ACC-BRAND",
        schedule: { times: ["09:00", "19:00"], days: DEFAULT_DAYS, deadlineMin: 240, timezone: DEFAULT_TIMEZONE },
      },
    ],
    workItems: [
      {
        id: "WI-DEV-1001",
        workerId: "WKR-101",
        accountId: "ACC-REELS",
        title: "Submit launch reel proof",
        type: "Reel posting",
        createdAt: dateOnly(),
        dueAt: localDateTime("18:00"),
        status: "Submitted",
        priority: "P1",
        rewardINR: 500,
        estMinutes: 30,
        slaMinutes: 180,
        gates: {
          captionTemplate: true,
          approvedAudio: true,
          hashtagsOk: true,
          noRestricted: true,
          proofAttached: true,
        },
        submission: {
          reelUrl: "https://instagram.com/reel/dev-submit",
          submittedAt: localDateTime("15:25"),
        },
        audit: [{ at: stamp("15:25"), by: "Aarav Creator", text: "Submitted reel proof for admin review." }],
      },
      {
        id: "WI-DEV-1002",
        workerId: "WKR-101",
        accountId: "ACC-REELS",
        title: "Prepare evening story sequence",
        type: "Story posting",
        createdAt: dateOnly(),
        dueAt: localDateTime("20:30"),
        status: "In progress",
        priority: "P2",
        rewardINR: 250,
        estMinutes: 20,
        slaMinutes: 120,
        startedAt: localDateTime("16:00"),
        gates: {
          captionTemplate: true,
          approvedAudio: true,
          hashtagsOk: true,
          noRestricted: true,
          proofAttached: false,
        },
        audit: [{ at: stamp("16:00"), by: "Aarav Creator", text: "Started story posting workflow." }],
      },
      {
        id: "WI-DEV-1003",
        workerId: "WKR-102",
        accountId: "ACC-BRAND",
        title: "Review strict-policy caption",
        type: "Reel posting",
        createdAt: dateOnly(),
        dueAt: localDateTime("19:00", 1),
        status: "Open",
        priority: "P1",
        rewardINR: 650,
        estMinutes: 40,
        slaMinutes: 240,
        gates: {
          captionTemplate: true,
          approvedAudio: false,
          hashtagsOk: true,
          noRestricted: true,
          proofAttached: false,
        },
        audit: [{ at: stamp("09:00"), by: "Admin", text: "Created strict-policy reel review task." }],
      },
    ],
    upiConfigs: [
      {
        workerId: "WKR-101",
        workerCode: "WKR-101",
        upiId: "aarav@upi",
        verified: true,
        verifiedAt: localDateTime("10:00", -1),
        payoutSchedule: "weekly",
        payoutDay: "Friday",
      },
    ],
    payoutBatches: [],
    sequence: {
      worker: 102,
      account: 2,
      work: 1003,
      schedule: 1000,
    },
  };
}

function state() {
  globalForDevAdmin.__reelencerDevAdminStoreV2 ??= seedState();
  return globalForDevAdmin.__reelencerDevAdminStoreV2;
}

function findWorker(store: DevAdminState, workerId: string) {
  return store.workers.find((worker) => worker.id === workerId || worker.userId === workerId) ?? null;
}

function findAccount(store: DevAdminState, accountId: string) {
  return store.accounts.find((account) => account.id === accountId) ?? null;
}

function nextWorkerId(store: DevAdminState) {
  store.sequence.worker += 1;
  return `WKR-${String(store.sequence.worker).padStart(3, "0")}`;
}

function nextAccountId(store: DevAdminState) {
  store.sequence.account += 1;
  return `ACC-DEV-${String(store.sequence.account).padStart(3, "0")}`;
}

function nextWorkId(store: DevAdminState) {
  store.sequence.work += 1;
  return `WI-DEV-${store.sequence.work}`;
}

function nextScheduleId(store: DevAdminState) {
  store.sequence.schedule += 1;
  return `SCH-${store.sequence.schedule}`;
}

function makeScheduledItem(store: DevAdminState, workerId: string, account: DevAccount, schedule: DevSchedule, slot: { label: string; dueAt: string }): DevWorkItem {
  const strict = account.policyTier === "Strict";
  return {
    id: nextScheduleId(store),
    workerId,
    accountId: account.id,
    title: `Post reel for ${account.handle} (${slot.label})`,
    type: "Reel posting",
    createdAt: dateOnly(),
    dueAt: slot.dueAt,
    status: "Open",
    priority: "P1",
    rewardINR: 5,
    estMinutes: 30,
    slaMinutes: schedule.deadlineMin,
    gates: {
      captionTemplate: true,
      approvedAudio: !strict,
      hashtagsOk: true,
      noRestricted: true,
      proofAttached: false,
    },
    audit: [{ at: stamp(), by: "Admin", text: "Scheduled from admin console." }],
  };
}

function ensureScheduledItems(store: DevAdminState, workerId: string, account: DevAccount, schedule: DevSchedule) {
  const existingDue = new Set(
    store.workItems
      .filter((item) => item.workerId === workerId && item.accountId === account.id && item.status === "Open")
      .map((item) => item.dueAt)
  );

  for (const slot of buildNextSlots(schedule)) {
    if (existingDue.has(slot.dueAt)) continue;
    store.workItems.unshift(makeScheduledItem(store, workerId, account, schedule, slot));
    existingDue.add(slot.dueAt);
  }
}

function normalizeAccount(input: unknown, fallbackId: string): DevAccount {
  const body = asRecord(input);
  return {
    id: asString(body.id, fallbackId) || fallbackId,
    handle: normalizeHandle(body.handle),
    niche: asString(body.niche, "Creator campaigns") || "Creator campaigns",
    ownerTeam: asString(body.ownerTeam ?? body.owner_team, "Ops") || "Ops",
    policyTier: normalizePolicyTier(body.policyTier ?? body.policy_tier),
    health: normalizeHealth(body.health),
    rules: asStringArray(body.rules, DEFAULT_RULES),
    allowedAudios: asStringArray(body.allowedAudios ?? body.allowed_audios, DEFAULT_AUDIOS),
    requiredHashtags: asStringArray(body.requiredHashtags ?? body.required_hashtags, DEFAULT_HASHTAGS).map((tag) =>
      tag.startsWith("#") ? tag : `#${tag}`
    ),
  };
}

export function getDevAdminWorkers() {
  return clone(state().workers);
}

export function getDevAdminAccounts() {
  return clone(state().accounts);
}

export function getDevAdminAssignments() {
  return clone(state().assignments);
}

export function getDevAdminWorkItems() {
  return clone(state().workItems);
}

export function getDevAdminUpiConfigs() {
  return clone(state().upiConfigs);
}

export function getDevAdminPayoutBatches() {
  return clone(state().payoutBatches);
}

export function getDevAdminSnapshot() {
  const store = state();
  return {
    ok: true,
    workers: clone(store.workers),
    accounts: clone(store.accounts),
    assignments: clone(store.assignments),
    workItems: clone(store.workItems),
    upiConfigs: clone(store.upiConfigs),
    payoutBatches: clone(store.payoutBatches),
    errors: [],
  };
}

export function createDevAdminWorker(input: unknown) {
  const store = state();
  const body = asRecord(input);
  const workerId = asString(body.workerId ?? body.id, nextWorkerId(store)) || nextWorkerId(store);
  const name = asString(body.name, "New Worker");
  const email = asString(body.email).toLowerCase();
  const active = body.active === undefined ? true : Boolean(body.active);

  if (!workerId || !name || !email) return { ok: false as const, error: "Missing fields" };
  if (store.workers.some((worker) => worker.id === workerId || worker.email.toLowerCase() === email)) {
    return { ok: false as const, error: "Worker already exists" };
  }

  const worker: DevWorker = {
    id: workerId,
    userId: `dev-worker-${workerId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
    email,
    active,
    timezone: asString(body.timezone, DEFAULT_TIMEZONE) || DEFAULT_TIMEZONE,
  };

  store.workers.unshift(worker);
  return { ok: true as const, worker: clone(worker) };
}

export function deleteDevAdminWorker(workerId: string) {
  const store = state();
  const worker = findWorker(store, workerId);
  if (!worker) return { ok: false as const, error: "Worker not found" };

  store.workers = store.workers.filter((item) => item.id !== worker.id && item.userId !== worker.userId);
  store.assignments = store.assignments.filter((item) => item.workerId !== worker.id && item.workerId !== worker.userId);
  store.workItems = store.workItems.filter((item) => item.workerId !== worker.id && item.workerId !== worker.userId);
  store.upiConfigs = store.upiConfigs.filter((item) => item.workerId !== worker.id && item.workerId !== worker.userId);
  store.payoutBatches = store.payoutBatches.filter((item) => item.workerId !== worker.id && item.workerId !== worker.userId);

  return { ok: true as const, workerId: worker.id };
}

export function createDevAdminAccount(input: unknown) {
  const store = state();
  const account = normalizeAccount(input, nextAccountId(store));

  if (!account.id || !account.handle || !account.niche || !account.ownerTeam) {
    return { ok: false as const, error: "Missing required fields" };
  }
  if (
    store.accounts.some(
      (item) => item.id === account.id || item.handle.toLowerCase() === account.handle.toLowerCase()
    )
  ) {
    return { ok: false as const, error: "Account id/handle already exists" };
  }

  store.accounts.unshift(account);
  return { ok: true as const, account: clone(account) };
}

export function deleteDevAdminAccount(accountId: string) {
  const store = state();
  const account = findAccount(store, accountId);
  if (!account) return { ok: false as const, error: "Account not found" };

  store.accounts = store.accounts.filter((item) => item.id !== account.id);
  store.assignments = store.assignments.filter((item) => item.accountId !== account.id);
  store.workItems = store.workItems.filter((item) => item.accountId !== account.id);
  store.payoutBatches = store.payoutBatches.map((batch) => ({
    ...batch,
    items: batch.items.filter((item) => item.handle !== account.handle),
  }));

  return { ok: true as const, accountId: account.id };
}

export function assignDevAdminAccount(input: unknown) {
  const store = state();
  const body = asRecord(input);
  const workerId = asString(body.workerId);
  const accountId = asString(body.accountId);
  const worker = findWorker(store, workerId);
  const account = findAccount(store, accountId);
  if (!worker || !account) return { ok: false as const, error: "Worker/account not found" };

  const schedule = normalizeSchedule(body.schedule);
  const reschedule = Boolean(body.reschedule);

  store.assignments = store.assignments.filter((assignment) => assignment.accountId !== account.id);
  const assignment: DevAssignment = { workerId: worker.id, accountId: account.id, schedule };
  store.assignments.unshift(assignment);

  if (reschedule) {
    store.workItems = store.workItems.filter((item) => !(item.accountId === account.id && item.status === "Open"));
    ensureScheduledItems(store, worker.id, account, schedule);
  }

  return { ok: true as const, assignment: clone(assignment) };
}

export function removeDevAdminAssignment(input: unknown) {
  const store = state();
  const body = asRecord(input);
  const workerId = asString(body.workerId);
  const accountId = asString(body.accountId);
  const worker = findWorker(store, workerId);
  const resolvedWorkerId = worker?.id ?? workerId;

  const before = store.assignments.length;
  store.assignments = store.assignments.filter(
    (assignment) => !(assignment.accountId === accountId && (assignment.workerId === resolvedWorkerId || assignment.workerId === workerId))
  );
  if (store.assignments.length === before) return { ok: false as const, error: "Assignment not found" };

  const cancelledAt = nowLocalDateTime();
  store.workItems = store.workItems.map((item) =>
    item.accountId === accountId && item.workerId === resolvedWorkerId && item.status === "Open"
      ? {
          ...item,
          status: "Cancelled",
          completedAt: cancelledAt,
          audit: [{ at: stamp(), by: "Admin", text: "Cancelled after assignment removal." }, ...item.audit],
        }
      : item
  );

  return { ok: true as const };
}

export function createDevAdminWorkItem(input: unknown) {
  const store = state();
  const body = asRecord(input);
  const workerId = asString(body.workerId);
  const accountId = asString(body.accountId);
  const title = asString(body.title);
  const worker = findWorker(store, workerId);
  const account = findAccount(store, accountId);

  if (!worker || !account || !title) return { ok: false as const, error: "Missing fields" };

  const item: DevWorkItem = {
    id: asString(body.id, nextWorkId(store)) || nextWorkId(store),
    workerId: worker.id,
    accountId: account.id,
    title,
    type: normalizeTaskType(body.type),
    createdAt: dateOnly(),
    dueAt: asString(body.dueAt, localDateTime(DEFAULT_TIMES[1])) || localDateTime(DEFAULT_TIMES[1]),
    status: "Open",
    priority: normalizePriority(body.priority),
    rewardINR: Math.max(0, Number(body.rewardINR ?? 0) || 0),
    estMinutes: Math.max(1, Number(body.estMinutes ?? 10) || 10),
    slaMinutes: Math.max(5, Number(body.slaMinutes ?? 30) || 30),
    gates: {
      captionTemplate: true,
      approvedAudio: account.policyTier !== "Strict",
      hashtagsOk: true,
      noRestricted: true,
      proofAttached: false,
      ...asRecord(body.gates),
    },
    audit: [{ at: stamp(), by: "Admin", text: `Created work item for ${worker.name}.` }],
  };

  store.workItems.unshift(item);
  return { ok: true as const, workItem: clone(item) };
}

export function reviewDevAdminWorkItem(input: unknown) {
  const store = state();
  const body = asRecord(input);
  const id = asString(body.id);
  const status = normalizeStatus(body.status);
  if (!id || !status) return { ok: false as const, error: "Missing fields" };

  const index = store.workItems.findIndex((item) => item.id === id);
  if (index < 0) return { ok: false as const, error: "Work item not found" };

  const reviewInput = asRecord(body.review);
  const completedAt = status === "Approved" || status === "Hard rejected" ? nowLocalDateTime() : undefined;
  const review =
    status === "Approved" || status === "Needs fix" || status === "Hard rejected"
      ? {
          reviewedAt: asString(reviewInput.reviewedAt, stamp()) || stamp(),
          reviewer: asString(reviewInput.reviewer, "Admin") || "Admin",
          decision: status,
          rejectReason: asString(reviewInput.rejectReason) || undefined,
        }
      : undefined;

  const auditText =
    status === "Approved"
      ? "Approved submission."
      : status === "Needs fix"
        ? `Needs fix${review?.rejectReason ? `: ${review.rejectReason}` : "."}`
        : status === "Hard rejected"
          ? `Hard rejected${review?.rejectReason ? `: ${review.rejectReason}` : "."}`
          : `Set status to ${status}.`;

  store.workItems[index] = {
    ...store.workItems[index],
    status,
    review: review ?? store.workItems[index].review,
    completedAt: completedAt ?? store.workItems[index].completedAt,
    audit: [{ at: stamp(), by: "Admin", text: auditText }, ...store.workItems[index].audit],
  };

  return { ok: true as const, workItem: clone(store.workItems[index]) };
}

export function updateDevAdminWorkerTimezone(input: unknown) {
  const store = state();
  const body = asRecord(input);
  const workerId = asString(body.workerId);
  const timezone = asString(body.timezone);
  const worker = findWorker(store, workerId);
  if (!worker || !timezone) return { ok: false as const, error: "workerId/timezone required" };

  worker.timezone = timezone;
  store.assignments = store.assignments.map((assignment) =>
    assignment.workerId === worker.id && assignment.schedule
      ? { ...assignment, schedule: { ...assignment.schedule, timezone } }
      : assignment
  );

  return { ok: true as const, worker: clone(worker) };
}

export function normalizeDevAdminAccounts() {
  const store = state();
  let updated = 0;
  store.accounts = store.accounts.map((account) => {
    const next: DevAccount = {
      ...account,
      handle: normalizeHandle(account.handle),
      ownerTeam: account.ownerTeam || "Ops",
      policyTier: normalizePolicyTier(account.policyTier),
      health: normalizeHealth(account.health),
      rules: account.rules.length ? account.rules : DEFAULT_RULES,
      allowedAudios: account.allowedAudios.length ? account.allowedAudios : DEFAULT_AUDIOS,
      requiredHashtags: account.requiredHashtags.length ? account.requiredHashtags : DEFAULT_HASHTAGS,
    };
    if (JSON.stringify(next) !== JSON.stringify(account)) updated += 1;
    return next;
  });
  return { ok: true as const, updated, errors: [] as Array<{ id: string; error: string }> };
}

export function scheduleDevAdminWork(input: unknown) {
  const store = state();
  const body = asRecord(input);
  const workerId = asString(body.workerId);
  const accountId = asString(body.accountId);
  const schedule = normalizeSchedule(body.schedule);
  const reschedule = Boolean(body.reschedule);
  const applyToAssignments = Boolean(body.applyToAssignments);

  if (workerId && accountId) {
    return assignDevAdminAccount({ workerId, accountId, schedule, reschedule });
  }

  if (!applyToAssignments) return { ok: true as const, errors: [] as Array<{ workerId: string; accountId: string; error: string }> };

  const errors: Array<{ workerId: string; accountId: string; error: string }> = [];
  for (const assignment of store.assignments) {
    const worker = findWorker(store, assignment.workerId);
    const account = findAccount(store, assignment.accountId);
    if (!worker || !account) {
      errors.push({ workerId: assignment.workerId, accountId: assignment.accountId, error: "Worker/account not found" });
      continue;
    }
    assignment.schedule = schedule;
    if (reschedule) {
      store.workItems = store.workItems.filter((item) => !(item.accountId === account.id && item.workerId === worker.id && item.status === "Open"));
      ensureScheduledItems(store, worker.id, account, schedule);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function cleanupDevAdminWorkItems(input: unknown) {
  const store = state();
  const body = asRecord(input);
  const accountId = asString(body.accountId);
  if (!accountId) return { ok: false as const, error: "accountId required" };

  const account = findAccount(store, accountId);
  if (!account) return { ok: false as const, error: "Account not found" };

  const openRows = store.workItems
    .filter((item) => item.accountId === account.id && item.status === "Open")
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const keep = openRows.slice(0, 2);
  const dropIds = new Set(openRows.slice(2).map((item) => item.id));
  store.workItems = store.workItems.filter((item) => !dropIds.has(item.id));

  return { ok: true as const, kept: keep.length, deleted: dropIds.size };
}

export function cleanupAllDevAdminWorkItems() {
  const store = state();
  let deleted = 0;
  for (const account of store.accounts) {
    const result = cleanupDevAdminWorkItems({ accountId: account.id });
    if (result.ok) deleted += result.deleted;
  }
  return { ok: true as const, deleted };
}

export function updateDevAdminPayoutBatch(input: unknown) {
  const store = state();
  const body = asRecord(input);
  const batchId = asString(body.batchId ?? body.id);
  const action = asString(body.action);
  if (!batchId || !action) return { ok: false as const, error: "batchId/action required" };

  const batch = store.payoutBatches.find((item) => item.id === batchId);
  if (!batch) return { ok: false as const, error: "Payout batch not found" };

  if (action === "approve") {
    const etaDate = asString(body.etaDate);
    batch.status = "Processing";
    batch.processedAt = nowLocalDateTime();
    batch.notes = [...(batch.notes ?? []).filter((note) => !note.startsWith("ETA:")), ...(etaDate ? [`ETA:${etaDate}`] : [])];
    batch.items = batch.items.map((item) => ({ ...item, status: "Included" }));
    return { ok: true as const, batch: clone(batch) };
  }

  if (action === "reject") {
    const reason = asString(body.reason, "Rejected by Admin") || "Rejected by Admin";
    batch.status = "Failed";
    batch.processedAt = nowLocalDateTime();
    batch.notes = [reason];
    batch.items = batch.items.map((item) => ({ ...item, status: "Failed", reason }));
    return { ok: true as const, batch: clone(batch) };
  }

  if (action === "mark-paid") {
    batch.status = "Paid";
    batch.paidAt = nowLocalDateTime();
    batch.items = batch.items.map((item) => ({ ...item, status: "Paid" }));
    return { ok: true as const, batch: clone(batch) };
  }

  return { ok: false as const, error: "Unsupported payout action" };
}

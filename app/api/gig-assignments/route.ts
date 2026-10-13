import { withApi } from "@/lib/api/route";
import { authenticate, workerFilter } from "@/lib/api/auth";
import { ApiError, databaseError } from "@/lib/api/errors";
import { NextResponse } from "next/server";
import { resolveWorkerUserId } from "@/lib/api/work";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { accountPlatformFor } from "@/lib/accountSetup";
import {
  getDevDashboardAssignments,
  isDashboardDevMode,
} from "@/lib/dashboardDevData";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};
const ASSIGNMENT_EMAIL_DOMAIN = process.env.GIG_ASSIGNMENT_EMAIL_DOMAIN || "fasterdrop.site";
const EMAIL_PREFIXES = ["studio", "desk", "ops", "team", "office", "mail", "crew", "admin", "support", "work", "hub", "unit"];
const EMAIL_DESCRIPTORS = [
  "north",
  "atlas",
  "prime",
  "summit",
  "harbor",
  "signal",
  "vector",
  "cobalt",
  "meridian",
  "anchor",
  "crest",
  "field",
  "circuit",
  "ledger",
  "pilot",
  "central",
  "orbit",
  "forge",
  "bridge",
  "crown",
];
const EMAIL_IDENTIFIERS = [
  "deskline",
  "mailroom",
  "frontline",
  "briefcase",
  "postbox",
  "registry",
  "dispatch",
  "switchboard",
  "clearance",
  "taskline",
  "relay",
  "corridor",
  "workflow",
  "notary",
  "station",
  "inbox",
];

type DbRecord = Record<string, unknown>;

function asRecord(value: unknown): DbRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as DbRecord) : {};
}

function buildApprovalWorkItemId(assignmentId: string) {
  const compact = String(assignmentId ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return `GIGCRED-${compact.slice(0, 18) || "ITEM"}`;
}


function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function sanitizeAliasToken(raw: unknown, fallback: string) {
  const cleaned = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 14);
  return cleaned || fallback;
}

function hashSeed(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function pickBySeed<T>(items: T[], seed: number) {
  return items[Math.abs(seed) % items.length];
}

async function resolveAssignmentReleaseState(
  sb: ReturnType<typeof supabaseAdmin>,
  assignmentId: string,
  assignmentStatus: string
) {
  const { data, error } = await sb
    .from("work_items")
    .select("status,review")
    .eq("public_id", buildApprovalWorkItemId(assignmentId))
    .maybeSingle();

  if (error) {
    return {
      earningsReleaseStatus: assignmentStatus === "Rejected" ? "blocked" : assignmentStatus === "Accepted" ? "queued" : "none",
      earningsReleasedAt: undefined,
    };
  }

  const row = asRecord(data);
  const review = asRecord(row.review);
  const workStatus = String(row.status ?? "");
  const earningsReleasedAt = review.walletReleasedAt
    ? String(review.walletReleasedAt)
    : undefined;

  if (workStatus === "Approved") {
    return { earningsReleaseStatus: "credited", earningsReleasedAt };
  }
  if (assignmentStatus === "Rejected" || workStatus === "Hard rejected") {
    return { earningsReleaseStatus: "blocked", earningsReleasedAt };
  }
  if (assignmentStatus === "Accepted" || workStatus === "Submitted") {
    return { earningsReleaseStatus: "queued", earningsReleasedAt };
  }
  return { earningsReleaseStatus: "none", earningsReleasedAt };
}

async function mapAssignmentRow(sb: ReturnType<typeof supabaseAdmin>, row: DbRecord) {
  const releaseState = await resolveAssignmentReleaseState(sb, String(row.id), String(row.status ?? ""));
  return {
    id: String(row.id),
    gigId: String(row.gig_id),
    workerId: String(row.worker_code),
    assignedEmail: row.assigned_email,
    assignedEmails: row.assigned_emails ?? undefined,
    status: row.status,
    submittedAt: row.submitted_at ?? undefined,
    decidedAt: row.decided_at ?? undefined,
    createdAt: row.created_at,
    earningsReleaseStatus: releaseState.earningsReleaseStatus,
    earningsReleasedAt: releaseState.earningsReleasedAt,
  };
}

function makeEmail(gigId: string, workerId: string, ordinal = 0, used = new Set<string>()) {
  const workerToken = sanitizeAliasToken(workerId, "wrk").replace(/^wkr-?/, "") || "wrk";
  const baseSeed = hashSeed(`${gigId}:${workerId}:${ordinal}`);

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const prefix = pickBySeed(EMAIL_PREFIXES, baseSeed + ordinal + attempt);
    const descriptor = pickBySeed(EMAIL_DESCRIPTORS, baseSeed * 7 + ordinal * 5 + attempt * 3);
    const identifier = pickBySeed(EMAIL_IDENTIFIERS, baseSeed * 11 + ordinal * 13 + attempt * 7);
    const suffix = String((baseSeed + ordinal * 41 + attempt * 97) % 900 + 100);
    const local = `${prefix}.${descriptor}.${identifier}.${workerToken.slice(0, 4)}${suffix}`
      .replace(/\.{2,}/g, ".")
      .slice(0, 62);
    const email = `${local}@${ASSIGNMENT_EMAIL_DOMAIN}`;
    if (!used.has(email)) return email;
  }

  return `desk.${pickBySeed(EMAIL_IDENTIFIERS, baseSeed)}.${workerToken.slice(0, 4)}${Date.now().toString().slice(-6)}@${ASSIGNMENT_EMAIL_DOMAIN}`;
}

function makeEmails(gigId: string, workerId: string, count: number, seed?: string) {
  const emails: string[] = [];
  const used = new Set<string>();
  if (seed) {
    emails.push(seed);
    used.add(seed);
  }
  while (emails.length < count) {
    const next = makeEmail(gigId, workerId, emails.length, used);
    if (!used.has(next)) {
      emails.push(next);
      used.add(next);
    }
  }
  return emails;
}


/**
 * The creator's own work emails (made in the Work Email Creator) to use for an Email Creator gig, so the accounts
 * they create and the verification inbox use addresses they already know. Active only, platform matches first
 * (X/Twitter etc. via accountPlatformFor), then oldest first, never one already used on another of their gigs.
 */
async function pickCreatorWorkEmails(sb: ReturnType<typeof supabaseAdmin>, userId: string, workerCodes: string[], gigId: string) {
  const [accountsRes, gigRes, usedRes] = await Promise.all([
    sb.from("work_email_accounts").select("email,platform,status,created_at").eq("owner_user_id", userId).eq("status", "active").order("created_at", { ascending: true }).limit(200),
    sb.from("gigs").select("platform").eq("id", gigId).maybeSingle(),
    sb.from("gig_assignments").select("gig_id,assigned_emails,assigned_email").in("worker_code", workerCodes.length ? workerCodes : ["__none__"]),
  ]);
  // Work-email tables may not exist in every environment; that just means "no creator emails".
  if (accountsRes.error) return [];
  const used = new Set<string>();
  for (const row of (usedRes.data ?? []) as DbRecord[]) {
    if (String(row.gig_id) === gigId) continue;
    const list = Array.isArray(row.assigned_emails) ? row.assigned_emails : row.assigned_email ? [row.assigned_email] : [];
    for (const email of list) used.add(String(email).trim().toLowerCase());
  }
  const gigPlatform = accountPlatformFor(String(gigRes.data?.platform ?? "")).id;
  const candidates = ((accountsRes.data ?? []) as DbRecord[])
    .map((row) => ({ email: String(row.email ?? "").trim().toLowerCase(), platform: String(row.platform ?? ""), createdAt: String(row.created_at ?? "") }))
    .filter((row) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email) && !used.has(row.email));
  const matches = (row: { platform: string }) => gigPlatform !== "other" && accountPlatformFor(row.platform).id === gigPlatform;
  candidates.sort((a, b) => Number(matches(b)) - Number(matches(a)));
  return Array.from(new Set(candidates.map((row) => row.email))).slice(0, 5);
}

async function handleGET(req: Request) {
  const actor = await authenticate(req);
  const url = new URL(req.url);
  const gigId = url.searchParams.get("gigId") ?? undefined;
  const workerId = workerFilter(actor, url.searchParams.get("workerId"));
  const all = url.searchParams.get("all") === "1";

  // Preview for an Email Creator gig: the exact five addresses starting will assign (my own work emails first,
  // then the deterministic generated ones). Email Creator work needs no approval or KYC to start.
  if (url.searchParams.get("preview") === "work-emails" && gigId && !isDashboardDevMode()) {
    const workerCode = actor.workerCode ?? actor.user.id;
    const own = await pickCreatorWorkEmails(supabaseAdmin(), actor.user.id, actor.aliases, gigId);
    const emails = [...own, ...makeEmails(gigId, workerCode, 5).filter((email) => !own.includes(email))].slice(0, 5);
    return NextResponse.json({ ok: true, emails, own }, { headers: NO_STORE_HEADERS });
  }

  if (isDashboardDevMode()) {
    return NextResponse.json(getDevDashboardAssignments({ gigId, workerId, all }), { headers: NO_STORE_HEADERS });
  }

  const sb = supabaseAdmin();
  let query = sb.from("gig_assignments").select("*").order("created_at", { ascending: false });
  if (!all) {
    if (gigId) query = query.eq("gig_id", gigId);
    if (workerId) query = actor.isAdmin ? query.eq("worker_code", workerId) : query.in("worker_code", actor.aliases);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
  }

  const payload = await Promise.all(((data ?? []) as DbRecord[]).map((row) => mapAssignmentRow(sb, row)));

  return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
}

async function handlePOST(req: Request) {
  const body = await req.json();
  const actor = await authenticate(req);
  const sb = supabaseAdmin();
  if (typeof body.gigId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(body.gigId)) throw new ApiError(400, "A valid gig ID is required.");
  const workerCode = actor.isAdmin ? String(body.workerId ?? "") : actor.workerCode ?? actor.user.id;
  const workerId = await resolveWorkerUserId(workerCode);
  const own = await pickCreatorWorkEmails(sb, workerId, actor.isAdmin ? [workerCode, workerId] : actor.aliases, body.gigId);
  const assignedEmails = [...own, ...makeEmails(body.gigId, workerCode, 5).filter((email) => !own.includes(email))].slice(0, 5);
  const { data, error } = await sb.rpc("create_gig_assignment", {
    p_actor: actor.user.id, p_worker: workerId, p_gig: body.gigId, p_emails: assignedEmails,
    p_subject: actor.isAdmin && typeof body.subjectFilter === "string" ? body.subjectFilter.trim().slice(0, 200) : null,
  });
  databaseError(error);
  return NextResponse.json(await mapAssignmentRow(sb, data), { headers: NO_STORE_HEADERS });
}

async function handlePATCH(req: Request) {
  const actor = await authenticate(req);
  const body = await req.json();
  const updates = body.updates ?? {};
  if (!isUuid(String(body.id ?? "")) || !["Accepted", "Rejected", "Pending"].includes(updates.status)) throw new ApiError(400, "Invalid assignment review.");
  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("review_gig_assignment", {
    p_actor: actor.user.id, p_assignment: body.id, p_status: updates.status, p_release: updates.releaseFundsNow === true,
  });
  databaseError(error);
  return NextResponse.json({ ...(await mapAssignmentRow(sb, data)), fundsReleased: data.fundsReleased, payoutStatus: data.payoutStatus });
}

export const GET = withApi({ auth: "user" }, handleGET);

export const POST = withApi({ auth: "user" }, handlePOST);

export const PATCH = withApi({ auth: "admin" }, handlePATCH);

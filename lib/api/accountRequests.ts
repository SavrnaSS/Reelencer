import "server-only";
import { randomBytes } from "node:crypto";
import {
  ACCOUNT_REQUEST_LIMITS,
  OPEN_REQUEST_STATUSES,
  makeVerifyCode,
  riskFrom,
  type AccountRequestRisk,
  type AccountRequestStatus,
  type AccountRequestView,
  type AdminAccountRequest,
  type CreatorAccountRequests,
  type RequestCheck,
  type RequestEligibleGig,
} from "@/lib/accountRequests";
import { accountPlatformFor, normalizeHandle, payoutPhrase, validateAccountOwnership, type AccountOwnershipInput } from "@/lib/accountSetup";
import { ApiError, databaseError } from "@/lib/api/errors";
import { decodeWorkerName, resolveNotificationContext, sendLifecycleNotification, type MailStatus } from "@/lib/api/gigApplications";
import { readInstagramAccountOwnership } from "@/lib/api/accountOwnershipReader";
import { emailBaseUrl } from "@/lib/email/send";
import { decryptSecretText } from "@/lib/secretCrypto";
import { formatCompact } from "@/lib/socialAnalytics";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ProfileNotFoundError } from "@/lib/socialSyncSchedule";

// Additional account requests (see lib/accountRequests and migration 202610100001). Creators can only add accounts
// to gigs they're already linked on; nothing links until the team approves. Ownership is proven by a code in the bio,
// so no login is collected. Passwords on older requests stay encrypted and are only revealed to admins, with an audit
// event.

type Row = Record<string, unknown>;
type Sb = ReturnType<typeof supabaseAdmin>;

const MISSING_TABLE = new Set(["PGRST205", "42P01"]);
const str = (value: unknown) => (typeof value === "string" && value.trim() ? value : undefined);
const platformId = (platform: unknown) => accountPlatformFor(String(platform ?? "")).id;
const isOpen = (status: unknown) => OPEN_REQUEST_STATUSES.includes(String(status) as AccountRequestStatus);
/** Exact, case-insensitive match for PostgREST `ilike` (handles may contain `_`). */
const ilikeExact = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

function toView(r: Row, gig?: Row): AccountRequestView {
  const checks = Array.isArray(r.checks) ? (r.checks as RequestCheck[]) : [];
  return {
    id: String(r.id),
    sourceAccountId: String(r.source_account_id),
    gigId: String(r.gig_id),
    gigTitle: str(gig?.title),
    company: str(gig?.company),
    payoutPhrase: gig ? payoutPhrase(str(gig.payout), str(gig.payout_type)) || undefined : undefined,
    platform: String(r.platform),
    handle: String(r.handle),
    profileUrl: String(r.profile_url),
    email: String(r.email),
    phone: str(r.phone),
    notes: str(r.notes),
    hasPassword: !!str(r.password_enc),
    verifyCode: String(r.verify_code),
    status: String(r.status) as AccountRequestStatus,
    revision: Number(r.revision ?? 1),
    checks,
    risk: (["low", "medium", "high"].includes(String(r.risk)) ? r.risk : "unknown") as AccountRequestRisk,
    checkedAt: str(r.checked_at),
    reviewNote: str(r.review_note),
    reviewedAt: str(r.reviewed_at),
    linkedAccountId: str(r.linked_account_id),
    submittedAt: String(r.submitted_at ?? r.created_at),
    createdAt: String(r.created_at),
  };
}

async function gigsById(sb: Sb, ids: string[]) {
  if (!ids.length) return new Map<string, Row>();
  const { data, error } = await sb.from("gigs").select("id,title,company,payout,payout_type").in("id", [...new Set(ids)]);
  databaseError(error);
  return new Map((data ?? []).map((g) => [String(g.id), g as Row]));
}

/* ------------------------------------------------------------------ */
/* Automated checks                                                    */
/* ------------------------------------------------------------------ */

async function runChecks(sb: Sb, r: Row): Promise<{ checks: RequestCheck[]; risk: AccountRequestRisk }> {
  const platform = accountPlatformFor(String(r.platform));
  const handle = String(r.handle);
  const code = String(r.verify_code);
  const checks: RequestCheck[] = [];

  const linkHandle = normalizeHandle(String(r.profile_url), platform).toLowerCase();
  checks.push(
    linkHandle === String(r.handle_key)
      ? { id: "link", label: "Profile link", status: "pass", detail: "The link opens the same username." }
      : { id: "link", label: "Profile link", status: "fail", detail: `The link points to @${linkHandle || "another page"}, not @${handle}.` },
  );

  // Duplicates across every creator: linked accounts and other people's requests for the same handle or login email.
  // Bio-code requests carry no email, so that comparison only runs for older, password-based ones.
  const email = str(r.email);
  const [linked, sameHandle, sameEmail, recent, onGig] = await Promise.all([
    sb.from("linked_social_accounts").select("id,platform,worker_code,status").ilike("handle", ilikeExact(handle)).limit(20),
    sb.from("social_account_requests").select("id,platform,worker_code,status").eq("handle_key", String(r.handle_key)).neq("id", String(r.id)).limit(20),
    email
      ? sb.from("social_account_requests").select("id,worker_code").ilike("email", ilikeExact(email)).neq("worker_code", String(r.worker_code)).limit(5)
      : Promise.resolve({ data: [], error: null }),
    sb.from("social_account_requests").select("id", { count: "exact", head: true }).eq("worker_code", String(r.worker_code)).gte("created_at", new Date(Date.now() - 86_400_000).toISOString()),
    sb.from("linked_social_accounts").select("id", { count: "exact", head: true }).eq("application_id", String(r.application_id)).neq("status", "unlinked"),
  ]);
  databaseError(linked.error);
  databaseError(sameHandle.error);
  databaseError(sameEmail.error);
  const linkedHere = (linked.data ?? []).filter((a) => platformId(a.platform) === platform.id && a.status !== "unlinked" && String(a.id) !== String(r.linked_account_id ?? ""));
  const otherRequests = (sameHandle.data ?? []).filter((q) => platformId(q.platform) === platform.id && String(q.worker_code) !== String(r.worker_code) && (isOpen(q.status) || q.status === "approved"));
  checks.push(
    linkedHere.length
      ? { id: "duplicate", label: "Not linked elsewhere", status: "fail", detail: linkedHere.some((a) => String(a.worker_code) === String(r.worker_code)) ? "Already linked to this creator." : "Already linked to another creator." }
      : otherRequests.length
        ? { id: "duplicate", label: "Not linked elsewhere", status: "fail", detail: "Another creator has requested this account." }
        : { id: "duplicate", label: "Not linked elsewhere", status: "pass", detail: "No other creator has this account." },
  );
  if (email) {
    checks.push(
      (sameEmail.data ?? []).length
        ? { id: "email", label: "Login email", status: "warn", detail: "The same login email is on another creator's request." }
        : { id: "email", label: "Login email", status: "pass", detail: "Not used by any other creator." },
    );
  }

  // Ownership and the public profile. Only Instagram can be read automatically; on other platforms the team opens
  // the profile and looks for the code.
  if (platform.id === "instagram") {
    try {
      const profile = await readInstagramAccountOwnership(handle, code);
      const counts = [
        profile.followers !== undefined ? `${formatCompact(profile.followers)} followers` : null,
        profile.posts !== undefined ? `${formatCompact(profile.posts)} posts` : null,
      ].filter(Boolean).join(" · ");
      checks.push(
        profile.isPrivate
          ? { id: "profile", label: "Public profile", status: "warn", detail: `Private account${counts ? ` (${counts})` : ""}. Ask the creator to make it public so the content can be checked.` }
          : { id: "profile", label: "Public profile", status: "pass", detail: counts ? `Found: ${counts}.` : "Found on Instagram." },
      );
      checks.push(
        profile.codeFound
          ? { id: "ownership", label: "Ownership code", status: "pass", detail: `${code} found in the bio.` }
          : { id: "ownership", label: "Ownership code", status: "pending", detail: `${code} isn't in the bio yet.` },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Instagram couldn't be read.";
      checks.push({ id: "profile", label: "Public profile", status: error instanceof ProfileNotFoundError ? "fail" : "warn", detail: message.slice(0, 200) });
      checks.push({ id: "ownership", label: "Ownership code", status: "pending", detail: `Couldn't read the bio. Open the profile and look for ${code}.` });
    }
  } else {
    checks.push({ id: "profile", label: "Public profile", status: "pending", detail: `${platform.label} can't be read automatically. Open the profile to confirm it exists.` });
    checks.push({ id: "ownership", label: "Ownership code", status: "pending", detail: `Open the profile and confirm ${code} is in the bio or description.` });
  }

  const today = recent.count ?? 0;
  checks.push(
    today > ACCOUNT_REQUEST_LIMITS.dailyBurst
      ? { id: "velocity", label: "Request pace", status: "warn", detail: `${today} requests from this creator in the last 24 hours.` }
      : { id: "velocity", label: "Request pace", status: "pass", detail: `${today} ${today === 1 ? "request" : "requests"} in the last 24 hours.` },
  );
  const existing = onGig.count ?? 0;
  checks.push({ id: "capacity", label: "Accounts on this gig", status: "pass", detail: `Would be account ${existing + 1} of ${ACCOUNT_REQUEST_LIMITS.perGig} on this gig.` });

  return { checks, risk: riskFrom(checks) };
}

const ownershipProven = (checks: unknown) => Array.isArray(checks) && checks.some((c) => c?.id === "ownership" && c?.status === "pass");
const PROVEN = JSON.stringify([{ id: "ownership", status: "pass" }]);

/** Runs the checks and stores them. The first time the code is found, the creator gets the "verified" email. */
async function saveChecks(sb: Sb, r: Row) {
  const { checks, risk } = await runChecks(sb, r);
  const foundNow = ownershipProven(checks) && !ownershipProven(r.checks);
  const missing = checks.some(check => check.id === "profile" && check.status === "fail");
  let update = sb
    .from("social_account_requests")
    .update({ checks, risk, checked_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...(missing ? { status: "changes_requested", review_note: "The profile could not be found. Correct the username and profile link, then submit it again for verification." } : {}) })
    .eq("id", String(r.id)).eq("handle_key", String(r.handle_key)).eq("revision", Number(r.revision ?? 1)).in("status", OPEN_REQUEST_STATUSES);
  // Only the write that turns ownership to proven may send the email, so checks racing can't send it twice.
  if (foundNow) update = update.not("checks", "cs", PROVEN);
  const { data, error } = await update.select("*").maybeSingle();
  databaseError(error);
  if (!data) {
    const { data: current, error: readError } = await sb.from("social_account_requests").select("*").eq("id", String(r.id)).single();
    databaseError(readError);
    return current as Row;
  }
  if (foundNow) await notifyOwnershipConfirmed(sb, data as Row);
  return data as Row;
}

/* ------------------------------------------------------------------ */
/* Creator                                                             */
/* ------------------------------------------------------------------ */

export async function listCreatorRequests(aliases: string[]): Promise<CreatorAccountRequests> {
  const sb = supabaseAdmin();
  const limitsBase = { perGig: ACCOUNT_REQUEST_LIMITS.perGig, total: ACCOUNT_REQUEST_LIMITS.total, open: ACCOUNT_REQUEST_LIMITS.open };
  const codes = aliases.length ? aliases : ["__none__"];
  const [linked, requests] = await Promise.all([
    sb.from("linked_social_accounts").select("id,application_id,gig_id,platform,handle,status,linked_at").in("worker_code", codes).neq("status", "unlinked").order("linked_at"),
    sb.from("social_account_requests").select("*").in("worker_code", codes).order("created_at", { ascending: false }).limit(50),
  ]);
  databaseError(linked.error);
  if (requests.error && MISSING_TABLE.has(requests.error.code ?? "")) {
    return { requests: [], eligible: [], limits: { ...limitsBase, used: 0, openUsed: 0 }, unavailable: true };
  }
  databaseError(requests.error);
  const accounts = (linked.data ?? []) as Row[];
  const rows = (requests.data ?? []) as Row[];
  const gigs = await gigsById(sb, [...accounts.map((a) => String(a.gig_id)), ...rows.map((q) => String(q.gig_id))]);
  const open = rows.filter((q) => isOpen(q.status));

  // One entry per application with an active account; the oldest account is the source.
  const byApplication = new Map<string, Row[]>();
  for (const account of accounts) byApplication.set(String(account.application_id), [...(byApplication.get(String(account.application_id)) ?? []), account]);
  const eligible: RequestEligibleGig[] = [];
  for (const [applicationId, list] of byApplication) {
    const source = list.find((a) => a.status === "active");
    if (!source) continue;
    const gig = gigs.get(String(source.gig_id));
    const accountsOnGig = list.length + open.filter((q) => String(q.application_id) === applicationId).length;
    eligible.push({
      sourceAccountId: String(source.id),
      sourceHandle: String(source.handle),
      gigId: String(source.gig_id),
      gigTitle: str(gig?.title),
      company: str(gig?.company),
      platform: String(source.platform),
      payoutPhrase: gig ? payoutPhrase(str(gig.payout), str(gig.payout_type)) || undefined : undefined,
      accountsOnGig,
      slotsLeft: Math.max(0, ACCOUNT_REQUEST_LIMITS.perGig - accountsOnGig),
    });
  }
  return {
    requests: rows.filter((q) => q.status !== "withdrawn").map((q) => toView(q, gigs.get(String(q.gig_id)))),
    eligible,
    limits: { ...limitsBase, used: accounts.length + open.length, openUsed: open.length },
  };
}

type RequestInput = AccountOwnershipInput & { sourceAccountId: string };

function validate(input: AccountOwnershipInput, platformName: string) {
  const platform = accountPlatformFor(platformName);
  const errors = validateAccountOwnership(input, platform);
  const first = Object.values(errors)[0];
  if (first) throw new ApiError(400, first, "invalid_input");
  const handle = normalizeHandle(input.handle, platform);
  if (normalizeHandle(input.profileUrl, platform).toLowerCase() !== handle.toLowerCase()) {
    throw new ApiError(400, `The profile link should open @${handle}. Copy it from the account's profile page.`, "invalid_input");
  }
  return { platform, handle, handleKey: handle.toLowerCase() };
}

/** Hard blocks before anything is saved: already linked, already requested, or already turned down. */
async function assertAvailable(sb: Sb, input: { platformName: string; handle: string; handleKey: string; workerCodes: string[]; exceptId?: string }) {
  const id = platformId(input.platformName);
  const [linked, requested] = await Promise.all([
    sb.from("linked_social_accounts").select("platform,status").ilike("handle", ilikeExact(input.handle)).limit(20),
    sb.from("social_account_requests").select("id,platform,status,worker_code").eq("handle_key", input.handleKey).limit(20),
  ]);
  databaseError(linked.error);
  databaseError(requested.error);
  if ((linked.data ?? []).some((a) => platformId(a.platform) === id && a.status !== "unlinked")) throw new ApiError(409, "This account is already linked on Reelencer.", "conflict");
  const others = (requested.data ?? []).filter((q) => platformId(q.platform) === id && String(q.id) !== input.exceptId);
  if (others.some((q) => isOpen(q.status))) throw new ApiError(409, "This account is already waiting for review.", "conflict");
  if (others.some((q) => q.status === "rejected" && input.workerCodes.includes(String(q.worker_code)))) {
    throw new ApiError(409, "The team already reviewed this account and didn't approve it. Message the team if that's a mistake.", "conflict");
  }
}

export async function submitAccountRequest(actor: { aliases: string[] }, input: RequestInput) {
  const sb = supabaseAdmin();
  const { data: source, error } = await sb.from("linked_social_accounts").select("*").eq("id", input.sourceAccountId).maybeSingle();
  databaseError(error);
  if (!source || !actor.aliases.includes(String(source.worker_code))) throw new ApiError(404, "Linked account not found.");
  if (source.status !== "active") throw new ApiError(409, "Accounts can only be added to gigs where your account is active.");
  const { handle, handleKey } = validate(input, String(source.platform));

  const state = await listCreatorRequests(actor.aliases);
  if (state.unavailable) throw new ApiError(503, "Adding accounts isn't switched on yet.", "schema_outdated");
  const gig = state.eligible.find((g) => g.sourceAccountId === String(source.id));
  if (state.limits.openUsed >= ACCOUNT_REQUEST_LIMITS.open) throw new ApiError(429, `You have ${state.limits.openUsed} accounts waiting for review. Add more once the team has checked them.`);
  if (state.limits.used >= ACCOUNT_REQUEST_LIMITS.total) throw new ApiError(409, `You've reached the limit of ${ACCOUNT_REQUEST_LIMITS.total} accounts.`);
  if (!gig || gig.slotsLeft <= 0) throw new ApiError(409, `This gig allows up to ${ACCOUNT_REQUEST_LIMITS.perGig} accounts per creator.`);
  await assertAvailable(sb, { platformName: String(source.platform), handle, handleKey, workerCodes: actor.aliases });

  const profileUrl = input.profileUrl.trim();
  const { data: created, error: insertError } = await sb
    .from("social_account_requests")
    .insert({
      source_account_id: String(source.id),
      application_id: String(source.application_id),
      gig_id: String(source.gig_id),
      worker_code: String(source.worker_code),
      platform: String(source.platform),
      handle,
      handle_key: handleKey,
      profile_url: profileUrl,
      // Ownership is proven by the code in the bio: no login details are collected.
      email: "",
      phone: "",
      password_enc: null,
      notes: String(input.notes ?? "").trim(),
      verify_code: makeVerifyCode((n) => randomBytes(n)),
    })
    .select("*")
    .single();
  if (insertError?.code === "23505") throw new ApiError(409, "This account is already waiting for review.", "conflict");
  databaseError(insertError);
  const checked = await saveChecks(sb, created as Row);
  const gigs = await gigsById(sb, [String(source.gig_id)]);
  return { request: toView(checked, gigs.get(String(source.gig_id))) };
}

async function requireOwnRequest(sb: Sb, id: string, aliases: string[]) {
  const { data, error } = await sb.from("social_account_requests").select("*").eq("id", id).maybeSingle();
  databaseError(error);
  if (!data || !aliases.includes(String(data.worker_code))) throw new ApiError(404, "Request not found.");
  return data as Row;
}

/** After a change request: edit the details and go back to the queue. */
export async function resubmitAccountRequest(actor: { aliases: string[] }, id: string, input: AccountOwnershipInput) {
  const sb = supabaseAdmin();
  const current = await requireOwnRequest(sb, id, actor.aliases);
  if (current.status !== "changes_requested") throw new ApiError(409, "Only requests that need changes can be edited.");
  const { handle, handleKey } = validate(input, String(current.platform));
  if (handleKey !== String(current.handle_key)) await assertAvailable(sb, { platformName: String(current.platform), handle, handleKey, workerCodes: actor.aliases, exceptId: id });
  const { data, error } = await sb
    .from("social_account_requests")
    .update({
      handle,
      handle_key: handleKey,
      profile_url: input.profileUrl.trim(),
      // Login details and checks from an older request only stay with the same account; a new handle starts fresh
      // (so finding the code in its bio sends the "verified" email again).
      ...(handleKey === String(current.handle_key) ? {} : { email: "", phone: "", password_enc: null, checks: [], risk: "unknown" }),
      notes: String(input.notes ?? "").trim(),
      status: "pending",
      revision: Number(current.revision ?? 1) + 1,
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "changes_requested")
    .select("*")
    .maybeSingle();
  if (error?.code === "23505") throw new ApiError(409, "This account is already waiting for review.", "conflict");
  databaseError(error);
  if (!data) throw new ApiError(409, "This request changed. Refresh and try again.");
  const checked = await saveChecks(sb, data as Row);
  const gigs = await gigsById(sb, [String(checked.gig_id)]);
  return { request: toView(checked, gigs.get(String(checked.gig_id))) };
}

export async function withdrawAccountRequest(actor: { aliases: string[] }, id: string) {
  const sb = supabaseAdmin();
  const current = await requireOwnRequest(sb, id, actor.aliases);
  if (!isOpen(current.status)) throw new ApiError(409, "Reviewed requests can't be withdrawn.");
  const { error } = await sb.from("social_account_requests").update({ status: "withdrawn", updated_at: new Date().toISOString() }).eq("id", id).in("status", OPEN_REQUEST_STATUSES);
  databaseError(error);
}

/** "Check again" once the code is in the bio. Creators are rate limited; admins aren't. */
export async function recheckAccountRequest(actor: { aliases: string[]; isAdmin: boolean }, id: string) {
  const sb = supabaseAdmin();
  const current = actor.isAdmin ? await requireRequest(sb, id) : await requireOwnRequest(sb, id, actor.aliases);
  if (!isOpen(current.status)) throw new ApiError(409, "This request has already been reviewed.");
  const last = current.checked_at ? Date.parse(String(current.checked_at)) : 0;
  const wait = last + ACCOUNT_REQUEST_LIMITS.recheckSeconds * 1000 - Date.now();
  if (!actor.isAdmin && wait > 0) throw new ApiError(429, `Checked a moment ago. Try again in ${Math.ceil(wait / 1000)}s.`, "cooldown");
  const checked = await saveChecks(sb, current);
  const gigs = await gigsById(sb, [String(checked.gig_id)]);
  return { request: toView(checked, gigs.get(String(checked.gig_id))) };
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

async function requireRequest(sb: Sb, id: string) {
  const { data, error } = await sb.from("social_account_requests").select("*").eq("id", id).maybeSingle();
  databaseError(error);
  if (!data) throw new ApiError(404, "Request not found.");
  return data as Row;
}

/** The review queue (open first, oldest first) plus the last 60 decisions. */
export async function listAllRequests(): Promise<{ requests: AdminAccountRequest[]; unavailable?: boolean }> {
  const sb = supabaseAdmin();
  const [open, decided] = await Promise.all([
    sb.from("social_account_requests").select("*").in("status", OPEN_REQUEST_STATUSES).order("submitted_at").limit(300),
    sb.from("social_account_requests").select("*").in("status", ["approved", "rejected"]).order("reviewed_at", { ascending: false }).limit(60),
  ]);
  if (open.error && MISSING_TABLE.has(open.error.code ?? "")) return { requests: [], unavailable: true };
  databaseError(open.error);
  databaseError(decided.error);
  const rows = [...(open.data ?? []), ...(decided.data ?? [])] as Row[];
  if (!rows.length) return { requests: [] };
  const workerCodes = [...new Set(rows.map((r) => String(r.worker_code)))];
  const [gigs, apps, accounts] = await Promise.all([
    gigsById(sb, rows.map((r) => String(r.gig_id))),
    sb.from("gig_applications").select("id,worker_name").in("id", [...new Set(rows.map((r) => String(r.application_id)))]),
    sb.from("linked_social_accounts").select("id,handle,worker_code,status").in("worker_code", workerCodes).neq("status", "unlinked"),
  ]);
  databaseError(apps.error);
  databaseError(accounts.error);
  const nameByApp = new Map((apps.data ?? []).map((a) => [String(a.id), decodeWorkerName(a.worker_name).workerName]));
  const accountRows = (accounts.data ?? []) as Row[];
  return {
    requests: rows.map((r) => ({
      ...toView(r, gigs.get(String(r.gig_id))),
      workerCode: String(r.worker_code),
      workerName: str(nameByApp.get(String(r.application_id))),
      creatorAccounts: accountRows.filter((a) => String(a.worker_code) === String(r.worker_code)).length,
      sourceHandle: str(accountRows.find((a) => String(a.id) === String(r.source_account_id))?.handle),
    })),
  };
}

export async function openRequestCount() {
  const sb = supabaseAdmin();
  const { count, error } = await sb.from("social_account_requests").select("id", { count: "exact", head: true }).eq("status", "pending");
  return error ? 0 : (count ?? 0);
}

export async function revealRequestPassword(actorId: string, id: string) {
  const sb = supabaseAdmin();
  const row = await requireRequest(sb, id);
  if (!str(row.password_enc)) throw new ApiError(404, "No password was submitted.");
  let password: string;
  try {
    password = decryptSecretText(String(row.password_enc));
  } catch {
    throw new ApiError(500, "The saved password could not be decrypted.");
  }
  await sb.from("audit_events").insert({ actor_id: actorId, action: "account_request_password_revealed", resource_id: id }).then(() => undefined, () => undefined);
  return password;
}

export type RequestDecision = "approve" | "changes" | "reject";

export async function reviewAccountRequest(actorId: string, id: string, decision: RequestDecision, note?: string) {
  const sb = supabaseAdmin();
  const current = await requireRequest(sb, id);
  if (!isOpen(current.status)) throw new ApiError(409, "This request has already been reviewed.");
  const cleanNote = String(note ?? "").trim().slice(0, 500);
  if (decision === "changes" && !cleanNote) throw new ApiError(400, "Tell the creator what to change.", "invalid_input");
  if (decision === "reject" && !cleanNote) throw new ApiError(400, "Add a short reason for the creator.", "invalid_input");
  const now = new Date().toISOString();
  let linkedAccountId: string | undefined;

  if (decision === "approve") {
    if (Array.isArray(current.checks) && current.checks.some((check: RequestCheck) => check.id === "profile" && check.status === "fail")) throw new ApiError(409, "This profile could not be found. Ask the creator to correct it and run the checks again before linking it.");
    // Re-run the duplicate check right before linking: another approval may have landed since the queue loaded.
    const { data: linked, error: linkedError } = await sb.from("linked_social_accounts").select("id,platform,status").ilike("handle", ilikeExact(String(current.handle))).limit(20);
    databaseError(linkedError);
    if ((linked ?? []).some((a) => platformId(a.platform) === platformId(current.platform) && a.status !== "unlinked")) {
      throw new ApiError(409, "This account is already linked on Reelencer. Reject the request instead.", "conflict");
    }
    const { error: upsertError } = await sb.from("linked_social_accounts").upsert(
      {
        application_id: String(current.application_id),
        gig_id: String(current.gig_id),
        worker_code: String(current.worker_code),
        platform: String(current.platform),
        handle: String(current.handle),
        profile_url: String(current.profile_url),
        linked_by: actorId,
        request_key: id,
        updated_at: now,
      },
      { onConflict: "application_id,request_key", ignoreDuplicates: true },
    );
    databaseError(upsertError);
    const { data: account, error: accountError } = await sb.from("linked_social_accounts").select("id").eq("application_id", String(current.application_id)).eq("request_key", id).single();
    databaseError(accountError);
    if (!account) throw new ApiError(500, "The account couldn't be linked. Try again.");
    linkedAccountId = String(account.id);
  }

  const status: AccountRequestStatus = decision === "approve" ? "approved" : decision === "changes" ? "changes_requested" : "rejected";
  const { data, error } = await sb
    .from("social_account_requests")
    .update({ status, review_note: cleanNote, reviewed_by: actorId, reviewed_at: now, updated_at: now, ...(linkedAccountId ? { linked_account_id: linkedAccountId } : {}) })
    .eq("id", id)
    .eq("status", String(current.status))
    .select("*")
    .maybeSingle();
  databaseError(error);
  if (!data) throw new ApiError(409, "This request changed while you were reviewing it. Refresh and try again.");
  await sb.from("audit_events").insert({ actor_id: actorId, action: `account_request_${status}`, resource_id: id }).then(() => undefined, () => undefined);

  const mailStatus = await notifyCreator(sb, data as Row, status, cleanNote);
  const gigs = await gigsById(sb, [String(data.gig_id)]);
  return { request: toView(data as Row, gigs.get(String(data.gig_id))), mailStatus };
}

async function notifyCreator(sb: Sb, r: Row, status: AccountRequestStatus, note: string): Promise<MailStatus> {
  try {
    const { data: application } = await sb.from("gig_applications").select("*").eq("id", String(r.application_id)).maybeSingle();
    if (!application) return { sent: false, reason: "Application not found." };
    const { to, context } = await resolveNotificationContext(sb, application as Row);
    const handle = `@${String(r.handle)}`;
    const copy =
      status === "approved"
        ? { eyebrow: "Account Linked", tone: "success" as const, title: `${handle} is linked`, intro: `The team verified ${handle}. Reels you post on it now count towards your earnings for ${context?.gigTitle ?? "this gig"}. You can remove the verification code from the bio.` }
        : status === "changes_requested"
          ? { eyebrow: "Account Needs Changes", tone: "warning" as const, title: `${handle} needs a quick fix`, intro: `The team checked ${handle} and needs a change before it can be linked.` }
          : { eyebrow: "Account Not Approved", tone: "warning" as const, title: `${handle} wasn't approved`, intro: `The team reviewed ${handle} and couldn't link it.` };
    return await sendLifecycleNotification(to, context, {
      ...copy,
      highlights: [
        { label: "Account", value: handle },
        { label: "Status", value: status === "approved" ? "Linked" : status === "changes_requested" ? "Changes needed" : "Not approved" },
      ],
      sections: note ? [{ label: "Team note", value: note }] : undefined,
      ctaLabel: "Open your accounts",
      ctaHref: `${emailBaseUrl()}/dashboard?section=accounts`,
    });
  } catch (error) {
    return { sent: false, reason: error instanceof Error ? error.message : "Notification failed." };
  }
}

/** Sent once, when the code first shows up in the bio: ownership is proven and the team review is next. */
async function notifyOwnershipConfirmed(sb: Sb, r: Row): Promise<MailStatus> {
  try {
    const [{ data: application }, gigs] = await Promise.all([
      sb.from("gig_applications").select("*").eq("id", String(r.application_id)).maybeSingle(),
      gigsById(sb, [String(r.gig_id)]),
    ]);
    if (!application) return { sent: false, reason: "Application not found." };
    const { to, context } = await resolveNotificationContext(sb, application as Row);
    const gig = gigs.get(String(r.gig_id));
    const platform = accountPlatformFor(String(r.platform));
    const handle = `@${String(r.handle)}`;
    const code = String(r.verify_code);
    const pay = gig ? payoutPhrase(str(gig.payout), str(gig.payout_type)) : "";
    const gigTitle = context?.gigTitle ?? "this gig";
    return await sendLifecycleNotification(to, context, {
      eyebrow: "Account Verified",
      tone: "success",
      illustration: "verified",
      title: `${handle} is verified`,
      preheader: `We found ${code} in your ${platform.label} bio. The team will link ${handle} next.`,
      intro: `We found ${code} in the bio of ${handle}, so we know the account is yours. The team will now review it and link it to ${gigTitle}.`,
      highlights: [
        { label: "Account", value: handle },
        { label: "Ownership", value: "Confirmed" },
        ...(pay ? [{ label: "It will earn", value: pay }] : []),
      ],
      steps: [
        { title: "Team review", body: "The team checks the account and links it. You'll get an email when it's done." },
        { title: "Start earning", body: `Once linked, reels you post on ${handle} count towards your earnings.` },
        { title: "Remove the code", body: `After it's linked you can take ${code} out of the bio.` },
      ],
      sections: [{ label: "Until then", value: "Keep the code in the bio and don't change the account's username." }],
      ctaLabel: "Open your accounts",
      ctaHref: `${emailBaseUrl()}/dashboard?section=accounts`,
      ...(str(r.profile_url) ? { secondaryCtaLabel: `Open ${handle}`, secondaryCtaHref: String(r.profile_url) } : {}),
      footer: `You're receiving this because you asked to add ${handle} to ${gigTitle} on Reelencer.`,
    });
  } catch (error) {
    return { sent: false, reason: error instanceof Error ? error.message : "Notification failed." };
  }
}

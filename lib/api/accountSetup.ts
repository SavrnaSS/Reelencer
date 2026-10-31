import "server-only";
import { ACCOUNT_REQUEST_LIMITS, makeVerifyCode } from "@/lib/accountRequests";
import {
  ACCOUNT_SETUP_ANCHOR,
  accountPlatformFor,
  canReadBio,
  isContentPostingType,
  instructionLines,
  normalizeHandle,
  parseAccountInstructions,
  payoutPhrase,
  readStoredAccountSetup,
  redactProposal,
  validateAccountOwnership,
  type AccountOwnershipInput,
  type StoredAccountSetup,
} from "@/lib/accountSetup";
import { ApiError, databaseError } from "@/lib/api/errors";
import { localRateLimit } from "@/lib/api/rateLimit";
import {
  decodeWorkerName,
  encodeWorkerName,
  resolveNotificationContext,
  sendLifecycleNotification,
  type DbRecord,
  type MailStatus,
  type ProposalPayload,
} from "@/lib/api/gigApplications";
import { readInstagramAccountOwnership } from "@/lib/api/accountOwnershipReader";
import { decryptSecretText, deriveSecretBytes } from "@/lib/secretCrypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ProfileNotFoundError, SocialSyncError } from "@/lib/socialSyncSchedule";

export function decodePublicWorkerName(raw: unknown) {
  const decoded = decodeWorkerName(raw);
  return decoded.proposal ? { ...decoded, proposal: redactProposal(decoded.proposal) } : decoded;
}

const toApplication = (row: DbRecord) => ({
  ...decodePublicWorkerName(row.worker_name),
  id: String(row.id),
  gigId: String(row.gig_id),
  workerId: String(row.worker_code),
  status: row.status,
  appliedAt: row.applied_at,
  decidedAt: row.decided_at ?? undefined,
});

async function loadApplication(id: string) {
  const sb = supabaseAdmin();
  const { data: row, error } = await sb.from("gig_applications").select("*").eq("id", id).maybeSingle();
  databaseError(error);
  if (!row) throw new ApiError(404, "Application not found.");
  const { data: gig, error: gigError } = await sb.from("gigs").select("id,title,company,platform,gig_type,payout,payout_type").eq("id", String(row.gig_id)).maybeSingle();
  databaseError(gigError);
  if (!gig) throw new ApiError(404, "Gig not found.");
  return { sb, row: row as DbRecord, gig: gig as DbRecord };
}

async function writeProposal(sb: ReturnType<typeof supabaseAdmin>, actorId: string, row: DbRecord, proposal: ProposalPayload) {
  const previous = decodeWorkerName(row.worker_name);
  const encoded = encodeWorkerName(previous.workerName, proposal, { workerEmail: previous.workerEmail, workerUserId: previous.workerUserId });
  // Same transactional function as every other application change: it re-checks ownership and that nothing changed.
  const { data, error } = await sb.rpc("update_gig_application", { p_actor: actorId, p_id: String(row.id), p_expected: row, p_name: encoded, p_status: row.status });
  databaseError(error);
  return data as DbRecord;
}

async function notify(sb: ReturnType<typeof supabaseAdmin>, row: DbRecord, config: Parameters<typeof sendLifecycleNotification>[2]): Promise<MailStatus> {
  try {
    const { to, context } = await resolveNotificationContext(sb, row);
    return await sendLifecycleNotification(to, context, config);
  } catch (error) {
    return { sent: false, reason: error instanceof Error ? error.message : "Notification failed." };
  }
}

/** The application's ownership code: derived, not stored, so the creator sees it before submitting anything. */
export function accountVerifyCode(applicationId: string) {
  const bytes = deriveSecretBytes(`account-setup:${applicationId}`);
  return makeVerifyCode((n) => bytes.subarray(0, n));
}

/** Creator-only: the code to put in the bio, shown while they set the account up. */
export async function getAccountVerifyCode(actor: { aliases: string[] }, applicationId: string) {
  const { row, gig } = await loadApplication(applicationId);
  if (!actor.aliases.includes(String(row.worker_code))) throw new ApiError(404, "Application not found.");
  if (!isContentPostingType(String(gig.gig_type ?? ""))) throw new ApiError(409, "This gig doesn't need an account setup.");
  return { verifyCode: accountVerifyCode(String(row.id)) };
}

type OwnershipFields = Pick<StoredAccountSetup, "ownership" | "ownershipDetail" | "checkedAt" | "ownershipRetryAt" | "followers" | "posts" | "isPrivate">;

/** Reads the public bio for the code. Never throws: a failed read is recorded so the team can check by hand. */
async function readOwnership(platformName: string, handle: string, code: string): Promise<OwnershipFields> {
  const platform = accountPlatformFor(platformName);
  const checkedAt = new Date().toISOString();
  if (!canReadBio(platform)) return { ownership: "manual", ownershipDetail: `The reviewer will look for ${code} in the bio when they open the profile.`, checkedAt, ownershipRetryAt: undefined };
  try {
    const profile = await readInstagramAccountOwnership(handle, code);
    const stats = { followers: profile.followers, posts: profile.posts, isPrivate: profile.isPrivate, ownershipRetryAt: undefined };
    if (profile.codeFound) return { ...stats, ownership: "found", ownershipDetail: `${code} found in the bio.`, checkedAt };
    return {
      ...stats,
      ownership: "missing",
      ownershipDetail: profile.isPrivate ? `The account is private. Keep ${code} in the bio and make the profile public before verification.` : `${code} isn't in the bio yet.`,
      checkedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return {
      ownership: "unreadable",
      ownershipDetail: error instanceof ProfileNotFoundError
        ? `${platform.label} couldn't find @${handle}. Check that the username is spelled correctly.`
        : /limited|redirect|login|403|401/i.test(message)
          ? `${platform.label} is limiting profile access. Keep the code in your bio; the team can check it if automatic verification remains unavailable.`
          : `${platform.label} couldn't provide the bio on the last check. Keep the code saved in your bio and try again shortly.`,
      checkedAt,
      ownershipRetryAt: new Date(Date.now() + (unreadablePreview(handle, error).retryAfterSeconds ?? 60) * 1000).toISOString(),
    };
  }
}

export type AccountPreview = (
  | { state: "manual" }
  | { state: "not_found"; handle: string }
  | { state: "unreadable"; handle: string }
  | { state: "found"; handle: string; codeFound: boolean; isPrivate?: boolean; followers?: number; posts?: number }
) & { checkedAt?: string; retryAfterSeconds?: number; reason?: string };

const previewCache = new Map<string, { expiresAt: number; value: AccountPreview }>();
const previewInFlight = new Map<string, Promise<AccountPreview>>();
const PREVIEW_CACHE_MS = 10_000;

function previewFromCache(cached: { expiresAt: number; value: AccountPreview }): AccountPreview {
  return cached.value.state === "unreadable" || cached.value.state === "not_found"
    ? { ...cached.value, retryAfterSeconds: Math.max(1, Math.ceil((cached.expiresAt - Date.now()) / 1000)) }
    : cached.value;
}

function unreadablePreview(handle: string, error: unknown): AccountPreview {
  const message = error instanceof Error ? error.message : "";
  const code = error instanceof SocialSyncError ? error.code : "";
  const reason = code === "rate_limited" ? "rate_limited"
    : code === "login_required" || /redirect|login|403|401/i.test(message) ? "access_limited"
      : code === "timeout" || /timeout|timed out|reached|respond|abort/i.test(message) ? "timeout" : "bio_unavailable";
  const providerRetry = error instanceof SocialSyncError && Number.isFinite(error.retryAfterMs) ? Math.min(86_400, Math.max(0, Math.ceil(error.retryAfterMs / 1000))) : 0;
  return { state: "unreadable", handle, reason, retryAfterSeconds: Math.max(providerRetry, reason === "rate_limited" || reason === "access_limited" ? 60 : 30) };
}

/**
 * Creator-only live lookup while filling in the form: does the account exist, and is the code in its bio yet?
 * Read-only (nothing is stored), throttled per creator and briefly cached per handle so typing and the form's
 * re-checks never hammer the platform.
 */
export async function previewAccountOwnership(actor: { userId: string; aliases: string[] }, applicationId: string, rawHandle: string): Promise<AccountPreview> {
  const { row, gig } = await loadApplication(applicationId);
  if (!actor.aliases.includes(String(row.worker_code))) throw new ApiError(404, "Application not found.");
  if (!isContentPostingType(String(gig.gig_type ?? ""))) throw new ApiError(409, "This gig doesn't need an account setup.");
  const platform = accountPlatformFor(String(gig.platform ?? ""));
  if (!canReadBio(platform)) return { state: "manual" };
  const handle = normalizeHandle(rawHandle, platform);
  if (!handle || !platform.handleRule.test(handle)) throw new ApiError(400, "Enter a valid username.", "invalid_input");
  const code = accountVerifyCode(String(row.id));
  const key = `${row.id}:${handle.toLowerCase()}:${code}`;
  const cached = previewCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return previewFromCache(cached);
  const pending = previewInFlight.get(key);
  if (pending) return pending;
  localRateLimit(`account-preview:${actor.userId}`, 15);
  const lookup = (async () => {
    let value: AccountPreview;
    try {
      const profile = await readInstagramAccountOwnership(handle, code);
      value = { state: "found", handle, codeFound: !!profile.codeFound, isPrivate: profile.isPrivate, followers: profile.followers, posts: profile.posts };
    } catch (error) {
      value = error instanceof ProfileNotFoundError ? { state: "not_found", handle, retryAfterSeconds: 60 } : unreadablePreview(handle, error);
    }
    value = { ...value, checkedAt: new Date().toISOString() };
    const ttl = value.state === "unreadable" || value.state === "not_found" ? (value.retryAfterSeconds ?? 30) * 1000 : PREVIEW_CACHE_MS;
    if (previewCache.size > 2000) previewCache.clear();
    previewCache.set(key, { expiresAt: Date.now() + ttl, value });
    return value;
  })();
  previewInFlight.set(key, lookup);
  try { return await lookup; }
  finally { if (previewInFlight.get(key) === lookup) previewInFlight.delete(key); }
}

/** The email sent the first time the code is found in the bio: ownership is proven, the team review is next. */
function ownershipConfirmedMail(setup: StoredAccountSetup, gig: DbRecord): Parameters<typeof sendLifecycleNotification>[2] {
  const platform = accountPlatformFor(setup.platform);
  const company = String(gig.company ?? "").trim() || "the brand";
  const pay = payoutPhrase(String(gig.payout ?? ""), String(gig.payout_type ?? ""));
  const code = setup.verifyCode ?? "the code";
  return {
    eyebrow: "Account Verified",
    tone: "success",
    illustration: "verified",
    title: `@${setup.handle} is verified`,
    preheader: `We found ${code} in your ${platform.label} bio. Your account is now with ${company} for review.`,
    intro: `We found ${code} in the bio of @${setup.handle}, so we know the account is yours. It's now with ${company} for a final review.`,
    highlights: [
      { label: "Account", value: `@${setup.handle}` },
      { label: "Ownership", value: "Confirmed" },
      ...(pay ? [{ label: "You'll earn", value: pay }] : []),
    ],
    steps: [
      { title: "Team review", body: "The team checks the profile against the brief. You'll get an email with the decision." },
      { title: "Start posting", body: `Once approved, post ${company}'s reels on @${setup.handle}. Earnings go to your Reelencer wallet.` },
      { title: "Remove the code", body: `After approval you can take ${code} out of the bio.` },
    ],
    sections: [{ label: "Until then", value: "Keep the code in the bio, don't post on the account and don't change its username." }],
    ctaLabel: "View application",
    ...(setup.profileUrl ? { secondaryCtaLabel: `Open @${setup.handle}`, secondaryCtaHref: setup.profileUrl } : {}),
  };
}

/**
 * The email a creator gets right after applying to a Content Posting gig: their bio code and how to set up, link
 * and submit the account, personalised with the gig, the brand's own setup brief and the pay.
 */
export function contentPostingSetupMail(input: {
  applicationId: string;
  gig: DbRecord;
  gigUrl: string;
}): Parameters<typeof sendLifecycleNotification>[2] {
  const { gig } = input;
  const platform = accountPlatformFor(String(gig.platform ?? ""));
  const readable = canReadBio(platform);
  const code = accountVerifyCode(input.applicationId);
  const title = String(gig.title ?? "").trim() || "your gig";
  const company = String(gig.company ?? "").trim() || "the brand";
  const pay = payoutPhrase(String(gig.payout ?? ""), String(gig.payout_type ?? ""));
  const brief = instructionLines(parseAccountInstructions(gig.requirements));
  // The platform's how-to without its closing "don't post yet" line, which is said once below.
  const prepare = platform.steps.slice(0, -1).join(" ");
  const bioWhere = platform.id === "instagram" ? "In the Instagram app, tap Edit profile, then Bio" : platform.id === "youtube" ? "In YouTube Studio, open Customisation, then Description" : `Open your ${platform.label} profile settings`;
  // Worded as a plain transactional message (no "verify your account" or money-making phrasing, no links outside
  // Reelencer) so inbox filters don't mistake a code plus an account link for phishing.
  return {
    eyebrow: "Next Step",
    subject: `${title}: your next step`,
    tone: "neutral",
    illustration: "welcome",
    title: "Add your profile code to get started",
    preheader: `Add ${code} to your ${platform.label} bio, then share your username on the gig page. About 3 minutes.`,
    intro: `Thanks for applying to ${title} with ${company}. The next step is to connect the ${platform.label} profile you'll post from. It takes about 3 minutes: add the code below to your bio, then share your username on the gig page.`,
    code: { label: "Your profile code", value: code, hint: "Only for this gig. Add it anywhere in your bio, exactly as shown." },
    highlights: [
      { label: "Gig", value: title },
      { label: "Platform", value: platform.label },
      ...(pay ? [{ label: "Rate", value: pay }] : []),
    ],
    stepsTitle: "How to finish setup",
    stepsBeforeCta: true,
    steps: [
      { title: `Prepare your ${platform.label} profile`, body: prepare },
      { title: "Add the code to your bio", body: `${bioWhere}. Add ${code} anywhere and save. Your current bio text can stay.` },
      { title: "Share your username", body: `Open ${title} on your Reelencer dashboard. Under Account setup, enter your @username and tap Submit.` },
      readable
        ? { title: "We confirm it", body: "We check your public bio and email you once the code shows up. The team then reviews the profile." }
        : { title: "The team confirms it", body: "A reviewer opens the profile, looks for the code and emails you the outcome." },
    ],
    sections: [
      ...(brief.length ? [{ label: `From ${company}'s brief`, value: brief.map((line) => `• ${line}`).join("\n") }] : []),
      { label: "Good to know", value: "Keep the profile public and the code in your bio until the team approves it. Please wait for approval before posting the gig's reels, and keep the same username." },
    ],
    ctaLabel: "Open account setup",
    ctaHref: `${input.gigUrl}#${ACCOUNT_SETUP_ANCHOR}`,
    ctaNote: "Opens your gig page on Reelencer",
    footer: `You're receiving this because you applied to ${title} on Reelencer. Your code and setup progress are always on the gig page.`,
  };
}

/** Sends the setup email for a fresh Content Posting application. Never throws. */
export async function sendContentPostingSetupMail(sb: ReturnType<typeof supabaseAdmin>, row: DbRecord): Promise<MailStatus> {
  try {
    const { data: gig, error } = await sb.from("gigs").select("id,title,company,platform,gig_type,payout,payout_type,requirements").eq("id", String(row.gig_id)).maybeSingle();
    if (error || !gig) return { sent: false, reason: "The gig could not be loaded for the setup email." };
    const { to, context } = await resolveNotificationContext(sb, row);
    if (!context) return { sent: false, recipient: to, reason: "No recipient email was found for this application." };
    return await sendLifecycleNotification(to, context, contentPostingSetupMail({ applicationId: String(row.id), gig: gig as DbRecord, gigUrl: context.gigUrl }));
  } catch (error) {
    return { sent: false, reason: error instanceof Error ? error.message : "Notification failed." };
  }
}

/** Creator submits (or resubmits after a change request) the account they made, with the code in its bio. */
export async function submitAccountSetup(actor: { userId: string; aliases: string[] }, applicationId: string, input: AccountOwnershipInput) {
  const { sb, row, gig } = await loadApplication(applicationId);
  if (!actor.aliases.includes(String(row.worker_code))) throw new ApiError(404, "Application not found.");
  if (!isContentPostingType(String(gig.gig_type ?? ""))) throw new ApiError(409, "This gig doesn't need an account setup.");
  if (row.status === "Rejected") throw new ApiError(409, "This application is closed.");
  const decoded = decodeWorkerName(row.worker_name);
  const previous = readStoredAccountSetup(decoded.proposal?.accountSetup);
  if (previous?.status === "Verified" || row.status === "Accepted") throw new ApiError(409, "This account has already been verified.");

  const platform = accountPlatformFor(String(gig.platform ?? ""));
  const firstError = Object.values(validateAccountOwnership(input, platform))[0];
  if (firstError) throw new ApiError(400, firstError, "invalid_input");

  const handle = normalizeHandle(input.handle, platform);
  const verifyCode = accountVerifyCode(String(row.id));
  const now = new Date().toISOString();
  // Login details from an older password-based submission only stay with the same account.
  const sameAccount = previous?.handle.toLowerCase() === handle.toLowerCase();
  const setup: StoredAccountSetup = {
    platform: platform.label,
    handle,
    profileUrl: input.profileUrl.trim(),
    email: sameAccount ? previous.email : "",
    phone: sameAccount ? previous.phone : undefined,
    passwordEnc: sameAccount ? previous.passwordEnc : undefined,
    notes: input.notes?.trim() || undefined,
    verifyCode,
    ...(await readOwnership(platform.label, handle, verifyCode)),
    status: "Submitted",
    // Edits while still waiting keep the revision; answering a change request starts a new one.
    revision: previous ? previous.revision + (previous.status === "ChangesRequested" ? 1 : 0) : 1,
    submittedAt: now,
  };
  const data = await writeProposal(sb, actor.userId, row, { ...(decoded.proposal ?? {}), accountSetup: setup });
  const resubmitted = previous?.status === "ChangesRequested";
  const owned = setup.ownership === "found";
  // One email per milestone: the code found for the first time gets the "verified" email; otherwise a first
  // submission (or an answer to a change request) gets the "received" one with the code to add.
  const foundNow = owned && (resubmitted || previous?.ownership !== "found");
  const mailStatus = foundNow
    ? await notify(sb, data, ownershipConfirmedMail(setup, gig))
    : previous && !resubmitted
      ? null
      : await notify(sb, data, {
          eyebrow: resubmitted ? "Account Updated" : "Account Received",
          tone: "neutral",
          title: "One step left: add your code",
          preheader: `Add ${verifyCode} to the @${setup.handle} bio to verify the account.`,
          intro: `Thanks for setting up @${setup.handle} for ${String(gig.title ?? "this gig")}. To confirm it's yours, add your code anywhere in the ${platform.label} bio and save.`,
          highlights: [
            { label: "Your code", value: verifyCode },
            { label: "Account", value: `@${setup.handle}` },
          ],
          steps: [
            { title: "Add the code", body: `Paste ${verifyCode} anywhere in the ${platform.label} bio and save.` },
            {
              title: canReadBio(platform) ? "We confirm it" : "The team confirms it",
              body: canReadBio(platform) ? "Your dashboard checks the bio automatically. You'll get an email once it's found." : "The reviewer looks for the code when they open the profile.",
            },
            { title: "Team review", body: "The team checks the profile against the brief and emails you the decision." },
          ],
          sections: [{ label: "Until then", value: "Don't post on the account or change its username." }],
          ctaLabel: "Open my application",
        });
  return { ...toApplication(data), mailStatus };
}

/** "Check again": re-reads the bio for the code. Creators are rate limited; admins aren't. */
export class AccountOwnershipCooldownError extends ApiError {
  constructor(public retryAfterSeconds: number) {
    super(429, `Checked a moment ago. Try again in ${retryAfterSeconds}s.`, "cooldown");
  }
}

export async function checkAccountOwnership(actor: { userId: string; aliases: string[]; isAdmin: boolean }, applicationId: string) {
  const { sb, row, gig } = await loadApplication(applicationId);
  if (!actor.isAdmin && !actor.aliases.includes(String(row.worker_code))) throw new ApiError(404, "Application not found.");
  const decoded = decodeWorkerName(row.worker_name);
  const previous = readStoredAccountSetup(decoded.proposal?.accountSetup);
  if (!previous) throw new ApiError(409, "Submit the account first.");
  // Nothing left to prove once the team has decided.
  if (previous.status === "Verified" || row.status === "Accepted" || row.status === "Rejected") return toApplication(row);
  const last = previous.checkedAt ? Date.parse(previous.checkedAt) : 0;
  const providerRetryAt = previous.ownershipRetryAt ? Date.parse(previous.ownershipRetryAt) : 0;
  const wait = Math.max(Number.isFinite(last) ? last + ACCOUNT_REQUEST_LIMITS.recheckSeconds * 1000 : 0, Number.isFinite(providerRetryAt) ? providerRetryAt : 0) - Date.now();
  if (!actor.isAdmin && wait > 0) throw new AccountOwnershipCooldownError(Math.ceil(wait / 1000));
  const verifyCode = previous.verifyCode ?? accountVerifyCode(String(row.id));
  const setup: StoredAccountSetup = { ...previous, verifyCode, ...(await readOwnership(previous.platform, previous.handle, verifyCode)) };
  // The write is compare-and-set, so two checks racing can't both see "not found" → "found" and send twice.
  const data = await writeProposal(sb, actor.userId, row, { ...(decoded.proposal ?? {}), accountSetup: setup });
  const foundNow = setup.ownership === "found" && previous.ownership !== "found";
  const mailStatus = foundNow ? await notify(sb, data, ownershipConfirmedMail(setup, gig)) : null;
  return { ...toApplication(data), mailStatus };
}

/** Admin asks the creator to fix something; the form reopens with the note on their side. */
export async function requestAccountChanges(actor: { userId: string }, applicationId: string, note: string) {
  const cleanNote = note.trim().slice(0, 1000);
  if (!cleanNote) throw new ApiError(400, "Tell the creator what to change.", "invalid_input");
  const { sb, row, gig } = await loadApplication(applicationId);
  if (row.status === "Accepted" || row.status === "Rejected") throw new ApiError(409, "This application already has a decision.");
  const decoded = decodeWorkerName(row.worker_name);
  const previous = readStoredAccountSetup(decoded.proposal?.accountSetup);
  if (!previous) throw new ApiError(409, "The creator hasn't submitted an account yet.");
  const now = new Date().toISOString();
  const setup: StoredAccountSetup = { ...previous, status: "ChangesRequested", reviewNote: cleanNote, reviewedAt: now };
  const data = await writeProposal(sb, actor.userId, row, { ...(decoded.proposal ?? {}), accountSetup: setup, reviewedAt: now });
  const mailStatus = await notify(sb, data, {
    eyebrow: "Account Needs Changes",
    tone: "warning",
    title: "Please update your account details",
    intro: `The team reviewed the ${previous.platform || "account"} you submitted for ${String(gig.title ?? "this gig")} and needs a change before you can start.`,
    highlights: [
      { label: "Account", value: `@${previous.handle}` },
      { label: "Status", value: "Changes requested" },
    ],
    sections: [{ label: "What to change", value: cleanNote }],
    ctaLabel: "Update account details",
  });
  return { ...toApplication(data), mailStatus };
}

/** Admin-only: decrypts a password from an older, password-based submission. */
export async function revealAccountPassword(actor: { userId: string }, applicationId: string) {
  const { sb, row } = await loadApplication(applicationId);
  const setup = readStoredAccountSetup(decodeWorkerName(row.worker_name).proposal?.accountSetup);
  if (!setup?.passwordEnc) throw new ApiError(404, "No password has been submitted.");
  let password: string;
  try {
    password = decryptSecretText(setup.passwordEnc);
  } catch {
    throw new ApiError(500, "The saved password could not be decrypted.");
  }
  // Best effort: a missing audit table must not block the review.
  await sb.from("audit_events").insert({ actor_id: actor.userId, action: "account_setup_password_revealed", resource_id: String(row.id) }).then(() => undefined, () => undefined);
  return password;
}

import "server-only";
import { ACCOUNT_REQUEST_LIMITS, makeVerifyCode } from "@/lib/accountRequests";
import {
  accountPlatformFor,
  canReadBio,
  isContentPostingType,
  normalizeHandle,
  payoutPhrase,
  readStoredAccountSetup,
  redactProposal,
  validateAccountOwnership,
  type AccountOwnershipInput,
  type StoredAccountSetup,
} from "@/lib/accountSetup";
import { ApiError, databaseError } from "@/lib/api/errors";
import {
  decodeWorkerName,
  encodeWorkerName,
  resolveNotificationContext,
  sendLifecycleNotification,
  type DbRecord,
  type MailStatus,
  type ProposalPayload,
} from "@/lib/api/gigApplications";
import { fetchInstagramProfileSummary } from "@/lib/api/instagramProfile";
import { decryptSecretText, deriveSecretBytes } from "@/lib/secretCrypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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

type OwnershipFields = Pick<StoredAccountSetup, "ownership" | "ownershipDetail" | "checkedAt" | "followers" | "posts" | "isPrivate">;

/** Reads the public bio for the code. Never throws: a failed read is recorded so the team can check by hand. */
async function readOwnership(platformName: string, handle: string, code: string): Promise<OwnershipFields> {
  const platform = accountPlatformFor(platformName);
  const checkedAt = new Date().toISOString();
  if (!canReadBio(platform)) return { ownership: "manual", ownershipDetail: `The reviewer will look for ${code} in the bio when they open the profile.`, checkedAt };
  try {
    const profile = await fetchInstagramProfileSummary(handle, code);
    const stats = { followers: profile.followers, posts: profile.posts, isPrivate: profile.isPrivate };
    if (profile.codeFound) return { ...stats, ownership: "found", ownershipDetail: `${code} found in the bio.`, checkedAt };
    return {
      ...stats,
      ownership: "missing",
      ownershipDetail: profile.isPrivate ? `The account is private, so ${code} couldn't be seen in the bio.` : `${code} isn't in the bio yet.`,
      checkedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return {
      ownership: "unreadable",
      ownershipDetail: /not found|404/i.test(message)
        ? `${platform.label} couldn't find @${handle}. Check that the username is spelled correctly.`
        : `${platform.label} didn't respond on the last check. We'll keep trying automatically.`,
      checkedAt,
    };
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
  const mailStatus = previous && !resubmitted ? null : await notify(sb, data, {
    eyebrow: resubmitted ? "Account Updated" : "Account Received",
    tone: "neutral",
    title: resubmitted ? "Your updated account is back in screening" : "Your account is in screening",
    intro: `Thanks for setting up the ${platform.label} account for ${String(gig.title ?? "this gig")}. ${owned ? "We found your code in the bio, so the team can review it now." : "The team is checking it now."}`,
    highlights: [
      { label: "Account", value: `@${setup.handle}` },
      { label: "Verification code", value: owned ? `${verifyCode} · found` : verifyCode },
    ],
    sections: [
      {
        label: "What happens next",
        value: owned
          ? "The team reviews the profile against the brief. You'll get an email and a dashboard update with the decision."
          : `Add ${verifyCode} anywhere in the ${platform.label} bio and save it. ${canReadBio(platform) ? "Your dashboard confirms it automatically." : "The team checks it when they open the profile."}`,
      },
      { label: "After it's verified", value: `You'll post the gig's reels on this account and earn ${payoutPhrase(String(gig.payout ?? ""), String(gig.payout_type ?? "")) || "the listed payout"}, paid to your wallet. You can remove the code from the bio then.` },
      { label: "Until then", value: "Keep the code in the bio, don't post on the account and don't change its username." },
    ],
    ctaLabel: "Track your application",
  });
  return { ...toApplication(data), mailStatus };
}

/** "Check again": re-reads the bio for the code. Creators are rate limited; admins aren't. */
export async function checkAccountOwnership(actor: { userId: string; aliases: string[]; isAdmin: boolean }, applicationId: string) {
  const { sb, row } = await loadApplication(applicationId);
  if (!actor.isAdmin && !actor.aliases.includes(String(row.worker_code))) throw new ApiError(404, "Application not found.");
  const decoded = decodeWorkerName(row.worker_name);
  const previous = readStoredAccountSetup(decoded.proposal?.accountSetup);
  if (!previous) throw new ApiError(409, "Submit the account first.");
  // Nothing left to prove once the team has decided.
  if (previous.status === "Verified" || row.status === "Accepted" || row.status === "Rejected") return toApplication(row);
  const last = previous.checkedAt ? Date.parse(previous.checkedAt) : 0;
  const wait = last + ACCOUNT_REQUEST_LIMITS.recheckSeconds * 1000 - Date.now();
  if (!actor.isAdmin && wait > 0) throw new ApiError(429, `Checked a moment ago. Try again in ${Math.ceil(wait / 1000)}s.`, "cooldown");
  const verifyCode = previous.verifyCode ?? accountVerifyCode(String(row.id));
  const setup: StoredAccountSetup = { ...previous, verifyCode, ...(await readOwnership(previous.platform, previous.handle, verifyCode)) };
  const data = await writeProposal(sb, actor.userId, row, { ...(decoded.proposal ?? {}), accountSetup: setup });
  return toApplication(data);
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

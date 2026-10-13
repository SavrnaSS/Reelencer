import "server-only";
import {
  accountPlatformFor,
  isContentPostingType,
  normalizeHandle,
  payoutPhrase,
  readStoredAccountSetup,
  redactProposal,
  validateAccountSetup,
  type AccountSetupInput,
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
import { decryptSecretText, encryptSecretText } from "@/lib/secretCrypto";
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

/** Creator submits (or resubmits after a change request) the account they made for a Content Posting gig. */
export async function submitAccountSetup(actor: { userId: string; aliases: string[] }, applicationId: string, input: AccountSetupInput) {
  const { sb, row, gig } = await loadApplication(applicationId);
  if (!actor.aliases.includes(String(row.worker_code))) throw new ApiError(404, "Application not found.");
  if (!isContentPostingType(String(gig.gig_type ?? ""))) throw new ApiError(409, "This gig doesn't need an account setup.");
  if (row.status === "Rejected") throw new ApiError(409, "This application is closed.");
  const decoded = decodeWorkerName(row.worker_name);
  const previous = readStoredAccountSetup(decoded.proposal?.accountSetup);
  if (previous?.status === "Verified" || row.status === "Accepted") throw new ApiError(409, "This account has already been verified.");

  const platform = accountPlatformFor(String(gig.platform ?? ""));
  const errors = validateAccountSetup(input, platform, { passwordOptional: !!previous?.passwordEnc });
  const firstError = Object.values(errors)[0];
  if (firstError) throw new ApiError(400, firstError, "invalid_input");

  const now = new Date().toISOString();
  const setup: StoredAccountSetup = {
    platform: platform.label,
    handle: normalizeHandle(input.handle, platform),
    profileUrl: input.profileUrl.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.phone?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    passwordEnc: input.password ? encryptSecretText(input.password) : previous?.passwordEnc,
    status: "Submitted",
    // Edits while still waiting keep the revision; answering a change request starts a new one.
    revision: previous ? previous.revision + (previous.status === "ChangesRequested" ? 1 : 0) : 1,
    submittedAt: now,
  };
  const data = await writeProposal(sb, actor.userId, row, { ...(decoded.proposal ?? {}), accountSetup: setup });
  const resubmitted = previous?.status === "ChangesRequested";
  const mailStatus = previous && !resubmitted ? null : await notify(sb, data, {
    eyebrow: resubmitted ? "Account Updated" : "Account Received",
    tone: "neutral",
    title: resubmitted ? "Your updated account is back in screening" : "Your account details are in screening",
    intro: `Thanks for setting up the ${platform.label} account for ${String(gig.title ?? "this gig")}. The team is checking it now.`,
    highlights: [
      { label: "Account", value: `@${setup.handle}` },
      { label: "Stage", value: "Account screening" },
    ],
    sections: [
      { label: "What happens next", value: "A recruiter logs in to confirm the account works and matches the brief. You'll get an email and a dashboard update with the decision." },
      { label: "After it's verified", value: `You'll post the gig's reels on this account and earn ${payoutPhrase(String(gig.payout ?? ""), String(gig.payout_type ?? "")) || "the listed payout"}, paid to your wallet.` },
      { label: "Until then", value: "Don't post on the account or change its password, email or phone number." },
    ],
    ctaLabel: "Track your application",
  });
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

/** Admin-only: decrypts the stored password for a login check. */
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

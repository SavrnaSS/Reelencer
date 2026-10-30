import "server-only";
import { findGigHref } from "@/lib/routes";
import { isContentPostingType, readStoredAccountSetup, redactProposal, type StoredAccountSetup } from "@/lib/accountSetup";
import { ApiError, databaseError } from "@/lib/api/errors";
import { linkSocialAccount } from "@/lib/api/socialLink";
import { firstName, renderBrandEmail, type EmailIllustration, type EmailTone } from "@/lib/email/brandEmail";
import { emailBaseUrl, sendEmail, type EmailCategory } from "@/lib/email/send";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

const PROPOSAL_PREFIX = "__REELENCER_PROPOSAL__:";

export type ProposalPayload = {
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
  /** Content Posting gigs: the account the creator made. Server-owned (see lib/api/accountSetup.ts). */
  accountSetup?: StoredAccountSetup;
};

type EncodedWorkerPayload = {
  workerName?: string | null;
  workerEmail?: string | null;
  workerUserId?: string | null;
  proposal?: ProposalPayload;
};

export type NotificationContext = {
  recipient: string;
  gigTitle: string;
  company: string;
  gigUrl: string;
};

export type MailStatus =
  | { sent: true; recipient: string; provider?: string }
  | { sent: false; recipient?: string | null; reason: string };

export type DbRecord = Record<string, unknown>;

export function encodeWorkerName(
  workerName?: string | null,
  proposal?: ProposalPayload | null,
  extras?: { workerEmail?: string | null; workerUserId?: string | null }
) {
  const cleanName = String(workerName ?? "").trim();
  const cleanEmail = String(extras?.workerEmail ?? "").trim();
  const cleanUserId = String(extras?.workerUserId ?? "").trim();
  if (!proposal && !cleanEmail && !cleanUserId) return cleanName || null;
  const compact: EncodedWorkerPayload = {
    workerName: cleanName || null,
    workerEmail: cleanEmail || null,
    workerUserId: cleanUserId || null,
    proposal: proposal ?? undefined,
  };
  return `${PROPOSAL_PREFIX}${encodeURIComponent(JSON.stringify(compact))}`;
}

export function decodeWorkerName(raw: unknown): { workerName?: string; workerEmail?: string; workerUserId?: string; proposal?: ProposalPayload } {
  const value = String(raw ?? "");
  if (!value.startsWith(PROPOSAL_PREFIX)) {
    return value ? { workerName: value } : {};
  }
  try {
    const encoded = value.slice(PROPOSAL_PREFIX.length);
    // Primary format: URI encoded JSON. Backward-compatible fallback: base64 JSON.
    let parsedRaw = "";
    try {
      parsedRaw = decodeURIComponent(encoded);
    } catch {
      // fallback for previously stored base64 payloads
      parsedRaw = Buffer.from(encoded, "base64").toString("utf8");
    }
    const parsed = JSON.parse(parsedRaw) as {
      workerName?: string | null;
      workerEmail?: string | null;
      workerUserId?: string | null;
      proposal?: ProposalPayload;
    };
    return {
      workerName: parsed?.workerName ?? undefined,
      workerEmail: parsed?.workerEmail ?? undefined,
      workerUserId: parsed?.workerUserId ?? undefined,
      proposal: parsed?.proposal ?? undefined,
    };
  } catch {
    return {};
  }
}

/** Sends through the shared mailer (lib/email/send.ts). Kept for existing callers. */
export async function sendDecisionEmail(to: string, subject: string, html: string, text?: string, category: EmailCategory = "applications") {
  return sendEmail({ to, subject, html, text, category });
}

export function appBaseUrl() {
  return emailBaseUrl();
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatMailText(value: string) {
  return escapeHtml(value).replace(/\n/g, "<br />");
}

export function hasMeaningfulProposalSubmission(proposal?: ProposalPayload | null) {
  if (!proposal) return false;
  return !!(
    String(proposal.pitch ?? "").trim() ||
    String(proposal.approach ?? "").trim() ||
    String(proposal.timeline ?? "").trim() ||
    String(proposal.budget ?? "").trim() ||
    String(proposal.portfolio ?? "").trim()
  );
}

export async function resolveNotificationContext(sb: ReturnType<typeof supabaseAdmin>, row: DbRecord): Promise<{ to: string | null; context: NotificationContext | null }> {
  const workerCode = String(row?.worker_code ?? "");
  const gigId = String(row?.gig_id ?? "");
  const decodedWorker = decodeWorkerName(row?.worker_name);
  const [{ data: worker }, { data: workerByUserId }, { data: gig }, { data: workerProfileByCode }, { data: workerProfileById }, { data: kycByWorker }, { data: siblingApps }] = await Promise.all([
    sb.from("workers").select("id,user_id,email,name").eq("id", workerCode).maybeSingle(),
    sb.from("workers").select("id,user_id,email,name").eq("user_id", workerCode).maybeSingle(),
    sb.from("gigs").select("title,company").eq("id", gigId).maybeSingle(),
    sb.from("profiles").select("id,display_name,worker_code").eq("worker_code", workerCode).maybeSingle(),
    sb.from("profiles").select("id,display_name,worker_code").eq("id", workerCode).maybeSingle(),
    sb.from("worker_kyc").select("user_id").eq("worker_id", workerCode).order("reviewed_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("gig_applications").select("worker_name,applied_at").eq("worker_code", workerCode).order("applied_at", { ascending: false }).limit(25),
  ]);

  const siblingPayloads = (siblingApps ?? [])
    .map((candidate: DbRecord) => decodeWorkerName(candidate.worker_name))
    .filter((candidate) => candidate.workerEmail || candidate.workerUserId);
  const siblingWorkerUserId = siblingPayloads.find((candidate) => candidate.workerUserId)?.workerUserId ?? "";
  const siblingWorkerEmail = siblingPayloads.find((candidate) => candidate.workerEmail)?.workerEmail ?? "";
  const siblingWorkerName = siblingPayloads.find((candidate) => candidate.workerName)?.workerName ?? "";

  const resolvedUserId =
    String(worker?.user_id ?? "").trim() ||
    String(workerByUserId?.user_id ?? "").trim() ||
    String(workerProfileByCode?.id ?? "").trim() ||
    String(workerProfileById?.id ?? "").trim() ||
    String(kycByWorker?.user_id ?? "").trim() ||
    String(decodedWorker.workerUserId ?? "").trim() ||
    String(siblingWorkerUserId ?? "").trim() ||
    "";

  const [profile, authUserRes] = await Promise.all([
    worker?.user_id
      ? sb.from("profiles").select("id,display_name,worker_code").eq("id", worker.user_id).maybeSingle()
      : resolvedUserId
        ? sb.from("profiles").select("id,display_name,worker_code").eq("id", resolvedUserId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    resolvedUserId ? sb.auth.admin.getUserById(resolvedUserId) : Promise.resolve({ data: { user: null }, error: null }),
  ]);
  const authUser = authUserRes.data?.user ?? null;
  let to =
    String(worker?.email ?? "").trim() ||
    String(workerByUserId?.email ?? "").trim() ||
    String(decodedWorker.workerEmail ?? "").trim() ||
    String(siblingWorkerEmail ?? "").trim() ||
    String(authUser?.email ?? "").trim() ||
    null;
  let recipientName = String(
    profile.data?.display_name ??
      workerProfileByCode?.display_name ??
      workerProfileById?.display_name ??
      worker?.name ??
      workerByUserId?.name ??
      siblingWorkerName ??
      authUser?.user_metadata?.name ??
      authUser?.user_metadata?.full_name ??
      "there"
  );

  if (!to) {
    const listed = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const users = listed.data?.users ?? [];
    const workerNameNeedle = String(decodedWorker.workerName ?? worker?.name ?? "").trim().toLowerCase();
    const workerEmailNeedle = String(worker?.email ?? decodedWorker.workerEmail ?? "").trim().toLowerCase();
    const authCandidate =
      users.find((candidate) => String(candidate.user_metadata?.worker_code ?? "").trim() === workerCode) ||
      users.find((candidate) => workerEmailNeedle && String(candidate.email ?? "").trim().toLowerCase() === workerEmailNeedle) ||
      users.find((candidate) => {
        const candidateName = String(candidate.user_metadata?.name ?? candidate.user_metadata?.full_name ?? "").trim().toLowerCase();
        return !!workerNameNeedle && !!candidateName && candidateName === workerNameNeedle;
      }) ||
      null;

    if (authCandidate) {
      to = String(authCandidate.email ?? "").trim() || null;
      recipientName =
        String(
          authCandidate.user_metadata?.name ??
            authCandidate.user_metadata?.full_name ??
            recipientName
        ).trim() || recipientName;
    }
  }
  if (!to) return { to: null, context: null };

  return {
    to,
    context: {
      recipient: recipientName,
      gigTitle: String(gig?.title ?? "your project"),
      company: String(gig?.company ?? "Reelencer"),
      gigUrl: `${appBaseUrl()}${findGigHref(gigId)}`,
    },
  };
}

export async function sendLifecycleNotification(
  to: string | null,
  context: NotificationContext | null,
  config: {
    eyebrow: string;
    /** Defaults to "<eyebrow>: <gig title>". */
    subject?: string;
    title: string;
    tone?: EmailTone;
    illustration?: EmailIllustration;
    /** Inbox preview line; defaults to the intro. */
    preheader?: string;
    intro: string;
    sections?: Array<{ label: string; value: string }>;
    highlights?: Array<{ label: string; value: string }>;
    /** Numbered "What happens next" list. */
    steps?: Array<{ title: string; body: string }>;
    stepsTitle?: string;
    stepsBeforeCta?: boolean;
    code?: { label: string; value: string; hint?: string };
    ctaLabel?: string;
    ctaNote?: string;
    ctaHref?: string;
    secondaryCtaLabel?: string;
    secondaryCtaHref?: string;
    footer?: string;
  }
) : Promise<MailStatus> {
  if (!to || !context) return { sent: false, recipient: to, reason: "No recipient email was found for this application." };
  const subject = config.subject ?? `${config.eyebrow}: ${context.gigTitle}`;
  const first = firstName(context.recipient);
  const ctaHref = config.ctaHref ?? context.gigUrl;
  const { html, text } = renderBrandEmail({
    siteUrl: appBaseUrl(),
    eyebrow: config.eyebrow,
    title: config.title,
    tone: config.tone,
    illustration: config.illustration,
    preheader: config.preheader,
    // Titles that already name the person don't need a second greeting.
    greeting: first && !config.title.includes(first) ? `Hi ${first},` : undefined,
    intro: config.intro,
    highlights: config.highlights,
    sections: config.sections,
    steps: config.steps,
    stepsTitle: config.stepsTitle,
    stepsBeforeCta: config.stepsBeforeCta,
    code: config.code,
    cta: { label: config.ctaLabel ?? "View my project", href: ctaHref },
    ctaNote: config.ctaNote,
    secondaryCta: config.secondaryCtaLabel && config.secondaryCtaHref ? { label: config.secondaryCtaLabel, href: config.secondaryCtaHref } : undefined,
    note: config.footer ?? `You're receiving this because you applied to ${context.gigTitle} on Reelencer. Your project panel always has the latest status.`,
  });
  const result = await sendDecisionEmail(to, subject, html, text);
  return { sent: true, recipient: to, provider: result?.provider };
}

export type ApplicationActor = { userId: string; isAdmin: boolean; aliases: string[] };

export type ApplicationUpdates = {
  status?: string;
  decidedAt?: string;
  workerName?: string;
  workerEmail?: string;
  workerUserId?: string;
  proposal?: ProposalPayload;
  notificationMode?: "whatsapp_invite" | "workflow_update" | string;
};

/**
 * Applies an application update through the transactional database function and sends the matching
 * lifecycle email. Shared by the admin/worker API and server-side automation so both behave the same.
 */
export async function applyApplicationUpdate(actor: ApplicationActor, id: string, requestedUpdates: ApplicationUpdates) {
  let updates: ApplicationUpdates = requestedUpdates ?? {};
  const sb = supabaseAdmin();
  const { data: prevRow, error: previousError } = await sb
    .from("current_gig_applications")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  databaseError(previousError);
  if (!prevRow || (!actor.isAdmin && !actor.aliases.includes(String(prevRow.worker_code)))) throw new ApiError(404, "Application not found.");
  if (!actor.isAdmin) {
    const previous = decodeWorkerName(prevRow.worker_name);
    if (updates.proposal?.groupJoinedConfirmed !== true || !previous.proposal?.whatsappLink) throw new ApiError(403, "Only the recruiter can review applications.");
    updates = { status: prevRow.status, decidedAt: prevRow.decided_at, workerName: previous.workerName, proposal: { ...previous.proposal, groupJoinedConfirmed: true, groupJoinedConfirmedAt: new Date().toISOString() } };
  } else if (updates.status && !["Applied", "Pending", "Accepted", "Rejected"].includes(updates.status)) throw new ApiError(400, "Invalid application status.");
  if (actor.isAdmin && updates.proposal) {
    // The account setup (and its encrypted password) is only changed through its own endpoint. Browsers only ever
    // see a redacted copy, so whatever they send back is replaced by the stored record.
    const storedSetup = readStoredAccountSetup(decodeWorkerName(prevRow.worker_name).proposal?.accountSetup);
    const proposal: ProposalPayload = { ...updates.proposal };
    delete proposal.accountSetup;
    if (updates.status === "Accepted" && prevRow.status !== "Accepted") {
      const { data: gig, error: gigError } = await sb.from("gigs").select("gig_type").eq("id", String(prevRow.gig_id)).maybeSingle();
      databaseError(gigError);
      if (isContentPostingType(String(gig?.gig_type ?? ""))) {
        if (!storedSetup) throw new ApiError(409, "This creator hasn't submitted their account yet, so it can't be approved.", "account_setup_required");
        // Approving a Content Posting application is the account check passing.
        updates = { ...updates, proposal: { ...proposal, accountSetup: { ...storedSetup, status: "Verified", reviewedAt: new Date().toISOString() } } };
      } else if (storedSetup) updates = { ...updates, proposal: { ...proposal, accountSetup: storedSetup } };
      else updates = { ...updates, proposal };
    } else updates = { ...updates, proposal: storedSetup ? { ...proposal, accountSetup: storedSetup } : proposal };
  }
  const shouldEncodeWorkerName = Object.prototype.hasOwnProperty.call(updates, "workerName") || Object.prototype.hasOwnProperty.call(updates, "proposal");
  const prevDecodedForEncode = decodeWorkerName(prevRow?.worker_name);
  const encodedWorkerName = shouldEncodeWorkerName
    ? encodeWorkerName(updates.workerName, updates.proposal ?? null, {
        workerEmail: updates.workerEmail ?? prevDecodedForEncode.workerEmail,
        workerUserId: updates.workerUserId ?? prevDecodedForEncode.workerUserId,
      })
    : undefined;
  const { data, error } = await sb.rpc("update_gig_application", {
    p_actor: actor.userId, p_id: id, p_expected: prevRow,
    p_name: encodedWorkerName ?? prevRow.worker_name, p_status: updates.status ?? prevRow.status,
  });
  databaseError(error);
  const nextDecoded = decodeWorkerName(data.worker_name);
  const prevDecoded = decodeWorkerName(prevRow?.worker_name);
  const nextProposal = nextDecoded.proposal ?? {};
  const prevProposal = prevDecoded.proposal ?? {};
  const nextStatus = String(data.status ?? "");
  const prevStatus = String(prevRow?.status ?? "");
  const explicitNotificationMode = String(updates.notificationMode ?? "").trim();
  const proposalStatusChanged = String(nextProposal.reviewStatus ?? "") !== String(prevProposal.reviewStatus ?? "");
  const whatsappLinkAdded = !!nextProposal.whatsappLink?.trim() && nextProposal.whatsappLink !== prevProposal.whatsappLink;
  const onboardingChanged = !!nextProposal.onboardingSteps?.trim() && nextProposal.onboardingSteps !== prevProposal.onboardingSteps;
  const groupConfirmedNow = !!nextProposal.groupJoinedConfirmed && !prevProposal.groupJoinedConfirmed;
  // Content Posting: approval verified the creator's account, so link it to their profile for the analytics view.
  const verifiedSetup = readStoredAccountSetup(nextProposal.accountSetup);
  if (nextStatus === "Accepted" && verifiedSetup?.status === "Verified") {
    try {
      await linkSocialAccount(sb, { applicationId: String(data.id), gigId: String(data.gig_id), workerCode: String(data.worker_code), setup: verifiedSetup, actorId: actor.userId });
    } catch (error) {
      // The creator's dashboard re-links on its next load, so a hiccup here is recoverable.
      console.error(JSON.stringify({ event: "social_link_failed", applicationId: String(data.id), message: error instanceof Error ? error.message : "unknown" }));
    }
  }
  const recruiterNoteChanged =
    nextProposal.adminNote !== prevProposal.adminNote || nextProposal.adminExplanation !== prevProposal.adminExplanation;

  let mailStatus: MailStatus | null = null;
  try {
    const { to, context } = await resolveNotificationContext(sb, data);
    if (explicitNotificationMode === "whatsapp_invite") {
      mailStatus = await sendLifecycleNotification(to, context, {
        eyebrow: "WhatsApp Invite Issued",
        tone: "success",
        title: "Your onboarding channel is ready",
        intro: `A recruiter coordination link has been issued for ${context?.gigTitle ?? "your application"}. Open it to continue onboarding.`,
        highlights: [
          { label: "Channel", value: "WhatsApp onboarding" },
          { label: "Status", value: "Invite issued" },
        ],
        sections: [
          {
            label: "Current stage",
            value: "Your application has moved into recruiter onboarding and is waiting for you to join the issued communication channel.",
          },
          { label: "Recruiter note", value: String(nextProposal.adminNote ?? "").trim() || "Join the coordination channel and follow the recruiter onboarding instructions." },
          {
            label: "What to do now",
            value:
              String(nextProposal.onboardingSteps ?? nextProposal.adminExplanation ?? "").trim() ||
              "Open your project panel, review the invite, and complete the onboarding steps shared by the recruiter.",
          },
        ],
        ctaLabel: "Join the WhatsApp group",
        ctaHref: nextProposal.whatsappLink?.trim() || context?.gigUrl,
        secondaryCtaLabel: "View my project",
        secondaryCtaHref: context?.gigUrl,
      });
    } else if (explicitNotificationMode === "workflow_update") {
      mailStatus = await sendLifecycleNotification(to, context, {
        eyebrow: "Recruiter Workflow Update",
        tone: "neutral",
        title: "Your recruiter instructions were updated",
        intro: `A new operational update has been published for ${context?.gigTitle ?? "your application"}. Review the refreshed guidance before you continue.`,
        highlights: [
          { label: "Update type", value: "Workflow refresh" },
          { label: "Recommended action", value: "Review latest instructions" },
        ],
        sections: [
          { label: "Recruiter note", value: String(nextProposal.adminNote ?? "").trim() || "A recruiter update is available in your project panel." },
          { label: "Next steps", value: String(nextProposal.onboardingSteps ?? "").trim() || "Review the latest onboarding checklist and wait for the next recruiter checkpoint." },
          { label: "Additional explanation", value: String(nextProposal.adminExplanation ?? "").trim() },
        ],
        ctaLabel: "See what's changed",
        secondaryCtaLabel: nextProposal.whatsappLink?.trim() ? "Join the WhatsApp group" : undefined,
        secondaryCtaHref: nextProposal.whatsappLink?.trim() || undefined,
      });
    } else if (proposalStatusChanged && nextProposal.reviewStatus === "Accepted") {
      mailStatus = await sendLifecycleNotification(to, context, {
        eyebrow: "Proposal Approved",
        tone: "success",
        title: "Your proposal has moved into onboarding",
        intro: `Recruiter review for ${context?.gigTitle ?? "this role"} at ${context?.company ?? "Reelencer"} is complete. You are now approved to continue to the onboarding stage.`,
        highlights: [
          { label: "Decision", value: "Approved" },
          { label: "Stage", value: "Onboarding unlocked" },
        ],
        sections: [
          { label: "Recruiter note", value: String(nextProposal.adminNote ?? "").trim() || "Your proposal has been approved. Continue to the next onboarding checkpoint." },
          { label: "Operational guidance", value: String(nextProposal.adminExplanation ?? "").trim() || "Open your project panel to review the latest onboarding plan and recruiter expectations." },
          { label: "Next actions", value: String(nextProposal.onboardingSteps ?? "").trim() || "Review the onboarding instructions, join the assigned communication channel if provided, and wait for the recruiter handoff." },
        ],
        ctaLabel: "Start onboarding",
        secondaryCtaLabel: nextProposal.whatsappLink?.trim() ? "Join the WhatsApp group" : undefined,
        secondaryCtaHref: nextProposal.whatsappLink?.trim() || undefined,
      });
    } else if (proposalStatusChanged && nextProposal.reviewStatus === "Rejected") {
      mailStatus = await sendLifecycleNotification(to, context, {
        eyebrow: "Proposal Update",
        tone: "warning",
        title: "Your proposal needs an update",
        intro: `Recruiter review for ${context?.gigTitle ?? "this role"} has completed and the current submission has not been cleared for the next stage.`,
        highlights: [
          { label: "Decision", value: "Changes required" },
          { label: "Current stage", value: "Revision pending" },
        ],
        sections: [
          { label: "Recruiter note", value: String(nextProposal.adminNote ?? "").trim() || "Review the latest notes in your project panel." },
          { label: "Guidance", value: String(nextProposal.adminExplanation ?? "").trim() || "Review the recruiter guidance carefully and return with a stronger revision if the role remains open." },
        ],
        ctaLabel: "See the feedback",
      });
    } else if (whatsappLinkAdded) {
      mailStatus = await sendLifecycleNotification(to, context, {
        eyebrow: "WhatsApp Invite Issued",
        tone: "success",
        title: "Your onboarding channel is ready",
        intro: `A recruiter coordination link has been issued for ${context?.gigTitle ?? "your application"}. Open it to continue onboarding.`,
        highlights: [
          { label: "Channel", value: "WhatsApp onboarding" },
          { label: "Status", value: "Invite issued" },
        ],
        sections: [
          {
            label: "Current stage",
            value: "Your application has moved into recruiter onboarding and is waiting for you to join the issued communication channel.",
          },
          { label: "Recruiter note", value: String(nextProposal.adminNote ?? "").trim() || "Join the coordination channel and follow the recruiter onboarding instructions." },
          {
            label: "What to do now",
            value:
              String(nextProposal.adminExplanation ?? nextProposal.onboardingSteps ?? "").trim() ||
              "Open your project panel, review the invite, and complete the onboarding steps shared by the recruiter.",
          },
        ],
        ctaLabel: "Join the WhatsApp group",
        ctaHref: nextProposal.whatsappLink?.trim() || context?.gigUrl,
        secondaryCtaLabel: "View my project",
        secondaryCtaHref: context?.gigUrl,
      });
    } else if (onboardingChanged || recruiterNoteChanged) {
      mailStatus = await sendLifecycleNotification(to, context, {
        eyebrow: "Recruiter Workflow Update",
        tone: "neutral",
        title: "Your recruiter instructions were updated",
        intro: `A new operational update has been published for ${context?.gigTitle ?? "your application"}. Review the refreshed guidance before you continue.`,
        highlights: [
          { label: "Update type", value: "Workflow refresh" },
          { label: "Recommended action", value: "Review latest instructions" },
        ],
        sections: [
          { label: "Recruiter note", value: String(nextProposal.adminNote ?? "").trim() || "A recruiter update is available in your project panel." },
          { label: "Next steps", value: String(nextProposal.onboardingSteps ?? "").trim() || "Review the latest onboarding checklist and wait for the next recruiter checkpoint." },
          { label: "Additional explanation", value: String(nextProposal.adminExplanation ?? "").trim() },
        ],
        ctaLabel: "See what's changed",
        secondaryCtaLabel: nextProposal.whatsappLink?.trim() ? "Join the WhatsApp group" : undefined,
        secondaryCtaHref: nextProposal.whatsappLink?.trim() || undefined,
      });
    } else if (groupConfirmedNow) {
      mailStatus = await sendLifecycleNotification(to, context, {
        eyebrow: "Onboarding Confirmed",
        tone: "success",
        title: "Your onboarding confirmation has been recorded",
        intro: `Your join confirmation for ${context?.gigTitle ?? "this role"} has been registered successfully. Recruiter final review is still in progress.`,
        highlights: [
          { label: "Confirmation", value: "Recorded" },
          { label: "Next stage", value: "Final recruiter review" },
        ],
        sections: [
          { label: "Current stage", value: "Recruiter final review remains in progress. You will be notified once the final decision is published." },
          { label: "Confirmed at", value: String(nextProposal.groupJoinedConfirmedAt ?? "").trim() },
        ],
        ctaLabel: "Track my application",
      });
    } else if ((nextStatus === "Accepted" || nextStatus === "Rejected") && prevStatus !== nextStatus) {
      mailStatus = await sendLifecycleNotification(to, context, {
        eyebrow: "Final Recruiter Decision",
        tone: nextStatus === "Accepted" ? "success" : "closed",
        title: nextStatus === "Accepted" ? "You have been selected to move forward" : "Recruiter review has been completed",
        intro:
          nextStatus === "Accepted"
            ? `Your application for ${context?.gigTitle ?? "this role"} at ${context?.company ?? "Reelencer"} has cleared the final recruiter review.`
            : `Your application for ${context?.gigTitle ?? "this role"} at ${context?.company ?? "Reelencer"} has completed final recruiter review.`,
        highlights: [
          { label: "Final outcome", value: nextStatus === "Accepted" ? "Moved forward" : "Closed" },
          { label: "Project", value: context?.gigTitle ?? "Application" },
        ],
        sections: [
          {
            label: "Decision summary",
            value:
              nextStatus === "Accepted"
                ? "You are now approved to continue. Open your project panel to review the next handoff steps and begin the workflow."
                : "This application has not been moved forward. Open your project panel to review the latest recruiter context and any closing notes.",
          },
          { label: "Recruiter note", value: String(nextProposal.adminNote ?? "").trim() },
        ],
        ctaLabel: nextStatus === "Accepted" ? "Start my project" : "Find new gigs",
        ...(nextStatus === "Accepted" ? {} : { ctaHref: `${appBaseUrl()}/dashboard?section=find`, secondaryCtaLabel: "View the decision", secondaryCtaHref: context?.gigUrl }),
      });
    }
  } catch (error) {
    mailStatus = {
      sent: false,
      reason: error instanceof Error ? error.message : "Unable to send recruiter lifecycle notification.",
    };
  }

  return {
    ...nextDecoded,
    proposal: redactProposal(nextDecoded.proposal),
    id: String(data.id),
    gigId: String(data.gig_id),
    workerId: String(data.worker_code),
    status: data.status,
    appliedAt: data.applied_at,
    decidedAt: data.decided_at ?? undefined,
    mailStatus,
  };
}

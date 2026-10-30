import { withApi } from "@/lib/api/route";
import { authenticate, workerFilter } from "@/lib/api/auth";
import { ApiError, databaseError } from "@/lib/api/errors";
import { NextResponse } from "next/server";
import { resolveWorkerUserId } from "@/lib/api/work";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { decodePublicWorkerName, sendContentPostingSetupMail } from "@/lib/api/accountSetup";
import { isContentPostingType } from "@/lib/accountSetup";
import { readCurrentApplications } from "@/lib/api/applicationReads";
import { quotaLimitMessage, type ApplicationQuota } from "@/lib/applicationQuota";
import {
  getDevDashboardApplications,
  isDashboardDevMode,
  updateDevDashboardApplication,
  upsertDevDashboardApplication,
} from "@/lib/dashboardDevData";
import {
  NO_STORE_HEADERS,
  applyApplicationUpdate,
  decodeWorkerName,
  encodeWorkerName,
  hasMeaningfulProposalSubmission,
  resolveNotificationContext,
  sendLifecycleNotification,
  type MailStatus,
} from "@/lib/api/gigApplications";

async function handleGET(req: Request) {
  const actor = await authenticate(req);
  const url = new URL(req.url);
  const gigId = url.searchParams.get("gigId") ?? undefined;
  const workerId = workerFilter(actor, url.searchParams.get("workerId"));
  if (isDashboardDevMode()) {
    return NextResponse.json(getDevDashboardApplications({ gigId, workerId }), { headers: NO_STORE_HEADERS });
  }

  const sb = supabaseAdmin();
  const data = await readCurrentApplications(sb, { gigId, workerAliases: workerId ? actor.isAdmin ? [workerId] : actor.aliases : undefined });
  const payload = data.map((a) => ({
    ...(decodePublicWorkerName(a.worker_name)),
    id: String(a.id),
    gigId: String(a.gig_id),
    workerId: String(a.worker_code),
    status: a.status,
    appliedAt: a.applied_at,
    decidedAt: a.decided_at ?? undefined,
  }));
  return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
}

/** The weekly limit was reached: say when the next slot opens, with the server's count for the dashboard. */
async function weeklyLimitResponse(sb: ReturnType<typeof supabaseAdmin>, workerUserId: string) {
  const { data } = await sb.rpc("gig_application_quota", { p_worker: workerUserId });
  const quota = data && typeof data === "object" ? (data as ApplicationQuota) : null;
  const retryAfter = quota?.nextSlotAt ? Math.max(60, Math.ceil((Date.parse(quota.nextSlotAt) - Date.now()) / 1000)) : 3600;
  return NextResponse.json(
    { ok: false, error: quota ? quotaLimitMessage(quota, { withTime: false }) : "You've used both of this week's applications.", code: "weekly_application_limit", quota },
    { status: 429, headers: { ...NO_STORE_HEADERS, "Retry-After": String(retryAfter) } },
  );
}

async function handlePOST(req: Request) {
  try {
    const body = await req.json();
    const actor = await authenticate(req);
    const { data: gig, error: gigError } = await supabaseAdmin().from("gigs").select("id,status,gig_type").eq("id", String(body.gigId ?? "")).maybeSingle();
    databaseError(gigError);
    if (!gig || gig.status !== "Open") throw new ApiError(409, "This gig is not accepting applications.");
    if (!actor.isAdmin) {
      body.workerId = actor.workerCode ?? actor.user.id;
      body.workerUserId = actor.user.id;
      body.workerEmail = actor.user.email;
      body.id = undefined;
      body.status = String(gig.gig_type).toLowerCase() === "email creator" ? "Accepted" : "Pending";
      const proposal = body.proposal ?? {};
      const permitted = ["pitch", "approach", "timeline", "budget", "portfolio", "applicationMode", "source", "consentAcceptedAt", "consentText", "profileSnapshotName"];
      body.proposal = Object.fromEntries(permitted.filter(key => typeof proposal[key] === "string").map(key => [key, String(proposal[key]).slice(0, 6000)]));
      body.proposal.reviewStatus = body.status;
      body.proposal.submittedAt = new Date().toISOString();
      body.proposal.profileSnapshotEmail = actor.user.email;
    }
    if (!body?.gigId || !body?.workerId) {
      return NextResponse.json({ error: "gigId and workerId required" }, { status: 400, headers: NO_STORE_HEADERS });
    }
    if (isDashboardDevMode()) {
      const upserted = upsertDevDashboardApplication(body);
      return upserted.ok
        ? NextResponse.json({ ...upserted.application, mailStatus: { sent: false, reason: "Local dev store" } }, { headers: NO_STORE_HEADERS })
        : NextResponse.json({ error: upserted.error }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const sb = supabaseAdmin();
    const workerNameEncoded = encodeWorkerName(body.workerName, body.proposal ?? null, {
      workerEmail: body.workerEmail,
      workerUserId: body.workerUserId,
    });
    const workerUserId = actor.isAdmin ? await resolveWorkerUserId(String(body.workerId)) : actor.user.id;
    const { data, error } = await sb.rpc("submit_gig_application", {
      p_actor: actor.user.id, p_worker: workerUserId, p_gig: body.gigId, p_worker_name: workerNameEncoded,
    });
    if (error?.message === "weekly_application_limit") return weeklyLimitResponse(sb, workerUserId);
    databaseError(error);
    const responsePayload = {
      ...(decodePublicWorkerName(data.worker_name)),
      id: String(data.id),
      gigId: String(data.gig_id),
      workerId: String(data.worker_code),
      status: data.status,
      appliedAt: data.applied_at,
      decidedAt: data.decided_at ?? undefined,
    };

    let mailStatus: MailStatus | null = null;
    try {
      const decoded = decodeWorkerName(data.worker_name);
      // Content Posting: the next step is linking the account, so that email replaces the generic "received" one.
      if (isContentPostingType(String(gig.gig_type ?? "")) && data.status !== "Accepted") {
        mailStatus = await sendContentPostingSetupMail(sb, data);
      } else if (decoded.proposal || decoded.workerEmail) {
        const { to, context } = await resolveNotificationContext(sb, data);
        const submittedProposal = hasMeaningfulProposalSubmission(decoded.proposal);
        mailStatus = await sendLifecycleNotification(to, context, {
          eyebrow: submittedProposal ? "Proposal Submitted" : "Application Submitted",
          tone: "neutral",
          title: submittedProposal
            ? `Your proposal was received, ${context?.recipient ?? "there"}`
            : `Your application was received, ${context?.recipient ?? "there"}`,
          intro: `Your application for ${context?.gigTitle ?? "this role"} at ${context?.company ?? "Reelencer"} is now in the recruiter review queue.`,
          highlights: [
            { label: "Review state", value: "Queued for recruiter review" },
            { label: "Company", value: context?.company ?? "Reelencer" },
          ],
          sections: [
            {
              label: "What happens next",
              value: submittedProposal
                ? "Recruiter review is pending. You will receive a dashboard update and an email the moment onboarding instructions or a final decision are published."
                : "Recruiter screening is pending. You will receive a dashboard update and an email the moment the next hiring decision or onboarding instruction is published.",
            },
            {
              label: "What you need to do now",
              value: "No action is required at this stage. Keep your registered email active and monitor your project panel for recruiter guidance.",
            },
          ],
          ctaLabel: "Track application status",
        });
      }
    } catch {
      mailStatus = {
        sent: false,
        reason: "Notification delivery failed. The application was saved.",
      };
    }

    return NextResponse.json({ ...responsePayload, mailStatus }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid payload" }, { status: 400, headers: NO_STORE_HEADERS });
  }
}

async function handlePATCH(req: Request) {
  try {
    const actor = await authenticate(req);
    const body = await req.json();
    if (!body?.id) {
      return NextResponse.json({ error: "id required" }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const updates = body.updates ?? {};
    if (isDashboardDevMode()) {
      const updated = updateDevDashboardApplication(String(body.id), updates);
      return updated.ok
        ? NextResponse.json({ ...updated.application, mailStatus: { sent: false, reason: "Local dev store" } }, { headers: NO_STORE_HEADERS })
        : NextResponse.json({ error: updated.error }, { status: 404, headers: NO_STORE_HEADERS });
    }
    const result = await applyApplicationUpdate({ userId: actor.user.id, isAdmin: actor.isAdmin, aliases: actor.aliases }, String(body.id), updates);
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid payload" }, { status: 400, headers: NO_STORE_HEADERS });
  }
}

export const GET = withApi({ auth: "user" }, handleGET);

export const POST = withApi({ auth: "user" }, handlePOST);

export const PATCH = withApi({ auth: "user" }, handlePATCH);

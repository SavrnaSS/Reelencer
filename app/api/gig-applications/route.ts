import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { randomUUID } from "crypto";
import nodemailer from "nodemailer";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

const PROPOSAL_PREFIX = "__REELENCER_PROPOSAL__:";

type ProposalPayload = {
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

type NotificationContext = {
  recipient: string;
  gigTitle: string;
  company: string;
  proceedUrl: string;
};

function encodeWorkerName(workerName?: string | null, proposal?: ProposalPayload | null) {
  const cleanName = String(workerName ?? "").trim();
  if (!proposal) return cleanName || null;
  const compact = JSON.stringify({
    workerName: cleanName || null,
    proposal,
  });
  return `${PROPOSAL_PREFIX}${encodeURIComponent(compact)}`;
}

function decodeWorkerName(raw: unknown): { workerName?: string; proposal?: ProposalPayload } {
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
      proposal?: ProposalPayload;
    };
    return {
      workerName: parsed?.workerName ?? undefined,
      proposal: parsed?.proposal ?? undefined,
    };
  } catch {
    return {};
  }
}

async function sendDecisionEmail(to: string, subject: string, html: string) {
  const brandedFrom = "Reelencer <noreply@reelencer.com>";

  const resendEnvCandidates = [
    { key: "RESEND_API_KEY", value: String(process.env.RESEND_API_KEY || "").trim() },
    { key: "RESEND_KEY", value: String(process.env.RESEND_KEY || "").trim() },
    { key: "RESEND_API_TOKEN", value: String(process.env.RESEND_API_TOKEN || "").trim() },
    { key: "RESEND_TOKEN", value: String(process.env.RESEND_TOKEN || "").trim() },
    { key: "RESEND_SECRET", value: String(process.env.RESEND_SECRET || "").trim() },
    { key: "RESEND_PRIVATE_KEY", value: String(process.env.RESEND_PRIVATE_KEY || "").trim() },
    { key: "RESEND_EMAIL_API_KEY", value: String(process.env.RESEND_EMAIL_API_KEY || "").trim() },
  ] as const;
  const resendFromCandidates = [
    { key: "RESEND_FROM", value: String(process.env.RESEND_FROM || "").trim() },
    { key: "RESEND_FROM_EMAIL", value: String(process.env.RESEND_FROM_EMAIL || "").trim() },
  ] as const;

  const resendKey = resendEnvCandidates.find((candidate) => candidate.value)?.value || "";
  const resendFrom = resendFromCandidates.find((candidate) => candidate.value)?.value || brandedFrom;

  if (resendKey) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: resendFrom,
        to: [to],
        subject,
        html,
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(body || `Resend delivery failed with status ${response.status}.`);
    }
    return;
  }

  const mailgunApiKey = String(process.env.MAILGUN_API_KEY || "").trim();
  const mailgunDomain = String(process.env.MAILGUN_DOMAIN || "").trim();
  const mailgunApiBase = String(process.env.MAILGUN_API_BASE || "https://api.mailgun.net")
    .trim()
    .replace(/\/+$/, "");
  const mailgunFrom = String(process.env.MAILGUN_FROM || resendFrom || brandedFrom).trim();

  if (mailgunApiKey && mailgunDomain) {
    const params = new URLSearchParams();
    params.set("from", mailgunFrom);
    params.set("to", to);
    params.set("subject", subject);
    params.set("html", html);

    const response = await fetch(`${mailgunApiBase}/v3/${mailgunDomain}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`api:${mailgunApiKey}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(body || `Mailgun delivery failed with status ${response.status}.`);
    }
    return;
  }

  const gmailUser = String(process.env.GMAIL_IMAP_USER || "").trim();
  const gmailPass = String(process.env.GMAIL_IMAP_APP_PASSWORD || "").trim();
  const host = String(process.env.SMTP_HOST || (gmailUser && gmailPass ? "smtp.gmail.com" : "")).trim();
  const port = Number(String(process.env.SMTP_PORT || 587).trim() || 587);
  const user = String(process.env.SMTP_USER || gmailUser).trim();
  const pass = String(process.env.SMTP_PASS || gmailPass).trim();
  const from = String(process.env.SMTP_FROM || brandedFrom).trim();
  if (!host || !user || !pass || !from) return;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  await transporter.sendMail({ from, to, subject, html });
}

function appBaseUrl() {
  const raw = String(process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://reelencer.com").trim();
  return raw.replace(/\/+$/, "");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderMailLayout({
  eyebrow,
  title,
  intro,
  sections,
  ctaLabel,
  ctaHref,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  sections?: Array<{ label: string; value: string }>;
  ctaLabel: string;
  ctaHref: string;
}) {
  const sectionHtml = (sections ?? [])
    .filter((section) => section.value.trim())
    .map(
      (section) => `
        <tr>
          <td style="padding:0 0 14px 0;">
            <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#7b8f84;font-weight:700;">${escapeHtml(section.label)}</div>
            <div style="margin-top:6px;font-size:15px;line-height:1.6;color:#2f4b3f;">${escapeHtml(section.value)}</div>
          </td>
        </tr>
      `
    )
    .join("");

  return `
    <div style="margin:0;padding:32px 16px;background:#eef4ea;font-family:Inter,Segoe UI,Arial,sans-serif;color:#1f352c;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;margin:0 auto;border-collapse:collapse;">
        <tr>
          <td style="padding:0;">
            <div style="border:1px solid #d4dccf;border-radius:28px;background:#ffffff;overflow:hidden;box-shadow:0 18px 48px rgba(35,69,56,0.08);">
              <div style="padding:28px 28px 18px;background:linear-gradient(180deg,#f8faf7 0%,#edf5ef 100%);border-bottom:1px solid #dfe8dc;">
                <div style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#6f877d;font-weight:800;">${escapeHtml(eyebrow)}</div>
                <div style="margin-top:10px;font-size:30px;line-height:1.15;font-weight:800;color:#1d3f33;">${escapeHtml(title)}</div>
                <div style="margin-top:12px;font-size:16px;line-height:1.7;color:#496257;">${escapeHtml(intro)}</div>
              </div>
              <div style="padding:26px 28px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  ${sectionHtml}
                  <tr>
                    <td style="padding-top:8px;">
                      <a href="${escapeHtml(ctaHref)}" style="display:inline-block;padding:14px 22px;border-radius:999px;background:#1f4f43;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">${escapeHtml(ctaLabel)}</a>
                    </td>
                  </tr>
                </table>
              </div>
              <div style="padding:18px 28px 26px;font-size:13px;line-height:1.7;color:#71887c;border-top:1px solid #edf3eb;background:#fbfdfb;">
                This update was sent by Reelencer Operations. You can continue the full workflow from your registered dashboard.
              </div>
            </div>
          </td>
        </tr>
      </table>
    </div>
  `;
}

async function resolveNotificationContext(sb: ReturnType<typeof supabaseAdmin>, row: any): Promise<{ to: string | null; context: NotificationContext | null }> {
  const workerCode = String(row?.worker_code ?? "");
  const gigId = String(row?.gig_id ?? "");
  const [{ data: worker }, { data: gig }] = await Promise.all([
    sb.from("workers").select("id,user_id,email,name").eq("id", workerCode).maybeSingle(),
    sb.from("gigs").select("title,company").eq("id", gigId).maybeSingle(),
  ]);

  const profile = worker?.user_id
    ? await sb.from("profiles").select("email,display_name").eq("id", worker.user_id).maybeSingle()
    : { data: null as any };
  const to = String(profile.data?.email ?? worker?.email ?? "").trim() || null;
  if (!to) return { to: null, context: null };

  return {
    to,
    context: {
      recipient: String(profile.data?.display_name ?? worker?.name ?? "there"),
      gigTitle: String(gig?.title ?? "your project"),
      company: String(gig?.company ?? "Reelencer"),
      proceedUrl: `${appBaseUrl()}/proceed?gigId=${encodeURIComponent(gigId)}`,
    },
  };
}

async function sendLifecycleNotification(
  to: string | null,
  context: NotificationContext | null,
  config: {
    eyebrow: string;
    title: string;
    intro: string;
    sections?: Array<{ label: string; value: string }>;
    ctaLabel?: string;
  }
) {
  if (!to || !context) return;
  const subject = `${config.eyebrow}: ${context.gigTitle}`;
  const html = renderMailLayout({
    eyebrow: config.eyebrow,
    title: config.title,
    intro: config.intro,
    sections: config.sections,
    ctaLabel: config.ctaLabel ?? "Open project panel",
    ctaHref: context.proceedUrl,
  });
  await sendDecisionEmail(to, subject, html);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const gigId = url.searchParams.get("gigId") ?? undefined;
  const workerId = url.searchParams.get("workerId") ?? undefined;
  const sb = supabaseAdmin();
  let query = sb.from("gig_applications").select("*").order("applied_at", { ascending: false });
  if (gigId) query = query.eq("gig_id", gigId);
  if (workerId) query = query.eq("worker_code", workerId);
  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
  }
  const payload = (data ?? []).map((a: any) => ({
    ...(decodeWorkerName(a.worker_name)),
    id: String(a.id),
    gigId: String(a.gig_id),
    workerId: String(a.worker_code),
    status: a.status,
    appliedAt: a.applied_at,
    decidedAt: a.decided_at ?? undefined,
  }));
  return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body?.gigId || !body?.workerId) {
      return NextResponse.json({ error: "gigId and workerId required" }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const sb = supabaseAdmin();
    const { data: existingRow } = await sb
      .from("gig_applications")
      .select("id")
      .eq("gig_id", body.gigId)
      .eq("worker_code", body.workerId)
      .maybeSingle();
    const resolvedId = body.id || existingRow?.id || randomUUID();
    const workerNameEncoded = encodeWorkerName(body.workerName, body.proposal ?? null);
    const { data, error } = await sb
      .from("gig_applications")
      .upsert(
        {
          id: resolvedId,
          gig_id: body.gigId,
          worker_code: body.workerId,
          worker_name: workerNameEncoded,
          status: body.status ?? "Applied",
          applied_at: new Date().toISOString(),
        },
        { onConflict: "gig_id,worker_code" }
      )
      .select("*")
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
    }
    const responsePayload = {
      ...(decodeWorkerName(data.worker_name)),
      id: String(data.id),
      gigId: String(data.gig_id),
      workerId: String(data.worker_code),
      status: data.status,
      appliedAt: data.applied_at,
      decidedAt: data.decided_at ?? undefined,
    };

    try {
      const decoded = decodeWorkerName(data.worker_name);
      if (decoded.proposal) {
        const { to, context } = await resolveNotificationContext(sb, data);
        await sendLifecycleNotification(to, context, {
          eyebrow: "Proposal Submitted",
          title: "Your proposal has been received",
          intro: `Your proposal for ${context?.gigTitle ?? "this role"} at ${context?.company ?? "Reelencer"} is now queued for recruiter review.`,
          sections: [
            { label: "Current stage", value: "Recruiter review is pending. Updates will be published in your project panel and sent by email when the workflow advances." },
            { label: "Next step", value: "Wait for recruiter guidance, onboarding instructions, or a final decision." },
          ],
          ctaLabel: "Track proposal status",
        });
      }
    } catch {
      // optional notification only
    }

    return NextResponse.json(responsePayload, { headers: NO_STORE_HEADERS });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Invalid payload" }, { status: 400, headers: NO_STORE_HEADERS });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    if (!body?.id) {
      return NextResponse.json({ error: "id required" }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const updates = body.updates ?? {};
    const sb = supabaseAdmin();
    const { data: prevRow } = await sb
      .from("gig_applications")
      .select("*")
      .eq("id", String(body.id))
      .maybeSingle();
    const shouldEncodeWorkerName = Object.prototype.hasOwnProperty.call(updates, "workerName") || Object.prototype.hasOwnProperty.call(updates, "proposal");
    const encodedWorkerName = shouldEncodeWorkerName ? encodeWorkerName(updates.workerName, updates.proposal ?? null) : undefined;
    const { data, error } = await sb
      .from("gig_applications")
      .update({
        status: updates.status,
        decided_at: updates.decidedAt ?? new Date().toISOString(),
        worker_name: encodedWorkerName,
      })
      .eq("id", String(body.id))
      .select("*")
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
    }
    if (!data) {
      return NextResponse.json({ error: "Application not found" }, { status: 404, headers: NO_STORE_HEADERS });
    }
    const nextDecoded = decodeWorkerName(data.worker_name);
    const prevDecoded = decodeWorkerName(prevRow?.worker_name);
    const nextProposal = nextDecoded.proposal ?? {};
    const prevProposal = prevDecoded.proposal ?? {};
    const nextStatus = String(data.status ?? "");
    const prevStatus = String(prevRow?.status ?? "");
    const proposalStatusChanged = String(nextProposal.reviewStatus ?? "") !== String(prevProposal.reviewStatus ?? "");
    const whatsappLinkAdded = !!nextProposal.whatsappLink?.trim() && nextProposal.whatsappLink !== prevProposal.whatsappLink;
    const onboardingChanged = !!nextProposal.onboardingSteps?.trim() && nextProposal.onboardingSteps !== prevProposal.onboardingSteps;
    const groupConfirmedNow = !!nextProposal.groupJoinedConfirmed && !prevProposal.groupJoinedConfirmed;
    const recruiterNoteChanged =
      nextProposal.adminNote !== prevProposal.adminNote || nextProposal.adminExplanation !== prevProposal.adminExplanation;

    try {
      const { to, context } = await resolveNotificationContext(sb, data);
      if (proposalStatusChanged && nextProposal.reviewStatus === "Accepted") {
        await sendLifecycleNotification(to, context, {
          eyebrow: "Proposal Approved",
          title: "Recruiter approved your proposal",
          intro: `Your proposal for ${context?.gigTitle ?? "this role"} has been approved and moved into onboarding.`,
          sections: [
            { label: "Recruiter note", value: String(nextProposal.adminNote ?? "").trim() || "Approval confirmed. Continue to the next onboarding checkpoint." },
            { label: "Next steps", value: String(nextProposal.adminExplanation ?? nextProposal.onboardingSteps ?? "").trim() || "Open your project panel to review the onboarding workflow and recruiter instructions." },
          ],
          ctaLabel: "Open onboarding panel",
        });
      } else if (proposalStatusChanged && nextProposal.reviewStatus === "Rejected") {
        await sendLifecycleNotification(to, context, {
          eyebrow: "Proposal Update",
          title: "Your proposal needs revision",
          intro: `Recruiter review for ${context?.gigTitle ?? "this role"} has completed and changes are required before the next round.`,
          sections: [
            { label: "Recruiter note", value: String(nextProposal.adminNote ?? "").trim() || "Review the latest notes in your project panel." },
            { label: "Guidance", value: String(nextProposal.adminExplanation ?? "").trim() || "Submit a stronger revision after addressing the current feedback." },
          ],
          ctaLabel: "Review feedback",
        });
      } else if (whatsappLinkAdded) {
        await sendLifecycleNotification(to, context, {
          eyebrow: "WhatsApp Invite Issued",
          title: "Your recruiter has issued the onboarding invite",
          intro: `A WhatsApp onboarding link is now available for ${context?.gigTitle ?? "your application"}.`,
          sections: [
            {
              label: "Current stage",
              value: "Your proposal has moved into recruiter onboarding and is waiting for you to open the latest instructions.",
            },
            { label: "Recruiter note", value: String(nextProposal.adminNote ?? "").trim() },
            {
              label: "What to do now",
              value:
                String(nextProposal.adminExplanation ?? nextProposal.onboardingSteps ?? "").trim() ||
                "Open your project panel, review the invite, and complete the onboarding steps shared by the recruiter.",
            },
          ],
          ctaLabel: "Open WhatsApp onboarding",
        });
      } else if (onboardingChanged || recruiterNoteChanged) {
        await sendLifecycleNotification(to, context, {
          eyebrow: "Recruiter Workflow Update",
          title: "Your onboarding instructions were updated",
          intro: `New recruiter guidance is available for ${context?.gigTitle ?? "your application"}.`,
          sections: [
            { label: "Recruiter note", value: String(nextProposal.adminNote ?? "").trim() },
            { label: "Next steps", value: String(nextProposal.adminExplanation ?? nextProposal.onboardingSteps ?? "").trim() },
          ],
          ctaLabel: "View latest instructions",
        });
      } else if (groupConfirmedNow) {
        await sendLifecycleNotification(to, context, {
          eyebrow: "Onboarding Confirmed",
          title: "Group join confirmation recorded",
          intro: `Your onboarding confirmation for ${context?.gigTitle ?? "this role"} has been recorded successfully.`,
          sections: [
            { label: "Current stage", value: "Recruiter final review remains in progress. You will be notified once the final decision is published." },
            { label: "Confirmed at", value: String(nextProposal.groupJoinedConfirmedAt ?? "").trim() },
          ],
          ctaLabel: "Track final review",
        });
      } else if ((nextStatus === "Accepted" || nextStatus === "Rejected") && prevStatus !== nextStatus) {
        await sendLifecycleNotification(to, context, {
          eyebrow: nextStatus === "Accepted" ? "Final Recruiter Decision" : "Final Recruiter Decision",
          title: nextStatus === "Accepted" ? "You have been selected to move forward" : "Recruiter review has been completed",
          intro:
            nextStatus === "Accepted"
              ? `Your application for ${context?.gigTitle ?? "this role"} at ${context?.company ?? "Reelencer"} has cleared the final recruiter review.`
              : `Your application for ${context?.gigTitle ?? "this role"} at ${context?.company ?? "Reelencer"} has completed final recruiter review.`,
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
          ctaLabel: nextStatus === "Accepted" ? "Continue to your project" : "Review final update",
        });
      }
    } catch {
      // optional notification only
    }

    return NextResponse.json(
      {
        ...nextDecoded,
        id: String(data.id),
        gigId: String(data.gig_id),
        workerId: String(data.worker_code),
        status: data.status,
        appliedAt: data.applied_at,
        decidedAt: data.decided_at ?? undefined,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Invalid payload" }, { status: 400, headers: NO_STORE_HEADERS });
  }
}

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

type EncodedWorkerPayload = {
  workerName?: string | null;
  workerEmail?: string | null;
  workerUserId?: string | null;
  proposal?: ProposalPayload;
};

type NotificationContext = {
  recipient: string;
  gigTitle: string;
  company: string;
  proceedUrl: string;
};

type MailStatus =
  | { sent: true; recipient: string; provider?: string }
  | { sent: false; recipient?: string | null; reason: string };

function encodeWorkerName(
  workerName?: string | null,
  proposal?: ProposalPayload | null,
  extras?: { workerEmail?: string | null; workerUserId?: string | null }
) {
  const cleanName = String(workerName ?? "").trim();
  if (!proposal) return cleanName || null;
  const compact: EncodedWorkerPayload = {
    workerName: cleanName || null,
    workerEmail: String(extras?.workerEmail ?? "").trim() || null,
    workerUserId: String(extras?.workerUserId ?? "").trim() || null,
    proposal,
  };
  return `${PROPOSAL_PREFIX}${encodeURIComponent(JSON.stringify(compact))}`;
}

function decodeWorkerName(raw: unknown): { workerName?: string; workerEmail?: string; workerUserId?: string; proposal?: ProposalPayload } {
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

async function sendDecisionEmail(to: string, subject: string, html: string) {
  const brandedFrom = "Reelencer Support <support@reelencer.com>";

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
    { key: "NEXT_PUBLIC_RESEND_FROM", value: String(process.env.NEXT_PUBLIC_RESEND_FROM || "").trim() },
    { key: "NEXT_PUBLIC_RESEND_FROM_EMAIL", value: String(process.env.NEXT_PUBLIC_RESEND_FROM_EMAIL || "").trim() },
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
    return { provider: "resend" as const };
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
    return { provider: "mailgun" as const };
  }

  const gmailUser = String(process.env.GMAIL_IMAP_USER || "").trim();
  const gmailPass = String(process.env.GMAIL_IMAP_APP_PASSWORD || "").trim();
  const host = String(process.env.SMTP_HOST || (gmailUser && gmailPass ? "smtp.gmail.com" : "")).trim();
  const port = Number(String(process.env.SMTP_PORT || 587).trim() || 587);
  const user = String(process.env.SMTP_USER || gmailUser).trim();
  const pass = String(process.env.SMTP_PASS || gmailPass).trim();
  const from = brandedFrom;
  if (!host || !user || !pass || !from) {
    throw new Error("Mail delivery is not configured for proposal notifications.");
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  await transporter.sendMail({ from, to, subject, html });
  return { provider: "smtp" as const };
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

function formatMailText(value: string) {
  return escapeHtml(value).replace(/\n/g, "<br />");
}

function renderMailLayout({
  eyebrow,
  title,
  intro,
  sections,
  highlights,
  ctaLabel,
  ctaHref,
  secondaryCtaLabel,
  secondaryCtaHref,
  footer,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  sections?: Array<{ label: string; value: string }>;
  highlights?: Array<{ label: string; value: string }>;
  ctaLabel: string;
  ctaHref: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
  footer?: string;
}) {
  const sectionHtml = (sections ?? [])
    .filter((section) => section.value.trim())
    .map(
      (section) => `
        <tr>
          <td style="padding:0 0 14px 0;">
            <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#7b8f84;font-weight:700;">${escapeHtml(section.label)}</div>
            <div style="margin-top:6px;font-size:15px;line-height:1.6;color:#2f4b3f;">${formatMailText(section.value)}</div>
          </td>
        </tr>
      `
    )
    .join("");
  const highlightsHtml = (highlights ?? [])
    .filter((item) => item.value.trim())
    .map(
      (item) => `
        <td style="padding:0 10px 10px 0;">
          <div style="min-width:160px;border:1px solid #dfe8dc;border-radius:18px;background:#fbfdfb;padding:14px 16px;">
            <div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#7b8f84;font-weight:800;">${escapeHtml(item.label)}</div>
            <div style="margin-top:6px;font-size:16px;line-height:1.45;color:#203a33;font-weight:700;">${formatMailText(item.value)}</div>
          </div>
        </td>
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
                <div style="margin-top:12px;font-size:16px;line-height:1.7;color:#496257;">${formatMailText(intro)}</div>
              </div>
              <div style="padding:26px 28px;">
                ${highlightsHtml ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 18px 0;border-collapse:collapse;"><tr>${highlightsHtml}</tr></table>` : ""}
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  ${sectionHtml}
                  <tr>
                    <td style="padding-top:8px;">
                      <a href="${escapeHtml(ctaHref)}" style="display:inline-block;padding:14px 22px;border-radius:999px;background:#1f4f43;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">${escapeHtml(ctaLabel)}</a>
                      ${secondaryCtaLabel && secondaryCtaHref ? `<a href="${escapeHtml(secondaryCtaHref)}" style="display:inline-block;margin-left:10px;padding:14px 22px;border-radius:999px;border:1px solid #d4dfd7;background:#ffffff;color:#31584b;text-decoration:none;font-size:14px;font-weight:700;">${escapeHtml(secondaryCtaLabel)}</a>` : ""}
                    </td>
                  </tr>
                </table>
              </div>
              <div style="padding:18px 28px 26px;font-size:13px;line-height:1.7;color:#71887c;border-top:1px solid #edf3eb;background:#fbfdfb;">
                ${formatMailText(footer || "This update was sent by Reelencer Operations. Continue the workflow from your registered dashboard for the latest recruiter status, onboarding actions, and project instructions.")}
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
    .map((candidate: any) => decodeWorkerName(candidate.worker_name))
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
      : Promise.resolve({ data: null as any, error: null as any }),
    resolvedUserId ? sb.auth.admin.getUserById(resolvedUserId) : Promise.resolve({ data: { user: null as any } }),
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
    highlights?: Array<{ label: string; value: string }>;
    ctaLabel?: string;
    ctaHref?: string;
    secondaryCtaLabel?: string;
    secondaryCtaHref?: string;
    footer?: string;
  }
) : Promise<MailStatus> {
  if (!to || !context) return { sent: false, recipient: to, reason: "No recipient email was found for this application." };
  const subject = `${config.eyebrow}: ${context.gigTitle}`;
  const html = renderMailLayout({
    eyebrow: config.eyebrow,
    title: config.title,
    intro: config.intro,
    sections: config.sections,
    highlights: config.highlights,
    ctaLabel: config.ctaLabel ?? "Open project panel",
    ctaHref: config.ctaHref ?? context.proceedUrl,
    secondaryCtaLabel: config.secondaryCtaLabel,
    secondaryCtaHref: config.secondaryCtaHref,
    footer: config.footer,
  });
  const result = await sendDecisionEmail(to, subject, html);
  return { sent: true, recipient: to, provider: result?.provider };
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
    const workerNameEncoded = encodeWorkerName(body.workerName, body.proposal ?? null, {
      workerEmail: body.workerEmail,
      workerUserId: body.workerUserId,
    });
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

    let mailStatus: MailStatus | null = null;
    try {
      const decoded = decodeWorkerName(data.worker_name);
      if (decoded.proposal) {
        const { to, context } = await resolveNotificationContext(sb, data);
        mailStatus = await sendLifecycleNotification(to, context, {
          eyebrow: "Proposal Submitted",
          title: `Your proposal was received, ${context?.recipient ?? "there"}`,
          intro: `Your application for ${context?.gigTitle ?? "this role"} at ${context?.company ?? "Reelencer"} is now in the recruiter review queue.`,
          highlights: [
            { label: "Review state", value: "Queued for recruiter review" },
            { label: "Company", value: context?.company ?? "Reelencer" },
          ],
          sections: [
            { label: "What happens next", value: "Recruiter review is pending. You will receive a dashboard update and an email the moment onboarding instructions or a final decision are published." },
            { label: "What you need to do now", value: "No action is required at this stage. Keep your registered email active and monitor your project panel for recruiter guidance." },
          ],
          ctaLabel: "Track application status",
        });
      }
    } catch (error) {
      mailStatus = {
        sent: false,
        reason: error instanceof Error ? error.message : "Unable to send proposal notification.",
      };
    }

    return NextResponse.json({ ...responsePayload, mailStatus }, { headers: NO_STORE_HEADERS });
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
    const prevDecodedForEncode = decodeWorkerName(prevRow?.worker_name);
    const encodedWorkerName = shouldEncodeWorkerName
      ? encodeWorkerName(updates.workerName, updates.proposal ?? null, {
          workerEmail: updates.workerEmail ?? prevDecodedForEncode.workerEmail,
          workerUserId: updates.workerUserId ?? prevDecodedForEncode.workerUserId,
        })
      : undefined;
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

    let mailStatus: MailStatus | null = null;
    try {
      const { to, context } = await resolveNotificationContext(sb, data);
      if (proposalStatusChanged && nextProposal.reviewStatus === "Accepted") {
        mailStatus = await sendLifecycleNotification(to, context, {
          eyebrow: "Proposal Approved",
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
          ctaLabel: "Open onboarding panel",
          secondaryCtaLabel: nextProposal.whatsappLink?.trim() ? "Open WhatsApp group" : undefined,
          secondaryCtaHref: nextProposal.whatsappLink?.trim() || undefined,
        });
      } else if (proposalStatusChanged && nextProposal.reviewStatus === "Rejected") {
        mailStatus = await sendLifecycleNotification(to, context, {
          eyebrow: "Proposal Update",
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
          ctaLabel: "Review feedback",
        });
      } else if (whatsappLinkAdded) {
        mailStatus = await sendLifecycleNotification(to, context, {
          eyebrow: "WhatsApp Invite Issued",
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
          ctaLabel: "Open WhatsApp onboarding",
          ctaHref: nextProposal.whatsappLink?.trim() || context?.proceedUrl,
          secondaryCtaLabel: "Open project panel",
          secondaryCtaHref: context?.proceedUrl,
        });
      } else if (onboardingChanged || recruiterNoteChanged) {
        mailStatus = await sendLifecycleNotification(to, context, {
          eyebrow: "Recruiter Workflow Update",
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
          ctaLabel: "View latest instructions",
          secondaryCtaLabel: nextProposal.whatsappLink?.trim() ? "Open WhatsApp group" : undefined,
          secondaryCtaHref: nextProposal.whatsappLink?.trim() || undefined,
        });
      } else if (groupConfirmedNow) {
        mailStatus = await sendLifecycleNotification(to, context, {
          eyebrow: "Onboarding Confirmed",
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
          ctaLabel: "Track final review",
        });
      } else if ((nextStatus === "Accepted" || nextStatus === "Rejected") && prevStatus !== nextStatus) {
        mailStatus = await sendLifecycleNotification(to, context, {
          eyebrow: "Final Recruiter Decision",
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
          ctaLabel: nextStatus === "Accepted" ? "Continue to your project" : "Review final update",
        });
      }
    } catch (error) {
      mailStatus = {
        sent: false,
        reason: error instanceof Error ? error.message : "Unable to send recruiter lifecycle notification.",
      };
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
        mailStatus,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Invalid payload" }, { status: 400, headers: NO_STORE_HEADERS });
  }
}

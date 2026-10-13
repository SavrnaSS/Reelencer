import { databaseError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/route";
import { json, requireAdminFromBearer, supabaseAdmin } from "../_utils";
import { emailBaseUrl, sendEmail } from "@/lib/email/send";
import { firstName, renderBrandEmail } from "@/lib/email/brandEmail";

async function sendKycEmail(to: string, subject: string, html: string, text?: string) {
  try {
    const { provider } = await sendEmail({ to, subject, html, text, category: "kyc" });
    return { sent: true as const, provider };
  } catch (error) {
    return { sent: false as const, reason: error instanceof Error ? error.message.slice(0, 300) : "Email delivery failed." };
  }
}

const appBaseUrl = emailBaseUrl;

async function resolveKycRecipient(
  sb: ReturnType<typeof supabaseAdmin>,
  userId: string,
  workerId: string | null
) {
  type WorkerLookupRow = { email?: string | null; name?: string | null };
  const [{ data: profile }, { data: worker }, authUserRes] = await Promise.all([
    sb.from("profiles").select("email,display_name").eq("id", userId).maybeSingle(),
    workerId
      ? sb.from("workers").select("email,name").eq("id", workerId).maybeSingle()
      : Promise.resolve({ data: null as WorkerLookupRow | null, error: null as unknown }),
    sb.auth.admin.getUserById(userId),
  ]);

  const authUser = authUserRes.data?.user ?? null;
  const email =
    String(profile?.email ?? "").trim() ||
    String(worker?.email ?? "").trim() ||
    String(authUser?.email ?? "").trim() ||
    null;
  const displayName =
    String(profile?.display_name ?? "").trim() ||
    String(worker?.name ?? "").trim() ||
    String(authUser?.user_metadata?.name ?? authUser?.user_metadata?.full_name ?? "").trim() ||
    "there";

  return { email, displayName };
}

async function handleGET(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });
  if (guard.devBypass) return json(200, { ok: true, rows: [] });

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("worker_kyc")
    .select("id,user_id,status,legal_name,dob,phone,address,id_type,id_number,submitted_at,reviewed_at,rejection_reason,worker_id,id_doc_path,selfie_path,admin_note");

  if (error) return json(500, { ok: false, error: error.message });

  type KycRow = {
    id: string;
    user_id: string;
    worker_id?: string | null;
    id_doc_path?: string | null;
    selfie_path?: string | null;
    [key: string]: unknown;
  };
  const rows = (data ?? []) as KycRow[];
  const withUrls = await Promise.all(
    rows.map(async (row) => {
      const recipient = await resolveKycRecipient(sb, row.user_id, row.worker_id ?? null);
      const idDoc =
        row.id_doc_path
          ? await sb.storage.from("kyc").createSignedUrl(row.id_doc_path, 60 * 10)
          : null;
      const selfie =
        row.selfie_path
          ? await sb.storage.from("kyc").createSignedUrl(row.selfie_path, 60 * 10)
          : null;
      const { data: events } = await sb
        .from("worker_kyc_events")
        .select("status,note,created_at,actor_id")
        .eq("kyc_id", row.id)
        .order("created_at", { ascending: false });
      return {
        ...row,
        id_doc_url: idDoc?.data?.signedUrl ?? null,
        selfie_url: selfie?.data?.signedUrl ?? null,
        events: events ?? [],
        email: recipient.email,
      };
    })
  );

  return json(200, { ok: true, rows: withUrls });
}

async function handlePATCH(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });

  const body = await req.json().catch(() => ({}));
  const id = String(body?.id ?? "");
  const status = String(body?.status ?? "");
  const rejectionReason = body?.rejectionReason ? String(body.rejectionReason) : null;
  const adminNote = body?.adminNote ? String(body.adminNote) : null;

  if (!id || !["approved", "rejected", "pending"].includes(status)) {
    return json(400, { ok: false, error: "id and valid status required" });
  }

  if (guard.devBypass) {
    return json(200, {
      ok: true,
      workerId: status === "approved" ? "dev-worker-bypass" : null,
      mailStatus: {
        sent: false,
        reason: "Local dev bypass does not send KYC notification email.",
      },
    });
  }

  const sb = supabaseAdmin();
  if (typeof body.submittedAt !== "string" || !Number.isFinite(Date.parse(body.submittedAt)) || (rejectionReason?.length ?? 0) > 2000 || (adminNote?.length ?? 0) > 4000) return json(400, { error: "Reload the verification and provide valid review details." });
  const { data: row, error } = await sb.rpc("review_worker_kyc", {
    p_actor: guard.userId, p_id: id, p_submitted_at: body.submittedAt, p_status: status, p_reason: rejectionReason, p_note: adminNote,
  });
  databaseError(error);
  const workerId: string | null = row.worker_id ?? null;

  let mailStatus:
    | { sent: true; recipient: string }
    | { sent: false; reason: string; recipient?: string | null }
    | null = null;

  try {
    const recipient = await resolveKycRecipient(sb, row.user_id, workerId);
    if (recipient.email && (status === "approved" || status === "rejected")) {
      const recipientName = recipient.displayName;
      const dashboardHref = `${appBaseUrl()}/dashboard?section=find`;
      const kycHref = `${appBaseUrl()}/dashboard`;
      const subject =
        status === "approved"
          ? "Your Reelencer KYC has been approved"
          : "Action needed: update your Reelencer KYC submission";
      const first = firstName(recipientName);
      const { html, text } =
        status === "approved"
          ? renderBrandEmail({
              siteUrl: appBaseUrl(),
              eyebrow: "KYC Approved",
              title: first ? `Welcome aboard, ${first}` : "Welcome aboard",
              intro: "Your identity verification has been successfully approved. Your Reelencer workspace is now unlocked, and you can continue with verified opportunities, assignments, and payout access.",
              tone: "success",
              highlights: [
                { label: "Status", value: "Verified" },
                { label: "Workspace ID", value: workerId || "Assigned in your profile" },
              ],
              sections: [
                { label: "Review outcome", value: "Approved by the Reelencer verification team" },
                { label: "What you can do now", value: "Open your dashboard, explore verified gigs, and continue through the worker workflow." },
                { label: "Team note", value: String(adminNote ?? "").trim() },
              ],
              cta: { label: "Open your workspace", href: dashboardHref },
              note: "This is an automated confirmation from Reelencer Operations. Your verified account is now active for workspace access and future platform updates.",
            })
          : renderBrandEmail({
              siteUrl: appBaseUrl(),
              eyebrow: "KYC Update",
              title: "Your verification needs one more update",
              greeting: first ? `Hi ${first},` : undefined,
              intro: "Your submitted KYC packet was reviewed, but it could not be approved in its current form. Please review the details below and submit an updated verification so the team can continue your approval process.",
              tone: "warning",
              highlights: [
                { label: "Status", value: "Changes needed" },
                { label: "Next step", value: "Resubmit your KYC" },
              ],
              sections: [
                { label: "Review outcome", value: "Returned for correction by the verification team" },
                { label: "Why this was returned", value: String(rejectionReason ?? "Please review your submission and upload clearer or matching documents.").trim() },
                { label: "Team note", value: String(adminNote ?? "").trim() },
                { label: "Next step", value: "Open your dashboard, update the requested details, and resubmit your verification packet." },
              ],
              cta: { label: "Review and update KYC", href: kycHref },
              note: "This is an automated notification from Reelencer Operations. Once you resubmit corrected details, your verification will return to the review queue.",
            });
      const result = await sendKycEmail(recipient.email, subject, html, text);
      mailStatus = result.sent
        ? { sent: true, recipient: recipient.email }
        : { sent: false, reason: result.reason, recipient: recipient.email };
    } else if (status === "approved" || status === "rejected") {
      mailStatus = { sent: false, reason: "No recipient email was found for this worker." };
    }
  } catch (mailError) {
    mailStatus = {
      sent: false,
      reason: mailError instanceof Error ? mailError.message : String(mailError),
    };
    console.error("KYC decision email failed", {
      kycId: row.id,
      userId: row.user_id,
      status,
      error: mailError instanceof Error ? mailError.message : String(mailError),
    });
  }

  if (mailStatus) {
    await sb.from("worker_kyc_events").insert({
      kyc_id: row.id,
      status,
      note: mailStatus.sent
        ? `Notification sent to ${mailStatus.recipient}`
        : `Notification not sent: ${mailStatus.reason}`,
      actor_id: guard.userId,
      created_at: new Date().toISOString(),
    });
  }

  return json(200, { ok: true, workerId, mailStatus });
}

export const GET = withApi({ auth: "admin" }, handleGET);

export const PATCH = withApi({ auth: "admin" }, handlePATCH);

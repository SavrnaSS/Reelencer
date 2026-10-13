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
      const walletHref = `${appBaseUrl()}/dashboard?section=wallet`;
      const kycHref = `${appBaseUrl()}/payouts`;
      const subject =
        status === "approved"
          ? "You're verified on Reelencer"
          : "Action needed: update your Reelencer verification";
      const first = firstName(recipientName);
      const teamNote = String(adminNote ?? "").trim();
      const { html, text } =
        status === "approved"
          ? renderBrandEmail({
              siteUrl: appBaseUrl(),
              preheader: "Your identity is verified. You can now request payouts from your wallet.",
              eyebrow: "Identity verified",
              title: "Your identity is verified",
              greeting: first ? `Hi ${first},` : "Hi there,",
              intro: "Good news: the team has reviewed and approved your KYC. Payouts are now unlocked, so you can withdraw your approved earnings from your wallet whenever you're ready.",
              tone: "success",
              illustration: "verified",
              highlights: [
                { label: "Status", value: "Verified" },
                { label: "Payouts", value: "Unlocked" },
                ...(workerId ? [{ label: "Creator ID", value: workerId }] : []),
              ],
              sections: [{ label: "Note from the team", value: teamNote }],
              cta: { label: "Open your wallet", href: walletHref },
              note: "You don't need to verify again. If your bank or UPI details change, update them in your wallet before your next payout.",
            })
          : renderBrandEmail({
              siteUrl: appBaseUrl(),
              preheader: "Your KYC needs a quick update before payouts can be unlocked.",
              eyebrow: "Action needed",
              title: "Your verification needs an update",
              greeting: first ? `Hi ${first},` : "Hi there,",
              intro: "Thanks for submitting your KYC. The team couldn't approve it as it is, so we've sent it back for a quick fix. Your work and earnings are safe; payouts unlock as soon as you're verified.",
              tone: "warning",
              highlights: [
                { label: "Status", value: "Changes needed" },
                { label: "What to fix", value: String(rejectionReason ?? "").trim() || "Upload clearer documents that match your details." },
              ],
              sections: [{ label: "Note from the team", value: teamNote }],
              cta: { label: "Update my KYC", href: kycHref },
              steps: [
                { title: "Open your KYC", body: "Review the reason above and replace the documents or details it mentions." },
                { title: "Take a fresh selfie", body: "Use the live camera in good light, with your face fully visible." },
                { title: "Resubmit", body: "The team reviews it again and emails you the result." },
              ],
              note: "Questions about what to change? Reply to this email and the verification team will help.",
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

import { json, requireAdminFromBearer, supabaseAdmin } from "../_utils";
import nodemailer from "nodemailer";

function randomWorkerId() {
  return `WKR-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

async function ensureWorkerId(sb: ReturnType<typeof supabaseAdmin>, userId: string) {
  const existing = await sb.from("workers").select("id").eq("user_id", userId).maybeSingle();
  if (!existing.error && existing.data?.id) return existing.data.id as string;

  let workerId = "";
  for (let i = 0; i < 6; i += 1) {
    const candidate = randomWorkerId();
    const { data } = await sb.from("workers").select("id").eq("id", candidate).maybeSingle();
    if (!data?.id) {
      workerId = candidate;
      break;
    }
  }
  if (!workerId) throw new Error("Unable to generate worker id");

  const profile = await sb.from("profiles").select("display_name,email,role").eq("id", userId).maybeSingle();
  const name = profile.data?.display_name ?? "Worker";
  const email = profile.data?.email ?? null;

  await sb.from("profiles").update({ worker_code: workerId, role: "Worker", active: true }).eq("id", userId);
  await sb.from("workers").insert({ id: workerId, user_id: userId, name, email, active: true });

  return workerId;
}

async function sendKycEmail(to: string, subject: string, html: string) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;
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

function renderKycMailLayout({
  eyebrow,
  title,
  intro,
  tone = "neutral",
  sections,
  ctaLabel,
  ctaHref,
  footer,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  tone?: "neutral" | "success" | "warning";
  sections?: Array<{ label: string; value: string }>;
  ctaLabel: string;
  ctaHref: string;
  footer: string;
}) {
  const accent =
    tone === "success"
      ? { surface: "#edf8f1", border: "#d6eadc", pill: "#eff9f2", pillText: "#2c684d" }
      : tone === "warning"
        ? { surface: "#fff7ef", border: "#f3dcc2", pill: "#fff2df", pillText: "#9b5d16" }
        : { surface: "#f4f8f4", border: "#dfe8dc", pill: "#f6faf5", pillText: "#476255" };

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
              <div style="padding:28px 28px 18px;background:linear-gradient(180deg,#f8faf7 0%,${accent.surface} 100%);border-bottom:1px solid ${accent.border};">
                <div style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#6f877d;font-weight:800;">${escapeHtml(eyebrow)}</div>
                <div style="margin-top:10px;font-size:30px;line-height:1.15;font-weight:800;color:#1d3f33;">${escapeHtml(title)}</div>
                <div style="margin-top:12px;font-size:16px;line-height:1.7;color:#496257;">${escapeHtml(intro)}</div>
                <div style="margin-top:18px;display:inline-block;padding:10px 16px;border-radius:999px;border:1px solid ${accent.border};background:${accent.pill};color:${accent.pillText};font-size:12px;font-weight:800;letter-spacing:0.18em;text-transform:uppercase;">
                  ${escapeHtml(eyebrow)}
                </div>
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
                ${escapeHtml(footer)}
              </div>
            </div>
          </td>
        </tr>
      </table>
    </div>
  `;
}

export async function GET(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("worker_kyc")
    .select("id,user_id,status,legal_name,dob,phone,address,id_type,id_number,submitted_at,reviewed_at,rejection_reason,worker_id,id_doc_path,selfie_path,admin_note");

  if (error) return json(500, { ok: false, error: error.message });

  const rows = data ?? [];
  const withUrls = await Promise.all(
    rows.map(async (row: any) => {
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
      const { data: prof } = await sb.from("profiles").select("email").eq("id", row.user_id).maybeSingle();
      return {
        ...row,
        id_doc_url: idDoc?.data?.signedUrl ?? null,
        selfie_url: selfie?.data?.signedUrl ?? null,
        events: events ?? [],
        email: prof?.email ?? null,
      };
    })
  );

  return json(200, { ok: true, rows: withUrls });
}

export async function PATCH(req: Request) {
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

  const sb = supabaseAdmin();
  const { data: row, error: rowErr } = await sb.from("worker_kyc").select("*").eq("id", id).single();
  if (rowErr || !row) return json(404, { ok: false, error: "KYC not found" });

  let workerId: string | null = row.worker_id ?? null;
  if (status === "approved") {
    workerId = await ensureWorkerId(sb, row.user_id);
  }

  const { error } = await sb
    .from("worker_kyc")
    .update({
      status,
      reviewed_at: new Date().toISOString(),
      reviewer_id: guard.userId,
      rejection_reason: status === "rejected" ? rejectionReason : null,
      worker_id: workerId,
      admin_note: adminNote,
    })
    .eq("id", id);

  if (error) return json(500, { ok: false, error: error.message });

  await sb.from("worker_kyc_events").insert({
    kyc_id: row.id,
    status,
    note: adminNote ?? rejectionReason ?? (status === "approved" ? "Approved" : "Rejected"),
    actor_id: guard.userId,
    created_at: new Date().toISOString(),
  });

  // Optional email notification via SMTP
  try {
    const { data: prof } = await sb.from("profiles").select("email,display_name").eq("id", row.user_id).maybeSingle();
    if (prof?.email && (status === "approved" || status === "rejected")) {
      const recipientName = String(prof.display_name ?? "there").trim() || "there";
      const dashboardHref = `${appBaseUrl()}/browse`;
      const kycHref = `${appBaseUrl()}/browse`;
      const subject = status === "approved" ? "KYC approved for Reelencer workspace access" : "KYC review requires your attention";
      const html =
        status === "approved"
          ? renderKycMailLayout({
              eyebrow: "KYC Approved",
              title: `Workspace access is now available, ${recipientName}`,
              intro: "Your identity verification has been approved. You can now continue into the Reelencer worker experience and access verified workspace opportunities.",
              tone: "success",
              sections: [
                { label: "Verification status", value: "Approved by admin review" },
                { label: "Worker ID", value: workerId || "Assigned in your profile" },
                { label: "Next step", value: "Open your dashboard and continue browsing approved workspace gigs." },
                { label: "Admin note", value: String(adminNote ?? "").trim() },
              ],
              ctaLabel: "Open worker dashboard",
              ctaHref: dashboardHref,
              footer: "This confirmation was sent by Reelencer Operations after admin verification. Your account remains active for verified workspace access.",
            })
          : renderKycMailLayout({
              eyebrow: "KYC Update",
              title: `KYC review needs an update, ${recipientName}`,
              intro: "Your submitted identity packet was reviewed, but the verification could not be approved yet. Please review the note below and resubmit with corrected details if needed.",
              tone: "warning",
              sections: [
                { label: "Verification status", value: "Review returned for correction" },
                { label: "Reason", value: String(rejectionReason ?? "Please review your submission and upload clearer or matching documents.").trim() },
                { label: "Admin note", value: String(adminNote ?? "").trim() },
                { label: "Next step", value: "Open your dashboard, update the KYC details, and resubmit the verification packet." },
              ],
              ctaLabel: "Review KYC status",
              ctaHref: kycHref,
              footer: "This notification was sent by Reelencer Operations. After you resubmit corrected details, the verification queue will reopen for review.",
            });
      await sendKycEmail(prof.email, subject, html);
    }
  } catch {
    // ignore
  }

  return json(200, { ok: true, workerId });
}

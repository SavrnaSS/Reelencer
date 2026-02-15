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
    if (prof?.email) {
      const subject = status === "approved" ? "KYC approved" : "KYC rejected";
      const html =
        status === "approved"
          ? `<p>Hi ${prof.display_name ?? "there"},</p><p>Your KYC has been approved. Your Worker ID is <b>${workerId}</b>.</p>`
          : `<p>Hi ${prof.display_name ?? "there"},</p><p>Your KYC was rejected.${rejectionReason ? ` Reason: ${rejectionReason}` : ""}</p>`;
      await sendKycEmail(prof.email, subject, html);
    }
  } catch {
    // ignore
  }

  return json(200, { ok: true, workerId });
}

import { getSecretCodeFromHeaders, json, requireUserFromBearer, tableMissing, validateActiveCode } from "../_utils";

type WorkEmailInboxRow = {
  id: string;
  account_id: string;
  to_email?: string | null;
  from_email?: string | null;
  subject?: string | null;
  body?: string | null;
  otp_code?: string | null;
  created_at?: string | null;
  read_at?: string | null;
};

function mapInbox(row: WorkEmailInboxRow) {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    toEmail: String(row.to_email ?? ""),
    fromEmail: row.from_email ? String(row.from_email) : "",
    subject: String(row.subject ?? ""),
    body: String(row.body ?? ""),
    otpCode: row.otp_code ? String(row.otp_code) : "",
    createdAt: row.created_at,
    readAt: row.read_at ?? null,
  };
}

export async function GET(req: Request) {
  const guard = await requireUserFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });
  const code = getSecretCodeFromHeaders(req);
  const valid = await validateActiveCode(guard.admin, code);
  if (!valid.ok) {
    if (tableMissing(valid.error)) {
      return json(500, {
        ok: false,
        error: "Work email tables are missing. Run scripts/work-email-creator-schema.sql in Supabase SQL Editor.",
      });
    }
    return json(valid.status, { ok: false, error: valid.error });
  }

  const url = new URL(req.url);
  const accountId = String(url.searchParams.get("accountId") || "");
  const hours = Math.max(1, Math.min(72, Number(url.searchParams.get("hours") || 24)));
  if (!accountId) return json(400, { ok: false, error: "accountId is required." });

  const { data: owned, error: ownErr } = await guard.admin
    .from("work_email_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("owner_user_id", guard.userId)
    .eq("secret_code_id", String(valid.code.id))
    .neq("status", "deleted")
    .maybeSingle();

  if (ownErr || !owned) {
    const ownMsg = ownErr?.message || "Work email account not found.";
    if (tableMissing(ownMsg)) {
      return json(500, {
        ok: false,
        error: "Work email tables are missing. Run scripts/work-email-creator-schema.sql in Supabase SQL Editor.",
      });
    }
    return json(404, { ok: false, error: "Work email account not found." });
  }

  const cutoffIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const { data, error } = await guard.admin
    .from("work_email_inbox")
    .select("*")
    .eq("account_id", accountId)
    .gte("created_at", cutoffIso)
    .order("created_at", { ascending: false });

  if (error) {
    if (tableMissing(error.message)) {
      return json(500, {
        ok: false,
        error: "Work email tables are missing. Run scripts/work-email-creator-schema.sql in Supabase SQL Editor.",
      });
    }
    return json(500, { ok: false, error: error.message });
  }

  return json(200, { ok: true, inbox: (data ?? []).map(mapInbox) });
}

export async function PATCH(req: Request) {
  const guard = await requireUserFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });
  const code = getSecretCodeFromHeaders(req);
  const valid = await validateActiveCode(guard.admin, code);
  if (!valid.ok) {
    if (tableMissing(valid.error)) {
      return json(500, {
        ok: false,
        error: "Work email tables are missing. Run scripts/work-email-creator-schema.sql in Supabase SQL Editor.",
      });
    }
    return json(valid.status, { ok: false, error: valid.error });
  }

  const body = await req.json().catch(() => ({}));
  const accountId = String(body?.accountId || "");
  if (!accountId) return json(400, { ok: false, error: "accountId is required." });

  const { data: owned, error: ownErr } = await guard.admin
    .from("work_email_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("owner_user_id", guard.userId)
    .eq("secret_code_id", String(valid.code.id))
    .neq("status", "deleted")
    .maybeSingle();

  if (ownErr || !owned) {
    const ownMsg = ownErr?.message || "Work email account not found.";
    if (tableMissing(ownMsg)) {
      return json(500, {
        ok: false,
        error: "Work email tables are missing. Run scripts/work-email-creator-schema.sql in Supabase SQL Editor.",
      });
    }
    return json(404, { ok: false, error: "Work email account not found." });
  }

  const messageIds = Array.isArray(body?.messageIds) ? body.messageIds.map((x: unknown) => String(x)) : [];
  const base = guard.admin.from("work_email_inbox").update({ read_at: new Date().toISOString() }).eq("account_id", accountId);
  const query = messageIds.length ? base.in("id", messageIds) : base.is("read_at", null);
  const { error } = await query;

  if (error) {
    if (tableMissing(error.message)) {
      return json(500, {
        ok: false,
        error: "Work email tables are missing. Run scripts/work-email-creator-schema.sql in Supabase SQL Editor.",
      });
    }
    return json(500, { ok: false, error: error.message });
  }

  return json(200, { ok: true });
}

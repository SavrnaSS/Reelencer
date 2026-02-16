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

async function ensureOwnership(
  sb: {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          eq: (column: string, value: string) => {
            eq: (column: string, value: string) => {
              neq: (column: string, value: string) => {
                maybeSingle: () => Promise<{ data: { id: string } | null; error: { message: string } | null }>;
              };
            };
          };
        };
      };
    };
  },
  accountId: string,
  userId: string,
  codeId: string
) {
  const { data, error } = await sb
    .from("work_email_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("owner_user_id", userId)
    .eq("secret_code_id", codeId)
    .neq("status", "deleted")
    .maybeSingle();
  if (error) return { ok: false as const, status: 500, error: error.message };
  if (!data) return { ok: false as const, status: 404, error: "Work email account not found." };
  return { ok: true as const };
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

  const ownership = await ensureOwnership(guard.admin, accountId, guard.userId, String(valid.code.id));
  if (!ownership.ok) {
    if (tableMissing(ownership.error)) {
      return json(500, {
        ok: false,
        error: "Work email tables are missing. Run scripts/work-email-creator-schema.sql in Supabase SQL Editor.",
      });
    }
    return json(ownership.status, { ok: false, error: ownership.error });
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

  const ownership = await ensureOwnership(guard.admin, accountId, guard.userId, String(valid.code.id));
  if (!ownership.ok) {
    if (tableMissing(ownership.error)) {
      return json(500, {
        ok: false,
        error: "Work email tables are missing. Run scripts/work-email-creator-schema.sql in Supabase SQL Editor.",
      });
    }
    return json(ownership.status, { ok: false, error: ownership.error });
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

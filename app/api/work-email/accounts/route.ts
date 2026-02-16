import {
  getAllowedWorkEmailDomains,
  isValidDomain,
  isValidLocalPart,
  normalizeDomain,
  normalizeUsername,
  sanitizeLocalPart,
} from "@/lib/workEmail";
import { encryptSecretText } from "@/lib/secretCrypto";
import { getSecretCodeFromHeaders, json, requireUserFromBearer, tableMissing, validateActiveCode } from "../_utils";

type WorkEmailAccountRow = {
  id: string;
  email: string;
  local_part?: string | null;
  domain?: string | null;
  username?: string | null;
  social_password?: string | null;
  platform?: string | null;
  notes?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function mapAccount(row: WorkEmailAccountRow) {
  return {
    id: String(row.id),
    email: String(row.email),
    localPart: String(row.local_part ?? ""),
    domain: String(row.domain ?? ""),
    username: String(row.username ?? ""),
    hasSocialPassword: !!row.social_password,
    platform: String(row.platform ?? "General"),
    notes: row.notes ? String(row.notes) : "",
    status: String(row.status ?? "active"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

  const { data, error } = await guard.admin
    .from("work_email_accounts")
    .select("*")
    .eq("owner_user_id", guard.userId)
    .eq("secret_code_id", String(valid.code.id))
    .neq("status", "deleted")
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

  return json(200, { ok: true, accounts: (data ?? []).map(mapAccount), allowedDomains: getAllowedWorkEmailDomains() });
}

export async function POST(req: Request) {
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
  const username = normalizeUsername(String(body?.username ?? ""));
  const platform = String(body?.platform ?? "General").trim() || "General";
  const socialPassword = String(body?.socialPassword ?? "").trim();
  const notes = String(body?.notes ?? "").trim();
  const localPartRaw = String(body?.localPart ?? "").trim();
  const localPartInput = localPartRaw || username;
  const localPart = sanitizeLocalPart(localPartInput);
  const domain = normalizeDomain(String(body?.domain ?? getAllowedWorkEmailDomains()[0] ?? ""));
  const allowedDomains = getAllowedWorkEmailDomains();

  if (!username) {
    return json(400, { ok: false, error: "Username is required." });
  }
  if (!socialPassword) {
    return json(400, { ok: false, error: "Social account password is required." });
  }
  if (!isValidLocalPart(localPart)) {
    return json(400, { ok: false, error: "Invalid email local part. Use letters, numbers, dot, _, +, -." });
  }
  if (!isValidDomain(domain)) {
    return json(400, { ok: false, error: "Invalid email domain." });
  }
  if (!allowedDomains.includes(domain)) {
    return json(400, { ok: false, error: `Domain not allowed. Allowed: ${allowedDomains.join(", ")}` });
  }

  const email = `${localPart}@${domain}`;
  let encryptedPassword = "";
  try {
    encryptedPassword = encryptSecretText(socialPassword);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unable to secure social password.";
    return json(500, { ok: false, error: msg });
  }
  const payload = {
    owner_user_id: guard.userId,
    secret_code_id: String(valid.code.id),
    email,
    local_part: localPart,
    domain,
    username,
    social_password: encryptedPassword,
    platform,
    notes: notes || null,
    status: "active",
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await guard.admin.from("work_email_accounts").insert(payload).select("*").single();

  if (error) {
    const message = String(error.message || "");
    if (tableMissing(message)) {
      return json(500, {
        ok: false,
        error: "Work email tables are missing. Run scripts/work-email-creator-schema.sql in Supabase SQL Editor.",
      });
    }
    if (message.toLowerCase().includes("duplicate") || message.toLowerCase().includes("unique")) {
      return json(409, { ok: false, error: "This email already exists. Choose another local part." });
    }
    return json(500, { ok: false, error: message });
  }

  return json(200, { ok: true, account: mapAccount(data) });
}

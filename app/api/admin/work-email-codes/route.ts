import { codeHint, generateSecretCode, hashSecretCode } from "@/lib/workEmail";
import { json, requireAdminFromBearer, supabaseAdmin } from "../_utils";

function tableMissing(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("does not exist") ||
    lower.includes("relation") ||
    lower.includes("undefined table") ||
    lower.includes("schema cache") ||
    lower.includes("could not find the table")
  );
}

export async function GET(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("work_email_secret_codes")
    .select("id,label,code_hint,status,use_count,max_uses,expires_at,last_used_at,created_at,blocked_at")
    .order("created_at", { ascending: false });

  if (error) {
    if (tableMissing(error.message)) {
      return json(200, { ok: true, codes: [], missingSchema: true });
    }
    return json(500, { ok: false, error: error.message });
  }

  return json(200, { ok: true, codes: data ?? [] });
}

export async function POST(req: Request) {
  try {
    const guard = await requireAdminFromBearer(req);
    if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });

    const body = await req.json().catch(() => ({}));
    const label = String(body?.label ?? "").trim();
    const maxUsesRaw = Number(body?.maxUses ?? 0);
    const maxUses = Number.isFinite(maxUsesRaw) && maxUsesRaw > 0 ? Math.floor(maxUsesRaw) : null;

    const rawExpiry = String(body?.expiresAt ?? "").trim();
    let expiresAt: string | null = null;
    if (rawExpiry) {
      const parsed = new Date(rawExpiry);
      if (Number.isNaN(parsed.getTime())) {
        return json(400, { ok: false, error: "Invalid expiry date format. Use the date picker." });
      }
      expiresAt = parsed.toISOString();
    }

    const plainCode = generateSecretCode();
    const sb = supabaseAdmin();
    const payload = {
      label: label || null,
      code_hash: hashSecretCode(plainCode),
      code_hint: codeHint(plainCode),
      status: "active",
      use_count: 0,
      max_uses: maxUses,
      expires_at: expiresAt,
      created_by: guard.userId,
      created_at: new Date().toISOString(),
      blocked_at: null,
      last_used_at: null,
    };
    const { data, error } = await sb.from("work_email_secret_codes").insert(payload).select("*").single();
    if (error) {
      if (tableMissing(error.message)) {
        return json(500, { ok: false, error: "Missing schema. Run scripts/work-email-creator-schema.sql first." });
      }
      return json(500, { ok: false, error: error.message });
    }

    return json(200, { ok: true, code: plainCode, row: data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to generate code.";
    return json(500, { ok: false, error: message });
  }
}

export async function PATCH(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });

  const body = await req.json().catch(() => ({}));
  const id = String(body?.id ?? "");
  const action = String(body?.action ?? "").toLowerCase();
  if (!id || !["block", "unblock", "renew"].includes(action)) {
    return json(400, { ok: false, error: "id and action(block|unblock|renew) are required." });
  }

  const sb = supabaseAdmin();
  let update:
    | { status: "blocked"; blocked_at: string }
    | { status: "active"; blocked_at: null }
    | { status: "active"; blocked_at: null; expires_at: string | null; use_count?: number; last_used_at?: null };

  if (action === "block") {
    update = { status: "blocked", blocked_at: new Date().toISOString() };
  } else if (action === "unblock") {
    update = { status: "active", blocked_at: null };
  } else {
    const rawExpiry = String(body?.expiresAt ?? "").trim();
    let expiresAt: string | null = null;
    if (rawExpiry) {
      const parsed = new Date(rawExpiry);
      if (Number.isNaN(parsed.getTime())) {
        return json(400, { ok: false, error: "Invalid renewal expiry date format." });
      }
      expiresAt = parsed.toISOString();
    }
    const resetUsage = !!body?.resetUsage;
    update = {
      status: "active",
      blocked_at: null,
      expires_at: expiresAt,
      ...(resetUsage ? { use_count: 0, last_used_at: null } : {}),
    };
  }

  const { error } = await sb.from("work_email_secret_codes").update(update).eq("id", id);
  if (error) {
    if (tableMissing(error.message)) {
      return json(500, { ok: false, error: "Missing schema. Run scripts/work-email-creator-schema.sql first." });
    }
    return json(500, { ok: false, error: error.message });
  }
  return json(200, { ok: true });
}

export async function DELETE(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });

  const body = await req.json().catch(() => ({}));
  const id = String(body?.id ?? "");
  if (!id) return json(400, { ok: false, error: "id required." });

  const sb = supabaseAdmin();
  const { error } = await sb.from("work_email_secret_codes").delete().eq("id", id);
  if (error) {
    if (tableMissing(error.message)) {
      return json(500, { ok: false, error: "Missing schema. Run scripts/work-email-creator-schema.sql first." });
    }
    return json(500, { ok: false, error: error.message });
  }
  return json(200, { ok: true });
}

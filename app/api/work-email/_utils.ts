import { authenticate } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hashSecretCode } from "@/lib/workEmail";

export function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function tableMissing(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("does not exist") ||
    lower.includes("relation") ||
    lower.includes("undefined table") ||
    lower.includes("schema cache") ||
    lower.includes("could not find the table")
  );
}

export async function requireUserFromBearer(req: Request) {
  try {
    const actor = await authenticate(req);
    return { ok: true as const, userId: actor.user.id, admin: supabaseAdmin() };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false as const, status: error.status, error: error.message };
    throw error;
  }
}

export function getSecretCodeFromHeaders(req: Request) {
  return (req.headers.get("x-work-email-code") || "").trim();
}

export async function validateActiveCode(sb: ReturnType<typeof supabaseAdmin>, rawCode: string) {
  if (!rawCode) return { ok: false as const, status: 400, error: "Secret code is required." };
  const now = new Date();
  const hashed = hashSecretCode(rawCode);
  const { data, error } = await sb
    .from("work_email_secret_codes")
    .select("id,status,expires_at,max_uses,use_count")
    .eq("code_hash", hashed)
    .maybeSingle();

  if (error) return { ok: false as const, status: 500, error: error.message };
  if (!data) return { ok: false as const, status: 403, error: "Invalid secret code." };
  if (String(data.status || "").toLowerCase() !== "active") {
    return { ok: false as const, status: 403, error: "This secret code is blocked." };
  }

  const expiresAt = data.expires_at ? new Date(data.expires_at) : null;
  if (expiresAt && expiresAt.getTime() <= now.getTime()) {
    return { ok: false as const, status: 403, error: "This secret code has expired." };
  }

  return { ok: true as const, code: data };
}

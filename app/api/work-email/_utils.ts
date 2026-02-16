import { createClient } from "@supabase/supabase-js";
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

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, service, { auth: { persistSession: false } });
}

function supabaseAnon() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, anon, { auth: { persistSession: false } });
}

export async function requireUserFromBearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
  if (!token) return { ok: false as const, status: 401, error: "Missing bearer token" };

  const anon = supabaseAnon();
  const { data: userRes, error } = await anon.auth.getUser(token);
  const user = userRes?.user;
  if (error || !user) return { ok: false as const, status: 401, error: "Invalid session" };

  return { ok: true as const, userId: user.id, admin: supabaseAdmin() };
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

  const maxUses = Number(data.max_uses ?? 0);
  const useCount = Number(data.use_count ?? 0);
  if (maxUses > 0 && useCount >= maxUses) {
    return { ok: false as const, status: 403, error: "This secret code has reached its usage limit." };
  }

  return { ok: true as const, code: data };
}

export async function bumpCodeUsage(sb: ReturnType<typeof supabaseAdmin>, codeId: string, currentUseCount: number) {
  await sb
    .from("work_email_secret_codes")
    .update({
      use_count: currentUseCount + 1,
      last_used_at: new Date().toISOString(),
    })
    .eq("id", codeId);
}

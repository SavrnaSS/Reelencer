// app/api/admin/_utils.ts
import { createClient } from "@supabase/supabase-js";
import { authenticate } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { supabaseServerFetch } from "@/lib/supabase/serverFetch";

export { supabaseAdmin } from "@/lib/supabaseAdmin";

export function supabaseAnon() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, anon, { auth: { persistSession: false }, global: { fetch: supabaseServerFetch } });
}

export async function requireAdminFromBearer(req: Request) {
  try {
    const actor = await authenticate(req);
    if (!actor.isAdmin) return { ok: false as const, status: 403, error: "Administrator access required." };
    return { ok: true as const, userId: actor.user.id, devBypass: false as boolean };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false as const, status: error.status, error: error.message };
    throw error;
  }
}

export function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

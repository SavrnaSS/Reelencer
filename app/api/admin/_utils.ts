// app/api/admin/_utils.ts
import { createClient } from "@supabase/supabase-js";

export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, service, { auth: { persistSession: false } });
}

export function supabaseAnon() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, anon, { auth: { persistSession: false } });
}

export async function requireAdminFromBearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
  if (!token) return { ok: false as const, status: 401, error: "Missing bearer token" };

  const anon = supabaseAnon();
  const { data: userRes, error: userErr } = await anon.auth.getUser(token);
  const user = userRes?.user;
  if (userErr || !user) return { ok: false as const, status: 401, error: "Invalid session" };

  const admin = supabaseAdmin();
  const { data: profile, error: pErr } = await admin.from("profiles").select("role").eq("id", user.id).single();
  const role = String(profile?.role ?? "").toLowerCase();
  if (pErr || role !== "admin") return { ok: false as const, status: 403, error: "Forbidden" };

  return { ok: true as const, userId: user.id };
}

export function json(status: number, body: any) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

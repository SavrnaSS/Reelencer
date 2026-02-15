import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function supabaseAnon() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, anon, { auth: { persistSession: false } });
}

async function requireAdmin(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
  if (!token) return { ok: false as const, status: 401, error: "Missing bearer token" };
  const anon = supabaseAnon();
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data.user) return { ok: false as const, status: 401, error: "Invalid session" };
  const { data: profile } = await supabaseAdmin().from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  if (String(profile?.role ?? "").toLowerCase() !== "admin") {
    return { ok: false as const, status: 403, error: "Forbidden" };
  }
  return { ok: true as const };
}

export async function GET(req: Request) {
  const guard = await requireAdmin(req);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  const name = url.searchParams.get("name") || "file";
  if (!path) return NextResponse.json({ error: "path required" }, { status: 400 });

  const sb = supabaseAdmin();
  const { data, error } = await sb.storage.from("kyc").download(path);
  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Not found" }, { status: 404 });
  }

  const buf = Buffer.from(await data.arrayBuffer());
  return new Response(buf, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}

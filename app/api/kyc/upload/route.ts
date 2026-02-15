import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function supabaseAnon() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, anon, { auth: { persistSession: false } });
}

async function getUserIdFromBearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
  if (!token) return { ok: false as const, status: 401, error: "Missing bearer token" };
  const anon = supabaseAnon();
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data.user) return { ok: false as const, status: 401, error: "Invalid session" };
  return { ok: true as const, userId: data.user.id };
}

export async function POST(req: Request) {
  const guard = await getUserIdFromBearer(req);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status, headers: NO_STORE_HEADERS });
  }

  const form = await req.formData();
  const file = form.get("file");
  const kind = String(form.get("kind") ?? "");

  if (!(file instanceof File) || !kind) {
    return NextResponse.json({ error: "file and kind required" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const ext = file.name.split(".").pop() || "bin";
  const path = `kyc/${guard.userId}/${kind}-${Date.now()}.${ext}`;

  const sb = supabaseAdmin();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error } = await sb.storage.from("kyc").upload(path, bytes, {
    contentType: file.type || "application/octet-stream",
    upsert: true,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
  }

  return NextResponse.json({ ok: true, path }, { headers: NO_STORE_HEADERS });
}

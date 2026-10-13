import { withApi } from "@/lib/api/route";
import { validateUpload } from "@/lib/api/uploads";
import { verifySelfieSession } from "@/lib/api/kycSelfie";
import { LIVE_SELFIE_PREFIX } from "@/lib/kycSelfie";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServerFetch } from "@/lib/supabase/serverFetch";

export const runtime = "nodejs";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function supabaseAnon() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, anon, { auth: { persistSession: false }, global: { fetch: supabaseServerFetch } });
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

async function handlePOST(req: Request) {
  const guard = await getUserIdFromBearer(req);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status, headers: NO_STORE_HEADERS });
  }

  const form = await req.formData();
  const file = form.get("file");
  const kind = String(form.get("kind") ?? "");

  if (!(file instanceof File) || !["id_doc", "selfie"].includes(kind)) {
    return NextResponse.json({ error: "file and kind required" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  // Selfies must come from the in-page camera: a valid capture session (with its on-screen challenge) is required,
  // and the file is stored under a live-selfie name that KYC submission checks for.
  const challenge = kind === "selfie" ? verifySelfieSession(form.get("session"), guard.userId) : null;
  await validateUpload(file, kind === "selfie" ? ["image/jpeg"] : ["image/jpeg", "image/png", "application/pdf"], 10 * 1024 * 1024);
  const ext = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : "jpg";
  const path = challenge ? `kyc/${guard.userId}/${LIVE_SELFIE_PREFIX}${challenge}-${randomUUID()}.jpg` : `kyc/${guard.userId}/${kind}-${randomUUID()}.${ext}`;

  const sb = supabaseAdmin();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error } = await sb.storage.from("kyc").upload(path, bytes, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
  }

  return NextResponse.json({ ok: true, path }, { headers: NO_STORE_HEADERS });
}

export const POST = withApi({ auth: "user", maxBytes: 52 * 1024 * 1024, rateLimit: 10 }, handlePOST);

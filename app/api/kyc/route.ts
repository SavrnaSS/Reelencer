import { databaseError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/route";
import { ownedStoragePath } from "@/lib/api/uploads";
import { LIVE_SELFIE_PREFIX, isLiveSelfiePath } from "@/lib/kycSelfie";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServerFetch } from "@/lib/supabase/serverFetch";

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

async function handleGET(req: Request) {
  const guard = await getUserIdFromBearer(req);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status, headers: NO_STORE_HEADERS });
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb.from("worker_kyc").select("*").eq("user_id", guard.userId).maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
  }

  if (!data) {
    return NextResponse.json({ status: "none" }, { headers: NO_STORE_HEADERS });
  }

  let workerId: string | null = null;
  if (data.status === "approved") {
    const { data: worker } = await sb.from("workers").select("id").eq("user_id", guard.userId).maybeSingle();
    workerId = worker?.id ?? data.worker_id ?? null;
  }

  return NextResponse.json(
    {
      id: data.id,
      status: data.status,
      submittedAt: data.submitted_at,
      reviewedAt: data.reviewed_at,
      rejectionReason: data.rejection_reason ?? undefined,
      workerId,
      profile: {
        legalName: data.legal_name,
        dob: data.dob,
        phone: data.phone,
        address: data.address,
        idType: data.id_type,
        idNumber: data.id_number,
        idDocPath: data.id_doc_path,
        selfiePath: data.selfie_path,
      },
    },
    { headers: NO_STORE_HEADERS }
  );
}

async function handlePOST(req: Request) {
  const guard = await getUserIdFromBearer(req);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status, headers: NO_STORE_HEADERS });
  }

  const body = await req.json().catch(() => ({}));
  const legalName = String(body?.legalName ?? "").trim();
  const dob = String(body?.dob ?? "").trim();
  const phone = String(body?.phone ?? "").trim();
  const address = String(body?.address ?? "").trim();
  const idType = String(body?.idType ?? "").trim();
  const idNumber = String(body?.idNumber ?? "").trim();
  const idDocPath = String(body?.idDocPath ?? "").trim();
  const selfiePath = String(body?.selfiePath ?? "").trim();
  if (!ownedStoragePath(idDocPath, `kyc/${guard.userId}/id_doc-`) || !ownedStoragePath(selfiePath, `kyc/${guard.userId}/selfie-`)) {
    return NextResponse.json({ error: "Upload your own identity document and selfie." }, { status: 400 });
  }
  // New submissions need a selfie taken with the live in-page camera (see lib/kycSelfie).
  if (!ownedStoragePath(selfiePath, `kyc/${guard.userId}/${LIVE_SELFIE_PREFIX}`) || !isLiveSelfiePath(selfiePath)) {
    return NextResponse.json({ error: "Take your selfie with the live camera in the verification form.", code: "live_selfie_required" }, { status: 400, headers: NO_STORE_HEADERS });
  }
  if (legalName.length > 160 || address.length > 2000 || phone.length > 30 || idType.length > 80 || idNumber.length > 100 || !/^\d{4}-\d{2}-\d{2}$/.test(dob) || !Number.isFinite(Date.parse(dob)) || Date.parse(dob) >= Date.now()) {
    return NextResponse.json({ error: "Invalid identity details." }, { status: 400 });
  }

  if (!legalName || !dob || !phone || !address || !idType || !idNumber || !idDocPath || !selfiePath) {
    return NextResponse.json(
      { error: "All fields and documents are required" },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("submit_worker_kyc", {
    p_worker: guard.userId,
    p_details: { legal_name: legalName, dob, phone, address, id_type: idType, id_number: idNumber, id_doc_path: idDocPath, selfie_path: selfiePath },
  });
  databaseError(error);

  return NextResponse.json(
    { ok: true, status: data.status, submittedAt: data.submitted_at },
    { headers: NO_STORE_HEADERS }
  );
}

export const GET = withApi({ auth: "user" }, handleGET);

export const POST = withApi({ auth: "user" }, handlePOST);

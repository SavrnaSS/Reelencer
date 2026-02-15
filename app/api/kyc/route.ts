import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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

export async function GET(req: Request) {
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
      },
    },
    { headers: NO_STORE_HEADERS }
  );
}

export async function POST(req: Request) {
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

  if (!legalName || !dob || !phone || !address || !idType || !idNumber || !idDocPath || !selfiePath) {
    return NextResponse.json(
      { error: "All fields and documents are required" },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const sb = supabaseAdmin();
  const now = new Date().toISOString();
  const { data, error } = await sb
    .from("worker_kyc")
    .upsert(
      {
        user_id: guard.userId,
        status: "pending",
        legal_name: legalName,
        dob,
        phone,
        address,
        id_type: idType,
        id_number: idNumber,
        id_doc_path: idDocPath,
        selfie_path: selfiePath,
        submitted_at: now,
        reviewed_at: null,
        rejection_reason: null,
        admin_note: null,
      },
      { onConflict: "user_id" }
    )
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
  }

  await sb.from("worker_kyc_events").insert({
    kyc_id: data.id,
    status: "pending",
    note: "Submitted",
    actor_id: guard.userId,
    created_at: now,
  });

  return NextResponse.json(
    { ok: true, status: data.status, submittedAt: data.submitted_at },
    { headers: NO_STORE_HEADERS }
  );
}

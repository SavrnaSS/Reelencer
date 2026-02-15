import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const gigId = url.searchParams.get("gigId") ?? undefined;
  const workerId = url.searchParams.get("workerId") ?? undefined;
  const sb = supabaseAdmin();
  let query = sb.from("gig_applications").select("*").order("applied_at", { ascending: false });
  if (gigId) query = query.eq("gig_id", gigId);
  if (workerId) query = query.eq("worker_code", workerId);
  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
  }
  const payload = (data ?? []).map((a: any) => ({
    id: String(a.id),
    gigId: String(a.gig_id),
    workerId: String(a.worker_code),
    workerName: a.worker_name ?? undefined,
    status: a.status,
    appliedAt: a.applied_at,
    decidedAt: a.decided_at ?? undefined,
  }));
  return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body?.gigId || !body?.workerId) {
      return NextResponse.json({ error: "gigId and workerId required" }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("gig_applications")
      .upsert(
        {
          id: body.id,
          gig_id: body.gigId,
          worker_code: body.workerId,
          worker_name: body.workerName ?? null,
          status: body.status ?? "Applied",
          applied_at: new Date().toISOString(),
        },
        { onConflict: "gig_id,worker_code" }
      )
      .select("*")
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
    }
    return NextResponse.json(
      {
        id: String(data.id),
        gigId: String(data.gig_id),
        workerId: String(data.worker_code),
        workerName: data.worker_name ?? undefined,
        status: data.status,
        appliedAt: data.applied_at,
        decidedAt: data.decided_at ?? undefined,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Invalid payload" }, { status: 400, headers: NO_STORE_HEADERS });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    if (!body?.id) {
      return NextResponse.json({ error: "id required" }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const updates = body.updates ?? {};
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("gig_applications")
      .update({
        status: updates.status,
        decided_at: updates.decidedAt ?? new Date().toISOString(),
        worker_name: updates.workerName,
      })
      .eq("id", String(body.id))
      .select("*")
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
    }
    if (!data) {
      return NextResponse.json({ error: "Application not found" }, { status: 404, headers: NO_STORE_HEADERS });
    }
    return NextResponse.json(
      {
        id: String(data.id),
        gigId: String(data.gig_id),
        workerId: String(data.worker_code),
        workerName: data.worker_name ?? undefined,
        status: data.status,
        appliedAt: data.applied_at,
        decidedAt: data.decided_at ?? undefined,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Invalid payload" }, { status: 400, headers: NO_STORE_HEADERS });
  }
}

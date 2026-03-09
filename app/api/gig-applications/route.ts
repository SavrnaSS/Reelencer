import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { randomUUID } from "crypto";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

const PROPOSAL_PREFIX = "__REELENCER_PROPOSAL__:";

type ProposalPayload = {
  pitch?: string;
  approach?: string;
  timeline?: string;
  budget?: string;
  portfolio?: string;
  submittedAt?: string;
  reviewStatus?: "Pending" | "Accepted" | "Rejected";
  adminNote?: string;
  adminExplanation?: string;
  whatsappLink?: string;
  onboardingSteps?: string;
  groupJoinedConfirmed?: boolean;
  groupJoinedConfirmedAt?: string;
  reviewedAt?: string;
};

function encodeWorkerName(workerName?: string | null, proposal?: ProposalPayload | null) {
  const cleanName = String(workerName ?? "").trim();
  if (!proposal) return cleanName || null;
  const compact = JSON.stringify({
    workerName: cleanName || null,
    proposal,
  });
  return `${PROPOSAL_PREFIX}${encodeURIComponent(compact)}`;
}

function decodeWorkerName(raw: unknown): { workerName?: string; proposal?: ProposalPayload } {
  const value = String(raw ?? "");
  if (!value.startsWith(PROPOSAL_PREFIX)) {
    return value ? { workerName: value } : {};
  }
  try {
    const encoded = value.slice(PROPOSAL_PREFIX.length);
    // Primary format: URI encoded JSON. Backward-compatible fallback: base64 JSON.
    let parsedRaw = "";
    try {
      parsedRaw = decodeURIComponent(encoded);
    } catch {
      // fallback for previously stored base64 payloads
      parsedRaw = Buffer.from(encoded, "base64").toString("utf8");
    }
    const parsed = JSON.parse(parsedRaw) as {
      workerName?: string | null;
      proposal?: ProposalPayload;
    };
    return {
      workerName: parsed?.workerName ?? undefined,
      proposal: parsed?.proposal ?? undefined,
    };
  } catch {
    return {};
  }
}

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
    ...(decodeWorkerName(a.worker_name)),
    id: String(a.id),
    gigId: String(a.gig_id),
    workerId: String(a.worker_code),
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
    const { data: existingRow } = await sb
      .from("gig_applications")
      .select("id")
      .eq("gig_id", body.gigId)
      .eq("worker_code", body.workerId)
      .maybeSingle();
    const resolvedId = body.id || existingRow?.id || randomUUID();
    const workerNameEncoded = encodeWorkerName(body.workerName, body.proposal ?? null);
    const { data, error } = await sb
      .from("gig_applications")
      .upsert(
        {
          id: resolvedId,
          gig_id: body.gigId,
          worker_code: body.workerId,
          worker_name: workerNameEncoded,
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
        ...(decodeWorkerName(data.worker_name)),
        id: String(data.id),
        gigId: String(data.gig_id),
        workerId: String(data.worker_code),
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
    const shouldEncodeWorkerName = Object.prototype.hasOwnProperty.call(updates, "workerName") || Object.prototype.hasOwnProperty.call(updates, "proposal");
    const encodedWorkerName = shouldEncodeWorkerName ? encodeWorkerName(updates.workerName, updates.proposal ?? null) : undefined;
    const { data, error } = await sb
      .from("gig_applications")
      .update({
        status: updates.status,
        decided_at: updates.decidedAt ?? new Date().toISOString(),
        worker_name: encodedWorkerName,
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
        ...(decodeWorkerName(data.worker_name)),
        id: String(data.id),
        gigId: String(data.gig_id),
        workerId: String(data.worker_code),
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

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

export async function GET() {
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("gigs").select("*").order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
  }
  const payload = (data ?? []).map((g: any) => ({
    id: String(g.id),
    title: g.title,
    company: g.company,
    verified: Boolean(g.verified),
    platform: g.platform,
    location: g.location,
    workload: g.workload,
    payout: g.payout,
    payoutType: g.payout_type,
    gigType: g.gig_type ?? "Email Creator",
    requirements: Array.isArray(g.requirements) ? g.requirements : [],
    status: g.status,
    postedAt: g.posted_at ? new Date(g.posted_at).toLocaleDateString() : "Posted",
  }));
  return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body?.title || !body?.company || !body?.workload || !body?.payout) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("gigs")
      .insert({
        id: body.id,
        title: body.title,
        company: body.company,
        verified: body.verified ?? true,
        platform: body.platform,
        location: body.location,
        workload: body.workload,
        payout: body.payout,
        payout_type: body.payoutType,
        gig_type: body.gigType ?? "Email Creator",
        requirements: Array.isArray(body.requirements) ? body.requirements : [],
        status: body.status ?? "Open",
        posted_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
    }
    return NextResponse.json(
      {
        id: String(data.id),
        title: data.title,
        company: data.company,
        verified: Boolean(data.verified),
        platform: data.platform,
        location: data.location,
        workload: data.workload,
        payout: data.payout,
        payoutType: data.payout_type,
        gigType: data.gig_type ?? "Email Creator",
        requirements: Array.isArray(data.requirements) ? data.requirements : [],
        status: data.status,
        postedAt: data.posted_at ? new Date(data.posted_at).toLocaleDateString() : "Posted",
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
      .from("gigs")
      .update({
        title: updates.title,
        company: updates.company,
        verified: updates.verified,
        platform: updates.platform,
        location: updates.location,
        workload: updates.workload,
        payout: updates.payout,
        payout_type: updates.payoutType,
        gig_type: updates.gigType,
        requirements: Array.isArray(updates.requirements) ? updates.requirements : undefined,
        status: updates.status,
      })
      .eq("id", String(body.id))
      .select("*")
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
    }
    if (!data) {
      return NextResponse.json({ error: "Gig not found" }, { status: 404, headers: NO_STORE_HEADERS });
    }
    return NextResponse.json(
      {
        id: String(data.id),
        title: data.title,
        company: data.company,
        verified: Boolean(data.verified),
        platform: data.platform,
        location: data.location,
        workload: data.workload,
        payout: data.payout,
        payoutType: data.payout_type,
        gigType: data.gig_type ?? "Email Creator",
        requirements: Array.isArray(data.requirements) ? data.requirements : [],
        status: data.status,
        postedAt: data.posted_at ? new Date(data.posted_at).toLocaleDateString() : "Posted",
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Invalid payload" }, { status: 400, headers: NO_STORE_HEADERS });
  }
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const sb = supabaseAdmin();
  const { error } = await sb.from("gigs").delete().eq("id", String(id));
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
  }
  return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
}

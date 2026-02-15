import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

async function getUserId(req: Request) {
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length);
  const { data, error } = await supabaseAdmin().auth.getUser(token);
  if (error || !data?.user?.id) return null;
  return data.user.id;
}

export async function GET(req: Request) {
  const supabase = supabaseAdmin();
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await supabase
    .from("upi_configs")
    .select("*")
    .eq("worker_id", userId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    upiId: data?.upi_id ?? "",
    verified: data?.verified ?? false,
    verifiedAt: data?.verified_at ?? undefined,
    payoutSchedule: data?.payout_schedule ?? "Weekly",
    payoutDay: data?.payout_day ?? "Fri",
  });
}

export async function PUT(req: Request) {
  const supabase = supabaseAdmin();
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();

  const payload = {
    worker_id: userId,
    upi_id: String(body.upiId ?? ""),
    verified: Boolean(body.verified ?? false),
    verified_at: body.verifiedAt ? String(body.verifiedAt) : null,
    payout_schedule: String(body.payoutSchedule ?? "Weekly"),
    payout_day: String(body.payoutDay ?? "Fri"),
  };

  const { data: updated, error: updateErr } = await supabase
    .from("upi_configs")
    .update({
      upi_id: payload.upi_id,
      verified: payload.verified,
      verified_at: payload.verified_at,
      payout_schedule: payload.payout_schedule,
      payout_day: payload.payout_day,
    })
    .eq("worker_id", userId)
    .select("worker_id");

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  if (!updated || updated.length === 0) {
    const { error: insertErr } = await supabase.from("upi_configs").insert(payload);
    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({
    upiId: payload.upi_id,
    verified: payload.verified,
    verifiedAt: payload.verified_at ?? undefined,
    payoutSchedule: payload.payout_schedule,
    payoutDay: payload.payout_day,
  });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/route";
import { authenticate } from "@/lib/api/auth";
import { ApiError, databaseError } from "@/lib/api/errors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function response(row: Record<string, unknown> | null) {
  return { upiId: row?.upi_id ?? "", verified: row?.verified ?? false, verifiedAt: row?.verified_at ?? undefined, updatedAt: row?.updated_at ?? undefined, payoutSchedule: row?.payout_schedule ?? "Weekly", payoutDay: row?.payout_day ?? "Fri" };
}
export const GET = withApi({ auth: "user" }, async req => {
  const actor = await authenticate(req);
  const { data, error } = await supabaseAdmin().from("upi_configs").select("*").eq("worker_id", actor.user.id).maybeSingle();
  databaseError(error);
  return NextResponse.json(response(data));
});
const upiSchema = z.object({ upiId: z.string().trim().min(5).max(100).regex(/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$/), payoutSchedule: z.enum(["Weekly", "Monthly"]).default("Weekly"), payoutDay: z.string().max(10).default("Fri") });
export const PUT = withApi({ auth: "user" }, async req => {
  const actor = await authenticate(req);
  const parsed = upiSchema.safeParse(await req.json());
  if (!parsed.success) throw new ApiError(400, "Invalid UPI configuration.");
  const { payoutSchedule, payoutDay } = parsed.data;
  if (payoutSchedule === "Weekly" ? !["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].includes(payoutDay) : !/^(?:[1-9]|1\d|2[0-8])$/.test(payoutDay)) throw new ApiError(400, "Choose a valid payout day (monthly: 1–28).");
  const sb = supabaseAdmin();
  const { error } = await sb.rpc("save_upi_config", { p_worker: actor.user.id, p_upi: parsed.data.upiId, p_schedule: payoutSchedule, p_day: payoutDay });
  databaseError(error);
  // "Saved 5m ago" on the creator's card; the save function itself doesn't touch updated_at.
  const { data, error: stampError } = await sb.from("upi_configs").update({ updated_at: new Date().toISOString() }).eq("worker_id", actor.user.id).select("*").maybeSingle();
  databaseError(stampError);
  return NextResponse.json(response(data));
});

import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/api/auth";
import { ApiError, databaseError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/route";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Custom creator payout plans. Reads and writes go through audited database functions; frozen earnings intervals
// and wallet credits are never changed here: a plan only applies to reels that haven't started earning.

const money = z.string().trim().regex(/^\d+(\.\d{1,2})?$/);
const plan = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).default(""),
  baseINR: money,
  thresholdViews: z.string().trim().regex(/^\d{1,10}$/),
  rateINR: z.union([money, z.literal("")]).default(""),
  mode: z.enum(["beyond", "all"]),
  gigId: z.string().trim().max(100).default(""),
  active: z.boolean().default(true),
});
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), plan }),
  z.object({
    action: z.literal("assign"),
    planId: z.string().uuid(),
    workerIds: z.array(z.string().uuid()).min(1).max(1000),
    appliesFrom: z.iso.datetime({ offset: true }),
  }),
  z.object({ action: z.literal("remove"), workerIds: z.array(z.string().uuid()).min(1).max(1000) }),
]);

function schemaMissing(error: { code?: string } | null) {
  if (["PGRST202", "42883", "PGRST205", "42P01"].includes(error?.code ?? "")) {
    throw new ApiError(503, "Payout plans need the latest database update (202611030001_creator_payout_plans.sql).", "schema_outdated");
  }
}

export const GET = withApi({ auth: "admin" }, async () => {
  const { data, error } = await supabaseAdmin().rpc("admin_payout_plans");
  schemaMissing(error);
  databaseError(error);
  return NextResponse.json({ ok: true, ...(data ?? { plans: [], members: [], gigs: [] }) });
});

export const POST = withApi({ auth: "admin", rateLimit: 30, maxBytes: 128 * 1024 }, async req => {
  const actor = await authenticate(req);
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "Check the plan details and try again.", "invalid_input");
  const sb = supabaseAdmin();
  const input = parsed.data;
  if (input.action === "save") {
    const { data, error } = await sb.rpc("admin_save_payout_plan", { p_actor: actor.user.id, p_input: input.plan });
    schemaMissing(error);
    databaseError(error);
    return NextResponse.json({ ok: true, plan: data });
  }
  const workers = [...new Set(input.workerIds)];
  const { data, error } = await sb.rpc("admin_assign_payout_plan", {
    p_actor: actor.user.id,
    p_plan: input.action === "assign" ? input.planId : null,
    p_workers: workers,
    p_applies_from: input.action === "assign" ? new Date(input.appliesFrom).toISOString() : null,
  });
  schemaMissing(error);
  databaseError(error);
  return NextResponse.json({ ok: true, result: data });
});

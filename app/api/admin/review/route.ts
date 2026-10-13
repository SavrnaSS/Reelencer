import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/route";
import { authenticate } from "@/lib/api/auth";
import { ApiError, databaseError } from "@/lib/api/errors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const reviewSchema = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), status: z.enum(["Rejected", "Needs fix", "Approved", "Hard rejected"]), review: z.record(z.string(), z.unknown()).nullable().optional() });
export const POST = withApi({ auth: "admin" }, async req => {
  const body = await req.json();
  const parsed = reviewSchema.safeParse({
    id: body.id ?? body.workItemId,
    status: body.status ?? body.decision,
    review: body.review ?? (typeof body.reason === "string" ? { rejectReason: body.reason.slice(0, 2000) } : {}),
  });
  if (!parsed.success) throw new ApiError(400, "Invalid review.");
  const actor = await authenticate(req);
  const { error } = await supabaseAdmin().rpc("transition_work_item", {
    p_actor: actor.user.id, p_item: parsed.data.id, p_action: "review",
    p_payload: { status: parsed.data.status === "Rejected" ? "Needs fix" : parsed.data.status, review: parsed.data.review ?? {} },
  });
  databaseError(error);
  return NextResponse.json({ ok: true });
});

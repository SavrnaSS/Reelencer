import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/route";
import { authenticate } from "@/lib/api/auth";
import { databaseError } from "@/lib/api/errors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const POST = withApi({ auth: "user", rateLimit: 6 }, async req => {
  const actor = await authenticate(req);
  const { data, error } = await supabaseAdmin().rpc("request_payout", { p_worker: actor.user.id });
  databaseError(error);
  return NextResponse.json({ ok: true, ...data });
});

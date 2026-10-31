import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/route";
import { databaseError } from "@/lib/api/errors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Hourly: opens this month's automatic withdrawal for every creator whose auto-withdrawal day has arrived.
export const POST = withApi({ auth: "service" }, async () => {
  const { data, error } = await supabaseAdmin().rpc("auto_request_payouts", { p_limit: 200 });
  databaseError(error);
  return NextResponse.json(data);
});

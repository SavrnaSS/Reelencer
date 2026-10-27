import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/route";
import { ApiError, databaseError } from "@/lib/api/errors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ACTIVITY_PERIODS, adminActivityResponse, type ActivityPeriod } from "@/lib/adminOverview";

export const GET = withApi({ auth: "admin" }, async req => {
  const raw = new URL(req.url).searchParams.get("days") ?? "30";
  if (!ACTIVITY_PERIODS.some(days => String(days) === raw)) throw new ApiError(400, "Choose a 7, 30 or 90 day period.", "invalid_period");
  const days = Number(raw) as ActivityPeriod;
  const result = await supabaseAdmin().rpc("admin_activity_overview", { p_days: days });
  databaseError(result.error);
  const data = adminActivityResponse(result.data);
  if (!data || data.period.days !== days) throw new ApiError(503, "User activity could not be loaded. Please try again.", "activity_unavailable");
  return NextResponse.json(data);
});

import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/route";
import { ApiError, databaseError } from "@/lib/api/errors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminOverviewCounts } from "@/lib/adminOverview";

/** Exact counts avoid loading account details or truncating totals at the database row limit. */
export const GET = withApi({ auth: "admin" }, async () => {
  const sb = supabaseAdmin();
  const [accounts, claims, withdrawals] = await Promise.all([
    sb.from("linked_social_accounts").select("id", { count: "exact", head: true }).in("status", ["active", "paused"]),
    sb.from("view_payout_claims").select("id", { count: "exact", head: true }).eq("status", "Pending"),
    sb.from("payout_batches").select("id", { count: "exact", head: true }).in("status", ["Draft", "Processing"]),
  ]);
  for (const result of [accounts, claims, withdrawals]) databaseError(result.error);
  const totals = {
    linkedAccounts: accounts.count,
    pendingClaims: claims.count,
    pendingWithdrawals: withdrawals.count,
    pendingPayouts: Number(claims.count) + Number(withdrawals.count),
  };
  if (!isAdminOverviewCounts(totals)) throw new ApiError(503, "Overview totals could not be loaded. Please try again.", "overview_unavailable");
  return NextResponse.json(totals);
});

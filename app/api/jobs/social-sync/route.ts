import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/route";
import { syncAllAccounts } from "@/lib/api/socialAccounts";

// Called by the external scheduler (same CRON_SECRET bearer as the other /api/jobs routes), e.g. every few hours.
// Refreshes every active linked account not synced in six hours; safe to overlap or retry.
export const POST = withApi({ auth: "service" }, async () => NextResponse.json(await syncAllAccounts()));

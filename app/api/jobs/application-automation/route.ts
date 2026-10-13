import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/route";
import { runScheduledAutomation } from "@/lib/api/applicationAutomation";

// Called by the external scheduler (same CRON_SECRET bearer as /api/jobs/schedule).
// Safe to retry or overlap: each application is claimed once per rule in the ledger before it is touched.
export const POST = withApi({ auth: "service" }, async () => NextResponse.json(await runScheduledAutomation()));

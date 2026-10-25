import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/route";
import { syncAllAccounts } from "@/lib/api/socialAccounts";

// Run every minute. Durable claims select due accounts across the entire database, independently of visits.
export const runtime = "nodejs";
export const maxDuration = 60;
export const POST = withApi({ auth: "service" }, async () => NextResponse.json(await syncAllAccounts()));

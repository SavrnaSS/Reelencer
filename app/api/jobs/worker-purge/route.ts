import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/route";
import { purgeDeletedWorkers } from "@/lib/api/workerPurge";

export const runtime = "nodejs";
export const maxDuration = 60;
export const POST = withApi({ auth: "service" }, async () => NextResponse.json(await purgeDeletedWorkers()));

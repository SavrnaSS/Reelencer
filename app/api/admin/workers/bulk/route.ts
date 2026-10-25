import { NextResponse } from "next/server";
import { authenticate } from "@/lib/api/auth";
import { optionalTrustedClientIp } from "@/lib/api/clientIp";
import { withApi } from "@/lib/api/route";
import { applyWorkerBulk, getWorkerBulkResult } from "@/lib/api/workerBulkModeration";

export const POST = withApi({ auth: "admin", rateLimit: 8, maxBytes: 384 * 1024 }, async req => {
  const actor = await authenticate(req);
  return NextResponse.json({ ok: true, result: await applyWorkerBulk(actor.user.id, await req.json(), optionalTrustedClientIp(req)) });
});

export const GET = withApi({ auth: "admin" }, async req => {
  const actor = await authenticate(req);
  const operationId = new URL(req.url).searchParams.get("operationId") ?? "";
  return NextResponse.json({ ok: true, result: await getWorkerBulkResult(actor.user.id, operationId) });
});

import { NextResponse } from "next/server";
import { authenticate } from "@/lib/api/auth";
import { optionalTrustedClientIp } from "@/lib/api/clientIp";
import { withApi } from "@/lib/api/route";
import { previewWorkerBulk } from "@/lib/api/workerBulkModeration";

export const POST = withApi({ auth: "admin", rateLimit: 20, maxBytes: 16 * 1024 }, async req => {
  const actor = await authenticate(req);
  return NextResponse.json({ ok: true, preview: await previewWorkerBulk(actor.user.id, await req.json(), optionalTrustedClientIp(req)) });
});

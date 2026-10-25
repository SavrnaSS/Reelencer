import { NextResponse } from "next/server";
import { authenticate } from "@/lib/api/auth";
import { optionalTrustedClientIp, publicClientIp, trustedIpHeader } from "@/lib/api/clientIp";
import { withApi } from "@/lib/api/route";
import { getWorkerModeration, moderateWorker } from "@/lib/api/workerModeration";
import { ApiError } from "@/lib/api/errors";

function connectionOptions(moderation: Awaited<ReturnType<typeof getWorkerModeration>>, actorIp: string | null) {
  let ipTrackingEnabled = false;
  try { ipTrackingEnabled = !!trustedIpHeader(); }
  catch (error) {
    if (!(error instanceof ApiError) || error.code !== "ip_configuration") throw error;
  }
  return {
    ...moderation,
    ipTrackingEnabled,
    canBlockIps: !!actorIp,
    knownIps: moderation.knownIps.map(row => ({ ...row, eligible: !!publicClientIp(row.ip) && row.ip !== actorIp })),
  };
}

export const GET = withApi({ auth: "admin" }, async (req, context) => {
  const { id } = await context.params;
  const actorIp = optionalTrustedClientIp(req);
  return NextResponse.json({ ok: true, moderation: connectionOptions(await getWorkerModeration(id), actorIp) });
});

export const POST = withApi({ auth: "admin", rateLimit: 12, maxBytes: 8 * 1024 }, async (req, context) => {
  const { id } = await context.params;
  const actor = await authenticate(req);
  const actorIp = optionalTrustedClientIp(req);
  const moderation = await moderateWorker({
    actorId: actor.user.id, workerId: id, input: await req.json(), actorIp,
  });
  return NextResponse.json({ ok: true, moderation: connectionOptions(moderation, actorIp) });
});

import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { NO_STORE_HEADERS } from "@/lib/api/gigApplications";
import { withApi } from "@/lib/api/route";
import { listAllRequests, recheckAccountRequest, revealRequestPassword, reviewAccountRequest } from "@/lib/api/accountRequests";

// Admin verification queue for additional account requests.

export const GET = withApi({ auth: "admin" }, async () => NextResponse.json(await listAllRequests(), { headers: NO_STORE_HEADERS }));

const actions = z.discriminatedUnion("action", [
  z.object({ action: z.literal("review"), id: z.uuid(), decision: z.enum(["approve", "changes", "reject"]), note: z.string().max(500).optional() }),
  z.object({ action: z.literal("recheck"), id: z.uuid() }),
  z.object({ action: z.literal("reveal"), id: z.uuid() }),
]);

export const POST = withApi({ auth: "admin", rateLimit: 120 }, async (req) => {
  const actor = await authenticate(req);
  const parsed = actions.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid request.", "invalid_input");
  const body = parsed.data;
  if (body.action === "reveal") return NextResponse.json({ password: await revealRequestPassword(actor.user.id, body.id) }, { headers: NO_STORE_HEADERS });
  if (body.action === "recheck") return NextResponse.json(await recheckAccountRequest({ aliases: [], isAdmin: true }, body.id), { headers: NO_STORE_HEADERS });
  return NextResponse.json(await reviewAccountRequest(actor.user.id, body.id, body.decision, body.note), { headers: NO_STORE_HEADERS });
});

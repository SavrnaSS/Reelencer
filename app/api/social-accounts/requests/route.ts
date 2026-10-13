import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { NO_STORE_HEADERS } from "@/lib/api/gigApplications";
import { withApi } from "@/lib/api/route";
import { listCreatorRequests, recheckAccountRequest, resubmitAccountRequest, submitAccountRequest, withdrawAccountRequest } from "@/lib/api/accountRequests";

// Creators: request additional accounts on gigs they're linked on, track the team's verification, fix and resubmit.

export const GET = withApi({ auth: "user" }, async (req) => {
  const actor = await authenticate(req);
  return NextResponse.json(await listCreatorRequests(actor.aliases), { headers: NO_STORE_HEADERS });
});

const details = {
  handle: z.string().max(200),
  profileUrl: z.string().max(400),
  email: z.string().max(300),
  password: z.string().max(300).default(""),
  phone: z.string().max(40).optional(),
  notes: z.string().max(700).optional(),
};
const actions = z.discriminatedUnion("action", [
  z.object({ action: z.literal("submit"), sourceAccountId: z.uuid(), ...details }),
  z.object({ action: z.literal("resubmit"), id: z.uuid(), ...details }),
  z.object({ action: z.literal("withdraw"), id: z.uuid() }),
  z.object({ action: z.literal("recheck"), id: z.uuid() }),
]);

export const POST = withApi({ auth: "user", rateLimit: 20 }, async (req) => {
  const actor = await authenticate(req);
  const parsed = actions.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "Check the account details and try again.", "invalid_input");
  const body = parsed.data;
  switch (body.action) {
    case "submit": {
      const { action: _action, ...input } = body;
      void _action;
      return NextResponse.json(await submitAccountRequest(actor, input), { headers: NO_STORE_HEADERS });
    }
    case "resubmit": {
      const { action: _action, id, ...input } = body;
      void _action;
      return NextResponse.json(await resubmitAccountRequest(actor, id, input), { headers: NO_STORE_HEADERS });
    }
    case "withdraw":
      await withdrawAccountRequest(actor, body.id);
      return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
    case "recheck":
      return NextResponse.json(await recheckAccountRequest(actor, body.id), { headers: NO_STORE_HEADERS });
  }
});

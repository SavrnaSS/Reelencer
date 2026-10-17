import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { checkAccountOwnership, getAccountVerifyCode, requestAccountChanges, revealAccountPassword, submitAccountSetup } from "@/lib/api/accountSetup";
import { NO_STORE_HEADERS } from "@/lib/api/gigApplications";
import { withApi } from "@/lib/api/route";
import { ACCOUNT_LIMITS } from "@/lib/accountSetup";

// Content Posting account setup, verified by a code in the account's bio (no password).
// Creators: GET ?applicationId= for their code, POST the new account, POST {action:"check"} to re-read the bio.
// Admins: POST {action:"check"} without a cooldown, POST {action:"reveal"} for a legacy password (POST so it never
// lands in URLs or logs), PATCH to request changes.

const submission = z.object({
  action: z.literal("submit").optional(),
  applicationId: z.uuid(),
  handle: z.string().max(200),
  profileUrl: z.string().max(ACCOUNT_LIMITS.url),
  notes: z.string().max(ACCOUNT_LIMITS.notes).optional(),
});
const byId = z.object({ action: z.enum(["reveal", "check"]), applicationId: z.uuid() });
const changes = z.object({ applicationId: z.uuid(), action: z.literal("request_changes"), note: z.string().max(1000) });

export const GET = withApi({ auth: "user" }, async (req) => {
  const actor = await authenticate(req);
  const parsed = z.uuid().safeParse(req.nextUrl.searchParams.get("applicationId"));
  if (!parsed.success) throw new ApiError(400, "applicationId is required.", "invalid_input");
  return NextResponse.json(await getAccountVerifyCode({ aliases: actor.aliases }, parsed.data), { headers: NO_STORE_HEADERS });
});

export const POST = withApi({ auth: "user", rateLimit: 20 }, async (req) => {
  const actor = await authenticate(req);
  const body = await req.json().catch(() => null);
  if (body?.action === "reveal" || body?.action === "check") {
    const parsed = byId.safeParse(body);
    if (!parsed.success) throw new ApiError(400, "applicationId is required.", "invalid_input");
    if (parsed.data.action === "check") {
      const result = await checkAccountOwnership({ userId: actor.user.id, aliases: actor.aliases, isAdmin: actor.isAdmin }, parsed.data.applicationId);
      return NextResponse.json(result, { headers: NO_STORE_HEADERS });
    }
    if (!actor.isAdmin) throw new ApiError(403, "Access denied.");
    const password = await revealAccountPassword({ userId: actor.user.id }, parsed.data.applicationId);
    return NextResponse.json({ password }, { headers: NO_STORE_HEADERS });
  }
  const parsed = submission.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "Fill in the username and profile link.", "invalid_input");
  const { applicationId, ...input } = parsed.data;
  const result = await submitAccountSetup({ userId: actor.user.id, aliases: actor.aliases }, applicationId, input);
  return NextResponse.json(result, { headers: NO_STORE_HEADERS });
});

export const PATCH = withApi({ auth: "admin" }, async (req) => {
  const actor = await authenticate(req);
  const parsed = changes.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "Add a note for the creator.", "invalid_input");
  const result = await requestAccountChanges({ userId: actor.user.id }, parsed.data.applicationId, parsed.data.note);
  return NextResponse.json(result, { headers: NO_STORE_HEADERS });
});

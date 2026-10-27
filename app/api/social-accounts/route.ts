import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { NO_STORE_HEADERS } from "@/lib/api/gigApplications";
import { withApi } from "@/lib/api/route";
import { resolveSyncConfig } from "@/lib/api/integrations";
import { accountsSummary, listAllAccounts, listCreatorAccounts, recoveredAccountView, submitCreatorReel, syncAccountNow, withdrawCreatorReel } from "@/lib/api/socialAccounts";
import { recoverAccountProfile } from "@/lib/api/accountProfileRecovery";

// Linked social accounts with their insight history. Creators get their own; admins can ask for every account
// (`scope=all`) or just the counts behind the console badge (`scope=summary`).
export const GET = withApi({ auth: "user" }, async (req) => {
  const actor = await authenticate(req);
  const params = new URL(req.url).searchParams;
  const scope = params.get("scope");
  const sync = params.get("sync") === "1";
  if (scope === "summary") {
    if (!actor.isAdmin) throw new ApiError(403, "Access denied.");
    return NextResponse.json(await accountsSummary(), { headers: NO_STORE_HEADERS });
  }
  if (scope === "all" && actor.isAdmin) {
    return NextResponse.json({ accounts: await listAllAccounts(sync), statsEnabled: true, screenshotReader: !!(await resolveSyncConfig()).anthropicApiKey }, { headers: NO_STORE_HEADERS });
  }
  return NextResponse.json(await listCreatorAccounts(actor.aliases, sync), { headers: NO_STORE_HEADERS });
});

const creatorActions = z.discriminatedUnion("action", [
  z.object({ action: z.literal("recover_profile"), accountId: z.uuid(), handle: z.string().trim().min(1).max(120), profileUrl: z.string().trim().min(8).max(300) }),
  z.object({
    action: z.literal("submit_reel"),
    accountId: z.uuid(),
    url: z.string().trim().min(8).max(500),
    caption: z.string().max(300).optional(),
    postedAt: z.string().max(40).optional(),
  }),
  z.object({ action: z.literal("withdraw_reel"), id: z.uuid() }),
  z.object({ action: z.literal("sync"), accountId: z.uuid() }),
]);

// Creators report the reels they post on their linked account (the team reviews them before they count).
export const POST = withApi({ auth: "user", rateLimit: 30 }, async (req) => {
  const actor = await authenticate(req);
  const parsed = creatorActions.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "Paste the reel link to submit it.", "invalid_input");
  const body = parsed.data;
  if (body.action === "recover_profile") {
    const { row, ...result } = await recoverAccountProfile({ userId: actor.user.id, aliases: actor.aliases }, body);
    return NextResponse.json({ ...result, account: await recoveredAccountView(row) }, { headers: NO_STORE_HEADERS });
  }
  if (body.action === "sync") {
    const account = await syncAccountNow(body.accountId, { aliases: actor.aliases, isAdmin: actor.isAdmin });
    return NextResponse.json({ account }, { headers: NO_STORE_HEADERS });
  }
  if (body.action === "withdraw_reel") {
    await withdrawCreatorReel(actor.aliases, body.id);
    return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
  }
  return NextResponse.json(await submitCreatorReel(actor.aliases, body), { headers: NO_STORE_HEADERS });
});

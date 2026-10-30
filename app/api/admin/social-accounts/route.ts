import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { NO_STORE_HEADERS } from "@/lib/api/gigApplications";
import { withApi } from "@/lib/api/route";
import { deleteSnapshot, removePost, restorePost, recordSnapshot, recoveredAccountView, reviewPost, setAccountStatus, syncAccountNow, upsertPost } from "@/lib/api/socialAccounts";
import { reportMissingAccountProfile, restoreAccountProfile } from "@/lib/api/accountProfileRecovery";

// Admin writes for linked accounts: insight check-ins, per-reel results, pause/unlink.

const count = z.number().int().min(0).max(2_000_000_000).optional();
const actions = z.discriminatedUnion("action", [
  z.object({ action: z.literal("report_missing_profile"), accountId: z.uuid(), notFoundConfirmed: z.literal(true) }),
  z.object({ action: z.literal("restore_profile"), accountId: z.uuid(), ownershipConfirmed: z.literal(true), handle: z.string().min(1).max(120), submittedAt: z.string().min(1).max(40) }),
  z.object({
    action: z.literal("snapshot"),
    accountId: z.uuid(),
    capturedAt: z.string().max(40).optional(),
    periodDays: z.number().int().min(1).max(90).default(7),
    followers: count,
    following: count,
    posts: count,
    reach: count,
    impressions: count,
    profileViews: count,
    engagements: count,
    linkClicks: count,
    note: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal("post"),
    accountId: z.uuid(),
    url: z.string().trim().min(8).max(500).regex(/^https:\/\//i, "Use an https:// link."),
    caption: z.string().max(300).optional(),
    postedAt: z.string().max(40).optional(),
    views: count,
    reach: count,
    likes: count,
    comments: count,
    shares: count,
    saves: count,
    status: z.enum(["approved", "rejected"]).optional(),
  }),
  z.object({ action: z.literal("review_post"), id: z.uuid(), status: z.enum(["approved", "rejected"]), note: z.string().max(500).optional() }),
  z.object({ action: z.literal("delete_snapshot"), id: z.uuid() }),
  z.object({ action: z.literal("sync"), accountId: z.uuid() }),
  // "delete_post" is the older name for removing a reel; both keep a tombstone.
  z.object({ action: z.enum(["remove_post", "delete_post"]), id: z.uuid(), reason: z.string().max(300).optional(), silent: z.boolean().optional() }),
  z.object({ action: z.literal("restore_post"), id: z.uuid() }),
  z.object({ action: z.literal("status"), accountId: z.uuid(), status: z.enum(["active", "paused", "unlinked"]) }),
]);

export const POST = withApi({ auth: "admin", rateLimit: 120 }, async (req) => {
  const actor = await authenticate(req);
  const parsed = actions.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid request.", "invalid_input");
  const body = parsed.data;
  switch (body.action) {
    case "report_missing_profile":
      return NextResponse.json({ account: await recoveredAccountView(await reportMissingAccountProfile(actor.user.id, body.accountId, body.notFoundConfirmed), "admin") }, { headers: NO_STORE_HEADERS });
    case "restore_profile":
      return NextResponse.json({ account: await recoveredAccountView(await restoreAccountProfile(actor.user.id, body.accountId, body.ownershipConfirmed, body), "admin") }, { headers: NO_STORE_HEADERS });
    case "snapshot": {
      const { action: _action, ...input } = body;
      void _action;
      return NextResponse.json({ snapshot: await recordSnapshot(actor.user.id, input) }, { headers: NO_STORE_HEADERS });
    }
    case "post": {
      const { action: _action, ...input } = body;
      void _action;
      return NextResponse.json({ post: await upsertPost(actor.user.id, input) }, { headers: NO_STORE_HEADERS });
    }
    case "review_post":
      return NextResponse.json(await reviewPost(actor.user.id, body.id, body.status, body.note), { headers: NO_STORE_HEADERS });
    case "sync":
      return NextResponse.json({ account: await syncAccountNow(body.accountId, { aliases: [], isAdmin: true }, "admin") }, { headers: NO_STORE_HEADERS });
    case "delete_snapshot":
      await deleteSnapshot(body.id);
      return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
    case "remove_post":
    case "delete_post":
      return NextResponse.json(await removePost(actor.user.id, body.id, body.reason, body.silent), { headers: NO_STORE_HEADERS });
    case "restore_post":
      return NextResponse.json({ post: await restorePost(body.id) }, { headers: NO_STORE_HEADERS });
    case "status":
      await setAccountStatus(body.accountId, body.status);
      return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
  }
});

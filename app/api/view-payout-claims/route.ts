import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/api/auth";
import { ApiError, databaseError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/route";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { viewReviewEvidence, type ViewClaimItem, type ViewObservation } from "@/lib/viewPayoutReview";

export const GET = withApi({ auth: "user" }, async (req) => {
  const actor = await authenticate(req);
  const query = new URL(req.url).searchParams;
  const all = query.get("scope") === "all";
  if (all && !actor.isAdmin) throw new ApiError(403, "Access denied.");
  const accountId = query.get("accountId");
  if (accountId && !z.uuid().safeParse(accountId).success) throw new ApiError(400, "Invalid account ID.");
  const sb = supabaseAdmin();
  const reviewClaimId = query.get("reviewClaimId");
  if (reviewClaimId) {
    if (!actor.isAdmin) throw new ApiError(403, "Access denied.");
    if (!z.uuid().safeParse(reviewClaimId).success) throw new ApiError(400, "Invalid claim ID.");
    const claimResult = await sb.from("view_payout_claims").select("*,view_payout_claim_items(*)").eq("id", reviewClaimId).maybeSingle();
    databaseError(claimResult.error);
    if (!claimResult.data) throw new ApiError(404, "Claim not found.");
    const items = claimResult.data.view_payout_claim_items as ViewClaimItem[];
    const ids = items.map(item => item.post_id);
    const [posts, measurements] = await Promise.all([
      sb.from("social_account_posts").select("id,views,status,views_captured_at").in("id", ids),
      sb.from("social_post_measurements").select("post_id,captured_at,views,likes,comments,source").in("post_id", ids).gte("captured_at", new Date(Date.now() - 7 * 86_400_000).toISOString()).order("captured_at", { ascending: false }).limit(3000),
    ]);
    databaseError(posts.error); databaseError(measurements.error);
    return NextResponse.json({ evidence: items.map(item => viewReviewEvidence(item, posts.data?.find(post => post.id === item.post_id), (measurements.data ?? []).filter(point => point.post_id === item.post_id) as ViewObservation[])) }, { headers: { "Cache-Control": "no-store" } });
  }
  let quote = null;
  if (accountId) {
    const result = await sb.rpc("view_payout_quote", { p_actor: actor.user.id, p_account: accountId });
    databaseError(result.error);
    quote = result.data;
  }
  let selection = sb.from("view_payout_claims").select("*,view_payout_claim_items(*),worker:profiles!view_payout_claims_worker_id_fkey(worker_code,display_name),account:linked_social_accounts!view_payout_claims_account_id_fkey(handle,gig:gigs(title))").order("created_at", { ascending: false }).limit(200);
  if (!all) selection = selection.eq("worker_id", actor.user.id);
  if (accountId) selection = selection.eq("account_id", accountId);
  const { data, error } = await selection;
  databaseError(error);
  return NextResponse.json({ claims: data ?? [], quote }, { headers: { "Cache-Control": "no-store" } });
});
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim"), accountId: z.uuid() }),
  z.object({ action: z.literal("review"), claimId: z.uuid(), decision: z.enum(["Approved", "Rejected", "Hard rejected"]), note: z.string().trim().min(1).max(1000), assessment: z.enum(["organic", "mixed", "suspected", "insufficient"]), adjustments: z.array(z.object({ itemId: z.uuid(), excludedViews: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), reason: z.string().trim().min(1).max(1000), evidenceUrl: z.url().startsWith("https://").max(1000).optional() }).strict()).max(2000).default([]) }).strict(),
]);
export const POST = withApi({ auth: "user", rateLimit: 20 }, async (req) => {
  const actor = await authenticate(req);
  const body = input.safeParse(await req.json().catch(() => null));
  if (!body.success) throw new ApiError(400, "Invalid claim request.");
  const sb = supabaseAdmin();
  let result;
  if (body.data.action === "claim") {
    result = await sb.rpc("submit_view_payout_claim", { p_actor: actor.user.id, p_account: body.data.accountId });
  } else {
    if (!actor.isAdmin) throw new ApiError(403, "Access denied.");
    result = await sb.rpc("review_view_payout_claim_authenticity", { p_actor: actor.user.id, p_claim: body.data.claimId, p_decision: body.data.decision, p_note: body.data.note, p_assessment: body.data.assessment, p_adjustments: body.data.adjustments });
  }
  databaseError(result.error);
  return NextResponse.json({ ok: true, claim: result.data });
});

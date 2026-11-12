import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/route";
import { authenticate } from "@/lib/api/auth";
import { ApiError, databaseError } from "@/lib/api/errors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * A creator deletes their own account (Google Play's account-deletion requirement; the Android app calls this and
 * https://reelencer.com/delete-account explains it). Access stops at once and every session is signed out; the
 * account is erased after the 7-day restore window by the existing purge job (lib/workerDeletion.ts).
 * Retrying is safe: an already-deleted account returns the same deadline without extending it.
 */
export const POST = withApi({ auth: "user", rateLimit: 5 }, async req => {
  const actor = await authenticate(req);
  if (actor.isAdmin) throw new ApiError(403, "Administrator accounts can't be deleted from here.", "forbidden");
  const body = (await req.json().catch(() => ({}))) as { confirm?: unknown; reason?: unknown };
  if (body.confirm !== "DELETE") throw new ApiError(400, "Type DELETE to confirm.", "confirmation_required");
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 1000) : "";

  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("request_own_worker_deletion", { p_user: actor.user.id, p_reason: reason || null });
  if (error?.code === "PGRST202") throw new ApiError(503, "Account deletion is being set up. Try again shortly or email support@reelencer.com.", "schema_outdated");
  if (error?.code === "P0001" && error.message === "forbidden") throw new ApiError(403, "This account can't be deleted from here.", "forbidden");
  databaseError(error);

  // Sign out every device too. The API already refuses inactive accounts, so this is defence in depth and must
  // never undo a deletion that has been saved.
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (token) await sb.auth.admin.signOut(token, "global").catch(() => undefined);

  return NextResponse.json(data);
});

import "server-only";
import type { StoredAccountSetup } from "@/lib/accountSetup";
import type { supabaseAdmin } from "@/lib/supabaseAdmin";

// Kept free of lib/api/gigApplications so the approval path can call it without a circular import.

const MISSING_TABLE = new Set(["PGRST205", "42P01"]);

/**
 * Links a verified Content Posting account to the creator's profile (idempotent per application). Returns false when
 * the linked-accounts migration hasn't been applied yet, so approvals never fail because of it.
 */
export async function linkSocialAccount(
  sb: ReturnType<typeof supabaseAdmin>,
  input: { applicationId: string; gigId: string; workerCode: string; setup: StoredAccountSetup; actorId?: string | null },
) {
  const row = {
    application_id: input.applicationId,
    gig_id: input.gigId,
    worker_code: input.workerCode,
    platform: input.setup.platform || "Social",
    handle: input.setup.handle,
    profile_url: input.setup.profileUrl ?? "",
    linked_by: input.actorId ?? null,
    updated_at: new Date().toISOString(),
  };
  // Re-approving never re-activates an account the team paused or unlinked.
  let { error } = await sb.from("linked_social_accounts").upsert(row, { onConflict: "application_id,request_key", ignoreDuplicates: true });
  // Before the additional-accounts migration (202610100001) the unique key is the application alone.
  if (error?.code === "42P10" || error?.code === "42703") ({ error } = await sb.from("linked_social_accounts").upsert(row, { onConflict: "application_id", ignoreDuplicates: true }));
  if (error) {
    if (MISSING_TABLE.has(error.code ?? "")) return false;
    throw new Error(`Could not link the social account (${error.code ?? "unknown"}).`);
  }
  return true;
}

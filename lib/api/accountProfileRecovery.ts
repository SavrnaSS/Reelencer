import "server-only";
import { accountPlatformFor, normalizeHandle, validateAccountOwnership } from "@/lib/accountSetup";
import { makeVerifyCode } from "@/lib/accountRequests";
import { readProfileHealth, PROFILE_RECOVERY_COOLDOWN_MS, type AccountProfileHealth } from "@/lib/accountProfileHealth";
import { deriveSecretBytes } from "@/lib/secretCrypto";
import { ProfileNotFoundError } from "@/lib/socialSyncSchedule";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ApiError, databaseError } from "./errors";
import { readInstagramAccountOwnership } from "./accountOwnershipReader";
import { resolveSyncConfig } from "./integrations";

type Row = Record<string, unknown>;
type Sb = ReturnType<typeof supabaseAdmin>;

export function profileRecoveryCode(row: Row) {
  const health = readProfileHealth(row.profile_health);
  const bytes = deriveSecretBytes(`social-profile-recovery:${row.id}:${health?.removedAt ?? ""}`);
  return makeVerifyCode(n => bytes.subarray(0, n));
}

/** For platforms a bot cannot read, an administrator can confirm absence after opening the actual profile. */
export async function reportMissingAccountProfile(actorId: string, accountId: string, confirmed: boolean) {
  if (!confirmed) throw new ApiError(400, "Confirm that you opened the profile and it could not be found.", "invalid_input");
  const sb = supabaseAdmin();
  const { data: row, error } = await sb.from("linked_social_accounts").select("*").eq("id", accountId).maybeSingle();
  databaseError(error);
  if (!row) throw new ApiError(404, "Account not found.");
  if (!("profile_health" in row)) throw new ApiError(503, "Profile recovery needs the latest database update.", "schema_outdated");
  if (row.status === "unlinked" && readProfileHealth(row.profile_health)?.status === "missing") return row as Row;
  if (!["active", "paused"].includes(String(row.status))) throw new ApiError(409, "This account is already unlinked.");
  const now = new Date().toISOString();
  const { data, error: updateError } = await sb.from("linked_social_accounts").update({
    status: "unlinked", profile_health: { status: "missing", checkedAt: now, firstMissingAt: now, removedAt: now, missingChecks: 1, confirmedBy: actorId },
    sync_status: "error", sync_error_code: "not_found", sync_error: "The team confirmed that this profile could not be found.",
    next_sync_at: null, sync_locked_until: null, sync_lock_token: null, updated_at: now,
  }).eq("id", accountId).eq("status", String(row.status)).eq("worker_code", String(row.worker_code)).select("*").maybeSingle();
  databaseError(updateError);
  if (!data) throw new ApiError(409, "This account changed. Refresh before reviewing it.");
  return data as Row;
}

async function loadMissingAccount(sb: Sb, id: string, aliases?: string[]) {
  const { data, error } = await sb.from("linked_social_accounts").select("*").eq("id", id).maybeSingle();
  databaseError(error);
  if (!data || (aliases && !aliases.includes(String(data.worker_code)))) throw new ApiError(404, "Account not found.");
  if (data.status !== "unlinked" || readProfileHealth(data.profile_health)?.status !== "missing") throw new ApiError(409, "This profile no longer needs recovery. Refresh your accounts.");
  return data as Row;
}

async function save(sb: Sb, row: Row, health: AccountProfileHealth, restore?: { handle: string; profileUrl: string; externalId?: string; actorId?: string }) {
  const { data, error } = await sb.rpc("update_social_profile_recovery", {
    p_account_id: String(row.id), p_expected_health: row.profile_health, p_health: health,
    p_worker_code: String(row.worker_code),
    p_restore: !!restore, p_handle: restore?.handle ?? null, p_profile_url: restore?.profileUrl ?? null,
    p_external_id: restore?.externalId ?? null, p_actor: restore?.actorId ?? null,
  });
  if (error?.code === "PGRST202" || error?.code === "42883") throw new ApiError(503, "Profile recovery needs the latest database update.", "schema_outdated");
  databaseError(error);
  return data as Row;
}

/** Only public bio text or the official channel description can prove ownership automatically. */
async function readProfile(platformName: string, handle: string, code: string): Promise<{ owned: boolean; externalId?: string } | null> {
  const platform = accountPlatformFor(platformName);
  if (platform.id === "instagram") {
    const profile = await readInstagramAccountOwnership(handle, code);
    if (typeof profile.biography !== "string") return null;
    return { owned: profile.codeFound === true, externalId: profile.externalId };
  }
  if (platform.id !== "youtube") return null;
  const config = await resolveSyncConfig();
  if (!config.youtubeApiKey) return null;
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.search = new URLSearchParams({ part: "snippet", forHandle: `@${handle}`, key: config.youtubeApiKey }).toString();
  const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(6000) });
  const body = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(body?.items)) throw new Error("YouTube could not verify this profile automatically.");
  const channel = body.items[0];
  if (!channel) throw new ProfileNotFoundError("YouTube could not find this channel.");
  if (typeof channel.snippet?.description !== "string") throw new Error("YouTube did not expose the channel description.");
  return { owned: String(channel.snippet?.description ?? "").toUpperCase().includes(code), externalId: typeof channel.id === "string" ? channel.id : undefined };
}

/** A creator can repair their own missing profile; proving a different account never inherits an old identity. */
export async function recoverAccountProfile(actor: { userId: string; aliases: string[] }, input: { accountId: string; handle: string; profileUrl: string }) {
  const sb = supabaseAdmin();
  let row = await loadMissingAccount(sb, input.accountId, actor.aliases);
  const platform = accountPlatformFor(String(row.platform));
  const firstError = Object.values(validateAccountOwnership(input, platform))[0];
  if (firstError) throw new ApiError(400, firstError, "invalid_input");
  const handle = normalizeHandle(input.handle, platform);
  if (normalizeHandle(input.profileUrl, platform).toLowerCase() !== handle.toLowerCase()) throw new ApiError(400, "The profile link must match the username.", "invalid_input");
  const before = readProfileHealth(row.profile_health)!;
  const wait = Date.parse(before.recovery?.submittedAt ?? "") + PROFILE_RECOVERY_COOLDOWN_MS - Date.now();
  if (wait > 0) throw new ApiError(429, `Checked recently. Try again in ${Math.ceil(wait / 1000)} seconds.`, "cooldown");
  const code = profileRecoveryCode(row);
  const now = new Date().toISOString();
  let health: AccountProfileHealth = { ...before, checkedAt: now, recovery: { handle, profileUrl: input.profileUrl.trim(), submittedAt: now, manualReview: false, message: "Checking your profile." } };
  // Claim this attempt before the network read; another tab cannot submit a conflicting correction.
  row = await save(sb, row, health);
  let profile: Awaited<ReturnType<typeof readProfile>>;
  try { profile = await readProfile(String(row.platform), handle, code); }
  catch (error) {
    const missing = error instanceof ProfileNotFoundError;
    health = { ...health, recovery: { ...health.recovery!, manualReview: !missing,
      message: missing ? `The platform still could not find @${handle}. Check the username and profile link.` : "Automatic verification is unavailable. Keep the code in your bio so the team can verify your profile." } };
    return { row: await save(sb, row, health), restored: false, message: health.recovery!.message };
  }
  // Meta business IDs and public Instagram IDs are different identity namespaces. An uncertain comparison needs
  // manual verification, rather than falsely declaring the creator's account a different profile.
  const identityDiffers = !!row.external_id && !!profile?.externalId && String(row.external_id) !== profile.externalId;
  const canCompareIdentity = platform.id === "youtube" || row.sync_provider === "profile";
  const identityMismatch = identityDiffers && canCompareIdentity;
  const identityUnreadable = !!row.external_id && (!profile?.externalId || (identityDiffers && !canCompareIdentity));
  if (identityMismatch) {
    health = { ...health, recovery: { ...health.recovery!, blocked: true, manualReview: true, message: "This is a different profile from the one originally linked. Ask the team to review it, or add it as a new account." } };
  } else if (profile?.owned && !identityUnreadable) {
    try {
      const restored = await save(sb, row, { status: "healthy", checkedAt: now, missingChecks: 0 }, { handle, profileUrl: input.profileUrl.trim(), externalId: profile.externalId, actorId: actor.userId });
      return { row: restored, restored: true, message: `@${handle} is verified and linked again.` };
    } catch (error) {
      if (!(error instanceof ApiError) || !["profile_already_linked", "profile_account_limit"].includes(error.code)) throw error;
      health = { ...health, recovery: { ...health.recovery!, manualReview: true, message: error.message } };
    }
  } else {
    health = { ...health, recovery: { ...health.recovery!, manualReview: !profile || identityUnreadable,
      message: !profile || identityUnreadable ? "The team needs to verify this profile. Keep the code in your bio until it is reviewed." : `Add ${code} to the bio of @${handle}, save it, then check again.` } };
  }
  return { row: await save(sb, row, health), restored: false, message: health.recovery!.message };
}

/** A reviewer must explicitly confirm the recovery code on the corrected public profile. */
export async function restoreAccountProfile(actorId: string, accountId: string, confirmed: boolean, expected: { handle: string; submittedAt: string }) {
  if (!confirmed) throw new ApiError(400, "Open the profile and confirm its verification code before restoring it.", "invalid_input");
  const sb = supabaseAdmin();
  const row = await loadMissingAccount(sb, accountId);
  const health = readProfileHealth(row.profile_health)!;
  const request = health.recovery;
  if (!request || request.blocked) throw new ApiError(409, "This profile needs a corrected recovery request before it can be restored.");
  if (request.handle !== expected.handle || request.submittedAt !== expected.submittedAt) throw new ApiError(409, "The creator updated this profile. Review the latest request before restoring it.");
  return save(sb, row, { status: "healthy", checkedAt: new Date().toISOString(), missingChecks: 0 }, { handle: request.handle, profileUrl: request.profileUrl, actorId });
}

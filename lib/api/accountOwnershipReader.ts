import "server-only";
import { matchesAccountOwnershipCode } from "@/lib/accountOwnershipCode";
import { ProfileNotFoundError, SocialSyncError } from "@/lib/socialSyncSchedule";
import { fetchInstagramBusinessProfile } from "./instagramGraph";
import { fetchInstagramProfileSummary, normalizeInstagramHandle, type InstagramProfile } from "./instagramProfile";
import { resolveSyncConfig, type SyncConfig } from "./integrations";

type ProfileSummary = Omit<InstagramProfile, "media"> & { codeFound?: boolean };
type MetaConfig = Pick<SyncConfig, "metaAccessToken" | "metaIgBusinessId">;
type Providers = {
  publicProfile: (handle: string, code: string) => Promise<ProfileSummary>;
  config: () => Promise<MetaConfig>;
  businessProfile: (handle: string, config: MetaConfig, signal?: AbortSignal) => Promise<InstagramProfile>;
};
type Budgets = { totalMs?: number; configMs?: number };

async function within<T>(read: () => Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(read),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SocialSyncError("Instagram's bio check timed out. Please try again shortly.", "timeout")), milliseconds);
      }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

/** Only a real biography from an identity-checked provider can establish account ownership. */
function ownership(profile: ProfileSummary | InstagramProfile, code: string): ProfileSummary {
  if (typeof profile.biography !== "string") throw new SocialSyncError("Instagram did not expose this profile's biography.", "unavailable");
  return {
    externalId: profile.externalId, followers: profile.followers, following: profile.following, posts: profile.posts,
    biography: profile.biography, isPrivate: profile.isPrivate, note: profile.note,
    codeFound: matchesAccountOwnershipCode(profile.biography, code),
  };
}

function fallbackFailure(publicError: unknown, officialError: unknown) {
  // A separate provider must not erase confirmed absence or a public-reader retry deadline.
  if (publicError instanceof ProfileNotFoundError) return publicError;
  if (publicError instanceof SocialSyncError && publicError.code === "rate_limited") {
    if (officialError instanceof SocialSyncError && officialError.code === "rate_limited" && officialError.retryAfterMs > publicError.retryAfterMs) {
      return new SocialSyncError(publicError.message, "rate_limited", officialError.retryAfterMs);
    }
    return publicError;
  }
  return officialError instanceof SocialSyncError && officialError.code === "rate_limited" ? officialError : publicError;
}

/** Reuse configured, supported Meta access when the public profile reader cannot expose a biography. */
export function createInstagramAccountOwnershipReader(providers: Providers, budgets: Budgets = {}) {
  const totalMs = Math.max(1, Math.min(15_000, budgets.totalMs ?? 15_000));
  const configMs = Math.max(1, Math.min(1_000, budgets.configMs ?? 1_000));
  return async (input: string, code: string): Promise<ProfileSummary> => {
    const handle = normalizeInstagramHandle(input);
    const deadline = Date.now() + totalMs;
    let publicError: unknown;
    try { return ownership(await within(() => providers.publicProfile(handle, code), totalMs), code); }
    catch (error) { publicError = error; }

    if (Date.now() >= deadline) throw publicError;
    let config: MetaConfig;
    try { config = await within(providers.config, Math.min(configMs, deadline - Date.now())); }
    catch { throw publicError; }
    const metaAccessToken = typeof config?.metaAccessToken === "string" ? config.metaAccessToken.trim() : "";
    const metaIgBusinessId = typeof config?.metaIgBusinessId === "string" ? config.metaIgBusinessId.trim() : "";
    if (!metaAccessToken || !/^\d{1,40}$/.test(metaIgBusinessId) || Date.now() >= deadline) throw publicError;

    const controller = new AbortController();
    try {
      const profile = await within(() => providers.businessProfile(handle, { metaAccessToken, metaIgBusinessId }, controller.signal), Math.max(1, deadline - Date.now()));
      return ownership(profile, code);
    } catch (error) { throw fallbackFailure(publicError, error); }
    finally { controller.abort(); }
  };
}

export const readInstagramAccountOwnership = createInstagramAccountOwnershipReader({
  publicProfile: fetchInstagramProfileSummary, config: resolveSyncConfig, businessProfile: fetchInstagramBusinessProfile,
});

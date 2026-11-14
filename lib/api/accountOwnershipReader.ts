import "server-only";
import { matchesAccountOwnershipCode } from "@/lib/accountOwnershipCode";
import { ProfileNotFoundError, SocialSyncError } from "@/lib/socialSyncSchedule";
import { fetchInstagramBusinessBiography } from "./instagramGraph";
import { fetchInstagramProfileSummary, normalizeInstagramHandle, type InstagramProfile } from "./instagramProfile";
import { resolveSyncConfig, type SyncConfig } from "./integrations";

type ProfileSummary = Omit<InstagramProfile, "media"> & { codeFound?: boolean; readAt?: string };
type MetaConfig = Pick<SyncConfig, "metaAccessToken" | "metaIgBusinessId">;
type Providers = {
  publicProfile: (handle: string, code: string, signal?: AbortSignal) => Promise<ProfileSummary>;
  config: () => Promise<MetaConfig>;
  businessProfile: (handle: string, config: MetaConfig, signal?: AbortSignal) => Promise<InstagramProfile>;
};
type Budgets = { totalMs?: number; configMs?: number; cacheMs?: number };

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
function ownership(profile: ProfileSummary, code: string): ProfileSummary {
  if (typeof profile.biography !== "string") throw new SocialSyncError("Instagram did not expose this profile's biography.", "unavailable");
  return {
    externalId: profile.externalId, followers: profile.followers, following: profile.following, posts: profile.posts,
    biography: profile.biography, isPrivate: profile.isPrivate, note: profile.note,
    source: profile.source,
    readAt: profile.readAt,
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
  if (officialError instanceof SocialSyncError && ["rate_limited", "credentials"].includes(officialError.code)) return officialError;
  return publicError;
}

/** Prefer configured authenticated access; public pages remain the fallback for eligible reads. */
export function createInstagramAccountOwnershipReader(providers: Providers, budgets: Budgets = {}) {
  const totalMs = Math.max(1, Math.min(15_000, budgets.totalMs ?? 15_000));
  const configMs = Math.max(1, Math.min(1_000, budgets.configMs ?? 1_000));
  const cacheMs = Math.max(0, Math.min(10_000, budgets.cacheMs ?? 10_000));
  const pending = new Map<string, Promise<ProfileSummary>>();
  const cache = new Map<string, { expiresAt: number; profile: ProfileSummary }>();
  const lookup = async (handle: string, code: string): Promise<ProfileSummary> => {
    const deadline = Date.now() + totalMs;
    const remaining = () => Math.max(0, deadline - Date.now());
    let config: MetaConfig | undefined;
    try { config = await within(providers.config, Math.max(1, Math.min(configMs, Math.floor(totalMs / 4)))); }
    catch { /* Configuration outages must not disable readable public profiles. */ }
    const metaAccessToken = typeof config?.metaAccessToken === "string" ? config.metaAccessToken.trim() : "";
    const metaIgBusinessId = typeof config?.metaIgBusinessId === "string" ? config.metaIgBusinessId.trim() : "";
    const read = async (provider: (signal: AbortSignal) => Promise<ProfileSummary>, milliseconds: number, source: "meta_api" | "public_profile") => {
      if (milliseconds <= 0) throw new SocialSyncError("Instagram's bio check timed out. Please try again shortly.", "timeout");
      const controller = new AbortController();
      try {
        const profile = ownership(await within(() => provider(controller.signal), milliseconds), code);
        return { ...profile, source: profile.source ?? source, readAt: new Date().toISOString() };
      } finally { controller.abort(); }
    };
    let officialError: unknown;
    if (metaAccessToken && /^\d{1,40}$/.test(metaIgBusinessId) && remaining() > 0) {
      try {
        // Reserve a separate public-read window if Meta rejects an ineligible account or the token expires.
        return await read(signal => providers.businessProfile(handle, { metaAccessToken, metaIgBusinessId }, signal), Math.min(6000, Math.max(1, Math.floor(remaining() / 2))), "meta_api");
      } catch (error) { officialError = error; }
    }
    try {
      return await read(signal => providers.publicProfile(handle, code, signal), remaining(), "public_profile");
    } catch (error) { throw fallbackFailure(error, officialError); }
  };
  return async (input: string, code: string, options: { forceRefresh?: boolean } = {}): Promise<ProfileSummary> => {
    const handle = normalizeInstagramHandle(input);
    const cached = cache.get(handle);
    if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) return ownership(cached.profile, code);
    cache.delete(handle);
    let read = pending.get(handle);
    if (!read) {
      read = lookup(handle, code);
      pending.set(handle, read);
    }
    try {
      // Share the fetched biography, never another application's codeFound result.
      const profile = await read;
      if (cacheMs > 0) {
        if (cache.size >= 500) cache.delete(cache.keys().next().value!);
        cache.set(handle, { expiresAt: Date.now() + cacheMs, profile });
      }
      return ownership(profile, code);
    } finally {
      if (pending.get(handle) === read) pending.delete(handle);
    }
  };
}

export const readInstagramAccountOwnership = createInstagramAccountOwnershipReader({
  publicProfile: (handle, code, signal) => fetchInstagramProfileSummary(handle, code, { signal }),
  config: () => {
    const metaAccessToken = process.env.META_GRAPH_ACCESS_TOKEN?.trim();
    const metaIgBusinessId = process.env.META_IG_BUSINESS_ACCOUNT_ID?.trim();
    return metaAccessToken && metaIgBusinessId ? Promise.resolve({ metaAccessToken, metaIgBusinessId }) : resolveSyncConfig();
  },
  businessProfile: fetchInstagramBusinessBiography,
});

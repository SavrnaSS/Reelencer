import "server-only";
import { normalizeInstagramHandle, type InstagramProfile } from "./instagramProfile";
import type { SyncConfig } from "./integrations";
import { canonicalInstagramReelUrl, externalPostId } from "@/lib/socialAnalytics";
import { SocialSyncError } from "@/lib/socialSyncSchedule";

type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

/** Official Business Discovery only; never use saved account passwords or private Instagram endpoints. */
export async function fetchInstagramBusinessProfile(input: string, config: Pick<SyncConfig, "metaAccessToken" | "metaIgBusinessId">, signal?: AbortSignal): Promise<InstagramProfile> {
  const handle = normalizeInstagramHandle(input);
  if (!config.metaAccessToken || !/^\d{1,40}$/.test(config.metaIgBusinessId)) throw new SocialSyncError("Connect a Meta access token and Instagram professional account ID in Auto-sync.", "credentials");
  const version = /^v\d+\.\d+$/.test(process.env.META_GRAPH_VERSION ?? "") ? process.env.META_GRAPH_VERSION : "v23.0";
  const url = new URL(`https://graph.facebook.com/${version}/${config.metaIgBusinessId}`);
  url.searchParams.set("fields", `business_discovery.username(${handle}){id,username,biography,followers_count,follows_count,media_count,media.limit(25){id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count}}`);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${config.metaAccessToken}`, Accept: "application/json" },
      cache: "no-store", redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000),
    });
  } catch { throw new SocialSyncError("Instagram's API did not respond. Automatic sync will retry.", "timeout"); }
  const body = row(await response.json().catch(() => null));
  const error = row(body.error);
  if (!response.ok || body.error) {
    const code = Number(error.code);
    if (response.status === 429 || [4, 17, 32, 613, 80004].includes(code)) {
      const header = response.headers.get("retry-after");
      const retry = header && /^\d+$/.test(header) ? Number(header) * 1000 : header ? Math.max(0, Date.parse(header) - Date.now()) : 0;
      throw new SocialSyncError("Instagram's API has limited requests. The next retry is scheduled automatically.", "rate_limited", retry || 0);
    }
    if ([10, 190, 200].includes(code) || response.status === 401 || response.status === 403) throw new SocialSyncError("Reconnect the Meta token and required permissions in Auto-sync. Existing statistics are kept.", "credentials");
    throw new SocialSyncError("Instagram's API could not read this handle. Business Discovery requires an eligible public professional account.", "unavailable");
  }
  const profile = row(body.business_discovery);
  if (String(profile.username ?? "").toLowerCase() !== handle) throw new SocialSyncError("Instagram's API did not return the requested account. Check the handle and professional account access.", "not_found");
  const result: InstagramProfile = {
    externalId: profile.id ? String(profile.id) : undefined,
    followers: count(profile.followers_count), following: count(profile.follows_count), posts: count(profile.media_count),
    biography: typeof profile.biography === "string" ? profile.biography.slice(0, 600) : undefined,
    media: [], note: "Synced through Meta's official Instagram Business Discovery API. Reel views, reach, saves and shares require access to the account's own insights; unavailable numbers are kept separate.",
  };
  if ([result.followers, result.following, result.posts].every(value => value === undefined)) throw new SocialSyncError("Instagram's API did not expose statistics for this account.");
  const media = row(profile.media).data;
  const seen = new Set<string>();
  for (const item of Array.isArray(media) ? media.slice(0, 25) : []) {
    const post = row(item);
    const url = canonicalInstagramReelUrl(String(post.permalink ?? ""));
    const id = url ? externalPostId(url) : undefined;
    if (!url || !id || seen.has(id)) continue;
    seen.add(id);
    const timestamp = typeof post.timestamp === "string" ? Date.parse(post.timestamp) : NaN;
    result.media.push({ externalId: id, url,
      caption: typeof post.caption === "string" ? post.caption.split("\n")[0].slice(0, 300) : undefined,
      postedAt: Number.isFinite(timestamp) && timestamp <= Date.now() ? new Date(timestamp).toISOString() : undefined,
      likes: count(post.like_count), comments: count(post.comments_count),
    });
  }
  return result;
}

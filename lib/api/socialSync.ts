import "server-only";
import { fetchInstagramProfile, fetchInstagramReel } from "@/lib/api/instagramProfile";
import { fetchInstagramBusinessProfile } from "@/lib/api/instagramGraph";
import { accountPlatformFor } from "@/lib/accountSetup";
import { ApiError, databaseError } from "@/lib/api/errors";
import { externalPostId, type SyncState } from "@/lib/socialAnalytics";
import { BEFORE_LINK_NOTE, reelTracking, trackingStart } from "@/lib/reelTracking";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveSyncConfig, type SyncConfig } from "@/lib/api/integrations";
import { adaptiveSyncInterval, classifySyncError, ProfileNotFoundError, retryDelayMs, SocialSyncError, storedSyncState } from "@/lib/socialSyncSchedule";
import { PROFILE_MISSING_CONFIRM_MS, recordMissingProfile } from "@/lib/accountProfileHealth";

// Official API readers share the same durable queue as Instagram's public profile fallback.

type Sb = ReturnType<typeof supabaseAdmin>;
type Row = Record<string, unknown>;

type ExternalPost = { externalId: string; url: string; caption?: string; postedAt?: string; views?: number; likes?: number; comments?: number; viewsSource?: "api" | "profile" };
type Fetched = { externalId?: string; followers?: number; following?: number; posts?: number; totalViews?: number; media: ExternalPost[]; note?: string; source?: "api" | "profile"; provider?: SyncState["provider"] };

const TIMEOUT_MS = 8000;

class SyncError extends Error {}

const n = (value: unknown) => {
  const v = typeof value === "string" ? Number(value) : value;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined;
};

async function getJson(url: string, signal?: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS), cache: "no-store", redirect: "error" });
  } catch {
    throw new SyncError("The platform didn't respond in time.");
  }
  const body = (await res.json().catch(() => null)) as Row | null;
  if (!res.ok) {
    const message = String((body?.error as Row | undefined)?.message ?? "");
    throw new SyncError(message ? message.slice(0, 200) : `The platform returned an error (${res.status}).`);
  }
  return body ?? {};
}

/* ------------------------------- providers ------------------------------- */

async function fetchYouTube(handle: string, config: SyncConfig): Promise<Fetched> {
  const signal = AbortSignal.timeout(10_000);
  const key = encodeURIComponent(config.youtubeApiKey);
  const base = "https://www.googleapis.com/youtube/v3";
  const channels = await getJson(`${base}/channels?part=statistics,contentDetails&forHandle=${encodeURIComponent(`@${handle}`)}&key=${key}`, signal);
  const channel = (channels.items as Row[] | undefined)?.[0];
  if (!channel && Array.isArray(channels.items)) throw new ProfileNotFoundError(`No YouTube channel found for @${handle}. Check the handle on the account.`);
  if (!channel) throw new SyncError("YouTube returned an unreadable channel response. The next check is scheduled automatically.");
  const stats = (channel.statistics ?? {}) as Row;
  const uploads = String(((channel.contentDetails as Row)?.relatedPlaylists as Row | undefined)?.uploads ?? "");
  let media: ExternalPost[] = [];
  let note: string | undefined;
  if (uploads) {
    try {
      const items = await getJson(`${base}/playlistItems?part=contentDetails&maxResults=25&playlistId=${encodeURIComponent(uploads)}&key=${key}`, signal);
      const ids = ((items.items as Row[] | undefined) ?? []).map((i) => String((i.contentDetails as Row)?.videoId ?? "")).filter(Boolean);
      if (ids.length) {
        const videos = await getJson(`${base}/videos?part=statistics,snippet&id=${ids.join(",")}&key=${key}`, signal);
        media = ((videos.items as Row[] | undefined) ?? []).map((v) => {
          const s = (v.statistics ?? {}) as Row;
          const snippet = (v.snippet ?? {}) as Row;
          return {
            externalId: `yt:${String(v.id)}`,
            url: `https://www.youtube.com/shorts/${String(v.id)}`,
            caption: String(snippet.title ?? "").slice(0, 300) || undefined,
            postedAt: typeof snippet.publishedAt === "string" ? snippet.publishedAt : undefined,
            views: n(s.viewCount),
            likes: n(s.likeCount),
            comments: n(s.commentCount),
          };
        });
      }
    } catch { note = "YouTube channel statistics refreshed. Recent video statistics were unavailable; existing video measurements are preserved."; }
  }
  return {
    externalId: String(channel.id ?? ""),
    // Channels can hide their subscriber count.
    followers: stats.hiddenSubscriberCount ? undefined : n(stats.subscriberCount),
    posts: n(stats.videoCount),
    totalViews: n(stats.viewCount),
    media,
    note,
  };
}

type FetchOptions = { refreshInteractions?: boolean };
type Provider = { configured: (config: SyncConfig) => boolean; fetch: (handle: string, config: SyncConfig, trackedUrls?: string[], publishedAfter?: number, options?: FetchOptions) => Promise<Fetched> };

function providerFor(platform: string): Provider | null {
  const id = accountPlatformFor(platform).id;
  if (id === "youtube") return { configured: (c) => !!c.youtubeApiKey, fetch: fetchYouTube };
  if (id === "instagram") return { configured: () => true, fetch: async (handle, config, urls, publishedAfter, options) => {
    const signal = AbortSignal.timeout(10_000);
    let apiError: unknown;
    if (config.metaAccessToken && config.metaIgBusinessId) {
      try {
        const profile = await fetchInstagramBusinessProfile(handle, config, signal);
        const media: ExternalPost[] = [...profile.media];
        // Business Discovery does not expose reel views. Supplement at most two verified public reels.
        const targets = [...new Set([...(urls ?? []), ...media.filter(post => post.url.includes("/reel/")).map(post => post.url)])].slice(0, 2);
        const readings = await Promise.allSettled(targets.map(url => fetchInstagramReel(handle, url, { signal })));
        for (const result of readings) {
          if (result.status !== "fulfilled" || !result.value) continue;
          const reading = result.value;
          const index = media.findIndex(post => post.externalId === reading.externalId);
          const existing: Partial<ExternalPost> = index < 0 ? {} : media[index];
          const measured = { ...existing, ...Object.fromEntries(Object.entries(reading).filter(([, value]) => value !== undefined)),
            // Preserve exact API interaction counts if the public page only offers rounded metadata.
            ...(existing.likes !== undefined ? { likes: existing.likes } : {}),
            ...(existing.comments !== undefined ? { comments: existing.comments } : {}),
            ...(reading.views !== undefined ? { viewsSource: "profile" as const } : {}) } as ExternalPost;
          if (index < 0) media.push(measured); else media[index] = measured;
        }
        return { ...profile, media, source: "api", provider: "meta" };
      }
      catch (error) {
        // A platform quota response must not trigger additional Instagram traffic.
        if (error instanceof SocialSyncError && error.code === "rate_limited") throw error;
        apiError = error;
      }
    }
    try {
      const profile = await fetchInstagramProfile(handle, urls, { publishedAfter, signal, refreshInteractions: options?.refreshInteractions });
      if (apiError) profile.note += " The API connection was unavailable; public profile fallback was used.";
      return { ...profile, source: "profile", provider: "profile" };
    } catch (error) { throw apiError instanceof SocialSyncError && apiError.code === "credentials" ? apiError : error; }
  } };
  return null;
}

/** Whether an account's numbers can sync automatically with the given credentials, for the UI. */
export function syncAvailability(platform: string, config: Pick<SyncConfig, "youtubeApiKey" | "metaAccessToken" | "metaIgBusinessId">): Pick<SyncState, "available" | "status"> {
  const provider = providerFor(platform);
  if (!provider) return { available: false, status: "unsupported" };
  if (!provider.configured(config as SyncConfig)) return { available: false, status: "not_configured" };
  return { available: true, status: "pending" };
}

/* --------------------------------- sync ---------------------------------- */

/** Postgres "undefined column": the auto-sync migration (202610080003) hasn't been applied yet. */
const MISSING_COLUMN = "42703";

async function updateAccount(sb: Sb, id: string, values: Row, token?: string) {
  let query = sb.from("linked_social_accounts").update(values).eq("id", id);
  if (token) query = query.eq("sync_lock_token", token);
  const { data, error } = await query.select("id");
  databaseError(error);
  if (token && !data?.length) throw new Error("This sync lease has expired. A newer refresh owns this account.");
}

/** Atomic PostgreSQL claims coordinate independent server processes and skip paused/leased accounts. */
export async function claimSyncAccounts(sb: Sb, config: SyncConfig, count = 2, accountId?: string, force = false): Promise<Row[]> {
  const { data, error } = await sb.rpc("claim_social_sync_accounts", {
    p_limit: count, p_account_id: accountId ?? null, p_force: force, p_youtube_enabled: !!config.youtubeApiKey,
  });
  if (error?.code === "PGRST202" || error?.code === "42883") throw new ApiError(503, "Automatic syncing needs the latest database migration.", "schema_outdated");
  databaseError(error);
  return (data ?? []) as Row[];
}

/** Insert, retrying without the columns added by the auto-sync migration if it isn't applied yet. */
async function insertTolerant(sb: Sb, table: string, row: Row, newColumns: string[]) {
  let { error } = await sb.from(table).insert(row);
  if (error?.code === MISSING_COLUMN) ({ error } = await sb.from(table).insert(Object.fromEntries(Object.entries(row).filter(([k]) => !newColumns.includes(k)))));
  if (error && error.code !== "23505") throw new Error(`Couldn't save synced data (${error.code ?? "unknown"}).`);
}

/** Counts never go down from a sync: a lower public reading leaves a higher saved (often manual) number alone. */
export const mergeSyncedCount = (saved: unknown, measured: number | undefined) =>
  measured === undefined ? undefined : saved == null || measured >= Number(saved) ? measured : undefined;

/**
 * Writes one reel's synced numbers through the database's monotonic merge (202610300004), which also skips no-op
 * writes. Before that migration is applied, falls back to the same rule applied here (not atomic with edits).
 */
async function applySyncedMetrics(sb: Sb, known: Row, media: ExternalPost, source: "api" | "profile", now: Date) {
  const { error } = await sb.rpc("apply_synced_post_metrics", {
    p_post: String(known.id), p_views: media.views ?? null, p_likes: media.likes ?? null, p_comments: media.comments ?? null,
    p_source: media.viewsSource ?? source, p_at: now.toISOString(), p_posted_at: media.postedAt ?? null, p_caption: media.caption ?? null,
  });
  if (!error) return;
  if (error.code !== "PGRST202" && error.code !== "42883") throw new Error(`Couldn't update a synced post (${error.code ?? "unknown"}).`);
  const views = mergeSyncedCount(known.views, media.views);
  const likes = mergeSyncedCount(known.likes, media.likes);
  const comments = mergeSyncedCount(known.comments, media.comments);
  const { error: legacyError } = await sb
    .from("social_account_posts")
    .update({
      ...(views !== undefined ? { views, views_captured_at: now.toISOString(), views_source: media.viewsSource ?? source } : {}),
      ...(likes !== undefined ? { likes } : {}),
      ...(comments !== undefined ? { comments } : {}),
      ...(!known.posted_at && media.postedAt ? { posted_at: media.postedAt } : {}),
      ...(!known.caption && media.caption ? { caption: media.caption } : {}),
      updated_at: now.toISOString(),
    })
    .eq("id", String(known.id));
  if (legacyError) throw new Error(`Couldn't update a synced post (${legacyError.code ?? "unknown"}).`);
}

/**
 * Pulls fresh numbers for one account: one snapshot (period figures are the change since the previous sync) and
 * per-post updates. New posts published after linking are added for review, so pay still needs a human decision.
 */
const runningSyncs = new Map<string, Promise<SyncState>>();

export async function syncAccount(sb: Sb, account: Row, configOverride?: SyncConfig, options: { claimed?: boolean; force?: boolean } = {}): Promise<SyncState> {
  const id = String(account.id);
  const running = runningSyncs.get(id);
  if (running) return running;
  const task = (async () => {
    if (account.status !== "active") return storedSyncState(account);
    const config = configOverride ?? await resolveSyncConfig();
    if (!providerFor(String(account.platform))?.configured(config)) return syncAvailability(String(account.platform), config) as SyncState;
    const claimed = options.claimed ? account : (await claimSyncAccounts(sb, config, 1, id, options.force !== false))[0];
    if (!claimed) return storedSyncState(account);
    return performSyncAccount(sb, { ...account, ...claimed }, config);
  })();
  runningSyncs.set(id, task);
  try { return await task; } finally { runningSyncs.delete(id); }
}

async function performSyncAccount(sb: Sb, account: Row, configOverride?: SyncConfig): Promise<SyncState> {
  const config = configOverride ?? (await resolveSyncConfig());
  const id = String(account.id);
  const provider = providerFor(String(account.platform));
  if (!provider) {
    await updateAccount(sb, id, { sync_status: "unsupported" });
    return { available: false, status: "unsupported" };
  }
  if (!provider.configured(config)) {
    await updateAccount(sb, id, { sync_status: "not_configured" });
    return { available: false, status: "not_configured" };
  }
  const now = new Date();
  try {
    const [{ data: previous, error: previousError }, { data: existing, error: postsError }] = await Promise.all([
      sb.from("social_account_snapshots").select("*").eq("account_id", id).in("source", ["api", "profile"]).order("captured_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("social_account_posts").select("*").eq("account_id", id),
    ]);
    databaseError(previousError);
    databaseError(postsError);
    const posts = (existing ?? []) as Row[];
    // Only reels from the linking day on are discovered or refreshed; earlier ones are left as they are.
    const windowStart = trackingStart(String(account.linked_at));
    // Removed reels stay known (so they're never re-discovered) but are never refreshed or counted.
    const inWindow = (post: Row) => !post.removed_at && reelTracking(post.posted_at ? String(post.posted_at) : undefined, String(account.linked_at)) !== "before_link";
    const tracked = [...posts].filter(inWindow).sort((a, b) => {
      const needsNumbers = (post: Row) => post.status === "submitted" && post.views == null;
      return Number(needsNumbers(b)) - Number(needsNumbers(a)) || Date.parse(String(a.views_captured_at ?? a.updated_at ?? "1970-01-01")) - Date.parse(String(b.views_captured_at ?? b.updated_at ?? "1970-01-01"));
    });
    // The first sync in each 30-minute window also re-reads one reel's full page for likes and comments.
    const lastSynced = Date.parse(String(account.last_synced_at ?? ""));
    const refreshInteractions = !Number.isFinite(lastSynced) || Math.floor(lastSynced / 1_800_000) !== Math.floor(now.getTime() / 1_800_000);
    const fetched = await provider.fetch(String(account.handle), config, tracked.map((post) => String(post.url ?? "")), windowStart, { refreshInteractions });
    const source = fetched.source ?? "api";
    const lastApi = previous?.source === source ? previous : null;
    const byExternal = new Map<string, Row>();
    for (const post of posts) {
      const key = String(post.external_id || "") || externalPostId(String(post.url));
      if (key) byExternal.set(key, post);
    }

    // Interactions and views gained on tracked reels since the last sync. Account-wide totals (a YouTube channel's
    // lifetime views) include reels from before linking, so period views come from tracked reels only.
    let interactionsGained = 0;
    let viewsGained = 0;
    let viewsMeasured = false;
    const latestViews = new Map(posts.filter(inWindow).map((post) => [String(post.id), post.views == null ? undefined : Number(post.views)]));
    for (const media of fetched.media) {
      const known = byExternal.get(media.externalId);
      if (known && !inWindow(known)) continue;
      if (known && !known.posted_at && media.postedAt && reelTracking(media.postedAt, String(account.linked_at)) === "before_link") {
        // Its date is only known now and it predates linking: record the date and close it if it was waiting.
        const { error } = await sb
          .from("social_account_posts")
          .update({
            posted_at: media.postedAt,
            ...(known.status === "submitted" ? { status: "rejected", review_note: BEFORE_LINK_NOTE, reviewed_at: now.toISOString() } : {}),
            updated_at: now.toISOString(),
          })
          .eq("id", String(known.id));
        if (error) throw new Error(`Couldn't update a synced post (${error.code ?? "unknown"}).`);
        continue;
      }
      if (known) {
        interactionsGained += Math.max(0, (media.likes ?? 0) - Number(known.likes ?? 0)) + Math.max(0, (media.comments ?? 0) - Number(known.comments ?? 0));
        if (media.views !== undefined) {
          viewsMeasured = true;
          const views = mergeSyncedCount(known.views, media.views);
          if (views !== undefined) {
            if (known.views != null) viewsGained += views - Number(known.views);
            latestViews.set(String(known.id), views);
          }
        }
        await applySyncedMetrics(sb, known, media, source, now);
      } else if (media.postedAt && windowStart !== undefined && Date.parse(media.postedAt) >= windowStart && (accountPlatformFor(String(account.platform)).id !== "instagram" || media.url.includes('/reel/'))) {
        // Posted for the gig after linking: track it automatically, pending the team's review for pay.
        if (media.views !== undefined) {
          viewsMeasured = true;
          viewsGained += media.views;
          latestViews.set(`new:${media.externalId}`, media.views);
        }
        await insertTolerant(
          sb,
          "social_account_posts",
          {
            account_id: id,
            url: media.url,
            caption: media.caption ?? "",
            posted_at: media.postedAt,
            views: media.views ?? null,
            views_captured_at: media.views !== undefined ? now.toISOString() : null,
            views_source: media.views !== undefined ? media.viewsSource ?? source : null,
            likes: media.likes ?? null,
            comments: media.comments ?? null,
            status: "submitted",
            submitted_by_worker: false,
            source,
            external_id: media.externalId,
          },
          ["source", "external_id", "views_captured_at", "views_source"],
        );
      }
    }

    // Each successful sync has a dated snapshot; missing metrics remain unavailable.
    const lastAt = lastApi ? Date.parse(String(lastApi.captured_at)) : 0;
    if (now.getTime() - lastAt >= 60_000) {
      const days = lastApi ? (now.getTime() - lastAt) / 86_400_000 : 7;
      const trackedViews = [...latestViews.values()].filter((views): views is number => views !== undefined);
      const totalViews = trackedViews.length ? trackedViews.reduce((sum, views) => sum + views, 0) : undefined;
      await insertTolerant(
        sb,
        "social_account_snapshots",
        {
          account_id: id,
          captured_at: now.toISOString(),
          period_days: Math.min(90, Math.max(1, Math.round(days))),
          followers: fetched.followers ?? null,
          following: fetched.following ?? null,
          posts: fetched.posts ?? null,
          impressions: lastApi && viewsMeasured ? viewsGained : null,
          engagements: source === "api" && lastApi ? interactionsGained : null,
          source,
          note: fetched.note ?? "Synced automatically",
          total_views: totalViews ?? null,
        },
        ["total_views"],
      );
    }

    const finished = Date.now();
    const values = { sync_status: "ok", last_synced_at: new Date(finished).toISOString(), sync_error: "", sync_error_code: "", sync_failures: 0,
      // Fresh reels gain views fastest, so accounts with one are checked more often (see adaptiveSyncInterval).
      next_sync_at: new Date(finished + adaptiveSyncInterval(String(account.platform), newestTrackedPost(posts, fetched.media, inWindow), finished)).toISOString(),
      sync_provider: fetched.provider ?? "youtube", sync_locked_until: null, sync_lock_token: null,
      ...("profile_health" in account ? { profile_health: { status: "healthy", checkedAt: new Date(finished).toISOString(), missingChecks: 0 } } : {}),
      ...(fetched.externalId ? { external_id: fetched.externalId } : {}) };
    await updateAccount(sb, id, values, String(account.sync_lock_token));
    return storedSyncState({ ...account, ...values });
  } catch (error) {
    let message = error instanceof Error ? error.message : "Sync failed.";
    for (const secret of [config.youtubeApiKey, config.metaAccessToken]) if (secret) message = message.replaceAll(secret, "[redacted]");
    message = message.slice(0, 300);
    const code = classifySyncError(error);
    const failures = Math.max(0, Number(account.sync_failures) || 0) + 1;
    const health = error instanceof ProfileNotFoundError && "profile_health" in account ? recordMissingProfile(account.profile_health) : null;
    const values = { sync_status: "error", sync_error: message, sync_error_code: code, sync_failures: failures,
      next_sync_at: new Date(Date.now() + retryDelayMs(code, failures, id, error instanceof SocialSyncError ? error.retryAfterMs : 0)).toISOString(),
      sync_locked_until: null, sync_lock_token: null };
    if (health) Object.assign(values, {
      profile_health: health,
      ...(health.status === "missing" ? { status: "unlinked", next_sync_at: null, updated_at: new Date().toISOString() }
        : { next_sync_at: new Date(Date.now() + PROFILE_MISSING_CONFIRM_MS).toISOString() }),
    });
    // A failed attempt never advances last_synced_at or discards saved measurements.
    await updateAccount(sb, id, values, String(account.sync_lock_token));
    return storedSyncState({ ...account, ...values });
  }
}

/** Newest posting time among the account's tracked reels, including any just discovered. */
function newestTrackedPost(posts: Row[], media: ExternalPost[], inWindow: (post: Row) => boolean) {
  const times = [
    ...posts.filter(inWindow).map((post) => Date.parse(String(post.posted_at ?? ""))),
    ...media.map((item) => Date.parse(String(item.postedAt ?? ""))),
  ].filter(Number.isFinite);
  return times.length ? Math.max(...times) : undefined;
}

/** Determine refresh cadence separately from how frequently clients poll the saved data. */
export function accountSyncDue(account: Row, now: number, staleMs: number): boolean {
  if (account.status !== "active") return false;
  if ((Date.parse(String(account.sync_locked_until)) || 0) > now) return false;
  const scheduled = Date.parse(String(account.next_sync_at));
  if (Number.isFinite(scheduled)) return now >= scheduled;
  const last = account.last_synced_at ? Date.parse(String(account.last_synced_at)) : 0;
  if (!last || !Number.isFinite(last)) return true;
  const profile = accountPlatformFor(String(account.platform)).id === "instagram";
  const interval = account.sync_status === "error" ? (profile ? 30 * 60_000 : Math.max(staleMs, 30 * 60_000)) : profile ? 5 * 60_000 : staleMs;
  return now - last >= interval;
}

/** Syncs accounts whose data is older than `staleMs`, a few at a time, within an overall time budget. */
export async function syncStale(sb: Sb, accounts: Row[], staleMs: number, budgetMs: number, concurrency = 2) {
  const config = await resolveSyncConfig();
  const now = Date.now();
  const due = accounts.filter((a) => {
    return providerFor(String(a.platform))?.configured(config) && accountSyncDue(a, now, staleMs);
  }).sort((a, b) => (Date.parse(String(a.next_sync_at ?? a.last_sync_attempt_at ?? a.last_synced_at)) || 0) - (Date.parse(String(b.next_sync_at ?? b.last_sync_attempt_at ?? b.last_synced_at)) || 0));
  const deadline = now + budgetMs;
  let synced = 0;
  let failed = 0;
  const width = Math.max(1, Math.min(4, concurrency));
  for (let i = 0; i < due.length && (i === 0 || Date.now() + 10_000 < deadline); i += width) {
    const results = await Promise.allSettled(due.slice(i, i + width).map((a) => syncAccount(sb, a, config, { force: false })));
    synced += results.filter(r => r.status === "fulfilled" && r.value.status === "ok").length;
    failed += results.filter(r => r.status === "rejected" || r.value.status === "error").length;
  }
  return { due: due.length, synced, failed };
}

/** No row cap or page-visit dependency: oldest deadlines are claimed directly from the whole database. */
export async function runScheduledSocialSync(sb: Sb = supabaseAdmin(), configOverride?: SyncConfig, budgetMs = 25_000) {
  const config = configOverride ?? await resolveSyncConfig();
  const started = Date.now();
  const { error } = await sb.from("social_sync_scheduler_state").upsert({ id: true, last_started_at: new Date(started).toISOString() });
  databaseError(error);
  let processed = 0, synced = 0, failed = 0;
  // Claim only a batch we can actually start. Expired leases recover after a crashed process.
  while (processed < 12 && (processed === 0 || Date.now() + 12_000 < started + budgetMs)) {
    const accounts = await claimSyncAccounts(sb, config, 2);
    if (!accounts.length) break;
    const results = await Promise.allSettled(accounts.map(account => syncAccount(sb, account, config, { claimed: true })));
    processed += accounts.length;
    synced += results.filter(result => result.status === "fulfilled" && result.value.status === "ok").length;
    failed += results.filter(result => result.status === "rejected" || result.value.status === "error").length;
  }
  const { error: finishError } = await sb.from("social_sync_scheduler_state").upsert({ id: true, last_finished_at: new Date().toISOString(), processed, synced, failed });
  databaseError(finishError);
  return { processed, synced, failed, durationMs: Date.now() - started };
}

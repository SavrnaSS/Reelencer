import "server-only";
import { fetchInstagramProfile } from "@/lib/api/instagramProfile";
import { accountPlatformFor } from "@/lib/accountSetup";
import { externalPostId, type SyncState } from "@/lib/socialAnalytics";
import type { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveSyncConfig, type SyncConfig } from "@/lib/api/integrations";

// YouTube uses its Data API; Instagram reads only the public profile HTML.

type Sb = ReturnType<typeof supabaseAdmin>;
type Row = Record<string, unknown>;

type ExternalPost = { externalId: string; url: string; caption?: string; postedAt?: string; views?: number; likes?: number; comments?: number };
type Fetched = { externalId?: string; followers?: number; following?: number; posts?: number; totalViews?: number; media: ExternalPost[]; note?: string };

const TIMEOUT_MS = 8000;

class SyncError extends Error {}

const n = (value: unknown) => {
  const v = typeof value === "string" ? Number(value) : value;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined;
};

async function getJson(url: string) {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
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
  const key = encodeURIComponent(config.youtubeApiKey);
  const base = "https://www.googleapis.com/youtube/v3";
  const channels = await getJson(`${base}/channels?part=statistics,contentDetails&forHandle=${encodeURIComponent(`@${handle}`)}&key=${key}`);
  const channel = (channels.items as Row[] | undefined)?.[0];
  if (!channel) throw new SyncError(`No YouTube channel found for @${handle}. Check the handle on the account.`);
  const stats = (channel.statistics ?? {}) as Row;
  const uploads = String(((channel.contentDetails as Row)?.relatedPlaylists as Row | undefined)?.uploads ?? "");
  let media: ExternalPost[] = [];
  if (uploads) {
    const items = await getJson(`${base}/playlistItems?part=contentDetails&maxResults=25&playlistId=${encodeURIComponent(uploads)}&key=${key}`);
    const ids = ((items.items as Row[] | undefined) ?? []).map((i) => String((i.contentDetails as Row)?.videoId ?? "")).filter(Boolean);
    if (ids.length) {
      const videos = await getJson(`${base}/videos?part=statistics,snippet&id=${ids.join(",")}&key=${key}`);
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
  }
  return {
    externalId: String(channel.id ?? ""),
    // Channels can hide their subscriber count.
    followers: stats.hiddenSubscriberCount ? undefined : n(stats.subscriberCount),
    posts: n(stats.videoCount),
    totalViews: n(stats.viewCount),
    media,
  };
}

type Provider = { configured: (config: SyncConfig) => boolean; fetch: (handle: string, config: SyncConfig, trackedUrls?: string[], publishedAfter?: number) => Promise<Fetched> };

function providerFor(platform: string): Provider | null {
  const id = accountPlatformFor(platform).id;
  if (id === "youtube") return { configured: (c) => !!c.youtubeApiKey, fetch: fetchYouTube };
  if (id === "instagram") return { configured: () => true, fetch: (handle, _config, urls, publishedAfter) => fetchInstagramProfile(handle, urls, { publishedAfter }) };
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

async function updateAccount(sb: Sb, id: string, values: Row) {
  const { error } = await sb.from("linked_social_accounts").update(values).eq("id", id);
  if (error && error.code !== MISSING_COLUMN) throw new Error(`Couldn't save sync state (${error.code ?? "unknown"}).`);
}

/** Insert, retrying without the columns added by the auto-sync migration if it isn't applied yet. */
async function insertTolerant(sb: Sb, table: string, row: Row, newColumns: string[]) {
  let { error } = await sb.from(table).insert(row);
  if (error?.code === MISSING_COLUMN) ({ error } = await sb.from(table).insert(Object.fromEntries(Object.entries(row).filter(([k]) => !newColumns.includes(k)))));
  if (error && error.code !== "23505") throw new Error(`Couldn't save synced data (${error.code ?? "unknown"}).`);
}

/**
 * Pulls fresh numbers for one account: one snapshot (period figures are the change since the previous sync) and
 * per-post updates. New posts published after linking are added for review, so pay still needs a human decision.
 */
const runningSyncs = new Map<string, Promise<SyncState>>();

export async function syncAccount(sb: Sb, account: Row, configOverride?: SyncConfig): Promise<SyncState> {
  const id = String(account.id);
  const running = runningSyncs.get(id);
  if (running) return running;
  const task = performSyncAccount(sb, account, configOverride);
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
    const source = accountPlatformFor(String(account.platform)).id === "instagram" ? "profile" : "api";

    const [{ data: lastApi }, { data: existing }] = await Promise.all([
      sb.from("social_account_snapshots").select("*").eq("account_id", id).eq("source", source).order("captured_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("social_account_posts").select("*").eq("account_id", id),
    ]);
    const posts = (existing ?? []) as Row[];
    const linkedAt = Date.parse(String(account.linked_at)) - 86_400_000;
    const tracked = [...posts].sort((a, b) => {
      const needsNumbers = (post: Row) => post.status === "submitted" && post.views == null;
      return Number(needsNumbers(b)) - Number(needsNumbers(a)) || Date.parse(String(a.views_captured_at ?? a.updated_at ?? "1970-01-01")) - Date.parse(String(b.views_captured_at ?? b.updated_at ?? "1970-01-01"));
    });
    const fetched = await provider.fetch(String(account.handle), config, tracked.map((post) => String(post.url ?? "")), Number.isFinite(linkedAt) ? linkedAt : undefined);
    const byExternal = new Map<string, Row>();
    for (const post of posts) {
      const key = String(post.external_id || "") || externalPostId(String(post.url));
      if (key) byExternal.set(key, post);
    }

    // Interactions gained on posts we already knew about, since the last sync.
    let interactionsGained = 0;
    for (const media of fetched.media) {
      const known = byExternal.get(media.externalId);
      if (known) {
        interactionsGained += Math.max(0, (media.likes ?? 0) - Number(known.likes ?? 0)) + Math.max(0, (media.comments ?? 0) - Number(known.comments ?? 0));
        const { error } = await sb
          .from("social_account_posts")
          .update({
            ...(media.views !== undefined ? { views: media.views, views_captured_at: now.toISOString(), views_source: source } : {}),
            ...(media.likes !== undefined ? { likes: media.likes } : {}),
            ...(media.comments !== undefined ? { comments: media.comments } : {}),
            ...(!known.posted_at && media.postedAt ? { posted_at: media.postedAt } : {}),
            ...(!known.caption && media.caption ? { caption: media.caption } : {}),
            updated_at: now.toISOString(),
          })
          .eq("id", String(known.id));
        if (error) throw new Error(`Couldn't update a synced post (${error.code ?? "unknown"}).`);
      } else if (media.postedAt && Date.parse(media.postedAt) >= linkedAt && (source !== "profile" || media.url.includes('/reel/'))) {
        // Posted for the gig after linking: track it automatically, pending the team's review for pay.
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
            views_source: media.views !== undefined ? source : null,
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

    // Public profile history refreshes every five minutes; API period snapshots remain hourly.
    const lastAt = lastApi ? Date.parse(String(lastApi.captured_at)) : 0;
    if (now.getTime() - lastAt >= (source === "profile" ? 5 * 60_000 : 60 * 60_000)) {
      const days = lastApi ? (now.getTime() - lastAt) / 86_400_000 : 7;
      const prevTotal = lastApi ? Number(lastApi.total_views ?? NaN) : NaN;
      const viewsGained = fetched.totalViews !== undefined && Number.isFinite(prevTotal) ? Math.max(0, fetched.totalViews - prevTotal) : undefined;
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
          impressions: viewsGained ?? null,
          engagements: source === "api" && lastApi ? interactionsGained : null,
          source,
          note: fetched.note ?? "Synced automatically",
          total_views: fetched.totalViews ?? null,
        },
        ["total_views"],
      );
    }

    await updateAccount(sb, id, { sync_status: "ok", last_synced_at: now.toISOString(), sync_error: "", ...(fetched.externalId ? { external_id: fetched.externalId } : {}) });
    return { available: true, status: "ok", lastSyncedAt: now.toISOString() };
  } catch (error) {
    const message = (error instanceof Error ? error.message : "Sync failed.").slice(0, 300);
    await updateAccount(sb, id, { sync_status: "error", last_synced_at: now.toISOString(), sync_error: message }).catch(() => undefined);
    return { available: true, status: "error", lastSyncedAt: now.toISOString(), error: message };
  }
}

/** Determine refresh cadence separately from how frequently clients poll the saved data. */
export function accountSyncDue(account: Row, now: number, staleMs: number): boolean {
  if (account.status !== "active") return false;
  const last = account.last_synced_at ? Date.parse(String(account.last_synced_at)) : 0;
  if (!last || !Number.isFinite(last)) return true;
  const profile = accountPlatformFor(String(account.platform)).id === "instagram";
  const interval = account.sync_status === "error" ? (profile ? 30 * 60_000 : Math.max(staleMs, 30 * 60_000)) : profile ? 5 * 60_000 : staleMs;
  return now - last >= interval;
}

/** Syncs accounts whose data is older than `staleMs`, a few at a time, within an overall time budget. */
export async function syncStale(sb: Sb, accounts: Row[], staleMs: number, budgetMs: number, concurrency = 4) {
  const config = await resolveSyncConfig();
  const now = Date.now();
  const due = accounts.filter((a) => {
    return providerFor(String(a.platform))?.configured(config) && accountSyncDue(a, now, staleMs);
  });
  const deadline = now + budgetMs;
  let synced = 0;
  let failed = 0;
  for (let i = 0; i < due.length && Date.now() < deadline; i += concurrency) {
    const results = await Promise.all(due.slice(i, i + concurrency).map((a) => syncAccount(sb, a, config)));
    synced += results.filter((r) => r.status === "ok").length;
    failed += results.filter((r) => r.status === "error").length;
  }
  return { due: due.length, synced, failed };
}

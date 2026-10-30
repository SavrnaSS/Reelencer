import "server-only";
import { canonicalInstagramReelUrl } from "@/lib/socialAnalytics";
import { ProfileNotFoundError, SocialSyncError } from "@/lib/socialSyncSchedule";

type Row = Record<string, unknown>;
export type ProfilePost = { externalId: string; url: string; caption?: string; postedAt?: string; views?: number; likes?: number; comments?: number };
export type InstagramProfile = { externalId?: string; followers?: number; following?: number; posts?: number; biography?: string; isPrivate?: boolean; media: ProfilePost[]; note: string };

export function normalizeInstagramHandle(input: string): string {
  const handle = input.trim().replace(/^@/, "");
  if (!/^[a-zA-Z0-9._]{1,30}$/.test(handle)) throw new Error("Enter a valid Instagram handle, without a URL.");
  return handle.toLowerCase();
}

function count(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const match = String(value).trim().replace(/,/g, "").match(/^(\d+(?:\.\d+)?)\s*([kmb])?$/i);
  if (!match) return undefined;
  const result = Number(match[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[match[2]?.toLowerCase()] ?? 1);
  return Number.isSafeInteger(Math.round(result)) ? Math.round(result) : undefined;
}
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const decode = (value: string) => value.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (all, n) => Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : all);

function embeddedObjects(html: string): Row[] {
  const objects: Row[] = [];
  const visit = (value: unknown, depth = 0) => {
    if (depth > 35 || objects.length >= 30_000) return;
    if (typeof value === "string" && value.length <= 1_000_000 && /^[\[{]/.test(value.trim())) {
      try { visit(JSON.parse(value), depth + 1); } catch { /* Captions and other plain text are not JSON. */ }
      return;
    }
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { for (const child of value) visit(child, depth + 1); return; }
    objects.push(value as Row);
    for (const child of Object.values(value)) visit(child, depth + 1);
  };
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const script = match[1].trim();
    const candidate = script.startsWith("window._sharedData") ? script.replace(/^window\._sharedData\s*=\s*/, "").replace(/;\s*$/, "") : script;
    try { visit(JSON.parse(candidate)); } catch {
      // Public embeds put JSON inside a ServerJS call. Parse only its quoted data string;
      // executing the script would run untrusted code and isn't necessary.
      for (const payload of script.matchAll(/"contextJSON"\s*:\s*("(?:\\.|[^"\\])*")/g)) {
        if (payload[1].length > 1_000_000) continue;
        try { visit(JSON.parse(payload[1])); } catch { /* Ignore malformed embedded data. */ }
      }
    }
  }
  return objects;
}

function mediaFromObject(post: Row, code: string): ProfilePost {
    const timestamp = count(post.taken_at_timestamp ?? post.taken_at);
    const date = timestamp !== undefined ? new Date(timestamp * 1000) : undefined;
    const captions = row(post.edge_media_to_caption).edges;
    const caption = Array.isArray(captions) ? row(row(captions[0]).node).text : row(post.caption).text;
    return {
      externalId: `ig:${code}`, url: `https://www.instagram.com/${post.is_video === true || post.product_type === "clips" ? "reel" : "p"}/${code}/`,
      caption: typeof caption === "string" ? caption.split("\n")[0].slice(0, 300) : undefined,
      postedAt: date && Number.isFinite(date.getTime()) && date.getTime() <= Date.now() ? date.toISOString() : undefined,
      views: [post.video_view_count, post.video_play_count, post.play_count, post.ig_play_count, post.view_count, row(post.clips_metadata).play_count].map(count).find((value) => value !== undefined),
      likes: post.like_and_view_counts_disabled === true ? undefined : count(row(post.edge_liked_by).count ?? row(post.edge_media_preview_like).count ?? post.like_count),
      comments: count(row(post.edge_media_to_comment).count ?? post.comment_count),
    };
}

/** Read only JSON actually embedded in the public HTML; never call private or Graph endpoints. */
export function extractInstagramProfile(html: string, input: string): InstagramProfile {
  const handle = normalizeInstagramHandle(input);
  const objects = embeddedObjects(html);
  const profile = objects.find((o) => String(o.username ?? "").toLowerCase() === handle && (o.edge_followed_by || o.follower_count !== undefined || o.edge_owner_to_timeline_media || o.is_private !== undefined));
  const result: InstagramProfile = {
    externalId: profile?.id ? String(profile.id) : undefined,
    followers: count(row(profile?.edge_followed_by).count ?? profile?.follower_count),
    following: count(row(profile?.edge_follow).count ?? profile?.following_count),
    posts: count(row(profile?.edge_owner_to_timeline_media).count ?? profile?.media_count),
    biography: typeof profile?.biography === "string" ? profile.biography.slice(0, 600) : undefined,
    isPrivate: typeof profile?.is_private === "boolean" ? profile.is_private : undefined,
    media: [],
    note: "Read from public Instagram profile. Hidden metrics are unavailable; abbreviated counts may be rounded.",
  };
  let identified = !!profile;
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs: Record<string, string> = {};
    for (const attr of match[0].matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) attrs[attr[1].toLowerCase()] = decode(attr[3]);
    if (!/^(og:description|description)$/i.test(attrs.property || attrs.name || "")) continue;
    const description = attrs.content || "";
    if (!description.toLowerCase().includes(`@${handle}`) || new RegExp(`@${handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[a-z0-9._]`, "i").test(description)) continue;
    identified = true;
    result.followers ??= count(description.match(/([\d,.]+\s*[kmb]?)\s+followers\b/i)?.[1]);
    result.following ??= count(description.match(/([\d,.]+\s*[kmb]?)\s+following\b/i)?.[1]);
    result.posts ??= count(description.match(/([\d,.]+\s*[kmb]?)\s+posts\b/i)?.[1]);
  }
  if (!identified || [result.followers, result.following, result.posts].every((v) => v === undefined)) {
    throw new Error("Instagram did not expose readable counts for this handle. Check the handle or update from screenshots; the profile may require login.");
  }
  if (profile?.is_private === true) {
    result.note = "Public profile counts only: this Instagram account is private. Use screenshots for post insights.";
    return result;
  }
  const edges = row(profile?.edge_owner_to_timeline_media).edges;
  const candidates = Array.isArray(edges) ? edges.map((edge) => row(row(edge).node)) : objects.filter((o) => String(row(o.owner ?? o.user).username ?? "").toLowerCase() === handle);
  const seen = new Set<string>();
  for (const post of candidates) {
    const owner = row(post.owner ?? post.user);
    if (owner.username && String(owner.username).toLowerCase() !== handle) continue;
    const code = String(post.shortcode ?? post.code ?? "");
    if (!/^[\w-]{1,100}$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    result.media.push(mediaFromObject(post, code));
    if (result.media.length >= 25) break;
  }
  return result;
}

async function readPage(path: string, signal: AbortSignal): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`https://www.instagram.com${path}`, {
      headers: { Accept: "text/html", "Accept-Language": "en-US,en;q=0.9" },
      signal, cache: "no-store", redirect: "manual",
    });
  } catch { throw new Error("Instagram profile could not be reached. Try later or update from screenshots."); }
  if (response.status === 429) {
    const retry = response.headers.get("retry-after");
    const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Math.max(0, Date.parse(retry) - Date.now()) : 0;
    throw new SocialSyncError("Instagram has temporarily limited profile reads. Automatic sync will retry later; use screenshots meanwhile.", "rate_limited", delay || 0);
  }
  if (response.status >= 300 && response.status < 400) throw new SocialSyncError("Instagram redirected this profile read to a page that may require login. Connect the Instagram API in Auto-sync for eligible professional accounts, or add insight screenshots.", "login_required");
  if ((response.status === 404 || response.status === 410) && /^\/[a-zA-Z0-9._]+\/$/.test(path)) throw new ProfileNotFoundError("Instagram could not find this profile. Check whether its username changed.");
  if (!response.ok) throw new Error(`Instagram profile is unavailable (${response.status}). Check the handle or update from screenshots.`);
  if (!response.headers.get("content-type")?.includes("text/html")) throw new Error("Instagram returned an unreadable profile page.");
  // Bound untrusted response size without first buffering an unlimited body.
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Instagram returned an empty profile page.");
  const decoder = new TextDecoder();
  let html = "", bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4_000_000) throw new Error("Instagram profile page exceeded the reading limit.");
      html += decoder.decode(value, { stream: true });
    }
    html += decoder.decode();
  } finally { await reader.cancel().catch(() => undefined); }
  return html;
}

/** A post must match both the requested shortcode and its author before metrics are accepted. */
export function extractInstagramPost(html: string, input: string, code: string): ProfilePost | undefined {
  const handle = normalizeInstagramHandle(input);
  const objects = embeddedObjects(html);
  const post = objects.find((o) => String(o.shortcode ?? o.code ?? "") === code && String(row(o.owner ?? o.user).username ?? "").toLowerCase() === handle);
  if (post) return mediaFromObject(post, code);
  // JSON-LD embeds the publisher and InteractionCounter records on some public reel pages.
  for (const object of objects) {
    const url = String(object.url ?? object['@id'] ?? "");
    if (!new RegExp(`^https://(?:www\\.)?instagram\\.com/(?:reel|p)/${code}/?(?:[?#].*)?$`).test(url)) continue;
    const authors = Array.isArray(object.author) ? object.author : [object.author];
    if (!authors.some((author) => {
      const a = row(author);
      return String(a.alternateName ?? "").replace(/^@/, "").toLowerCase() === handle || String(a.url ?? a['@id'] ?? "").replace(/\/$/, "").toLowerCase() === `https://www.instagram.com/${handle}` || String(a.url ?? "").replace(/\/$/, "").toLowerCase() === `https://instagram.com/${handle}`;
    })) continue;
    const media: ProfilePost = { externalId: `ig:${code}`, url };
    const interactions = Array.isArray(object.interactionStatistic) ? object.interactionStatistic : [object.interactionStatistic];
    for (const interaction of interactions) {
      const i = row(interaction);
      const type = String(row(i.interactionType)['@type'] ?? i.interactionType ?? "").split(/[/:]/).at(-1);
      const value = count(i.userInteractionCount);
      if (type === "WatchAction" || type === "ViewAction") media.views = value;
      if (type === "LikeAction") media.likes = value;
      if (type === "CommentAction") media.comments = value;
    }
    const date = typeof object.uploadDate === "string" ? new Date(object.uploadDate) : undefined;
    if (date && Number.isFinite(date.getTime()) && date.getTime() <= Date.now()) media.postedAt = date.toISOString();
    if (typeof object.caption === "string") media.caption = object.caption.slice(0, 300);
    if ([media.views, media.likes, media.comments].some((v) => v !== undefined)) return media;
  }
  const metadata: Record<string, string> = {};
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs: Record<string, string> = {};
    for (const attr of tag[0].matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) attrs[attr[1].toLowerCase()] = decode(attr[3]);
    metadata[attrs.property || attrs.name || ""] = attrs.content || "";
  }
  const canonical = postPath(metadata['og:url'] || "");
  const description = metadata['og:description'] || metadata.description || "";
  const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const verifiedAuthor = new RegExp(`(?:^| - )@?${escaped} on `, 'i').test(description);
  if (canonical?.split('/')[2] === code && verifiedAuthor) {
    const media: ProfilePost = { externalId: `ig:${code}`, url: `https://www.instagram.com${canonical}` };
    media.likes = count(description.match(/^([\d,.]+\s*[kmb]?)\s+likes\b/i)?.[1]);
    media.comments = count(description.match(/,\s*([\d,.]+\s*[kmb]?)\s+comments\b/i)?.[1]);
    media.views = count(description.match(/(?:^|,\s*)([\d,.]+\s*[kmb]?)\s+(?:views|plays)\b/i)?.[1]);
    if ([media.views, media.likes, media.comments].some((v) => v !== undefined)) return media;
  }
  return undefined;
}

function postPath(input: string): string | undefined {
  try {
    const url = new URL(input, "https://www.instagram.com");
    if (!["instagram.com", "www.instagram.com"].includes(url.hostname) || url.protocol !== "https:") return undefined;
    const match = url.pathname.match(/^\/(reel|reels|p)\/([\w-]{1,100})\/?$/);
    return match ? `/${match[1] === "reels" ? "reel" : match[1]}/${match[2]}/` : undefined;
  } catch { return undefined; }
}

const stopsReads = (error: unknown) => /limited|redirected/i.test(error instanceof Error ? error.message : "");

/** Fetch a submitted reel directly; its owner and shortcode must match before any numbers are accepted. */
/**
 * Combines two public readings of one reel. Embeds and reel pages count differently (an embed can show 1 comment
 * while the page shows 2), so each count keeps the higher reading; other fields take the newer defined value.
 */
export function mergeReelReadings(base: ProfilePost | undefined, next: ProfilePost | undefined): ProfilePost | undefined {
  if (!base || !next) return base ?? next;
  const merged = { ...base, ...Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined)) } as ProfilePost;
  for (const key of ["views", "likes", "comments"] as const) {
    const values = [base[key], next[key]].filter((value): value is number => value !== undefined);
    if (values.length) merged[key] = Math.max(...values);
  }
  return merged;
}

export async function fetchInstagramReel(input: string, url: string, options: { signal?: AbortSignal } = {}): Promise<ProfilePost | undefined> {
  const handle = normalizeInstagramHandle(input);
  const canonical = canonicalInstagramReelUrl(url);
  if (!canonical) throw new Error("Paste a valid Instagram reel link.");
  const path = new URL(canonical).pathname;
  const code = path.split("/")[2];
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000);
  let embedded: ProfilePost | undefined;
  try {
    embedded = extractInstagramPost(await readPage(`${path}embed/`, signal), handle, code);
    if (embedded?.views !== undefined && embedded.postedAt) return { ...embedded, url: canonical };
  } catch (error) {
    if (signal.aborted || stopsReads(error)) throw error;
  }
  if (signal.aborted) return embedded ? { ...embedded, url: canonical } : undefined;
  try {
    const primary = extractInstagramPost(await readPage(path, signal), handle, code);
    if (primary) return { ...mergeReelReadings(embedded, primary)!, url: canonical };
  } catch (error) {
    if (!embedded) throw error;
  }
  return embedded ? { ...embedded, url: canonical } : undefined;
}

export async function fetchInstagramProfile(input: string, trackedUrls: string[] = [], options: { publishedAfter?: number; signal?: AbortSignal; refreshInteractions?: boolean } = {}): Promise<InstagramProfile> {
  const handle = normalizeInstagramHandle(input);
  // All page reads share one time budget so background refresh cannot fan out indefinitely.
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000);
  let html: string;
  let profile: InstagramProfile;
  let usedEmbed = false;
  try {
    html = await readPage(`/${handle}/`, AbortSignal.any([signal, AbortSignal.timeout(3500)]));
    profile = extractInstagramProfile(html, handle);
  } catch (error) {
    // One public embed fallback can survive a profile login wall. Rate limits are always respected.
    if (signal.aborted || error instanceof ProfileNotFoundError || (error instanceof SocialSyncError && error.code === "rate_limited") || /\(404\)/.test(error instanceof Error ? error.message : "")) throw error;
    try {
      html = await readPage(`/${handle}/embed/`, AbortSignal.any([signal, AbortSignal.timeout(2500)]));
      profile = extractInstagramProfile(html, handle);
      profile.note += " Read from the public profile embed because the main profile was unavailable.";
      usedEmbed = true;
    } catch (fallbackError) {
      if (fallbackError instanceof SocialSyncError && fallbackError.code === "rate_limited") throw fallbackError;
      throw error;
    }
  }
  if (profile.note.includes("account is private")) return profile;
  const mergeMedia = (media: ProfilePost) => {
    const existing = profile.media.find((post) => post.externalId === media.externalId);
    if (existing) Object.assign(existing, mergeReelReadings(existing, media));
    else if (profile.media.length < 50) profile.media.push(media);
  };
  const discovered: string[] = [];
  const collect = (page: string) => {
    // Profile embeds expose a dated timeline even when the main page hides its feed.
    try { for (const media of extractInstagramProfile(page, handle).media) mergeMedia(media); }
    catch { /* Reels pages may contain media without profile counts. */ }
    for (const object of embeddedObjects(page)) {
      if (String(row(object.owner ?? object.user).username ?? "").toLowerCase() !== handle) continue;
      const code = String(object.shortcode ?? object.code ?? "");
      if (/^[\w-]{1,100}$/.test(code)) mergeMedia(mediaFromObject(object, code));
    }
    for (const link of page.matchAll(/<a\b[^>]*href\s*=\s*(["'])([^"']+)\1/gi)) discovered.push(decode(link[2]));
  };
  collect(html);
  let blocked = false;
  if (profile.posts !== 0 && !signal.aborted) {
    try { if (!usedEmbed) collect(await readPage(`/${handle}/embed/`, AbortSignal.any([signal, AbortSignal.timeout(2500)]))); }
    catch (error) { blocked = stopsReads(error); }
    // The profile feed can be pinned, cached, or omit reels shared only to the Reels tab.
    if (!blocked && !signal.aborted) {
      try { collect(await readPage(`/${handle}/reels/`, AbortSignal.any([signal, AbortSignal.timeout(1500)]))); }
      catch (error) { blocked = stopsReads(error); }
    }
  }
  const trackedPaths = [...new Map(trackedUrls.map(postPath).filter((path): path is string => !!path).map((path) => [path.split('/')[2], path])).values()];
  const trackedCodes = new Set(trackedPaths.map((path) => path.split('/')[2]));
  const candidates = [...new Map([...profile.media.map((media) => media.url), ...discovered].map(postPath).filter((path): path is string => !!path).map((path) => [path.split('/')[2], path])).values()];
  const newPaths = candidates.filter((path) => {
    if (trackedCodes.has(path.split('/')[2])) return false;
    const media = profile.media.find((post) => post.externalId === `ig:${path.split('/')[2]}`);
    // Photos and dated older posts shouldn't consume the new-reel discovery budget.
    if (media && !media.url.includes('/reel/')) return false;
    return !media?.postedAt || options.publishedAfter === undefined || Date.parse(media.postedAt) >= options.publishedAfter;
  }).sort((a, b) => {
    const date = (path: string) => Date.parse(profile.media.find((post) => post.externalId === `ig:${path.split('/')[2]}`)?.postedAt ?? '') || 0;
    return date(b) - date(a);
  });
  // New reels receive reserved slots even when many existing reels are tracked.
  const fresh = newPaths.slice(0, trackedPaths.length ? Math.max(2, 6 - trackedPaths.length) : 6);
  const known = trackedPaths.slice(0, 6 - fresh.length);
  if (known.length && trackedPaths.length > known.length) {
    // Keep a rotating slot so unreadable old reels cannot starve the rest of the list.
    const rotating = trackedPaths[Math.floor(Date.now() / 300_000) % trackedPaths.length];
    if (!known.includes(rotating)) known[known.length - 1] = rotating;
  }
  const paths = [...fresh, ...known];
  // Embeds carry views but can lag on likes and comments. When asked (the sync does so about every 30 minutes),
  // one tracked reel also gets its full page read, in rotation, so interactions catch up within the read budget.
  const detailCode = options.refreshInteractions && trackedPaths.length ? trackedPaths[Math.floor(Date.now() / 1_800_000) % trackedPaths.length].split('/')[2] : undefined;
  let checked = 0, unavailable = 0;
  for (let index = 0; index < paths.length && !signal.aborted && !blocked; index += 2) {
    const results = await Promise.all(paths.slice(index, index + 2).map(async (path) => {
      const code = path.split('/')[2];
      let embedded: ProfilePost | undefined;
      try {
        embedded = extractInstagramPost(await readPage(`${path}embed/`, signal), handle, code);
        const date = profile.media.find((post) => post.externalId === `ig:${code}`)?.postedAt;
        if (embedded?.views !== undefined && code !== detailCode && (trackedCodes.has(code) || embedded.postedAt || date)) return embedded;
      } catch (error) {
        // A rate limit or login wall should not fan out into more requests.
        if (stopsReads(error)) blocked = true;
        if (signal.aborted || blocked) return undefined;
      }
      if (signal.aborted) return embedded;
      try {
        const primary = extractInstagramPost(await readPage(path, signal), handle, code);
        return mergeReelReadings(embedded, primary);
      } catch (error) { if (stopsReads(error)) blocked = true; return embedded; }
    }));
    for (const [offset, media] of results.entries()) {
      checked++;
      if (media?.views === undefined) unavailable++;
      if (!media) continue;
      // Post embeds may omit is_video/product_type; keep the verified page's permalink type.
      mergeMedia({ ...media, url: `https://www.instagram.com${paths[index + offset]}` });
    }
  }
  if (checked) profile.note += ` Checked ${checked} public reels including embed data; ${unavailable} did not expose verified view counts.`;
  else if (!profile.media.length) profile.note += " No reel links exposed on this profile; add a reel link to track its public metrics.";
  if (blocked) profile.note += " Additional discovery paused because Instagram limited or redirected a read.";
  return profile;
}

/**
 * Public profile page only (counts, bio, privacy): used to verify a requested account before it is linked.
 * `lookFor` reports whether a verification code appears in the bio, or anywhere in the public page when the bio
 * itself isn't exposed to logged-out reads (the code is random, so a match still means the owner placed it).
 */
export async function fetchInstagramProfileSummary(input: string, lookFor?: string): Promise<Omit<InstagramProfile, "media"> & { codeFound?: boolean }> {
  const handle = normalizeInstagramHandle(input);
  const html = await readPage(`/${handle}/`, AbortSignal.timeout(6000));
  const needle = lookFor?.trim().toUpperCase();
  const inPage = needle ? decode(html).toUpperCase().includes(needle) : undefined;
  let summary: Omit<InstagramProfile, "media">;
  try {
    const { media: _media, ...profile } = extractInstagramProfile(html, handle);
    void _media;
    summary = profile;
  } catch (error) {
    // Counts can be hidden from logged-out reads while the bio still renders; the code alone proves ownership.
    if (!inPage) throw error;
    return { note: "Counts weren't readable.", codeFound: true };
  }
  const codeFound = needle ? (summary.biography ?? "").toUpperCase().includes(needle) || !!inPage : undefined;
  return { ...summary, codeFound };
}
